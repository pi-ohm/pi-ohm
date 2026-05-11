export interface IntegratedSubagent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export const INTEGRATED_SUBAGENTS = [
  {
    id: "librarian",
    name: "Librarian",
    description: "Multi-repository codebase understanding and explanation.",
  },
  {
    id: "oracle",
    name: "Oracle",
    description: "Reasoning-heavy reviewer, planner, debugger, and architecture advisor.",
  },
  {
    id: "finder",
    name: "Finder",
    description: "Behavior-based code search for concepts, flows, and broad terms.",
  },
] satisfies readonly IntegratedSubagent[];
