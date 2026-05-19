import React, { useRef, useCallback } from "react";
import MonacoEditor, { type OnMount, type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type { OpenFile } from "../App";

interface Props {
  file: OpenFile;
  onSave: (content: string) => void;
  onChange: (content: string) => void;
}

const LANG_MAP: Record<string, string> = {
  html: "html",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  jsx: "javascript",
  css: "css",
  json: "json",
  md: "markdown",
  sql: "sql",
  txt: "plaintext",
  yaml: "yaml",
  yml: "yaml",
  sh: "shell",
  rs: "rust",
};

function detectLang(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return LANG_MAP[ext] ?? "plaintext";
}

export default function EditorPane({ file, onSave, onChange }: Props) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = useCallback(
    (ed, monaco) => {
      editorRef.current = ed;

      // Cmd/Ctrl+S → save
      ed.addCommand(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (monaco.KeyMod as any).CtrlCmd | (monaco.KeyCode as any).KeyS,
        () => {
          const value = ed.getValue();
          onSave(value);
        },
      );
    },
    [onSave],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full">
      {/* Tab bar */}
      <div className="flex items-center h-9 px-2 border-b border-[#2d2d2d] bg-surface-850 gap-2 shrink-0">
        <span className="text-xs text-[#ccc] truncate">{file.name}</span>
        {file.dirty && <span className="text-[10px] text-[#e2a65e]">●</span>}
      </div>

      {/* Monaco editor */}
      <div className="flex-1 min-h-0">
        <MonacoEditor
          key={file.path}
          height="100%"
          language={detectLang(file.name)}
          value={file.content}
          theme="vs-dark"
          onChange={(value) => onChange(value ?? "")}
          onMount={handleMount}
          options={{
            fontSize: 13,
            lineHeight: 20,
            fontFamily: "'JetBrains Mono', Menlo, 'Courier New', monospace",
            fontLigatures: true,
            wordWrap: "on",
            minimap: { enabled: true, scale: 1, showSlider: "mouseover" },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorSmoothCaretAnimation: "on",
            formatOnPaste: true,
            tabSize: 2,
            renderWhitespace: "selection",
            bracketPairColorization: { enabled: true },
            padding: { top: 8 },
          }}
        />
      </div>
    </div>
  );
}
