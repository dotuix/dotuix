# @dotuix/vite-plugin

> Vite plugin — build any React / Vue / Svelte / plain-TS app and output a `.uix` file automatically.

```bash
npm install -D @dotuix/vite-plugin
```

---

## Quick start

**1. Add the plugin to `vite.config.ts`:**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dotuix } from "@dotuix/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    dotuix(), // ← add this
  ],
});
```

**2. Add a `manifest.json` to your project root:**

```json
{
  "uix": "1.0",
  "id": "com.example.myapp",
  "name": "My App",
  "version": "1.0.0",
  "entry": "index.html",
  "mode": "window",
  "permissions": [],
  "network": "none"
}
```

**3. Build:**

```bash
vite build
# ✓ [dotuix] packed → myapp.uix
```

The `.uix` file is written to the project root. Open it with the **dotuix viewer**.

---

## Options

```ts
dotuix(options?: DotuixPluginOptions)
```

| Option       | Type                      | Default                | Description                                                                                                   |
| ------------ | ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `manifest`   | `Record<string, unknown>` | `{}`                   | Manifest overrides — merged on top of `manifest.json`. Useful for injecting the version dynamically.          |
| `output`     | `string`                  | `<root>/<appName>.uix` | Custom output path for the `.uix` file.                                                                       |
| `mockBridge` | `boolean`                 | `true`                 | Inject a mock `window.__uix` bridge during `vite dev` / `vite preview` so the app runs without a real viewer. |

### Dynamic version example

```ts
import pkg from "./package.json";

dotuix({
  manifest: { version: pkg.version },
});
```

---

## Dev mode

During `vite dev` and `vite preview` the plugin injects a lightweight in-browser mock of `window.__uix` so your app renders correctly without needing the desktop viewer.

The mock bridge provides:

- `window.__uix.data` — `find`, `get`, `raw` (return empty results)
- `window.__uix.state` — `find`, `get`, `insert`, `update`, `delete`, `raw`, `purge`
- `window.__uix.manifest()` — returns a dev-preview manifest object
- `window.__uix.print()`, `window.__uix.exit()`

To disable mock injection (e.g., you have a custom bridge), pass `mockBridge: false`.

---

## How it works

1. **`config` hook** — forces `base: './'` so all asset URLs are relative (required by the `.uix` ZIP format).
2. **`transformIndexHtml` hook** — injects the mock bridge script in non-build modes.
3. **`closeBundle` hook** — after `vite build`:
   - Reads `manifest.json` from the project root and merges any plugin-level overrides.
   - Validates required fields (`uix`, `id`, `name`, `version`, `entry`).
   - Writes `manifest.json` into the Vite output directory.
   - Calls `UIX.pack(outDir, outputPath)` from `@dotuix/core` to create the `.uix` archive.

---

## Requirements

- Vite ≥ 5.0
- Node ≥ 22

---

## License

MIT
