export type DeferredJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface DeferredJobContext {
  readonly signal: AbortSignal;
}

export interface DeferredJob {
  readonly key: string;
  readonly label?: string;
  readonly delayMs?: number;
  readonly run: (context: DeferredJobContext) => Promise<void> | void;
}

export interface DeferredJobSnapshot {
  readonly key: string;
  readonly label?: string;
  readonly status: DeferredJobStatus;
  readonly error?: string;
  readonly startedAt?: number;
  readonly finishedAt?: number;
}

export interface DeferredJobHandle {
  readonly key: string;
  cancel: () => void;
  snapshot: () => DeferredJobSnapshot | undefined;
}

export interface DeferredJobs {
  enqueue: (job: DeferredJob) => DeferredJobHandle;
  cancel: (key: string) => void;
  cancelAll: () => void;
  snapshots: () => readonly DeferredJobSnapshot[];
}

interface DeferredJobRecord {
  readonly key: string;
  readonly label?: string;
  readonly controller: AbortController;
  status: DeferredJobStatus;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  timer?: ReturnType<typeof setTimeout>;
}

function message(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

function snapshot(record: DeferredJobRecord): DeferredJobSnapshot {
  return {
    key: record.key,
    ...(record.label ? { label: record.label } : {}),
    status: record.status,
    ...(record.error ? { error: record.error } : {}),
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
  };
}

function active(status: DeferredJobStatus): boolean {
  return status === "queued" || status === "running";
}

export function createDeferredJobs(
  input: {
    readonly onError?: (snapshot: DeferredJobSnapshot) => void;
  } = {},
): DeferredJobs {
  const records = new Map<string, DeferredJobRecord>();

  function handle(key: string): DeferredJobHandle {
    return {
      key,
      cancel: () => cancel(key),
      snapshot: () => {
        const record = records.get(key);
        if (!record) return undefined;
        return snapshot(record);
      },
    };
  }

  function cancel(key: string): void {
    const record = records.get(key);
    if (!record || !active(record.status)) return;
    if (record.timer) clearTimeout(record.timer);
    record.controller.abort();
    record.status = "cancelled";
    record.finishedAt = Date.now();
  }

  function enqueue(job: DeferredJob): DeferredJobHandle {
    const existing = records.get(job.key);
    if (existing && active(existing.status)) return handle(job.key);
    if (existing) records.delete(job.key);

    const controller = new AbortController();
    const record: DeferredJobRecord = {
      key: job.key,
      ...(job.label ? { label: job.label } : {}),
      controller,
      status: "queued",
    };
    records.set(job.key, record);

    record.timer = setTimeout(() => {
      record.timer = undefined;
      if (controller.signal.aborted) {
        record.status = "cancelled";
        record.finishedAt = Date.now();
        return;
      }

      record.status = "running";
      record.startedAt = Date.now();
      void Promise.resolve(job.run({ signal: controller.signal })).then(
        () => {
          record.status = controller.signal.aborted ? "cancelled" : "succeeded";
          record.finishedAt = Date.now();
        },
        (cause: unknown) => {
          record.status = controller.signal.aborted ? "cancelled" : "failed";
          record.error = message(cause);
          record.finishedAt = Date.now();
          if (record.status === "failed") input.onError?.(snapshot(record));
        },
      );
    }, job.delayMs ?? 0);

    return handle(job.key);
  }

  return {
    enqueue,
    cancel,
    cancelAll: () => {
      for (const key of records.keys()) cancel(key);
    },
    snapshots: () => [...records.values()].map(snapshot),
  };
}
