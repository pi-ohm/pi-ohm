import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import registerPiPhmExtension from "../packages/extension/src/extension";

export default function (pi: ExtensionAPI) {
  registerPiPhmExtension(pi);
}
