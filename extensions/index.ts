import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import registerOhmExtension from "../src/extension";

export default function (pi: ExtensionAPI) {
  registerOhmExtension(pi);
}
