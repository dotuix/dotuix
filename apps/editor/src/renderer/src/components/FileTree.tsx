import React from 'react'
import type { DirEntry } from '../../../preload/index'

interface Props {
  entries: DirEntry[]
  activeFilePath: string | null
  onSelect: (entry: DirEntry) => void
  depth?: number
}

const FILE_ICONS: Record<string, string> = {
  html: '🌐',
  js: '⚡',
  mjs: '⚡',
  ts: '🔷',
  tsx: '🔷',
  css: '🎨',
  json: '{}',
  png: '🖼',
  jpg: '🖼',
  jpeg: '🖼',
  svg: '🔶',
  sql: '🗄',
  db: '🗄',
  md: '📝',
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return FILE_ICONS[ext] ?? '📄'
}

export default function FileTree({ entries, activeFilePath, onSelect, depth = 0 }: Props) {
  if (entries.length === 0) {
    return depth === 0 ? (
      <p className="px-3 py-2 text-[11px] text-[#555]">No files</p>
    ) : null
  }

  return (
    <ul>
      {entries.map((entry) => (
        <FileItem
          key={entry.path}
          entry={entry}
          activeFilePath={activeFilePath}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </ul>
  )
}

function FileItem({
  entry,
  activeFilePath,
  onSelect,
  depth,
}: {
  entry: DirEntry
  activeFilePath: string | null
  onSelect: (e: DirEntry) => void
  depth: number
}) {
  const [open, setOpen] = React.useState(depth < 1)
  const isActive = entry.path === activeFilePath
  const indent = depth * 12

  if (entry.isDir) {
    return (
      <li>
        <button
          className="w-full text-left flex items-center gap-1 px-2 py-[3px] hover:bg-[#2a2d2e] text-[#ccc] text-[12px]"
          style={{ paddingLeft: `${8 + indent}px` }}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="text-[10px] text-[#555]">{open ? '▾' : '▸'}</span>
          <span className="text-[11px]">📁</span>
          <span className="ml-1 truncate">{entry.name}</span>
        </button>
        {open && entry.children && entry.children.length > 0 && (
          <FileTree
            entries={entry.children}
            activeFilePath={activeFilePath}
            onSelect={onSelect}
            depth={depth + 1}
          />
        )}
      </li>
    )
  }

  return (
    <li>
      <button
        className={`w-full text-left flex items-center gap-1 px-2 py-[3px] text-[12px] truncate transition-colors ${
          isActive
            ? 'bg-[#094771] text-white'
            : 'hover:bg-[#2a2d2e] text-[#ccc]'
        }`}
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={() => onSelect(entry)}
        title={entry.path}
      >
        <span className="text-[11px] shrink-0">{fileIcon(entry.name)}</span>
        <span className="ml-1 truncate">{entry.name}</span>
      </button>
    </li>
  )
}
