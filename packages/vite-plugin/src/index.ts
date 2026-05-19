import type { Plugin, ResolvedConfig } from "vite";
import { UIX } from "@dotuix/core";
import { join } from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DotuixPluginOptions {
  /**
   * Manifest field overrides. Merged on top of `manifest.json` in the project
   * root. If no `manifest.json` exists, this object must include all required
   * fields: `uix`, `id`, `name`, `version`, `entry`.
   */
  manifest?: Record<string, unknown>;

  /**
   * Output path for the `.uix` file.
   * Default: `<projectRoot>/<appName>.uix`
   * where `appName` is the last segment of `manifest.id`.
   */
  output?: string;

  /**
   * Inject a mock `window.__uix` bridge in dev/preview mode so the app runs
   * without a real viewer. Set to `false` to disable.
   * @default true
   */
  mockBridge?: boolean;
}

// ---------------------------------------------------------------------------
// Dev-mode mock bridge
// ---------------------------------------------------------------------------

/**
 * Minimal in-browser mock of the window.__uix API.
 * Injected only during `vite dev` / `vite preview`. Never included in builds.
 *
 * All data and state calls return empty results. The app renders correctly;
 * developers see the real UI without needing a viewer.
 */
const DEV_BRIDGE_SCRIPT = /* js */ `
(function () {
  if (window.__uix) return; // already provided by a real viewer
  var _id = 1;
  window.__uix = {
    data: {
      find:  async function ()  { return []; },
      get:   async function ()  { return null; },
      raw:   async function ()  { return []; },
    },
    state: {
      find:   async function ()  { return []; },
      get:    async function ()  { return null; },
      insert: async function (r) { return r.type + ':mock-' + (_id++); },
      update: async function ()  {},
      delete: async function ()  {},
      raw:    async function ()  { return []; },
      purge:  async function ()  { return 0; },
    },
    print:    function () { window.print(); },
    manifest: function () {
      return {
        uix: '1.0', id: 'dev-preview', name: 'Dev Preview',
        version: '0.0.0', entry: 'index.html',
        mode: 'window', permissions: [], network: 'allowed',
      };
    },
    exit: function () {},
  };
})();
`.trim();

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Vite plugin that turns any Vite project into a `.uix` app.
 *
 * What it does:
 * - Forces `base: './'` so all asset URLs are relative (required by the format)
 * - Injects a mock `window.__uix` bridge in dev mode so the app runs without a viewer
 * - After `vite build`: writes `manifest.json` into the output directory and
 *   packs everything into a `.uix` file
 *
 * Usage in `vite.config.ts`:
 * ```ts
 * import { dotuix } from '@dotuix/vite-plugin'
 * export default { plugins: [dotuix()] }
 * ```
 */
export function dotuix(options: DotuixPluginOptions = {}): Plugin {
  const { mockBridge = true } = options;
  let config: ResolvedConfig;

  return {
    name: "vite-plugin-dotuix",
    enforce: "pre",

    // ── Force relative base ──────────────────────────────────────────────
    config() {
      return { base: "./" };
    },

    configResolved(resolved) {
      config = resolved;
    },

    // ── Mock bridge (dev + preview only) ─────────────────────────────────
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!mockBridge || config.command === "build") return html;
        return html.replace(
          /<head>/i,
          `<head>\n<script>${DEV_BRIDGE_SCRIPT}</script>`,
        );
      },
    },

    // ── Pack to .uix after build ─────────────────────────────────────────
    async closeBundle() {
      if (config.command !== "build") return;

      const outDir = config.build.outDir; // e.g. "dist"
      const root = config.root;

      // Load manifest.json from project root
      const manifestPath = join(root, "manifest.json");
      let manifest: Record<string, unknown> = {};

      if (existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(
            await readFile(manifestPath, "utf-8"),
          ) as Record<string, unknown>;
        } catch {
          config.logger.error(
            "[dotuix] Failed to parse manifest.json — aborting pack",
          );
          return;
        }
      }

      // Merge plugin-level overrides
      if (options.manifest) {
        manifest = { ...manifest, ...options.manifest };
      }

      // Validate required fields
      const required = ["uix", "id", "name", "version", "entry"];
      const missing = required.filter((f) => !manifest[f]);
      if (missing.length) {
        config.logger.warn(
          `[dotuix] manifest.json is missing required fields: ${missing.join(
            ", ",
          )} — skipping .uix pack\n` +
            `         Add a manifest.json to your project root or pass { manifest: {...} } to the plugin.`,
        );
        return;
      }

      // Write manifest.json into the build output dir
      await mkdir(outDir, { recursive: true });
      await writeFile(
        join(outDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf-8",
      );

      // Derive output file name from manifest id (last segment)
      const rawName = (manifest.id as string).split(".").pop() ?? "app";
      const appName = rawName.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
      const uixOut = options.output ?? join(root, `${appName}.uix`);

      // Pack the build output directory into a .uix archive
      // Output is written to <root>/<name>.uix (outside outDir) to avoid
      // including the .uix file inside itself.
      await UIX.pack(outDir, uixOut);

      const rel = uixOut.startsWith(root)
        ? uixOut.slice(root.length + 1)
        : uixOut;

      config.logger.info(`\n✓ [dotuix] packed → ${rel}\n`, { clear: false });
    },
  };
}

export default dotuix;
