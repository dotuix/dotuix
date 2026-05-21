# dotuix Desktop API — Implementation Plan

**Status:** Implemented
**Scope:** Tauri desktop viewer (`apps/viewer/src-tauri/src/lib.rs` + `bridge_script`)
**Date:** 2026-05-21

This document is the single source of truth before coding begins. It covers:

- A complete audit of what exists vs. what is missing
- Every new requirement with exact signatures and implementation notes
- A full strategy for `state.db` growth and lifecycle management
- Spec amendments required
- Phased implementation order

---

## 1. Audit — What Exists Today

### 1.1 DB API

| Method                                                       | Rust command   | In bridge | Status   |
| ------------------------------------------------------------ | -------------- | --------- | -------- |
| `uix.data.find({ type, where, orderBy, limit })`             | `data_find`    | ✅        | Complete |
| `uix.data.get(id)`                                           | `data_get`     | ✅        | Complete |
| `uix.data.raw(sql, params)` — SELECT only, needs `"raw-sql"` | `data_raw`     | ✅        | Complete |
| `uix.state.find({ type, where, orderBy, limit })`            | `state_find`   | ✅        | Complete |
| `uix.state.get(id)`                                          | `state_get`    | ✅        | Complete |
| `uix.state.insert({ type, body })`                           | `state_insert` | ✅        | Complete |
| `uix.state.update(id, body)`                                 | `state_update` | ✅        | Complete |
| `uix.state.delete(id)`                                       | `state_delete` | ✅        | Complete |
| `uix.state.purge({ type, olderThan })`                       | `state_purge`  | ✅        | Complete |
| `uix.state.raw(sql, params)` — read+write, needs `"raw-sql"` | `state_raw`    | ✅        | Complete |

**Known limitations in existing API:**

- `where` only supports equality (`=`). No `>`, `<`, `LIKE`, `IN`, `!=`.
- `orderBy` only supports a single field. No multi-field ordering.
- No `offset` parameter — true pagination is impossible.
- No `count()` — totals require loading all records into JS.
- No `upsert()` — settings/singleton records need an awkward get→insert-or-update dance.
- No `insertMany()` — bulk writes require N sequential awaits.
- No `transaction()` — multi-step writes (e.g. decrement stock AND insert order) are not atomic.

### 1.2 OS API

| Capability                                          | Permission in `types.ts`        | Rust command                  | In bridge  | Status            |
| --------------------------------------------------- | ------------------------------- | ----------------------------- | ---------- | ----------------- |
| `uix.print()` — system print dialog                 | `"print"`                       | none (uses `window.print()`)  | ✅         | Complete          |
| `uix.exit()` — close app                            | —                               | `uix_exit`                    | ✅         | Complete          |
| `uix.clipboard.write(text)`                         | `"clipboard-write"` ✅ declared | not needed (Web API)          | ❌ missing | **Gap**           |
| `uix.fullscreen.enter/exit/toggle`                  | `"fullscreen"` ✅ declared      | `toggle_fullscreen` ✅ exists | ❌ missing | **Gap**           |
| `uix.file.save(filename, content)` — export to disk | not declared                    | none                          | ❌ absent  | **Gap**           |
| `uix.file.open(filter)` — import from disk          | not declared                    | none                          | ❌ absent  | **Gap**           |
| `uix.browser.open(url)` — open in system browser    | not declared                    | none                          | ❌ absent  | **Gap**           |
| `uix.notify(title, body)` — OS notification         | not declared                    | none                          | ❌ absent  | Needs spec change |
| `uix.viewer.version()` — current viewer version     | not declared                    | none                          | ❌ absent  | **Gap**           |
| `uix.window.setTitle(title)` — dynamic title        | not declared                    | none                          | ❌ absent  | **Gap**           |

### 1.3 State.db Lifecycle

| Capability                                                          | Status      |
| ------------------------------------------------------------------- | ----------- |
| Automatic repack of `state.db` into `.uix` on close                 | ✅ Complete |
| `state.purge({ type, olderThan })` — delete old records by age      | ✅ Complete |
| `state.clear({ type? })` — delete records of one type, or all types | ❌ Missing  |
| `state.reset()` — restore to original state (empty or seed)         | ❌ Missing  |
| `state.size()` — current database size in bytes                     | ❌ Missing  |
| `state.vacuum()` — reclaim disk space after deletions               | ❌ Missing  |
| `state.export({ type?, before? })` — snapshot records to JSON       | ❌ Missing  |
| Auto-vacuum mode configured on open                                 | ❌ Not set  |
| Viewer warning when `state.db` exceeds threshold                    | ❌ Missing  |

---

## 2. Part A — DB API Requirements

### DB-1 `offset` in `find()`

**Signature (no change to existing params, adds one):**

```js
uix.state.find({ type, where?, orderBy?, limit?, offset? })
uix.data.find({ type, where?, orderBy?, limit?, offset? })
```

**Behaviour:** Appends `OFFSET ?` to the SQL after `LIMIT`. Requires `limit` to be set when `offset` is provided; if `limit` is absent with `offset`, default to no limit (return all starting from offset).

**Rust change:** Add `offset: Option<u32>` to `FindQuery`. Append `OFFSET {n}` fragment when present.

**Bridge change:** Pass `offset` through in relay call. No bridge code change needed — payload is forwarded as-is.

**Required for:** Any paginated list. Products catalogue with 1 000+ items. Order history pages.

---

### DB-2 `count()` method

**Signature:**

```js
uix.state.count({ type, where? })  → Promise<number>
uix.data.count({ type, where? })   → Promise<number>
```

**Behaviour:** Runs `SELECT COUNT(*) FROM records WHERE type = ? [AND json_extract filters]`. Returns a plain integer, not a record array.

**Rust change:** New commands `state_count` and `data_count`. Re-uses the same `where`-filter logic as `query_records` but runs `COUNT(*)` instead of selecting rows.

**Bridge change:** Add `count(opts)` to both `uix.state` and `uix.data` objects in `bridge_script`.

**Required for:** Pagination UI ("Page 2 of 14"). Dashboard totals. Notification badges. Checking if a type has any records before rendering a section.

---

### DB-3 `upsert()` method

**Signature:**

```js
uix.state.upsert({ id: string, type: string, body: object }) → Promise<Record>
```

**Behaviour:** `INSERT OR REPLACE INTO records`. If a record with the given `id` exists, it is replaced entirely (preserving original `created_at`). If it does not exist, it is inserted. Returns the final saved record.

Implementation note: Use `INSERT INTO records ... ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at` to preserve `created_at`.

**Rust change:** New command `state_upsert`.

**Bridge change:** Add `upsert(opts)` to `uix.state` in `bridge_script`.

**Required for:** App settings (one record, updated repeatedly). User preferences. "Current cart" singleton (`cart:current`). Any record that should exist exactly once.

---

### DB-4 `insertMany()` method

**Signature:**

```js
uix.state.insertMany(records: Array<{ type: string, id?: string, body: object }>) → Promise<Record[]>
```

**Behaviour:** Wraps all inserts in a single `BEGIN IMMEDIATE / COMMIT` transaction. Returns the array of saved records in the same order. If any insert fails, the entire batch is rolled back and an error is returned.

**Rust change:** New command `state_insert_many`. Uses `conn.execute_batch("BEGIN IMMEDIATE")` before the loop and `COMMIT` after.

**Bridge change:** Add `insertMany(records)` to `uix.state` in `bridge_script`.

**Required for:** Importing a CSV of products into state. Seeding data programmatically at first launch. Creating an order with multiple line items in one call.

---

### DB-5 `transaction()` method — CRITICAL

**Signature:**

```js
uix.state.transaction(ops: TransactionOp[]) → Promise<Record[]>

type TransactionOp =
  | { op: 'insert',  type: string, id?: string, body: object }
  | { op: 'update',  id: string, body: object }
  | { op: 'upsert',  id: string, type: string, body: object }
  | { op: 'delete',  id: string }
```

**Behaviour:** Executes all operations atomically inside `BEGIN IMMEDIATE / COMMIT`. On any error, `ROLLBACK` is called and the error is returned with no changes written. Returns an array of affected records (inserts and upserts return the new record; updates return the updated record; deletes return `null` for that position).

**Rust change:** New command `state_transaction`. Accepts a `Vec<serde_json::Value>`, iterates ops inside a transaction.

**Bridge change:** Add `transaction(ops)` to `uix.state` in `bridge_script`.

**Required for:** Shop checkout (decrement stock + insert order must not be split by a crash). Any write sequence that must succeed or fail together. This is the most critical missing item.

---

### DB-6 Extended `where` operators

**Current:** `where: { price: 100 }` → `json_extract(body, '$.price') = 100`

**New:** Each value in `where` can be either a raw scalar (equality, unchanged) or an operator object:

```js
where: {
  price:      { gt: 50, lte: 200 },   // range
  status:     { in: ['paid', 'open'] }, // set membership
  name:       { like: '%coffee%' },    // substring
  deleted_at: { is_null: true },       // null check
  ref:        { neq: 'VOID' },         // not equal
}
```

**Supported operators:**

| Operator                     | SQL fragment   |
| ---------------------------- | -------------- |
| `eq` (default, or raw value) | `= ?`          |
| `neq`                        | `!= ?`         |
| `gt`                         | `> ?`          |
| `gte`                        | `>= ?`         |
| `lt`                         | `< ?`          |
| `lte`                        | `<= ?`         |
| `like`                       | `LIKE ?`       |
| `in`                         | `IN (?, ?, …)` |
| `is_null: true`              | `IS NULL`      |
| `is_null: false`             | `IS NOT NULL`  |

**Rust change:** Update `query_records` where-clause builder to detect object vs. scalar values. For each operator, generate the correct SQL fragment. `in` generates a parameterised `(?, ?, ?)` list. `is_null` generates no parameter.

**Security note:** All field names still go through `validate_identifier`. Operator keys are matched against the fixed set above; unknown operators return a clear error.

**Required for:** "Orders today" (`created_at: { gte: midnight }`). Price range filters. Search by partial name. "All unpaid orders" (`status: { neq: 'paid' }`).

---

### DB-7 Multi-field `orderBy`

**Current:** `orderBy: 'price'` or `orderBy: { field: 'price', direction: 'desc' }`

**New:** Accept array form in addition:

```js
orderBy: [
  { field: "category", direction: "asc" },
  { field: "price", direction: "asc" },
];
```

**Behaviour:** Generates `ORDER BY json_extract(body,'$.category') ASC, json_extract(body,'$.price') ASC`.

**Rust change:** In the `order_by` handling in `query_records`, detect `serde_json::Value::Array` and iterate entries to build a comma-separated ORDER BY clause.

**Required for:** Product catalogue sorted by category then price. Reports sorted by date then amount.

---

## 3. Part B — OS API Requirements

### OS-1 Expose `uix.clipboard.write(text)` (permission already declared)

**Signature:**

```js
uix.clipboard.write(text: string) → Promise<void>
```

**Behaviour:** Calls `navigator.clipboard.writeText(text)`. If `"clipboard-write"` is not in `manifest.permissions`, the bridge returns a rejected promise with a clear permission-denied message — it does not silently fail.

**Implementation:** Pure bridge change. `navigator.clipboard.writeText` works in Tauri WebView. No Rust command needed. The bridge checks the injected permissions array before calling the Web API.

**Bridge change:** Add to `bridge_script`:

```js
clipboard: {
  write: function(text) {
    if (!_perms.includes('clipboard-write'))
      return Promise.reject(new Error("Permission denied: clipboard-write not declared"));
    return navigator.clipboard.writeText(text);
  }
}
```

The injected `_perms` array is already available from the manifest injection.

**Required for:** Copy order reference number. Copy payment amount. Copy a generated code or link.

---

### OS-2 Expose `uix.fullscreen` (permission declared, Tauri command exists)

**Signature:**

```js
uix.fullscreen.enter()  → Promise<void>
uix.fullscreen.exit()   → Promise<void>
uix.fullscreen.toggle() → Promise<void>
```

**Behaviour:** Calls Tauri commands. Requires `"fullscreen"` in `manifest.permissions`.

**Rust change:**

- Rename/extend `toggle_fullscreen` to add `uix_enter_fullscreen` and `uix_exit_fullscreen` commands using `window.set_fullscreen(true)` and `window.set_fullscreen(false)`.
- Add permission check at the start of all three commands (check `state.permissions`).

**Bridge change:** Add `fullscreen: { enter, exit, toggle }` to `window.__uix`. Each method relays to the corresponding Tauri command.

**Required for:** Kiosk shop mode (force fullscreen on launch). Presentation documents. Exit fullscreen button in app UI.

---

### OS-3 File save — export to disk

**Signature:**

```js
uix.file.save(filename: string, content: string | ArrayBuffer, mimeType?: string) → Promise<boolean>
// Returns true if user confirmed save, false if they cancelled.
```

**Behaviour:** Shows OS save dialog pre-filled with `filename`. Writes `content` to the chosen path. `content` as a string is written as UTF-8. `content` as `ArrayBuffer` is written as raw bytes. Returns `false` if the user cancelled without error.

**Rust change:** New command `uix_save_file(filename: String, content_b64: String, mime: String)`.

- Receives content as base64 to survive the JSON bridge serialisation.
- Uses `tauri-plugin-dialog` blocking save dialog.
- Writes with `std::fs::write`.
- Checks `"file-save"` permission.

**New dependency:** No new Tauri plugin needed; `tauri-plugin-dialog` is already in `Cargo.toml`.

**New permission:** `"file-save"` — add to `types.ts` `Permission` union and to `spec/spec.md` permissions table.

**Bridge change:** Add `file: { save(filename, content, mime) }` to `window.__uix`. Converts `ArrayBuffer` to base64 in the bridge before relaying.

**Required for:** Export daily orders as CSV. Save receipt as PDF. Download a generated report.

---

### OS-4 File open — import from disk

**Signature:**

```js
uix.file.open(opts?: { filter?: string, multiple?: boolean }) → Promise<FileResult | null>

type FileResult = { name: string, content: ArrayBuffer }
// null = user cancelled
```

**Behaviour:** Shows OS open dialog with optional file type filter (e.g., `"csv"`, `"json"`). Reads file contents and returns as `ArrayBuffer` (base64 over the bridge, decoded back in bridge JS). Returns `null` if user cancelled.

**Rust change:** New command `uix_open_file(filter: Option<String>, multiple: bool)`.

- Uses `tauri-plugin-dialog` `pick_file` / `pick_files`.
- Reads file bytes, returns as `{ name, content_b64 }`.
- Checks `"file-open"` permission.

**New permission:** `"file-open"` — add to `types.ts` and spec.

**Bridge change:** Add `file.open(opts)` to `window.__uix`. Decodes base64 result back to `ArrayBuffer`.

**Required for:** Import a CSV of products into an app. Upload a photo or document into state. Load a data file that the user has locally.

---

### OS-5 Open URL in system browser

**Signature:**

```js
uix.browser.open(url: string) → Promise<void>
```

**Behaviour:** Opens the URL in the OS default browser. Only `https://` and `http://` schemes are allowed; any other scheme is rejected with an error. The URL is validated in Rust before being passed to the shell.

**Rust change:** New command `uix_open_url(url: String)`.

- Validates scheme: reject if not `https://` or `http://`.
- Uses `std::process::Command::new("open")` on macOS, `"xdg-open"` on Linux, `"start"` on Windows.
- Checks `"open-url"` permission.
- **Security note:** Never pass user-provided URL strings to the shell without scheme validation. Only the validated URL string is passed; no shell interpolation.

**New dependency:** No Tauri plugin needed; shell spawn is sufficient.

**New permission:** `"open-url"` — add to `types.ts` and spec.

**Bridge change:** Add `browser: { open(url) }` to `window.__uix`.

**Required for:** "Pay online" QR code alternative. Link to external help documentation. Referral or support URL.

---

### OS-6 OS desktop notification

**Signature:**

```js
uix.notify(title: string, body: string, opts?: { sound?: boolean }) → Promise<void>
```

**Behaviour:** Fires a native OS notification using `tauri-plugin-notification`. Not intrusive — does not block the app window. `sound` defaults to `false`.

**Spec amendment required:** The current spec (§4.9) explicitly lists `uix.notify()` as a method that does NOT exist. This requirement needs a spec update before implementation.

**Rust change:** Add `tauri-plugin-notification = "2"` to `Cargo.toml`. New command `uix_notify(title, body, sound)`. Checks `"notifications"` permission.

**New permission:** `"notifications"` — add to `types.ts` and spec after amendment.

**Bridge change:** Add `notify(title, body, opts)` to `window.__uix`.

**Spec amendment note:** Remove `uix.notify()` from §4.9 "Methods That Do NOT Exist". Add `uix.notify()` to §4.x and permissions table.

**Required for:** Shop new order alert for the owner. Kiosk idle timeout warning. Background task completion.

---

### OS-7 Viewer version query

**Signature:**

```js
uix.viewer.version() → string  // synchronous, no Promise
```

**Behaviour:** Returns the viewer version string (e.g., `"1.0.0"`). Synchronous because it is injected at page load alongside the manifest.

**Implementation:** Inject `var _viewer_version = "1.0.0";` into `bridge_script` alongside the manifest JSON. The `VIEWER_VERSION` constant is already in `lib.rs`. No Tauri command or relay needed.

**Bridge change:** Add `viewer: { version() { return _viewer_version; } }` to `window.__uix`.

**Required for:** Apps that conditionally use newer bridge APIs and need to check compatibility at runtime. Useful for `.uix` files distributed to diverse viewer versions.

---

### OS-8 Dynamic window title

**Signature:**

```js
uix.window.setTitle(title: string) → Promise<void>
```

**Behaviour:** Sets the OS window title bar. `title` is prepended with the app name: `"{appName} — {title}"`. This prevents apps from setting misleading titles like "Bank of X" that could confuse the user.

**Rust change:** New command `uix_set_window_title(title: String, window: tauri::WebviewWindow)`.

- Reads the manifest `name` field from `AppState`.
- Calls `window.set_title(&format!("{name} — {title}"))`.
- No permission required (harmless capability).

**Bridge change:** Add `window: { setTitle(title) }` to `window.__uix`.

**Required for:** Shop showing current mode ("Open for Orders" vs "Closed"). Catalogue showing selected category name in title. Multi-step form showing current step.

---

## 4. Part C — State.db Lifecycle Management

This section addresses the question: what happens when `state.db` grows large or needs to be reset?

### Background: How `state.db` grows

- Every `state.insert()` call adds a row.
- On close, the viewer repacks `state.db` back into the `.uix` file.
- If an app stores orders indefinitely, `state.db` can grow to tens or hundreds of megabytes over months of use.
- SQLite does not shrink the file after `DELETE` — freed pages are held in a free-list until `VACUUM` is run.
- A 200MB `state.db` makes the repack on close slow and the `.uix` file itself large.

### SM-1 `uix.state.clear()` — selective deletion

**Signature:**

```js
uix.state.clear({ type?: string }) → Promise<number>
// Returns: number of records deleted
```

**Behaviour:**

- With `type`: deletes all records of that type. Equivalent to `DELETE FROM records WHERE type = ?`.
- Without `type` (omitted entirely): deletes ALL records in `state.db`. Equivalent to `DELETE FROM records`.
- After deletion, the viewer runs `PRAGMA incremental_vacuum` to partially reclaim space without a full vacuum.
- Does NOT reset the `meta` table (open count, first-open timestamp are preserved).
- **This is NOT the same as `state.reset()`.** `clear()` destroys records permanently. `reset()` restores the original state from the seed (see SM-1b).

**Rust change:** New command `state_clear(record_type: Option<String>)`.

**Bridge change:** Add `clear(opts?)` to `uix.state`.

**Use cases:**

- "Clear cart" — `clear({ type: 'cart_item' })`.
- End-of-day purge of a single record type on a kiosk.
- Programmatic cleanup of a specific type after export.

---

### SM-1b `uix.state.reset()` — restore to original state

**Signature:**

```js
uix.state.reset() → Promise<void>
```

**What "original state" means — this is not always empty:**

The `.uix` format supports a `state.seed` flag in `manifest.json`:

| `manifest.state.seed`                     | Original state                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `false` (default, most apps)              | Empty — no records. `reset()` is equivalent to `clear()`.                                                                               |
| `true` (app shipped with pre-loaded data) | The `state.db` bundled inside the `.uix` archive at creation time. Could contain template orders, demo products, default settings, etc. |

For a typical shop app built with `state.seed = false`, yes — original state is an empty database. For an app that ships with pre-loaded template records or demo data, original state is those records, and `reset()` restores them.

**Behaviour:**

1. Close the current `state.db` connection.
2. If `state.seed = true` and a seed backup file exists at `data_dir/state_seed.db`:
   - Copy `state_seed.db` over `state.db` (atomic rename via temp file).
3. If `state.seed = false` (or no seed backup found):
   - Delete all records from `state.db` (same effect as `state.clear()`).
4. Re-open the `state.db` connection and re-run `ensure_state_schema()`.
5. The `meta` table is preserved (open count remains accurate).

**How the seed backup is preserved:**

The current viewer writes the seed once (`if !state_db_path.exists() && should_seed`) but then repacks the user's current state back into the archive on every close — overwriting the original seed in the archive. After the first close, the archive's `state.db` is the user's state, not the original seed.

To support `reset()`, the viewer must save the original seed to a separate file during the first-open seed copy:

```rust
// In complete_load(), alongside the existing seed copy:
if !state_db_path.exists() && should_seed {
    if let Some(seed) = files.get("state.db") {
        std::fs::write(&state_db_path, seed)?;
        // Also save as seed backup — never overwritten after this point
        let seed_backup = data_dir.join("state_seed.db");
        if !seed_backup.exists() {
            std::fs::write(&seed_backup, seed)?;
        }
    }
}
```

**Rust change:** New command `state_reset`. Needs access to `state_db_path` and the `data_dir` (derivable from `app_id`). Closes connection, performs the copy or clear, reopens.

**Bridge change:** Add `reset()` to `uix.state`.

**Use cases:**

- "Reset App" button — returns the app to exactly how it was when first installed.
- Factory reset for a kiosk at end of event.
- Restoring demo/template data after a test session.
- Developer testing: reset between test runs without reinstalling.

---

### SM-2 `uix.state.size()` — monitor database size

**Signature:**

```js
uix.state.size() → Promise<{ bytes: number, records: number, types: Record<string, number> }>
```

**Behaviour:** Returns the current file size of `state.db` on disk, total record count, and a per-type breakdown. The per-type map allows the app to identify which type is consuming the most space.

**Rust change:** New command `state_size`. Uses `std::fs::metadata(state_db_path).len()` for bytes. Runs `SELECT type, COUNT(*) FROM records GROUP BY type` for the breakdown.

**Bridge change:** Add `size()` to `uix.state`.

**Use cases:**

- App shows a "Manage Storage" screen.
- Proactive warning: "Your order history is taking 45MB. Consider archiving."
- Developer debugging during `.uix` authoring.

---

### SM-3 `uix.state.vacuum()` — reclaim space

**Signature:**

```js
uix.state.vacuum() → Promise<{ before: number, after: number }>
// Returns byte sizes before and after
```

**Behaviour:** Runs SQLite `VACUUM` on `state.db`. This rewrites the entire database file, reclaiming all free pages. Returns the file size before and after so the app can report savings to the user.

This is intentionally an explicit call rather than automatic because `VACUUM` can take seconds on large databases and should only be run when the user expects a pause (e.g., after they confirm "Archive and clean up").

**Rust change:** New command `state_vacuum`. Reads size before, runs `conn.execute_batch("VACUUM")`, reads size after.

**Bridge change:** Add `vacuum()` to `uix.state`.

**Use cases:**

- Run after a large purge or clear operation to actually shrink the file.
- Scheduled maintenance: "This app cleaned up 38MB of old data."

---

### SM-4 `uix.state.export()` — snapshot before purge

**Signature:**

```js
uix.state.export({ type?: string, before?: number }) → Promise<string>
// Returns: JSON string of records matching the filter
// `before` is a Unix timestamp (ms) — export records created before this time
```

**Behaviour:** Queries records (optionally filtered by type and/or `created_at < before`) and returns them as a JSON string. The app can then pass this string to `uix.file.save()` to write a backup to disk before purging.

This is a pure read operation. No Rust command needed — it is implemented in the bridge using `uix.state.raw()`. However, it requires `"raw-sql"` permission to use the timestamp filter efficiently.

**Alternative without `raw-sql`:** The bridge implementation calls `uix.state.find({ type })` and filters `created_at < before` in JS. This works but loads all records into memory first.

**Bridge change:** Add `export(opts?)` to `uix.state`. Implemented in JS:

```js
export: async function(opts) {
  opts = opts || {};
  var records = await uix.state.find({ type: opts.type || '__all__' }); // special case
  if (opts.before) records = records.filter(r => r.created_at < opts.before);
  return JSON.stringify(records);
}
```

The `type` being optional requires a bridge-side workaround since `find` requires a type. The bridge calls `state.raw` when no type is given (if `raw-sql` is present) or iterates known types.

**Required for:** Archiving old orders before purging. Backup before "Reset App". Exporting data for handoff to a new device.

---

### SM-5 Auto-vacuum configuration on DB open

**Behaviour:** When the viewer opens `state.db`, it should set:

```sql
PRAGMA journal_mode = WAL;
PRAGMA auto_vacuum = INCREMENTAL;
```

`WAL` mode improves concurrent read performance and prevents full DB locks.
`INCREMENTAL` auto-vacuum means SQLite tracks free pages incrementally — they can be reclaimed by `PRAGMA incremental_vacuum(N)` without a full `VACUUM`. This keeps routine cleanup fast.

**Rust change:** Add these two PRAGMA calls at the end of `ensure_state_schema()`, after the index creation.

This is a viewer-internal change with no bridge API surface. It is transparent to the app but important for long-term health.

---

### SM-6 Viewer warning on large state.db at close

**Behaviour:** In the `on_window_event(Destroyed)` handler, after repacking, if `state.db` exceeds **50MB**, the viewer emits a `"state-db-large"` event with the size. The shell (React frontend) shows a non-blocking toast:
`"App data is 52MB. Consider archiving old records."`

**Threshold:** 50MB is the default. This is a viewer-level policy, not exposed to the app.

**Implementation:** After `repack_uix`, stat the state_db file. If `> 50 * 1024 * 1024`, emit the event.

---

### SM-7 Manifest-declared state size limit (optional, v2)

Add optional `state.maxSizeMb: number` to the manifest schema. When set, the viewer checks `state.db` size on open and warns (or optionally refuses new inserts when exceeded).

**This is deferred to v2.** Mark as a spec reservation for forward compatibility.

---

## 5. Permissions Table — Updated

The following permissions must be added to `packages/core/src/types.ts` and `spec/spec.md`:

| Permission value    | Capability granted                                          | New?                              |
| ------------------- | ----------------------------------------------------------- | --------------------------------- |
| `"local-storage"`   | Browser `localStorage`                                      | existing                          |
| `"print"`           | System print dialog                                         | existing                          |
| `"clipboard-write"` | `uix.clipboard.write()`                                     | existing (but bridge was missing) |
| `"fullscreen"`      | `uix.fullscreen.*`                                          | existing (but bridge was missing) |
| `"raw-sql"`         | `uix.data.raw()` and `uix.state.raw()`                      | existing                          |
| `"file-save"`       | `uix.file.save()` — write to user's disk                    | **NEW**                           |
| `"file-open"`       | `uix.file.open()` — read from user's disk                   | **NEW**                           |
| `"open-url"`        | `uix.browser.open()` — launch in system browser             | **NEW**                           |
| `"notifications"`   | `uix.notify()` — OS desktop notification                    | **NEW** (needs spec amendment)    |
| `"local-sync"`      | `uix.state.sync()` — push/pull `state.db` via sync server   | **NEW** (sync-server built)       |
| `"state-export"`    | Future: `uix.state.export()` across types without `raw-sql` | **RESERVED**                      |

---

## 6. Spec Amendments Required Before Implementation

| Section                        | Change                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §2.4 Permissions table         | Add `"file-save"`, `"file-open"`, `"open-url"`, `"notifications"` rows                                                                                                                                       |
| §4.7 after `uix.print()`       | Add `uix.clipboard.write()`, `uix.fullscreen.*`, `uix.file.*`, `uix.browser.open()`, `uix.notify()`, `uix.viewer.version()`, `uix.window.setTitle()`                                                         |
| §4.8 after `uix.exit()`        | Add `uix.state.count()`, `uix.state.upsert()`, `uix.state.insertMany()`, `uix.state.transaction()`, `uix.state.clear()`, `uix.state.reset()`, `uix.state.size()`, `uix.state.vacuum()`, `uix.state.export()` |
| §3.3 Database Roles            | Document that on first open with `state.seed = true`, viewer saves a `state_seed.db` backup alongside `state.db` for use by `state.reset()`                                                                  |
| §4.9 Methods That Do NOT Exist | Remove `uix.notify()` from the blocked list                                                                                                                                                                  |
| §3 Databases                   | Add SM-5 (WAL + incremental auto-vacuum) as a SHOULD requirement on compliant viewers                                                                                                                        |
| §2.3 Optional Manifest Fields  | Reserve `state.maxSizeMb` for v2                                                                                                                                                                             |

---

## 7. Implementation Phases

### Phase 1 — Critical blockers (implement first)

These are required for any non-trivial app (shop, kiosk, form).

| ID    | Item                                        | Files changed                      | Effort |
| ----- | ------------------------------------------- | ---------------------------------- | ------ |
| DB-5  | `state.transaction(ops[])`                  | `lib.rs` (new command + bridge)    | M      |
| DB-1  | `offset` in `find()`                        | `lib.rs` (`FindQuery` + SQL)       | S      |
| DB-2  | `state.count()` + `data.count()`            | `lib.rs` (2 new commands + bridge) | S      |
| SM-5  | WAL + auto-vacuum on open                   | `lib.rs` (`ensure_state_schema`)   | S      |
| SM-1  | `state.clear({ type? })`                    | `lib.rs` (new command + bridge)    | S      |
| SM-1b | `state.reset()` + seed backup on first open | `lib.rs` (complete_load + new cmd) | S      |

### Phase 2 — Important (needed for real apps)

| ID   | Item                       | Files changed                   | Effort |
| ---- | -------------------------- | ------------------------------- | ------ |
| DB-6 | Extended `where` operators | `lib.rs` (`query_records`)      | M      |
| DB-3 | `state.upsert()`           | `lib.rs` (new command + bridge) | S      |
| DB-4 | `state.insertMany()`       | `lib.rs` (new command + bridge) | S      |
| OS-1 | `uix.clipboard.write()`    | `bridge_script` only            | XS     |
| OS-2 | `uix.fullscreen.*`         | `lib.rs` (2 cmds) + bridge      | S      |
| OS-7 | `uix.viewer.version()`     | `bridge_script` only            | XS     |
| SM-2 | `state.size()`             | `lib.rs` (new command + bridge) | S      |
| SM-3 | `state.vacuum()`           | `lib.rs` (new command + bridge) | S      |

### Phase 3 — High value, requires new plugins or spec changes

| ID   | Item                         | Files changed                   | Effort |
| ---- | ---------------------------- | ------------------------------- | ------ |
| DB-7 | Multi-field `orderBy`        | `lib.rs` (`query_records`)      | S      |
| OS-3 | `uix.file.save()`            | `lib.rs` (new command + bridge) | M      |
| OS-4 | `uix.file.open()`            | `lib.rs` (new command + bridge) | M      |
| OS-5 | `uix.browser.open()`         | `lib.rs` (new command + bridge) | S      |
| OS-8 | `uix.window.setTitle()`      | `lib.rs` (new command + bridge) | S      |
| SM-4 | `state.export()`             | `bridge_script` (JS only)       | S      |
| SM-6 | Large-state warning on close | `lib.rs` (`on_window_event`)    | S      |

### Phase 4 — Requires spec amendment or external plugin

| ID   | Item           | Dependency                                                 | Effort |
| ---- | -------------- | ---------------------------------------------------------- | ------ |
| OS-6 | `uix.notify()` | Spec amendment + `tauri-plugin-notification` in Cargo.toml | M      |

---

## 8. Complete Updated Bridge API Surface

After all phases are complete, `window.__uix` (aka `window.uix`) exposes:

```ts
uix.manifest()                         // → object (sync)
uix.viewer.version()                   // → string (sync)

uix.data.find({ type, where?, orderBy?, limit?, offset? })   → Promise<Record[]>
uix.data.get(id)                       → Promise<Record | null>
uix.data.count({ type, where? })       → Promise<number>
uix.data.raw(sql, params?)             → Promise<object[]>   // needs "raw-sql"

uix.state.find({ type, where?, orderBy?, limit?, offset? })  → Promise<Record[]>
uix.state.get(id)                      → Promise<Record | null>
uix.state.count({ type, where? })      → Promise<number>
uix.state.insert({ type, id?, body })  → Promise<Record>
uix.state.insertMany(records[])        → Promise<Record[]>
uix.state.update(id, body)             → Promise<Record>
uix.state.upsert({ id, type, body })   → Promise<Record>
uix.state.delete(id)                   → Promise<void>
uix.state.purge({ type, olderThan })   → Promise<number>     // existing
uix.state.transaction(ops[])          → Promise<(Record|null)[]>
uix.state.clear({ type? })            → Promise<number>      // selective delete
uix.state.reset()                      → Promise<void>         // restore to original (empty or seed)
uix.state.size()                       → Promise<{ bytes, records, types }>
uix.state.vacuum()                     → Promise<{ before, after }>
uix.state.export({ type?, before? })   → Promise<string>     // JSON
uix.state.sync()                       → Promise<{ pushed: number, pulled: number }>  // needs "local-sync"
uix.state.raw(sql, params?)            → Promise<object[]>   // needs "raw-sql"

uix.print()                            // → void
uix.exit()                             → Promise<void>
uix.notify(title, body, opts?)         → Promise<void>       // needs "notifications"

uix.clipboard.write(text)              → Promise<void>       // needs "clipboard-write"

uix.fullscreen.enter()                 → Promise<void>       // needs "fullscreen"
uix.fullscreen.exit()                  → Promise<void>       // needs "fullscreen"
uix.fullscreen.toggle()                → Promise<void>       // needs "fullscreen"

uix.file.save(filename, content, mime?) → Promise<boolean>  // needs "file-save"
uix.file.open(opts?)                   → Promise<FileResult | null>  // needs "file-open"

uix.browser.open(url)                  → Promise<void>       // needs "open-url"

uix.window.setTitle(title)             → Promise<void>
```

---

## 9. What Is Intentionally Out of Scope

These are not planned and the reasons are noted to prevent re-raising them:

| Capability                          | Reason excluded                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `uix.fs.*` (arbitrary filesystem)   | Breaks the security model. Use `file.save` / `file.open` with dialogs instead.                              |
| `uix.fetch()` / network by default  | Network is `"blocked"` by default. Use `"network": "allowed"` in manifest for apps that need it.            |
| `uix.printer.list()` / silent print | Requires platform-specific print APIs. Deferred to a dedicated `"thermal-print"` capability for v2.         |
| Cross-database SQL JOIN             | data.db and state.db are separate SQLite files. Join in JS — load both and merge in memory.                 |
| `localStorage` in bridge            | Permission `"local-storage"` already allows native browser `localStorage`. No bridge wrapper needed.        |
| `uix.state.transaction` with reads  | Transaction ops list is write-only. Use pre-transaction reads followed by the transaction for CAS patterns. |
