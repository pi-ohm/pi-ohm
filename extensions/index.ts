import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPiOhmExtension from "../packages/extension/src/extension";

export default function (pi: ExtensionAPI) {
  registerPiOhmExtension(pi);
}
