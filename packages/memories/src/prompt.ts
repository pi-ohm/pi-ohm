import fs from "node:fs";
import path from "node:path";
import {
  CODEX_CONSOLIDATION_TEMPLATE,
  CODEX_MEMORY_EXTENSIONS_FOLDER_STRUCTURE,
  CODEX_MEMORY_EXTENSIONS_PRIMARY_INPUTS,
  CODEX_READ_PATH_TEMPLATE,
  CODEX_STAGE_ONE_INPUT_TEMPLATE,
} from "./codex-prompts";
import type { MemoryPaths } from "./paths";

function renderTemplate(template: string, values: ReadonlyMap<string, string>): string {
  return [...values.entries()].reduce(
    (rendered, [key, value]) => rendered.split(`{{ ${key} }}`).join(value),
    template,
  );
}

export function renderReadPathPrompt(paths: MemoryPaths, summary: string): string {
  return renderTemplate(
    CODEX_READ_PATH_TEMPLATE,
    new Map([
      ["base_path", paths.data],
      ["memory_summary", summary],
    ]),
  );
}

export function renderStageOneInputPrompt(input: {
  readonly rolloutPath: string;
  readonly rolloutCwd: string;
  readonly rolloutContents: string;
}): string {
  return renderTemplate(
    CODEX_STAGE_ONE_INPUT_TEMPLATE,
    new Map([
      ["rollout_path", input.rolloutPath],
      ["rollout_cwd", input.rolloutCwd],
      ["rollout_contents", input.rolloutContents],
    ]),
  );
}

function renderExtensionBlock(template: string, memoryExtensionsRoot: string): string {
  return renderTemplate(template, new Map([["memory_extensions_root", memoryExtensionsRoot]]));
}

export function renderConsolidationPrompt(paths: MemoryPaths): string {
  const memoryExtensionsRoot = paths.extensions;
  const memoryExtensionsExist = fs.existsSync(memoryExtensionsRoot);
  const memoryExtensionsFolderStructure = memoryExtensionsExist
    ? renderExtensionBlock(CODEX_MEMORY_EXTENSIONS_FOLDER_STRUCTURE, memoryExtensionsRoot)
    : "";
  const memoryExtensionsPrimaryInputs = memoryExtensionsExist
    ? renderExtensionBlock(CODEX_MEMORY_EXTENSIONS_PRIMARY_INPUTS, memoryExtensionsRoot)
    : "";

  return renderTemplate(
    CODEX_CONSOLIDATION_TEMPLATE,
    new Map([
      ["memory_root", paths.data],
      ["memory_extensions_folder_structure", memoryExtensionsFolderStructure],
      ["memory_extensions_primary_inputs", memoryExtensionsPrimaryInputs],
      ["phase2_workspace_diff_file", path.basename(paths.diff)],
    ]),
  );
}
