import * as vscode from "vscode";
import { execSync, execFile } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

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

  // -------------------------------------------------------------------------
  // @dotuix chat participant
  // -------------------------------------------------------------------------
  const participant = vscode.chat.createChatParticipant(
    "dotuix.create",
    chatHandler,
  );
  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    "icons",
    "icon.png",
  );
  context.subscriptions.push(participant);
}

export function deactivate() {}

// ---------------------------------------------------------------------------
// Chat participant handler
// ---------------------------------------------------------------------------

const SPEC_URL = "https://dotuix.uts.qa/llms.txt";

const SYSTEM_PROMPT = `You are a dotuix .uix app generator.
A .uix file is a self-contained offline app (ZIP: manifest.json + HTML/JS/CSS + optional data.db + state.db).
The viewer injects window.__uix (aliased window.uix) — all bridge methods return Promises.
IMPORTANT body rule: uix.state.insert/update accept plain objects; find/get return { body: string } — ALWAYS JSON.parse(record.body) before reading fields.

Your job: given a user description, output ONLY a single JSON object in this exact shape (no markdown fences, no explanation):
{
  "name": "kebab-case-name",
  "manifest": { "uix": "1.0", "id": "com.example.name", "name": "App Name", "version": "1.0.0", "entry": "index.html", "mode": "kiosk", "network": "blocked" },
  "files": [
    { "path": "index.html", "content": "..." },
    { "path": "app.js",    "content": "..." },
    { "path": "style.css", "content": "..." }
  ],
  "dataRecords": [
    { "id": "product:001", "type": "product", "body": { ... } }
  ]
}
Rules:
- Put ALL creator content (products, menu items, catalog) in dataRecords — never hardcode arrays in app.js.
- app.js reads content with: const items = await uix.data.find({ type: "product" }); then JSON.parse each item.body.
- dataRecords may be an empty array [] if no content data is needed.
- Use self-contained CSS (no CDN, no external fonts).
- Do not define or mock window.__uix — the viewer injects it automatically.`;

interface GeneratedApp {
  name: string;
  manifest: Record<string, unknown>;
  files: Array<{ path: string; content: string }>;
  dataRecords: Array<{
    id?: string;
    type: string;
    body: Record<string, unknown>;
  }>;
}

async function chatHandler(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  // Fetch spec for grounding (best-effort)
  let spec = "";
  try {
    const res = await fetch(SPEC_URL);
    if (res.ok) spec = await res.text();
  } catch {
    /* offline — rely on system prompt */
  }

  const userPrompt = spec
    ? `Spec reference:\n${spec.slice(0, 8000)}\n\nUser request: ${
        request.prompt
      }`
    : `User request: ${request.prompt}`;

  stream.progress("Generating your .uix app…");

  // Call the LLM
  let raw = "";
  try {
    const messages = [
      vscode.LanguageModelChatMessage.User(`${SYSTEM_PROMPT}\n\n${userPrompt}`),
    ];
    const response = await request.model.sendRequest(messages, {}, token);
    for await (const chunk of response.text) {
      raw += chunk;
    }
  } catch (e) {
    stream.markdown(`**Error calling model:** ${(e as Error).message}`);
    return {};
  }

  // Parse JSON — strip any accidental markdown fences
  let app: GeneratedApp;
  try {
    const jsonText = raw
      .replace(/^```(?:json)?\n?/m, "")
      .replace(/\n?```$/m, "")
      .trim();
    app = JSON.parse(jsonText);
  } catch {
    stream.markdown(
      "**Could not parse model output as JSON.** Raw output:\n\n```\n" +
        raw.slice(0, 500) +
        "\n```",
    );
    return {};
  }

  // Write files to a temp directory then pack
  const cli = getCLI();
  if (!cli) {
    stream.markdown(
      "**dotuix CLI not found.** Install it first:\n```\nnpm install -g @dotuix/cli\n```",
    );
    return {};
  }

  stream.progress("Writing files and packing…");

  const workspaceRoot = getWorkspaceRoot();
  const outDir = workspaceRoot
    ? join(workspaceRoot, ".dotuix-gen")
    : join(tmpdir(), `dotuix-${randomUUID()}`);
  const projectDir = join(outDir, app.name ?? "app");
  mkdirSync(projectDir, { recursive: true });

  // Write manifest
  writeFileSync(
    join(projectDir, "manifest.json"),
    JSON.stringify(
      {
        ...app.manifest,
        ai: {
          generatedBy: "vscode/@dotuix",
          generatedAt: new Date().toISOString(),
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  // Write source files
  for (const file of app.files ?? []) {
    const fullPath = join(projectDir, file.path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, file.content, "utf8");
  }

  // Seed data.db if records provided
  if (app.dataRecords && app.dataRecords.length > 0) {
    const seedPath = join(projectDir, "_seed.json");
    writeFileSync(seedPath, JSON.stringify(app.dataRecords, null, 2), "utf8");
    try {
      execSync(
        `dotuix seed "${seedPath}" -o "${join(projectDir, "data.db")}"`,
        { stdio: "ignore" },
      );
    } catch (e) {
      stream.markdown(
        `> ⚠️ data.db seeding failed: ${
          (e as Error).message
        }. Records saved to \`_seed.json\`.`,
      );
    }
  }

  // Pack
  const uixPath = join(outDir, `${app.name ?? "app"}.uix`);
  try {
    execSync(`dotuix pack "${projectDir}" -o "${uixPath}"`, {
      stdio: "ignore",
    });
  } catch (e) {
    stream.markdown(`**Pack failed:** ${(e as Error).message}`);
    return {};
  }

  const recordCount = app.dataRecords?.length ?? 0;
  stream.markdown(
    `**✓ Created \`${app.name}.uix\`**\n\n` +
      `- ${app.files?.length ?? 0} source files\n` +
      (recordCount > 0
        ? `- ${recordCount} records seeded into \`data.db\`\n`
        : "") +
      `\nPath: \`${uixPath}\``,
  );
  stream.button({
    title: "Open in viewer",
    command: "vscode.open",
    arguments: [vscode.Uri.file(uixPath)],
  });
  stream.button({
    title: "Show in Explorer",
    command: "revealFileInOS",
    arguments: [vscode.Uri.file(uixPath)],
  });

  return {};
}
