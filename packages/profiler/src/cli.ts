import { Result } from "better-result";
import { resolveExtensionConfigDir } from "@pi-ohm/core/config";
import { profileStartup } from "./benchmark";
import { REPORT_MARKER } from "./report";

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

async function main(args: readonly string[]): Promise<number> {
  const cwd = readOption(args, "--cwd") ?? process.cwd();
  const agentDir = readOption(args, "--agent-dir") ?? resolveExtensionConfigDir();
  const includeLifecycle = !args.includes("--no-lifecycle");
  const report = await profileStartup({ cwd, agentDir, includeLifecycle });

  if (Result.isError(report)) {
    process.stderr.write(`${report.error.message}\n`);
    return 1;
  }

  process.stdout.write(`${REPORT_MARKER}${JSON.stringify(report.value)}\n`);
  return 0;
}

const code = await main(process.argv.slice(2));
if (code !== 0) process.exitCode = code;
