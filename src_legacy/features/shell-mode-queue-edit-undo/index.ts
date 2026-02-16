import type { FeatureDefinition } from "../../core/feature";

export const shell_mode_queue_edit_undoFeature: FeatureDefinition = {
  slug: "shell-mode-queue-edit-undo",
  name: "Shell Mode + Queue + Edit/Undo",
  ampFeature: "$ shell mode, queued prompts, message editing with rollback",
  description: "Workflow accelerators for iterative agent loops and control.",
  phase: "P1",
  status: "planned",
  path: "src/features/shell-mode-queue-edit-undo",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/manual"],
};
