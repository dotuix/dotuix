# dotuix — Full Project Plan

> `.uix` — A single-file format for interactive, offline UI experiences.
> Like PDF, but navigatable. Like an app, but one file.

---

## 1. The Problem

There is no standard format for distributing an interactive offline experience as a single portable file.

| Format       | Interactive | Offline | One File | No Install                                |
| ------------ | ----------- | ------- | -------- | ----------------------------------------- |
| PDF          | No          | Yes     | Yes      | Yes (viewer pre-installed)                |
| PWA          | Yes         | Partial | No       | No (tied to URL + browser cache)          |
| Electron app | Yes         | Yes     | No       | No (installer required)                   |
| Raw HTML     | Yes         | Yes     | No       | Yes (but no kiosk, no distribution story) |
| **`.uix`**   | **Yes**     | **Yes** | **Yes**  | **Yes (once viewer is installed)**        |

Target use cases:

- Restaurant / hotel kiosk menus on a tablet
- Retail product catalogues at exhibitions or showrooms
- Offline event guides (conferences, museums, weddings)
- B2B sales presentations in low-connectivity areas
- Clinic intake forms and waiting room experiences

---

## 2. The Format Spec

### 2.1 Container

A `.uix` file is a **ZIP archive** (deflate compression) with a defined internal structure. Assets are compressed normally. SQLite database files are stored with the `STORE` method (no compression — SQLite's binary format is not compressible and wastes CPU trying).

```
myshop.uix  (ZIP)
├── manifest.json       ← required. describes the app.
├── index.html          ← entry point declared in manifest
├── app.js
├── assets/
│   ├── logo.png
│   ├── banner.jpg
│   └── style.css
├── pages/
│   ├── menu.html
│   ├── category.html
│   └── cart.html
├── data.db             ← SQLite. read-only. shipped by creator.
└── state.db            ← SQLite. optional in zip. used as seed if present.
```

### 2.2 manifest.json

```json
{
  "uix": "1.0",
  "id": "com.almadina.menu",
  "name": "Al Madina Restaurant Menu",
  "version": "2.1.0",
  "minViewer": "1.0.0",
  "entry": "index.html",
  "mode": "kiosk",
  "permissions": ["local-storage", "print"],
  "network": "blocked",
  "theme": {
    "color": "#1a1a2e",
    "background": "#ffffff"
  },
  "author": "emad@domain.com",
  "expires": null,
  "state": {
    "seed": false
  },
  "signature": null
}
```

**Fields:**

| Field         | Required | Description                                                                                                                                                                                                                  |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uix`         | Yes      | Format version                                                                                                                                                                                                               |
| `id`          | Yes      | Stable reverse-domain identifier. e.g. `com.almadina.menu`. No DNS enforcement — convention only. Used for state isolation, caching, signatures, and future update tracking.                                                 |
| `name`        | Yes      | Human-readable app name                                                                                                                                                                                                      |
| `version`     | Yes      | SemVer. Creator's app version                                                                                                                                                                                                |
| `minViewer`   | No       | Minimum viewer version required to open this file. Viewer refuses gracefully with a message if its version is below this. e.g. `"1.2.0"`                                                                                     |
| `entry`       | Yes      | Path to the entry HTML file inside the zip                                                                                                                                                                                   |
| `mode`        | Yes      | `kiosk` (locked) or `window` (for dev/preview)                                                                                                                                                                               |
| `permissions` | No       | What the app is allowed to do                                                                                                                                                                                                |
| `network`     | No       | `blocked` (default) or `allowed`                                                                                                                                                                                             |
| `theme`       | No       | Viewer chrome colors                                                                                                                                                                                                         |
| `author`      | No       | Creator identity                                                                                                                                                                                                             |
| `expires`     | No       | ISO date string or `null`. Viewer checks expiry **before extraction** — expired files never unpack.                                                                                                                          |
| `state.seed`  | No       | `true` = the `state.db` in the zip is a creator seed, copy it as starting state. `false` (default) = no seed. Without this flag the viewer cannot distinguish a creator-provided seed from a previously packed user session. |
| `signature`   | No       | Reserved. `null` in v1. Format slot for ed25519 package signing in v2. Viewer reads and stores the field but does not validate it in v1.                                                                                     |

**Allowed permissions:**

- `local-storage` — use browser localStorage
- `print` — trigger system print dialog
- `clipboard-write` — write to clipboard
- `fullscreen` — request fullscreen from within the app
- `raw-sql` — unlock `uix.data.raw()` and `uix.state.raw()` on the bridge. Opt-in only. Apps that do not declare this permission cannot call raw SQL — the bridge rejects the call silently.

### 2.3 The Two Databases

Both `data.db` and `state.db` use the **exact same table structure** — one table, three columns. The viewer knows this structure and nothing else. What goes inside `body` is entirely decided by the JavaScript inside the `.uix` file.

```sql
-- this is the complete schema for BOTH databases. defined by the format, not the app.
CREATE TABLE records (
  id         TEXT    PRIMARY KEY,                           -- e.g. 'product:001', 'order:2026-05-18-a1b2'
  type       TEXT    NOT NULL,                              -- e.g. 'product', 'category', 'cart_item', 'order'
  body       TEXT    NOT NULL,                              -- JSON. shape decided entirely by the .uix app.
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),        -- unix timestamp. set on insert, never changed.
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())         -- unix timestamp. updated on every update call.
);
CREATE INDEX idx_type       ON records (type);
CREATE INDEX idx_created_at ON records (created_at);
```

`created_at` and `updated_at` are format-defined, always present, always queryable. The app never needs to put timestamps inside `body`. The `purge()` bridge method uses `created_at` to delete old records by age.

**`data.db`** — creator-owned, read-only at runtime. Shipped inside the `.uix`. The viewer opens it and exposes it through the `data` bridge. Never written to after distribution.

**`state.db`** — user-owned, writable at runtime. Created by the viewer on first open using the schema above. Travels inside the `.uix` file. The viewer creates it with the same `records` table and exposes it through the `state` bridge.

The `.uix` app's JavaScript is fully responsible for:

- What `type` values it uses
- What fields it puts inside `body`
- What queries it runs

The viewer is responsible for nothing except opening the databases and routing bridge calls to the right one.

**Example — restaurant app:**

```javascript
// app stores whatever it needs in body — the viewer never inspects this
await uix.data.find({ type: "product" });
// → SELECT id, type, body, created_at, updated_at FROM records WHERE type = 'product'

await uix.data.find({ type: "product", where: { category: "burgers" } });
// → SELECT ... FROM records WHERE type = 'product'
//   AND json_extract(body, '$.category') = 'burgers'

await uix.state.insert({
  type: "cart_item",
  body: { productId: "product:001", qty: 2 },
});
// → INSERT INTO records (id, type, body) VALUES ('cart_item:uuid', 'cart_item', '{...}')
// created_at and updated_at are set automatically by the DB default

// raw SQL — only available if manifest declares "raw-sql" in permissions
await uix.data.raw(
  "SELECT body FROM records WHERE type = ? ORDER BY json_extract(body, '$.sort') ASC",
  ["product"],
);
```

**If `state.db` is included in the zip as a seed**, set `state.seed: true` in the manifest. The viewer copies it to the temp directory as the starting state. Without the flag the viewer ignores any `state.db` in the zip and creates a fresh one.

The viewer also creates a `meta` table in `state.db` alongside `records`:

```sql
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT INTO meta VALUES ('schema_version', '1');
INSERT INTO meta VALUES ('created_at',     '2026-05-18T10:00:00Z');
INSERT INTO meta VALUES ('uix_version',    '1.0');
```

This costs nothing now and gives a clear path when the format evolves. Future viewer versions read `schema_version` from `meta` before doing anything with the database.

### 2.4 Compression Rules

| File type              | ZIP method                 |
| ---------------------- | -------------------------- |
| HTML, CSS, JS, JSON    | DEFLATE                    |
| PNG, JPG, WEBP         | STORE (already compressed) |
| `data.db`              | STORE                      |
| `state.db` (if seeded) | STORE                      |

---

## 3. Runtime Architecture

### 3.1 Open Flow

```
User double-clicks myshop.uix
        │
        ▼
Viewer detects lock file?
  Yes → offer "Recover last session" or "Start fresh"
  No  → continue
        │
        ▼
Extract .uix to temp working dir
~/.dotuix/temp/{uuid}/
  ├── index.html
  ├── data.db
  ├── state.db        ← created here if not in zip
  └── ...
        │
        ▼
Create lock file alongside original:
~myshop.uix.lock
        │
        ▼
Open webview in kiosk or window mode
Inject CSP headers
Expose bridge functions (queryData, readState, writeState, print)
        │
        ▼
App runs. All reads/writes go through the bridge.
        │
        ▼
User closes viewer
        │
        ▼
Repack temp dir → write to myshop.uix.tmp first
        │
        ▼
Atomic rename: myshop.uix.tmp → myshop.uix
        │
        ▼
Roll backup: rename previous myshop.uix → myshop.uix.bak (keep 1 only)
        │
        ▼
Delete temp dir
Delete lock file
Done
```

### 3.2 Atomic Write on Close

The repack step **never writes directly to the original `.uix` file**. The sequence is:

1. Repack temp dir into `myshop.uix.tmp` (a fresh write)
2. Rename `myshop.uix` → `myshop.uix.bak` (keep exactly one backup)
3. Rename `myshop.uix.tmp` → `myshop.uix` (atomic, OS-level)
4. Delete temp dir and lock file

If the rename in step 3 fails (antivirus lock, full disk, permissions issue on Windows), the `.tmp` file is preserved and the viewer notifies the user with a path to recover it manually. The `.bak` rolling backup means the previous valid copy is always one step away.

For the initial implementation: full repack is acceptable. Incremental repack (replacing only `state.db` inside the ZIP without touching other entries) is a v1.1 optimization but the atomic write pattern is non-negotiable from day one — on Windows kiosk hardware, a half-written file is a data loss event.

### 3.3 Bridge API (webview ↔ viewer)

The webview cannot access the file system. The viewer exposes a minimal, typed bridge:

```typescript
// available to the .uix app as window.__uix
window.__uix = {
  data: {
    // find records by type, with optional field filters
    find(query: { type: string; where?: Record<string, unknown>; orderBy?: string; limit?: number }): Record[]

    // get a single record by id
    get(id: string): Record | null

    // escape hatch: raw SQL against data.db (SELECT only, never writes)
    // REQUIRES "raw-sql" in manifest permissions — bridge throws if not declared
    raw(sql: string, params?: unknown[]): Record[]
  },

  state: {
    // find state records
    find(query: { type: string; where?: Record<string, unknown>; orderBy?: string; limit?: number }): Record[]

    // get a single state record by id
    get(id: string): Record | null

    // insert a new record. created_at and updated_at set automatically.
    insert(record: { type: string; body: unknown }): string  // returns generated id

    // update a record by id. updated_at is bumped automatically.
    update(id: string, body: unknown): void

    // delete a record by id
    delete(id: string): void

    // escape hatch: raw SQL against state.db (read + write)
    // REQUIRES "raw-sql" in manifest permissions — bridge throws if not declared
    raw(sql: string, params?: unknown[]): Record[]

    // delete records older than a duration, uses created_at column
    // duration format: '30d', '12h', '1y'
    purge(query: { type: string; olderThan: string }): number  // returns count deleted
  },

  // trigger system print dialog
  print(): void

  // get manifest info (read-only)
  manifest(): Manifest

  // close the viewer (kiosk exit, requires PIN if set)
  exit(pin: string): void
}
```

The `data` surface is read-only — the bridge rejects any write call against `data.db` regardless of what the app requests. The `state` surface is read-write. The `raw()` escape hatch requires the `"raw-sql"` permission to be declared in `manifest.json` — the bridge throws a permission error if an app calls it without the declaration. Raw SQL against `data` is additionally restricted to `SELECT` statements only regardless of permission.

No direct file system access. No Node/Rust APIs exposed to the webview. The bridge is the only surface.

### 3.4 Security Model

- Webview has `nodeIntegration: false` (Electron) / no capability (Tauri)
- CSP injected by the viewer, not trusted from the `.uix` file:
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'none';
  ```
- `network: "blocked"` in manifest = viewer blocks all outbound requests at the OS level
- `manifest.json` permissions are validated by the viewer before granting; the app cannot self-grant
- No `eval()`, no `new Function()` — blocked via CSP
- Expiry check happens before extraction — expired files never unpack

### 3.5 Asset Addressing

All asset paths inside a `.uix` file are **relative to the root of the archive**. The viewer extracts to a temp directory and serves all content from that root. An asset at `assets/logo.png` in the zip is referenced in HTML as `assets/logo.png` — no special protocol or absolute path is needed.

```html
<!-- correct — relative to archive root -->
<img src="assets/logo.png" />
<link rel="stylesheet" href="style.css" />
<script src="app.js"></script>

<!-- forbidden — external URL, blocked by CSP and network policy -->
<link rel="stylesheet" href="https://fonts.googleapis.com/..." />
<script src="https://cdn.jsdelivr.net/..."></script>
```

Third-party viewer implementations must serve the extracted archive from a consistent base path (Tauri uses `asset://` protocol internally; the web viewer uses a `blob:` URL root). The relative-path convention means apps are portable across all compliant viewers without modification.

---

## 4. Build Phases

### Phase 1 — Core Library (Weeks 1–3)

**Package:** `@dotuix/core`
**Published to:** npm
**Language:** TypeScript
**Status:** ✅ Complete — publish ready

Responsibilities:

- ✅ Pack a folder into a valid `.uix` file
- ✅ Unpack a `.uix` file to a directory or memory buffer
- ✅ Validate structure and manifest (using Zod)
- ✅ Read/write databases via sql.js (WebAssembly SQLite)
- ✅ schema_version in meta table (migration foundation in place — no migrations needed for v1)
- ⬜ Incremental state.db update in-place (v1.1 optimization — skip for now)

```typescript
import { UIX } from "@dotuix/core";

await UIX.pack("./my-app", "./dist/myshop.uix");
await UIX.unpack("./myshop.uix", "./extracted/");
const result = await UIX.validate("./myshop.uix");
const manifest = await UIX.manifest("./myshop.uix");
const db = await UIX.openData("./myshop.uix"); // returns sql.js Database
```

Dependencies:

- `fflate` — fast zip/unzip, WASM-based
- `sql.js` — SQLite compiled to WebAssembly
- `zod` — manifest schema validation

### Phase 2 — Web Fallback Viewer (Weeks 3–5)

**URL:** `viewer.dotuix.com`
**Package:** `@dotuix/web-viewer`
**Status:** ✅ Complete — shipped, restaurant template (18 Gulf items, QAR, cart), pushed to GitHub

**Purpose:** The first thing the public sees. Kills the "install the viewer first" problem before it becomes one.

This ships immediately after `@dotuix/core` because it costs almost nothing — `@dotuix/core` already compiles to browser-compatible JS. The viewer is a Vite + React page with a drag-and-drop zone.

User visits the site, drags a `.uix` file onto the page → it renders in 3 seconds, fully interactive.

Limitations (acceptable for v1):

- No lock files
- No system print dialog (uses browser print instead)
- State is saved to `localStorage` keyed by manifest id — survives page refresh, not a different browser

**This is the first real demo. Ship it with a complete, beautiful restaurant `.uix` template.** Not a scaffold — a working menu with real Gulf restaurant categories (مشويات، مقبلات، مشروبات), Arabic product names, realistic prices in QAR (ر.ق), and a working cart. The target user is a restaurant owner in Qatar or the Gulf. The template needs to make them say "هذا بالضبط ما أحتاجه" — not a generic Western placeholder. That's the moment the format has a future.

### Phase 3 — CLI (Weeks 5–6)

**Package:** `@dotuix/cli` / binary: `dotuix`
**Published to:** npm (global install)

```bash
dotuix pack ./my-app            # → my-app.uix in current dir
dotuix pack ./my-app -o dist/   # → dist/my-app.uix
dotuix unpack myshop.uix        # → ./myshop/ folder
dotuix validate myshop.uix      # → reports errors
dotuix info myshop.uix          # → prints manifest
dotuix init                     # → scaffolds a new .uix project
dotuix export myshop.uix --type order --format csv --output orders.csv
dotuix export myshop.uix --type order --format json --output orders.json
```

`dotuix export` reads `state.db` from inside the `.uix` file, filters records by `--type`, and writes them to a flat file. Supported formats: `csv`, `json`. This is the only way a non-technical user can get their data out of a `.uix` file and into Excel, accounting software, or a spreadsheet. Without it, `state.db` is a black box to anyone who did not write the app.

`dotuix validate` performs two classes of checks:

**Structural checks** — manifest required fields, entry file exists, databases have valid schema, ZIP integrity.

**Offline-first checks** — static analysis of all HTML, JS, and CSS source files inside the archive looking for:

- External URLs in `src`, `href`, `url()` attributes (`http://`, `https://`, `//`)
- Google Fonts imports (`fonts.googleapis.com`, `fonts.gstatic.com`)
- CDN script tags (`cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`)
- `fetch()` or `XMLHttpRequest` calls to non-relative URLs
- WebSocket connections

Any match is reported as a warning with the file and line number. Apps with `network: "blocked"` that reference external assets will break silently on a kiosk — the validator catches this before distribution.

```
$ dotuix validate myshop.uix

✓ manifest.json valid
✓ entry index.html found
✓ data.db schema correct
✓ state.db schema correct
⚠ External URL found in index.html:34 — https://fonts.googleapis.com/...
  Network is blocked. This asset will fail to load at runtime.
✗ 1 offline violation found
```

`dotuix init` generates a **working project, not a blank scaffold** — the restaurant template from Phase 2 is the default, ready to customize and pack:

```
my-uix-app/
├── manifest.json
├── index.html
├── style.css
├── app.js
├── assets/
│   └── (sample images)
└── data/
    └── seed.sql        ← run once to populate data.db with your records
```

### Phase 4 — Desktop Viewer (Weeks 6–12)

**App:** `dotuix-viewer`
**Framework:** Tauri (Rust + WebView2/WKWebView)
**Platforms:** macOS, Windows, Linux
**Installer size target:** ~5MB

> Rationale: The viewer needs exactly what Tauri is designed for — read a file, unzip to memory, run a sandboxed webview, expose a minimal bridge. It does not need Node.js. Tauri's capability model maps directly to the bridge API: you explicitly list what the webview can invoke, nothing else is exposed. Starting with Tauri is the right call; "migrate later" plans rarely execute once users exist.

Features:

- Registers `.uix` as system file type on install
- Double-click `.uix` → opens in viewer
- Kiosk mode: no address bar, no tabs, no right-click, no dev tools
- Window mode: for developer preview (shows simple toolbar with file name)
- Lock file management + crash recovery dialog
- Bridge API implementation
- PIN-protected exit in kiosk mode
- Print support
- CSP enforcement
- Migration runner (creates `state.db` with the standard `records` table on first open)

UI:

```
┌──────────────────────────────────────────────────────┐
│  [.uix icon]  Al Madina Restaurant Menu    [─] [□] [✕] │  ← kiosk: hidden
├──────────────────────────────────────────────────────┤
│                                                      │
│              [ .uix app renders here ]               │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Phase 5 — Editor (Weeks 12–20)

**App:** `dotuix-editor`
**Framework:** Electron + React + Monaco Editor + Tailwind

> Two different frameworks in the monorepo is acceptable here — the editor and viewer have genuinely different needs. The editor requires full Node.js (file system, packing, spawning processes). The audience is developers, so installer size (~150MB) is not a concern. Electron is the right fit.

Two modes:

**Developer mode:**

- File tree on the left
- Monaco editor (code) in center
- Live preview (renders the `.uix` in real-time) on the right
- One-click pack → `.uix`
- Integrated database editor (browse/edit `data.db` and `state.db` records)

**Simple mode (for shop owners):**

- Choose a template (restaurant menu, product catalog, portfolio)
- Fill in products (name, price, image upload, category)
- Click Export → downloads `.uix` file
- No code, no file system, no manifest editing

---

## 5. Monorepo Structure

```
dotuix/
├── packages/
│   ├── core/               → @dotuix/core (TypeScript)
│   ├── cli/                → @dotuix/cli  (Node.js CLI)
│   └── viewer-core/        → shared viewer logic (used by Tauri + web fallback)
├── apps/
│   ├── viewer/             → Tauri desktop viewer
│   ├── web-viewer/         → browser-based fallback (Next.js or plain Vite)
│   └── editor/             → Electron editor app
├── templates/
│   ├── restaurant/         → starter .uix project for restaurants
│   ├── catalog/            → product catalog template
│   └── portfolio/          → portfolio/showcase template
├── docs/
│   ├── start.md
│   ├── plan.md             ← this file
│   ├── spec.md             ← format spec (detailed, versioned)
│   └── api.md              ← bridge API reference
├── package.json            ← pnpm workspace root
├── pnpm-workspace.yaml
└── turbo.json              ← Turborepo for monorepo builds
```

Tooling:

- **pnpm** workspaces
- **Turborepo** for build orchestration
- **Vitest** for testing
- **Biome** for linting and formatting (fast, zero config)
- **Changesets** for versioning and changelog

---

## 6. Technology Decisions

| Layer               | Choice                                                 | Reason                                                                                                       |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Monorepo            | pnpm + Turborepo                                       | Fast installs, proper workspace linking                                                                      |
| Language            | TypeScript throughout                                  | Consistency, types for the manifest schema                                                                   |
| ZIP library         | `fflate`                                               | Fastest JS zip, supports streaming, browser + Node                                                           |
| SQLite              | `sql.js` (browser/viewer), `better-sqlite3` (CLI/Node) | sql.js for in-memory webview use, better-sqlite3 for CLI tooling                                             |
| Manifest validation | `zod`                                                  | Schema-first, great error messages, TypeScript inference                                                     |
| Viewer              | Tauri (Rust + WebView)                                 | ~5MB installer; capability-based sandbox maps directly to the bridge API; no Node.js needed in the viewer    |
| Editor              | Electron + React                                       | Full Node.js needed for file system ops, packing, spawning; Monaco editor; developer audience tolerates size |
| Web fallback        | Vite + React                                           | Lightweight, no SSR needed                                                                                   |
| Testing             | Vitest                                                 | Fast, ESM-native, same config as Vite                                                                        |
| Linting             | Biome                                                  | Replaces ESLint + Prettier, fast                                                                             |

---

## 7. Key Technical Risks & Mitigations

| Risk                                  | Impact            | Mitigation                                                                                                     |
| ------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Viewer install friction               | Adoption blocker  | Web fallback viewer at `viewer.dotuix.com` ships in Phase 2 — before the desktop viewer                        |
| Repack is slow on large files         | Bad UX on close   | Incremental state.db update (v1.1); show progress on close                                                     |
| SQLite inside ZIP compresses badly    | Larger file sizes | STORE method for `.db` files in zip (spec'd in format)                                                         |
| Malicious `.uix` file                 | Security          | CSP enforced by viewer; no bridge to file system; network blocked by default                                   |
| Tauri webview inconsistency across OS | Rendering bugs    | WKWebView (macOS), WebView2 (Windows), WebKitGTK (Linux) differ; test suite with visual snapshots on all three |
| Format adoption with no platform      | Format dies       | Restaurant demo template ships with web viewer in Week 5; one real user is the target                          |

---

## 8. Open Source Strategy

| Package         | License                        | Reason                                                             |
| --------------- | ------------------------------ | ------------------------------------------------------------------ |
| `@dotuix/core`  | MIT                            | Maximum adoption; developers build on it                           |
| `@dotuix/cli`   | MIT                            | Developers integrate in their build pipelines                      |
| `viewer-core`   | MIT                            | Enables third-party viewers                                        |
| `dotuix-viewer` | MIT                            | Builds trust; anyone can audit what the viewer does to their files |
| `dotuix-editor` | Source Available or Commercial | Revenue source                                                     |

The format spec itself will be published as an open document under Creative Commons — anyone can build a viewer or tool without asking permission. The format survives the tooling. If the tools disappear, every `.uix` file ever created can still be opened by any future implementation that follows the spec. This is what makes it a format and not just a product.

---

## 9. Milestones

| Milestone | Deliverable                                                                  | Target  | Status              |
| --------- | ---------------------------------------------------------------------------- | ------- | ------------------- |
| M1        | `@dotuix/core` published to npm with full test suite                         | Week 3  | ✅ Ready to publish |
| M2        | Web fallback viewer live at `viewer.dotuix.com` + restaurant demo template   | Week 5  | ✅ Complete         |
| M3        | `dotuix` CLI — pack, unpack, validate, init (ships with restaurant template) | Week 6  | ✅ Complete         |
| M4        | Tauri viewer opens a `.uix` in kiosk mode                                    | Week 9  | ✅ Complete         |
| M5        | Lock files, repack-on-close, file association, purge, minViewer, expires     | Week 12 | ✅ Complete         |
| M5.1      | Bridge enhancements: where/orderBy/limit in find(), raw() SQL escape hatch   | Week 13 | ✅ Complete         |
| M6        | Editor developer mode (code + live preview + DB editor)                      | Week 16 | 🔄 In progress      |
| M7        | Editor simple mode (template + export)                                       | Week 20 | ⬜ Not started      |
| M8        | Catalog and portfolio starter templates                                      | Week 20 | ⬜ Not started      |

---

## 10. What This Is Not

- Not a replacement for web apps or PWAs for always-online products
- Not a general app distribution format (no OS-level APIs, no background processes)
- Not a competitor to Electron or Tauri for complex desktop apps
- Not a document format for static content (use PDF for that)

It is specifically: **a portable, offline-first, interactive experience in one file**, for environments where the internet is absent, unreliable, or irrelevant.
