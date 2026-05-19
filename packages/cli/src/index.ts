/**
 * @dotuix/cli — dotuix <command> [args]
 *
 * Commands:
 *   pack     <dir> [-o <out>]          Pack a project folder into a .uix file
 *   unpack   <file.uix> [-o <outDir>]  Unpack a .uix file to a directory
 *   validate <file.uix>                Validate structure + offline-first checks
 *   info     <file.uix>                Print manifest details
 *   init     [name]                    Scaffold a new .uix project
 *   export   <file.uix> --type <t>     Export state records as JSON or CSV
 *   keygen   [-o <base>]               Generate an Ed25519 key pair
 *   sign     <file.uix> --key <k.priv> Sign a .uix file (Ed25519)
 *   verify   <file.uix>                Verify the Ed25519 signature
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, basename, extname, join } from "node:path";
import {
  UIX,
  unpackBuffer,
  readManifestFromBuffer,
  createState,
  generateKeyPair,
  sign,
  verify,
} from "@dotuix/core";
import type { UIXRecord } from "@dotuix/core";

// ---------------------------------------------------------------------------
// ANSI colours (no deps)
// ---------------------------------------------------------------------------
const isTTY = process.stdout.isTTY;
const c = {
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
  muted: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};

// ---------------------------------------------------------------------------
// Offline-first validator — scans text files for external dependencies
// ---------------------------------------------------------------------------
const EXTERNAL_RE = /(?:src|href|url)\s*[=(]["']?(https?:\/\/|\/\/)[^"') >]+/i;
const FETCH_RE = /(?:fetch|XMLHttpRequest)\s*\(\s*["'`](https?:\/\/|\/\/)/i;
const WS_RE = /new\s+WebSocket\s*\(\s*["'`]wss?:\/\//i;
const FONT_RE = /fonts\.googleapis\.com|fonts\.gstatic\.com/i;
const CDN_RE = /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh/i;

const TEXT_EXTS = new Set(["html", "js", "css", "ts", "jsx", "tsx"]);

function offlineCheck(
  files: Record<string, Uint8Array>,
): Array<{ file: string; line: number; message: string }> {
  const issues: Array<{ file: string; line: number; message: string }> = [];
  const dec = new TextDecoder();

  for (const [path, data] of Object.entries(files)) {
    const ext = extname(path).slice(1).toLowerCase();
    if (!TEXT_EXTS.has(ext)) continue;

    const lines = dec.decode(data).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const num = i + 1;
      if (FONT_RE.test(ln))
        issues.push({
          file: path,
          line: num,
          message: `Google Fonts import — will fail offline`,
        });
      else if (CDN_RE.test(ln))
        issues.push({
          file: path,
          line: num,
          message: `CDN dependency — will fail offline`,
        });
      else if (EXTERNAL_RE.test(ln) || FETCH_RE.test(ln) || WS_RE.test(ln))
        issues.push({
          file: path,
          line: num,
          message: `External URL — will fail offline: ${ln
            .trim()
            .slice(0, 80)}`,
        });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Arg parsing helpers (no commander dependency)
// ---------------------------------------------------------------------------
function flag(args: string[], ...flags: string[]): boolean {
  return flags.some((f) => args.includes(f));
}
function opt(args: string[], ...flags: string[]): string | undefined {
  for (const f of flags) {
    const i = args.indexOf(f);
    if (i !== -1 && args[i + 1] && !args[i + 1].startsWith("-"))
      return args[i + 1];
  }
}
function pos(args: string[]): string[] {
  return args.filter(
    (a, i) => !a.startsWith("-") && (i === 0 || !args[i - 1].startsWith("-")),
  );
}

// ---------------------------------------------------------------------------
// pack
// ---------------------------------------------------------------------------
async function cmdPack(args: string[]) {
  const dir = pos(args)[0];
  if (!dir) {
    console.error(c.red("✗") + " Usage: dotuix pack <dir> [-o out.uix]");
    process.exit(1);
  }
  const absDir = resolve(dir);
  const out = resolve(opt(args, "-o", "--out") ?? `${basename(absDir)}.uix`);
  console.log(c.muted(`Packing ${absDir} …`));
  await UIX.pack(absDir, out);
  const kb = (readFileSync(out).length / 1024).toFixed(1);
  console.log(
    c.green("✓") +
      " " +
      c.bold(basename(out)) +
      c.muted(`  ${kb} KB  →  ${out}`),
  );
}

// ---------------------------------------------------------------------------
// unpack
// ---------------------------------------------------------------------------
async function cmdUnpack(args: string[]) {
  const file = pos(args)[0];
  if (!file) {
    console.error(c.red("✗") + " Usage: dotuix unpack <file.uix> [-o outDir]");
    process.exit(1);
  }
  const absFile = resolve(file);
  const outDir = resolve(
    opt(args, "-o", "--out") ?? basename(file, extname(file)),
  );
  console.log(c.muted(`Unpacking ${basename(absFile)} …`));
  await UIX.unpack(absFile, outDir);
  console.log(c.green("✓") + " Unpacked to " + c.bold(outDir));
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------
async function cmdValidate(args: string[]) {
  const file = pos(args)[0];
  if (!file) {
    console.error(c.red("✗") + " Usage: dotuix validate <file.uix>");
    process.exit(1);
  }

  const result = await UIX.validate(resolve(file));

  let offlineIssues: ReturnType<typeof offlineCheck> = [];
  let networkAllowed = false;
  try {
    const data = new Uint8Array(readFileSync(resolve(file)));
    const manifest = readManifestFromBuffer(data);
    networkAllowed = manifest.network === "allowed";
    if (!networkAllowed) offlineIssues = offlineCheck(unpackBuffer(data));
  } catch {
    /* structural errors captured by validate() */
  }

  // Print
  if (result.errors.length === 0) {
    console.log(c.green("✓") + " manifest.json valid");
    console.log(c.green("✓") + " entry file present");
  }
  for (const e of result.errors) console.log(c.red("✗") + " " + e);
  for (const w of result.warnings) console.log(c.yellow("⚠") + " " + w);
  for (const i of offlineIssues)
    console.log(c.yellow("⚠") + ` ${i.file}:${i.line} — ${i.message}`);

  const warns = result.warnings.length + offlineIssues.length;
  if (!result.valid) {
    console.log(`\n${c.red("✗")} ${result.errors.length} error(s)`);
    process.exit(1);
  } else if (warns > 0) {
    console.log(
      `\n${c.yellow("⚠")} ${warns} warning(s) — file is valid but check above`,
    );
  } else {
    console.log(`\n${c.green("✓")} ${c.bold(basename(file))} is valid`);
  }
}

// ---------------------------------------------------------------------------
// info
// ---------------------------------------------------------------------------
async function cmdInfo(args: string[]) {
  const file = pos(args)[0];
  if (!file) {
    console.error(c.red("✗") + " Usage: dotuix info <file.uix>");
    process.exit(1);
  }

  const data = new Uint8Array(readFileSync(resolve(file)));
  const manifest = readManifestFromBuffer(data);
  const files = unpackBuffer(data);
  const kb = (
    Object.values(files).reduce((s, b) => s + b.length, 0) / 1024
  ).toFixed(1);

  console.log(
    `\n  ${c.bold(manifest.name)}  ${c.muted("v" + manifest.version)}`,
  );
  console.log(`  ${c.muted("id:")}          ${manifest.id}`);
  console.log(`  ${c.muted("format:")}      uix ${manifest.uix}`);
  console.log(`  ${c.muted("mode:")}        ${manifest.mode}`);
  console.log(`  ${c.muted("network:")}     ${manifest.network ?? "blocked"}`);
  console.log(`  ${c.muted("entry:")}       ${manifest.entry}`);
  if (manifest.permissions?.length)
    console.log(
      `  ${c.muted("permissions:")} ${manifest.permissions.join(", ")}`,
    );
  if (manifest.expires) {
    const expired = new Date(manifest.expires) < new Date();
    console.log(
      `  ${c.muted("expires:")}     ${manifest.expires}` +
        (expired ? c.red(" (expired)") : c.green(" (active)")),
    );
  }
  if (manifest.author) {
    console.log(`  ${c.muted("author:")}      ${manifest.author}`);
  }
  console.log(
    `  ${c.muted("files:")}       ${
      Object.keys(files).length
    } (${kb} KB uncompressed)`,
  );
  console.log();
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------
async function cmdExport(args: string[]) {
  const file = pos(args)[0];
  const type = opt(args, "--type", "-t");
  const format = (opt(args, "--format", "-f") ?? "json").toLowerCase();
  const outFile = opt(args, "--output", "-o");

  if (!file || !type) {
    console.error(
      c.red("✗") +
        " Usage: dotuix export <file.uix> --type <type> [--format json|csv] [-o file]",
    );
    process.exit(1);
  }
  if (format !== "json" && format !== "csv") {
    console.error(c.red("✗") + " --format must be json or csv");
    process.exit(1);
  }

  const data = new Uint8Array(readFileSync(resolve(file)));
  const files = unpackBuffer(data);
  const manifest = readManifestFromBuffer(data);

  const stateDb = await createState({
    uixVersion: manifest.uix,
    seed: files["state.db"],
    permissions: ["raw-sql"],
  });
  const records = stateDb.find({ type });
  stateDb.close();

  if (records.length === 0) {
    console.log(
      c.yellow("⚠") + ` No records of type "${type}" found in state.db`,
    );
    return;
  }

  const rows = records.map((r: UIXRecord) => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(r.body as string);
    } catch {
      body = { raw: r.body };
    }
    return {
      id: r.id,
      type: r.type,
      created_at: r.created_at,
      updated_at: r.updated_at,
      ...body,
    };
  });

  let content: string;
  if (format === "json") {
    content = JSON.stringify(rows, null, 2);
  } else {
    const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    content = [
      keys.join(","),
      ...rows.map((r) =>
        keys.map((k) => esc((r as Record<string, unknown>)[k])).join(","),
      ),
    ].join("\n");
  }

  if (outFile) {
    writeFileSync(resolve(outFile), content, "utf8");
    console.log(c.green("✓") + ` ${rows.length} record(s) → ${outFile}`);
  } else {
    console.log(content);
  }
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
const SCAFFOLD: Record<string, string> = {
  "manifest.json": `{
  "uix": "1",
  "id": "com.example.SLUG",
  "name": "NAME",
  "version": "1.0.0",
  "entry": "index.html",
  "mode": "kiosk",
  "permissions": ["local-storage"],
  "network": "blocked",
  "state": { "seed": false },
  "theme": { "color": "#c8a96e", "background": "#1a1a1a" }
}`,
  "index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NAME</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <h1>NAME</h1>
    <p id="status">Ready.</p>
    <script src="app.js"></script>
  </body>
</html>`,
  "style.css": `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #1a1a1a; color: #e8e8e8; padding: 2rem; }
h1   { color: #c8a96e; margin-bottom: 1rem; }
`,
  "app.js": `/**
 * app.js
 *
 * window.__uix is injected by the dotuix viewer:
 *   __uix.data.find({ type, where?, orderBy?, limit? })
 *   __uix.data.get(id)
 *   __uix.state.find / get / insert / update / delete
 *   __uix.manifest
 */
const bridge = window.__uix ?? null;

async function main() {
  const name = bridge?.manifest?.name ?? "NAME";
  document.querySelector("h1").textContent = name;
  document.getElementById("status").textContent = "Edit app.js to build your experience.";
}

main().catch(console.error);
`,
};

async function cmdInit(args: string[]) {
  const name = pos(args)[0] ?? "my-uix-app";
  const dir = resolve(name);
  const slug = basename(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  if (existsSync(dir)) {
    console.error(c.red("✗") + ` Already exists: ${dir}`);
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });

  for (const [filename, tpl] of Object.entries(SCAFFOLD)) {
    const content = tpl.replace(/NAME/g, basename(name)).replace(/SLUG/g, slug);
    writeFileSync(join(dir, filename), content, "utf8");
  }

  console.log(`\n  ${c.green("✓")} Created ${c.bold(name)}/\n`);
  for (const f of Object.keys(SCAFFOLD))
    console.log(`    ${c.muted("+")} ${f}`);
  console.log(`
  Next:

    ${c.cyan("cd")} ${name}
    ${c.cyan("# customise manifest.json, index.html, style.css, app.js")}
    ${c.cyan("dotuix pack")} .
    ${c.cyan("dotuix validate")} ${slug}.uix
`);
}

// ---------------------------------------------------------------------------
// keygen
// ---------------------------------------------------------------------------
function cmdKeygen(args: string[]) {
  const base = (
    opt(args, "-o", "--out") ??
    pos(args)[0] ??
    "dotuix-key"
  ).replace(/\.(priv|pub)$/, "");
  const privPath = resolve(`${base}.priv`);
  const pubPath = resolve(`${base}.pub`);

  if (existsSync(privPath) || existsSync(pubPath)) {
    console.error(
      c.red("✗") + ` Key files already exist: ${base}.priv / ${base}.pub`,
    );
    process.exit(1);
  }

  const kp = generateKeyPair();
  writeFileSync(privPath, kp.privateKey, "utf8");
  writeFileSync(pubPath, kp.publicKey, "utf8");

  console.log(`
  ${c.green("✓")} Key pair generated
`);
  console.log(`  ${c.muted("private:")} ${privPath}`);
  console.log(`  ${c.muted("public:")}  ${pubPath}`);
  console.log(`
  ${c.yellow("⚠")} Keep ${basename(privPath)} secret — never share it.\n`);
}

// ---------------------------------------------------------------------------
// sign
// ---------------------------------------------------------------------------
async function cmdSign(args: string[]) {
  const file = pos(args)[0];
  const keyFile = opt(args, "--key", "-k");
  if (!file || !keyFile) {
    console.error(
      c.red("✗") +
        " Usage: dotuix sign <file.uix> --key <keyfile.priv> [-o out.uix]",
    );
    process.exit(1);
  }

  const absFile = resolve(file);
  const out = resolve(opt(args, "-o", "--out") ?? absFile);

  const privKeyStr = readFileSync(resolve(keyFile), "utf8").trim();
  const privKeyBytes = Buffer.from(privKeyStr, "base64url");
  if (privKeyBytes.length !== 32) {
    console.error(
      c.red("✗") +
        " Key file does not contain a valid 32-byte Ed25519 private key seed",
    );
    process.exit(1);
  }

  console.log(c.muted(`Signing ${basename(absFile)} …`));
  sign(absFile, privKeyBytes, out);
  console.log(c.green("✓") + " Signed " + c.bold(basename(out)));
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------
async function cmdVerify(args: string[]) {
  const file = pos(args)[0];
  if (!file) {
    console.error(c.red("✗") + " Usage: dotuix verify <file.uix>");
    process.exit(1);
  }

  const result = verify(resolve(file));

  if (result.valid) {
    console.log(c.green("✓") + " Signature valid");
    console.log(`  ${c.muted("algorithm:")} Ed25519`);
    console.log(`  ${c.muted("publicKey:")} ${result.publicKey}`);
    if (result.signedAt)
      console.log(`  ${c.muted("signedAt:")}  ${result.signedAt}`);
  } else {
    console.error(c.red("✗") + " " + (result.error ?? "Verification failed"));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// help
// ---------------------------------------------------------------------------
function printHelp() {
  console.log(`
  ${c.bold("dotuix")} — pack, validate and manage .uix files

  ${c.bold("Usage:")}  dotuix ${c.cyan("<command>")} [options]

  ${c.bold("Commands:")}
    ${c.cyan(
      "pack",
    )}     <dir> [-o out.uix]                  Pack a folder → .uix
    ${c.cyan("unpack")}   <file.uix> [-o outDir]              Unpack a .uix file
    ${c.cyan(
      "validate",
    )} <file.uix>                          Validate + offline checks
    ${c.cyan(
      "info",
    )}     <file.uix>                          Show manifest details
    ${c.cyan(
      "init",
    )}     [name]                              Scaffold a new project
    ${c.cyan(
      "export",
    )}   <file.uix> --type <t>               Export state records
               [--format json|csv] [-o file]
    ${c.cyan(
      "keygen",
    )}   [-o <base>]                         Generate Ed25519 key pair
    ${c.cyan("sign")}     <file.uix> --key <k.priv> [-o out]  Sign a .uix file
    ${c.cyan("verify")}   <file.uix>                          Verify signature

  ${c.bold("Examples:")}
    dotuix pack ./my-app
    dotuix validate myapp.uix
    dotuix info myapp.uix
    dotuix init my-restaurant
    dotuix export myapp.uix --type order --format csv -o orders.csv
    dotuix keygen -o ministry-key
    dotuix sign briefing.uix --key ministry-key.priv
    dotuix verify briefing.uix
`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || flag([cmd], "-h", "--help", "help")) {
    printHelp();
    return;
  }
  switch (cmd) {
    case "pack":
      await cmdPack(rest);
      break;
    case "unpack":
      await cmdUnpack(rest);
      break;
    case "validate":
      await cmdValidate(rest);
      break;
    case "info":
      await cmdInfo(rest);
      break;
    case "init":
      await cmdInit(rest);
      break;
    case "export":
      await cmdExport(rest);
      break;
    case "keygen":
      cmdKeygen(rest);
      break;
    case "sign":
      await cmdSign(rest);
      break;
    case "verify":
      await cmdVerify(rest);
      break;
    default:
      console.error(
        c.red("✗") + ` Unknown command: ${cmd}\n  Run dotuix --help`,
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(
    c.red("✗") + " " + (err instanceof Error ? err.message : String(err)),
  );
  process.exit(1);
});
