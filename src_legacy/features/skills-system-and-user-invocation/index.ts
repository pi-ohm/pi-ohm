import type { FeatureDefinition } from "../../core/feature";

export const skills_system_and_user_invocationFeature: FeatureDefinition = {
  slug: "skills-system-and-user-invocation",
  name: "Skills System + User Invocation",
  ampFeature: "Skill discovery + user-invokable skills",
  description: "Skill catalog, precedence rules, and explicit user invocation UX.",
  phase: "P0",
  status: "planned",
  path: "src/features/skills-system-and-user-invocation",
  dependsOn: [],
  sourceUrls: [
    "https://ampcode.com/manual",
    "https://ampcode.com/news/agent-skills",
    "https://ampcode.com/news/user-invokable-skills",
    "https://ampcode.com/news/slashing-custom-commands",
  ],
};
