# dotuix — Developer Guide

> How to create `.uix` files: every method, every security option.

A `.uix` file is a ZIP archive containing an HTML/JS app, optional SQLite databases, and a `manifest.json`. This guide shows you every way to create one — from packing a plain HTML folder to building a signed, encrypted file with React and a full SQLite dataset.

---

## Prerequisites

```bash
node -v   # 18+
pnpm -v   # 9+

# Install the CLI globally
npm install -g @dotuix/cli
```

---

## Method 1 — Plain HTML/CSS/JS (scaffold with `dotuix init`)

The simplest path. Run `dotuix init` to get a working scaffold, then edit the files and pack.

```bash
dotuix init my-app
cd my-app
```

This creates:

```
my-app/
├── manifest.json     ← pre-filled with your app name
├── index.html        ← entry point wired to app.js
├── style.css
└── app.js            ← bridge usage example included
```

Add your own assets and a `data.db` as needed:

```
my-app/
├── manifest.json
├── index.html
├── style.css
├── app.js
├── assets/
│   └── logo.png
└── data.db           ← optional: read-only SQLite data (see "Database schema" below)
```

### manifest.json (minimal)

```json
{
  "uix": "1.0",
  "id": "com.yourcompany.appname",
  "name": "My App",
  "version": "1.0.0",
  "entry": "index.html",
  "mode": "kiosk",
  "network": "blocked"
}
```

| Field       | Required | Notes                                                                                        |
| ----------- | -------- | -------------------------------------------------------------------------------------------- |
| `uix`       | Yes      | Always `"1.0"`                                                                               |
| `id`        | Yes      | Reverse-domain string. Unique per app. Used for state isolation and signatures.              |
| `name`      | Yes      | Human-readable name shown in the viewer title bar                                            |
| `version`   | Yes      | SemVer. Your app version.                                                                    |
| `entry`     | Yes      | Path to entry HTML file inside the archive                                                   |
| `mode`      | Yes      | `"kiosk"` — no address bar, locked UI. `"window"` — regular windowed mode for dev/portfolio. |
| `network`   | No       | `"blocked"` (default) — viewer blocks all outbound requests. `"allowed"` — unrestricted.     |
| `expires`   | No       | ISO date string `"2026-12-31"`. Viewer refuses to open the file after this date.             |
| `minViewer` | No       | Minimum viewer version required. e.g. `"1.2.0"`. Older viewers show a clear error.           |

### Pack and validate

```bash
# from inside my-app/ or from outside
dotuix pack ./my-app
# → my-app.uix in current directory

dotuix pack ./my-app -o dist/my-app.uix
# → dist/my-app.uix

dotuix validate my-app.uix
# checks structure, manifest, databases, and external URL violations
```

### Using the bridge in your app

The viewer injects `window.__uix` before your app runs. Always check for it — your app must also work in a plain browser for development.

```javascript
// app.js
async function loadData() {
  if (!window.__uix) {
    // Dev/preview fallback — use hardcoded demo data
    return DEMO_DATA;
  }

  // Production — read from data.db via the bridge
  return await window.__uix.data.find({ type: "product" });
}

// Find with filters
const burgers = await window.__uix.data.find({
  type: "product",
  where: { category: "burgers" },
  orderBy: "price",
  limit: 10,
});

// Get a single record
const item = await window.__uix.data.get("product:001");

// Write user state
const orderId = await window.__uix.state.insert({
  type: "order",
  body: { items: [{ id: "product:001", qty: 2 }], total: 90 },
});

// Update state
await window.__uix.state.update(orderId, { status: "confirmed" });

// Delete state
await window.__uix.state.delete(orderId);

// Delete old records
await window.__uix.state.purge({ type: "cart_item", olderThan: "7d" });

// Raw SQL (requires "raw-sql" in manifest permissions)
const results = await window.__uix.data.raw(
  "SELECT body FROM records WHERE type = ? ORDER BY json_extract(body, '$.sort') ASC",
  ["product"],
);

// Get manifest info
const manifest = window.__uix.manifest();

// Trigger system print dialog
window.__uix.print();
```

### Database schema

Both `data.db` and `state.db` use the same fixed schema. The viewer never inspects the content of `body` — it is entirely up to your app.

```sql
CREATE TABLE records (
  id         TEXT    PRIMARY KEY,
  type       TEXT    NOT NULL,
  body       TEXT    NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_type       ON records (type);
CREATE INDEX idx_created_at ON records (created_at);
```

To create a `data.db` programmatically:

```bash
# Using the core library in Node
node --input-type=module --eval "
  import initSqlJs from 'sql.js';
  import { writeFileSync } from 'fs';

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(\`CREATE TABLE records (
    id TEXT PRIMARY KEY, type TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )\`);
  db.run('CREATE INDEX idx_type ON records(type)');

  db.run('INSERT INTO records VALUES (?, ?, ?, unixepoch(), unixepoch())', [
    'product:001', 'product',
    JSON.stringify({ name: 'Grilled Chicken', price: 45, category: 'Mains' })
  ]);

  writeFileSync('data.db', Buffer.from(db.export()));
  db.close();
  console.log('data.db written');
"
```

---

## Method 2 — React / Vue / Svelte / TypeScript with the Vite plugin

Build your app with any Vite-compatible framework. The plugin compiles it to plain HTML+JS and packs it as a `.uix`.

```bash
pnpm add -D @dotuix/vite-plugin
```

**vite.config.ts**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dotuix } from "@dotuix/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    dotuix(), // reads manifest.json from project root
  ],
});
```

Add `manifest.json` to your project root (same format as above), then:

```bash
vite dev    # dev server with mock window.__uix bridge auto-injected
vite build  # compiles → bundles → packs → outputs <name>.uix
```

The plugin sets `base: "./"` automatically so asset URLs stay relative inside the archive.

**Using the bridge with TypeScript:**

```ts
// types/dotuix.d.ts — add to your project
interface DotuixRecord {
  id: string;
  type: string;
  body: unknown;
  created_at: number;
  updated_at: number;
}

interface DotuixBridge {
  data: {
    find(query: {
      type: string;
      where?: Record<string, unknown>;
      orderBy?: string;
      limit?: number;
    }): Promise<DotuixRecord[]>;
    get(id: string): Promise<DotuixRecord | null>;
    raw(sql: string, params?: unknown[]): Promise<DotuixRecord[]>;
  };
  state: {
    find(query: {
      type: string;
      where?: Record<string, unknown>;
      orderBy?: string;
      limit?: number;
    }): Promise<DotuixRecord[]>;
    get(id: string): Promise<DotuixRecord | null>;
    insert(record: { type: string; body: unknown }): Promise<string>;
    update(id: string, body: unknown): Promise<void>;
    delete(id: string): Promise<void>;
    purge(query: { type: string; olderThan: string }): Promise<number>;
    raw(sql: string, params?: unknown[]): Promise<DotuixRecord[]>;
  };
  manifest(): {
    id: string;
    name: string;
    version: string;
    [key: string]: unknown;
  };
  print(): void;
}

declare global {
  interface Window {
    __uix?: DotuixBridge;
  }
}
```

---

## Method 3 — Programmatic (Node.js / build scripts)

Use `@dotuix/core` directly in scripts, CI pipelines, or server-side generators.

```bash
pnpm add @dotuix/core
```

```ts
import { UIX } from "@dotuix/core";

// Pack a folder
await UIX.pack("./my-app", "./dist/my-app.uix");

// Unpack to folder
await UIX.unpack("./my-app.uix", "./extracted/");

// Validate
const result = await UIX.validate("./my-app.uix");
if (!result.valid) console.error(result.errors);

// Read manifest
const manifest = await UIX.manifest("./my-app.uix");

// Pack/unpack via buffer (for in-memory pipelines)
import { readFileSync, writeFileSync } from "fs";
const buf = readFileSync("./my-app.uix");
const { files, manifest: m } = await UIX.unpackBuffer(buf);

const outBuf = await UIX.packBuffer(files, m);
writeFileSync("./output.uix", outBuf);
```

---

## Method 4 — Use the Editor (no CLI needed)

Open `apps/editor`, switch to **Simple** mode, pick a template (restaurant / catalog / portfolio), fill in your items, and click **Export .uix**. The editor handles data.db creation, manifest generation, and packing automatically. See the [business owner guide](./for-business-owners.md) for a walkthrough.

---

## CLI reference

```bash
dotuix pack   <dir>             # pack folder → .uix
dotuix unpack <file.uix>        # unpack → folder
dotuix validate <file.uix>      # structural + offline checks
dotuix info   <file.uix>        # print manifest
dotuix init                     # scaffold a new project (restaurant template)
dotuix export <file.uix> --type order --format csv --output orders.csv
dotuix keygen                   # generate an Ed25519 key pair
dotuix sign   <file.uix> --key private.key
dotuix verify <file.uix> --key public.key
dotuix encrypt <file.uix> --pin "1234" --paths data.db --output secure.uix
```

---

## Security scenarios

Security is **always opt-in**. Omit the `security` and `signature` fields entirely for regular apps — they will never be checked.

---

### Scenario A — No security (default)

A restaurant menu, a product catalogue, a portfolio. No `security` block, no `signature`. The viewer opens it immediately.

```json
{
  "uix": "1.0",
  "id": "com.almadina.menu",
  "name": "Al Madina Restaurant Menu",
  "version": "2.0.0",
  "entry": "index.html",
  "mode": "kiosk",
  "network": "blocked"
}
```

---

### Scenario B — Tamper detection (Ed25519 signature)

Proves the file has not been modified since you signed it. The viewer refuses to open a tampered file. The content is **not encrypted** — it is still readable, just unforgeable.

**When to use:** sales proposals, audit reports, official documents, legal filings — anything where the recipient must be sure the content is exactly what you sent.

```bash
# 1. Generate a key pair once
dotuix keygen
# → private.key  (keep secret)
# → public.key   (share with recipients / embed in viewer config)

# 2. Sign the file
dotuix sign my-app.uix --key private.key
# → adds a `signature` block to manifest.json inside the archive

# 3. Verify (the Tauri viewer does this automatically on every open)
dotuix verify my-app.uix --key public.key
```

The `signature` block added to `manifest.json`:

```json
{
  "signature": {
    "algorithm": "Ed25519",
    "publicKey": "base64url-public-key",
    "value": "base64url-signature",
    "signedAt": "2026-05-19T10:00:00Z"
  }
}
```

The signed payload covers all app files (excluding `state.db`, which is user-writable). Adding, removing, or changing any file after signing invalidates the signature.

---

### Scenario C — PIN protection + encryption

The app content is encrypted at rest with AES-256-GCM. The viewer asks for a PIN before anything is decrypted or run. No server involved — key derived locally from the PIN using PBKDF2-SHA256.

**When to use:** internal briefings, confidential pricing, HR documents, any content meant for a specific audience with a shared PIN.

```bash
# Encrypt specific files inside a .uix
dotuix encrypt my-app.uix \
  --pin "1234" \
  --paths data.db,files/annex.pdf \
  --output my-app-secure.uix
```

The `security` block added to `manifest.json`:

```json
{
  "security": {
    "auth": "pin",
    "encryptedPaths": ["data.db", "files/annex.pdf"],
    "kdf": "PBKDF2-SHA256",
    "kdfIterations": 200000,
    "keySalt": "base64url-random-salt"
  }
}
```

How it works:

1. `dotuix encrypt` derives an AES-256 key: `PBKDF2(PIN, randomSalt, 200 000 iterations, SHA-256)`
2. Each specified path is encrypted with AES-256-GCM: `[12-byte nonce][ciphertext + 16-byte GCM tag]`
3. The salt is stored in `manifest.json` (safe — it does not reveal the PIN)
4. On open, the Tauri viewer shows a PIN dialog, derives the key from the same salt, and decrypts files in memory — they are never written to disk unencrypted

---

### Scenario D — PIN + signature (maximum security)

Sign first, then encrypt. This proves the content is authentic **and** keeps it confidential.

```bash
dotuix sign my-app.uix --key private.key
dotuix encrypt my-app.uix --pin "1234" --paths data.db --output my-app-secure.uix
```

The Tauri viewer verifies the signature first (before decryption), then prompts for the PIN. A tampered encrypted file is rejected at the signature check step.

---

### Scenario E — Expiry + max opens

Add these fields to `manifest.json` to limit access by time or number of opens. No encryption required — these are enforced by the viewer before extraction.

```json
{
  "expires": "2026-06-30",
  "security": {
    "maxOpens": 5
  }
}
```

- `expires` — viewer checks system date before opening. Expired files show a message and refuse to unpack.
- `maxOpens` — viewer tracks opens locally in `~/.dotuix/sessions.db`. After the limit is reached, the file will not open again on that machine. The counter is per-machine.

---

### Scenario F — Encrypted + expiry + max opens + signature (classified briefing)

Full manifest for a classified document:

```json
{
  "uix": "1.0",
  "id": "gov.qa.briefing.q2-2026",
  "name": "Ministry Briefing Q2 2026",
  "version": "1.0.0",
  "entry": "index.html",
  "mode": "kiosk",
  "network": "blocked",
  "expires": "2026-06-30",
  "minViewer": "1.0.0",
  "security": {
    "auth": "pin",
    "encryptedPaths": ["data.db", "files/annex-a.pdf"],
    "kdf": "PBKDF2-SHA256",
    "kdfIterations": 200000,
    "keySalt": "aBcDeFgHiJkLmNoPqRs==",
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

Build workflow for this scenario:

```bash
# 1. Build the app
dotuix pack ./briefing-app

# 2. Sign
dotuix sign briefing-app.uix --key private.key

# 3. Encrypt
dotuix encrypt briefing-app.uix \
  --pin "your-secure-pin" \
  --paths data.db,files/annex-a.pdf \
  --output briefing-final.uix

# 4. Verify the result
dotuix verify briefing-final.uix --key public.key
dotuix validate briefing-final.uix
```

---

## Export user data (state.db)

After users interact with a `.uix` app, their data is stored back in the file inside `state.db`. Export it:

```bash
dotuix export my-app.uix --type order --format csv --output orders.csv
dotuix export my-app.uix --type order --format json --output orders.json
dotuix export my-app.uix --type cart_item --format csv --output cart_items.csv
```

This reads `state.db` from inside the `.uix` file, filters records by `--type`, and writes flat rows. Use this to get orders into Excel, accounting software, or any other tool.

---

## Validate before distributing

```bash
dotuix validate my-app.uix
```

Checks:

- `manifest.json` required fields and schema
- Entry file exists inside the archive
- `data.db` / `state.db` schema is correct
- **Offline-first analysis:** scans all HTML, JS, and CSS for external URLs, Google Fonts, CDN script tags, `fetch()` calls to non-relative URLs, WebSocket connections — reports line numbers

```
✓ manifest.json valid
✓ entry index.html found
✓ data.db schema correct
⚠ External URL in index.html:34 — https://fonts.googleapis.com/…
  Network is blocked. This asset will fail at runtime.
✗ 1 offline violation found
```

---

## Starter templates

Three ready-to-run templates are in the monorepo under `templates/`:

| Template                                          | Record type | Key fields                              |
| ------------------------------------------------- | ----------- | --------------------------------------- |
| [`templates/restaurant`](../templates/restaurant) | `product`   | name, description, price, category      |
| [`templates/catalog`](../templates/catalog)       | `product`   | name, description, price, category, sku |
| [`templates/portfolio`](../templates/portfolio)   | `project`   | title, description, category, year      |

Pack any of them directly:

```bash
dotuix pack ./templates/restaurant -o restaurant.uix
dotuix pack ./templates/catalog    -o catalog.uix
dotuix pack ./templates/portfolio  -o portfolio.uix
```
