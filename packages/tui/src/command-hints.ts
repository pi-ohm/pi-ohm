import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  setOhmInputStatus,
  type OhmInputStatusColor,
  type OhmInputStatusContent,
  type OhmInputStatusContext,
  type OhmInputStatusInput,
  type OhmInputStatusSegment,
} from "./input-status";

export type OhmCommandCompletionResult = AutocompleteItem[] | null;
export type OhmCommandCompletionAwaitable =
  | OhmCommandCompletionResult
  | Promise<OhmCommandCompletionResult>;

export interface OhmCommandValue {
  readonly value: string;
  readonly label?: string;
  readonly description?: string;
}

export interface OhmCommandCompletionContext<State = unknown> {
  readonly prefix: string;
  readonly query: string;
  readonly tokens: readonly string[];
  readonly positionals: readonly string[];
  readonly variant: OhmCommandVariant<State> | undefined;
  readonly argument: OhmCommandArgument<State> | undefined;
  readonly flag: OhmCommandFlag<State> | undefined;
  readonly state: State | undefined;
}

export interface OhmCommandArgument<State = unknown> {
  readonly name: string;
  readonly placeholder?: string;
  readonly description?: string;
  readonly optional?: boolean;
  readonly repeat?: boolean;
  readonly values?: readonly OhmCommandValue[];
  complete?(context: OhmCommandCompletionContext<State>): OhmCommandCompletionAwaitable;
}

export interface OhmCommandFlag<State = unknown> {
  readonly name: `--${string}`;
  readonly aliases?: readonly `-${string}`[];
  readonly description?: string;
  readonly value?: OhmCommandArgument<State>;
}

export interface OhmCommandVariant<State = unknown> {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly summary?: string;
  readonly args?: readonly OhmCommandArgument<State>[];
  readonly flags?: readonly OhmCommandFlag<State>[];
}

export interface OhmCommandSpec<State = unknown> {
  readonly name: string;
  readonly summary: string;
  readonly args?: readonly OhmCommandArgument<State>[];
  readonly flags?: readonly OhmCommandFlag<State>[];
  readonly variants?: readonly OhmCommandVariant<State>[];
}

export interface OhmCommandHintRenderInput<State = unknown> {
  readonly specs: readonly OhmCommandSpec<State>[];
  readonly text: string;
}

export interface OhmCommandHintContext extends OhmInputStatusContext {
  readonly ui: OhmInputStatusContext["ui"] & {
    getEditorText?(): string;
  };
}

export interface OhmCommandHintInstallInput<State = unknown> {
  readonly key: string;
  readonly specs: readonly OhmCommandSpec<State>[];
  readonly priority?: number;
  readonly refreshMs?: number;
  readonly color?: OhmInputStatusColor;
  readonly borderColor?: OhmInputStatusColor;
  readonly footerText?: string;
}

interface Token {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

interface ParsedPrefix {
  readonly prefix: string;
  readonly tokens: readonly Token[];
  readonly trailingWhitespace: boolean;
  readonly query: string;
}

interface ActiveCommand<State> {
  readonly spec: OhmCommandSpec<State>;
  readonly variant: OhmCommandVariant<State> | undefined;
  readonly variantToken: Token | undefined;
  readonly args: readonly Token[];
}

export function defineOhmCommand<State>(spec: OhmCommandSpec<State>): OhmCommandSpec<State> {
  return spec;
}

function tokenize(prefix: string): readonly Token[] {
  return Array.from(prefix.matchAll(/\S+/gu), (match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function parsePrefix(prefix: string): ParsedPrefix {
  const tokens = tokenize(prefix);
  const last = tokens[tokens.length - 1];
  const trailingWhitespace = /\s$/u.test(prefix);
  return {
    prefix,
    tokens,
    trailingWhitespace,
    query: trailingWhitespace ? "" : (last?.value ?? ""),
  };
}

function valueItem(value: OhmCommandValue, description: string | undefined): AutocompleteItem {
  return {
    value: value.value,
    label: value.label ?? value.value,
    description: value.description ?? description,
  };
}

function filterItems(
  items: readonly AutocompleteItem[],
  query: string,
): readonly AutocompleteItem[] {
  const normalized = query.toLowerCase();
  if (normalized.length === 0) return items;
  return items.filter((item) => {
    const value = item.value.toLowerCase();
    const label = item.label.toLowerCase();
    return value.startsWith(normalized) || label.startsWith(normalized);
  });
}

function variantMatches<State>(variant: OhmCommandVariant<State>, token: string): boolean {
  return variant.name === token || (variant.aliases ?? []).includes(token);
}

function flagMatches<State>(flag: OhmCommandFlag<State>, token: string): boolean {
  return flag.name === token || (flag.aliases ?? []).some((alias) => alias === token);
}

function flagByToken<State>(
  flags: readonly OhmCommandFlag<State>[],
  token: string | undefined,
): OhmCommandFlag<State> | undefined {
  if (token === undefined) return undefined;
  return flags.find((flag) => flagMatches(flag, token));
}

function commandFlags<State>(input: ActiveCommand<State>): readonly OhmCommandFlag<State>[] {
  return input.variant?.flags ?? input.spec.flags ?? [];
}

function commandArgs<State>(input: ActiveCommand<State>): readonly OhmCommandArgument<State>[] {
  return input.variant?.args ?? input.spec.args ?? [];
}

function activeCommand<State>(
  spec: OhmCommandSpec<State>,
  parsed: ParsedPrefix,
): ActiveCommand<State> {
  const first = parsed.tokens[0];
  const variant = first
    ? spec.variants?.find((entry) => variantMatches(entry, first.value))
    : undefined;
  return {
    spec,
    variant,
    variantToken: variant ? first : undefined,
    args: variant ? parsed.tokens.slice(1) : parsed.tokens,
  };
}

function collectPositionals<State>(
  tokens: readonly Token[],
  flags: readonly OhmCommandFlag<State>[],
  index = 0,
): readonly Token[] {
  const token = tokens[index];
  if (token === undefined) return [];

  const flag = flagByToken(flags, token.value);
  if (flag?.value) return collectPositionals(tokens, flags, index + 2);
  if (flag) return collectPositionals(tokens, flags, index + 1);
  return [token, ...collectPositionals(tokens, flags, index + 1)];
}

function flagExpectingValue<State>(
  tokens: readonly Token[],
  flags: readonly OhmCommandFlag<State>[],
  trailingWhitespace: boolean,
): OhmCommandFlag<State> | undefined {
  const previous = trailingWhitespace ? tokens[tokens.length - 1] : tokens[tokens.length - 2];
  const flag = flagByToken(flags, previous?.value);
  if (!flag?.value) return undefined;
  return flag;
}

function currentArgument<State>(input: {
  readonly args: readonly OhmCommandArgument<State>[];
  readonly positionals: readonly Token[];
  readonly query: string;
  readonly trailingWhitespace: boolean;
}): OhmCommandArgument<State> | undefined {
  const index = input.trailingWhitespace
    ? input.positionals.length
    : Math.max(0, input.positionals.length - 1);
  const argument = input.args[index] ?? input.args[input.args.length - 1];
  if (argument?.repeat) return argument;
  return input.args[index];
}

function contextFor<State>(input: {
  readonly parsed: ParsedPrefix;
  readonly command: ActiveCommand<State>;
  readonly argument: OhmCommandArgument<State> | undefined;
  readonly flag: OhmCommandFlag<State> | undefined;
  readonly state: State | undefined;
  readonly positionals: readonly Token[];
}): OhmCommandCompletionContext<State> {
  return {
    prefix: input.parsed.prefix,
    query: input.parsed.query,
    tokens: input.command.args.map((token) => token.value),
    positionals: input.positionals.map((token) => token.value),
    variant: input.command.variant,
    argument: input.argument,
    flag: input.flag,
    state: input.state,
  };
}

async function completeArgument<State>(
  argument: OhmCommandArgument<State>,
  context: OhmCommandCompletionContext<State>,
): Promise<readonly AutocompleteItem[]> {
  const dynamic = argument.complete ? await argument.complete(context) : undefined;
  if (dynamic) return filterItems(dynamic, context.query);
  return filterItems(
    (argument.values ?? []).map((value) => valueItem(value, argument.description)),
    context.query,
  );
}

function variantItems<State>(
  variants: readonly OhmCommandVariant<State>[],
  query: string,
): readonly AutocompleteItem[] {
  return filterItems(
    variants.map((variant) => ({
      value: variant.name,
      label: variant.name,
      description: variant.summary,
    })),
    query,
  );
}

function flagItems<State>(
  flags: readonly OhmCommandFlag<State>[],
  query: string,
): readonly AutocompleteItem[] {
  return filterItems(
    flags.map((flag) => ({
      value: flag.name,
      label: flag.name,
      description: flag.description,
    })),
    query,
  );
}

function completeLineItem(parsed: ParsedPrefix, item: AutocompleteItem): AutocompleteItem {
  if (parsed.trailingWhitespace) {
    return { ...item, value: `${parsed.prefix}${item.value}` };
  }

  const token = parsed.tokens[parsed.tokens.length - 1];
  if (token === undefined) return item;

  return {
    ...item,
    value: `${parsed.prefix.slice(0, token.start)}${item.value}${parsed.prefix.slice(token.end)}`,
  };
}

function completeLineItems(
  parsed: ParsedPrefix,
  items: readonly AutocompleteItem[],
): readonly AutocompleteItem[] {
  return items.map((item) => completeLineItem(parsed, item));
}

function completeResult(items: readonly AutocompleteItem[]): OhmCommandCompletionResult {
  if (items.length === 0) return null;
  return [...items];
}

export async function completeOhmCommandArguments<State>(input: {
  readonly spec: OhmCommandSpec<State>;
  readonly prefix: string;
  readonly state?: State;
}): Promise<OhmCommandCompletionResult> {
  const parsed = parsePrefix(input.prefix);

  if (input.spec.variants && !parsed.trailingWhitespace && parsed.tokens.length <= 1) {
    return completeResult(variantItems(input.spec.variants, parsed.query));
  }

  const command = activeCommand(input.spec, parsed);
  if (input.spec.variants && command.variant === undefined) {
    return completeResult(variantItems(input.spec.variants, parsed.query));
  }

  if (!parsed.trailingWhitespace && parsed.query.startsWith("--")) {
    return completeResult(
      completeLineItems(parsed, flagItems(commandFlags(command), parsed.query)),
    );
  }

  const valueFlag = flagExpectingValue(
    command.args,
    commandFlags(command),
    parsed.trailingWhitespace,
  );
  if (valueFlag?.value) {
    const context = contextFor({
      parsed,
      command,
      argument: valueFlag.value,
      flag: valueFlag,
      state: input.state,
      positionals: collectPositionals(command.args, commandFlags(command)),
    });
    return completeResult(
      completeLineItems(parsed, await completeArgument(valueFlag.value, context)),
    );
  }

  if (parsed.trailingWhitespace) {
    const flags = flagItems(commandFlags(command), "");
    if (flags.length > 0) return completeResult(completeLineItems(parsed, flags));
  }

  const positionals = collectPositionals(command.args, commandFlags(command));
  const argument = currentArgument({
    args: commandArgs(command),
    positionals,
    query: parsed.query,
    trailingWhitespace: parsed.trailingWhitespace,
  });
  if (!argument) return null;

  const context = contextFor({
    parsed,
    command,
    argument,
    flag: undefined,
    state: input.state,
    positionals,
  });
  return completeResult(completeLineItems(parsed, await completeArgument(argument, context)));
}

export function createOhmCommandArgumentCompletions<State>(input: {
  readonly spec: OhmCommandSpec<State>;
  readonly getState?: () => State;
}): (prefix: string) => Promise<AutocompleteItem[] | null> {
  return (prefix) =>
    completeOhmCommandArguments({
      spec: input.spec,
      prefix,
      state: input.getState?.(),
    });
}

function argumentToken<State>(argument: OhmCommandArgument<State>): string {
  const label = argument.placeholder ?? argument.name;
  const token = argument.repeat ? `${label}...` : label;
  if (argument.optional) return `[${token}]`;
  return `<${token}>`;
}

function flagToken<State>(flag: OhmCommandFlag<State>): string {
  if (!flag.value) return `[${flag.name}]`;
  return `[${flag.name} ${argumentToken(flag.value)}]`;
}

function variantSuffix<State>(variant: OhmCommandVariant<State>): string {
  const args = variant.args ?? [];
  const flags = variant.flags ?? [];
  const suffix = [...args.map(argumentToken), ...flags.map(flagToken)].join(" ");
  if (suffix.length === 0) return "";
  return ` ${suffix}`;
}

export function renderOhmCommandArgumentHint<State>(spec: OhmCommandSpec<State>): string {
  if (spec.variants) return `<${spec.variants.map((variant) => variant.name).join("|")}>`;
  return [...(spec.args ?? []).map(argumentToken), ...(spec.flags ?? []).map(flagToken)].join(" ");
}

function slashCommand(text: string): { readonly name: string; readonly args: string } | undefined {
  const line = text.split("\n")[0] ?? "";
  const match = line.match(/^\/([^\s]+)(?:\s+(.*))?$/u);
  if (!match) return undefined;
  const name = match[1];
  if (name === undefined) return undefined;
  return { name, args: match[2] ?? "" };
}

function hintSegments<State>(input: {
  readonly spec: OhmCommandSpec<State>;
  readonly args: string;
}): readonly OhmInputStatusSegment[] {
  const parsed = parsePrefix(input.args);
  const command = activeCommand(input.spec, parsed);

  if (input.spec.variants && command.variant === undefined) {
    return [
      { text: `/${input.spec.name} `, color: "dim" },
      {
        text: `<${input.spec.variants.map((variant) => variant.name).join("|")}>`,
        color: "accent",
      },
    ];
  }

  if (command.variant) {
    return [
      { text: `/${input.spec.name} `, color: "dim" },
      { text: command.variant.name, color: "accent" },
      { text: variantSuffix(command.variant), color: "muted" },
    ];
  }

  const hint = renderOhmCommandArgumentHint(input.spec);
  if (hint.length === 0) return [{ text: `/${input.spec.name}`, color: "accent" }];
  return [
    { text: `/${input.spec.name} `, color: "dim" },
    { text: hint, color: "accent" },
  ];
}

export function renderOhmCommandHint<State>(
  input: OhmCommandHintRenderInput<State>,
): OhmInputStatusContent | undefined {
  const command = slashCommand(input.text);
  if (!command) return undefined;
  const spec = input.specs.find((entry) => entry.name === command.name);
  if (!spec) return undefined;
  return hintSegments({ spec, args: command.args });
}

export function setOhmCommandHints<State>(
  ctx: OhmCommandHintContext,
  input: OhmCommandHintInstallInput<State>,
): void {
  const status: OhmInputStatusInput = {
    key: input.key,
    text: () => {
      const text = ctx.ui.getEditorText?.();
      if (text === undefined) return undefined;
      return renderOhmCommandHint({ specs: input.specs, text });
    },
    footerText: input.footerText,
    priority: input.priority,
    refreshMs: input.refreshMs ?? 150,
    color: input.color,
    borderColor: input.borderColor,
  };
  setOhmInputStatus(ctx, status);
}

export function clearOhmCommandHints(ctx: OhmCommandHintContext, key: string): void {
  setOhmInputStatus(ctx, { key, text: undefined });
}
