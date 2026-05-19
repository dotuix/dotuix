# @dotuix/mcp

MCP server for dotuix — lets AI agents (Claude Desktop, Cursor, VS Code Copilot)
generate, pack, and validate `.uix` files through tool calls.

## Tools

| Tool          | Description                                                                        |
| ------------- | ---------------------------------------------------------------------------------- |
| `get_spec`    | Returns the full `.uix` format spec from dotuix.com/llms.txt                       |
| `init`        | Scaffolds a new project from a template (blank / restaurant / catalog / portfolio) |
| `write_files` | Writes generated HTML/JS/CSS into a project directory                              |
| `pack`        | Packs a directory into a `.uix` file via the CLI                                   |
| `validate`    | Validates a `.uix` file and returns errors/warnings                                |
| `info`        | Reads the manifest.json from a `.uix` without unpacking                            |

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

> "Read the .uix spec and create a restaurant menu app for Al Madina in Doha with 10 items in QAR, pack it to ~/Desktop/almadina.uix"

> "Validate ~/Downloads/app.uix and tell me what's wrong"

> "Generate a product catalog .uix with 20 fake items in a clean card grid layout"

The agent calls `get_spec` → `init` → `write_files` → `pack` and returns the
path to the finished `.uix` file.

## Links

- [dotuix.com](https://dotuix.com)
- [GitHub](https://github.com/dotuix/dotuix)
- [Format spec (llms.txt)](https://dotuix.com/llms.txt)
