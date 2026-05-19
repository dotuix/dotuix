import { z } from "zod";
import type { Manifest } from "./types.js";

const PermissionSchema = z.enum([
  "local-storage",
  "print",
  "clipboard-write",
  "fullscreen",
  "raw-sql",
  "local-sync",
]);

// ---------------------------------------------------------------------------
// Security sub-schema — all fields optional, no effect when omitted
// ---------------------------------------------------------------------------

const UIXSignatureSchema = z.object({
  algorithm: z.literal("Ed25519"),
  publicKey: z.string(),
  value: z.string(),
  signedAt: z.string(),
});

const UIXSecuritySchema = z
  .object({
    auth: z.enum(["none", "pin"]).optional().default("none"),
    encryptedPaths: z.array(z.string()).optional().default([]),
    kdf: z.literal("PBKDF2-SHA256").optional().default("PBKDF2-SHA256"),
    kdfIterations: z.number().int().positive().optional().default(200000),
    keySalt: z.string().optional(),
    maxOpens: z.number().int().positive().optional(),
    screenshot: z.boolean().optional().default(false),
  })
  .optional();

// ---------------------------------------------------------------------------
// Main manifest schema
// ---------------------------------------------------------------------------

export const ManifestSchema = z.object({
  uix: z.string({ required_error: "uix format version is required" }),
  id: z
    .string({ required_error: "id is required" })
    .regex(
      /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/,
      "id must be reverse-domain notation, e.g. com.almadina.menu",
    ),
  name: z.string({ required_error: "name is required" }),
  version: z.string({ required_error: "version is required" }),
  minViewer: z.string().optional(),
  entry: z.string({ required_error: "entry is required" }),
  mode: z.enum(["kiosk", "window"], {
    required_error: 'mode is required — must be "kiosk" or "window"',
  }),
  permissions: z.array(PermissionSchema).optional().default([]),
  network: z.enum(["blocked", "allowed"]).optional().default("blocked"),
  theme: z
    .object({
      color: z.string().optional(),
      background: z.string().optional(),
    })
    .optional(),
  author: z.string().optional(),
  expires: z.string().nullable().optional(),
  state: z
    .object({
      seed: z.boolean().optional().default(false),
    })
    .optional(),
  // Optional — omit entirely for regular apps (restaurant, shop, etc.)
  security: UIXSecuritySchema,
  // Optional — written by `dotuix sign`, verified by the viewer on load
  signature: UIXSignatureSchema.nullable().optional(),
});

export type ManifestInput = z.input<typeof ManifestSchema>;

/**
 * Parse and validate a raw manifest object. Throws a ZodError on invalid input.
 */
export function parseManifest(raw: unknown): Manifest {
  return ManifestSchema.parse(raw) as Manifest;
}

/**
 * Parse and validate without throwing. Check `result.success` before accessing `result.data`.
 */
export function safeParseManifest(
  raw: unknown,
): z.SafeParseReturnType<ManifestInput, Manifest> {
  return ManifestSchema.safeParse(raw) as z.SafeParseReturnType<
    ManifestInput,
    Manifest
  >;
}
