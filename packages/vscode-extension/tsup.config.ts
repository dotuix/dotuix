import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"], // VS Code extensions run in a CommonJS context
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  external: ["vscode"], // VS Code API is provided by the host — never bundle it
  noExternal: ["adm-zip"], // VSIX has no node_modules — must be inlined
});
