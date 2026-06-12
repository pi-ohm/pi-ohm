import assert from "node:assert/strict";
import test from "node:test";
import {
  definePrompt,
  promptJson,
  promptOptional,
  promptText,
  setPrompt,
  type PromptValue,
} from "../experimental";

type Assert<T extends true> = T;
type IsAssignable<T, U> = [T] extends [U] ? true : false;
type OptionalStringRejected = Assert<
  IsAssignable<string | undefined, PromptValue> extends false ? true : false
>;

void test("setPrompt renders runtime template variables", () => {
  const topic = "PiP prompt ergonomics";
  const count = 2;

  const prompt = setPrompt()`
    <prompt>
    Study ${topic}.
    Return ${count} findings.
    </prompt>
  `;

  assert.equal(
    prompt.text,
    "<prompt>\nStudy PiP prompt ergonomics.\nReturn 2 findings.\n</prompt>",
  );
  assert.equal(promptText(prompt), prompt.text);
});

void test("setPrompt renders nested prompts and arrays", () => {
  const checks = ["lint", "typecheck"];
  const child = setPrompt()`Use repo commands.`;

  const prompt = setPrompt()`
    ${child}

    Checks:
    ${checks}
  `;

  assert.equal(prompt.text, "Use repo commands.\n\nChecks:\nlint\ntypecheck");
});

void test("promptJson makes structured variables explicit", () => {
  const task = promptJson({ files: ["a.ts"], readonly: true });

  const prompt = setPrompt()`
    Inspect:
    ${task}
  `;

  assert.equal(prompt.text, 'Inspect:\n{\n  "files": [\n    "a.ts"\n  ],\n  "readonly": true\n}');
});

void test("definePrompt requires declared variables", () => {
  const review = definePrompt<{ file: string; diff: string }>(
    (vars) => setPrompt()`
    Review ${vars.file}.
    Diff:
    ${vars.diff}
  `,
  );
  type ReviewInput = Parameters<typeof review>[0];
  type MissingDiffRejected = Assert<
    IsAssignable<{ file: string }, ReviewInput> extends false ? true : false
  >;
  const missingDiffRejected: MissingDiffRejected = true;

  assert.equal(review({ file: "a.ts", diff: "+ok" }).text, "Review a.ts.\nDiff:\n+ok");
  assert.equal(missingDiffRejected, true);
});

void test("promptOptional makes optional interpolation explicit", () => {
  const optionalStringRejected: OptionalStringRejected = true;
  const maybe = undefined as string | undefined;
  const prompt = setPrompt()`
    Value: ${promptOptional(maybe, "missing")}
  `;

  assert.equal(optionalStringRejected, true);
  assert.equal(prompt.text, "Value: missing");
});
