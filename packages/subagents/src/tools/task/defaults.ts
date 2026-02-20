import { homedir } from "node:os";
import { join } from "node:path";
import { loadOhmRuntimeConfig } from "@pi-ohm/config";
import { getSubagentById, OHM_SUBAGENT_CATALOG } from "../../catalog";
import { createDefaultTaskExecutionBackend } from "../../runtime/backend/index";
import { createJsonTaskRuntimePersistence } from "../../runtime/tasks/persistence";
import { createInMemoryTaskRuntimeStore } from "../../runtime/tasks/store";
import type { TaskToolDependencies } from "./contracts";

function parsePositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseNonNegativeIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return undefined;
  return parsed;
}

function resolveTaskRetentionMs(): number | undefined {
  return parsePositiveIntegerEnv("OHM_SUBAGENTS_TASK_RETENTION_MS");
}

function resolveTaskMaxEventsPerTask(): number | undefined {
  return parsePositiveIntegerEnv("OHM_SUBAGENTS_TASK_MAX_EVENTS");
}

function resolveTaskMaxEntries(): number | undefined {
  return parsePositiveIntegerEnv("OHM_SUBAGENTS_TASK_MAX_ENTRIES");
}

function resolveTaskMaxExpiredEntries(): number | undefined {
  return parsePositiveIntegerEnv("OHM_SUBAGENTS_TASK_MAX_EXPIRED_ENTRIES");
}

function resolveTaskPersistenceDebounceMs(): number {
  const fromEnv = parseNonNegativeIntegerEnv("OHM_SUBAGENTS_TASK_PERSIST_DEBOUNCE_MS");
  if (fromEnv !== undefined) return fromEnv;
  return 90;
}

export function resolveOnUpdateThrottleMs(): number {
  const fromEnv = parsePositiveIntegerEnv("OHM_SUBAGENTS_ONUPDATE_THROTTLE_MS");
  if (fromEnv !== undefined) return fromEnv;
  return 120;
}

function resolveDefaultTaskPersistencePath(): string {
  const baseDir =
    process.env.PI_CONFIG_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    process.env.PI_AGENT_DIR ??
    join(homedir(), ".pi", "agent");

  return join(baseDir, "ohm.subagents.tasks.json");
}

const DEFAULT_TASK_STORE = createInMemoryTaskRuntimeStore({
  persistence: createJsonTaskRuntimePersistence(resolveDefaultTaskPersistencePath()),
  retentionMs: resolveTaskRetentionMs(),
  maxEventsPerTask: resolveTaskMaxEventsPerTask(),
  maxTasks: resolveTaskMaxEntries(),
  maxExpiredTasks: resolveTaskMaxExpiredEntries(),
  persistenceDebounceMs: resolveTaskPersistenceDebounceMs(),
});

let taskSequence = 0;

export function createTaskId(nowEpochMs: number = Date.now()): string {
  taskSequence += 1;
  const sequence = taskSequence.toString().padStart(4, "0");
  return `task_${nowEpochMs}_${sequence}`;
}

export function createDefaultTaskToolDependencies(): TaskToolDependencies {
  return {
    loadConfig: loadOhmRuntimeConfig,
    backend: createDefaultTaskExecutionBackend(),
    findSubagentById: getSubagentById,
    subagents: OHM_SUBAGENT_CATALOG,
    createTaskId,
    taskStore: DEFAULT_TASK_STORE,
  };
}
