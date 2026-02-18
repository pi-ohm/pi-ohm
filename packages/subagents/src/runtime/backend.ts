import { Result } from "better-result";
import type { OhmRuntimeConfig } from "@pi-ohm/config";
import type { OhmSubagentDefinition } from "../catalog";
import { SubagentRuntimeError, type SubagentResult } from "../errors";

export interface TaskBackendStartInput {
  readonly taskId: string;
  readonly subagent: OhmSubagentDefinition;
  readonly description: string;
  readonly prompt: string;
  readonly config: OhmRuntimeConfig;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
}

export interface TaskBackendStartOutput {
  readonly summary: string;
  readonly output: string;
}

export interface TaskExecutionBackend {
  readonly id: string;
  executeStart(
    input: TaskBackendStartInput,
  ): Promise<SubagentResult<TaskBackendStartOutput, SubagentRuntimeError>>;
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, maxLength - 1) + "…";
}

export class ScaffoldTaskExecutionBackend implements TaskExecutionBackend {
  readonly id = "scaffold";

  async executeStart(
    input: TaskBackendStartInput,
  ): Promise<SubagentResult<TaskBackendStartOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(
        new SubagentRuntimeError({
          code: "task_aborted",
          stage: "execute_start",
          message: `Task ${input.taskId} was aborted before execution`,
          meta: { taskId: input.taskId },
        }),
      );
    }

    const summary = `${input.subagent.name}: ${truncate(input.description, 72)}`;
    const output = [
      `subagent: ${input.subagent.id}`,
      `description: ${input.description}`,
      `prompt: ${truncate(input.prompt, 220)}`,
      `backend: ${this.id}`,
      `cwd: ${input.cwd}`,
      `mode: ${input.config.defaultMode}`,
    ].join("\n");

    return Result.ok({ summary, output });
  }
}

export function createDefaultTaskExecutionBackend(): TaskExecutionBackend {
  return new ScaffoldTaskExecutionBackend();
}
