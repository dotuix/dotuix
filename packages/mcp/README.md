# @dotuix/mcp

MCP server for dotuix — lets AI agents (Claude Desktop, Cursor, VS Code Copilot)
generate, pack, and validate `.uix` files through tool calls.

## Tools

| Tool          | Description                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `get_spec`    | Returns the full `.uix` format spec from dotuix.uts.qa/llms.txt                                  |
| `create`      | **One-shot**: manifest + files in → packed `.uix` path out. AI provenance stamped automatically. |
| `init`        | Scaffolds a new project from a template (blank / restaurant / catalog / portfolio)               |
| `write_files` | Writes generated HTML/JS/CSS into a project directory (auto-stamps `ai` block in manifest)       |
| `pack`        | Packs a directory into a `.uix` file via the CLI                                                 |
| `validate`    | Validates a `.uix` file and returns errors/warnings                                              |
| `info`        | Reads the manifest.json from a `.uix` without unpacking                                          |

## AI workflow

### Recommended: one-shot `create`

The fastest path — the agent reads the spec once, generates all files in context,
and calls `create` to pack everything atomically:

```
get_spec → create
```

The `create` tool takes a `manifest` object and `files` array and returns the
`.uix` path. It auto-stamps `ai.generatedBy` and `ai.generatedAt` in the manifest.

### Step-by-step (for iterative workflows)

```
get_spec → init → write_files → pack
```

Use this when the agent needs to inspect or modify files between steps
(e.g. reading back generated content, patching specific files, or validating
before packing).

## Prerequisites

- Node.js ≥ 22
- `@dotuix/cli` installed globally: `npm install -g @dotuix/cli`

## Claude Desktop setup

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dotuix": {
      "command": "npx",
      "args": ["-y", "@dotuix/mcp"]
    }
  }
}
```

Restart Claude Desktop. You should see the dotuix tools available.

## Cursor setup

Add to Cursor settings → MCP:

```json
{
  "dotuix": {
    "command": "npx",
    "args": ["-y", "@dotuix/mcp"]
  }
}
```

## VS Code Copilot setup

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "dotuix": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@dotuix/mcp"]
    }
  }
}
```

## Example prompts

Once connected, you can say things like:

> "Read the .uix spec and create a restaurant menu .uix for Al Madina in Doha with 10 items in QAR, pack it to ~/Desktop/almadina.uix"

> "Generate a product catalog .uix with 20 fake items in a clean card grid layout and save it to ~/Desktop/catalog.uix"

> "Validate ~/Downloads/app.uix and tell me what's wrong"

The agent calls `get_spec` → `create` (or `init` → `write_files` → `pack`) and returns the
path to the finished `.uix` file. The `ai.generatedBy` field is stamped automatically in
every file the MCP produces.

> "Generate a product catalog .uix with 20 fake items in a clean card grid layout"

The agent calls `get_spec` → `init` → `write_files` → `pack` and returns the
path to the finished `.uix` file.

## Links

- [dotuix.uts.qa](https://dotuix.uts.qa)
- [GitHub](https://github.com/dotuix/dotuix)
- [Format spec (llms.txt)](https://dotuix.uts.qa/llms.txt)
