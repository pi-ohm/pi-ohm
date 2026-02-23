import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAgentSession,
  createBashTool,
  createEditTool,
  createExtensionRuntime,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { registerSubagentTools } from "../../../extension";
import { buildSubagentSdkSystemPrompt } from "../system-prompts";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

const SHOULD_UPDATE_GOLDENS = process.env.UPDATE_PROMPTS === "1";
const GOLDEN_ROOT = path.join(
  process.cwd(),
  "packages/subagents/src/runtime/backend/tests/__golden__/system-prompts",
);

function withTempWorkspace(
  run: (input: { readonly cwd: string; readonly agentDir: string }) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "pi-ohm-system-prompt-"));
  const cwd = path.join(root, "cwd");
  const agentDir = path.join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });

  return Promise.resolve(run({ cwd, agentDir })).finally(() => {
    rmSync(root, { recursive: true, force: true });
  });
}

function normalizePrompt(
  prompt: string,
  input: { readonly cwd: string; readonly agentDir?: string },
): string {
  const normalizedNewlines = prompt.split("\r\n").join("\n");
  const normalizedCwd = normalizedNewlines.split(input.cwd).join("<cwd>");
  const normalizedAgentDir =
    input.agentDir && input.agentDir.length > 0
      ? normalizedCwd.split(input.agentDir).join("<agentDir>")
      : normalizedCwd;
  const normalizedRepo = normalizedAgentDir.split(process.cwd()).join("<repo>");

  return normalizedRepo
    .replace(/Current date and time: .+/gu, "Current date and time: <redacted>")
    .replace(/Current working directory: .+/gu, "Current working directory: <cwd>");
}

interface ToolSummary {
  readonly name: string;
  readonly label: string;
  readonly description: string;
}

function renderToolBlock(
  session: Awaited<ReturnType<typeof createAgentSession>>["session"],
  appendedTools: readonly ToolSummary[] = [],
): string {
  const lines: string[] = ["Tools (ordered):"];
  const builtInCount = session.agent.state.tools.length;

  for (const [index, tool] of session.agent.state.tools.entries()) {
    lines.push(`[${index}] ${tool.name}`);
    lines.push(`label: ${tool.label ?? "<none>"}`);
    lines.push(`description: ${tool.description ?? "<none>"}`);
    lines.push("");
  }

  for (const [offset, tool] of appendedTools.entries()) {
    lines.push(`[${builtInCount + offset}] ${tool.name}`);
    lines.push(`label: ${tool.label}`);
    lines.push(`description: ${tool.description}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function buildSnapshotText(input: {
  readonly title: string;
  readonly prompt: string;
  readonly toolsBlock: string;
}): string {
  return [
    `# ${input.title}`,
    "",
    "## System prompt",
    "",
    input.prompt,
    "",
    "## Tool registry",
    "",
    input.toolsBlock,
    "",
  ].join("\n");
}

function assertGoldenText(name: string, text: string): void {
  const goldenPath = path.join(GOLDEN_ROOT, name);
  if (SHOULD_UPDATE_GOLDENS) {
    mkdirSync(path.dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, text, "utf8");
    return;
  }

  const expected = readFileSync(goldenPath, "utf8");
  assert.equal(text, expected);
}

function createStaticResourceLoader(systemPrompt: string): ResourceLoader {
  const runtime = createExtensionRuntime();
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime,
    }),
    getSkills: () => ({
      skills: [],
      diagnostics: [],
    }),
    getPrompts: () => ({
      prompts: [],
      diagnostics: [],
    }),
    getThemes: () => ({
      themes: [],
      diagnostics: [],
    }),
    getAgentsFiles: () => ({
      agentsFiles: [],
    }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    getPathMetadata: () => new Map(),
    extendResources: () => {},
    reload: async () => {},
  };
}

function collectSubagentToolDefinitions(): readonly ToolSummary[] {
  const definitions: ToolSummary[] = [];
  registerSubagentTools({
    registerTool(definition) {
      definitions.push({
        name: definition.name,
        label: definition.label,
        description: definition.description,
      });
    },
  });
  return definitions;
}

defineTest("golden - full main-agent system prompt + subagent tool placement", async () => {
  await withTempWorkspace(async ({ cwd, agentDir }) => {
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
    });
    await loader.reload();

    const subagentTools = collectSubagentToolDefinitions();
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    });

    const snapshot = buildSnapshotText({
      title: "Main agent prompt harness",
      prompt: normalizePrompt(session.agent.state.systemPrompt, { cwd, agentDir }),
      toolsBlock: renderToolBlock(session, subagentTools),
    });

    assert.match(snapshot, /\[4\] task/u);
    assert.match(snapshot, /\[5\] librarian/u);
    assert.match(snapshot, /\[6\] oracle/u);
    assert.match(snapshot, /\[7\] finder/u);

    session.dispose();
    assertGoldenText("main-agent.txt", snapshot);
  });
});

defineTest("golden - full subagent sdk system prompt + tool placement", async () => {
  await withTempWorkspace(async ({ cwd }) => {
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const { session } = await createAgentSession({
      cwd,
      resourceLoader: createStaticResourceLoader(
        buildSubagentSdkSystemPrompt({
          modelPattern: "openai/gpt-5",
        }),
      ),
      tools: [createReadTool(cwd), createBashTool(cwd), createEditTool(cwd), createWriteTool(cwd)],
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    });

    const snapshot = buildSnapshotText({
      title: "Subagent sdk prompt harness",
      prompt: normalizePrompt(session.agent.state.systemPrompt, {
        cwd,
      }),
      toolsBlock: renderToolBlock(session),
    });

    assert.match(snapshot, /\[0\] read/u);
    assert.match(snapshot, /\[1\] bash/u);
    assert.match(snapshot, /\[2\] edit/u);
    assert.match(snapshot, /\[3\] write/u);

    session.dispose();
    assertGoldenText("subagent-sdk-openai.txt", snapshot);
  });
});
