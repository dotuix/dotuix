import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // Copy sql.js WASM to public/ so the browser can load it at /sql-wasm.wasm
    {
      name: "copy-sql-wasm",
      buildStart() {
        mkdirSync(resolve(__dirname, "public"), { recursive: true });
        copyFileSync(
          resolve(__dirname, "node_modules/sql.js/dist/sql-wasm.wasm"),
          resolve(__dirname, "public/sql-wasm.wasm"),
        );
      },
    },
  ],
  // Pre-bundle sql.js so Vite converts its CJS/UMD build to ESM (gives it a
  // proper default export). Without this Vite serves the raw UMD file and the
  // browser throws "does not provide an export named 'default'".
  optimizeDeps: {
    include: ["sql.js"],
  },
  // Stub out Node.js built-ins so @dotuix/core's Node-only functions compile
  // in the browser. These stubs throw if called; browser code only calls
  // the *Buffer variants which never touch the file system.
  resolve: {
    alias: {
      "node:fs": resolve(__dirname, "src/stubs/node-fs.ts"),
      fs: resolve(__dirname, "src/stubs/node-fs.ts"),
      "node:path": resolve(__dirname, "src/stubs/node-path.ts"),
      path: resolve(__dirname, "src/stubs/node-path.ts"),
      "node:os": resolve(__dirname, "src/stubs/node-os.ts"),
      os: resolve(__dirname, "src/stubs/node-os.ts"),
    },
  },
});
