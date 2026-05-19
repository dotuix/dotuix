import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import FileTree, { type DirEntry } from "./FileTree";
import EditorPane, { type OpenFile } from "./EditorPane";
import PreviewPane from "./PreviewPane";
import DbViewer from "./DbViewer";

interface Props {
  onClose: () => void;
}

type BottomTab = "preview" | "db";

export default function DeveloperMode({ onClose }: Props) {
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [tree, setTree] = useState<DirEntry[]>([]);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [bottomTab, setBottomTab] = useState<BottomTab>("preview");
  const [status, setStatus] = useState("");
  const [packing, setPacking] = useState(false);

  // ── Open project folder ─────────────────────────────────────────────────
  const openFolder = useCallback(async () => {
    const dir = await invoke<string | null>("editor_open_folder");
    if (!dir) return;
    setProjectDir(dir);
    const entries = await invoke<DirEntry[]>("editor_read_dir", { path: dir });
    setTree(entries);
    await invoke("editor_set_preview_dir", { path: dir });
    setPreviewReloadKey((k) => k + 1);
    setStatus(`Opened: ${dir.split("/").pop()}`);
  }, []);

  // ── Refresh tree ────────────────────────────────────────────────────────
  const refreshTree = useCallback(async () => {
    if (!projectDir) return;
    const entries = await invoke<DirEntry[]>("editor_read_dir", {
      path: projectDir,
    });
    setTree(entries);
  }, [projectDir]);

  // ── Open file from tree ─────────────────────────────────────────────────
  const openTreeFile = useCallback(async (entry: DirEntry) => {
    if (entry.is_dir) return;
    try {
      const content = await invoke<string>("editor_read_file", {
        path: entry.path,
      });
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
      await invoke("editor_write_file", { path: openFile.path, content });
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
    const outPath = await invoke<string | null>("editor_show_save_dialog", {
      defaultName,
    });
    if (!outPath) return;
    setPacking(true);
    setStatus("Packing…");
    try {
      await invoke("editor_pack_uix", { srcDir: projectDir, outPath });
      setStatus(`Packed → ${outPath.split("/").pop()}`);
      await invoke("editor_reveal_in_folder", { path: outPath });
    } catch (e) {
      setStatus(`Pack failed: ${e}`);
    } finally {
      setPacking(false);
    }
  }, [projectDir]);

  // ── Keyboard shortcut: Cmd/Ctrl+O → open folder ─────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        openFolder();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openFolder]);

  // ── Cleanup: clear preview dir when leaving developer mode ──────────────
  useEffect(() => {
    return () => {
      invoke("editor_clear_preview_dir");
    };
  }, []);

  return (
    <div className="dev-root">
      {/* Toolbar */}
      <div className="dev-toolbar">
        <span className="dev-macos-spacer" />
        <span className="dev-app-name">dotuix editor</span>

        <div className="dev-toolbar-nodrag">
          <button
            className="dev-tbtn"
            onClick={openFolder}
            title="Open folder (⌘O)"
          >
            📂 Open
          </button>

          {projectDir && (
            <>
              <button
                className="dev-tbtn"
                onClick={refreshTree}
                title="Refresh file tree"
              >
                ↺
              </button>
              <button
                className="dev-tbtn dev-tbtn-primary"
                onClick={packUix}
                disabled={packing}
                title="Pack to .uix"
              >
                {packing ? "⏳ Packing…" : "▦ Pack .uix"}
              </button>
            </>
          )}

          {openFile && (
            <span
              style={
                {
                  marginLeft: "0.5rem",
                  fontSize: "0.72rem",
                  color: "#666",
                  WebkitAppRegion: "no-drag",
                } as React.CSSProperties
              }
            >
              {openFile.name}
              {openFile.dirty && (
                <span style={{ color: "#e2a65e", marginLeft: "0.2rem" }}>
                  ●
                </span>
              )}
            </span>
          )}
        </div>

        {status && <div className="dev-status">{status}</div>}

        <div style={{ flex: 1 }} />

        <div className="dev-toolbar-nodrag">
          <button className="dev-tbtn" onClick={onClose} title="Back to home">
            ✕ Exit
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="dev-body">
        {/* Left: file tree */}
        <div className="dev-sidebar">
          <div className="dev-sidebar-header">
            {projectDir ? projectDir.split("/").pop() : "Explorer"}
          </div>
          {tree.length === 0 ? (
            <div className="dev-empty" style={{ flex: 1 }}>
              <span style={{ fontSize: "1.5rem", opacity: 0.3 }}>📂</span>
              <p>Open a project folder</p>
              <p style={{ fontSize: "0.68rem", color: "#444" }}>⌘O to browse</p>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: "auto" }}>
              <FileTree
                entries={tree}
                activeFilePath={openFile?.path ?? null}
                onSelect={openTreeFile}
              />
            </div>
          )}
        </div>

        {/* Centre: editor */}
        <div className="dev-main">
          {openFile ? (
            <EditorPane
              file={openFile}
              onSave={saveFile}
              onChange={(content) =>
                setOpenFile((f) => (f ? { ...f, content, dirty: true } : f))
              }
            />
          ) : (
            <div className="dev-empty">
              <span style={{ fontSize: "2.5rem", opacity: 0.15 }}>{"</>"}</span>
              <p>Select a file to edit</p>
            </div>
          )}
        </div>

        {/* Right: preview + db viewer */}
        <div className="dev-right">
          <div className="dev-right-tabs">
            <button
              className={`dev-right-tab${
                bottomTab === "preview" ? " active" : ""
              }`}
              onClick={() => setBottomTab("preview")}
            >
              Preview
            </button>
            <button
              className={`dev-right-tab${bottomTab === "db" ? " active" : ""}`}
              onClick={() => setBottomTab("db")}
            >
              Database
            </button>
          </div>
          <div className="dev-right-pane">
            {bottomTab === "preview" ? (
              projectDir ? (
                <PreviewPane reloadKey={previewReloadKey} />
              ) : (
                <div className="dev-empty">
                  <span style={{ fontSize: "1.5rem", opacity: 0.3 }}>🌐</span>
                  <p>Open a project to preview</p>
                </div>
              )
            ) : (
              <DbViewer projectDir={projectDir} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
