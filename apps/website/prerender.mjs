/**
 * Post-build pre-render script.
 * Runs after `vite build --ssr src/entry-server.tsx`.
 * Injects server-rendered HTML into dist/index.html so crawlers
 * receive full content without executing JavaScript.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const { render } = await import("./dist/server/entry-server.js");

const templatePath = join(__dirname, "dist", "index.html");
const template = readFileSync(templatePath, "utf8");
const html = template.replace("<!--app-html-->", render());
writeFileSync(templatePath, html);

console.log("✓ pre-rendered dist/index.html");
