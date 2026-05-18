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
  signature: z.unknown().nullable().optional(),
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
