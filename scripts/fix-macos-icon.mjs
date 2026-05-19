/**
 * Applies a macOS squircle mask to the Tauri source icon (icon.png),
 * writes a rounded version as icon-rounded.png, then calls `tauri icon`
 * to regenerate all platform icons from the rounded source.
 *
 * Usage:  node scripts/fix-macos-icon.mjs
 */

import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SRC = path.join(ROOT, "apps/viewer/src-tauri/icons/icon.png");
const OUT = path.join(ROOT, "apps/viewer/src-tauri/icons/icon.png"); // overwrite in place

const SIZE = 512;
// macOS squircle uses a superellipse with exponent ~5
// We approximate it as a rounded rectangle with corner-radius ≈ 22.5% of size
const RADIUS = Math.round(SIZE * 0.225); // 115 px for 512

const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="white"/>
</svg>`);

console.log(`Reading ${SRC}…`);
const original = sharp(SRC).resize(SIZE, SIZE);

console.log(`Applying squircle mask (r=${RADIUS}px)…`);
await original
  .composite([{ input: mask, blend: "dest-in" }])
  .png()
  .toFile(OUT.replace(".png", ".tmp.png"));

// Replace original with masked version
import { rename } from "fs/promises";
await rename(OUT.replace(".png", ".tmp.png"), OUT);

console.log(`Wrote ${OUT}`);
console.log("Re-generating all Tauri icons from rounded source…");
execSync("pnpm exec tauri icon src-tauri/icons/icon.png", {
  cwd: path.join(ROOT, "apps/viewer"),
  stdio: "inherit",
});
console.log("Done. All platform icons regenerated.");
