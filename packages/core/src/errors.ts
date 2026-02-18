import { TaggedError, type Result } from "better-result";

export type CoreErrorMeta = Record<string, unknown>;

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

export class CoreValidationError extends TaggedError("CoreValidationError")<{
  code: string;
  message: string;
  path?: string;
  cause?: unknown;
  meta?: CoreErrorMeta;
}>() {
  constructor(args: {
    code: string;
    path?: string;
    message?: string;
    cause?: unknown;
    meta?: CoreErrorMeta;
  }) {
    const derivedMessage =
      args.message ??
      (args.cause
        ? `Validation failed (${args.code}): ${messageFromCause(args.cause)}`
        : `Validation failed (${args.code})`);

    super({
      code: args.code,
      path: args.path,
      cause: args.cause,
      meta: args.meta,
      message: derivedMessage,
    });
  }
}

export class CorePolicyError extends TaggedError("CorePolicyError")<{
  code: string;
  message: string;
  action?: string;
  cause?: unknown;
  meta?: CoreErrorMeta;
}>() {
  constructor(args: {
    code: string;
    action?: string;
    message?: string;
    cause?: unknown;
    meta?: CoreErrorMeta;
  }) {
    const derivedMessage =
      args.message ??
      (args.cause
        ? `Policy denied (${args.code}): ${messageFromCause(args.cause)}`
        : `Policy denied (${args.code})`);

    super({
      code: args.code,
      action: args.action,
      cause: args.cause,
      meta: args.meta,
      message: derivedMessage,
    });
  }
}

export class CoreRuntimeError extends TaggedError("CoreRuntimeError")<{
  code: string;
  message: string;
  stage?: string;
  cause?: unknown;
  meta?: CoreErrorMeta;
}>() {
  constructor(args: {
    code: string;
    stage?: string;
    message?: string;
    cause?: unknown;
    meta?: CoreErrorMeta;
  }) {
    const derivedMessage =
      args.message ??
      (args.cause
        ? `Runtime failure (${args.code}): ${messageFromCause(args.cause)}`
        : `Runtime failure (${args.code})`);

    super({
      code: args.code,
      stage: args.stage,
      cause: args.cause,
      meta: args.meta,
      message: derivedMessage,
    });
  }
}

export class CorePersistenceError extends TaggedError("CorePersistenceError")<{
  code: string;
  message: string;
  resource?: string;
  cause?: unknown;
  meta?: CoreErrorMeta;
}>() {
  constructor(args: {
    code: string;
    resource?: string;
    message?: string;
    cause?: unknown;
    meta?: CoreErrorMeta;
  }) {
    const derivedMessage =
      args.message ??
      (args.cause
        ? `Persistence failure (${args.code}): ${messageFromCause(args.cause)}`
        : `Persistence failure (${args.code})`);

    super({
      code: args.code,
      resource: args.resource,
      cause: args.cause,
      meta: args.meta,
      message: derivedMessage,
    });
  }
}

export type CoreError =
  | CoreValidationError
  | CorePolicyError
  | CoreRuntimeError
  | CorePersistenceError;

export type CoreResult<T, E extends CoreError = CoreError> = Result<T, E>;

export function isCoreError(value: unknown): value is CoreError {
  return (
    CoreValidationError.is(value) ||
    CorePolicyError.is(value) ||
    CoreRuntimeError.is(value) ||
    CorePersistenceError.is(value)
  );
}
