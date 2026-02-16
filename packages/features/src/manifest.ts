export type FocusFeatureId =
  | "handoff"
  | "subagents"
  | "session-thread-search"
  | "handoff-visualizer"
  | "painter-imagegen";

export interface FocusFeatureDefinition {
  id: FocusFeatureId;
  title: string;
  modulePath: `packages/features/src/${string}`;
  summary: string;
}

export const OHM_FOCUS_FEATURES: FocusFeatureDefinition[] = [
  {
    id: "handoff",
    title: "Handoff",
    modulePath: "packages/features/src/handoff",
    summary: "Task-focused context transfer into a new thread/session.",
  },
  {
    id: "subagents",
    title: "Subagents",
    modulePath: "packages/features/src/subagents",
    summary: "Delegation to external agent backends until native subagents exist.",
  },
  {
    id: "session-thread-search",
    title: "Session/Thread Search",
    modulePath: "packages/features/src/session-thread-search",
    summary: "Find previous threads/sessions by keyword and touched files.",
  },
  {
    id: "handoff-visualizer",
    title: "Handoff Visualizer",
    modulePath: "packages/features/src/handoff-visualizer",
    summary: "Show linked handoff graph in session/resume workflows.",
  },
  {
    id: "painter-imagegen",
    title: "Painter/ImageGen",
    modulePath: "packages/features/src/painter-imagegen",
    summary: "Image generation/editing via Google Nano Banana + OpenAI/Azure OpenAI.",
  },
];

export const RECOMMENDED_NEXT_FEATURES = [
  {
    name: "Modes (rush/smart/deep)",
    reason: "Needed to quickly switch behavior and model strategy for focused tasks.",
  },
  {
    name: "Permissions policy layer",
    reason: "Important guardrails once subagent delegation starts running commands.",
  },
  {
    name: "Skills + MCP lazy loading",
    reason: "Critical for keeping tool/context bloat under control as capabilities expand.",
  },
];
