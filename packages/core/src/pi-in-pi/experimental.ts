export type PromptValue = string | number | boolean | bigint | PipPrompt | readonly PromptValue[];

export type PromptVars = Record<string, PromptValue>;

export interface PromptOptions {
  readonly trim?: boolean;
}

export interface PipPrompt {
  readonly text: string;
  toString(): string;
}

export function setPrompt(input: PromptOptions = {}) {
  return (strings: TemplateStringsArray, ...values: readonly PromptValue[]): PipPrompt =>
    createPrompt(renderTemplate(strings, values), input);
}

export function definePrompt<T extends PromptVars>(
  render: (input: T) => PipPrompt,
): (input: T) => PipPrompt {
  return render;
}

export function promptText(input: string | PipPrompt): string {
  if (typeof input === "string") return input;
  return input.text;
}

export function promptOptional(input: PromptValue | null | undefined, fallback = ""): PipPrompt {
  return createPrompt(input === null || input === undefined ? fallback : renderValue(input), {
    trim: false,
  });
}

export function promptJson(input: unknown): PipPrompt {
  return createPrompt(JSON.stringify(input, null, 2));
}

function createPrompt(input: string, options: PromptOptions = {}): PipPrompt {
  const text = options.trim === false ? input : stripIndent(input);
  return {
    text,
    toString() {
      return text;
    },
  };
}

function renderTemplate(strings: TemplateStringsArray, values: readonly PromptValue[]): string {
  return strings.reduce((text, part, index) => {
    const value = values[index];
    if (index === values.length) return `${text}${part}`;
    const next = `${text}${part}`;
    return `${next}${renderValueAtIndent(value, next)}`;
  }, "");
}

function renderValueAtIndent(value: PromptValue, text: string): string {
  const rendered = renderValue(value);
  const line = text.slice(text.lastIndexOf("\n") + 1);
  if (!/^\s+$/.test(line)) return rendered;
  return rendered.replaceAll("\n", `\n${line}`);
}

function renderValue(value: PromptValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map(renderValue).filter(Boolean).join("\n");
  if (isPrompt(value)) return value.text;
  return "";
}

function isPrompt(value: unknown): value is PipPrompt {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  return typeof Reflect.get(value, "text") === "string";
}

function lastContentIndex(lines: readonly string[]): number {
  const reversed = [...lines].reverse();
  const offset = reversed.findIndex((line) => line.trim().length > 0);
  if (offset === -1) return -1;
  return lines.length - offset - 1;
}

function stripIndent(input: string): string {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const trimmed = trimBlankEdges(lines);
  const indent = commonIndent(trimmed);
  return trimmed.map((line) => line.slice(indent)).join("\n");
}

function trimBlankEdges(lines: readonly string[]): readonly string[] {
  const start = lines.findIndex((line) => line.trim().length > 0);
  if (start === -1) return [];
  const end = lastContentIndex(lines);
  return lines.slice(start, end + 1);
}

function commonIndent(lines: readonly string[]): number {
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  if (indents.length === 0) return 0;
  return Math.min(...indents);
}
