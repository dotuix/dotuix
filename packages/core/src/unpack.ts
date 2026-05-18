import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { unzipSync } from "fflate";

/**
 * Unpack a `.uix` archive to a directory on disk.
 *
 * @param uixPath  Absolute path to the `.uix` file.
 * @param outDir   Absolute path to the output directory (created if absent).
 */
export async function unpack(uixPath: string, outDir: string): Promise<void> {
  let data: Uint8Array;
  try {
    data = new Uint8Array(readFileSync(uixPath));
  } catch {
    throw new Error(`Cannot read .uix file: ${uixPath}`);
  }

  const files = unpackBuffer(data);

  for (const [filename, content] of Object.entries(files)) {
    const outPath = join(outDir, filename);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, content);
  }
}

/**
 * Unpack a `.uix` buffer into an in-memory file map (universal, no file system required).
 *
 * The web viewer uses this after receiving a `.uix` from the browser File API:
 * ```ts
 * const buffer = await file.arrayBuffer();
 * const files = unpackBuffer(new Uint8Array(buffer));
 * const html = new TextDecoder().decode(files['index.html']);
 * ```
 *
 * @param data  Raw ZIP bytes.
 * @returns  Map of archive-root-relative paths to file contents.
 */
export function unpackBuffer(data: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(data);
  } catch (err) {
    throw new Error(`Failed to unpack .uix archive: ${(err as Error).message}`);
  }
}
