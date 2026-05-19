import { contextBridge, ipcRenderer } from 'electron'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  children?: DirEntry[]
}

const api = {
  // Folder / file operations
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('open-folder'),
  readDir: (path: string): Promise<DirEntry[]> => ipcRenderer.invoke('read-dir', path),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('read-file', path),
  writeFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('write-file', path, content),

  // Pack
  packUix: (srcDir: string, outPath: string): Promise<string> =>
    ipcRenderer.invoke('pack-uix', srcDir, outPath),
  showSaveDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('show-save-dialog', defaultName),

  // Preview server
  startPreviewServer: (dir: string): Promise<number> =>
    ipcRenderer.invoke('start-preview-server', dir),
  stopPreviewServer: (): Promise<void> => ipcRenderer.invoke('stop-preview-server'),
  getPreviewPort: (): Promise<number | null> => ipcRenderer.invoke('get-preview-port'),

  // Shell utilities
  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke('show-item-in-folder', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),

  // Events from main → renderer
  onFileSaved: (cb: () => void) => {
    ipcRenderer.on('file-saved', cb)
    return () => ipcRenderer.removeListener('file-saved', cb)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
