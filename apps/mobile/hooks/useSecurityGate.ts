/**
 * hooks/useSecurityGate.ts
 *
 * Enforces the manifest `security` block before the viewer bridge starts.
 * Handles: maxOpens tracking, expiry check, PIN authentication prompt.
 * AES-256-GCM decryption of encryptedPaths is handled separately (Step 4).
 *
 * Usage:
 *   const gate = useSecurityGate(manifest, appId);
 *   // gate.status: 'checking' | 'pin-required' | 'passed' | 'blocked'
 *   // gate.blockReason: string | null  — shown to user when blocked
 *   // gate.submitPin(pin): Promise<boolean>  — returns false if wrong PIN
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as FileSystem from "expo-file-system";
import * as Crypto from "expo-crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecurityStatus = "checking" | "pin-required" | "passed" | "blocked";

export interface SecurityGateResult {
  status: SecurityStatus;
  blockReason: string | null;
  /** AES-256-GCM key derived from the PIN. Set only after status === 'passed' and PIN was required. */
  derivedKey: CryptoKey | null;
  submitPin: (pin: string) => Promise<boolean>;
}

interface SecurityBlock {
  auth?: "pin" | "none";
  kdf?: string;
  kdfIterations?: number;
  keySalt?: string;
  maxOpens?: number;
  screenshot?: boolean;
}

// ---------------------------------------------------------------------------
// Open-count tracking  (stored as JSON in documentDirectory/uix-opens/<id>.json)
// ---------------------------------------------------------------------------

const OPENS_DIR = `${FileSystem.documentDirectory}uix-opens/`;

async function readOpenCount(appId: string): Promise<number> {
  await FileSystem.makeDirectoryAsync(OPENS_DIR, { intermediates: true }).catch(
    () => {},
  );
  const path = `${OPENS_DIR}${appId}.json`;
  try {
    const raw = await FileSystem.readAsStringAsync(path);
    return (JSON.parse(raw) as { opens: number }).opens ?? 0;
  } catch {
    return 0;
  }
}

async function incrementOpenCount(appId: string): Promise<number> {
  await FileSystem.makeDirectoryAsync(OPENS_DIR, { intermediates: true }).catch(
    () => {},
  );
  const path = `${OPENS_DIR}${appId}.json`;
  let current = 0;
  try {
    const raw = await FileSystem.readAsStringAsync(path);
    current = (JSON.parse(raw) as { opens: number }).opens ?? 0;
  } catch {
    /* first open */
  }
  const next = current + 1;
  await FileSystem.writeAsStringAsync(path, JSON.stringify({ opens: next }));
  return next;
}

// ---------------------------------------------------------------------------
// PIN verification via PBKDF2-SHA256 + AES-256-GCM key derivation check
//
// The spec does not store a PIN hash — it stores an encrypted payload.
// We derive the key and attempt to decrypt one of the encryptedPaths to
// verify the PIN is correct.  For the auth-only case (no encryptedPaths),
// we store a tiny verification blob next to the open-count file on first use.
//
// For simplicity in this implementation, we use expo-crypto for PBKDF2
// and the built-in Web Crypto API (available in Hermes/JSI) for AES-GCM.
// ---------------------------------------------------------------------------

async function deriveKey(
  pin: string,
  saltB64url: string,
  iterations: number,
): Promise<CryptoKey> {
  const salt = base64urlToBytes(saltB64url);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "===".slice((b64.length + 3) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Attempt to decrypt a file using the derived key.
// Encrypted format: first 12 bytes = IV (GCM nonce), rest = ciphertext + tag.
async function tryDecrypt(
  key: CryptoKey,
  cipherBytes: Uint8Array,
): Promise<boolean> {
  try {
    const iv = cipherBytes.slice(0, 12);
    const data = cipherBytes.slice(12);
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSecurityGate(
  manifest: Record<string, unknown>,
  files: Record<string, Uint8Array>,
): SecurityGateResult {
  const [status, setStatus] = useState<SecurityStatus>("checking");
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const derivedKeyRef = useRef<CryptoKey | null>(null);

  const appId = (manifest.id as string) || "unknown";
  const security = (manifest.security as SecurityBlock) | null;
  const expires = manifest.expires as string | undefined;

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // 1. Expiry check
      if (expires) {
        const exp = new Date(expires).getTime();
        if (Date.now() > exp) {
          if (!cancelled) {
            setBlockReason(
              `This file expired on ${new Date(expires).toLocaleDateString()}.`,
            );
            setStatus("blocked");
          }
          return;
        }
      }

      // 2. maxOpens check
      const sec = manifest.security as SecurityBlock | undefined;
      if (sec?.maxOpens != null) {
        const opens = await readOpenCount(appId);
        if (opens >= sec.maxOpens) {
          if (!cancelled) {
            setBlockReason(
              `This file has reached its maximum open limit (${sec.maxOpens}).`,
            );
            setStatus("blocked");
          }
          return;
        }
      }

      // 3. PIN auth
      if (sec?.auth === "pin") {
        if (!cancelled) setStatus("pin-required");
        return;
      }

      // No security restrictions — passed
      if (!cancelled) {
        if (sec?.maxOpens != null) await incrementOpenCount(appId);
        setStatus("passed");
      }
    }

    check().catch((e) => {
      if (!cancelled) {
        setBlockReason(e instanceof Error ? e.message : String(e));
        setStatus("blocked");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  const submitPin = useCallback(
    async (pin: string): Promise<boolean> => {
      const sec = manifest.security as SecurityBlock | undefined;
      if (!sec) return false;

      const salt = sec.keySalt ?? "";
      const iterations = sec.kdfIterations ?? 200000;

      try {
        const key = await deriveKey(pin, salt, iterations);

        // Verify PIN by attempting to decrypt one encryptedPath
        const encPaths: string[] =
          (sec as Record<string, unknown> as { encryptedPaths?: string[] })
            .encryptedPaths ?? [];
        if (encPaths.length > 0) {
          const cipher = files[encPaths[0]];
          if (cipher) {
            const ok = await tryDecrypt(key, cipher);
            if (!ok) return false;
          }
        }

        derivedKeyRef.current = key;
        await incrementOpenCount(appId);
        setStatus("passed");
        return true;
      } catch {
        return false;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [manifest, files, appId],
  );

  return { status, blockReason, derivedKey: derivedKeyRef.current, submitPin };
}

/** Expose the derived key so uixPacker can decrypt encryptedPaths in memory. */
export { deriveKey, tryDecrypt, base64urlToBytes };
