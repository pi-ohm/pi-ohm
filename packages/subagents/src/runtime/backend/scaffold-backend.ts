import { Result } from "better-result";
import { SubagentRuntimeError, type SubagentResult } from "../../errors";
import { truncate } from "./prompts";
import type {
  TaskBackendSendInput,
  TaskBackendSendOutput,
  TaskBackendStartInput,
  TaskBackendStartOutput,
  TaskExecutionBackend,
} from "./types";

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
          message: "Task execution aborted before start",
        }),
      );
    }

    const summary = `${input.subagent.name}: ${truncate(input.description, 72)}`;
    const output = [
      `subagent: ${input.subagent.id}`,
      `backend: ${this.id}`,
      `mode: ${input.config.defaultMode}`,
      `description: ${input.description}`,
      `prompt: ${input.prompt}`,
    ].join("\n");

    return Result.ok({
      summary,
      output,
      provider: "unavailable",
      model: "unavailable",
      runtime: this.id,
      route: this.id,
    });
  }

  async executeSend(
    input: TaskBackendSendInput,
  ): Promise<SubagentResult<TaskBackendSendOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(
        new SubagentRuntimeError({
          code: "task_aborted",
          stage: "execute_send",
          message: "Task execution aborted before send",
        }),
      );
    }

    const summary = `${input.subagent.name} follow-up: ${truncate(input.prompt, 72)}`;
    const output = [
      `subagent: ${input.subagent.id}`,
      `backend: ${this.id}`,
      `mode: ${input.config.defaultMode}`,
      `description: ${input.description}`,
      `initial_prompt: ${input.initialPrompt}`,
      `follow_up_prompt: ${input.prompt}`,
      `follow_up_count: ${input.followUpPrompts.length}`,
    ].join("\n");

    return Result.ok({
      summary,
      output,
      provider: "unavailable",
      model: "unavailable",
      runtime: this.id,
      route: this.id,
    });
  }
}
