# dotuix — Roadmap

**Last updated:** 2026-05-21

---

## Completed

| Item                               | Notes                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VSCode extension — blank panel fix | Shimmer skeleton set synchronously before `await readUix()`                                                                                                       |
| Documentation pass                 | `llms.txt`, `spec/spec.md`, `docs/API_PLAN.md`, `README.md` all updated to full bridge surface                                                                    |
| Rust unit tests                    | 24 tests in `lib.rs` — `order_term` (8) + `build_where_clause` (16)                                                                                               |
| `demos/api-test.uix`               | Full API exercise demo; seeded with 16-record data.db                                                                                                             |
| Viewer welcome screen polish       | Brand SVG, loading overlay + spinner, ⌘O shortcut, drag-drop overlay, error dismiss                                                                               |
| Sync Server                        | Hono HTTP server (`packages/sync-server/`) + Tauri viewer client (`uix.state.sync()`, `state_sync` command, `device_id`, last-write-wins merge) — full end-to-end |

---

## Deferred

### 1. Mobile Bridge (Expo)

**What it is:** a fully functional React Native shell for `.uix` files. The user receives a `.uix` file (via AirDrop, email, messenger, etc.), opens it in the app, uses it normally — adding entries, editing state — and can then forward the same `.uix` file to someone else. Because state is packed back into the ZIP before sharing, the file carries its own data with it. The recipient gets the app **and** all the data in a single file.

This is the core "executable document" promise: the file is the whole thing.

**Full feature scope (not read-only):**

| Layer            | Requirement                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| File open        | `expo-document-picker` — pick `.uix` from Files, email, AirDrop, etc.   |
| Unpack           | `fflate` (already in `@dotuix/core`) to unzip in JS                     |
| `data.db`        | Load into `expo-sqlite` (in-memory or temp file); read-only             |
| `state.db`       | Load into `expo-sqlite` (temp file); **full read+write**                |
| WebView          | `react-native-webview` renders `index.html`                             |
| Bridge transport | `onMessage` / `injectJavaScript` (same postMessage protocol as Tauri)   |
| Bridge API       | Identical `window.__uix` surface — all `uix.state.*` writes fully wired |
| Repack on close  | Serialize updated `state.db` → update ZIP entry → write `.uix` to cache |
| Share/forward    | `expo-sharing` shares the repacked `.uix` file via native share sheet   |
| Notifications    | `expo-notifications`                                                    |
| Clipboard        | `expo-clipboard`                                                        |
| File save/open   | `expo-document-picker` + `expo-file-system`                             |

**Key design points:**

- The `.uix` format (ZIP + manifest + data.db + state.db) does not change.
- The bridge JS API (`window.__uix`) is identical to the desktop viewer — `.uix` apps are portable without modification.
- On "close" or "share", the Expo shell serializes the live `expo-sqlite` state DB back to bytes, replaces the `state.db` entry in the ZIP, and writes the updated `.uix` to the device cache.
- The user shares the updated `.uix` via the system share sheet. The recipient opens it and sees all the data.

**Reference codebase:** `tadween/app` in this workspace is the Expo shell. The `WebView` component and its message bridge are the starting point.

**Build order:**

1. Unpack `.uix` → extract `manifest.json`, `index.html`, assets, `data.db`, `state.db` into app cache
2. Open both DBs with `expo-sqlite`; wire all bridge commands
3. Render `index.html` in `react-native-webview`; inject bridge script
4. On "Done / Share": serialize `state.db` → repack ZIP → `expo-sharing`

---

## Minor — Deferred Indefinitely

These are known non-urgent optimisations. Document here so they are not forgotten.

### A. Incremental ZIP repack on close

When `state.db` grows large, rewriting the entire `.uix` ZIP on window close becomes slow. The current implementation always does a full repack. For most apps `state.db` stays tiny and this never matters. When it does matter the fix is to memory-map the ZIP and only replace the `state.db` entry in place, or store state outside the ZIP and merge lazily.

### B. Lazy SQLite connection open

The viewer currently holds the `rusqlite` connection open for the entire session (open on load, close on unload). For long-running viewer sessions with many idle apps this could be improved by closing the connection after each command and re-opening on demand. Non-issue in practice since each `.uix` runs one app at a time.

---

## Not Planned / Already Works

- **External DB (network requests from `.uix` apps):** works today — apps declare `"network": "allowed"` in the manifest and use `fetch()` normally. No viewer changes needed.
