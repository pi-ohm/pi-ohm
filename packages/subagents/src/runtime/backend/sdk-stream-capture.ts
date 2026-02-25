import { Result } from "better-result";
import { parseTaskExecutionEventFromSdk, type TaskExecutionEvent } from "../events";
import type { PiSdkStreamCaptureResult, PiSdkStreamCaptureState } from "./types";

function normalizeRunnerOutput(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length > 0) return trimmed;
  return "(no output)";
}

function formatToolLifecycleLine(input: {
  readonly toolName: string;
  readonly phase: "start" | "update" | "end success" | "end error";
  readonly payload: string | undefined;
}): string {
  const base = `tool_call: ${input.toolName} ${input.phase}`;
  if (!input.payload) return base;
  return `${base} ${input.payload}`;
}

export function createPiSdkStreamCaptureState(): PiSdkStreamCaptureState {
  return {
    assistantChunks: [],
    toolLines: [],
    events: [],
    sawAgentEnd: false,
    capturedEventCount: 0,
  };
}

export function applyPiSdkSessionEvent(
  state: PiSdkStreamCaptureState,
  event: unknown,
): TaskExecutionEvent | undefined {
  const parsed = parseTaskExecutionEventFromSdk(event);
  if (Result.isError(parsed)) return undefined;
  if (!parsed.value) return undefined;

  state.capturedEventCount += 1;
  state.events.push(parsed.value);

  if (parsed.value.type === "assistant_text_delta") {
    state.assistantChunks.push(parsed.value.delta);
    return parsed.value;
  }

  if (parsed.value.type === "tool_start") {
    state.toolLines.push(
      formatToolLifecycleLine({
        toolName: parsed.value.toolName,
        phase: "start",
        payload: parsed.value.argsText,
      }),
    );
    return parsed.value;
  }

  if (parsed.value.type === "tool_update") {
    state.toolLines.push(
      formatToolLifecycleLine({
        toolName: parsed.value.toolName,
        phase: "update",
        payload: parsed.value.partialText,
      }),
    );
    return parsed.value;
  }

  if (parsed.value.type === "tool_end") {
    state.toolLines.push(
      formatToolLifecycleLine({
        toolName: parsed.value.toolName,
        phase: parsed.value.status === "error" ? "end error" : "end success",
        payload: parsed.value.resultText,
      }),
    );
    return parsed.value;
  }

  if (parsed.value.type === "task_terminal") {
    state.sawAgentEnd = true;
    return parsed.value;
  }

  return parsed.value;
}

export function finalizePiSdkStreamCapture(
  state: PiSdkStreamCaptureState,
): PiSdkStreamCaptureResult {
  const assistantText = normalizeRunnerOutput(state.assistantChunks.join(""));
  const parts: string[] = [...state.toolLines];

  if (assistantText !== "(no output)") {
    parts.push(assistantText);
  }

  return {
    output: parts.length > 0 ? parts.join("\n").trim() : "(no output)",
    events: [...state.events],
    sawAgentEnd: state.sawAgentEnd,
    capturedEventCount: state.capturedEventCount,
  };
}

export type { PiSdkStreamCaptureResult, PiSdkStreamCaptureState } from "./types";
