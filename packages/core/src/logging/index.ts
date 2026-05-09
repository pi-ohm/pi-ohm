import { Result, type Result as BetterResult } from "better-result";

export interface DebugEvent {
  readonly package: string;
  readonly event: string;
  readonly fields?: DebugFields;
}

export interface DebugError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

export type DebugFields = Readonly<Record<string, unknown>>;

export type Debug = (event: string, fields?: DebugFields) => void;

export interface CreateDebugInput {
  readonly packageName: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly write?: (line: string) => void;
}

export function isDebugEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const mode = env.PI_OHM_DEBUG_MODE?.trim().toLowerCase();
  return mode === "true" || mode === "1" || mode === "yes";
}

export function createDebug(input: string | CreateDebugInput): Debug {
  const config = typeof input === "string" ? { packageName: input } : input;
  const write = config.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const env = config.env ?? process.env;

  return (event, fields) => {
    if (!isDebugEnabled(env)) return;

    const record: DebugEvent = {
      package: config.packageName,
      event,
      fields,
    };

    writeRecord(write, record);
  };
}

export function debugResult<T, E>(
  debug: Debug,
  event: string,
  result: BetterResult<T, E>,
  fields?: DebugFields,
): BetterResult<T, E> {
  if (Result.isError(result)) {
    debug(event, {
      ...fields,
      outcome: "error",
      error: serializeDebugError(result.error),
    });
    return result;
  }

  debug(event, {
    ...fields,
    outcome: "ok",
  });
  return result;
}

export function serializeDebugError(error: unknown): DebugError {
  const code = readStringField(error, "code");
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code,
    };
  }

  return {
    name: "Error",
    message: String(error),
    code,
  };
}

function writeRecord(write: (line: string) => void, record: DebugEvent): void {
  const serialized = Result.try({
    try: () => JSON.stringify(record),
    catch: (cause) => cause,
  });

  if (Result.isError(serialized)) return;
  write(serialized.value);
}

function readStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fieldValue = Reflect.get(value, field);
  if (typeof fieldValue !== "string") return undefined;
  const trimmed = fieldValue.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}
