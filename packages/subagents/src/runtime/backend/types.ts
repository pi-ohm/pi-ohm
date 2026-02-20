import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { OhmRuntimeConfig } from "@pi-ohm/config";
import type { OhmSubagentDefinition } from "../../catalog";
import type { SubagentRuntimeError, SubagentResult } from "../../errors";
import type { TaskExecutionEvent } from "../events";
import type {
  SubagentPromptProfile,
  SubagentPromptProfileReason,
  SubagentPromptProfileSource,
} from "./system-prompts";

export interface TaskBackendStartInput {
  readonly taskId: string;
  readonly subagent: OhmSubagentDefinition;
  readonly description: string;
  readonly prompt: string;
  readonly config: OhmRuntimeConfig;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onEvent?: (event: TaskExecutionEvent) => void;
  readonly onObservability?: (observability: TaskBackendObservability) => void;
}

export interface TaskBackendStartOutput {
  readonly summary: string;
  readonly output: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
  readonly promptProfile?: SubagentPromptProfile;
  readonly promptProfileSource?: SubagentPromptProfileSource;
  readonly promptProfileReason?: SubagentPromptProfileReason;
  readonly events?: readonly TaskExecutionEvent[];
}

export interface TaskBackendSendInput {
  readonly taskId: string;
  readonly subagent: OhmSubagentDefinition;
  readonly description: string;
  readonly initialPrompt: string;
  readonly followUpPrompts: readonly string[];
  readonly prompt: string;
  readonly config: OhmRuntimeConfig;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onEvent?: (event: TaskExecutionEvent) => void;
  readonly onObservability?: (observability: TaskBackendObservability) => void;
}

export interface TaskBackendSendOutput {
  readonly summary: string;
  readonly output: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
  readonly promptProfile?: SubagentPromptProfile;
  readonly promptProfileSource?: SubagentPromptProfileSource;
  readonly promptProfileReason?: SubagentPromptProfileReason;
  readonly events?: readonly TaskExecutionEvent[];
}

export interface TaskExecutionBackend {
  readonly id: string;
  resolveBackendId?(config: OhmRuntimeConfig): string;
  executeStart(
    input: TaskBackendStartInput,
  ): Promise<SubagentResult<TaskBackendStartOutput, SubagentRuntimeError>>;
  executeSend(
    input: TaskBackendSendInput,
  ): Promise<SubagentResult<TaskBackendSendOutput, SubagentRuntimeError>>;
}

export interface PiCliRunnerInput {
  readonly cwd: string;
  readonly prompt: string;
  readonly modelPattern?: string;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
}

export interface PiCliRunnerResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
}

export type PiCliRunner = (input: PiCliRunnerInput) => Promise<PiCliRunnerResult>;

export interface PiSdkRunnerInput {
  readonly cwd: string;
  readonly prompt: string;
  readonly modelPattern?: string;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly onEvent?: (event: TaskExecutionEvent) => void;
  readonly onObservability?: (observability: TaskBackendObservability) => void;
}

export interface TaskBackendObservability {
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
  readonly promptProfile?: SubagentPromptProfile;
  readonly promptProfileSource?: SubagentPromptProfileSource;
  readonly promptProfileReason?: SubagentPromptProfileReason;
}

export interface PiSdkRunnerResult {
  readonly output: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly promptProfile?: SubagentPromptProfile;
  readonly promptProfileSource?: SubagentPromptProfileSource;
  readonly promptProfileReason?: SubagentPromptProfileReason;
  readonly events: readonly TaskExecutionEvent[];
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly error?: string;
}

export type PiSdkRunner = (input: PiSdkRunnerInput) => Promise<PiSdkRunnerResult>;

export interface PiSdkStreamCaptureState {
  assistantChunks: string[];
  toolLines: string[];
  events: TaskExecutionEvent[];
  sawAgentEnd: boolean;
  capturedEventCount: number;
}

export interface PiSdkStreamCaptureResult {
  readonly output: string;
  readonly events: readonly TaskExecutionEvent[];
  readonly sawAgentEnd: boolean;
  readonly capturedEventCount: number;
}

export interface ParsedSubagentModelSelection {
  readonly provider: string;
  readonly modelId: string;
  readonly thinkingLevel?: ThinkingLevel;
}

export type ParseSubagentModelSelectionResult =
  | {
      readonly ok: true;
      readonly value: ParsedSubagentModelSelection;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid_format" | "invalid_thinking_level" | "model_not_found";
      readonly message: string;
    };
