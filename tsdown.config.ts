import { defineConfig } from "tsdown";

export default defineConfig((options) => {
  const isWatch = options.watch;

  return {
    workspace: {
      include: ["packages/*"],
    },
    format: ["esm"],
    outDir: "dist",
    dts: true,
    sourcemap: isWatch,
    minify: !isWatch,
    clean: true,
    hash: false,
    failOnWarn: "ci-only",
    report: false,
  };
});
