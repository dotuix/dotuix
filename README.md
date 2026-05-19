# dotuix

> `.uix` — the executable document format.
> Interactive, offline, tamper-evident. Distributed as a single file.

[![npm @dotuix/core](https://img.shields.io/npm/v/%40dotuix%2Fcore?label=%40dotuix%2Fcore)](https://www.npmjs.com/package/@dotuix/core)
[![npm @dotuix/cli](https://img.shields.io/npm/v/%40dotuix%2Fcli?label=%40dotuix%2Fcli)](https://www.npmjs.com/package/@dotuix/cli)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/intenttext.dotuix?label=VS%20Code)](https://marketplace.visualstudio.com/items?itemName=intenttext.dotuix)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## What is this?

`.uix` is a **portable executable document format**. Like PDF — but it runs.

A `.uix` file is a ZIP archive containing an HTML app, assets, and optional SQLite databases. You open it in a viewer (browser or desktop) and it runs fully offline, with no install, no URL, and no server. The viewer enforces a sandboxed runtime, an optional Ed25519 signature, and optional AES-256-GCM encryption — making `.uix` suitable for anything from a restaurant kiosk to a classified government briefing.

| Format       | Interactive | Offline | One File | No Install                          |
| ------------ | ----------- | ------- | -------- | ----------------------------------- |
| PDF          | No          | Yes     | Yes      | Yes (viewer pre-installed)          |
| PWA          | Yes         | Partial | No       | No (tied to URL + browser cache)    |
| Electron app | Yes         | Yes     | No       | No (installer required)             |
| Raw HTML     | Yes         | Yes     | No       | Yes (but no kiosk, no distribution) |
| **`.uix`**   | **Yes**     | **Yes** | **Yes**  | **Yes (once viewer is installed)**  |

**Target use cases:** any interactive experience that needs to be self-contained, offline, and distributable as a single file — from government briefings to restaurant kiosks.

---

## Use cases

`.uix` is a general-purpose executable document format. The scope is not limited to kiosks — any HTML/JS application that benefits from portability, offline operation, or tamper-evident distribution is a candidate.

| Domain                        | What a `.uix` file delivers                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Classified briefings**      | Encrypted, signed, expiry-limited documents for air-gapped environments — interactive maps, timelines, and data; viewer enforces access controls before any content runs |
| **Legal and regulatory**      | A jurisdiction's statutes, regulations, and precedents in one file — full-text search via SQLite FTS5, cross-referenced, bilingual, no server required                   |
| **Government and compliance** | Offline forms with embedded validation rules; citizen fills and submits when connectivity is available — no paper, no always-on server                                   |
| **Healthcare**                | Drug-interaction references, dosage calculators, and treatment-protocol databases for remote or low-connectivity clinics — offline, no account, no app install           |
| **Audit and reporting**       | Interactive audit reports: drill-down charts, compliance checklists the recipient marks as resolved, frozen and signed findings the auditor cannot modify after delivery |
| **Education**                 | Self-contained simulations, exercises, and quizzes with progress tracked in `state.db` — works on any device, distributable on a USB drive                               |
| **Sales and tendering**       | Business proposals with live budget calculators, interactive Gantt charts, and embedded annexes — signed and frozen on submission, interaction analytics included        |
| **Digital publishing**        | Interactive books, textbooks, and reference works with full JavaScript, SQLite search, and correct Arabic/RTL typography — everything EPUB cannot do                     |
| **Restaurant & retail**       | Kiosk menus, product catalogues, and showroom experiences — offline, no WiFi, no app install; the included restaurant template ships ready to customize                  |

---

## Try it now

Open [viewer.dotuix.com](https://viewer.dotuix.com) (or run the web viewer locally — see below), drag a `.uix` file onto the page, and it renders instantly in your browser.

---

## Packages

| Package                                                  | Description                                                                                                              | npm / download                                                                               | Status                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------- |
| [`packages/core`](packages/core)                         | Core library — pack, unpack, validate, sign, read/write SQLite                                                           | [`@dotuix/core`](https://www.npmjs.com/package/@dotuix/core)                                 | ✅ Published                |
| [`packages/cli`](packages/cli)                           | `dotuix` CLI — pack, unpack, validate, sign, verify, keygen, export, encrypt, init `--template`                          | [`@dotuix/cli`](https://www.npmjs.com/package/@dotuix/cli)                                   | ✅ Published                |
| [`packages/mcp`](packages/mcp)                           | MCP server — connects Claude Desktop, Cursor, VS Code Copilot; AI generates and packs `.uix` end-to-end                  | [`@dotuix/mcp`](https://www.npmjs.com/package/@dotuix/mcp)                                   | ✅ Published                |
| [`packages/vscode-extension`](packages/vscode-extension) | VS Code extension — manifest IntelliSense, pack/validate/init commands, `.uix` file icon                                 | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=intenttext.dotuix) | ✅ Published                |
| [`packages/vite-plugin`](packages/vite-plugin)           | Vite plugin — build React/Vue/Svelte/TS apps, outputs a `.uix` file                                                      | —                                                                                            | ✅ Stable                   |
| [`packages/viewer-core`](packages/viewer-core)           | Shared viewer logic for web and desktop viewers                                                                          | —                                                                                            | ⬜ Planned                  |
| [`apps/viewer`](apps/viewer)                             | Desktop viewer — Tauri + Rust, full `window.__uix` bridge, signature verification, PIN decryption, state persistence     | —                                                                                            | ✅ Stable                   |
| [`apps/editor`](apps/editor)                             | Developer editor — Electron + Monaco, file tree, live preview, DB records browser, no-code Simple mode (template wizard) | —                                                                                            | ✅ Stable                   |
| [`apps/web-viewer`](apps/web-viewer)                     | Browser viewer — drag-and-drop, runs in any modern browser                                                               | —                                                                                            | ✅ Built · not yet deployed |
| [`apps/website`](apps/website)                           | dotuix.com — public landing page (Vite + React + Tailwind)                                                               | [dotuix.com](https://dotuix.com)                                                             | ✅ Built · deploy pending   |

---

## Create with AI (recommended)

The fastest way to create a `.uix` file is to let an AI do it. Any LLM with web access (GPT, Gemini, Claude) can generate a complete, valid `.uix` project from a single prompt — because the full format spec lives at `dotuix.com/llms.txt`.

### With any AI (GPT, Gemini, Claude.ai)

1. Open your AI of choice
2. Say: _"Read https://dotuix.com/llms.txt and create a [describe your app] .uix project"_
3. Save the generated files into a folder
4. Run `dotuix pack ./folder` → done

### With Claude Desktop, Cursor, or VS Code Copilot (zero manual step)

Install the MCP server and the AI generates **and packs** the file for you in one conversation:

```bash
# Claude Desktop — add to ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "dotuix": { "command": "npx", "args": ["-y", "@dotuix/mcp"] }
  }
}
```

Then just say: _"Create a restaurant menu .uix for Al Madina with 10 items in QAR, pack it to ~/Desktop/menu.uix"_

The agent calls `get_spec` → `init` → `write_files` → `pack` and hands you a ready-to-open file.

See [`packages/mcp`](packages/mcp) for Cursor and VS Code Copilot setup.

---

## Install

```bash
# Core library (Node.js / bundlers)
npm install @dotuix/core

# CLI (global)
npm install -g @dotuix/cli
dotuix --help

# VS Code extension
# Search "dotuix" in the Extensions panel, or:
code --install-extension intenttext.dotuix
```

The VS Code extension adds:

- JSON schema validation and autocomplete for `manifest.json`
- File icon for `.uix` files in the explorer
- Commands: **dotuix: Pack**, **dotuix: Validate**, **dotuix: Init** (with template picker)

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

| Template                                       | Description                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [`templates/restaurant`](templates/restaurant) | Gulf restaurant kiosk menu — Arabic, QAR prices, working cart    |
| [`templates/catalog`](templates/catalog)       | Product showcase — category filters, SKU, pricing (light theme)  |
| [`templates/portfolio`](templates/portfolio)   | Creative portfolio — sidebar category filters, year badge (dark) |

---

## License

MIT
