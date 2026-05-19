import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
} from "electron";
import { join } from "path";
import { readdir, readFile, writeFile, stat } from "fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "http";
import { createReadStream, existsSync } from "fs";
import { extname, join as pjoin } from "path";
import { randomUUID } from "crypto";
import { UIX } from "@dotuix/core";
import initSqlJs from "sql.js";

// ---------------------------------------------------------------------------
// sql.js singleton — initialised once, reused for all db IPC calls
// ---------------------------------------------------------------------------

let _SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;
async function getSql() {
  if (!_SQL) _SQL = await initSqlJs();
  return _SQL;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow;

function createWindow() {
  nativeTheme.themeSource = "dark";

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#1e1e1e",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------------------------------------------------------------------
// IPC: open folder dialog
// ---------------------------------------------------------------------------

ipcMain.handle("open-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Open .uix project folder",
  });
  return result.filePaths[0] ?? null;
});

// ---------------------------------------------------------------------------
// IPC: read directory tree
// ---------------------------------------------------------------------------

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: DirEntry[];
}

async function readDirRecursive(
  dirPath: string,
  depth = 0,
): Promise<DirEntry[]> {
  if (depth > 8) return [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  const result: DirEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = pjoin(dirPath, entry.name);
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: entryPath,
        isDir: true,
        children: await readDirRecursive(entryPath, depth + 1),
      });
    } else {
      result.push({ name: entry.name, path: entryPath, isDir: false });
    }
  }
  // Folders first, then files, both alphabetically
  return result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

ipcMain.handle("read-dir", async (_e, dirPath: string) => {
  return readDirRecursive(dirPath);
});

// ---------------------------------------------------------------------------
// IPC: read / write file
// ---------------------------------------------------------------------------

ipcMain.handle("read-file", async (_e, filePath: string) => {
  const buf = await readFile(filePath);
  return buf.toString("utf-8");
});

ipcMain.handle("write-file", async (_e, filePath: string, content: string) => {
  await writeFile(filePath, content, "utf-8");
  // Tell the preview to reload on next focus
  mainWindow.webContents.send("file-saved");
});

// ---------------------------------------------------------------------------
// IPC: pack to .uix
// ---------------------------------------------------------------------------

ipcMain.handle("pack-uix", async (_e, srcDir: string, outPath: string) => {
  await UIX.pack(srcDir, outPath);
  return outPath;
});

ipcMain.handle("show-save-dialog", async (_e, defaultName: string) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: "UIX App", extensions: ["uix"] }],
    title: "Save .uix file",
  });
  return result.filePath ?? null;
});

// ---------------------------------------------------------------------------
// IPC: live preview HTTP server
// ---------------------------------------------------------------------------

let previewServer: Server | null = null;
let previewPort: number | null = null;
let previewDir: string | null = null;

function mimeFor(ext: string): string {
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
  };
  return map[ext] ?? "application/octet-stream";
}

ipcMain.handle("start-preview-server", async (_e, dir: string) => {
  previewDir = dir;
  if (previewServer && previewPort) return previewPort;

  previewServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/index.html";

      const fullPath = pjoin(previewDir!, rel);
      try {
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          const idx = pjoin(fullPath, "index.html");
          if (existsSync(idx)) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            createReadStream(idx).pipe(res);
          } else {
            res.writeHead(404);
            res.end("No index.html");
          }
          return;
        }
        res.setHeader("Content-Type", mimeFor(extname(fullPath)));
        res.setHeader("Access-Control-Allow-Origin", "*");
        createReadStream(fullPath).pipe(res);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    },
  );

  await new Promise<void>((resolve) => {
    previewServer!.listen(0, "127.0.0.1", () => {
      previewPort = (previewServer!.address() as { port: number }).port;
      resolve();
    });
  });

  return previewPort;
});

ipcMain.handle("stop-preview-server", () => {
  previewServer?.close();
  previewServer = null;
  previewPort = null;
  previewDir = null;
});

ipcMain.handle("get-preview-port", () => previewPort);

// ---------------------------------------------------------------------------
// IPC: shell utilities
// ---------------------------------------------------------------------------

ipcMain.handle("show-item-in-folder", (_e, filePath: string) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle("open-external", (_e, url: string) => {
  shell.openExternal(url);
});

// ---------------------------------------------------------------------------
// IPC: database viewer
// ---------------------------------------------------------------------------

interface DbRecord {
  id: string;
  type: string;
  body: string;
  created_at: number;
  updated_at: number;
}

interface DbLoadResult {
  exists: boolean;
  records: DbRecord[];
}

ipcMain.handle(
  "db-load-all",
  async (_e, dbPath: string): Promise<DbLoadResult> => {
    let buf: Buffer;
    try {
      buf = await readFile(dbPath);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false, records: [] };
      }
      throw e;
    }
    const SQL = await getSql();
    const db = new SQL.Database(new Uint8Array(buf));
    const rows: DbRecord[] = [];
    try {
      const stmt = db.prepare(
        "SELECT id, type, body, created_at, updated_at FROM records ORDER BY type, created_at DESC",
      );
      while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push({
          id: row["id"] as string,
          type: row["type"] as string,
          body: row["body"] as string,
          created_at: row["created_at"] as number,
          updated_at: row["updated_at"] as number,
        });
      }
      stmt.free();
    } catch {
      // table may not exist yet — return empty
    }
    db.close();
    return { exists: true, records: rows };
  },
);

ipcMain.handle(
  "db-update-record",
  async (_e, dbPath: string, id: string, body: string): Promise<void> => {
    const SQL = await getSql();
    const buf = await readFile(dbPath);
    const db = new SQL.Database(new Uint8Array(buf));
    const now = Math.floor(Date.now() / 1000);
    db.run("UPDATE records SET body = ?, updated_at = ? WHERE id = ?", [
      body,
      now,
      id,
    ]);
    const out = db.export();
    db.close();
    await writeFile(dbPath, Buffer.from(out));
  },
);

ipcMain.handle(
  "db-delete-record",
  async (_e, dbPath: string, id: string): Promise<void> => {
    const SQL = await getSql();
    const buf = await readFile(dbPath);
    const db = new SQL.Database(new Uint8Array(buf));
    db.run("DELETE FROM records WHERE id = ?", [id]);
    const out = db.export();
    db.close();
    await writeFile(dbPath, Buffer.from(out));
  },
);

ipcMain.handle(
  "db-insert-record",
  async (_e, dbPath: string, type: string, body: string): Promise<string> => {
    const SQL = await getSql();
    const buf = await readFile(dbPath);
    const db = new SQL.Database(new Uint8Array(buf));
    const id = `${type}:${randomUUID()}`;
    db.run("INSERT INTO records (id, type, body) VALUES (?, ?, ?)", [
      id,
      type,
      body,
    ]);
    const out = db.export();
    db.close();
    await writeFile(dbPath, Buffer.from(out));
    return id;
  },
);
