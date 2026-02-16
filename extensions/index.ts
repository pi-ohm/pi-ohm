import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import registerOhmFeaturesExtension from "../packages/features/src/extension";

export default function (pi: ExtensionAPI) {
  registerOhmFeaturesExtension(pi);
}
