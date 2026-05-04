import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: { options: { typeAware: true, typeCheck: true } },
  pack: {
    format: ["esm"],
    outDir: "dist",
    dts: true,
    sourcemap: false,
    minify: false,
    treeshake: false,
    unbundle: true,
    fixedExtension: false,
    clean: true,
    hash: false,
    failOnWarn: "ci-only",
    report: false,
  },
  fmt: {
    ignorePatterns: [],
  },
  test: {
    include: ["**/*.vitest.ts"],
    passWithNoTests: true,
  },
});
