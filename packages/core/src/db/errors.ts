import { TaggedError, type Result } from "better-result";

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

export class ExtensionDbValidationError extends TaggedError("ExtensionDbValidationError")<{
  readonly code: string;
  readonly message: string;
  readonly field?: string;
  readonly cause?: unknown;
}>() {
  constructor(input: {
    readonly code: string;
    readonly field?: string;
    readonly message?: string;
    readonly cause?: unknown;
  }) {
    super({
      code: input.code,
      field: input.field,
      cause: input.cause,
      message:
        input.message ??
        (input.cause
          ? `Extension DB validation failure (${input.code}): ${messageFromCause(input.cause)}`
          : `Extension DB validation failure (${input.code})`),
    });
  }
}

export class ExtensionDbRuntimeError extends TaggedError("ExtensionDbRuntimeError")<{
  readonly code: string;
  readonly message: string;
  readonly stage?: string;
  readonly cause?: unknown;
}>() {
  constructor(input: {
    readonly code: string;
    readonly stage?: string;
    readonly message?: string;
    readonly cause?: unknown;
  }) {
    super({
      code: input.code,
      stage: input.stage,
      cause: input.cause,
      message:
        input.message ??
        (input.cause
          ? `Extension DB runtime failure (${input.code}): ${messageFromCause(input.cause)}`
          : `Extension DB runtime failure (${input.code})`),
    });
  }
}

export type ExtensionDbError = ExtensionDbValidationError | ExtensionDbRuntimeError;
export type ExtensionDbResult<T, E extends ExtensionDbError = ExtensionDbError> = Result<T, E>;
