# dotuix — VS Code Extension

> Language support, IntelliSense, and commands for `.uix` files.

Install from the VS Code Marketplace: search **dotuix** or install by ID `intenttext.dotuix`.

---

## Features

### Commands

Open the Command Palette (`⌘ Shift P` / `Ctrl Shift P`) and type **dotuix**:

| Command                            | Description                                                        |
| ---------------------------------- | ------------------------------------------------------------------ |
| `dotuix: Init new project`         | Scaffold a new `.uix` project in the current workspace via the CLI |
| `dotuix: Pack project → .uix`      | Run `dotuix pack .` in the workspace root and output a `.uix` file |
| `dotuix: Validate .uix file`       | Pick a `.uix` file and run structural + offline-first validation   |
| `dotuix: Open .uix file in viewer` | Open a `.uix` file in the dotuix desktop viewer                    |

### File association

`.uix` files are recognized as a distinct file type. The extension activates automatically when a `manifest.json` is present in the workspace.

---

## Requirements

The **dotuix CLI** must be installed globally for Pack, Validate, and Init commands:

```bash
npm install -g @dotuix/cli
```

The **dotuix viewer** must be installed on the system for the Open command.

---

## Activation

The extension activates when:

- The workspace contains a `manifest.json` (dotuix project detected)
- A `.uix` file is opened

---

## Extension settings

No settings at this time. Future versions will add:

- `dotuix.viewerPath` — custom path to the dotuix viewer binary
- `dotuix.autoValidate` — validate `.uix` files on open

---

## Release notes

### 0.4.0

- `dotuix: Open .uix file in viewer` command
- Improved CLI detection and error messages

### 0.3.0

- `dotuix: Init new project` command with template picker
- `.uix` file type activation event

### 0.2.0

- `dotuix: Validate .uix file` command

### 0.1.0

- Initial release: `dotuix: Pack project → .uix` command

---

## License

MIT
