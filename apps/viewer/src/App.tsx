import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import DbViewer from "./components/DbViewer";

function BrandIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3"
        y="3"
        width="8"
        height="8"
        rx="2"
        fill="#fff"
        opacity="0.95"
      />
      <rect
        x="13"
        y="3"
        width="8"
        height="8"
        rx="2"
        fill="#fff"
        opacity="0.95"
      />
      <rect
        x="3"
        y="13"
        width="8"
        height="8"
        rx="2"
        fill="#fff"
        opacity="0.95"
      />
      <rect
        x="13"
        y="13"
        width="8"
        height="8"
        rx="2"
        fill="#fff"
        opacity="0.45"
      />
    </svg>
  );
}

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="spinner"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

type LoadResult =
  | { status: "loaded"; manifest: string }
  | { status: "pin_required"; app_name: string; app_id: string }
  | {
      status: "license_required";
      app_name: string;
      app_id: string;
      device_id: string;
      uix_path: string;
    };

type Manifest = {
  name?: string;
  expires?: string | null;
  signature?: { algorithm: string };
};

type ViewerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "pin_required"; appName: string }
  | {
      status: "license_required";
      appName: string;
      appId: string;
      deviceId: string;
      uixPath: string;
    }
  | {
      status: "loaded";
      manifestName: string;
      expires?: string;
      signed: boolean;
    }
  | { status: "error"; message: string };

function handleLoadResult(result: LoadResult): ViewerState {
  if (result.status === "loaded") {
    const m = JSON.parse(result.manifest) as Manifest;
    return {
      status: "loaded",
      manifestName: m.name ?? "UIX App",
      expires: m.expires ?? undefined,
      signed: !!m.signature,
    };
  }
  if (result.status === "license_required") {
    return {
      status: "license_required",
      appName: result.app_name,
      appId: result.app_id,
      deviceId: result.device_id,
      uixPath: result.uix_path,
    };
  }
  return { status: "pin_required", appName: result.app_name };
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

export default function App() {
  const [state, setState] = useState<ViewerState>({ status: "idle" });
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [dbOpen, setDbOpen] = useState(false);
  const [dbDir, setDbDir] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ── Bridge: relay postMessages from the uix:// iframe to Tauri ──────────
  // useLayoutEffect fires before browser paint, so the listener is always
  // registered before the iframe's JS can execute and send postMessages.
  useLayoutEffect(() => {
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

  // ── Fetch state.db dir when a .uix is loaded ─────────────────────────────
  useEffect(() => {
    if (state.status === "loaded") {
      invoke<string | null>("get_state_db_dir").then(setDbDir).catch(() => {});
    } else {
      setDbDir(null);
      setDbOpen(false);
    }
  }, [state.status]);

  // ── File association: check if launched with a .uix path ─────────────────
  useEffect(() => {
    invoke<string | null>("get_initial_file").then((path) => {
      if (!path) return;
      setState({ status: "loading" });
      invoke<LoadResult>("load_uix", { path })
        .then((result) => setState(handleLoadResult(result)))
        .catch((err) => setState({ status: "error", message: String(err) }));
    });
  }, []);

  // ── Menu + file-drop events from Tauri ───────────────────────────────────
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    listen("menu-open-file", () => {
      const s = stateRef.current;
      if (s.status === "idle" || s.status === "error") {
        setState({ status: "loading" });
        invoke<LoadResult>("pick_and_load_uix")
          .then((r) => setState(handleLoadResult(r)))
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            setState(
              msg === "No file selected"
                ? { status: "idle" }
                : { status: "error", message: msg },
            );
          });
      }
    }).then((u) => unsubs.push(u));

    listen("menu-close-app", () => {
      if (stateRef.current.status === "loaded") {
        invoke("close_uix").catch(() => {});
        setState({ status: "idle" });
      }
    }).then((u) => unsubs.push(u));

    // Native file drag-drop (Tauri emits these automatically)
    listen<{ paths?: string[] }>("tauri://drag-drop", (event) => {
      const path = (event.payload.paths ?? []).find((p) => p.endsWith(".uix"));
      if (!path) return;
      setIsDragOver(false);
      setState({ status: "loading" });
      invoke<LoadResult>("load_uix", { path })
        .then((r) => setState(handleLoadResult(r)))
        .catch((err) => setState({ status: "error", message: String(err) }));
    }).then((u) => unsubs.push(u));

    listen("tauri://drag-enter", () => setIsDragOver(true)).then((u) =>
      unsubs.push(u),
    );
    listen("tauri://drag-leave", () => setIsDragOver(false)).then((u) =>
      unsubs.push(u),
    );

    // macOS file association: fired by RunEvent::Opened when a .uix is opened
    listen<string>("uix-file-opened", (event) => {
      setState({ status: "loading" });
      invoke<LoadResult>("load_uix", { path: event.payload })
        .then((r) => setState(handleLoadResult(r)))
        .catch((err) => setState({ status: "error", message: String(err) }));
    }).then((u) => unsubs.push(u));

    return () => unsubs.forEach((u) => u());
  }, []);

  const openFile = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await invoke<LoadResult>("pick_and_load_uix");
      setState(handleLoadResult(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState(
        msg === "No file selected"
          ? { status: "idle" }
          : { status: "error", message: msg },
      );
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

  const closeApp = useCallback(() => setState({ status: "idle" }), []);

  // ── ⌘O / Ctrl+O keyboard shortcut to open a file ────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        const s = stateRef.current;
        if (s.status === "idle" || s.status === "error") openFile();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openFile]);

  const toggleFullscreen = useCallback(
    () => invoke("toggle_fullscreen").catch(console.warn),
    [],
  );

  // ── Loaded: viewer with professional toolbar ─────────────────────────────
  if (state.status === "loaded") {
    const days = state.expires ? daysUntil(state.expires) : null;
    return (
      <div className="viewer-root">
        <div className="viewer-toolbar">
          <button
            className="toolbar-btn-home"
            onClick={closeApp}
            title="Close app (⌘W)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M7.5 2L4 6L7.5 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Home
          </button>
          <span className="toolbar-sep" />
          <span className="toolbar-title">{state.manifestName}</span>
          <div className="toolbar-badges">
            {state.signed && (
              <span className="badge badge--signed">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1 4L3 6L7 2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Signed
              </span>
            )}
            {days !== null && (
              <span
                className={`badge ${
                  days <= 7 ? "badge--expires-warn" : "badge--expires"
                }`}
              >
                {days > 0 ? `${days}d left` : "Expired"}
              </span>
            )}
          </div>
          <div className="toolbar-actions">
            <button
              className="toolbar-icon-btn"
              onClick={() => setDbOpen((o) => !o)}
              title="DB Viewer (diagnostics)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M3 5v14c0 1.657 4.03 3 9 3s9-1.343 9-3V5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M3 12c0 1.657 4.03 3 9 3s9-1.343 9-3" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </button>
            <button
              className="toolbar-icon-btn"
              onClick={toggleFullscreen}
              title="Full screen (Ctrl+⌘+F)"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path
                  d="M1 4V1H4M9 1H12V4M12 9V12H9M4 12H1V9"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
        <iframe
          ref={iframeRef}
          src="uix://localhost/index.html"
          className="viewer-frame"
          title={state.manifestName}
        />
        {dbOpen && (
          <div className="db-overlay">
            <div className="db-overlay-header">
              <span>DB Viewer</span>
              <button className="db-overlay-close" onClick={() => setDbOpen(false)}>✕</button>
            </div>
            <DbViewer projectDir={dbDir} />
          </div>
        )}
      </div>
    );
  }

  // ── License required ─────────────────────────────────────────────────────
  if (state.status === "license_required") {
    const { appName, appId, deviceId, uixPath } = state;
    return (
      <div className="shell">
        <div className="pin-card">
          <div className="pin-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <rect
                x="3"
                y="11"
                width="18"
                height="11"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <path
                d="M7 11V7a5 5 0 0 1 10 0v4"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
              <circle cx="12" cy="16.5" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <h2 className="pin-title">{appName}</h2>
          <p className="pin-desc">This app requires a valid license to run.</p>
          <div className="license-device">
            <span className="license-device-label">Your device ID</span>
            <code className="license-device-id">{deviceId}</code>
            <button
              className="license-copy-btn"
              onClick={() => navigator.clipboard.writeText(deviceId)}
            >
              Copy
            </button>
          </div>
          <button
            className="pin-submit"
            onClick={async () => {
              try {
                await invoke("pick_and_install_license", { app_id: appId });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg === "No file selected") return;
                setState({ status: "error", message: `License error: ${msg}` });
                return;
              }
              setState({ status: "loading" });
              try {
                const result = await invoke<LoadResult>("load_uix", {
                  path: uixPath,
                });
                setState(handleLoadResult(result));
              } catch (err) {
                setState({
                  status: "error",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          >
            Browse for .uixlicense…
          </button>
          <button
            className="pin-cancel"
            onClick={() => setState({ status: "idle" })}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── PIN dialog ───────────────────────────────────────────────────────────
  if (state.status === "pin_required") {
    return (
      <div className="shell">
        <div className="pin-card">
          <div className="pin-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <rect
                x="5"
                y="11"
                width="14"
                height="10"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <path
                d="M8 11V8a4 4 0 0 1 8 0v3"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h2 className="pin-title">{state.appName}</h2>
          <p className="pin-desc">Enter the PIN to open this app.</p>
          <input
            className="pin-input"
            type="password"
            inputMode="numeric"
            autoFocus
            placeholder="• • • •"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setPinError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitPin();
            }}
          />
          {pinError && <p className="pin-error">{pinError}</p>}
          <button className="pin-submit" onClick={submitPin}>
            Unlock
          </button>
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

  // ── Loading overlay ───────────────────────────────────────────────────────
  if (state.status === "loading") {
    return (
      <div className="shell">
        <div className="loading-overlay">
          <Spinner size={28} />
          <span className="loading-label">Opening…</span>
        </div>
      </div>
    );
  }

  // ── Home / idle / error ──────────────────────────────────────────────────
  return (
    <div className={`shell${isDragOver ? " shell--dragover" : ""}`}>
      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M12 3v12M7 11l5 5 5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 19h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span>Drop to open</span>
          </div>
        </div>
      )}
      <div className="home-wrap">
        <div className="brand">
          <div className="brand-icon">
            <BrandIcon />
          </div>
          <span className="brand-name">dotuix</span>
        </div>
        <p className="home-sub">The executable document format.</p>

        <div className="drop-zone">
          <svg
            className="drop-file-svg"
            width="38"
            height="38"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="14 2 14 8 20 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <button className="open-btn" onClick={openFile}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Open .uix file
          </button>
          <span className="drop-hint">or drag a .uix file here · ⌘O</span>
        </div>

        {state.status === "error" && (
          <div className="error-msg">
            <span>{state.message}</span>
            <button
              className="error-dismiss"
              onClick={() => setState({ status: "idle" })}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
