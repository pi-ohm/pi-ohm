export type OhmSubagentId = "librarian" | "oracle" | "finder" | "task" | "painter";

export interface OhmSubagentDefinition {
  id: OhmSubagentId;
  name: string;
  summary: string;
  /**
   * When true, this profile should be exposed as a directly invokable primary tool
   * instead of requiring delegated Task-style invocation.
   */
  primary?: boolean;
  whenToUse: string[];
  scaffoldPrompt: string;
  requiresPackage?: string;
}

// should probably refactor these prompts... please don't sue me, Amp
// imitation is the sincerest form of flattery
export const OHM_SUBAGENT_CATALOG: readonly OhmSubagentDefinition[] = [
  {
    id: "librarian",
    name: "Librarian",
    summary:
      "A specialized codebase understanding agent that helps you answer questions about large, complex codebases. Works by reading from temporary local github checkouts. Works as your personal, multi-repository codebase expert, providing thorough analysis and comprehensive explanations across repositories",
    primary: true,
    whenToUse: [
      "Understanding complex multi-repository codebases and how they work",
      "Exploring relationships between different repositories",
      "Analyzing architectural patterns across large open-source projects",
      "Finding specific implementations across multiple codebases",
      "Understanding code evolution and commit history",
      "Getting comprehensive explanations of how major features work",
      "Exploring how systems are designed end-to-end across repositories",
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
      "Code reviews and architecture feedback",
      "Finding difficult bugs in codepaths that flow across many files",
      "Planning complex implementations or refactors",
      "Answering complex technical questions that require deep technical reasoning",
      "Providing an alternative point of view when you are struggling to solve a problem",
    ],
    scaffoldPrompt:
      "Act as a critical reviewer. Challenge assumptions, rank risks, and provide a concrete implementation plan with trade-offs.",
  },
  {
    id: "finder",
    name: "Finder",
    summary:
      "Intelligently search your codebase: Use it for complex, multi-step search tasks where you need to find code based on functionality or concepts rather than exact matches. Anytime you want to chain multiple grep calls you should use this tool.",
    whenToUse: [
      "You must locate code by behavior or concept",
      "You need to run multiple greps in sequence",
      "You must correlate or look for connection between several areas of the codebase",
      `You must filter broad terms ("config", "logger", "cache") by context.`,
      `You need answers to questions such as "Where do we validate JWT authentication headers?" or "Which module handles file-watcher retry logic"`,
    ],
    scaffoldPrompt:
      "Search this codebase for all implementations and call paths related to the requested behavior. Return files, rationale, and confidence.",
  },
  // {
  //   id: "task",
  //   name: "Task",
  //   summary:
  //     "Independent execution subagent for parallelizable tasks with isolated tool context.",
  //   whenToUse: [
  //     "Parallelize work across unrelated app areas",
  //     "Delegate focused implementation tasks",
  //     "Run isolated experiments without polluting main context",
  //   ],
  //   scaffoldPrompt:
  //     "Execute this focused implementation task independently. Return a concise summary of changes, validation, and follow-up risks.",
  // },
  // {
  //   id: "painter",
  //   name: "Painter",
  //   summary: "Image generation/editing subagent used only on explicit request.",
  //   whenToUse: [
  //     "Generate concept/mock images",
  //     "Edit existing images based on prompt instructions",
  //     "Produce visual assets when user explicitly asks for image output",
  //   ],
  //   scaffoldPrompt:
  //     "Generate or edit an image per user request. Confirm intent first, then return prompt + provider/model metadata with result notes.",
  //   requiresPackage: "@pi-ohm/painter",
  // },
] as const;

export function getSubagentById(id: string): OhmSubagentDefinition | undefined {
  const needle = id.trim().toLowerCase();
  return OHM_SUBAGENT_CATALOG.find((agent) => agent.id === needle);
}
