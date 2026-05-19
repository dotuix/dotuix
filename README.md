# dotuix

> `.uix` — A single-file format for interactive, offline UI experiences.
> Like PDF, but navigatable. Like an app, but one file.

---

## What is this?

A `.uix` file is a ZIP archive containing an HTML app, assets, and optional SQLite databases. You open it in a viewer (browser or desktop) and it runs fully offline, with no install, no URL, and no server.

| Format       | Interactive | Offline | One File | No Install                          |
| ------------ | ----------- | ------- | -------- | ----------------------------------- |
| PDF          | No          | Yes     | Yes      | Yes (viewer pre-installed)          |
| PWA          | Yes         | Partial | No       | No (tied to URL + browser cache)    |
| Electron app | Yes         | Yes     | No       | No (installer required)             |
| Raw HTML     | Yes         | Yes     | No       | Yes (but no kiosk, no distribution) |
| **`.uix`**   | **Yes**     | **Yes** | **Yes**  | **Yes (once viewer is installed)**  |

**Target use cases:** any interactive experience that needs to be self-contained, offline, and distributable as a single file.

---

## Use cases

`.uix` is a general-purpose container for offline interactive experiences built on web technology. Its scope is not limited to kiosks or menus — any HTML/JS application that benefits from portability, offline operation, or tamper-evident distribution is a candidate.

| Domain                        | What a `.uix` file delivers                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Digital publishing**        | Interactive books, textbooks, and reference works with full JavaScript, SQLite search, and correct Arabic/RTL typography — everything EPUB cannot do                        |
| **Legal and regulatory**      | A jurisdiction's statutes, regulations, and precedents in one file — full-text search via SQLite FTS5, cross-referenced, bilingual, no server required                      |
| **Government and compliance** | Offline forms with embedded validation rules; citizen fills and submits when connectivity is available — no paper, no always-on server                                      |
| **Classified briefings**      | Encrypted, signed, expiry-limited documents for air-gapped environments — interactive maps, timelines, and data; viewer enforces access controls before any content runs    |
| **Healthcare**                | Drug-interaction references, dosage calculators, and treatment-protocol databases for remote or low-connectivity clinics — offline, no account, no app install              |
| **Audit and reporting**       | Interactive audit reports: drill-down charts, compliance checklists the recipient marks as resolved, frozen and signed findings the auditor cannot modify after delivery    |
| **Education**                 | Self-contained simulations, exercises, and quizzes with progress tracked in `state.db` — works on any device, distributable on a USB drive                                  |
| **Sales and tendering**       | Business proposals with live budget calculators, interactive Gantt charts, and embedded annexes — signed and frozen on submission, interaction analytics included           |
| **Extreme remote operations** | Procedure manuals, emergency checklists, and crew-training simulations for spacecraft, deep-sea stations, and polar expeditions — fully air-gapped, signed before departure |

---

## Try it now

Open [viewer.dotuix.com](https://viewer.dotuix.com) (or run the web viewer locally — see below), drag a `.uix` file onto the page, and it renders instantly in your browser.

---

## Packages

| Package                                        | Description                                                                                                              | Status         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------- |
| [`packages/core`](packages/core)               | Core library — pack, unpack, validate, sign, read/write SQLite                                                           | ✅ Stable      |
| [`packages/cli`](packages/cli)                 | `dotuix` CLI — pack, unpack, validate, sign, verify, keygen, export, encrypt                                             | ✅ Stable      |
| [`packages/vite-plugin`](packages/vite-plugin) | Vite plugin — build React/Vue/Svelte/TS apps, outputs a `.uix` file                                                      | ✅ Stable      |
| [`packages/viewer-core`](packages/viewer-core) | Shared viewer logic for web and desktop viewers                                                                          | 🔄 In progress |
| [`apps/viewer`](apps/viewer)                   | Desktop viewer — Tauri + Rust, full `window.__uix` bridge, signature verification, PIN decryption, state persistence     | ✅ Stable      |
| [`apps/editor`](apps/editor)                   | Developer editor — Electron + Monaco, file tree, live preview, DB records browser, no-code Simple mode (template wizard) | ✅ Stable      |
| [`apps/web-viewer`](apps/web-viewer)           | Browser viewer — drag-and-drop, runs in any modern browser                                                               | 🔄 In progress |

---

## Quick start (local dev)

```bash
# 1. Install dependencies
pnpm install

# 2. Build core library
pnpm --filter @dotuix/core build

# 3. Start the web viewer dev server
pnpm --filter @dotuix/web-viewer dev
# → http://localhost:5173
```

### Pack the restaurant demo

```bash
node --input-type=module --eval "
  import { UIX } from './packages/core/dist/index.js';
  await UIX.pack('./templates/restaurant', './restaurant.uix');
  console.log('done → restaurant.uix');
"
```

Then drag `restaurant.uix` onto the viewer at `http://localhost:5173`.

### Build a React / Vue / Svelte / TypeScript app as `.uix`

Add the plugin to your `vite.config.ts`:

```ts
import { dotuix } from "@dotuix/vite-plugin";

export default {
  plugins: [dotuix()],
};
```

Add a `manifest.json` to your project root (see [the format spec](#the-format)), then:

```bash
vite dev    # live dev server + mock window.__uix bridge auto-injected
vite build  # compiles TS/JSX → bundles → packs → outputs <appName>.uix
```

The plugin sets `base: './'` automatically so all asset URLs stay relative inside the archive. TypeScript and any framework are compiled by Vite before packing — the `.uix` always contains plain HTML + JS.

---

## The format

A `.uix` file is a standard ZIP containing:

```
myapp.uix (ZIP)
├── manifest.json        ← required: id, name, version, entry, permissions…
├── index.html           ← entry point (declared in manifest.entry)
├── app.js
├── style.css
├── assets/              ← media files (images, video, audio, fonts)
│   ├── images/
│   ├── videos/
│   ├── audio/
│   └── fonts/
├── files/               ← any other file the app needs (PDF, JSON, CSV, …)
├── data.db              ← optional: read-only SQLite (creator data)
└── state.db             ← optional: read-write SQLite (user session)
```

`assets/` and `files/` are conventions, not requirements — files can live anywhere in the archive and are referenced by relative path from HTML.

The viewer injects `window.__uix` into the running app — a postMessage-based bridge that exposes `data.find`, `state.insert`, etc. without giving the app access to the host filesystem.

### Security (opt-in)

Regular apps (restaurant menus, shop catalogues) omit the `security` field entirely and are unaffected. For classified or access-controlled content, add a `security` block to `manifest.json`:

```json
{
  "security": {
    "auth": "pin",
    "encryptedPaths": ["data.db", "files/annex.pdf"],
    "keySalt": "base64url-random-salt",
    "kdfIterations": 200000,
    "maxOpens": 3,
    "screenshot": false
  },
  "signature": {
    "algorithm": "Ed25519",
    "publicKey": "base64url-public-key",
    "value": "base64url-signature",
    "signedAt": "2026-05-19T10:00:00Z"
  }
}
```

| Feature               | How it works                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| PIN auth              | Viewer prompts before opening; key derived with PBKDF2-SHA256 — no server involved                                                                 |
| Encrypted files       | AES-256-GCM; decrypted in memory after auth; app uses normal relative paths                                                                        |
| Max opens             | Tracked by viewer locally (`~/.dotuix/sessions.db`) — file cannot bypass it                                                                        |
| Screenshot prevention | Viewer blocks OS screenshot API while file is open (desktop only)                                                                                  |
| Tamper detection      | Ed25519 signature over all app file hashes (excluding `state.db`, which is user-writable); viewer refuses if app files were modified after signing |

Full spec: [`docs/plan.md`](docs/plan.md)

---

## Guides

**Business owners** — create a `.uix` file in minutes using the editor, no code required, with clear explanations of every security option in plain language:  
→ [guides/for-business-owners.md](guides/for-business-owners.md)

**Developers** — every method for creating `.uix` files (plain HTML, React/Vue/Svelte with the Vite plugin, programmatic Node.js), the full bridge API, all security scenarios with code examples (signing, PIN encryption, expiry, max opens), and CLI reference:  
→ [guides/for-developers.md](guides/for-developers.md)

---

## Templates

| Template                                           | Description                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| [`templates/restaurant`](templates/restaurant)     | Gulf restaurant kiosk menu — Arabic, QAR prices, working cart       |
| [`templates/catalog`](templates/catalog)           | Product showcase — category filters, SKU, pricing (light theme)     |
| [`templates/portfolio`](templates/portfolio)       | Creative portfolio — sidebar category filters, year badge (dark)    |

---

## License

MIT
