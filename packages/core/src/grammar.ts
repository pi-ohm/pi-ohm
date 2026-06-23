export function pluralSuffix(count: number): "" | "s" {
  return count === 1 ? "" : "s";
}

export function withCountNoun(input: {
  readonly count: number;
  readonly singular: string;
  readonly plural?: string;
}): string {
  const noun = input.plural ?? `${input.singular}${pluralSuffix(input.count)}`;
  return `${input.count} ${noun}`;
}
