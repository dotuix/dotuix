import { useRef, useState, useCallback } from "react";

interface DropZoneProps {
  onFile: (file: File) => void;
  loading: boolean;
  error: string | null;
}

export function DropZone({ onFile, loading, error }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
      e.target.value = "";
    },
    [onFile],
  );

  return (
    <div className="landing">
      <div className="brand">
        <span className="brand-dot">●</span>
        <span className="brand-name">dotuix</span>
        <span className="brand-tag">viewer</span>
      </div>

      <div
        className={`drop-zone${dragging ? " dragging" : ""}${
          loading ? " loading" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !loading && inputRef.current?.click()}
        role="button"
        aria-label="Drop a .uix file or click to browse"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".uix"
          onChange={handleChange}
          style={{ display: "none" }}
        />

        {loading ? (
          <div className="drop-inner">
            <div className="spinner" />
            <p className="drop-hint">Opening…</p>
          </div>
        ) : (
          <div className="drop-inner">
            <div className="drop-icon">
              <svg
                viewBox="0 0 48 48"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="6"
                  y="4"
                  width="36"
                  height="40"
                  rx="4"
                  stroke="currentColor"
                  strokeWidth="2.5"
                />
                <path
                  d="M14 16h20M14 24h20M14 32h12"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p className="drop-label">Drop a .uix file here</p>
            <p className="drop-hint">or</p>
            <button
              className="drop-browse-btn"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              Browse file…
            </button>
          </div>
        )}
      </div>

      {error && <p className="error-msg">{error}</p>}

      <p className="landing-footer">
        Files are opened locally — nothing is uploaded to any server.
      </p>
    </div>
  );
}
