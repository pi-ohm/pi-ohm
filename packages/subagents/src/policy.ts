import type { OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "./catalog";
import { SubagentPolicyError } from "./errors";

export type TaskPermissionDecision = "allow" | "ask" | "deny";

export interface TaskPermissionPolicySnapshot {
  readonly defaultDecision: TaskPermissionDecision;
  readonly perSubagent: Readonly<Record<string, TaskPermissionDecision>>;
  readonly allowInternalRouting: boolean;
}

function normalizeDecision(value: unknown): TaskPermissionDecision | undefined {
  if (value === "allow" || value === "ask" || value === "deny") return value;
  return undefined;
}

function normalizePermissionMap(value: unknown): Readonly<Record<string, TaskPermissionDecision>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries: Array<readonly [string, TaskPermissionDecision]> = [];

  for (const [key, rawDecision] of Object.entries(value)) {
    const normalizedKey = key.trim().toLowerCase();
    if (normalizedKey.length === 0) continue;

    const normalizedDecision = normalizeDecision(rawDecision);
    if (!normalizedDecision) continue;

    entries.push([normalizedKey, normalizedDecision]);
  }

  return Object.fromEntries(entries);
}

export function getTaskPermissionPolicy(config: OhmRuntimeConfig): TaskPermissionPolicySnapshot {
  const permissions = config.subagents?.permissions;

  const defaultDecision = normalizeDecision(permissions?.default) ?? "allow";
  const perSubagent = normalizePermissionMap(permissions?.subagents);
  const allowInternalRouting =
    typeof permissions?.allowInternalRouting === "boolean"
      ? permissions.allowInternalRouting
      : false;

  return {
    defaultDecision,
    perSubagent,
    allowInternalRouting,
  };
}

export function getTaskPermissionDecision(
  subagent: OhmSubagentDefinition,
  config: OhmRuntimeConfig,
): TaskPermissionDecision {
  const policy = getTaskPermissionPolicy(config);
  const explicit = policy.perSubagent[subagent.id];
  if (explicit) return explicit;
  return policy.defaultDecision;
}

export function isSubagentVisibleInTaskRoster(
  subagent: OhmSubagentDefinition,
  config: OhmRuntimeConfig,
): boolean {
  if (!subagent.internal) return true;
  const policy = getTaskPermissionPolicy(config);
  return policy.allowInternalRouting;
}

export function evaluateTaskPermission(
  subagent: OhmSubagentDefinition,
  config: OhmRuntimeConfig,
): Result<true, SubagentPolicyError> {
  const policy = getTaskPermissionPolicy(config);

  if (subagent.internal && !policy.allowInternalRouting) {
    return Result.err(
      new SubagentPolicyError({
        code: "task_internal_subagent_hidden",
        action: "task.invoke",
        message: `Subagent '${subagent.id}' is internal and unavailable by current policy`,
        meta: {
          subagentId: subagent.id,
          allowInternalRouting: policy.allowInternalRouting,
        },
      }),
    );
  }

  const decision = getTaskPermissionDecision(subagent, config);

  if (decision === "allow") return Result.ok(true);

  if (decision === "ask") {
    return Result.err(
      new SubagentPolicyError({
        code: "task_permission_ask_required",
        action: "task.invoke",
        message: `Subagent '${subagent.id}' requires explicit approval before execution`,
        meta: {
          subagentId: subagent.id,
          decision,
        },
      }),
    );
  }

  return Result.err(
    new SubagentPolicyError({
      code: "task_permission_denied",
      action: "task.invoke",
      message: `Subagent '${subagent.id}' is denied by task permission policy`,
      meta: {
        subagentId: subagent.id,
        decision,
      },
    }),
  );
}
