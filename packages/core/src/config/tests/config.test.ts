import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import {
  ConfigRegistry,
  clearGlobalConfigModulesForTesting,
  getGlobalConfigModules,
  loadConfig,
  pickConfig,
  registerConfig,
  registerGlobalConfigModule,
  resolveExtensionConfigPaths,
  watchConfig,
  type LoadedExtensionConfig,
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

function isDemoConfig(value: unknown): value is DemoConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (
    typeof Reflect.get(value, "enabled") === "boolean" &&
    typeof Reflect.get(value, "count") === "number" &&
    typeof Reflect.get(value, "label") === "string"
  );
}

function readDemoConfig(loaded: LoadedExtensionConfig): DemoConfig {
  const config = pickConfig({ loaded, module: demo, is: isDemoConfig });
  if (Result.isError(config)) assert.fail(config.error.message);
  return config.value;
}

async function waitFor(input: {
  readonly until: () => boolean;
  readonly message: string;
  readonly timeoutMs?: number;
}): Promise<void> {
  const started = Date.now();
  const timeout = input.timeoutMs ?? 2_000;

  while (!input.until()) {
    if (Date.now() - started > timeout) assert.fail(input.message);
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
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

async function withSingleConfigDir<T>(
  env: "PI_CONFIG_DIR" | "PI_CODING_AGENT_DIR" | "PI_AGENT_DIR",
  run: (input: { readonly cwd: string; readonly agent: string }) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-config-dir-"));
  const cwd = path.join(dir, "repo");
  const agent = path.join(dir, "agent");
  await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
  await fs.mkdir(agent, { recursive: true });

  const previousConfig = process.env.PI_CONFIG_DIR;
  const previousCoding = process.env.PI_CODING_AGENT_DIR;
  const previousAgent = process.env.PI_AGENT_DIR;
  delete process.env.PI_CONFIG_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_AGENT_DIR;
  process.env[env] = agent;

  return run({ cwd, agent }).finally(async () => {
    if (previousConfig === undefined) delete process.env.PI_CONFIG_DIR;
    if (previousConfig !== undefined) process.env.PI_CONFIG_DIR = previousConfig;
    if (previousCoding === undefined) delete process.env.PI_CODING_AGENT_DIR;
    if (previousCoding !== undefined) process.env.PI_CODING_AGENT_DIR = previousCoding;
    if (previousAgent === undefined) delete process.env.PI_AGENT_DIR;
    if (previousAgent !== undefined) process.env.PI_AGENT_DIR = previousAgent;
    await fs.rm(dir, { recursive: true, force: true });
  });
}

void test("resolveExtensionConfigPaths uses PI_CODING_AGENT_DIR as the agent directory", async () => {
  await withConfigEnv(async ({ cwd, agent }) => {
    const paths = resolveExtensionConfigPaths(cwd);

    assert.equal(paths.globalConfigFile, path.join(agent, "ohm.json"));
    assert.equal(paths.projectConfigFile, path.join(cwd, ".pi", "ohm.json"));
  });
});

for (const env of ["PI_CONFIG_DIR", "PI_CODING_AGENT_DIR", "PI_AGENT_DIR"] as const) {
  void test(`loadConfig resolves arbitrary global config from ${env}`, async () => {
    await withSingleConfigDir(env, async ({ cwd, agent }) => {
      await fs.writeFile(
        path.join(agent, "ohm.json"),
        JSON.stringify({ demo: { enabled: false, count: 11, label: env } }),
        "utf8",
      );

      const paths = resolveExtensionConfigPaths(cwd);
      const loaded = await loadConfig({ cwd, modules: [demo] });

      assert.equal(paths.configDir, agent);
      assert.equal(paths.globalConfigFile, path.join(agent, "ohm.json"));
      assert.equal(Result.isOk(loaded), true);
      if (Result.isError(loaded)) assert.fail(loaded.error.message);
      assert.deepEqual(loaded.value.config.demo, {
        enabled: false,
        count: 11,
        label: env,
      });
      assert.deepEqual(loaded.value.loadedFrom, [path.join(agent, "ohm.json")]);
    });
  });
}

void test("resolveExtensionConfigPaths prefers PI_CONFIG_DIR over other config dirs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-config-precedence-"));
  const cwd = path.join(dir, "repo");
  const preferred = path.join(dir, "preferred");
  await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
  await fs.mkdir(preferred, { recursive: true });

  const previousConfig = process.env.PI_CONFIG_DIR;
  const previousCoding = process.env.PI_CODING_AGENT_DIR;
  const previousAgent = process.env.PI_AGENT_DIR;
  process.env.PI_CONFIG_DIR = preferred;
  process.env.PI_CODING_AGENT_DIR = path.join(dir, "coding");
  process.env.PI_AGENT_DIR = path.join(dir, "agent");

  try {
    const paths = resolveExtensionConfigPaths(cwd);
    assert.equal(paths.configDir, preferred);
    assert.equal(paths.globalConfigFile, path.join(preferred, "ohm.json"));
  } finally {
    if (previousConfig === undefined) delete process.env.PI_CONFIG_DIR;
    if (previousConfig !== undefined) process.env.PI_CONFIG_DIR = previousConfig;
    if (previousCoding === undefined) delete process.env.PI_CODING_AGENT_DIR;
    if (previousCoding !== undefined) process.env.PI_CODING_AGENT_DIR = previousCoding;
    if (previousAgent === undefined) delete process.env.PI_AGENT_DIR;
    if (previousAgent !== undefined) process.env.PI_AGENT_DIR = previousAgent;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

void test("loadConfig merges defaults, global config, then project config", async () => {
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

    const loaded = await loadConfig({ cwd, modules: [demo] });

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

void test("ConfigRegistry registers modules and loads resolved config", async () => {
  await withConfigEnv(async ({ cwd, agent }) => {
    await fs.writeFile(
      path.join(agent, "ohm.json"),
      JSON.stringify({ demo: { enabled: false, count: 5 } }),
      "utf8",
    );

    const registry = ConfigRegistry.create({ cwd });

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

void test("ConfigRegistry rejects duplicate module namespaces", () => {
  const registry = ConfigRegistry.create({ cwd: process.cwd() });

  assert.equal(Result.isOk(registry), true);
  if (Result.isError(registry)) assert.fail(registry.error.message);

  assert.equal(Result.isOk(registry.value.register(demo)), true);

  const duplicate = registry.value.register(demo);
  assert.equal(Result.isError(duplicate), true);
});

void test("global config module registry is idempotent and sorted", () => {
  clearGlobalConfigModulesForTesting();
  const alpha = registerConfig({
    namespace: "alpha",
    schema: DemoSchema,
    defaults: { enabled: true, count: 1, label: "alpha" },
    merge(base: DemoConfig) {
      return Result.ok(base);
    },
  });

  registerGlobalConfigModule(demo);
  registerGlobalConfigModule(alpha);
  registerGlobalConfigModule(demo);

  assert.deepEqual(
    getGlobalConfigModules().map((module) => module.namespace),
    ["alpha", "demo"],
  );
  clearGlobalConfigModulesForTesting();
});

void test("loadConfig reports invalid JSON as diagnostics without crashing", async () => {
  await withConfigEnv(async ({ cwd }) => {
    await fs.writeFile(path.join(cwd, ".pi", "ohm.json"), "{ nope", "utf8");

    const loaded = await loadConfig({ cwd, modules: [demo] });

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

void test("loadConfig reports schema diagnostics and keeps last valid value", async () => {
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

    const loaded = await loadConfig({ cwd, modules: [demo] });

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

void test("watchConfig publishes debounced file changes", async () => {
  await withConfigEnv(async ({ cwd }) => {
    const file = path.join(cwd, ".pi", "ohm.json");
    await fs.writeFile(file, JSON.stringify({ demo: { count: 1 } }), "utf8");

    const watched = watchConfig({ cwd, modules: [demo], debounceMs: 30 });
    const started = await watched.start();
    assert.equal(Result.isOk(started), true);
    if (Result.isError(started)) assert.fail(started.error.message);
    assert.equal(readDemoConfig(started.value).count, 1);

    const seen: LoadedExtensionConfig[] = [];
    watched.subscribe((loaded) => {
      seen.push(loaded);
    });

    await fs.writeFile(file, JSON.stringify({ demo: { count: 2, label: "changed" } }), "utf8");
    await waitFor({
      until: () => seen.length === 1,
      message: "watchConfig did not publish file change",
    });

    const current = watched.get();
    assert.ok(current);
    assert.equal(readDemoConfig(current).count, 2);
    assert.equal(readDemoConfig(seen[0] ?? current).label, "changed");
    await watched.stop();
  });
});

void test("watchConfig stages changes while apply is blocked and flushes latest pending config", async () => {
  await withConfigEnv(async ({ cwd }) => {
    const file = path.join(cwd, ".pi", "ohm.json");
    await fs.writeFile(file, JSON.stringify({ demo: { count: 1 } }), "utf8");

    const gate = { idle: false };
    const watched = watchConfig({
      cwd,
      modules: [demo],
      canApply: () => gate.idle,
    });
    const started = await watched.start();
    assert.equal(Result.isOk(started), true);
    if (Result.isError(started)) assert.fail(started.error.message);

    const seen: LoadedExtensionConfig[] = [];
    watched.subscribe((loaded) => {
      seen.push(loaded);
    });

    await fs.writeFile(file, JSON.stringify({ demo: { count: 2 } }), "utf8");
    const stagedTwo = await watched.reload();
    assert.equal(Result.isOk(stagedTwo), true);
    if (Result.isError(stagedTwo)) assert.fail(stagedTwo.error.message);
    assert.equal(readDemoConfig(watched.get() ?? started.value).count, 1);
    assert.equal(readDemoConfig(watched.pending() ?? started.value).count, 2);
    assert.equal(seen.length, 0);

    await fs.writeFile(file, JSON.stringify({ demo: { count: 3 } }), "utf8");
    const stagedThree = await watched.reload();
    assert.equal(Result.isOk(stagedThree), true);
    if (Result.isError(stagedThree)) assert.fail(stagedThree.error.message);
    assert.equal(readDemoConfig(watched.pending() ?? started.value).count, 3);

    gate.idle = true;
    const flushed = await watched.flush();
    assert.equal(Result.isOk(flushed), true);
    if (Result.isError(flushed)) assert.fail(flushed.error.message);
    assert.equal(readDemoConfig(watched.get() ?? started.value).count, 3);
    assert.equal(watched.pending(), undefined);
    assert.equal(seen.length, 1);
    await watched.stop();
  });
});

void test("watchConfig keeps last good config when reload has diagnostics", async () => {
  await withConfigEnv(async ({ cwd }) => {
    const file = path.join(cwd, ".pi", "ohm.json");
    await fs.writeFile(file, JSON.stringify({ demo: { count: 4 } }), "utf8");

    const watched = watchConfig({ cwd, modules: [demo] });
    const started = await watched.start();
    assert.equal(Result.isOk(started), true);
    if (Result.isError(started)) assert.fail(started.error.message);
    assert.equal(readDemoConfig(started.value).count, 4);

    const seen: LoadedExtensionConfig[] = [];
    watched.subscribe((loaded) => {
      seen.push(loaded);
    });

    await fs.writeFile(file, "{ nope", "utf8");
    const reloaded = await watched.reload();
    assert.equal(Result.isOk(reloaded), true);
    if (Result.isError(reloaded)) assert.fail(reloaded.error.message);

    const current = watched.get();
    assert.ok(current);
    assert.equal(readDemoConfig(current).count, 4);
    assert.equal(current.diagnostics[0]?.kind, "invalid-json");
    assert.equal(seen.length, 1);
    assert.equal(readDemoConfig(seen[0] ?? current).count, 4);
    await watched.stop();
  });
});

void test("watchConfig unsubscribe removes subscriber", async () => {
  await withConfigEnv(async ({ cwd }) => {
    const file = path.join(cwd, ".pi", "ohm.json");
    await fs.writeFile(file, JSON.stringify({ demo: { count: 1 } }), "utf8");

    const watched = watchConfig({ cwd, modules: [demo] });
    const started = await watched.start();
    assert.equal(Result.isOk(started), true);
    if (Result.isError(started)) assert.fail(started.error.message);

    const seen: LoadedExtensionConfig[] = [];
    const unsubscribe = watched.subscribe((loaded) => {
      seen.push(loaded);
    });
    unsubscribe();

    await fs.writeFile(file, JSON.stringify({ demo: { count: 5 } }), "utf8");
    const reloaded = await watched.reload();
    assert.equal(Result.isOk(reloaded), true);
    if (Result.isError(reloaded)) assert.fail(reloaded.error.message);

    assert.equal(readDemoConfig(watched.get() ?? started.value).count, 5);
    assert.equal(seen.length, 0);
    await watched.stop();
  });
});
