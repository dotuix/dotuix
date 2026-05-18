import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

type ViewerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; manifestName: string }
  | { status: "error"; message: string };

export default function App() {
  const [state, setState] = useState<ViewerState>({ status: "idle" });

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
