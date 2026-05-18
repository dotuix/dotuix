import { readFileSync } from "node:fs";
import { unpackBuffer } from "./unpack.js";
import { parseManifest } from "./manifest.js";
import type { Manifest } from "./types.js";

const decoder = new TextDecoder();

/**
 * Read the manifest from a `.uix` archive on disk.
 *
 * @param uixPath  Absolute path to the `.uix` file.
 */
export async function readManifest(uixPath: string): Promise<Manifest> {
  const data = new Uint8Array(readFileSync(uixPath));
  return readManifestFromBuffer(data);
}

/**
 * Read the manifest from a `.uix` buffer (universal, no file system required).
 */
export function readManifestFromBuffer(data: Uint8Array): Manifest {
  const files = unpackBuffer(data);

  if (!files["manifest.json"]) {
    throw new Error("manifest.json not found in archive");
  }

  const raw = JSON.parse(decoder.decode(files["manifest.json"]));
  return parseManifest(raw);
}

// --- DB stub (implemented in Week 2) ---
// export async function openData(uixPath: string): Promise<SqlJsDatabase> { ... }
// export async function createState(uixPath: string): Promise<SqlJsDatabase> { ... }
