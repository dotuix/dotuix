# @dotuix/cli

> `dotuix` — CLI for creating, packing, validating, and signing `.uix` files.

```bash
npm install -g @dotuix/cli
```

---

## Commands

```bash
dotuix init [name]                            # blank scaffold
dotuix init [name] -t restaurant|catalog|portfolio  # start from a starter template

dotuix pack   <dir>                           # pack folder → .uix
dotuix pack   <dir> -o dist/                  # pack to a specific output path
dotuix unpack <file.uix>                      # unpack → folder
dotuix validate <file.uix>                    # structural + offline-first checks
dotuix info   <file.uix>                      # print manifest fields

dotuix export <file.uix> --type order         # export state records
dotuix export <file.uix> --type order --format csv -o orders.csv

dotuix keygen                                 # generate an Ed25519 key pair
dotuix keygen -o ministry-key                 # named output (ministry-key.priv / .pub)
dotuix sign   <file.uix> --key private.key    # sign with Ed25519
dotuix verify <file.uix>                      # verify signature
dotuix encrypt <file.uix> --pin "1234" -o locked.uix  # AES-256-GCM encrypt files
```

---

## Quick start

```bash
# Scaffold a new project from a starter template
dotuix init my-menu -t restaurant
cd my-menu

# Edit manifest.json, index.html, style.css, app.js as needed, then:
dotuix pack .
dotuix validate my-menu.uix
```

---

## `dotuix validate` — offline-first checks

In addition to structural validation (manifest fields, entry file, database schema), `validate` performs static analysis looking for external dependencies that would silently fail on an offline kiosk:

- External URLs in `src`, `href`, `url()` (`http://`, `https://`, `//`)
- Google Fonts imports
- CDN script tags (jsDelivr, unpkg, cdnjs)
- `fetch()` / `XMLHttpRequest` calls to non-relative URLs

```
$ dotuix validate myshop.uix

✓ manifest.json valid
✓ entry index.html found
✓ data.db schema correct
⚠ External URL in index.html:34 — https://fonts.googleapis.com/...
  Network is blocked. This asset will fail to load at runtime.
✗ 1 offline violation found
```

---

## `dotuix export` — get data out

Reads `state.db` from inside the `.uix` file, filters records by `--type`, and writes flat JSON or CSV. This is the primary way for non-technical users to get their app's state data into Excel or accounting software.

```bash
dotuix export orders.uix --type order --format csv -o orders.csv
dotuix export orders.uix --type order --format json -o orders.json
```

---

## Related

- [`@dotuix/core`](https://npmjs.com/package/@dotuix/core) — programmatic API (pack, unpack, sign, validate)
- [`@dotuix/vite-plugin`](https://npmjs.com/package/@dotuix/vite-plugin) — build React/Vue/Svelte/TS apps as `.uix`
- [dotuix monorepo](https://github.com/dotuix/dotuix) — full source, templates, desktop viewer, editor

---

MIT License
