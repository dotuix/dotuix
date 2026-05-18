// Persist state.db bytes in localStorage keyed by manifest id.
// The bytes are base64-encoded SQLite data from stateDb.export().

const PREFIX = "uix_state_";

export function storageKey(manifestId: string): string {
  return `${PREFIX}${manifestId}`;
}

export function loadState(manifestId: string): Uint8Array | null {
  try {
    const raw = localStorage.getItem(storageKey(manifestId));
    if (!raw) return null;
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function saveState(manifestId: string, bytes: Uint8Array): void {
  try {
    let binary = "";
    for (let i = 0; i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i]);
    localStorage.setItem(storageKey(manifestId), btoa(binary));
  } catch {
    // localStorage quota exceeded — silently ignore for M2
  }
}

export function clearState(manifestId: string): void {
  localStorage.removeItem(storageKey(manifestId));
}
