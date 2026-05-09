import { Result } from "better-result";
import { z } from "zod";
import { SubagentRuntimeError, SubagentValidationError, type SubagentResult } from "../errors";

const ZOD_VERSION_MAJOR = z.core.version.major;

export function ensureZodV4(): SubagentResult<true, SubagentRuntimeError> {
  if (ZOD_VERSION_MAJOR === 4) return Result.ok(true);

  return Result.err(
    new SubagentRuntimeError({
      code: "unsupported_zod_major",
      stage: "schema",
      message: "Expected Zod v4 but found v" + String(ZOD_VERSION_MAJOR),
      meta: { detectedMajor: ZOD_VERSION_MAJOR },
    }),
  );
}

export function toValidationError(
  code: string,
  summary: string,
  firstIssuePath: string | undefined,
  cause: unknown,
): SubagentValidationError {
  return new SubagentValidationError({
    code,
    path: firstIssuePath,
    message: firstIssuePath ? `${summary}: ${firstIssuePath}` : summary,
    cause,
  });
}

export function firstIssuePathOrUndefined(issues: readonly z.core.$ZodIssue[]): string | undefined {
  const [firstIssue] = issues;
  if (!firstIssue) return undefined;
  if (firstIssue.path.length === 0) return undefined;

  return firstIssue.path
    .map((segment) => segment.toString())
    .filter((segment) => segment.length > 0)
    .join(".");
}

export function normalizeTypeBoxPath(path: string | undefined): string | undefined {
  if (!path || path.length === 0) return undefined;
  const normalizedPath = path.replace(/^\//u, "").replaceAll("/", ".");
  if (normalizedPath.length === 0) return undefined;
  return normalizedPath;
}
