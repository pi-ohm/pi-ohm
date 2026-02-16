import type { FeatureDefinition } from "../../core/feature";

export const mcp_skill_lazy_loading_and_oauthFeature: FeatureDefinition = {
  slug: "mcp-skill-lazy-loading-and-oauth",
  name: "MCP in Skills + Lazy Loading + OAuth",
  ampFeature: "Tool exposure only when skills load, with OAuth-enabled MCP",
  description: "MCP integration strategy focused on token efficiency and trust controls.",
  phase: "P0",
  status: "planned",
  path: "src/features/mcp-skill-lazy-loading-and-oauth",
  dependsOn: ["skills-system-and-user-invocation"],
  sourceUrls: ["https://ampcode.com/manual", "https://ampcode.com/news/lazy-load-mcp-with-skills"],
};
