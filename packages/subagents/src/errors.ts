import { TaggedError, type Result } from "better-result";

export type SubagentErrorMeta = Record<string, unknown>;

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

export class SubagentValidationError extends TaggedError("SubagentValidationError")<{
  code: string;
  message: string;
  path?: string;
  cause?: unknown;
  meta?: SubagentErrorMeta;
}>() {
  constructor(args: {
    code: string;
    path?: string;
    message?: string;
    cause?: unknown;
    meta?: SubagentErrorMeta;
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

export class SubagentPolicyError extends TaggedError("SubagentPolicyError")<{
  code: string;
  message: string;
  action?: string;
  cause?: unknown;
  meta?: SubagentErrorMeta;
}>() {
  constructor(args: {
    code: string;
    action?: string;
    message?: string;
    cause?: unknown;
    meta?: SubagentErrorMeta;
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

export class SubagentRuntimeError extends TaggedError("SubagentRuntimeError")<{
  code: string;
  message: string;
  stage?: string;
  cause?: unknown;
  meta?: SubagentErrorMeta;
}>() {
  constructor(args: {
    code: string;
    stage?: string;
    message?: string;
    cause?: unknown;
    meta?: SubagentErrorMeta;
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

export class SubagentPersistenceError extends TaggedError("SubagentPersistenceError")<{
  code: string;
  message: string;
  resource?: string;
  cause?: unknown;
  meta?: SubagentErrorMeta;
}>() {
  constructor(args: {
    code: string;
    resource?: string;
    message?: string;
    cause?: unknown;
    meta?: SubagentErrorMeta;
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

export type SubagentError =
  | SubagentValidationError
  | SubagentPolicyError
  | SubagentRuntimeError
  | SubagentPersistenceError;

export type SubagentResult<T, E extends SubagentError = SubagentError> = Result<T, E>;

export function isSubagentError(value: unknown): value is SubagentError {
  return (
    SubagentValidationError.is(value) ||
    SubagentPolicyError.is(value) ||
    SubagentRuntimeError.is(value) ||
    SubagentPersistenceError.is(value)
  );
}
