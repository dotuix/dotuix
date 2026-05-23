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

A `.uix` file is a standard ZIP archive containing an HTML/JS app, optional SQLite databases, and a `manifest.json`. Open it in a viewer and it runs fully offline — no install, no URL, no server. The viewer enforces a sandboxed runtime, optional Ed25519 signature verification, and optional AES-256-GCM encryption.

| Format       | Interactive | Offline | Single File | No Install                         |
| ------------ | ----------- | ------- | ----------- | ---------------------------------- |
| PDF          | No          | Yes     | Yes         | Yes (viewer pre-installed)         |
| PWA          | Yes         | Partial | No          | No (tied to URL + browser cache)   |
| Electron app | Yes         | Yes     | No          | No (installer required)            |
| Raw HTML     | Yes         | Yes     | No          | Yes (no kiosk mode, no signing)    |
| **`.uix`**   | **Yes**     | **Yes** | **Yes**     | **Yes (once viewer is installed)** |

---

## Use cases

Any interactive experience that benefits from portability, offline operation, or tamper-evident distribution.

| Domain                         | What a `.uix` file delivers                                                   |
| ------------------------------ | ----------------------------------------------------------------------------- |
| **Restaurant & retail kiosks** | Offline menu or catalogue — no WiFi, no app install, no server                |
| **Classified briefings**       | Encrypted, signed, expiry-limited documents for air-gapped environments       |
| **Legal & regulatory**         | Statutes and precedents in one file — SQLite FTS5 full-text search, bilingual |
| **Government & compliance**    | Offline forms with embedded validation; submit when connectivity is available |
| **Healthcare**                 | Drug references, dosage calculators, treatment protocols — remote clinics     |
| **Audit & reporting**          | Interactive reports: drill-down charts, signed findings                       |
| **Education**                  | Self-contained exercises with progress tracked in `state.db`                  |
| **Sales & tendering**          | Proposals with live calculators and embedded annexes — signed on submission   |
| **Digital publishing**         | Interactive books and reference works with SQLite search and RTL typography   |

---

## Try it now

Download a pre-built demo from [dotuix.uts.qa](https://dotuix.uts.qa), then open it in the desktop viewer.

Download the latest desktop viewer binaries from [GitHub Releases](https://github.com/dotuix/dotuix/releases/latest).

---

## The format

A `.uix` file is a standard ZIP:

```
myapp.uix (ZIP)
├── manifest.json   ← required
├── index.html      ← entry point (declared in manifest.entry)
├── app.js
├── style.css
├── assets/         ← images, video, audio, fonts (convention, not enforced)
├── files/          ← any other file the app needs
├── data.db         ← optional: read-only SQLite (creator content)
└── state.db        ← optional: read-write SQLite (user state, persisted)
```

The viewer injects `window.__uix` (aliased as `window.uix`) into the running app — a bridge exposing `data.find`, `state.insert`, etc. The app has no access to the host filesystem.

### manifest.json

```json
{
  "uix": "1.0",
  "id": "com.example.myapp",
  "name": "My App",
  "version": "1.0.0",
  "entry": "index.html",
  "mode": "kiosk",
  "network": "blocked",
  "permissions": []
}
```

| Field           | Required | Description                                                                                                                                                              |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uix`           | Yes      | Format version. Always `"1.0"`.                                                                                                                                          |
| `id`            | Yes      | Reverse-domain identifier. e.g. `"com.example.myapp"`. Used for state isolation.                                                                                         |
| `name`          | Yes      | Human-readable app name shown in viewer chrome.                                                                                                                          |
| `version`       | Yes      | SemVer app version. e.g. `"1.0.0"`.                                                                                                                                      |
| `entry`         | Yes      | Path to the entry HTML file inside the archive.                                                                                                                          |
| `mode`          | Yes      | `"kiosk"` (locked UI, no address bar) or `"window"` (developer toolbar).                                                                                                 |
| `network`       | No       | `"blocked"` (default) or `"allowed"`.                                                                                                                                    |
| `permissions`   | No       | `["local-storage"]`, `["print"]`, `["raw-sql"]`, `["file-save"]`, `["file-open"]`, `["open-url"]`, `["notifications"]`, `["local-sync"]`                                 |
| `sync.endpoint` | No       | HTTPS URL of Sync Hub (`sync-desktop`). Required when `"local-sync"` permission is declared.                                                                             |
| `sync.secret`   | No       | Base64-encoded shared secret for Sync Hub (`sync-desktop`).                                                                                                              |
| `minViewer`     | No       | Minimum viewer version required.                                                                                                                                         |
| `expires`       | No       | ISO 8601 date — viewer refuses expired files before unpacking.                                                                                                           |
| `state.seed`    | No       | `true` = copy `state.db` from archive as initial user state on first open.                                                                                               |
| `state.mode`    | No       | `"file"` (default) — state written back into archive on close; sharing the file shares all data. `"device"` — state stored by viewer per app-id; archive never modified. |
| `schemaVersion` | No       | Integer, incremented when `state.db` schema changes. Triggers `uix.schema.onUpgrade()` before first render if stored version differs. Default `1`.                       |
| `license`       | No       | `{ required: true, publisherKey: "ed25519:..." }` — require a signed `.uixlicense` token to open. Verified offline via Ed25519.                                          |
| `security`      | No       | PIN auth + AES-256-GCM encryption block.                                                                                                                                 |
| `signature`     | No       | Ed25519 signature block.                                                                                                                                                 |
| `ai`            | No       | AI provenance block — informational only, no effect on behaviour.                                                                                                        |

### The `window.uix` bridge

```javascript
// ── App metadata ────────────────────────────────────────────────────────────
const manifest = await uix.manifest();
const version = uix.viewer.version(); // synchronous

// ── Data database — read-only (creator content) ─────────────────────────────
const records = await uix.data.find({ type: "product" });
// Extended where operators:  { price: { gte: 10 }, tags: { in: ["a","b"] }, archived: { is_null: true } }
// Multi-field sort:           orderBy: [{ field: "cat", direction: "asc" }, { field: "sort", direction: "asc" }]
// Pagination:                 limit: 20, offset: 40
const record = await uix.data.get("product:001");
const total = await uix.data.count({ type: "product" });

// ── State database — read-write (user state, persisted across opens) ─────────
const saved = await uix.state.find({ type: "cart_item" });
const rec = await uix.state.insert({
  type: "cart_item",
  body: { id, name, price },
});
await uix.state.upsert({
  id: "settings:main",
  type: "settings",
  body: { theme: "dark" },
});
await uix.state.insertMany([
  { type: "order_line", body: { product: "product:001", qty: 1 } },
]);
await uix.state.update(rec.id, { id, name, price, qty: 2 });
await uix.state.delete(rec.id);
await uix.state.purge({ type: "session_log", olderThan: "24h" });
await uix.state.clear({ type: "cart_item" });
await uix.state.reset(); // wipe and restore to seed / empty

const results = await uix.state.transaction([
  { op: "insert", type: "order", body: { total: 120 } },
  { op: "delete", id: "cart_item:x" },
]);

const info = await uix.state.size(); // { bytes, records, types }
const stats = await uix.state.vacuum(); // { before, after }
const json = await uix.state.export({ type: "order" }); // JSON string

// Sync (push local changes + pull remote changes) — needs "local-sync"
// Viewer also runs periodic background sync while the app is open.
const { pushed, pulled } = await uix.state.sync();

// ── OS bridge ────────────────────────────────────────────────────────────────
uix.print(); // needs "print"
await uix.exit();
await uix.window.setTitle("Order #1042");
await uix.clipboard.write("text"); // needs "clipboard-write"
await uix.fullscreen.enter(); // needs "fullscreen"
await uix.fullscreen.exit();
await uix.fullscreen.toggle();
await uix.file.save("export.csv", csvString, "text/csv"); // needs "file-save"
const file = await uix.file.open({ accept: ".csv,.json" }); // needs "file-open"
await uix.browser.open("https://example.com"); // needs "open-url"
await uix.notify("Ready", "Your order is ready."); // needs "notifications"
```

**Record shape** (returned by `find`, `get`, `insert`):

```
{ id, type, body, created_at, updated_at }
              ↑ always a JSON string — JSON.parse(r.body) to read fields
```

- **Writing** (`insert`, `update`): pass a plain object to `body` — the bridge JSON-stringifies it.
- **Reading** (`find`, `get`): `body` comes back as a string — always `JSON.parse(r.body)` first.

**State must be restored on startup** — it is never auto-injected:

```javascript
async function init() {
  const raw = await uix.data.find({ type: "product" }); // creator data
  const saved = await uix.state.find({ type: "cart_item" }); // user state
  const products = raw.map((r) => JSON.parse(r.body));
  const cart = saved.map((r) => JSON.parse(r.body));
  render(products, cart);
}
init().catch((err) => {
  document.getElementById("app").innerHTML =
    '<p style="color:red">' + err.message + "</p>";
});
```

### Security (opt-in)

Regular apps omit the `security` field entirely. For classified or access-controlled content:

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

| Feature               | How it works                                                                      |
| --------------------- | --------------------------------------------------------------------------------- |
| PIN auth              | Viewer prompts before opening; key derived with PBKDF2-SHA256 — no server         |
| Encrypted files       | AES-256-GCM; decrypted in memory after auth; app uses normal relative paths       |
| Max opens             | Tracked locally in `~/.dotuix/sessions.db`                                        |
| Screenshot prevention | Viewer blocks OS screenshot API while open (desktop only)                         |
| Tamper detection      | Ed25519 signature over all app file hashes; viewer refuses if files were modified |

→ Full normative specification: [spec/spec.md](spec/spec.md) — CC BY 4.0, open for third-party implementations.

---

## Packages

| Package                                        | What it does                                                                                                                                                                 | Status                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)               | Core library — `pack`, `unpack`, `validate`, `sign`, `createDataDb`. Used by all other packages.                                                                             | ✅ [`@dotuix/core`](https://www.npmjs.com/package/@dotuix/core)                                 |
| [`packages/cli`](packages/cli)                 | `dotuix` CLI — `pack`, `unpack`, `validate`, `sign`, `keygen`, `encrypt`, `init`, `seed`, `export`, `import`, `build`, `dev`, `create`, `spec`, `issue-license`, `device-id` | ✅ [`@dotuix/cli`](https://www.npmjs.com/package/@dotuix/cli)                                   |
| [`packages/types`](packages/types)             | TypeScript declarations for the `window.uix` bridge — `@dotuix/types` for Vite projects. `defineConfig()` helper and full bridge IntelliSense                                | ✅ [`@dotuix/types`](https://www.npmjs.com/package/@dotuix/types)                               |
| [`packages/mcp`](packages/mcp)                 | Local stdio MCP server — Claude Desktop, Cursor, VS Code Copilot; `create` tool seeds `data.db`                                                                              | ✅ [`@dotuix/mcp`](https://www.npmjs.com/package/@dotuix/mcp)                                   |
| [`packages/ai`](packages/ai)                   | `createUIX({ manifest, files })` — one-function SDK; auto-stamps `ai` provenance block                                                                                       | ✅ [`@dotuix/ai`](https://www.npmjs.com/package/@dotuix/ai)                                     |
| [`packages/vite-plugin`](packages/vite-plugin) | Vite plugin — compile React/Vue/Svelte/TS, inject mock bridge in dev, output `.uix` on build                                                                                 | ✅ [`@dotuix/vite-plugin`](https://www.npmjs.com/package/@dotuix/vite-plugin)                   |
| VS Code extension                              | VS Code extension — manifest IntelliSense, pack/validate/init commands, `@dotuix` chat participant                                                                           | ✅ [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=intenttext.dotuix) |
| [`apps/viewer`](apps/viewer)                   | Desktop viewer — Tauri + Rust, full bridge, signature verification, PIN decryption                                                                                           | ✅ Stable                                                                                       |
| Hosted MCP server                              | Remote HTTP MCP server at `mcp.dotuix.uts.qa` — `get_spec`, `create`, `validate` + REST API (operated from private internal repo)                                            | ✅ Live                                                                                         |
| Public website                                 | Public website at [dotuix.uts.qa](https://dotuix.uts.qa) (code hosted in private internal repo)                                                                              | ✅ Live                                                                                         |
| Sync Server desktop app                        | Local sync endpoint app for manifests using `"local-sync"` (distributed as private binaries; source remains in private internal repo)                                        | Private                                                                                         |

---

## Create with AI

The canonical format spec lives at `https://dotuix.uts.qa/llms.txt`.
The MCP server mirrors it at `https://mcp.dotuix.uts.qa/api/spec` for API-only clients.

### Any AI (ChatGPT, Gemini, Claude)

1. Open ChatGPT, Gemini, or Claude
2. Say: _"Read https://dotuix.uts.qa/llms.txt then build me a [describe your app]. Give me the download link."_
3. The AI reads the spec, calls `POST /api/create`, returns a download URL (30-min TTL)
4. Download and open in the viewer

### Remote MCP — no install

```json
// Claude Desktop · Cursor · Windsurf
{ "mcpServers": { "dotuix": { "url": "https://mcp.dotuix.uts.qa/mcp" } } }
```

### Local MCP — offline

```json
{
  "mcpServers": {
    "dotuix": { "command": "npx", "args": ["-y", "@dotuix/mcp"] }
  }
}
```

### REST API

- `GET  https://dotuix.uts.qa/llms.txt` — canonical format spec
- `GET  https://mcp.dotuix.uts.qa/api/spec` — mirrored format spec for API clients
- `POST https://mcp.dotuix.uts.qa/api/create` — build `.uix`, returns download URL
- `GET  https://mcp.dotuix.uts.qa/openapi.json` — OpenAPI 3.0 (import into Custom GPT Actions)

### Programmatic — `@dotuix/ai`

```typescript
import { createUIX } from "@dotuix/ai";

const path = await createUIX({
  manifest: {
    uix: "1.0",
    id: "com.example.menu",
    name: "My Menu",
    version: "1.0.0",
    entry: "index.html",
    mode: "kiosk",
  },
  files: {
    "index.html": "<html><body><h1>Menu</h1></body></html>",
    "app.js": "/* ... */",
  },
});
// → absolute path to the packed .uix file
```

---

## Install

```bash
npm install @dotuix/core          # library
npm install -g @dotuix/cli        # CLI
code --install-extension intenttext.dotuix   # VS Code extension
```

---

## Quick start

```bash
pnpm install
pnpm --filter @dotuix/core build

# Pack a template
dotuix pack templates/restaurant restaurant.uix

# Init from template (HTML/JS)
dotuix init my-menu -t restaurant
dotuix init my-shop -t catalog
dotuix init my-folio -t portfolio

# Scaffold Vite-based projects (React 19 / Vue 3 / TypeScript)
dotuix create my-pos -t react-ts      # React 19 + state.mode:"device" (app mode)
dotuix create my-invoice -t form      # Vanilla TS + state.mode:"file" (document mode)

# AI spec workflow — describe before you build
dotuix spec init
dotuix spec validate app.spec.md
dotuix spec scaffold app.spec.md
```

### Build a React / Vue / Svelte app as `.uix`

```ts
// vite.config.ts
import { dotuix } from "@dotuix/vite-plugin";
export default { plugins: [dotuix()] };
```

```bash
vite dev    # mock bridge auto-injected
vite build  # compile → pack → output <appName>.uix
```

---

## Templates

Starter source files in [`templates/`](templates/) — copy and customise.

| Template                                       | Description                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| [`templates/restaurant`](templates/restaurant) | Gulf kiosk menu — Arabic, QAR prices, cart with `state.db` persistence |
| [`templates/catalog`](templates/catalog)       | Product showcase — category filters, SKU, pricing                      |
| [`templates/portfolio`](templates/portfolio)   | Creative portfolio — sidebar filters, project cards                    |

---

## Demos

Ready-to-open `.uix` files in [`demos/`](demos/).

| File                                                     | What it demonstrates                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`hello-world.uix`](demos/hello-world.uix)               | Minimal .uix — single HTML file, no database                               |
| [`persistent-counter.uix`](demos/persistent-counter.uix) | `uix.state` — counter persists across closes; `insert`, `update`, `delete` |
| [`intake-form.uix`](demos/intake-form.uix)               | Form submissions saved in `state.db`, restored on reopen                   |
| [`staff-directory.uix`](demos/staff-directory.uix)       | `uix.data.find` — department filter + search over `data.db`                |
| [`sales-dashboard.uix`](demos/sales-dashboard.uix)       | Bar charts + KPIs from `data.db`, category filter, data table              |
| [`restaurant-kiosk.uix`](demos/restaurant-kiosk.uix)     | Full kiosk — menu from `data.db`, cart in `state.db`                       |
| [`product-catalogue.uix`](demos/product-catalogue.uix)   | Product catalogue with categories and search                               |
| [`gov-briefing-demo.uix`](demos/gov-briefing-demo.uix)   | PIN-encrypted, signed briefing — security features demo                    |

---

## License

MIT
