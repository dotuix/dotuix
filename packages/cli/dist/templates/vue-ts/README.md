# __NAME__

A dotuix app scaffolded from the `vue-ts` template (Vue 3 + TypeScript + Vite).

## Development

```bash
pnpm install
pnpm dev     # hot-reload dev server with mock uix bridge
```

## Build

```bash
pnpm build   # vite build → dist/ → __SLUG__.uix
```

## Project structure

```
__NAME__/
  src/
    main.ts     ← Vue app entry
    App.vue     ← root component
    style.css
  uix.config.ts
  vite.config.ts
  tsconfig.json
  index.html
  package.json
```
