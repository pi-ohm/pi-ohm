import { TaggedError, type Result } from "better-result";

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

export class OhmDbValidationError extends TaggedError("OhmDbValidationError")<{
  code: string;
  message: string;
  field?: string;
  cause?: unknown;
}>() {
  constructor(input: { code: string; message?: string; field?: string; cause?: unknown }) {
    super({
      code: input.code,
      field: input.field,
      cause: input.cause,
      message:
        input.message ??
        (input.cause
          ? `DB validation failure (${input.code}): ${messageFromCause(input.cause)}`
          : `DB validation failure (${input.code})`),
    });
  }
}

export class OhmDbRuntimeError extends TaggedError("OhmDbRuntimeError")<{
  code: string;
  message: string;
  stage?: string;
  cause?: unknown;
}>() {
  constructor(input: { code: string; message?: string; stage?: string; cause?: unknown }) {
    super({
      code: input.code,
      stage: input.stage,
      cause: input.cause,
      message:
        input.message ??
        (input.cause
          ? `DB runtime failure (${input.code}): ${messageFromCause(input.cause)}`
          : `DB runtime failure (${input.code})`),
    });
  }
}

export type OhmDbError = OhmDbValidationError | OhmDbRuntimeError;
export type OhmDbResult<T, E extends OhmDbError = OhmDbError> = Result<T, E>;
