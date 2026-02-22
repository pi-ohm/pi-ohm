import { Result } from "better-result";

export interface LookupWithSnapshot<TSnapshot> {
  readonly id: string;
  readonly found: boolean;
  readonly snapshot?: TSnapshot;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface MissingLookupDetails {
  readonly id: string;
  readonly code: string;
  readonly message: string;
}

export interface ToolRuntimeInputLike<TDeps, TUi, TOnUpdate> {
  readonly deps: TDeps;
  readonly hasUI: boolean;
  readonly ui: TUi;
  readonly onUpdate: TOnUpdate;
}

export interface ToolRuntimeContext<TDeps, TUi, TOnUpdate> {
  readonly deps: TDeps;
  readonly hasUI: boolean;
  readonly ui: TUi;
  readonly onUpdate: TOnUpdate;
}

export function toToolRuntimeContext<TDeps, TUi, TOnUpdate>(
  input: ToolRuntimeInputLike<TDeps, TUi, TOnUpdate>,
  overrides?: {
    readonly onUpdate: TOnUpdate;
  },
): ToolRuntimeContext<TDeps, TUi, TOnUpdate> {
  return {
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: overrides ? overrides.onUpdate : input.onUpdate,
  };
}

export function resolveLookupSnapshot<TSnapshot, TError>(
  lookup: LookupWithSnapshot<TSnapshot> | undefined,
  onMissing: (input: MissingLookupDetails) => TError,
): Result<TSnapshot, TError> {
  if (!lookup || !lookup.found || !lookup.snapshot) {
    const id = lookup?.id ?? "unknown";
    const code = lookup?.errorCode ?? "unknown_task_id";
    const message = lookup?.errorMessage ?? `Unknown task id '${id}'`;
    return Result.err(
      onMissing({
        id,
        code,
        message,
      }),
    );
  }

  return Result.ok(lookup.snapshot);
}

export function finalizeToolResult<TDetails, TResult>(input: {
  readonly details: TDetails;
  readonly toResult: (details: TDetails) => TResult;
  readonly report: (result: TResult, details: TDetails) => void;
}): TResult {
  const result = input.toResult(input.details);
  input.report(result, input.details);
  return result;
}
