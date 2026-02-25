const keys = ["subagents", "modes", "painter", "handoff", "session-search"] as const;
type Key = (typeof keys)[number];

type SchemaDoc = {
  $schema: "https://json-schema.org/draft/2020-12/schema";
  $id: string;
  title: string;
  type: "object";
  additionalProperties: boolean;
  properties: Record<string, unknown>;
  required?: string[];
};

const schemas: Record<Key, SchemaDoc> = {
  subagents: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://ohm.moe/schemas/subagents.json",
    title: "pi-ohm subagents config",
    type: "object",
    additionalProperties: false,
    properties: {
      subagents: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            model: { type: "string" },
          },
        },
      },
    },
  },
  modes: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://ohm.moe/schemas/modes.json",
    title: "pi-ohm modes config",
    type: "object",
    additionalProperties: false,
    properties: {
      modes: {
        type: "object",
        properties: {
          default: { enum: ["rush", "smart", "deep"] },
        },
      },
    },
  },
  painter: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://ohm.moe/schemas/painter.json",
    title: "pi-ohm painter config",
    type: "object",
    additionalProperties: false,
    properties: {
      painter: {
        type: "object",
        properties: {
          provider: { type: "string" },
          model: { type: "string" },
        },
      },
    },
  },
  handoff: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://ohm.moe/schemas/handoff.json",
    title: "pi-ohm handoff config",
    type: "object",
    additionalProperties: false,
    properties: {
      handoff: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
        },
      },
    },
  },
  "session-search": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://ohm.moe/schemas/session-search.json",
    title: "pi-ohm session-search config",
    type: "object",
    additionalProperties: false,
    properties: {
      sessionSearch: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
        },
      },
    },
  },
};

function toKey(value: string): Key | undefined {
  if (value === "subagents") return "subagents";
  if (value === "modes") return "modes";
  if (value === "painter") return "painter";
  if (value === "handoff") return "handoff";
  if (value === "session-search") return "session-search";
  return undefined;
}

function parseList(value: string): { keys: Key[] } | { error: string } {
  const list = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  if (list.length === 0) return { error: "empty schema selector" };
  if (list.includes("all")) return { keys: [...keys] };

  const values = list.reduce<Key[] | undefined>((acc, item) => {
    if (!acc) return undefined;
    const key = toKey(item);
    if (!key) return undefined;
    if (acc.includes(key)) return acc;
    return [...acc, key];
  }, []);

  if (!values) return { error: "invalid schema selector value" };
  return { keys: values };
}

function parsePath(pathname: string): { keys: Key[] } | { error: string } {
  const path = pathname.trim().toLowerCase();

  if (path === "/schema" || path === "/schema/" || path === "/schema.json") {
    return { keys: [...keys] };
  }

  if (!path.startsWith("/schema/")) {
    return { error: "invalid path" };
  }

  const raw = path.slice("/schema/".length).trim();
  if (raw.length === 0) return { keys: [...keys] };

  const value = raw.endsWith(".json") ? raw.slice(0, -".json".length) : raw;
  const decoded = value.replaceAll("%2c", ",");
  if (decoded === "all") return { keys: [...keys] };

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

function build(keys: Key[]): SchemaDoc {
  if (keys.length === 1) return schemas[keys[0]];

  const properties = keys.reduce<Record<string, unknown>>(
    (acc, key) => ({ ...acc, [key]: schemas[key] }),
    {},
  );

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://ohm.moe/schemas/all.json",
    title: "pi-ohm combined config schema",
    type: "object",
    additionalProperties: false,
    properties,
    required: [...keys],
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
          available: [...keys],
        },
        { status: 400 },
      );
    }

    return json(build(parsed.keys));
  },
};
