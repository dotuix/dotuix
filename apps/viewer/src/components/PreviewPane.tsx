interface Props {
  /** Increment to force the iframe to reload without remounting */
  reloadKey: number;
}

/**
 * Preview pane — uses the devpreview:// custom Tauri protocol.
 * The Rust handler reads files from the currently set preview directory.
 */
export default function PreviewPane({ reloadKey }: Props) {
  return (
    <iframe
      key={reloadKey}
      src="devpreview://localhost/index.html"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
        background: "#fff",
      }}
      title="Preview"
    />
  );
}
