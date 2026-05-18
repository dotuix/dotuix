export { pack, packBuffer } from "./pack.js";
export { unpack, unpackBuffer } from "./unpack.js";
export { validate, validateBuffer } from "./validate.js";
export { readManifest, readManifestFromBuffer } from "./db.js";
export {
  parseManifest,
  safeParseManifest,
  ManifestSchema,
} from "./manifest.js";
export type {
  Manifest,
  UIXRecord,
  ValidateResult,
  Permission,
} from "./types.js";

import { pack, packBuffer } from "./pack.js";
import { unpack, unpackBuffer } from "./unpack.js";
import { validate, validateBuffer } from "./validate.js";
import { readManifest, readManifestFromBuffer } from "./db.js";

/**
 * The `UIX` namespace provides the primary API for working with `.uix` archives.
 *
 * ```ts
 * import { UIX } from '@dotuix/core';
 *
 * await UIX.pack('./my-app', './dist/myshop.uix');
 * await UIX.unpack('./myshop.uix', './extracted/');
 * const result = await UIX.validate('./myshop.uix');
 * const manifest = await UIX.manifest('./myshop.uix');
 * ```
 */
export const UIX = {
  /** Pack a source directory into a `.uix` archive (Node.js). */
  pack,
  /** Pack an in-memory file map into a `.uix` buffer (universal). */
  packBuffer,
  /** Unpack a `.uix` archive to a directory on disk (Node.js). */
  unpack,
  /** Unpack a `.uix` buffer into an in-memory file map (universal). */
  unpackBuffer,
  /** Validate a `.uix` file on disk (Node.js). */
  validate,
  /** Validate a `.uix` buffer (universal). */
  validateBuffer,
  /** Read the manifest from a `.uix` file on disk (Node.js). */
  manifest: readManifest,
  /** Read the manifest from a `.uix` buffer (universal). */
  manifestFromBuffer: readManifestFromBuffer,
} as const;
