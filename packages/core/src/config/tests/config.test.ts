import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import {
  PiConfigRegistry,
  coreConfigModule,
  featuresConfigModule,
  isOhmCoreConfig,
  isOhmFeatureFlags,
  loadOhmConfig,
  loadRegisteredConfig,
  pickOhmConfig,
  registerConfig,
  resolveOhmConfigPaths,
} from "../index";

const DemoSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    count: Type.Optional(Type.Integer({ minimum: 1 })),
    label: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

type DemoPatch = StaticDecode<typeof DemoSchema>;

interface DemoConfig {
  readonly enabled: boolean;
  readonly count: number;
  readonly label: string;
}

const demo = registerConfig({
  namespace: "demo",
  schema: DemoSchema,
  defaults: {
    enabled: true,
    count: 1,
    label: "default",
  },
  merge(base: DemoConfig, patch: DemoPatch) {
    return Result.ok({
      enabled: patch.enabled ?? base.enabled,
      count: patch.count ?? base.count,
      label: patch.label ?? base.label,
    });
  },
});

async function withConfigEnv<T>(
  run: (input: {
    readonly dir: string;
    readonly cwd: string;
    readonly agent: string;
  }) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-config-"));
  const cwd = path.join(dir, "repo");
  const agent = path.join(dir, "agent");
  await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
  await fs.mkdir(agent, { recursive: true });

  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;

  return run({ dir, cwd, agent }).finally(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    if (previous !== undefined) process.env.PI_CODING_AGENT_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });
}

void test("resolveOhmConfigPaths uses PI_CODING_AGENT_DIR as the agent directory", async () => {
  await withConfigEnv(async ({ cwd, agent }) => {
    const paths = resolveOhmConfigPaths(cwd);

    assert.equal(paths.globalConfigFile, path.join(agent, "ohm.json"));
    assert.equal(paths.projectConfigFile, path.join(cwd, ".pi", "ohm.json"));
  });
});

void test("loadRegisteredConfig merges defaults, global config, then project config", async () => {
  await withConfigEnv(async ({ cwd, agent }) => {
    await fs.writeFile(
      path.join(agent, "ohm.json"),
      JSON.stringify({ demo: { enabled: false, count: 3, label: "global" } }),
      "utf8",
    );
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({ demo: { count: 7 } }),
      "utf8",
    );

    const loaded = await loadRegisteredConfig({ cwd, modules: [demo] });

    assert.equal(Result.isOk(loaded), true);
    if (Result.isError(loaded)) assert.fail(loaded.error.message);
    assert.deepEqual(loaded.value.config.demo, {
      enabled: false,
      count: 7,
      label: "global",
    });
    assert.deepEqual(loaded.value.loadedFrom, [
      path.join(agent, "ohm.json"),
      path.join(cwd, ".pi", "ohm.json"),
    ]);
    assert.deepEqual(loaded.value.diagnostics, []);
  });
});

void test("PiConfigRegistry registers modules and loads resolved config", async () => {
  await withConfigEnv(async ({ cwd, agent }) => {
    await fs.writeFile(
      path.join(agent, "ohm.json"),
      JSON.stringify({ demo: { enabled: false, count: 5 } }),
      "utf8",
    );

    const registry = PiConfigRegistry.create({ cwd });

    assert.equal(Result.isOk(registry), true);
    if (Result.isError(registry)) assert.fail(registry.error.message);

    const registered = registry.value.register(demo);
    assert.equal(Result.isOk(registered), true);

    const loaded = await registry.value.load();

    assert.equal(Result.isOk(loaded), true);
    if (Result.isError(loaded)) assert.fail(loaded.error.message);
    assert.deepEqual(loaded.value.config.demo, {
      enabled: false,
      count: 5,
      label: "default",
    });
  });
});

void test("PiConfigRegistry rejects duplicate module namespaces", () => {
  const registry = PiConfigRegistry.create({ cwd: process.cwd() });

  assert.equal(Result.isOk(registry), true);
  if (Result.isError(registry)) assert.fail(registry.error.message);

  assert.equal(Result.isOk(registry.value.register(demo)), true);

  const duplicate = registry.value.register(demo);
  assert.equal(Result.isError(duplicate), true);
});

void test("loadOhmConfig composes core-owned config modules", async () => {
  await withConfigEnv(async ({ cwd, agent }) => {
    await fs.writeFile(
      path.join(agent, "ohm.json"),
      JSON.stringify({
        core: { defaultMode: "rush" },
        features: { painterImagegen: false },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({ core: { defaultMode: "deep" } }),
      "utf8",
    );

    const loaded = await loadOhmConfig({
      cwd,
      modules: [coreConfigModule, featuresConfigModule],
    });

    assert.equal(Result.isOk(loaded), true);
    if (Result.isError(loaded)) assert.fail(loaded.error.message);

    const core = pickOhmConfig({
      loaded: loaded.value,
      module: coreConfigModule,
      is: isOhmCoreConfig,
    });
    const features = pickOhmConfig({
      loaded: loaded.value,
      module: featuresConfigModule,
      is: isOhmFeatureFlags,
    });

    assert.equal(Result.isOk(core), true);
    assert.equal(Result.isOk(features), true);
    if (Result.isError(core)) assert.fail(core.error.message);
    if (Result.isError(features)) assert.fail(features.error.message);

    assert.equal(core.value.defaultMode, "deep");
    assert.equal(features.value.painterImagegen, false);
  });
});

void test("loadRegisteredConfig reports invalid JSON as diagnostics without crashing", async () => {
  await withConfigEnv(async ({ cwd }) => {
    await fs.writeFile(path.join(cwd, ".pi", "ohm.json"), "{ nope", "utf8");

    const loaded = await loadRegisteredConfig({ cwd, modules: [demo] });

    assert.equal(Result.isOk(loaded), true);
    if (Result.isError(loaded)) assert.fail(loaded.error.message);
    assert.deepEqual(loaded.value.config.demo, {
      enabled: true,
      count: 1,
      label: "default",
    });
    assert.equal(loaded.value.loadedFrom.length, 0);
    assert.equal(loaded.value.diagnostics.length, 1);
    assert.equal(loaded.value.diagnostics[0]?.kind, "invalid-json");
    assert.equal(loaded.value.diagnostics[0]?.path, path.join(cwd, ".pi", "ohm.json"));
  });
});

void test("loadRegisteredConfig reports schema diagnostics and keeps last valid value", async () => {
  await withConfigEnv(async ({ cwd, agent }) => {
    await fs.writeFile(
      path.join(agent, "ohm.json"),
      JSON.stringify({ demo: { count: 4 } }),
      "utf8",
    );
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({ demo: { count: 0, extra: true } }),
      "utf8",
    );

    const loaded = await loadRegisteredConfig({ cwd, modules: [demo] });

    assert.equal(Result.isOk(loaded), true);
    if (Result.isError(loaded)) assert.fail(loaded.error.message);
    assert.deepEqual(loaded.value.config.demo, {
      enabled: true,
      count: 4,
      label: "default",
    });
    assert.deepEqual(loaded.value.loadedFrom, [path.join(agent, "ohm.json")]);
    assert.equal(loaded.value.diagnostics.length, 1);
    assert.equal(loaded.value.diagnostics[0]?.kind, "invalid-schema");
    assert.equal(loaded.value.diagnostics[0]?.namespace, "demo");
  });
});
