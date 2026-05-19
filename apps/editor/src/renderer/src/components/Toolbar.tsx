import React from "react";
import type { OpenFile } from "../App";

export type EditorMode = "dev" | "simple";

interface Props {
  projectDir: string | null;
  openFile: OpenFile | null;
  packing: boolean;
  status: string;
  mode: EditorMode;
  onOpenFolder: () => void;
  onPack: () => void;
  onRefreshTree: () => void;
  onModeChange: (m: EditorMode) => void;
}

export default function Toolbar({
  projectDir,
  openFile,
  packing,
  status,
  mode,
  onOpenFolder,
  onPack,
  onRefreshTree,
  onModeChange,
}: Props) {
  return (
    <header
      className="flex items-center gap-2 px-3 h-10 border-b border-[#2d2d2d] bg-surface-950 shrink-0"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* macOS traffic lights space */}
      <span className="w-16 shrink-0" />

      <span className="text-[#0ea5e9] font-bold text-sm tracking-tight select-none">
        dotuix editor
      </span>

      {/* Mode toggle */}
      <div
        className="flex items-center ml-2 rounded overflow-hidden border border-[#3a3a3a] text-xs"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <ModeBtn active={mode === "dev"} onClick={() => onModeChange("dev")}>
          Developer
        </ModeBtn>
        <ModeBtn
          active={mode === "simple"}
          onClick={() => onModeChange("simple")}
        >
          Simple
        </ModeBtn>
      </div>

      {/* Dev-mode actions */}
      {mode === "dev" && (
        <div
          className="flex items-center gap-1 ml-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <TbBtn onClick={onOpenFolder} title="Open folder (⌘O)">
            📂
          </TbBtn>
          {projectDir && (
            <>
              <TbBtn onClick={onRefreshTree} title="Refresh file tree">
                ↺
              </TbBtn>
              <TbBtn
                onClick={onPack}
                disabled={packing}
                title="Pack to .uix"
                primary
              >
                {packing ? "⏳ Packing…" : "▦ Pack .uix"}
              </TbBtn>
            </>
          )}
        </div>
      )}

      {/* File name + dirty indicator */}
      {mode === "dev" && openFile && (
        <span
          className="ml-3 text-xs text-[#858585]"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {openFile.name}
          {openFile.dirty && <span className="ml-1 text-[#e2a65e]">●</span>}
        </span>
      )}

      <div className="flex-1" />

      {/* Status */}
      {status && (
        <span
          className="text-xs text-[#858585] max-w-xs truncate"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {status}
        </span>
      )}
    </header>
  );
}

function ModeBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 font-medium transition-colors ${
        active
          ? "bg-[#0ea5e9] text-white"
          : "bg-[#1e1e1e] text-[#858585] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function TbBtn({
  children,
  onClick,
  disabled,
  title,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        primary
          ? "bg-[#0ea5e9] hover:bg-[#38bdf8] text-white"
          : "bg-[#2d2d2d] hover:bg-[#3a3a3a] text-[#ccc]"
      }`}
    >
      {children}
    </button>
  );
}
