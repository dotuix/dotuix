# The .uix Executable Document Format

**Specification Version:** 1.0
**Status:** Stable
**Published:** 2026-05-20
**License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
**Repository:** https://github.com/dotuix/dotuix
**Canonical URL:** https://dotuix.uts.qa/llms.txt

---

## Abstract

`.uix` is a portable executable document format. A `.uix` file is a standard ZIP
archive containing a self-contained HTML/JS/CSS application, optional static assets,
and optional SQLite databases. A compliant viewer opens the file fully offline with
no network connection, no installation step beyond the viewer itself, and no server.

The format combines the distribution story of PDF (single file, viewer pre-installed)
with the interactivity of a native application and the authoring simplicity of HTML.

---

## Status of This Document

This document defines the `.uix` format version 1.0. It is the normative specification
for all conforming implementations.

This specification is published under Creative Commons Attribution 4.0 International.
Anyone may implement a compliant viewer, packer, or editor without permission, provided
attribution is given to the dotuix project.

---

## Conformance

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this
document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

A **compliant packer** is software that produces `.uix` files conforming to this spec.
A **compliant viewer** is software that opens `.uix` files conforming to this spec.
A **conformant file** is a `.uix` file that satisfies all MUST requirements in this spec.

---

## 1. Container Format

### 1.1 Archive

A `.uix` file MUST be a valid [ZIP](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
archive (PKWARE ZIP, version 2.0 or later). The archive MUST NOT be encrypted at the
ZIP level — encryption is handled at the application layer (see §7).

A `.uix` file MUST contain at minimum:

- `manifest.json` — the application manifest (see §2)
- The entry HTML file declared in `manifest.entry`

### 1.2 Compression Rules

| File type                                                                                   | Compression method |
| ------------------------------------------------------------------------------------------- | ------------------ |
| `.html`, `.css`, `.js`, `.json`, `.txt`, `.svg`, `.xml`                                     | DEFLATE            |
| `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.mp4`, `.mp3`, `.woff`, `.woff2`, `.otf`, `.ttf` | STORE              |
| `data.db`, `state.db`                                                                       | STORE              |
| All other files                                                                             | DEFLATE            |

Binary files and SQLite databases SHOULD be stored uncompressed (STORE). Applying
DEFLATE to already-compressed binary data wastes CPU and increases file size.

### 1.3 Conventional Directory Layout

The following layout is RECOMMENDED but NOT REQUIRED. Files MAY be placed anywhere
in the archive and are referenced by path relative to the entry HTML file.

```
myapp.uix  (ZIP archive)
├── manifest.json       ← REQUIRED
├── index.html          ← entry point (declared in manifest.entry)
├── app.js
├── style.css
├── assets/             ← RECOMMENDED: images, video, audio, fonts
├── files/              ← RECOMMENDED: PDFs, CSVs, JSON, other embedded files
├── data.db             ← OPTIONAL: read-only SQLite (creator content)
└── state.db            ← OPTIONAL: SQLite seed (copied as user state on first open)
```

A validator MAY emit a warning (not an error) when media files are found outside `assets/`.

---

## 2. Manifest

### 2.1 Location and Encoding

The file `manifest.json` MUST be present at the root of the archive.
It MUST be valid JSON encoded as UTF-8.

### 2.2 Required Fields

| Field     | Type   | Description                                                                                                                                                                                    |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uix`     | string | Format version. MUST be `"1.0"` for files conforming to this specification.                                                                                                                    |
| `id`      | string | Reverse-domain application identifier, e.g. `"com.example.myapp"`. MUST be stable across versions of the same application. Used for state isolation. No DNS ownership is asserted or required. |
| `name`    | string | Human-readable application name. MUST NOT be empty.                                                                                                                                            |
| `version` | string | Application version. SHOULD follow [Semantic Versioning 2.0](https://semver.org/).                                                                                                             |
| `entry`   | string | Path to the entry HTML file inside the archive, relative to the archive root, e.g. `"index.html"`. The named file MUST exist in the archive.                                                   |
| `mode`    | string | `"kiosk"` — locked display, no address bar, no context menu, no developer tools. `"window"` — windowed display with viewer toolbar and developer tools. MUST be one of these two values.       |

### 2.3 Optional Fields

| Field         | Type         | Default     | Description                                                                                                                                                                                                                                                                                    |
| ------------- | ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minViewer`   | string       | none        | Minimum viewer version (SemVer) required to open this file. A compliant viewer MUST refuse to open the file and display a clear message if its version is below `minViewer`.                                                                                                                   |
| `permissions` | string[]     | `[]`        | Capabilities this application requires. See §2.4.                                                                                                                                                                                                                                              |
| `network`     | string       | `"blocked"` | `"blocked"` — the viewer MUST enforce a Content Security Policy that blocks all external network requests. `"allowed"` — external requests are permitted.                                                                                                                                      |
| `theme`       | object       | none        | Viewer chrome colours: `color` (hex string) and `background` (hex string).                                                                                                                                                                                                                     |
| `author`      | string       | none        | Creator identity — email address or display name.                                                                                                                                                                                                                                              |
| `expires`     | string\|null | null        | ISO 8601 date-time string. If present and non-null, a compliant viewer MUST check the expiry **before extracting any content**. If the current time is past `expires`, the viewer MUST refuse to open the file and MUST NOT display any of its content.                                        |
| `state.seed`  | boolean      | false       | If `true`, the `state.db` file in the archive is a creator-provided seed. On the first open of a new installation, the viewer MUST copy the archive's `state.db` to the user's state store as the initial state. On subsequent opens the user's persisted state is used, not the archive copy. |
| `security`    | object       | none        | Optional PIN authentication and encryption. See §6.                                                                                                                                                                                                                                            |
| `signature`   | object       | none        | Optional Ed25519 integrity signature. See §7.                                                                                                                                                                                                                                                  |
| `ai`          | object       | none        | Optional AI provenance metadata. See §8.                                                                                                                                                                                                                                                       |

### 2.4 Permissions

An application MUST declare a permission in `manifest.permissions` before the viewer
exposes the corresponding capability. Undeclared capabilities MUST be silently blocked.

| Permission value    | Capability granted                                     |
| ------------------- | ------------------------------------------------------ |
| `"local-storage"`   | Browser `localStorage` read/write access               |
| `"print"`           | System print dialog via `uix.print()`                  |
| `"clipboard-write"` | Clipboard write access                                 |
| `"fullscreen"`      | Fullscreen API                                         |
| `"raw-sql"`         | `uix.data.raw()` and `uix.state.raw()` — arbitrary SQL |

---

## 3. Databases

### 3.1 Schema

Both `data.db` and `state.db` use an identical SQLite schema. A compliant packer
MUST create both databases with exactly this schema:

```sql
CREATE TABLE records (
  id         TEXT    PRIMARY KEY,
  type       TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_type       ON records (type);
CREATE INDEX idx_created_at ON records (created_at);
```

`state.db` additionally contains a `meta` table created by the viewer on first open:

```sql
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

The viewer SHOULD use the `meta` table to store internal metadata (e.g. open count,
first-open timestamp). Applications MUST NOT read or write to `meta` directly unless
`"raw-sql"` permission is declared.

### 3.2 Field Semantics

- **`id`** — Application-defined primary key. RECOMMENDED convention: `"type:identifier"`, e.g. `"product:001"`, `"cart_item:a1b2c3d4"`. MUST be unique within a database.
- **`type`** — Application-defined record category. Used as the primary query dimension.
- **`body`** — Application-defined data payload. MUST be a valid JSON string. The viewer stores and returns it without inspecting its contents.
- **`created_at`** — Unix timestamp (seconds). Set by the viewer on insert. MUST NOT be changed by subsequent updates.
- **`updated_at`** — Unix timestamp (seconds). Set by the viewer on insert and updated on every `update` call.

### 3.3 Database Roles

**`data.db`** is creator-owned and read-only at runtime. It is packed into the `.uix`
by the creator and MUST NOT be modified after distribution. The viewer MUST open it
read-only and expose it through the `uix.data` bridge.

**`state.db`** is user-owned and writable at runtime. The viewer maintains one
`state.db` per application ID, persisted on the user's device. Applications read and
write it through the `uix.state` bridge. If `manifest.state.seed` is `true`, the
viewer MUST bootstrap the user's state from the archive copy on first open.

### 3.4 Atomic Write on Close

When the viewer closes a `.uix` file, it MUST write the updated `state.db` back into
the archive atomically. A partial write MUST NOT leave the archive in a corrupted state.
The RECOMMENDED implementation is to write to a `.uix.tmp` file and rename it over the
original on success.

---

## 4. Runtime Bridge API

### 4.1 Injection

A compliant viewer MUST inject a bridge object as `window.__uix` into the application's
webview or iframe before the entry document's scripts execute. The viewer MUST also
expose it as `window.uix` (an alias). Applications SHOULD use `uix` (without the double
underscore) as the preferred form.

The bridge MUST NOT be accessible outside the running `.uix` application.

### 4.2 All Bridge Methods Return Promises

Every bridge method is asynchronous and returns a `Promise`. Applications MUST `await`
bridge calls or handle them with `.then()`.

### 4.3 `uix.manifest()`

Returns the parsed `manifest.json` as a plain JavaScript object.

```
uix.manifest() → Promise<object>
```

### 4.4 `uix.data` — Read-Only Data Bridge

Provides access to `data.db`. All methods are read-only. Write operations MUST be
silently rejected or throw an error.

#### `uix.data.find(query)`

Returns all records matching `query` as an array. MUST return an empty array (not null
or undefined) when no records match.

```
uix.data.find({
  type: string,                              // REQUIRED — filters WHERE type = ?
  where?: Record<string, unknown>,           // OPTIONAL — additional json_extract filters
  orderBy?: string | { field: string, direction: "asc" | "desc" },
  limit?: number,
}) → Promise<Record[]>
```

The `where` object filters on `json_extract(body, '$.key') = value` for each key/value pair.
`orderBy` as a string is shorthand for `{ field: string, direction: "asc" }`.

#### `uix.data.get(id)`

Returns the single record with the given `id`, or `null` if not found.

```
uix.data.get(id: string) → Promise<Record | null>
```

#### `uix.data.raw(sql, params?)`

Executes arbitrary read-only SQL against `data.db`. REQUIRES `"raw-sql"` in
`manifest.permissions`. MUST throw or reject if the permission is absent.
MUST NOT permit write statements (INSERT, UPDATE, DELETE, DROP, etc.).

```
uix.data.raw(sql: string, params?: unknown[]) → Promise<Record[]>
```

### 4.5 `uix.state` — Read-Write State Bridge

Provides full read-write access to `state.db`.

#### `uix.state.find(query)`

Same signature and semantics as `uix.data.find`.

#### `uix.state.get(id)`

Same signature and semantics as `uix.data.get`.

#### `uix.state.insert(record)`

Inserts a new record and returns the full saved record (including generated `id`,
`created_at`, and `updated_at`). The `id` is auto-generated as `"<type>:<uuid>"` if
not provided.

```
uix.state.insert({
  type: string,
  id?: string,
  body: Record<string, unknown>,  // plain object — viewer JSON-stringifies it
}) → Promise<Record>
```

#### `uix.state.update(id, body)`

Replaces the `body` of the record with the given `id`. Updates `updated_at`.
The `body` argument is a plain object — the viewer JSON-stringifies it.

```
uix.state.update(id: string, body: Record<string, unknown>) → Promise<void>
```

#### `uix.state.delete(id)`

Deletes the record with the given `id`.

```
uix.state.delete(id: string) → Promise<void>
```

#### `uix.state.purge(options)`

Deletes all records of a given `type` older than the specified duration.
Duration string format: `"<n><unit>"` where unit is `s` (seconds), `m` (minutes),
`h` (hours), `d` (days), `y` (years).

```
uix.state.purge({
  type: string,
  olderThan: string,  // e.g. "24h", "7d", "1y"
}) → Promise<void>
```

#### `uix.state.raw(sql, params?)`

Executes arbitrary SQL against `state.db`. REQUIRES `"raw-sql"` permission.

```
uix.state.raw(sql: string, params?: unknown[]) → Promise<unknown[]>
```

### 4.6 Record Shape

All methods that return records return objects of this shape:

```typescript
interface UIXRecord {
  id: string; // e.g. "product:001", "cart_item:a1b2c3d4"
  type: string; // e.g. "product", "cart_item"
  body: string; // JSON string — call JSON.parse(record.body) to read fields
  created_at: number; // Unix timestamp (seconds)
  updated_at: number; // Unix timestamp (seconds)
}
```

The `body` field is always a JSON string when returned from the bridge. Applications
MUST call `JSON.parse(record.body)` before accessing fields within it.

### 4.7 `uix.print()`

Triggers the system print dialog. REQUIRES `"print"` in `manifest.permissions`.

```
uix.print() → void
```

### 4.8 `uix.exit()`

Closes the current application and returns the viewer to its home screen.

```
uix.exit() → Promise<void>
```

### 4.9 Methods That Do NOT Exist

The following method names MUST NOT be exposed by a compliant viewer. Applications
that call them will receive `undefined` or a rejection — never a result:

- `uix.data.getAll()` — use `uix.data.find({ type: "..." })`
- `uix.data.findAll()` — use `uix.data.find({ type: "..." })`
- `uix.data.fetchAll()` — use `uix.data.find({ type: "..." })`
- `uix.data.query()`, `uix.data.list()`, `uix.data.all()` — use `find()`
- `uix.storage.*` — use `uix.state.*`
- `uix.fetch()` — network is blocked by default; network access requires `"network": "allowed"` in manifest
- `uix.notify()` — applications implement their own notification UI
- `uix.fs.*` — no host filesystem access is provided
- `window.__uix.db` — use `uix.data.find()` or `uix.state.*`

---

## 5. Network Policy

If `manifest.network` is `"blocked"` (the default), the viewer MUST enforce a
Content Security Policy that blocks all external network requests made by the
application. The viewer MAY allow internal references (e.g. `localhost` for
development mode) but MUST block all external hostnames.

If `manifest.network` is `"allowed"`, the application MAY make external requests
subject to normal browser security policies. The viewer SHOULD display a visual
indicator that the application has network access.

---

## 6. Security Extensions (Optional)

The `security` block in `manifest.json` is entirely optional. Regular applications
MUST omit it. The security block enables PIN authentication and file-level encryption.

### 6.1 Security Object

```json
{
  "security": {
    "auth": "pin",
    "encryptedPaths": ["data.db", "files/annex.pdf"],
    "kdf": "PBKDF2-SHA256",
    "kdfIterations": 200000,
    "keySalt": "<base64url-random-salt>",
    "maxOpens": 3,
    "screenshot": false
  }
}
```

| Field            | Default           | Description                                                                                                                                                                             |
| ---------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`           | `"none"`          | `"pin"` — viewer MUST prompt for a PIN before opening. `"none"` — no authentication.                                                                                                    |
| `encryptedPaths` | `[]`              | Paths within the archive encrypted with AES-256-GCM. The viewer MUST decrypt these files in memory after successful authentication. Applications access them via normal relative paths. |
| `kdf`            | `"PBKDF2-SHA256"` | Key derivation function. MUST be `"PBKDF2-SHA256"` in version 1.0.                                                                                                                      |
| `kdfIterations`  | 200000            | PBKDF2 iteration count. Higher values increase resistance to brute-force attacks. MUST NOT be less than 100000.                                                                         |
| `keySalt`        | —                 | Base64url-encoded random salt. Used as the PBKDF2 salt. This value is not secret — storing it in the manifest is correct.                                                               |
| `maxOpens`       | unlimited         | Maximum number of times this file may be opened. The viewer MUST track opens locally per file ID. If `maxOpens` is reached, the viewer MUST refuse to open the file.                    |
| `screenshot`     | false             | If `true`, the viewer MUST prevent OS-level screenshots and screen recording while the file is open. Applicable to desktop viewers only.                                                |

### 6.2 Encryption

Encrypted files (listed in `encryptedPaths`) MUST be encrypted with AES-256-GCM.
The encryption key is derived as:

```
key = PBKDF2-SHA256(password=PIN, salt=base64url_decode(keySalt), iterations=kdfIterations, keylen=32)
```

Encrypted files MUST NOT be readable without a correct PIN. A viewer MUST check
the expiry field (`manifest.expires`) before attempting decryption.

---

## 7. Signature (Optional)

The `signature` block enables tamper detection via Ed25519 public-key signatures.

```json
{
  "signature": {
    "algorithm": "Ed25519",
    "publicKey": "<base64url-public-key>",
    "value": "<base64url-signature>",
    "signedAt": "2026-05-19T10:00:00Z"
  }
}
```

The signature covers a canonical JSON digest of all files in the archive (excluding
`manifest.json` itself). The exact digest algorithm is:

1. For each file in the archive (sorted by path, case-sensitive), compute SHA-256 of its contents.
2. Construct a JSON object: `{ "<path>": "<hex-sha256>", ... }`
3. Sign the UTF-8 encoding of this JSON with the Ed25519 private key.

A compliant viewer with signature verification MUST:

1. If `manifest.signature` is present, verify the signature before exposing any content.
2. If verification fails, refuse to open the file and display a clear tamper warning.
3. If `manifest.signature` is absent, open the file without verification (signatures are opt-in).

---

## 8. AI Provenance (Optional)

The `ai` block is an informational provenance record for AI-generated files.
It has no effect on viewer behaviour.

```json
{
  "ai": {
    "generatedBy": "claude-opus-4",
    "generatedAt": "2026-05-19T12:00:00Z",
    "capabilities": ["search", "chat"],
    "promptHash": "<sha256-hex>"
  }
}
```

| Field          | Type     | Description                                                        |
| -------------- | -------- | ------------------------------------------------------------------ |
| `generatedBy`  | string   | Model or tool identifier, e.g. `"claude-opus-4"`, `"@dotuix/mcp"`. |
| `generatedAt`  | string   | ISO 8601 timestamp of generation.                                  |
| `capabilities` | string[] | Semantic capabilities of the application.                          |
| `promptHash`   | string   | SHA-256 hex digest of the generation prompt (for reproducibility). |

---

## 9. Validation

A compliant validator MUST report an error for:

- Missing or invalid `manifest.json`
- Missing any required manifest field (`uix`, `id`, `name`, `version`, `entry`, `mode`)
- `manifest.entry` pointing to a file not present in the archive
- `manifest.uix` not equal to `"1.0"`
- `manifest.mode` not equal to `"kiosk"` or `"window"`
- `manifest.network` present and not equal to `"blocked"` or `"allowed"`
- Archive is not a valid ZIP file

A compliant validator SHOULD report a warning for:

- Media files (image, video, audio, font) found outside `assets/`
- `manifest.minViewer` not following SemVer
- `manifest.security.kdfIterations` below 100000
- Files listed in `manifest.security.encryptedPaths` not found in archive

---

## 10. Versioning

The format version is declared in `manifest.uix`. This specification defines version `"1.0"`.

Future versions of this specification WILL increment the version string. Viewers encountering
an unknown version SHOULD display a message advising the user to update their viewer, and
SHOULD NOT attempt to open the file.

Backwards-compatible additions (new optional manifest fields, new optional bridge methods)
MAY be made without incrementing the version. Breaking changes (removing required fields,
changing existing behaviour) MUST increment the version.

---

## Appendix A — Example manifest.json

### Minimal (no security)

```json
{
  "uix": "1.0",
  "id": "com.example.myapp",
  "name": "My App",
  "version": "1.0.0",
  "entry": "index.html",
  "mode": "kiosk",
  "network": "blocked"
}
```

### Full (with security and signature)

```json
{
  "uix": "1.0",
  "id": "gov.qa.briefing.q2-2026",
  "name": "Ministry Briefing Q2 2026",
  "version": "1.0.0",
  "minViewer": "1.0.0",
  "entry": "index.html",
  "mode": "kiosk",
  "permissions": [],
  "network": "blocked",
  "expires": "2026-06-30T23:59:59Z",
  "state": { "seed": false },
  "security": {
    "auth": "pin",
    "encryptedPaths": ["data.db", "files/annex-a.pdf"],
    "kdf": "PBKDF2-SHA256",
    "kdfIterations": 200000,
    "keySalt": "base64url-random-salt-here",
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

---

## Appendix B — SQLite Schema (complete)

```sql
-- records table — identical in data.db and state.db
CREATE TABLE records (
  id         TEXT    PRIMARY KEY,
  type       TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_type       ON records (type);
CREATE INDEX idx_created_at ON records (created_at);

-- meta table — state.db only, created by viewer on first open
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

---

## License

Copyright © 2026 dotuix contributors.

This specification is licensed under the
[Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).

You are free to:

- **Share** — copy and redistribute this document in any medium or format
- **Adapt** — build upon this document for any purpose, including commercial use

Under the following terms:

- **Attribution** — You must give appropriate credit to the dotuix project, provide a link
  to this license, and indicate if changes were made.

The authors of this specification provide it "as-is" without warranty of any kind.
