import { useEffect, useRef, useCallback } from "react";
import type { UIXDataDB, UIXStateDB, Manifest } from "@dotuix/core";
import { createMessageHandler } from "../lib/bridge.js";
import { saveState } from "../lib/storage.js";

interface ViewerProps {
  iframeUrl: string;
  manifest: Manifest;
  dataDb: UIXDataDB | null;
  stateDb: UIXStateDB;
  blobUrls: string[];
  onClose: () => void;
}

export function Viewer({
  iframeUrl,
  manifest,
  dataDb,
  stateDb,
  blobUrls,
  onClose,
}: ViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Persist state to localStorage on every mutation
  const onStateChange = useCallback(() => {
    saveState(manifest.id, stateDb.export());
  }, [manifest.id, stateDb]);

  // Wire up the postMessage bridge
  useEffect(() => {
    const handler = createMessageHandler(iframeRef, {
      dataDb,
      stateDb,
      onStateChange,
    });
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [dataDb, stateDb, onStateChange]);

  // Save state + revoke blob URLs on unmount
  useEffect(() => {
    return () => {
      saveState(manifest.id, stateDb.export());
      stateDb.close();
      dataDb?.close();
      for (const url of blobUrls) URL.revokeObjectURL(url);
    };
  }, [manifest.id, stateDb, dataDb, blobUrls]);

  // Also save on page unload
  useEffect(() => {
    const save = () => saveState(manifest.id, stateDb.export());
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, [manifest.id, stateDb]);

  return (
    <div className="viewer-root">
      <div className="viewer-bar">
        <span className="viewer-bar-name">{manifest.name}</span>
        <button className="viewer-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={iframeUrl}
        className="viewer-frame"
        title={manifest.name}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
      />
    </div>
  );
}
