import React, { forwardRef, useImperativeHandle, useRef } from 'react'

interface Props {
  port: number | null
  reloadKey: number
}

export interface PreviewPaneHandle {
  reload: () => void
}

const PreviewPane = forwardRef<PreviewPaneHandle, Props>(({ port, reloadKey }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useImperativeHandle(ref, () => ({
    reload: () => {
      if (iframeRef.current) {
        // eslint-disable-next-line no-self-assign
        iframeRef.current.src = iframeRef.current.src
      }
    },
  }))

  if (!port) {
    return (
      <div className="h-full flex items-center justify-center text-[#555]">
        <div className="text-center">
          <p className="text-4xl mb-3 opacity-20">▨</p>
          <p className="text-sm">Open a project to see live preview</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Browser chrome bar */}
      <div className="flex items-center gap-2 px-3 h-8 border-b border-[#2d2d2d] bg-surface-850 shrink-0">
        <span className="text-[#555] text-[11px] truncate">
          http://127.0.0.1:{port}/
        </span>
        <button
          className="ml-auto text-[11px] text-[#858585] hover:text-[#ccc] transition-colors"
          onClick={() => {
            if (iframeRef.current) {
              // Changing key forces React to remount the iframe
            }
          }}
          title="Reload preview"
        >
          ↺
        </button>
      </div>
      <iframe
        key={`preview-${reloadKey}`}
        ref={iframeRef}
        src={`http://127.0.0.1:${port}/`}
        className="flex-1 border-0 bg-white"
        title="Live preview"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
      />
    </div>
  )
})

PreviewPane.displayName = 'PreviewPane'

export default PreviewPane
