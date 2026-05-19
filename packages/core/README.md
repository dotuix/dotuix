# @dotuix/core

Core library for creating, reading, and validating `.uix` files.

A `.uix` file is a ZIP archive containing an HTML app, assets, and optional SQLite databases. Think of it like a PDF — but interactive, offline, and self-contained in a single file.

## Install

```bash
npm install @dotuix/core
# or
pnpm add @dotuix/core
```

> Requires Node.js ≥ 22.

## Quick Start

```typescript
import { UIX } from "@dotuix/core";

// Pack a project folder into a .uix archive
await UIX.pack("./my-app", "./dist/myshop.uix");

// Unpack to a directory
await UIX.unpack("./myshop.uix", "./extracted/");

// Validate
const result = await UIX.validate("./myshop.uix");
console.log(result.valid, result.errors, result.warnings);

// Read the manifest
const manifest = await UIX.manifest("./myshop.uix");
console.log(manifest.name, manifest.version);

// Open the embedded read-only database
const data = await UIX.openData("./myshop.uix", { permissions: [] });
if (data) {
  const products = data.find({
    type: "product",
    where: { category: "burgers" },
  });
  data.close();
}

// Create / load state.db in memory
const state = await UIX.createState({ uixVersion: "1.0", permissions: [] });
const id = state.insert({
  type: "cart_item",
  body: { productId: "p:001", qty: 2 },
});
const item = state.get(id);
const bytes = state.export(); // serialize for repacking
state.close();
```

---

## API

### Packing & Unpacking

#### `pack(srcDir, outputPath)`

Pack a folder into a `.uix` file on disk (Node.js).

- Reads `manifest.json` from `srcDir` and validates it.
- Compresses HTML/CSS/JS/JSON with DEFLATE. Stores `.db`, images, and media with STORE (no compression).
- Writes atomically via `.tmp` → rename.

```typescript
await UIX.pack("./my-app", "./dist/myshop.uix");
```

#### `packBuffer(files)`

Pack an in-memory file map into a `Uint8Array` (universal — browser + Node.js).

```typescript
const encoder = new TextEncoder();
const buf = await UIX.packBuffer({
  "manifest.json": encoder.encode(JSON.stringify(manifest)),
  "index.html": encoder.encode("<html>…</html>"),
});
```

#### `unpack(uixPath, outDir)`

Extract a `.uix` archive to a directory on disk (Node.js).

```typescript
await UIX.unpack("./myshop.uix", "./extracted/");
```

#### `unpackBuffer(data)`

Extract a `.uix` buffer into an in-memory file map (universal).

```typescript
const files = UIX.unpackBuffer(data); // Record<string, Uint8Array>
const html = new TextDecoder().decode(files["index.html"]);
```

---

### Validation

#### `validate(uixPath)` / `validateBuffer(data)`

Returns `{ valid: boolean; errors: string[]; warnings: string[] }`.

Checks:

- `manifest.json` exists and is valid (required fields, id format, expiry)
- Entry file declared in manifest exists in the archive
- File has not expired
- *(Warning, not error)* Media/document files found outside `assets/` or `files/`
- *(Warning)* `security.encryptedPaths` lists a file not present in the archive
- *(Warning)* `security.auth: "pin"` declared but `encryptedPaths` or `keySalt` missing

```typescript
const result = await UIX.validate("./myshop.uix");
if (!result.valid) console.error(result.errors);
if (result.warnings.length) console.warn(result.warnings);
```

---

### Manifest

#### `manifest(uixPath)` / `manifestFromBuffer(data)`

Read and parse the manifest from an archive.

```typescript
const m = await UIX.manifest("./myshop.uix");
// m.id, m.name, m.version, m.entry, m.mode, m.permissions, …
```

#### `parseManifest(raw)` / `safeParseManifest(raw)`

Validate a raw manifest object using Zod. `parseManifest` throws on invalid input; `safeParseManifest` returns a Zod `SafeParseReturnType`.

---

### Databases

Both `data.db` (read-only, creator-shipped) and `state.db` (read-write, user-owned) share the same schema:

```sql
CREATE TABLE records (
  id         TEXT    PRIMARY KEY,
  type       TEXT    NOT NULL,
  body       TEXT    NOT NULL,   -- JSON, shape decided by the .uix app
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### `openData(uixPath, opts?)` / `openDataBuffer(data, opts?)`

Open `data.db` from a `.uix` archive. Returns `UIXDataDB | null` (null if the archive has no `data.db`).

```typescript
const db = await UIX.openData("./myshop.uix", { permissions: ["raw-sql"] });
if (db) {
  db.find({ type: "product" });
  db.find({ type: "product", where: { category: "مشويات" }, limit: 10 });
  db.get("product:001");
  db.raw("SELECT body FROM records WHERE type = ? ORDER BY rowid", ["product"]);
  db.close();
}
```

#### `createState(opts)` → `UIXStateDB`

Create a fresh state.db in memory, or load from a seed.

```typescript
const state = await UIX.createState({ uixVersion: "1.0" });

// With a seed (from manifest.state.seed = true)
const seed = files["state.db"]; // Uint8Array from unpackBuffer
const state = await UIX.createState({
  uixVersion: "1.0",
  seed,
  permissions: [],
});
```

#### `openStateFromFile(statePath, opts?)` → `UIXStateDB`

Load an existing `state.db` file from disk (Node.js). Useful for CLI export commands.

---

### `UIXDataDB` methods

| Method              | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `find(query)`       | Find records by type, with optional `where`, `orderBy`, `limit`   |
| `get(id)`           | Get a single record by id, or `null`                              |
| `raw(sql, params?)` | Execute a SELECT/WITH statement. Requires `"raw-sql"` permission. |
| `close()`           | Release the database                                              |

### `UIXStateDB` methods

| Method                       | Description                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `find(query)`                | Find records by type                                                            |
| `get(id)`                    | Get a single record by id, or `null`                                            |
| `insert({ type, body })`     | Insert a record. Returns the generated id (`{type}:{uuid}`).                    |
| `update(id, body)`           | Update a record's body. Bumps `updated_at`.                                     |
| `delete(id)`                 | Delete a record by id                                                           |
| `raw(sql, params?)`          | Execute any SQL. Requires `"raw-sql"` permission.                               |
| `purge({ type, olderThan })` | Delete records older than a duration (`'30d'`, `'12h'`, `'1y'`). Returns count. |
| `export()`                   | Serialize the database to `Uint8Array` for repacking.                           |
| `close()`                    | Release the database                                                            |

### `FindQuery`

```typescript
interface FindQuery {
  type: string;
  where?: Record<string, unknown>; // json_extract filters on body fields
  orderBy?: string; // column name or body field
  limit?: number;
}
```

---

## Format

### Archive structure

```
myapp.uix (ZIP)
├── manifest.json        ← required
├── index.html           ← entry point
├── app.js
├── style.css
├── assets/              ← media files (images, video, audio, fonts)
│   ├── images/
│   ├── videos/
│   ├── audio/
│   └── fonts/
├── files/               ← any other file: PDF, JSON, CSV, plain text, …
├── data.db              ← optional: read-only SQLite (creator data)
└── state.db             ← optional: read-write SQLite (user session)
```

`assets/` and `files/` are conventions, not requirements. Files can live anywhere in the archive and are referenced via normal relative HTML paths. The validator emits a warning (never an error) if media files are found outside these folders.

### manifest.json

Minimal (restaurant, shop, any regular app):

```json
{
  "uix": "1.0",
  "id": "com.almadina.menu",
  "name": "Al Madina Restaurant Menu",
  "version": "2.1.0",
  "entry": "index.html",
  "mode": "kiosk",
  "permissions": ["local-storage", "print"],
  "network": "blocked",
  "author": "emad@domain.com",
  "expires": null,
  "state": { "seed": false }
}
```

With optional security block (government / classified use case — omit entirely for regular apps):

```json
{
  "uix": "1.0",
  "id": "gov.qa.briefing.classified",
  "name": "Ministry Briefing Q2 2026",
  "version": "1.0.0",
  "entry": "index.html",
  "mode": "kiosk",
  "permissions": [],
  "network": "blocked",
  "expires": "2026-06-30",
  "security": {
    "auth": "pin",
    "encryptedPaths": ["data.db", "files/annex-a.pdf"],
    "kdf": "PBKDF2-SHA256",
    "kdfIterations": 200000,
    "keySalt": "base64url-random-salt",
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

**`mode`:** `kiosk` (locked UI, no browser chrome) or `window` (developer preview).

**`permissions`:** `local-storage`, `print`, `clipboard-write`, `fullscreen`, `raw-sql`.

**`network`:** `blocked` (default) or `allowed`.

**`security` fields** (all optional — omit the block for regular apps):

| Field | Default | Description |
|---|---|---|
| `auth` | `"none"` | `"pin"` — viewer prompts for PIN before opening |
| `encryptedPaths` | `[]` | Paths inside the archive encrypted with AES-256-GCM |
| `kdf` | `"PBKDF2-SHA256"` | Key derivation function |
| `kdfIterations` | `200000` | PBKDF2 iterations (higher = slower brute-force) |
| `keySalt` | — | Base64url random salt stored in manifest (safe to store publicly) |
| `maxOpens` | unlimited | Max opens tracked by the viewer locally — file cannot bypass this |
| `screenshot` | `false` | `true` = viewer blocks OS screenshot API (desktop only) |

### Compression

| File type | ZIP method |
|---|---|
| HTML, CSS, JS, JSON, text | DEFLATE (level 6) |
| PNG, JPG, JPEG, WEBP, GIF, SVG, MP4, MP3, WEBM, WASM | STORE |
| `.db` files | STORE |
| PDF, DOCX, XLSX and other already-compressed formats | STORE |

---

## License

MIT
