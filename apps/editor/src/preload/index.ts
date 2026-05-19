import { contextBridge, ipcRenderer } from "electron";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: DirEntry[];
}

export interface DbRecord {
  id: string;
  type: string;
  body: string;
  created_at: number;
  updated_at: number;
}

export interface DbLoadResult {
  exists: boolean;
  records: DbRecord[];
}

const api = {
  // Folder / file operations
  openFolder: (): Promise<string | null> => ipcRenderer.invoke("open-folder"),
  readDir: (path: string): Promise<DirEntry[]> =>
    ipcRenderer.invoke("read-dir", path),
  readFile: (path: string): Promise<string> =>
    ipcRenderer.invoke("read-file", path),
  writeFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke("write-file", path, content),

  // Pack
  packUix: (srcDir: string, outPath: string): Promise<string> =>
    ipcRenderer.invoke("pack-uix", srcDir, outPath),
  showSaveDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke("show-save-dialog", defaultName),

  // Preview server
  startPreviewServer: (dir: string): Promise<number> =>
    ipcRenderer.invoke("start-preview-server", dir),
  stopPreviewServer: (): Promise<void> =>
    ipcRenderer.invoke("stop-preview-server"),
  getPreviewPort: (): Promise<number | null> =>
    ipcRenderer.invoke("get-preview-port"),

  // Shell utilities
  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke("show-item-in-folder", path),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("open-external", url),

  // Database viewer
  dbLoadAll: (dbPath: string): Promise<DbLoadResult> =>
    ipcRenderer.invoke("db-load-all", dbPath),
  dbUpdateRecord: (dbPath: string, id: string, body: string): Promise<void> =>
    ipcRenderer.invoke("db-update-record", dbPath, id, body),
  dbDeleteRecord: (dbPath: string, id: string): Promise<void> =>
    ipcRenderer.invoke("db-delete-record", dbPath, id),
  dbInsertRecord: (
    dbPath: string,
    type: string,
    body: string,
  ): Promise<string> =>
    ipcRenderer.invoke("db-insert-record", dbPath, type, body),

  // Simple mode — create a .uix from a template + items
  simplePackUix: (config: {
    templateId: string;
    appName: string;
    recordType: string;
    items: Record<string, string | number>[];
  }): Promise<string | null> => ipcRenderer.invoke("simple-pack-uix", config),

  // Events from main → renderer
  onFileSaved: (cb: () => void) => {
    ipcRenderer.on("file-saved", cb);
    return () => ipcRenderer.removeListener("file-saved", cb);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
