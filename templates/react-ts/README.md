# __NAME__

A dotuix app scaffolded from the `react-ts` template (React 19 + TypeScript + Vite).

## Development

```bash
pnpm install
pnpm dev     # hot-reload dev server with mock uix bridge
```

Open `http://localhost:5173`. State is persisted in IndexedDB during development.

## Build

```bash
pnpm build   # vite build → dist/ → __SLUG__.uix
```

## Project structure

```
__NAME__/
  src/
    main.tsx    ← React root
    App.tsx     ← root component
    style.css
  uix.config.ts
  vite.config.ts
  tsconfig.json
  index.html
  package.json
```

## State API (TypeScript)

```ts
// Insert
const rec = await uix.state.insert({ type: "order", body: { total: 42 } });

// Query with filter
const open = await uix.state.find({ type: "order", where: { status: "open" } });

// Update
await uix.state.update(rec.id, { total: 50, status: "paid" });

// Delete
await uix.state.delete(rec.id);
```

`uix` is typed globally via `@dotuix/types` (configured in `tsconfig.json`).
