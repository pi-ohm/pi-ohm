import alchemy from "alchemy";
import { Vite, Worker } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";

function readNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function resolveStage(): string {
  return readNonEmptyEnv("STAGE") ?? "dev";
}

function resolveDomain(stage: string): string | undefined {
  const devDomain = readNonEmptyEnv("DOCS_DEV_DOMAIN") ?? "dev.ohm.moe";
  const prodDomain = readNonEmptyEnv("DOCS_PROD_DOMAIN") ?? "ohm.moe";

  if (stage === "dev") return devDomain;
  if (stage === "prod") return prodDomain;
  return undefined;
}

function readFlag(name: string): boolean {
  const value = readNonEmptyEnv(name);
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const stage = resolveStage();
const domain = resolveDomain(stage);
const useSchemaWorkerDemo = readFlag("DOCS_ENABLE_SCHEMA_WORKER_DEMO");

const docsRoute = domain ? `${domain}/*` : undefined;
const schemaRoute = domain ? `${domain}/api/schema*` : undefined;
const useRouteMode = useSchemaWorkerDemo && docsRoute !== undefined && schemaRoute !== undefined;

const app = await alchemy("pi-ohm-docs", {
  stage,
  adopt: true,
  stateStore: (scope) => new CloudflareStateStore(scope),
});

export const schema = await Worker("schema", {
  adopt: true,
  entrypoint: "src/workers/schema.ts",
  compatibility: "node",
  url: true,
  routes: useRouteMode && schemaRoute ? [schemaRoute] : undefined,
});

export const docs = await Vite("docs", {
  adopt: true,
  build: "yarn build",
  assets: ".output/public",
  compatibility: "node",
  spa: true,
  domains: useRouteMode ? undefined : domain ? [domain] : undefined,
  routes: useRouteMode && docsRoute ? [docsRoute] : undefined,
  url: domain ? false : true,
});

console.log({
  stage,
  domain: domain ?? "workers.dev",
  docsUrl: docs.url,
  schemaUrl: schema.url,
  schemaRoute: useRouteMode ? schemaRoute : undefined,
  routeMode: useRouteMode,
  routeModeEnv: "DOCS_ENABLE_SCHEMA_WORKER_DEMO",
});

await app.finalize();
