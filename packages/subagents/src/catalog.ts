export type OhmSubagentId = "librarian" | "oracle" | "finder" | "task" | "painter";

export interface OhmSubagentDefinition {
  id: OhmSubagentId;
  name: string;
  summary: string;
  whenToUse: string[];
  scaffoldPrompt: string;
  requiresPackage?: string;
}

export const OHM_SUBAGENT_CATALOG: readonly OhmSubagentDefinition[] = [
  {
    id: "librarian",
    name: "Librarian",
    summary:
      "Multi-repo codebase understanding subagent (GitHub/Bitbucket architecture analysis).",
    whenToUse: [
      "Understand architecture across multiple repositories",
      "Build implementation maps before migration/refactor",
      "Trace ownership boundaries across services",
    ],
    scaffoldPrompt:
      "Analyze this codebase (and linked repos if provided). Build an architecture map: boundaries, key modules, integration points, and risky coupling.",
  },
  {
    id: "oracle",
    name: "Oracle",
    summary:
      "Reasoning-heavy advisor for code review, architecture feedback, complex debugging, and planning.",
    whenToUse: [
      "Get second-opinion architecture critique",
      "Review risky design decisions before implementation",
      "Debug ambiguous failures with hypothesis ranking",
    ],
    scaffoldPrompt:
      "Act as a critical reviewer. Challenge assumptions, rank risks, and provide a concrete implementation plan with trade-offs.",
  },
  {
    id: "finder",
    name: "Finder",
    summary: "Concept/behavior-based search subagent for multi-step codebase discovery.",
    whenToUse: [
      "Find all call sites for a behavior, not just symbol references",
      "Map data flow across modules",
      "Locate implicit coupling and duplicated logic",
    ],
    scaffoldPrompt:
      "Search this codebase for all implementations and call paths related to the requested behavior. Return files, rationale, and confidence.",
  },
  {
    id: "task",
    name: "Task",
    summary: "Independent execution subagent for parallelizable tasks with isolated tool context.",
    whenToUse: [
      "Parallelize work across unrelated app areas",
      "Delegate focused implementation tasks",
      "Run isolated experiments without polluting main context",
    ],
    scaffoldPrompt:
      "Execute this focused implementation task independently. Return a concise summary of changes, validation, and follow-up risks.",
  },
  {
    id: "painter",
    name: "Painter",
    summary: "Image generation/editing subagent used only on explicit request.",
    whenToUse: [
      "Generate concept/mock images",
      "Edit existing images based on prompt instructions",
      "Produce visual assets when user explicitly asks for image output",
    ],
    scaffoldPrompt:
      "Generate or edit an image per user request. Confirm intent first, then return prompt + provider/model metadata with result notes.",
    requiresPackage: "@pi-phm/painter",
  },
] as const;

export function getSubagentById(id: string): OhmSubagentDefinition | undefined {
  const needle = id.trim().toLowerCase();
  return OHM_SUBAGENT_CATALOG.find((agent) => agent.id === needle);
}
