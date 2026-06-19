export type OhmInputStatusMode = "tui" | "rpc" | "json" | "print";

export interface OhmInputStatusOptions {
  readonly priority?: number;
}

export interface OhmInputStatusUI {
  setStatus(key: string, text: string | undefined): void;
  setInputStatus?(key: string, text: string | undefined, options?: OhmInputStatusOptions): void;
}

export interface OhmInputStatusContext {
  readonly hasUI: boolean;
  readonly mode?: OhmInputStatusMode;
  readonly ui: OhmInputStatusUI;
}

export interface OhmInputStatusInput {
  readonly key: string;
  readonly text: string | undefined;
  readonly footerText?: string;
  readonly priority?: number;
}

function canUseInputStatus(ctx: OhmInputStatusContext): boolean {
  if (typeof ctx.ui.setInputStatus !== "function") return false;
  if (ctx.mode === undefined) return true;
  return ctx.mode === "tui";
}

export function setOhmInputStatus(ctx: OhmInputStatusContext, input: OhmInputStatusInput): void {
  if (!ctx.hasUI) return;

  if (canUseInputStatus(ctx)) {
    ctx.ui.setInputStatus?.(input.key, input.text, { priority: input.priority });
    return;
  }

  const fallbackText = input.text === undefined ? undefined : (input.footerText ?? input.text);
  ctx.ui.setStatus(input.key, fallbackText);
}
