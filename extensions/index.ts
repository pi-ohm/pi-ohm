import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import registerPiOhmExtension from "../packages/extension/src/extension";

export default function (pi: ExtensionAPI) {
  registerPiOhmExtension(pi);
}
