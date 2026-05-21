import * as vscode from "vscode";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import AdmZip from "adm-zip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UixManifest {
  uix?: string;
  id?: string;
  name?: string;
  version?: string;
  entry?: string;
  mode?: string;
  network?: string;
  permissions?: string[];
  expires?: string | null;
  minViewer?: string;
  theme?: { color?: string; background?: string };
  author?: string;
  security?: { pin?: boolean; encrypt?: boolean; maxOpens?: number };
  signature?: { algorithm?: string; signedAt?: string };
  ai?: { generatedBy?: string; generatedAt?: string; promptHash?: string };
  [key: string]: unknown;
}

interface FileEntry {
  name: string;
  size: number;
}

interface InspectorData {
  fileName: string;
  manifest: UixManifest;
  files: FileEntry[];
  dataDbBytes: number[] | null;
  stateDbPresent: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class UixInspectorProvider
  implements vscode.CustomReadonlyEditorProvider
{
  static readonly viewType = "dotuix.uixInspector";

  constructor(private readonly extensionUri: vscode.Uri) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    panel.webview.options = { enableScripts: true };

    // Set a loading skeleton immediately (synchronous) so the panel is never blank.
    const fileName = path.basename(document.uri.fsPath);
    panel.webview.html = buildLoadingHtml(fileName);

    const data = await this.readUix(document.uri);
    panel.webview.html = buildHtml(panel.webview, data);

    // Handle "Open in Viewer" button click from the webview
    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "openInViewer") {
        vscode.env.openExternal(document.uri);
      }
    });
  }

  private async readUix(uri: vscode.Uri): Promise<InspectorData> {
    const fileName = path.basename(uri.fsPath);
    const result: InspectorData = {
      fileName,
      manifest: {},
      files: [],
      dataDbBytes: null,
      stateDbPresent: false,
      error: null,
    };

    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const zip = new AdmZip(Buffer.from(raw));

      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        result.files.push({ name: entry.entryName, size: entry.header.size });

        if (entry.entryName === "manifest.json") {
          result.manifest = JSON.parse(entry.getData().toString("utf-8"));
        }
        if (entry.entryName === "data.db") {
          result.dataDbBytes = Array.from(entry.getData());
        }
        if (entry.entryName === "state.db") {
          result.stateDbPresent = true;
        }
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Loading skeleton — shown synchronously before readUix() resolves
// ---------------------------------------------------------------------------

function buildLoadingHtml(fileName: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(fileName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      padding: 24px;
      max-width: 900px;
      margin: 0 auto;
    }
    .filename {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 20px;
      word-break: break-all;
    }
    .shimmer-block {
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, #3c3c3c);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      animation: pulse 1.4s ease-in-out infinite;
    }
    .shimmer-line {
      height: 10px;
      border-radius: 4px;
      background: var(--vscode-panel-border, #3c3c3c);
      margin-bottom: 10px;
    }
    .shimmer-line:last-child { margin-bottom: 0; width: 60%; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="filename">${esc(fileName)}</div>
  <div class="grid">
    <div class="shimmer-block">
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
    </div>
    <div class="shimmer-block">
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
    </div>
  </div>
  <div class="shimmer-block" style="grid-column:1/-1">
    <div class="shimmer-line"></div>
    <div class="shimmer-line"></div>
    <div class="shimmer-line" style="width:40%"></div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function buildHtml(webview: vscode.Webview, d: InspectorData): string {
  const nonce = randomBytes(16).toString("hex");

  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    `style-src 'unsafe-inline'`,
    `connect-src https://cdn.jsdelivr.net`,
  ].join("; ");

  const m = d.manifest;
  const totalSize = d.files.reduce((s, f) => s + f.size, 0);

  // Badges
  const badges: { label: string; color: string }[] = [];
  if (m.mode) badges.push({ label: m.mode, color: "#6366f1" });
  if (m.network === "blocked")
    badges.push({ label: "offline", color: "#10b981" });
  if (m.network === "allowed")
    badges.push({ label: "network: allowed", color: "#f59e0b" });
  if (m.signature) badges.push({ label: "signed ✓", color: "#22c55e" });
  if (m.security?.pin)
    badges.push({ label: "PIN protected", color: "#8b5cf6" });
  if (m.security?.encrypt)
    badges.push({ label: "encrypted", color: "#8b5cf6" });
  if (m.ai) badges.push({ label: "AI generated", color: "#3b82f6" });
  if (m.expires)
    badges.push({
      label: `expires ${m.expires.slice(0, 10)}`,
      color: "#ef4444",
    });

  // Manifest rows (exclude complex objects shown elsewhere)
  const manifestRows: [string, string][] = [];
  const skip = new Set(["security", "signature", "ai", "theme"]);
  for (const [k, v] of Object.entries(m)) {
    if (skip.has(k)) continue;
    const val = Array.isArray(v)
      ? v.join(", ") || "—"
      : v === null || v === undefined
      ? "—"
      : String(v);
    manifestRows.push([k, val]);
  }

  const badgesHtml = badges
    .map(
      (b) =>
        `<span style="background:${b.color}22;color:${
          b.color
        };border:1px solid ${
          b.color
        }44;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">${escHtml(
          b.label,
        )}</span>`,
    )
    .join(" ");

  const manifestHtml = manifestRows
    .map(
      ([k, v]) =>
        `<tr><td class="key">${escHtml(k)}</td><td class="val">${escHtml(
          v,
        )}</td></tr>`,
    )
    .join("");

  const filesHtml = d.files
    .map(
      (f) =>
        `<tr><td class="key">${escHtml(
          f.name,
        )}</td><td class="val" style="text-align:right">${fmtSize(
          f.size,
        )}</td></tr>`,
    )
    .join("");

  const securityRows: [string, string][] = [];
  if (m.security) {
    if (m.security.pin) securityRows.push(["PIN auth", "PBKDF2-SHA256"]);
    if (m.security.encrypt) securityRows.push(["encryption", "AES-256-GCM"]);
    if (m.security.maxOpens)
      securityRows.push(["max opens", String(m.security.maxOpens)]);
  }
  if (m.signature) {
    securityRows.push(["signature", m.signature.algorithm ?? "Ed25519"]);
    if (m.signature.signedAt)
      securityRows.push(["signed at", m.signature.signedAt]);
  }
  const securityHtml = securityRows
    .map(
      ([k, v]) =>
        `<tr><td class="key">${escHtml(k)}</td><td class="val">${escHtml(
          v,
        )}</td></tr>`,
    )
    .join("");

  const aiHtml = m.ai
    ? `<section class="card">
          <h2>AI provenance</h2>
          <table><tbody>
            ${
              m.ai.generatedBy
                ? `<tr><td class="key">generated by</td><td class="val">${escHtml(
                    m.ai.generatedBy,
                  )}</td></tr>`
                : ""
            }
            ${
              m.ai.generatedAt
                ? `<tr><td class="key">generated at</td><td class="val">${escHtml(
                    m.ai.generatedAt,
                  )}</td></tr>`
                : ""
            }
            ${
              m.ai.promptHash
                ? `<tr><td class="key">prompt hash</td><td class="val" style="font-family:monospace;font-size:11px">${escHtml(
                    m.ai.promptHash,
                  )}</td></tr>`
                : ""
            }
          </tbody></table>
        </section>`
    : "";

  const dataSection = d.dataDbBytes
    ? `<section class="card" id="data-section">
        <h2>Data records <span id="record-count" style="font-weight:400;color:var(--vscode-descriptionForeground);font-size:13px;"></span></h2>
        <div id="data-status" style="color:var(--vscode-descriptionForeground);font-size:12px;margin-bottom:8px;">Loading…</div>
        <div id="data-table-wrap" style="overflow-x:auto"></div>
      </section>`
    : `<section class="card">
        <h2>Data records</h2>
        <p style="color:var(--vscode-descriptionForeground);font-size:13px;">No data.db in this archive.</p>
      </section>`;

  const stateNote = d.stateDbPresent
    ? `<p style="color:var(--vscode-descriptionForeground);font-size:12px;margin-top:4px;">state.db present (seeded initial state)</p>`
    : "";

  const errorHtml = d.error
    ? `<div style="background:#ef444422;border:1px solid #ef4444;border-radius:6px;padding:12px 16px;margin-bottom:16px;color:#ef4444;font-size:13px;">
        <strong>Error reading file:</strong> ${escHtml(d.error)}
      </div>`
    : "";

  const dataDbArray = d.dataDbBytes ? JSON.stringify(d.dataDbBytes) : "null";

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escHtml(d.fileName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      padding: 24px;
      max-width: 900px;
      margin: 0 auto;
    }
    .header { margin-bottom: 20px; }
    .filename {
      font-size: 18px;
      font-weight: 700;
      color: var(--vscode-editor-foreground);
      margin-bottom: 8px;
      word-break: break-all;
    }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .meta { color: var(--vscode-descriptionForeground, #808080); font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
    .card {
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, #3c3c3c);
      border-radius: 8px;
      padding: 16px;
    }
    .card.full { grid-column: 1 / -1; }
    h2 {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground, #808080);
      margin-bottom: 12px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td { padding: 4px 0; vertical-align: top; }
    td.key {
      color: var(--vscode-descriptionForeground, #808080);
      width: 38%;
      padding-right: 8px;
      white-space: nowrap;
    }
    td.val { color: var(--vscode-editor-foreground); word-break: break-word; }
    tr + tr td { border-top: 1px solid var(--vscode-panel-border, #3c3c3c); }
    .btn-open {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 5px;
      padding: 8px 16px;
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      margin-top: 4px;
    }
    .btn-open:hover { opacity: 0.9; }
    #records-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    #records-table th {
      text-align: left;
      padding: 4px 8px;
      background: var(--vscode-panel-border, #3c3c3c);
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
    }
    #records-table td {
      padding: 4px 8px;
      border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      width: auto;
    }
    #records-table td.key { width: auto; }
  </style>
</head>
<body>
  ${errorHtml}
  <div class="header">
    <div class="filename">${escHtml(d.fileName)}</div>
    <div class="badges">${badgesHtml}</div>
    <div class="meta">${fmtSize(totalSize)} · ${d.files.length} file${
    d.files.length !== 1 ? "s" : ""
  } · format v${escHtml(m.uix ?? "?")}</div>
  </div>

  <div class="grid">
    <section class="card">
      <h2>Manifest</h2>
      <table><tbody>${manifestHtml}</tbody></table>
    </section>

    <section class="card">
      <h2>Archive contents</h2>
      <table><tbody>${filesHtml}</tbody></table>
      ${stateNote}
    </section>

    ${
      securityRows.length > 0
        ? `<section class="card"><h2>Security &amp; signature</h2><table><tbody>${securityHtml}</tbody></table></section>`
        : ""
    }
    ${aiHtml}

    <section class="card full">
      ${dataSection.replace(/^<section[^>]*>/, "").replace(/<\/section>$/, "")}
    </section>
  </div>

  <section class="card" style="margin-bottom:0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
    <div>
      <div style="font-size:13px;font-weight:600;margin-bottom:2px;">Open in Desktop Viewer</div>
      <div style="font-size:12px;color:var(--vscode-descriptionForeground);">Run the app fully offline — requires the dotuix desktop viewer.</div>
    </div>
    <button class="btn-open" id="btn-open-viewer">Open in Viewer ↗</button>
  </section>

  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/sql-wasm.js"></script>
  <script nonce="${nonce}">
    // ── Open in viewer ──────────────────────────────────────────────────────
    document.getElementById('btn-open-viewer').addEventListener('click', () => {
      const vscode = acquireVsCodeApi();
      vscode.postMessage({ type: 'openInViewer' });
    });

    // ── Load data.db via sql.js ─────────────────────────────────────────────
    const DATA_DB_BYTES = ${dataDbArray};
    if (DATA_DB_BYTES && typeof initSqlJs !== 'undefined') {
      initSqlJs({
        locateFile: () => 'https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/sql-wasm.wasm'
      }).then(SQL => {
        const db = new SQL.Database(new Uint8Array(DATA_DB_BYTES));
        const rows = [];
        try {
          const result = db.exec('SELECT id, type, body FROM records LIMIT 200');
          if (result.length > 0) {
            for (const row of result[0].values) {
              rows.push({ id: row[0], type: row[1], body: row[2] });
            }
          }
        } catch (e) {
          // table might have different name
          try {
            const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
            const tbl = tables[0]?.values[0]?.[0];
            if (tbl) {
              const r2 = db.exec('SELECT * FROM ' + tbl + ' LIMIT 200');
              if (r2.length > 0) {
                const cols = r2[0].columns;
                for (const row of r2[0].values) {
                  const obj = {};
                  cols.forEach((c, i) => obj[c] = row[i]);
                  rows.push(obj);
                }
              }
            }
          } catch (_) {}
        }
        db.close();

        const status = document.getElementById('data-status');
        const wrap = document.getElementById('data-table-wrap');
        const countEl = document.getElementById('record-count');

        if (rows.length === 0) {
          if (status) status.textContent = 'No records found.';
          if (countEl) countEl.textContent = '(0)';
          return;
        }

        if (status) status.style.display = 'none';
        if (countEl) countEl.textContent = '(' + rows.length + (rows.length === 200 ? '+' : '') + ')';

        const cols = Object.keys(rows[0]);
        const thead = '<thead><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr></thead>';
        const tbody = '<tbody>' + rows.map(row =>
          '<tr>' + cols.map(c => {
            let val = row[c] ?? '';
            if (c === 'body' && typeof val === 'string') {
              try { val = JSON.stringify(JSON.parse(val)); } catch (_) {}
              if (val.length > 80) val = val.slice(0, 80) + '…';
            }
            return '<td>' + String(val).replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</td>';
          }).join('') + '</tr>'
        ).join('') + '</tbody>';

        if (wrap) wrap.innerHTML = '<table id="records-table">' + thead + tbody + '</table>';
      }).catch(err => {
        const status = document.getElementById('data-status');
        if (status) status.textContent = 'Could not load sql.js: ' + err.message;
      });
    }
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
