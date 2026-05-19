# @dotuix/viewer-core

> Shared viewer logic for web and desktop `.uix` viewers — bridge injection, sandbox iframe management, and `state.db` lifecycle.

```bash
npm install @dotuix/viewer-core
```

> **Note:** This package is a planned extraction of the shared viewer runtime that currently lives inside the desktop viewer. It is available on npm but the public API is not yet stable. The desktop viewer (`apps/viewer`) is the reference implementation.

---

## Planned API

`@dotuix/viewer-core` will expose:

| Export                            | Description                                                         |
| --------------------------------- | ------------------------------------------------------------------- |
| `loadUix(path)`                   | Read and verify a `.uix` file, returning its manifest and files map |
| `injectBridge(iframe, files, db)` | Inject the `window.__uix` bridge into a sandboxed iframe            |
| `openStateDb(path)`               | Open / migrate the viewer-managed `state.db` for a loaded `.uix`    |
| `openDataDb(files)`               | Read the read-only `data.db` packed inside the `.uix` archive       |

---

## Use cases

- **Desktop viewer** (Tauri) — loads `.uix` files locally, provides the native bridge
- **Web viewer** — serves `.uix` files from a server, provides a web-native bridge
- **Testing** — opens `.uix` files in a headless environment for CI validation

---

## License

MIT
