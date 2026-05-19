import React, { useState, useCallback, useEffect, useRef } from "react";
import type { DirEntry } from "../../preload/index";
import FileTree from "./components/FileTree";
import EditorPane from "./components/EditorPane";
import PreviewPane from "./components/PreviewPane";
import DbViewer from "./components/DbViewer";
import Toolbar, { type EditorMode } from "./components/Toolbar";
import SimpleMode from "./components/SimpleMode";

declare global {
  interface Window {
    api: import("../../preload/index").Api;
  }
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
}

type BottomTab = "preview" | "db";

export default function App() {
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [tree, setTree] = useState<DirEntry[]>([]);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [bottomTab, setBottomTab] = useState<BottomTab>("preview");
  const [status, setStatus] = useState("");
  const [packing, setPacking] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("dev");
  const previewRef = useRef<{ reload: () => void }>(null);

  // ── Open project folder ─────────────────────────────────────────────────
  const openFolder = useCallback(async () => {
    const dir = await window.api.openFolder();
    if (!dir) return;
    setProjectDir(dir);
    const entries = await window.api.readDir(dir);
    setTree(entries);

    // Start preview server
    const port = await window.api.startPreviewServer(dir);
    setPreviewPort(port);
    setStatus(`Opened: ${dir}`);
  }, []);

  // ── Refresh tree ────────────────────────────────────────────────────────
  const refreshTree = useCallback(async () => {
    if (!projectDir) return;
    const entries = await window.api.readDir(projectDir);
    setTree(entries);
  }, [projectDir]);

  // ── Open file from tree ─────────────────────────────────────────────────
  const openTreeFile = useCallback(async (entry: DirEntry) => {
    if (entry.isDir) return;
    try {
      const content = await window.api.readFile(entry.path);
      setOpenFile({
        path: entry.path,
        name: entry.name,
        content,
        dirty: false,
      });
    } catch (e) {
      setStatus(`Cannot open: ${e}`);
    }
  }, []);

  // ── Save file ───────────────────────────────────────────────────────────
  const saveFile = useCallback(
    async (content: string) => {
      if (!openFile) return;
      await window.api.writeFile(openFile.path, content);
      setOpenFile((f) => (f ? { ...f, content, dirty: false } : f));
      setPreviewReloadKey((k) => k + 1);
      setStatus(`Saved: ${openFile.name}`);
    },
    [openFile],
  );

  // ── Pack to .uix ────────────────────────────────────────────────────────
  const packUix = useCallback(async () => {
    if (!projectDir) return;
    const defaultName = `${projectDir.split("/").pop() ?? "app"}.uix`;
    const outPath = await window.api.showSaveDialog(defaultName);
    if (!outPath) return;
    setPacking(true);
    setStatus("Packing…");
    try {
      await window.api.packUix(projectDir, outPath);
      setStatus(`Packed → ${outPath.split("/").pop()}`);
      await window.api.showItemInFolder(outPath);
    } catch (e) {
      setStatus(`Pack failed: ${e}`);
    } finally {
      setPacking(false);
    }
  }, [projectDir]);

  // ── Listen for file-saved events from main process ──────────────────────
  useEffect(() => {
    const off = window.api.onFileSaved(() => {
      setPreviewReloadKey((k) => k + 1);
    });
    return () => {
      off();
    };
  }, []);

  // ── Layout ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-surface-900 text-[#d4d4d4]">
      {/* ── Title bar / toolbar ── */}
      <Toolbar
        projectDir={projectDir}
        openFile={openFile}
        packing={packing}
        status={status}
        mode={editorMode}
        onOpenFolder={openFolder}
        onPack={packUix}
        onRefreshTree={refreshTree}
        onModeChange={setEditorMode}
      />

      {/* ── Simple mode ── */}
      {editorMode === "simple" && <SimpleMode onStatus={setStatus} />}

      {/* ── Three-pane body (dev mode) ── */}
      <div
        className={`flex flex-1 min-h-0 ${
          editorMode === "simple" ? "hidden" : ""
        }`}
      >
        {/* Left: file tree */}
        <aside className="w-56 shrink-0 flex flex-col border-r border-[#2d2d2d] bg-surface-850 overflow-hidden">
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#858585]">
            {projectDir ? projectDir.split("/").pop() : "No folder open"}
          </div>
          <div className="flex-1 overflow-y-auto">
            <FileTree
              entries={tree}
              activeFilePath={openFile?.path ?? null}
              onSelect={openTreeFile}
            />
          </div>
        </aside>

        {/* Center: Monaco editor */}
        <main className="flex-1 min-w-0 flex flex-col bg-surface-800">
          {openFile ? (
            <EditorPane
              file={openFile}
              onSave={saveFile}
              onChange={(content) =>
                setOpenFile((f) => (f ? { ...f, content, dirty: true } : f))
              }
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-[#555]">
              <div className="text-center">
                <p className="text-5xl mb-4 opacity-20">▦</p>
                <p className="text-base">
                  {projectDir
                    ? "Select a file to edit"
                    : "Open a project folder to start"}
                </p>
              </div>
            </div>
          )}
        </main>

        {/* Right: preview + DB viewer */}
        <aside className="w-[480px] shrink-0 flex flex-col border-l border-[#2d2d2d] bg-surface-900">
          {/* Tab bar */}
          <div className="flex border-b border-[#2d2d2d]">
            {(["preview", "db"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setBottomTab(tab)}
                className={`px-4 py-2 text-xs font-medium capitalize transition-colors ${
                  bottomTab === tab
                    ? "text-white border-b-2 border-accent"
                    : "text-[#858585] hover:text-[#ccc]"
                }`}
              >
                {tab === "db" ? "DB Records" : "Live Preview"}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0">
            {bottomTab === "preview" ? (
              <PreviewPane
                ref={previewRef}
                port={previewPort}
                reloadKey={previewReloadKey}
              />
            ) : (
              <DbViewer projectDir={projectDir} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
