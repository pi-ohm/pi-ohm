import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["**/dist/**", "**/src_legacy/**"],
    options: { typeAware: true, typeCheck: true },
  },
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
    ignorePatterns: ["docs/src/routeTree.gen.ts", "packages/*/CHANGELOG.md"],
  },
  test: {
    include: ["**/*.vitest.ts"],
    passWithNoTests: true,
  },
});
