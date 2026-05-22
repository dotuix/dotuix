# __NAME__

A dotuix **document** scaffolded from the `form` template.

`state.mode` is `"file"` — all data is stored inside the `.uix` archive itself.
Opening the file opens the form. Saving writes data back into the archive.
Sharing the file shares the filled-in content (like a Word `.docx`, but as a
rich web app).

## Development

```bash
pnpm install
pnpm dev     # hot-reload dev server with mock uix bridge
```

## Build

```bash
pnpm build   # vite build → dist/ → __SLUG__.uix
```

## Customisation

- Add fields in `src/main.ts`
- Change the `RECORD_ID` constant if you rename the form type
- To add a schema upgrade (e.g. add a field in v2), increment `schemaVersion`
  in `uix.config.ts` and call `uix.schema.onUpgrade` in `main.ts`
