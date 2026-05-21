# __NAME__

A dotuix **report** scaffolded from the `report` template (React 19 + TypeScript + Vite).

`state.mode` is `"file"` — all data is embedded in the `.uix` archive. Pack the
file, share it, and recipients see the exact same report without any server.

## Development

```bash
pnpm install
pnpm dev     # hot-reload dev server with mock uix bridge
```

## Build

```bash
pnpm build   # vite build → dist/ → __SLUG__.uix
```

## Workflow

1. Populate data (e.g. from a script or the dev bridge) via `uix.state.insert`
2. Run `pnpm build` — the data is embedded in `__SLUG__.uix`
3. Share the `.uix` file — recipients open it in dotuix viewer

## Customisation

Edit `src/Report.tsx` to change the data model and rendering.
Each row record should have type `"row"` and body `{ label, value }`.
