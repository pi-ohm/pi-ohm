import type { PipRunner } from "@pi-ohm/core/pip";

export const packageName = "@pi-ohm/pip-flue";

export interface FluePipRunnerInput {
  readonly baseUrl: string;
  readonly agentName: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly token?: string;
}

export type FluePipRunnerFactory = (input: FluePipRunnerInput) => PipRunner;
