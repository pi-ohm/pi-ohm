import { defineConfig } from "tsdown";

export default defineConfig({
  workspace: {
    include: ["packages/*"],
  },
  format: ["esm"],
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  hash: false,
  unbundle: true,
  failOnWarn: false,
  report: false,
});
