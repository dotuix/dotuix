import { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
}

function langForExt(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const MAP: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    css: "css",
    html: "html",
    htm: "html",
    json: "json",
    md: "markdown",
    sql: "sql",
    svg: "xml",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };
  return MAP[ext] ?? "plaintext";
}

interface Props {
  file: OpenFile;
  onSave: (content: string) => void;
  onChange: (content: string) => void;
}

export default function EditorPane({ file, onSave, onChange }: Props) {
  const latestContent = useRef(file.content);

  useEffect(() => {
    latestContent.current = file.content;
  }, [file.content]);

  return (
    <Editor
      key={file.path}
      height="100%"
      theme="vs-dark"
      language={langForExt(file.name)}
      defaultValue={file.content}
      onChange={(val) => {
        const v = val ?? "";
        latestContent.current = v;
        onChange(v);
      }}
      onMount={(editor) => {
        // Cmd/Ctrl+S → save
        editor.addCommand(
          // Monaco keybinding: Ctrl+S / Cmd+S
          2048 | 49, // KeyMod.CtrlCmd | KeyCode.KeyS
          () => onSave(latestContent.current),
        );
      }}
      options={{
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "off",
        tabSize: 2,
        renderWhitespace: "boundary",
        lineNumbers: "on",
        folding: true,
      }}
    />
  );
}
