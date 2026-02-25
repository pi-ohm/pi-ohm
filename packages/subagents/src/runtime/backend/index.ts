import { PiCliTaskExecutionBackend } from "./pi-cli-backend";
import type { TaskExecutionBackend } from "./types";

export type {
  ParseSubagentModelSelectionResult,
  ParsedSubagentModelSelection,
  PiCliRunner,
  PiCliRunnerInput,
  PiCliRunnerResult,
  PiSdkRunner,
  PiSdkRunnerInput,
  PiSdkRunnerResult,
  TaskBackendSendInput,
  TaskBackendSendOutput,
  TaskBackendStartInput,
  TaskBackendStartOutput,
  TaskExecutionBackend,
} from "./types";

export { parseSubagentModelSelection } from "./model-selection";
export {
  applyPiSdkSessionEvent,
  createPiSdkStreamCaptureState,
  finalizePiSdkStreamCapture,
} from "./sdk-stream-capture";
export { buildSendPrompt, buildStartPrompt, truncate } from "./prompts";
export {
  CLI_BACKEND_ROUTE,
  PI_CLI_TOOLS,
  SDK_BACKEND_ROUTE,
  SDK_BACKEND_RUNTIME,
  normalizeOutput,
  runPiCliPrompt,
  runPiSdkPrompt,
  sanitizeNestedOutput,
} from "./runners";
export { ScaffoldTaskExecutionBackend } from "./scaffold-backend";
export { PiCliTaskExecutionBackend, resolveBackendTimeoutMs } from "./pi-cli-backend";
export { PiSdkTaskExecutionBackend } from "./pi-sdk-backend";

export function createDefaultTaskExecutionBackend(): TaskExecutionBackend {
  return new PiCliTaskExecutionBackend();
}
