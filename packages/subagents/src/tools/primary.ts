import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import type { OhmSubagentDefinition } from "../catalog";
import { getSubagentDescription, OHM_SUBAGENT_CATALOG } from "../catalog";
import { getSubagentInvocationMode } from "../extension";
import type { TaskToolDependencies, TaskToolResultDetails } from "./task/contracts";
import { createDefaultTaskToolDependencies } from "./task/defaults";
import { runTaskToolMvp } from "./task/operations";
import { formatTaskToolResult } from "./task/render";

const PrimaryControlFieldsSchema = {
  description: Type.Optional(Type.String({ minLength: 1 })),
  async: Type.Optional(Type.Boolean()),
} as const;

const PrimaryToolLegacyParametersSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1 }),
    ...PrimaryControlFieldsSchema,
  },
  { additionalProperties: false },
);

const PrimaryToolLibrarianParametersSchema = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    context: Type.Optional(Type.String({ minLength: 1 })),
    prompt: Type.Optional(Type.String({ minLength: 1 })),
    ...PrimaryControlFieldsSchema,
  },
  { additionalProperties: false },
);

const PrimaryToolOracleParametersSchema = Type.Object(
  {
    task: Type.String({ minLength: 1 }),
    context: Type.Optional(Type.String({ minLength: 1 })),
    files: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
    prompt: Type.Optional(Type.String({ minLength: 1 })),
    ...PrimaryControlFieldsSchema,
  },
  { additionalProperties: false },
);

const PrimaryToolFinderParametersSchema = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    prompt: Type.Optional(Type.String({ minLength: 1 })),
    ...PrimaryControlFieldsSchema,
  },
  { additionalProperties: false },
);

const PrimaryToolDefaultParametersSchema = PrimaryToolLegacyParametersSchema;

export const PrimaryToolParametersSchemasBySubagent = {
  librarian: PrimaryToolLibrarianParametersSchema,
  oracle: PrimaryToolOracleParametersSchema,
  finder: PrimaryToolFinderParametersSchema,
  default: PrimaryToolDefaultParametersSchema,
} as const;

export type PrimaryToolLegacyParameters = Static<typeof PrimaryToolLegacyParametersSchema>;
export type PrimaryToolLibrarianParameters = Static<typeof PrimaryToolLibrarianParametersSchema>;
export type PrimaryToolOracleParameters = Static<typeof PrimaryToolOracleParametersSchema>;
export type PrimaryToolFinderParameters = Static<typeof PrimaryToolFinderParametersSchema>;
export type PrimaryToolParameters =
  | PrimaryToolLegacyParameters
  | PrimaryToolLibrarianParameters
  | PrimaryToolOracleParameters
  | PrimaryToolFinderParameters;

export interface PrimarySubagentRegistrationResult {
  readonly registeredTools: readonly string[];
  readonly diagnostics: readonly string[];
}

export interface PrimarySubagentToolRegistrationOptions {
  readonly taskDeps?: TaskToolDependencies;
  readonly catalog?: readonly OhmSubagentDefinition[];
  readonly reservedToolNames?: readonly string[];
  readonly onDiagnostic?: (message: string) => void;
}

function buildPrimaryToolDescription(subagent: OhmSubagentDefinition): string {
  const lines: string[] = [getSubagentDescription(subagent), "", "When to use:"];
  for (const when of subagent.whenToUse) {
    lines.push(`- ${when}`);
  }

  lines.push(
    "",
    `Invocation mode: ${getSubagentInvocationMode(subagent.primary)}`,
    `Task route still available via: task op=start subagent_type=${subagent.id}`,
  );

  if (subagent.id === "librarian") {
    lines.push("", "Input: query (required), context (optional)");
  } else if (subagent.id === "oracle") {
    lines.push("", "Input: task (required), context (optional), files[] (optional)");
  } else if (subagent.id === "finder") {
    lines.push("", "Input: query (required)");
  } else {
    lines.push("", "Input: prompt (required)");
  }

  return lines.join("\n");
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

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "boolean") return undefined;
  return value;
}

function toStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];

  const values: string[] = [];
  for (const item of value) {
    const text = toTrimmedString(item);
    if (!text) continue;
    values.push(text);
  }

  return values;
}

function joinPromptSections(sections: readonly string[]): string {
  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

interface PrimaryPromptNormalizationSuccess {
  readonly ok: true;
  readonly description: string;
  readonly prompt: string;
  readonly async: boolean | undefined;
}

interface PrimaryPromptNormalizationFailure {
  readonly ok: false;
  readonly message: string;
}

type PrimaryPromptNormalization =
  | PrimaryPromptNormalizationSuccess
  | PrimaryPromptNormalizationFailure;

function normalizePrimaryPrompt(
  input: unknown,
  subagent: OhmSubagentDefinition,
): PrimaryPromptNormalization {
  if (!isObjectRecord(input)) {
    return {
      ok: false,
      message: `Primary tool payload for '${subagent.id}' must be an object`,
    };
  }

  const description =
    toTrimmedString(Reflect.get(input, "description")) ?? `${subagent.name} direct tool request`;
  const asyncFlag = toBoolean(Reflect.get(input, "async"));
  const legacyPrompt = toTrimmedString(Reflect.get(input, "prompt"));

  if (subagent.id === "librarian") {
    const query = toTrimmedString(Reflect.get(input, "query")) ?? legacyPrompt;
    if (!query) {
      return {
        ok: false,
        message: "librarian requires 'query' (or legacy 'prompt')",
      };
    }

    const context = toTrimmedString(Reflect.get(input, "context"));
    const prompt = joinPromptSections([query, context ? `Context:\n${context}` : ""]);
    return {
      ok: true,
      description,
      prompt,
      async: asyncFlag,
    };
  }

  if (subagent.id === "oracle") {
    const task = toTrimmedString(Reflect.get(input, "task")) ?? legacyPrompt;
    if (!task) {
      return {
        ok: false,
        message: "oracle requires 'task' (or legacy 'prompt')",
      };
    }

    const context = toTrimmedString(Reflect.get(input, "context"));
    const files = toStringList(Reflect.get(input, "files"));
    const filesBlock =
      files.length > 0
        ? ["Files:", ...files.map((file) => `- ${file}`), "Inspect these paths first."].join("\n")
        : "";

    const prompt = joinPromptSections([task, context ? `Context:\n${context}` : "", filesBlock]);

    return {
      ok: true,
      description,
      prompt,
      async: asyncFlag,
    };
  }

  if (subagent.id === "finder") {
    const query = toTrimmedString(Reflect.get(input, "query")) ?? legacyPrompt;
    if (!query) {
      return {
        ok: false,
        message: "finder requires 'query' (or legacy 'prompt')",
      };
    }

    return {
      ok: true,
      description,
      prompt: query,
      async: asyncFlag,
    };
  }

  if (!legacyPrompt) {
    return {
      ok: false,
      message: `primary tool '${subagent.id}' requires 'prompt'`,
    };
  }

  return {
    ok: true,
    description,
    prompt: legacyPrompt,
    async: asyncFlag,
  };
}

function toValidationFailure(input: {
  readonly subagent: OhmSubagentDefinition;
  readonly message: string;
}): AgentToolResult<TaskToolResultDetails> {
  const details: TaskToolResultDetails = {
    contract_version: "task.v1",
    op: "start",
    status: "failed",
    summary: input.message,
    backend: "task",
    provider: "unavailable",
    model: "unavailable",
    runtime: "task",
    route: "task",
    subagent_type: input.subagent.id,
    invocation: getSubagentInvocationMode(input.subagent.primary),
    error_code: "invalid_primary_tool_payload",
    error_category: "validation",
    error_message: input.message,
  };

  return {
    content: [{ type: "text", text: formatTaskToolResult(details, false) }],
    details,
  };
}

function resolvePrimaryToolParameterSchema(subagent: OhmSubagentDefinition) {
  if (subagent.id === "librarian") return PrimaryToolParametersSchemasBySubagent.librarian;
  if (subagent.id === "oracle") return PrimaryToolParametersSchemasBySubagent.oracle;
  if (subagent.id === "finder") return PrimaryToolParametersSchemasBySubagent.finder;
  return PrimaryToolParametersSchemasBySubagent.default;
}

function toPrimaryToolCallText(subagent: OhmSubagentDefinition, params: unknown): string {
  const normalized = normalizePrimaryPrompt(params, subagent);
  if (!normalized.ok) return subagent.id;

  return `${subagent.id} · ${normalized.description}`;
}

function toResultText(result: AgentToolResult<unknown>, expanded: boolean): string {
  if (isTaskToolResultDetails(result.details)) {
    return formatTaskToolResult(result.details, expanded);
  }

  const textBlocks = result.content.filter(
    (part): part is { readonly type: "text"; readonly text: string } => part.type === "text",
  );

  const joined = textBlocks.map((part) => part.text).join("\n\n");
  if (joined.length > 0) return joined;

  return "primary subagent tool result unavailable";
}

function isTaskToolResultDetails(value: unknown): value is TaskToolResultDetails {
  if (typeof value !== "object" || value === null) return false;

  if (!("op" in value) || typeof value.op !== "string") return false;
  if (!("status" in value) || typeof value.status !== "string") return false;
  if (!("summary" in value) || typeof value.summary !== "string") return false;
  if (!("backend" in value) || typeof value.backend !== "string") return false;

  return true;
}

export async function runPrimarySubagentTool(input: {
  readonly subagent: OhmSubagentDefinition;
  readonly params: unknown;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
  readonly hasUI: boolean;
  readonly ui:
    | {
        setStatus(key: string, text: string | undefined): void;
        setWidget(
          key: string,
          content: string[] | undefined,
          options?: { readonly placement?: "aboveEditor" | "belowEditor" },
        ): void;
      }
    | undefined;
  readonly deps: TaskToolDependencies;
}): Promise<AgentToolResult<TaskToolResultDetails>> {
  const normalized = normalizePrimaryPrompt(input.params, input.subagent);
  if (!normalized.ok) {
    return toValidationFailure({
      subagent: input.subagent,
      message: normalized.message,
    });
  }

  return runTaskToolMvp({
    params: {
      op: "start",
      subagent_type: input.subagent.id,
      description: normalized.description,
      prompt: normalized.prompt,
      async: normalized.async,
    },
    cwd: input.cwd,
    signal: input.signal,
    onUpdate: input.onUpdate,
    hasUI: input.hasUI,
    ui: input.ui,
    deps: input.deps,
  });
}

export function registerPrimarySubagentTools(
  pi: Pick<ExtensionAPI, "registerTool">,
  options: PrimarySubagentToolRegistrationOptions = {},
): PrimarySubagentRegistrationResult {
  const deps = options.taskDeps ?? createDefaultTaskToolDependencies();
  const catalog = options.catalog ?? OHM_SUBAGENT_CATALOG;
  const reservedNames = new Set(options.reservedToolNames ?? ["task"]);
  const registeredTools: string[] = [];
  const diagnostics: string[] = [];

  const addDiagnostic = (message: string) => {
    diagnostics.push(message);
    options.onDiagnostic?.(message);
  };

  for (const subagent of catalog) {
    if (subagent.primary !== true) continue;

    const toolName = subagent.id;

    if (reservedNames.has(toolName)) {
      addDiagnostic(
        `Skipping primary tool '${toolName}' due to naming collision with reserved tool namespace`,
      );
      continue;
    }

    reservedNames.add(toolName);

    pi.registerTool({
      name: toolName,
      label: subagent.name,
      description: buildPrimaryToolDescription(subagent),
      parameters: resolvePrimaryToolParameterSchema(subagent),
      execute: async (_toolCallId, params, signal, onUpdate, ctx) => {
        return runPrimarySubagentTool({
          subagent,
          params,
          cwd: ctx.cwd,
          signal,
          onUpdate,
          hasUI: ctx.hasUI,
          ui: ctx.hasUI ? ctx.ui : undefined,
          deps,
        });
      },
      renderCall: (args, _theme) => {
        return new Text(toPrimaryToolCallText(subagent, args), 0, 0);
      },
      renderResult: (result, options, _theme) => {
        return new Text(toResultText(result, options.expanded), 0, 0);
      },
    });

    registeredTools.push(toolName);
  }

  return {
    registeredTools,
    diagnostics,
  };
}
