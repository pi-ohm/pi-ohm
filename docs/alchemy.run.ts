import alchemy from "alchemy";
import { Vite } from "alchemy/cloudflare";
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

const stage = resolveStage();
const domain = resolveDomain(stage);

const app = await alchemy("pi-ohm-docs", {
  stage,
  adopt: true,
  stateStore: (scope) => new CloudflareStateStore(scope),
});

export const docs = await Vite("docs", {
  adopt: true,
  build: "yarn build",
  assets: ".output/public",
  compatibility: "node",
  spa: true,
  domains: domain ? [domain] : undefined,
  url: domain ? false : true,
});

console.log({
  stage,
  domain: domain ?? "workers.dev",
  url: docs.url,
});

await app.finalize();
