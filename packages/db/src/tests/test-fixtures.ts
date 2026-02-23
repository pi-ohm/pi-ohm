import test from "node:test";

export function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}
