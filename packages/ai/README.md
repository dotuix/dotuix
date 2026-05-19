# @dotuix/ai

One-function SDK for creating `.uix` files from AI-generated code.

```bash
npm install @dotuix/ai
```

> **For AI agents using tool calls**, use [`@dotuix/mcp`](https://www.npmjs.com/package/@dotuix/mcp) instead.
> This package is for AI-generated Node.js / TypeScript scripts that build `.uix` files programmatically.

## Usage

```typescript
import { createUIX } from "@dotuix/ai";

const path = await createUIX({
  manifest: {
    uix: "1.0",
    id: "com.example.myapp",
    name: "My App",
    version: "1.0.0",
    entry: "index.html",
    mode: "window",
  },
  files: {
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>My App</title></head>
<body>
  <h1>Hello from .uix</h1>
  <script src="app.js"></script>
</body>
</html>`,
    "app.js": `(async () => {
  const manifest = await uix.manifest();
  document.querySelector('h1').textContent = manifest.name;
})();`,
  },
});

console.log(path); // /tmp/dotuix-xxx/my-app.uix — ready to open in the viewer
```

That's it. `createUIX` handles:

- Creating a temp directory and project structure
- Writing your files to disk
- Auto-stamping `ai.generatedBy` and `ai.generatedAt` in the manifest
- Calling `dotuix pack` to produce the `.uix` file
- Cleaning up the source directory

## API

```typescript
createUIX(options: CreateUIXOptions): Promise<string>
```

Returns the absolute path to the packed `.uix` file.

### `CreateUIXOptions`

| Field | Type | Required | Description |
|---|---|---|---|
| `manifest` | `Record<string, unknown>` | Yes | `manifest.json` content. The `ai` block is merged and stamped automatically. |
| `files` | `Record<string, string>` | Yes | Source files as `{ "relative/path": "utf-8 content" }`. Do not include `manifest.json`. |
| `output` | `string` | No | Absolute path for the output `.uix` file. Defaults to a temp directory. |
| `generatedBy` | `string` | No | Overrides `ai.generatedBy`. Defaults to `"@dotuix/ai"`. |

### The `ai` provenance block

Every `.uix` created via `createUIX` gets an `ai` block stamped in its
`manifest.json`:

```json
{
  "ai": {
    "generatedBy": "@dotuix/ai",
    "generatedAt": "2026-05-19T12:00:00Z"
  }
}
```

Pass `capabilities` in your manifest to declare what the app does:

```typescript
manifest: {
  // ...
  ai: {
    capabilities: ["search", "chat"],
  },
},
```

The final manifest will have `generatedBy` and `generatedAt` merged in.

## When to use which package

| Scenario | Use |
|---|---|
| Talking to Claude Desktop / Cursor / Copilot | [`@dotuix/mcp`](https://www.npmjs.com/package/@dotuix/mcp) |
| AI writes a Node.js script that creates a `.uix` | **`@dotuix/ai`** |
| Packing a manually written app | [`@dotuix/cli`](https://www.npmjs.com/package/@dotuix/cli) (`dotuix pack`) |
| Programmatic pack/unpack/validate in any context | [`@dotuix/core`](https://www.npmjs.com/package/@dotuix/core) |

## Requirements

- Node.js ≥ 22
- `@dotuix/cli` installed globally: `npm install -g @dotuix/cli`

## Links

- [dotuix.com](https://dotuix.com)
- [Format spec (llms.txt)](https://dotuix.com/llms.txt)
- [GitHub](https://github.com/dotuix/dotuix)
