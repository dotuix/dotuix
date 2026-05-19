import React from 'react'

interface Props {
  projectDir: string | null
}

export default function DbViewer({ projectDir: _ }: Props) {
  return (
    <div className="h-full flex items-center justify-center text-[#555]">
      <div className="text-center">
        <p className="text-4xl mb-3 opacity-20">🗄</p>
        <p className="text-sm font-medium text-[#666]">DB Viewer</p>
        <p className="text-xs mt-1 text-[#444]">Coming in M6.1</p>
      </div>
    </div>
  )
}
