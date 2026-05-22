# __NAME__

A dotuix app scaffolded from the `vanilla-ts` template.

## Development

```bash
pnpm install
pnpm dev          # hot-reload dev server with mock uix bridge
```

Open `http://localhost:5173` in your browser. State is persisted in IndexedDB so
data survives page reloads during development.

## Build

```bash
pnpm build        # vite build → dist/ → __SLUG__.uix
```

The `.uix` file is written to the project root. Open it in the dotuix viewer.

## Project structure

```
__NAME__/
  src/
    main.ts        ← app entry point
    style.css      ← global styles
  uix.config.ts   ← app metadata (id, name, version, permissions …)
  vite.config.ts  ← Vite config with the dotuix plugin
  tsconfig.json
  index.html
  package.json
```

## Customisation

Edit `uix.config.ts` to change the app `id`, `name`, `mode`, and `permissions`.

State API quick reference:

```ts
// Insert
const rec = await uix.state.insert({ type: "todo", body: { text: "Hello" } });

// Query
const todos = await uix.state.find({ type: "todo", orderBy: "created_at" });

// Update
await uix.state.update(rec.id, { text: "Updated" });

// Delete
await uix.state.delete(rec.id);
```
