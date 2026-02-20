import type { TaskBackendSendInput, TaskBackendStartInput } from "./types";

export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, maxLength - 1) + "…";
}

export function buildStartPrompt(input: TaskBackendStartInput): string {
  return [
    `You are the ${input.subagent.name} subagent in Pi OHM.`,
    "",
    `Subagent summary: ${input.subagent.summary}`,
    "When to use:",
    ...input.subagent.whenToUse.map((line) => `- ${line}`),
    "",
    "Profile scaffold guidance:",
    input.subagent.scaffoldPrompt,
    "",
    `Task description: ${input.description}`,
    "",
    "User task:",
    input.prompt,
    "",
    "Return concrete findings/results. Avoid repeating this prompt verbatim.",
  ].join("\n");
}

export function buildSendPrompt(input: TaskBackendSendInput): string {
  const priorPrompts = [input.initialPrompt, ...input.followUpPrompts]
    .map((prompt, index) => `${index + 1}. ${prompt}`)
    .join("\n");

  return [
    `You are continuing the ${input.subagent.name} subagent task.`,
    `Task description: ${input.description}`,
    "",
    "Task history:",
    priorPrompts,
    "",
    "Latest follow-up request:",
    input.prompt,
    "",
    "Return only the updated findings/result.",
  ].join("\n");
}
