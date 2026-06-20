import type { TSchema } from "typebox";
import { GoalConfigSchema } from "../../../packages/goal/src/config";
import { HandoffConfigSchema } from "../../../packages/handoff/src/config";
import { ModesConfigSchema } from "../../../packages/modes/src/config";
import { PainterConfigSchema } from "../../../packages/painter/src/config";
import { ProfilerConfigSchema } from "../../../packages/profiler/src/config";
import { ReferencesConfigSchema } from "../../../packages/references/src/config";
import { SessionSearchConfigSchema } from "../../../packages/session-search/src/config";
import { SubagentsConfigSchema } from "../../../packages/subagents/src/config";

interface SchemaSource {
  readonly key: string;
  readonly namespace: string;
  readonly title: string;
  readonly schema: TSchema;
}

const sources = [
  {
    key: "subagents",
    namespace: "subagents",
    title: "pi-ohm subagents config",
    schema: SubagentsConfigSchema,
  },
  {
    key: "modes",
    namespace: "modes",
    title: "pi-ohm modes config",
    schema: ModesConfigSchema,
  },
  {
    key: "painter",
    namespace: "painter",
    title: "pi-ohm painter config",
    schema: PainterConfigSchema,
  },
  {
    key: "handoff",
    namespace: "handoff",
    title: "pi-ohm handoff config",
    schema: HandoffConfigSchema,
  },
  {
    key: "session-search",
    namespace: "session-search",
    title: "pi-ohm session-search config",
    schema: SessionSearchConfigSchema,
  },
  {
    key: "references",
    namespace: "references",
    title: "pi-ohm references config",
    schema: ReferencesConfigSchema,
  },
  {
    key: "profiler",
    namespace: "profiler",
    title: "pi-ohm profiler config",
    schema: ProfilerConfigSchema,
  },
  {
    key: "goal",
    namespace: "goal",
    title: "pi-ohm goal config",
    schema: GoalConfigSchema,
  },
] as const satisfies readonly SchemaSource[];

type Key = (typeof sources)[number]["key"];

type SchemaDoc = {
  readonly $schema: "https://json-schema.org/draft/2020-12/schema";
  readonly $id: string;
  readonly title: string;
  readonly type: "object";
  readonly additionalProperties: boolean;
  readonly properties: Record<string, unknown>;
};

const schemaProperty = { type: "string" };
const keys = sources.map((source) => source.key);

function isKey(value: string): value is Key {
  return sources.some((source) => source.key === value);
}

function sourceForKey(key: Key): SchemaSource {
  const source = sources.find((candidate) => candidate.key === key);
  if (source) return source;
  throw new Error(`Unknown schema key '${key}'`);
}

function parseList(value: string): { readonly keys: readonly Key[] } | { readonly error: string } {
  const list = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  if (list.length === 0) return { error: "empty schema selector" };
  if (list.includes("all")) return { keys };

  const values = list.reduce<readonly Key[] | undefined>((acc, item) => {
    if (!acc) return undefined;
    if (!isKey(item)) return undefined;
    if (acc.includes(item)) return acc;
    return [...acc, item];
  }, []);

  if (!values) return { error: "invalid schema selector value" };
  return { keys: values };
}

function parsePath(
  pathname: string,
): { readonly keys: readonly Key[] } | { readonly error: string } {
  const path = pathname.trim().toLowerCase();

  if (path === "/schema" || path === "/schema/" || path === "/schema.json") {
    return { keys };
  }

  if (!path.startsWith("/schema/")) {
    return { error: "invalid path" };
  }

  const raw = path.slice("/schema/".length).trim();
  if (raw.length === 0) return { keys };

  const value = raw.endsWith(".json") ? raw.slice(0, -".json".length) : raw;
  const decoded = value.replaceAll("%2c", ",");
  if (decoded === "all") return { keys };

  return parseList(decoded);
}

function corsHeaders(): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return headers;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = corsHeaders();
  headers.set("content-type", "application/schema+json; charset=utf-8");
  headers.set("cache-control", "public, max-age=300");

  const extra = new Headers(init.headers);
  for (const [k, v] of extra.entries()) headers.set(k, v);

  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers,
  });
}

function schemaId(keys: readonly Key[]): string {
  if (keys.length === 1) return `https://ohm.moe/schema/${keys[0]}.json`;
  return "https://ohm.moe/schema/all.json";
}

function schemaTitle(keys: readonly Key[]): string {
  if (keys.length === 1) return sourceForKey(keys[0]).title;
  return "pi-ohm combined config schema";
}

function schemaProperties(keys: readonly Key[]): Record<string, unknown> {
  return keys.reduce<Record<string, unknown>>(
    (properties, key) => {
      const source = sourceForKey(key);
      return { ...properties, [source.namespace]: source.schema };
    },
    { $schema: schemaProperty },
  );
}

function build(keys: readonly Key[]): SchemaDoc {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: schemaId(keys),
    title: schemaTitle(keys),
    type: "object",
    additionalProperties: false,
    properties: schemaProperties(keys),
  };
}

export default {
  fetch(request: Request): Response {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "GET") {
      return json({ error: "method not allowed" }, { status: 405 });
    }

    const url = new URL(request.url);
    const parsed = parsePath(url.pathname);
    if ("error" in parsed) {
      return json(
        {
          error: parsed.error,
          usage: "/schema/subagents,modes or /schema/all or /schema.json",
          available: keys,
        },
        { status: 400 },
      );
    }

    return json(build(parsed.keys));
  },
};
