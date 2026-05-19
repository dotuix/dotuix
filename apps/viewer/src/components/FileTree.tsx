import { useState } from "react";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: DirEntry[];
}

interface Props {
  entries: DirEntry[];
  activeFilePath: string | null;
  onSelect: (entry: DirEntry) => void;
  depth?: number;
}

const FILE_ICONS: Record<string, string> = {
  html: "🌐",
  htm: "🌐",
  js: "🟨",
  mjs: "🟨",
  ts: "🔷",
  tsx: "🔷",
  jsx: "🟧",
  css: "🎨",
  json: "📋",
  svg: "🖼",
  png: "🖼",
  jpg: "🖼",
  jpeg: "🖼",
  gif: "🖼",
  md: "📝",
  txt: "📄",
  sql: "🗄",
  db: "🗄",
};

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? "📄";
}

export default function FileTree({
  entries,
  activeFilePath,
  onSelect,
  depth = 0,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : "12px" }}>
      {entries.map((entry) => {
        const isOpen = !collapsed[entry.path];
        return (
          <div key={entry.path}>
            <div
              className={`tree-item${entry.is_dir ? " is-dir" : ""}${
                activeFilePath === entry.path ? " active" : ""
              }`}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              onClick={() => {
                if (entry.is_dir) {
                  setCollapsed((p) => ({ ...p, [entry.path]: !p[entry.path] }));
                } else {
                  onSelect(entry);
                }
              }}
            >
              <span style={{ fontSize: "0.7rem" }}>
                {entry.is_dir ? (isOpen ? "▾" : "▸") : fileIcon(entry.name)}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {entry.name}
              </span>
            </div>
            {entry.is_dir &&
              isOpen &&
              entry.children &&
              entry.children.length > 0 && (
                <FileTree
                  entries={entry.children}
                  activeFilePath={activeFilePath}
                  onSelect={onSelect}
                  depth={depth + 1}
                />
              )}
          </div>
        );
      })}
    </div>
  );
}
