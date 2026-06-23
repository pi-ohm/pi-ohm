import assert from "node:assert/strict";
import test from "node:test";
import {
  completeOhmCommandArguments,
  defineOhmCommand,
  renderOhmCommandArgumentHint,
  renderOhmCommandHint,
  type OhmCommandSpec,
} from "../command-hints";
import type { OhmInputStatusContent } from "../input-status";

interface ArtifactState {
  readonly artifacts: readonly string[];
}

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function hintText(content: OhmInputStatusContent | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((segment) => {
        if (typeof segment.text === "string") return segment.text;
        return `${segment.text.left}${segment.text.right}`;
      })
      .join("");
  }
  if ("left" in content && "right" in content) return `${content.left}${content.right}`;
  return "";
}

const command = defineOhmCommand<ArtifactState>({
  name: "context",
  summary: "Manage context artifacts",
  variants: [
    {
      name: "init",
      summary: "create context store",
      flags: [{ name: "--mount", description: "mount thoughts/ symlinks" }],
    },
    {
      name: "research",
      summary: "create a research artifact",
      args: [{ name: "topic", placeholder: "topic", repeat: true, optional: true }],
    },
    {
      name: "plan",
      summary: "create a plan from research",
      args: [
        {
          name: "research",
          placeholder: "#research/...",
          optional: true,
          complete(context) {
            return (context.state?.artifacts ?? []).map((artifact) => ({
              value: artifact,
              label: artifact,
              description: "research artifact",
            }));
          },
        },
      ],
    },
    {
      name: "implement",
      summary: "execute a context plan",
      args: [
        {
          name: "plan",
          placeholder: "#plan/...",
          complete(context) {
            return (context.state?.artifacts ?? []).map((artifact) => ({
              value: artifact.replace("#research/", "#plan/"),
              label: artifact.replace("#research/", "#plan/"),
            }));
          },
        },
      ],
    },
  ],
}) satisfies OhmCommandSpec<ArtifactState>;

defineTest("renderOhmCommandArgumentHint summarizes variant commands", () => {
  assert.equal(renderOhmCommandArgumentHint(command), "<init|research|plan|implement>");
});

defineTest("completeOhmCommandArguments completes variants from the first token", async () => {
  const items = await completeOhmCommandArguments({ spec: command, prefix: "pl" });
  assert.deepEqual(
    items?.map((item) => item.value),
    ["plan"],
  );
});

defineTest("completeOhmCommandArguments completes variant flags", async () => {
  const items = await completeOhmCommandArguments({ spec: command, prefix: "init " });
  assert.deepEqual(
    items?.map((item) => item.value),
    ["init --mount"],
  );
});

defineTest(
  "completeOhmCommandArguments preserves variant before completing flag prefixes",
  async () => {
    const items = await completeOhmCommandArguments({ spec: command, prefix: "init --m" });
    assert.deepEqual(
      items?.map((item) => item.value),
      ["init --mount"],
    );
    assert.deepEqual(
      items?.map((item) => item.label),
      ["--mount"],
    );
  },
);

defineTest("completeOhmCommandArguments completes dynamic positional values", async () => {
  const items = await completeOhmCommandArguments({
    spec: command,
    prefix: "plan #research/auth",
    state: { artifacts: ["#research/auth-flow", "#research/daemon"] },
  });

  assert.deepEqual(
    items?.map((item) => item.value),
    ["plan #research/auth-flow"],
  );
});

defineTest("renderOhmCommandHint returns compact input-status content for active commands", () => {
  assert.equal(
    hintText(renderOhmCommandHint({ specs: [command], text: "/context plan" })),
    "/context plan [#research/...]",
  );
  assert.equal(
    hintText(renderOhmCommandHint({ specs: [command], text: "/context plan " })),
    "/context plan [#research/...]",
  );
});
