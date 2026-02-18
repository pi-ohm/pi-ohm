import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import type { OhmSubagentDefinition } from "../catalog";
import { OHM_SUBAGENT_CATALOG } from "../catalog";
import { getSubagentInvocationMode } from "../extension";
import {
  createDefaultTaskToolDependencies,
  formatTaskToolResult,
  runTaskToolMvp,
  type TaskToolDependencies,
  type TaskToolResultDetails,
} from "./task";

const PrimaryToolParametersSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String({ minLength: 1 })),
    async: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type PrimaryToolParameters = Static<typeof PrimaryToolParametersSchema>;

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
  const lines: string[] = [subagent.summary, "", "When to use:"];
  for (const when of subagent.whenToUse) {
    lines.push(`- ${when}`);
  }

  lines.push(
    "",
    `Invocation mode: ${getSubagentInvocationMode(subagent.primary)}`,
    `Task route still available via: task op=start subagent_type=${subagent.id}`,
  );

  return lines.join("\n");
}

function normalizePrimaryPrompt(
  input: PrimaryToolParameters,
  subagent: OhmSubagentDefinition,
): {
  readonly description: string;
  readonly prompt: string;
  readonly async: boolean | undefined;
} {
  const prompt = input.prompt.trim();
  const description =
    input.description && input.description.trim().length > 0
      ? input.description.trim()
      : `${subagent.name} direct tool request`;

  return {
    description,
    prompt,
    async: input.async,
  };
}

function toPrimaryToolCallText(subagentId: string, params: PrimaryToolParameters): string {
  const suffix = params.async ? " async" : "";
  if (params.description && params.description.trim().length > 0) {
    return `${subagentId} · ${params.description.trim()}${suffix}`;
  }

  return `${subagentId}${suffix}`;
}

function toResultText(result: AgentToolResult<unknown>): string {
  const textBlocks = result.content.filter(
    (part): part is { readonly type: "text"; readonly text: string } => part.type === "text",
  );

  const joined = textBlocks.map((part) => part.text).join("\n\n");
  if (joined.length > 0) return joined;

  if (isTaskToolResultDetails(result.details)) {
    return formatTaskToolResult(result.details, false);
  }

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
  readonly params: PrimaryToolParameters;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
  readonly deps: TaskToolDependencies;
}): Promise<AgentToolResult<TaskToolResultDetails>> {
  const normalized = normalizePrimaryPrompt(input.params, input.subagent);

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
      parameters: PrimaryToolParametersSchema,
      execute: async (_toolCallId, params, signal, onUpdate, ctx) => {
        return runPrimarySubagentTool({
          subagent,
          params,
          cwd: ctx.cwd,
          signal,
          onUpdate,
          deps,
        });
      },
      renderCall: (args, _theme) => {
        const params: PrimaryToolParameters = {
          prompt: typeof args.prompt === "string" ? args.prompt : "",
          description: typeof args.description === "string" ? args.description : undefined,
          async: args.async === true,
        };
        return new Text(toPrimaryToolCallText(subagent.id, params), 0, 0);
      },
      renderResult: (result, _options, _theme) => {
        return new Text(toResultText(result), 0, 0);
      },
    });

    registeredTools.push(toolName);
  }

  return {
    registeredTools,
    diagnostics,
  };
}
