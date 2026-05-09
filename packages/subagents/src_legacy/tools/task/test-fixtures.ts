import test from "node:test";

export function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

export function stripAnsi(value: string): string {
  return value
    .split("\u001b[1m")
    .join("")
    .split("\u001b[22m")
    .join("")
    .split("\u001b[4m")
    .join("")
    .split("\u001b[24m")
    .join("")
    .split("\u001b[31m")
    .join("")
    .split("\u001b[32m")
    .join("")
    .split("\u001b[39m")
    .join("")
    .split("\u001b[0m")
    .join("");
}
