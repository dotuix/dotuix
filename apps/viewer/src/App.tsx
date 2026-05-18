import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

type ViewerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; manifestName: string }
  | { status: "error"; message: string };

export default function App() {
  const [state, setState] = useState<ViewerState>({ status: "idle" });
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Relay postMessages from the uix:// iframe to Tauri commands and back.
  // The iframe is cross-origin so it cannot call window.__TAURI_INTERNALS__ directly.
  useEffect(() => {
    if (state.status !== "loaded") return;

    const handler = async (e: MessageEvent) => {
      if (!e.data?.__dotuix) return;
      const { id, cmd, payload } = e.data as {
        id: number;
        cmd: string;
        payload: Record<string, unknown>;
      };
      try {
        const result = await invoke(cmd, payload ?? {});
        iframeRef.current?.contentWindow?.postMessage(
          { __dotuix_reply: true, id, result },
          "*",
        );
      } catch (err) {
        iframeRef.current?.contentWindow?.postMessage(
          { __dotuix_reply: true, id, error: String(err) },
          "*",
        );
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [state.status]);

  const openFile = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const manifestJson = await invoke<string>("pick_and_load_uix");
      const manifest = JSON.parse(manifestJson) as { name?: string };
      setState({ status: "loaded", manifestName: manifest.name ?? "UIX App" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "No file selected") {
        setState({ status: "idle" });
      } else {
        setState({ status: "error", message: msg });
      }
    }
  }, []);

  const closeApp = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  if (state.status === "loaded") {
    return (
      <div className="kiosk-root">
        {/* Thin escape bar — hidden in production kiosk builds */}
        <div className="kiosk-bar">
          <span className="kiosk-title">{state.manifestName}</span>
          <button className="kiosk-close" onClick={closeApp}>
            ✕ Close app
          </button>
        </div>
        <iframe
          ref={iframeRef}
          src="uix://index.html"
          className="kiosk-frame"
          title={state.manifestName}
        />
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="drop-zone" onClick={openFile}>
        <div className="drop-icon">▦</div>
        <p className="drop-primary">Open a .uix app</p>
        <p className="drop-secondary">Click to browse or drag a file here</p>
        {state.status === "loading" && <p className="drop-loading">Loading…</p>}
        {state.status === "error" && (
          <p className="drop-error">{state.message}</p>
        )}
      </div>
    </div>
  );
}
