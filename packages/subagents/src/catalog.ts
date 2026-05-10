export interface IntegratedSubagent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly whenToUse: readonly string[];
}

export const INTEGRATED_SUBAGENTS = [
  {
    id: "librarian",
    name: "Librarian",
    description: "Multi-repository codebase understanding and explanation.",
    whenToUse: [
      "Understand complex codebases",
      "Trace relationships across repositories",
      "Produce thorough architecture explanations",
    ],
  },
  {
    id: "oracle",
    name: "Oracle",
    description: "Reasoning-heavy reviewer, planner, debugger, and architecture advisor.",
    whenToUse: [
      "Review code or architecture",
      "Plan complex implementations",
      "Debug difficult cross-file behavior",
    ],
  },
  {
    id: "finder",
    name: "Finder",
    description: "Behavior-based code search for concepts, flows, and broad terms.",
    whenToUse: [
      "Locate code by behavior or concept",
      "Run multi-step searches",
      "Correlate related code paths",
    ],
  },
] satisfies readonly IntegratedSubagent[];
