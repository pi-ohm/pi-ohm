import {
  defineTool,
  type AgentToolResult,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Result } from "better-result";
import type { GoalRuntime } from "./runtime";

const EmptyArgsSchema = Type.Object({}, { additionalProperties: false });
const CreateGoalArgsSchema = Type.Object(
  {
    objective: Type.String({ minLength: 1 }),
    token_budget: Type.Optional(Type.Number({ minimum: 1 })),
  },
  { additionalProperties: false },
);
const UpdateGoalArgsSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("complete"), Type.Literal("blocked")]),
    note: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

type CreateGoalArgs = Static<typeof CreateGoalArgsSchema>;
type UpdateGoalArgs = Static<typeof UpdateGoalArgsSchema>;

function toolOk(value: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

function toolError(message: string): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    details: { error: message },
  };
}

async function getGoal(
  runtime: GoalRuntime,
  ctx: ExtensionContext,
): Promise<AgentToolResult<unknown>> {
  const goal = await runtime.getGoal(ctx);
  if (Result.isError(goal)) return toolError(goal.error.message);
  return toolOk({ goal: goal.value ?? null });
}

async function createGoal(
  runtime: GoalRuntime,
  params: CreateGoalArgs,
  ctx: ExtensionContext,
): Promise<AgentToolResult<unknown>> {
  const goal = await runtime.createModelGoal(ctx, {
    objective: params.objective,
    tokenBudget: params.token_budget,
  });
  if (Result.isError(goal)) return toolError(goal.error.message);
  return toolOk({ goal: goal.value });
}

async function updateGoal(
  runtime: GoalRuntime,
  params: UpdateGoalArgs,
  ctx: ExtensionContext,
): Promise<AgentToolResult<unknown>> {
  const goal = await runtime.updateModelStatus(ctx, params.status, params.note);
  if (Result.isError(goal)) return toolError(goal.error.message);
  return toolOk({ goal: goal.value });
}

export function createGoalTools(runtime: GoalRuntime): readonly ToolDefinition[] {
  return [
    defineTool({
      name: "get_goal",
      label: "Get Goal",
      description:
        "Read the current tracked goal for this session, including status, time, and token usage.",
      promptSnippet: "Use get_goal to inspect the active tracked session goal.",
      promptGuidelines: [
        "Use get_goal before deciding whether a tracked goal is complete or blocked.",
        "Do not invent goal status. Read it from get_goal when uncertain.",
      ],
      parameters: EmptyArgsSchema,
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        return getGoal(runtime, ctx);
      },
    }),
    defineTool({
      name: "create_goal",
      label: "Create Goal",
      description:
        "Create a tracked goal only when the user, system, or developer explicitly requests goal tracking.",
      promptSnippet: "Use create_goal only when asked to track or pursue a persistent goal.",
      promptGuidelines: [
        "Do not call create_goal unless goal tracking was explicitly requested.",
        "Do not replace an unfinished goal. Ask the user instead.",
      ],
      parameters: CreateGoalArgsSchema,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        return createGoal(runtime, params, ctx);
      },
    }),
    defineTool({
      name: "update_goal",
      label: "Update Goal",
      description:
        "Mark the current goal complete or blocked. The model cannot pause, resume, clear, or budget-limit goals.",
      promptSnippet: "Use update_goal to mark the tracked goal complete or blocked.",
      promptGuidelines: [
        "Only mark a goal complete when the objective is fully satisfied.",
        "Only mark a goal blocked when progress requires user input or an unavailable external dependency.",
      ],
      parameters: UpdateGoalArgsSchema,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        return updateGoal(runtime, params, ctx);
      },
    }),
  ];
}
