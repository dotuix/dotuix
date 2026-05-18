import { useState, useCallback } from "react";
import type { Manifest, UIXDataDB, UIXStateDB } from "@dotuix/core";
import {
  unpackBuffer,
  readManifestFromBuffer,
  openDataBuffer,
  createState,
} from "@dotuix/core";
import { DropZone } from "./components/DropZone.js";
import { Viewer } from "./components/Viewer.js";
import { generateBridgeScript } from "./lib/bridge.js";
import { loadState } from "./lib/storage.js";

// ---------------------------------------------------------------------------
// MIME types for blob URL creation
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  wasm: "application/wasm",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  webm: "video/webm",
};

function getMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Build blob: URL map and inject bridge into entry HTML
// ---------------------------------------------------------------------------

function buildIframeUrl(
  files: Record<string, Uint8Array>,
  manifest: Manifest,
  bridgeScript: string,
): { url: string; allBlobUrls: string[] } {
  const allBlobUrls: string[] = [];
  const urlMap: Record<string, string> = {};

  // Create blob URLs for every non-HTML asset
  for (const [path, data] of Object.entries(files)) {
    if (path === "manifest.json" || path.endsWith(".db")) continue;
    if (path === manifest.entry) continue; // handle separately
    const blob = new Blob([data.buffer as ArrayBuffer], {
      type: getMime(path),
    });
    const blobUrl = URL.createObjectURL(blob);
    urlMap[path] = blobUrl;
    allBlobUrls.push(blobUrl);
  }

  // Get entry HTML, inject bridge, rewrite relative asset URLs
  const decoder = new TextDecoder();
  let html = decoder.decode(files[manifest.entry]);

  // Inject bridge before </head>
  html = html.replace(
    "</head>",
    `<script>\n${bridgeScript}\n</script>\n</head>`,
  );

  // Rewrite relative src/href/url() references to blob: URLs
  html = html.replace(
    /((?:src|href)\s*=\s*["'])([^"'#?][^"']*?)(["'])/g,
    (_match, prefix, val, suffix) => {
      if (/^(https?:|\/\/|data:|blob:|#|\/)/.test(val))
        return `${prefix}${val}${suffix}`;
      return `${prefix}${urlMap[val] ?? val}${suffix}`;
    },
  );

  const mainBlob = new Blob([html], { type: "text/html" });
  const mainUrl = URL.createObjectURL(mainBlob);
  allBlobUrls.push(mainUrl);

  return { url: mainUrl, allBlobUrls };
}

// ---------------------------------------------------------------------------
// App state machine
// ---------------------------------------------------------------------------

type Phase =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | {
      tag: "viewing";
      iframeUrl: string;
      manifest: Manifest;
      dataDb: UIXDataDB | null;
      stateDb: UIXStateDB;
      blobUrls: string[];
    };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ tag: "idle" });

  const handleFile = useCallback(async (file: File) => {
    setPhase({ tag: "loading" });
    try {
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);

      const files = unpackBuffer(data);
      const manifest = readManifestFromBuffer(data);
      const dataDb = await openDataBuffer(data, {
        permissions: manifest.permissions ?? [],
      });

      // Load saved state from localStorage, or use manifest seed, or fresh
      const savedState = loadState(manifest.id);
      const seed =
        savedState ?? (manifest.state?.seed ? files["state.db"] : undefined);

      const stateDb = await createState({
        uixVersion: manifest.uix,
        seed,
        permissions: manifest.permissions ?? [],
      });

      const bridgeScript = generateBridgeScript(manifest);
      const { url: iframeUrl, allBlobUrls } = buildIframeUrl(
        files,
        manifest,
        bridgeScript,
      );

      setPhase({
        tag: "viewing",
        iframeUrl,
        manifest,
        dataDb,
        stateDb,
        blobUrls: allBlobUrls,
      });
    } catch (err) {
      setPhase({ tag: "error", message: (err as Error).message });
    }
  }, []);

  const handleClose = useCallback(() => {
    setPhase({ tag: "idle" });
  }, []);

  if (phase.tag === "viewing") {
    return (
      <Viewer
        iframeUrl={phase.iframeUrl}
        manifest={phase.manifest}
        dataDb={phase.dataDb}
        stateDb={phase.stateDb}
        blobUrls={phase.blobUrls}
        onClose={handleClose}
      />
    );
  }

  return (
    <DropZone
      onFile={handleFile}
      loading={phase.tag === "loading"}
      error={phase.tag === "error" ? phase.message : null}
    />
  );
}
