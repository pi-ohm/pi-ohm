import type { TaskExecutionEvent } from "./events";

type ToolCallOutcome = "running" | "success" | "error";
type ToolLifecyclePhase = "start" | "update" | "end success" | "end error";

interface ParsedToolLifecycleLine {
  readonly toolName: string;
  readonly phase: ToolLifecyclePhase;
  readonly payload?: string;
}

export interface TaskTranscriptSections {
  readonly toolCalls: readonly string[];
  readonly narrativeLines: readonly string[];
}

export interface ParseTaskTranscriptSectionsOptions {
  readonly normalizeDetectedToolCalls?: boolean;
}

function formatToolName(toolName: string): string {
  if (toolName.length === 0) return "tool";
  return `${toolName[0]?.toUpperCase() ?? ""}${toolName.slice(1)}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function truncateToolDetail(value: string, maxChars: number = 88): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(maxChars - 1, 1))}…`;
}

function parseToolArgsRecord(argsText: string | undefined): Record<string, unknown> | undefined {
  const text = toTrimmedString(argsText);
  if (!text) return undefined;
  if (!text.startsWith("{")) return undefined;

  try {
    const parsed: unknown = JSON.parse(text);
    if (!isObjectRecord(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function parsePositiveIntegerField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = Reflect.get(record, key);
  if (typeof value !== "number") return undefined;
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function parseToolDetailFromArgsText(
  toolNameInput: string,
  argsText: string | undefined,
): string | undefined {
  const args = parseToolArgsRecord(argsText);
  const toolName = toolNameInput.trim().toLowerCase();

  if (!args) {
    if (toolName === "bash") {
      const fallback = toTrimmedString(argsText);
      if (!fallback) return undefined;
      return truncateToolDetail(fallback);
    }
    return undefined;
  }

  if (toolName === "bash") {
    const command = toTrimmedString(Reflect.get(args, "command"));
    if (!command) return undefined;
    return truncateToolDetail(command);
  }

  if (toolName === "read" || toolName === "write" || toolName === "edit") {
    const path = toTrimmedString(Reflect.get(args, "path"));
    if (!path) return undefined;

    const offset = parsePositiveIntegerField(args, "offset");
    const limit = parsePositiveIntegerField(args, "limit");
    if (offset !== undefined && limit !== undefined) {
      const end = offset + limit - 1;
      return `${path} @${offset}-${end}`;
    }

    if (offset !== undefined) {
      return `${path} @${offset}`;
    }

    return path;
  }

  if (toolName === "grep") {
    const pattern =
      toTrimmedString(Reflect.get(args, "pattern")) ?? toTrimmedString(Reflect.get(args, "query"));
    if (!pattern) return undefined;
    return truncateToolDetail(pattern);
  }

  if (toolName === "glob" || toolName === "find" || toolName === "ls") {
    const pattern =
      toTrimmedString(Reflect.get(args, "pattern")) ??
      toTrimmedString(Reflect.get(args, "path")) ??
      toTrimmedString(Reflect.get(args, "query"));
    if (!pattern) return undefined;
    return truncateToolDetail(pattern);
  }

  return undefined;
}

function parseToolDetailFromStart(
  event: Extract<TaskExecutionEvent, { type: "tool_start" }>,
): string | undefined {
  return parseToolDetailFromArgsText(event.toolName, event.argsText);
}

export function parseToolLifecycleLine(line: string): ParsedToolLifecycleLine | undefined {
  const matched = line.match(
    /^tool_call:\s*(\S+)\s+(start|update|end success|end error)\s*(.*)$/iu,
  );
  if (!matched) return undefined;

  const toolName = matched[1]?.trim();
  const phaseValue = matched[2]?.trim().toLowerCase();
  const payload = toTrimmedString(matched[3]);
  if (!toolName || !phaseValue) return undefined;

  if (
    phaseValue !== "start" &&
    phaseValue !== "update" &&
    phaseValue !== "end success" &&
    phaseValue !== "end error"
  ) {
    return undefined;
  }

  return {
    toolName,
    phase: phaseValue,
    payload,
  };
}

export function toToolRowsFromLifecycleLines(lines: readonly string[]): readonly string[] {
  const calls: Array<{ toolName: string; outcome: ToolCallOutcome; detail?: string }> = [];

  for (const line of lines) {
    const parsed = parseToolLifecycleLine(line);
    if (!parsed) continue;

    if (parsed.phase === "start") {
      calls.push({
        toolName: parsed.toolName,
        outcome: "running",
        detail: parseToolDetailFromArgsText(parsed.toolName, parsed.payload),
      });
      continue;
    }

    const activeIndex = (() => {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const call = calls[index];
        if (!call) continue;
        if (call.toolName !== parsed.toolName) continue;
        if (call.outcome === "running") return index;
      }
      return -1;
    })();

    if (activeIndex < 0) {
      calls.push({
        toolName: parsed.toolName,
        outcome: parsed.phase === "end error" ? "error" : "running",
      });
      continue;
    }

    const call = calls[activeIndex];
    if (!call) continue;

    if (parsed.phase === "end success") {
      call.outcome = "success";
      continue;
    }

    if (parsed.phase === "end error") {
      call.outcome = "error";
      continue;
    }

    if (!call.detail) {
      call.detail = parseToolDetailFromArgsText(parsed.toolName, parsed.payload);
    }
  }

  return calls.map((call) => {
    const marker = call.outcome === "success" ? "✓" : call.outcome === "error" ? "✕" : "○";
    const suffix = call.detail ? ` ${call.detail}` : "";
    return `${marker} ${formatToolName(call.toolName)}${suffix}`;
  });
}

export function toToolRowsFromEvents(events: readonly TaskExecutionEvent[]): readonly string[] {
  const order: string[] = [];
  const calls = new Map<string, { toolName: string; outcome: ToolCallOutcome; detail?: string }>();

  for (const event of events) {
    if (event.type !== "tool_start" && event.type !== "tool_update" && event.type !== "tool_end") {
      continue;
    }

    const existing = calls.get(event.toolCallId);
    if (!existing) {
      order.push(event.toolCallId);
      calls.set(event.toolCallId, {
        toolName: event.toolName,
        outcome:
          event.type === "tool_end" ? (event.status === "error" ? "error" : "success") : "running",
        detail: event.type === "tool_start" ? parseToolDetailFromStart(event) : undefined,
      });
      continue;
    }

    if (event.type === "tool_start") {
      calls.set(event.toolCallId, {
        toolName: existing.toolName,
        outcome: existing.outcome,
        detail: existing.detail ?? parseToolDetailFromStart(event),
      });
      continue;
    }

    if (event.type === "tool_end") {
      calls.set(event.toolCallId, {
        toolName: existing.toolName,
        outcome: event.status === "error" ? "error" : "success",
        detail: existing.detail,
      });
    }
  }

  return order.map((toolCallId) => {
    const call = calls.get(toolCallId);
    if (!call) return "○ Tool";
    const marker = call.outcome === "success" ? "✓" : call.outcome === "error" ? "✕" : "○";
    const suffix = call.detail ? ` ${call.detail}` : "";
    return `${marker} ${formatToolName(call.toolName)}${suffix}`;
  });
}

export function assistantTextFromEvents(events: readonly TaskExecutionEvent[]): string | undefined {
  const deltas = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta);

  if (deltas.length === 0) return undefined;
  const text = deltas.join("").trim();
  if (text.length === 0) return undefined;
  return text;
}

function normalizeTranscriptPrefix(line: string): string {
  const roleTrimmed = line.replace(/^(assistant|user|system)\s*[:>]\s*/iu, "").trim();
  const toolTrimmed = roleTrimmed.replace(/^tool(?:\([^)]+\))?\s*[:>]\s*/iu, "").trim();
  return toolTrimmed;
}

function looksLikeToolCallLine(line: string): boolean {
  if (/^[✓✕○•…⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+/u.test(line)) {
    return true;
  }

  if (/^(Read|Glob|Grep|Find|Search|Bash|Edit|Write|Ls)\b/u.test(line)) {
    return true;
  }

  if (/^tool_call\s*[:>]/iu.test(line)) {
    return true;
  }

  if (/^\$\s+.+/u.test(line)) {
    return true;
  }

  return false;
}

function normalizeToolCallLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length === 0) return "✓ (empty tool line)";
  if (/^[✓✕○•…⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+/u.test(trimmed)) {
    return trimmed;
  }
  return `✓ ${trimmed}`;
}

export function parseTaskTranscriptSections(
  output: string,
  options: ParseTaskTranscriptSectionsOptions = {},
): TaskTranscriptSections {
  const normalizedLines = output
    .split(/\r?\n/u)
    .map((line) => normalizeTranscriptPrefix(line.trim()))
    .filter((line) => line.length > 0);

  if (normalizedLines.length === 0) {
    return {
      toolCalls: [],
      narrativeLines: [],
    };
  }

  const normalizeDetectedToolCalls = options.normalizeDetectedToolCalls ?? false;
  const toolCalls: string[] = [];
  const lifecycleToolLines: string[] = [];
  const narrative: string[] = [];

  for (const line of normalizedLines) {
    if (parseToolLifecycleLine(line)) {
      lifecycleToolLines.push(line);
      continue;
    }

    if (looksLikeToolCallLine(line)) {
      toolCalls.push(normalizeDetectedToolCalls ? normalizeToolCallLine(line) : line);
      continue;
    }

    narrative.push(line);
  }

  const lifecycleRows = toToolRowsFromLifecycleLines(lifecycleToolLines);
  return {
    toolCalls: lifecycleRows.length > 0 ? [...lifecycleRows, ...toolCalls] : toolCalls,
    narrativeLines: narrative,
  };
}
