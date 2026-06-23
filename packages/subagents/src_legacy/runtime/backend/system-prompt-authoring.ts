export interface SystemPromptSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

export interface ComposeSystemPromptInput {
  readonly runtimeLabel: string;
  readonly providerProfileLabel: string;
  readonly sharedConstraints: readonly string[];
  readonly providerGuidance: readonly string[];
}

function renderSection(section: SystemPromptSection): readonly string[] {
  const rendered: string[] = [section.heading];
  for (const line of section.lines) {
    rendered.push(`- ${line}`);
  }

  return rendered;
}

export function composeSubagentSystemPrompt(input: ComposeSystemPromptInput): string {
  const sections: readonly SystemPromptSection[] = [
    {
      heading: "Shared runtime constraints:",
      lines: input.sharedConstraints,
    },
    {
      heading: "Provider-specific guidance:",
      lines: input.providerGuidance,
    },
  ];

  const lines: string[] = [
    `You are the ${input.runtimeLabel}.`,
    `Provider profile: ${input.providerProfileLabel}`,
    "",
  ];

  for (const [index, section] of sections.entries()) {
    lines.push(...renderSection(section));
    if (index < sections.length - 1) {
      lines.push("");
    }
  }

  return lines.join("\n");
}
