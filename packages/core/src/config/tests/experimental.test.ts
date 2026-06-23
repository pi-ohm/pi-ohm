import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { defineExperimentalFlags, registerConfig } from "../index";

const SchemaNode = Type.Unsafe<Readonly<Record<string, unknown>>>({
  type: "object",
  additionalProperties: true,
});

function child(value: unknown, key: string): unknown {
  assert.equal(Value.Check(SchemaNode, value), true);
  if (!Value.Check(SchemaNode, value)) assert.fail(`Expected schema node before reading '${key}'`);
  return value[key];
}

const demoExperimental = defineExperimentalFlags("demo", {
  alpha: {
    defaultEnabled: true,
    description: "Use the alpha experimental path.",
  },
  beta: {
    defaultEnabled: false,
    description: "Use the beta experimental path.",
  },
});

void test("defineExperimentalFlags builds strict per-package enabled-flag schema", () => {
  assert.equal(Value.Check(demoExperimental.schema, {}), true);
  assert.equal(Value.Check(demoExperimental.schema, { alpha: {} }), true);
  assert.equal(Value.Check(demoExperimental.schema, { alpha: { enabled: false } }), true);
  assert.equal(Value.Check(demoExperimental.schema, { alpha: { enabled: "yes" } }), false);
  assert.equal(
    Value.Check(demoExperimental.schema, { alpha: { enabled: true, mode: "auto" } }),
    false,
  );
  assert.equal(Value.Check(demoExperimental.schema, { gamma: { enabled: true } }), false);
});

void test("defineExperimentalFlags exposes schema descriptions and defaults", () => {
  const properties = child(demoExperimental.schema, "properties");
  const alpha = child(properties, "alpha");
  const alphaProperties = child(alpha, "properties");
  const alphaEnabled = child(alphaProperties, "enabled");

  assert.equal(child(alpha, "description"), "Use the alpha experimental path.");
  assert.equal(child(alphaEnabled, "description"), "Use the alpha experimental path.");
  assert.equal(child(alphaEnabled, "default"), true);
});

void test("defineExperimentalFlags merges patches into required defaults", () => {
  assert.deepEqual(demoExperimental.defaults, {
    alpha: { enabled: true },
    beta: { enabled: false },
  });

  assert.deepEqual(
    demoExperimental.merge(demoExperimental.defaults, {
      alpha: { enabled: false },
    }),
    {
      alpha: { enabled: false },
      beta: { enabled: false },
    },
  );
});

void test("defineExperimentalFlags validates resolved runtime shape", () => {
  assert.equal(demoExperimental.is(demoExperimental.defaults), true);
  assert.equal(demoExperimental.is({ alpha: { enabled: true } }), false);
  assert.equal(
    demoExperimental.is({
      alpha: { enabled: true },
      beta: { enabled: false },
      gamma: { enabled: true },
    }),
    false,
  );
  assert.equal(demoExperimental.is({ alpha: { enabled: true }, beta: { enabled: "no" } }), false);
});

void test("defineExperimentalFlags rejects empty declaration metadata", () => {
  assert.throws(
    () => defineExperimentalFlags("", { alpha: { defaultEnabled: false, description: "Alpha." } }),
    /namespace must be a non-empty string/,
  );
  assert.throws(
    () => defineExperimentalFlags("demo", { alpha: { defaultEnabled: false, description: " " } }),
    /description must be a non-empty string/,
  );
});

void test("registerConfig carries experimental metadata for UI and schema tooling", () => {
  const module = registerConfig({
    namespace: "demo",
    schema: Type.Object(
      {
        experimental: Type.Optional(demoExperimental.schema),
      },
      { additionalProperties: false },
    ),
    defaults: {
      experimental: demoExperimental.defaults,
    },
    experimental: demoExperimental,
    merge(base, patch) {
      return Result.ok({
        experimental: demoExperimental.merge(base.experimental, patch.experimental),
      });
    },
  });

  assert.deepEqual(module.experimental?.flags, [
    {
      namespace: "demo",
      key: "alpha",
      defaultEnabled: true,
      description: "Use the alpha experimental path.",
    },
    {
      namespace: "demo",
      key: "beta",
      defaultEnabled: false,
      description: "Use the beta experimental path.",
    },
  ]);
});
