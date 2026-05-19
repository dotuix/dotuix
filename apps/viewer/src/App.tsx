import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import DeveloperMode from "./components/DeveloperMode";

type LoadResult =
  | { status: "loaded"; manifest: string }
  | { status: "pin_required"; app_name: string; app_id: string };

type ViewerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "pin_required"; appName: string }
  | { status: "loaded"; manifestName: string }
  | { status: "developer" }
  | { status: "error"; message: string };

function handleLoadResult(result: LoadResult): ViewerState {
  if (result.status === "loaded") {
    const manifest = JSON.parse(result.manifest) as { name?: string };
    return { status: "loaded", manifestName: manifest.name ?? "UIX App" };
  }
  return { status: "pin_required", appName: result.app_name };
}

export default function App() {
  const [state, setState] = useState<ViewerState>({ status: "idle" });
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Relay postMessages from the uix:// iframe to Tauri commands and back.
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

  // On mount: check if the viewer was launched with a .uix path (file association).
  useEffect(() => {
    invoke<string | null>("get_initial_file").then((path) => {
      if (!path) return;
      setState({ status: "loading" });
      invoke<LoadResult>("load_uix", { path })
        .then((result) => setState(handleLoadResult(result)))
        .catch((err) => setState({ status: "error", message: String(err) }));
    });
  }, []);

  const openFile = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await invoke<LoadResult>("pick_and_load_uix");
      setState(handleLoadResult(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "No file selected") {
        setState({ status: "idle" });
      } else {
        setState({ status: "error", message: msg });
      }
    }
  }, []);

  const submitPin = useCallback(async () => {
    if (!pin.trim()) return;
    setPinError("");
    try {
      const result = await invoke<LoadResult>("unlock_with_pin", { pin });
      setPin("");
      setState(handleLoadResult(result));
    } catch (err) {
      setPinError(err instanceof Error ? err.message : String(err));
    }
  }, [pin]);

  const closeApp = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  if (state.status === "developer") {
    return <DeveloperMode onClose={closeApp} />;
  }

  if (state.status === "loaded") {
    return (
      <div className="kiosk-root">
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

  if (state.status === "pin_required") {
    return (
      <div className="shell">
        <div className="pin-box">
          <div className="drop-icon">🔒</div>
          <p className="drop-primary">{state.appName}</p>
          <p className="drop-secondary">
            This app is PIN-protected. Enter the PIN to open it.
          </p>
          <input
            className="pin-input"
            type="password"
            inputMode="numeric"
            autoFocus
            placeholder="Enter PIN"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setPinError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitPin();
            }}
          />
          <button className="pin-submit" onClick={submitPin}>
            Unlock
          </button>
          {pinError && <p className="drop-error">{pinError}</p>}
          <button
            className="pin-cancel"
            onClick={() => {
              setPin("");
              setPinError("");
              setState({ status: "idle" });
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="home-card">
        <div className="drop-icon">▦</div>
        <h1 className="drop-primary">dotuix</h1>
        <p className="drop-secondary">
          Open and run signed .uix apps, or build new ones.
        </p>

        <div className="home-buttons">
          <button
            className="home-btn home-btn-primary"
            onClick={openFile}
            disabled={state.status === "loading"}
          >
            {state.status === "loading" ? "Loading…" : "Open .uix file"}
          </button>
        </div>

        <button
          className="dev-mode-link"
          onClick={() => setState({ status: "developer" })}
        >
          Developer mode
        </button>

        {state.status === "error" && (
          <p className="drop-error">{state.message}</p>
        )}
      </div>
    </div>
  );
}
