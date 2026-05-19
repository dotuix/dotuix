import * as vscode from "vscode";
import { execSync, exec } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCLI(): string | null {
  try {
    execSync("dotuix --version", { stdio: "ignore" });
    return "dotuix";
  } catch {
    return null;
  }
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function runInTerminal(cmd: string, name = "dotuix") {
  const terminal = vscode.window.createTerminal({ name });
  terminal.show();
  terminal.sendText(cmd);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdPack() {
  const cli = getCLI();
  if (!cli) {
    vscode.window.showErrorMessage(
      "dotuix CLI not found. Run: npm install -g @dotuix/cli",
    );
    return;
  }

  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage("No workspace folder open.");
    return;
  }

  const manifest = join(root, "manifest.json");
  if (!existsSync(manifest)) {
    vscode.window.showErrorMessage(
      "No manifest.json found in workspace root. Is this a dotuix project?",
    );
    return;
  }

  runInTerminal(`dotuix pack .`, "dotuix: pack");
}

async function cmdValidate() {
  const cli = getCLI();
  if (!cli) {
    vscode.window.showErrorMessage(
      "dotuix CLI not found. Run: npm install -g @dotuix/cli",
    );
    return;
  }

  // Let the user pick a .uix file
  const files = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { "UIX files": ["uix"] },
    title: "Select a .uix file to validate",
  });

  if (!files || files.length === 0) return;

  const path = files[0].fsPath;
  runInTerminal(`dotuix validate "${path}"`, "dotuix: validate");
}

async function cmdInit() {
  const cli = getCLI();
  if (!cli) {
    vscode.window.showErrorMessage(
      "dotuix CLI not found. Run: npm install -g @dotuix/cli",
    );
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: "Project name",
    placeHolder: "my-uix-app",
    validateInput: (v) =>
      /^[a-z0-9][a-z0-9-_]*$/.test(v)
        ? null
        : "Use lowercase letters, numbers, hyphens only",
  });
  if (!name) return;

  const template = await vscode.window.showQuickPick(
    [
      { label: "$(file-code) Blank scaffold", value: "" },
      {
        label: "$(symbol-misc) Restaurant",
        description: "Gulf kiosk menu — Arabic, QAR prices, working cart",
        value: "restaurant",
      },
      {
        label: "$(list-unordered) Catalog",
        description: "Product showcase — category filters, SKU, pricing",
        value: "catalog",
      },
      {
        label: "$(person) Portfolio",
        description: "Creative portfolio — sidebar filters, year badge",
        value: "portfolio",
      },
    ],
    { placeHolder: "Choose a starter template" },
  );
  if (!template) return;

  const flag = template.value ? ` -t ${template.value}` : "";
  const root = getWorkspaceRoot();
  const cwd = root ? `cd "${root}" && ` : "";
  runInTerminal(`${cwd}dotuix init ${name}${flag}`, "dotuix: init");
}

async function cmdOpen() {
  // Allow picking a .uix from disk, OR use the active editor's folder
  const files = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { "UIX files": ["uix"] },
    title: "Select a .uix file to open in viewer",
  });
  if (!files || files.length === 0) return;
  // openExternal hands the file to the OS default handler — the dotuix viewer
  await vscode.env.openExternal(files[0]);
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("dotuix.pack", cmdPack),
    vscode.commands.registerCommand("dotuix.validate", cmdValidate),
    vscode.commands.registerCommand("dotuix.init", cmdInit),
    vscode.commands.registerCommand("dotuix.open", cmdOpen),
  );
}

export function deactivate() {}
