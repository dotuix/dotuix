import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Don't bundle @dotuix/core — keep it as a peer dep so updates flow through
  external: ["@dotuix/core"],
});
