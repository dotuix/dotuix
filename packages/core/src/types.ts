export type Permission =
  | "local-storage"
  | "print"
  | "clipboard-write"
  | "fullscreen"
  | "raw-sql"
  | "local-sync";

export interface Manifest {
  /** Format version, e.g. "1.0" */
  uix: string;
  /** Reverse-domain identifier, e.g. "com.almadina.menu" */
  id: string;
  name: string;
  version: string;
  /** Minimum viewer version required to open this file */
  minViewer?: string;
  /** Path to the entry HTML file, relative to archive root */
  entry: string;
  mode: "kiosk" | "window";
  permissions?: Permission[];
  network?: "blocked" | "allowed";
  theme?: { color?: string; background?: string };
  author?: string;
  /** ISO-8601 date string after which the file should be considered expired */
  expires?: string | null;
  state?: { seed?: boolean };
  /** Reserved for v2 package signing (ed25519). Must be null in v1. */
  signature?: unknown | null;
}

export interface UIXRecord {
  id: string;
  type: string;
  /** Stringified JSON — use JSON.parse(record.body) to access fields */
  body: string;
  created_at: number;
  updated_at: number;
}

export interface ValidateResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
