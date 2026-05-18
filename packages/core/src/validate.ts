import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { safeParseManifest } from "./manifest.js";
import { unpackBuffer } from "./unpack.js";
import type { ValidateResult, Manifest } from "./types.js";

const decoder = new TextDecoder();

/**
 * Validate a `.uix` archive: structural integrity + manifest schema.
 * Offline-first URL / CDN import checks are added in Day 6–7.
 *
 * @param uixPath  Absolute path to the `.uix` file.
 */
export async function validate(uixPath: string): Promise<ValidateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Read ZIP from disk
  let data: Uint8Array;
  try {
    data = new Uint8Array(readFileSync(uixPath));
  } catch {
    return { valid: false, errors: [`Cannot read file: ${uixPath}`], warnings };
  }

  return validateBuffer(data);
}

/**
 * Validate a `.uix` buffer (universal, no file system required).
 */
export async function validateBuffer(
  data: Uint8Array,
): Promise<ValidateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Unzip
  let files: Record<string, Uint8Array>;
  try {
    files = unpackBuffer(data);
  } catch {
    return {
      valid: false,
      errors: ["Invalid ZIP archive — file may be corrupted"],
      warnings,
    };
  }

  // manifest.json must exist
  if (!files["manifest.json"]) {
    return {
      valid: false,
      errors: ["manifest.json not found in archive"],
      warnings,
    };
  }

  // Parse manifest
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(decoder.decode(files["manifest.json"]));
  } catch {
    return {
      valid: false,
      errors: ["manifest.json is not valid JSON"],
      warnings,
    };
  }

  const result = safeParseManifest(rawManifest);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      errors.push(`manifest.json — ${path}${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const manifest: Manifest = result.data;

  // Entry file must exist in archive
  if (!files[manifest.entry]) {
    errors.push(
      `Entry file "${manifest.entry}" declared in manifest.json is missing from archive`,
    );
  }

  // Check expiry
  if (manifest.expires) {
    const expires = new Date(manifest.expires);
    if (Number.isNaN(expires.getTime())) {
      warnings.push(
        `manifest.json — expires "${manifest.expires}" is not a valid date`,
      );
    } else if (expires < new Date()) {
      warnings.push(`File expired on ${manifest.expires}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
