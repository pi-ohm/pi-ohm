import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgentControllerTool } from "./agent-controller";

export * from "./config";
export * from "./agent-controller";

export default function registerSubagentsExtension(pi: ExtensionAPI): void {
  registerAgentControllerTool(pi);
}
