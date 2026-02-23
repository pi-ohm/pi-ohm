export type OhmSubagentId = "librarian" | "oracle" | "finder" | "task" | "painter";
export type OhmSubagentIdentifier = OhmSubagentId | (string & {});

export interface OhmSubagentDefinition {
  id: OhmSubagentIdentifier;
  name: string;
  description?: string;
  /** @deprecated use description */
  summary?: string;
  /**
   * When true, this profile should be exposed as a directly invokable primary tool
   * instead of requiring delegated Task-style invocation.
   */
  primary?: boolean;
  /**
   * Internal profiles are hidden from model-facing task roster exposure unless
   * policy explicitly allows internal routing.
   */
  internal?: boolean;
  whenToUse: readonly string[];
  whenNotToUse?: readonly string[];
  usageGuidelines?: readonly string[];
  examples?: readonly string[];
  /** @deprecated execution prompt now resolves outside catalog */
  scaffoldPrompt?: string;
  requiresPackage?: string;
}

// should probably refactor these prompts... please don't sue me, Amp
// imitation is the sincerest form of flattery
export const OHM_SUBAGENT_CATALOG: readonly OhmSubagentDefinition[] = [
  {
    id: "librarian",
    name: "Librarian",
    description:
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
    whenNotToUse: [
      "Simple local file reading (use Read directly)",
      "Local codebase searches (use finder)",
      "Code modifications or implementations (use other tools)",
      "Questions not related to understanding existing repositories",
    ],
    usageGuidelines: [
      "1. Be specific about what repositories or projects you want to understand",
      "2. Provide context about what you're trying to achieve",
      "3. The Librarian will explore thoroughly across repositories before providing comprehensive answers",
      "4. Expect detailed, documentation-quality responses suitable for sharing",
      "5. When getting an answer from the Librarian, show it to the user in full, do not summarize it",
    ],
    examples: [
      "How does authentication work in the Kubernetes codebase?",
      "Explain the architecture of the React rendering system",
      "Find how database migrations are handled in Rails",
      "Understand the plugin system in the VSCode codebase",
      "Compare how different web frameworks handle routing",
      "What changed in commit abc123 in my private repository?",
      "Show me the diff for commit fb492e2 in github.com/mycompany/private-repo",
      "Read the README from the main API repo on our Bitbucket Enterprise instance",
    ],
  },
  {
    id: "oracle",
    name: "Oracle",
    description:
      "Reasoning-heavy advisor for code review, architecture feedback, complex debugging, and planning.",
    whenToUse: [
      "Code reviews and architecture feedback",
      "Finding difficult bugs in codepaths that flow across many files",
      "Planning complex implementations or refactors",
      "Answering complex technical questions that require deep technical reasoning",
      "Providing an alternative point of view when you are struggling to solve a problem",
    ],
    whenNotToUse: [
      "File reads or simple keyword searches (use bash tools directly)",
      "Codebase searches (use Finder subagent or bash tools directly)",
      "Web browsing and searching",
      "Basic code modifications and when you need to execute code changes (do it yourself)",
    ],
    usageGuidelines: [
      "Be specific about what you want the oracle to review, plan, or debug",
      "Provide relevant context about what you're trying to achieve. If you know that 3 files are involved, list them and they will be attached.",
    ],
  },
  {
    id: "finder",
    name: "Finder",
    description:
      "Intelligently search your codebase: Use it for complex, multi-step search tasks where you need to find code based on functionality or concepts rather than exact matches. Anytime you want to chain multiple grep calls you should use this tool.",
    whenToUse: [
      "You must locate code by behavior or concept",
      "You need to run multiple greps in sequence",
      "You must correlate or look for connection between several areas of the codebase",
      `You must filter broad terms ("config", "logger", "cache") by context.`,
      `You need answers to questions such as "Where do we validate JWT authentication headers?" or "Which module handles file-watcher retry logic"`,
    ],
    whenNotToUse: [
      "When you know the exact file path - use bash tools directly",
      "When looking for specific symbols or exact strings",
      "When you need to create, modify files, or run terminal commands",
    ],
    usageGuidelines: [
      "1. Always spawn multiple search agents in parallel to maximise speed",
      "2. Formulate your query as a precise engineering request: Good - Find every place we build an HTTP error response; Bad - error handling search",
      `3. Name concrete artifacts, patterns, or APIs to narrow scope (e.g., "Express middleware", "fs.watch debounce")`,
      `4. State explicit success criteria so the agent knows when to stop (e.g., "Return file paths and line numbers for all JWT verification calls")`,
      "5. Never issue vague or exploratory commands - be definitive and goal-oriented",
    ],
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

export function getSubagentDescription(subagent: OhmSubagentDefinition): string {
  if (subagent.description && subagent.description.trim().length > 0) {
    return subagent.description;
  }

  if (subagent.summary && subagent.summary.trim().length > 0) {
    return subagent.summary;
  }

  return "Subagent profile";
}
