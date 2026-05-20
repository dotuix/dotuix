/**
 * scripts/generate-icons.mjs
 *
 * Generates every icon size required across all packages and apps from a
 * single master source file.
 *
 * MASTER SOURCE: docs/logo.png  (1254×1254, square)
 *
 * To regenerate after changing the logo:
 *   node scripts/generate-icons.mjs
 *
 * Dependencies (workspace devDependencies):
 *   sharp    — PNG/image resize
 *   to-ico   — multi-size .ico generation
 *
 * Platform note: .icns generation requires macOS (uses `iconutil`).
 * On Linux/Windows the script skips .icns and prints a warning.
 */

import sharp from "sharp";
import toIco from "to-ico";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "docs/logo.png");

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function dir(p) {
  mkdirSync(join(ROOT, p), { recursive: true });
}

async function png(size, dest) {
  const out = join(ROOT, dest);
  await sharp(SOURCE).resize(size, size).png().toFile(out);
  console.log(`  ✓ ${dest}  (${size}×${size})`);
}

async function ico(sizes, dest) {
  const buffers = await Promise.all(
    sizes.map((s) => sharp(SOURCE).resize(s, s).png().toBuffer()),
  );
  const icoBuffer = await toIco(buffers);
  writeFileSync(join(ROOT, dest), icoBuffer);
  console.log(`  ✓ ${dest}  (${sizes.join(", ")}px)`);
}

async function icns(dest) {
  if (process.platform !== "darwin") {
    console.warn(`  ⚠ Skipping ${dest} — .icns requires macOS (iconutil)`);
    return;
  }
  const iconsetDir = join(ROOT, dirname(dest), "_tmp_iconset.iconset");
  mkdirSync(iconsetDir, { recursive: true });

  // iconutil requires this exact naming convention
  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  const scales = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];

  await Promise.all(
    scales.map(([s, name]) =>
      sharp(SOURCE).resize(s, s).png().toFile(join(iconsetDir, name)),
    ),
  );

  const outPath = join(ROOT, dest);
  execSync(`iconutil -c icns "${iconsetDir}" -o "${outPath}"`);
  rmSync(iconsetDir, { recursive: true, force: true });
  console.log(`  ✓ ${dest}`);
}

// ---------------------------------------------------------------------------
// Target map  — every icon the project needs
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`✗ Source not found: ${SOURCE}`);
    process.exit(1);
  }

  const meta = await sharp(SOURCE).metadata();
  console.log(`\nSource: docs/logo.png  (${meta.width}×${meta.height})\n`);

  // ── VS Code extension ────────────────────────────────────────────────────
  console.log("VS Code extension:");
  dir("packages/vscode-extension/icons");
  await png(128, "packages/vscode-extension/icons/icon.png");
  await png(
    16,
    "packages/vscode-extension/icons/uix-file-light.svg".replace(
      ".svg",
      "-16.png",
    ),
  );
  // Replace the SVG placeholders with real PNGs (16px for file icons)
  // vscode file icons are small; 16 and 32 are used
  await sharp(SOURCE)
    .resize(16, 16)
    .png()
    .toFile(join(ROOT, "packages/vscode-extension/icons/uix-file-16.png"));
  console.log("  ✓ packages/vscode-extension/icons/uix-file-16.png  (16×16)");
  await png(32, "packages/vscode-extension/icons/uix-file-32.png");

  // ── Tauri desktop viewer ─────────────────────────────────────────────────
  console.log("\nTauri viewer (apps/viewer/src-tauri/icons/):");
  dir("apps/viewer/src-tauri/icons");
  await png(512, "apps/viewer/src-tauri/icons/icon.png");
  await png(32, "apps/viewer/src-tauri/icons/32x32.png");
  await png(128, "apps/viewer/src-tauri/icons/128x128.png");
  await png(256, "apps/viewer/src-tauri/icons/128x128@2x.png");
  // Windows Store logos
  await png(30, "apps/viewer/src-tauri/icons/Square30x30Logo.png");
  await png(44, "apps/viewer/src-tauri/icons/Square44x44Logo.png");
  await png(71, "apps/viewer/src-tauri/icons/Square71x71Logo.png");
  await png(89, "apps/viewer/src-tauri/icons/Square89x89Logo.png");
  await png(107, "apps/viewer/src-tauri/icons/Square107x107Logo.png");
  await png(142, "apps/viewer/src-tauri/icons/Square142x142Logo.png");
  await png(150, "apps/viewer/src-tauri/icons/Square150x150Logo.png");
  await png(284, "apps/viewer/src-tauri/icons/Square284x284Logo.png");
  await png(310, "apps/viewer/src-tauri/icons/Square310x310Logo.png");
  await png(50, "apps/viewer/src-tauri/icons/StoreLogo.png");
  await ico(
    [16, 24, 32, 48, 64, 128, 256],
    "apps/viewer/src-tauri/icons/icon.ico",
  );
  await icns("apps/viewer/src-tauri/icons/icon.icns");

  // ── Electron editor ──────────────────────────────────────────────────────
  console.log("\nElectron editor (apps/editor/build/):");
  dir("apps/editor/build");
  await png(512, "apps/editor/build/icon.png");
  await ico([16, 24, 32, 48, 64, 128, 256], "apps/editor/build/icon.ico");
  await icns("apps/editor/build/icon.icns");

  // ── Shared assets (for README, docs, og:image, etc.) ────────────────────
  console.log("\nShared assets (docs/assets/):");
  dir("docs/assets");
  await png(1254, "docs/assets/logo.png"); // full resolution copy
  await png(512, "docs/assets/logo-512.png");
  await png(256, "docs/assets/logo-256.png");
  await png(128, "docs/assets/logo-128.png");

  console.log("\n✓ All icons generated.\n");
  console.log(
    "To update: replace docs/logo.png then run: node scripts/generate-icons.mjs\n",
  );
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
