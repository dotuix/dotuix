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

**Target use cases:** restaurant / hotel kiosk menus, retail catalogues, offline event guides, B2B sales presentations in low-connectivity areas.

---

## Try it now

Open [viewer.dotuix.com](https://viewer.dotuix.com) (or run the web viewer locally — see below), drag a `.uix` file onto the page, and it renders instantly in your browser.

---

## Packages

| Package                              | Description                                              | Status                                                                                          |
| ------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)     | Core library — pack, unpack, validate, read/write SQLite | [![npm](https://img.shields.io/npm/v/@dotuix/core)](https://www.npmjs.com/package/@dotuix/core) |
| [`apps/web-viewer`](apps/web-viewer) | Browser-based `.uix` viewer (Vite + React)               | In progress                                                                                     |

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

| Feature | How it works |
|---|---|
| PIN auth | Viewer prompts before opening; key derived with PBKDF2-SHA256 — no server involved |
| Encrypted files | AES-256-GCM; decrypted in memory after auth; app uses normal relative paths |
| Max opens | Tracked by viewer locally (`~/.dotuix/sessions.db`) — file cannot bypass it |
| Screenshot prevention | Viewer blocks OS screenshot API while file is open (desktop only) |
| Tamper detection | Ed25519 signature over all file hashes; viewer refuses if any file was modified after signing |

Full spec: [`docs/plan.md`](docs/plan.md)

---

## Templates

| Template                                       | Description                                                   |
| ---------------------------------------------- | ------------------------------------------------------------- |
| [`templates/restaurant`](templates/restaurant) | Gulf restaurant kiosk menu — Arabic, QAR prices, working cart |

---

## License

MIT
