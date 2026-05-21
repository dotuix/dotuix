use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    http::{Request, Response},
    AppHandle, Emitter, Manager, State,
};

const VIEWER_VERSION: &str = "1.0.0";

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

struct AppState {
    /// Raw file bytes from the .uix archive, shared with the uix:// protocol handler.
    files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    /// Writable SQLite for cart / orders — persisted in $APP_DATA/<app-id>/state.db.
    state_db: Mutex<Option<rusqlite::Connection>>,
    /// Read-only SQLite for product data — opened from a temp copy of data.db in .uix.
    data_db: Mutex<Option<rusqlite::Connection>>,
    /// manifest.id of the currently loaded app.
    app_id: Mutex<String>,
    /// Absolute path to the open .uix file; used for repack-on-close and lock management.
    uix_path: Mutex<String>,
    /// Pre-computed path to state.db on disk; avoids needing AppHandle in close handler.
    state_db_path: Mutex<Option<std::path::PathBuf>>,
    /// Path to the .uix file set from argv on launch; consumed once by get_initial_file.
    initial_path: Mutex<Option<String>>,
    /// manifest.name of the currently loaded app; used to prefix dynamic window titles.
    app_name: Mutex<String>,
    /// manifest.permissions — gates raw-sql and other optional bridge capabilities.
    permissions: Mutex<Vec<String>>,
    /// manifest.state.mode — "file" (default, repack on close) or "device" (never repack).
    state_mode: Mutex<String>,
    /// Data schema version stored in state.db meta table; read on open, updated via schema_version_set.
    stored_schema_version: Arc<Mutex<u32>>,
    /// manifest.sync.endpoint — HTTPS URL of the sync server (None if not configured).
    sync_endpoint: Mutex<Option<String>>,
    /// manifest.sync.secret — base64 shared secret for the sync server.
    sync_secret: Mutex<Option<String>>,
    /// Files from the archive pending PIN-based decryption.
    pending_files: Mutex<Option<HashMap<String, Vec<u8>>>>,
    /// Parsed manifest pending completion after PIN unlock.
    pending_manifest: Mutex<Option<serde_json::Value>>,
    /// .uix path whose load is awaiting PIN entry.
    pending_path: Mutex<Option<String>>,

    /// Cached license payload for the currently open app; None when no license block or unlicensed.
    license_info: Mutex<Option<LicensePayload>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            files: Arc::new(Mutex::new(HashMap::new())),
            state_db: Mutex::new(None),
            data_db: Mutex::new(None),
            app_id: Mutex::new(String::new()),
            uix_path: Mutex::new(String::new()),
            state_db_path: Mutex::new(None),
            initial_path: Mutex::new(None),
            app_name: Mutex::new(String::new()),
            permissions: Mutex::new(Vec::new()),
            state_mode: Mutex::new("file".to_string()),
            stored_schema_version: Arc::new(Mutex::new(1)),
            sync_endpoint: Mutex::new(None),
            sync_secret: Mutex::new(None),
            pending_files: Mutex::new(None),
            pending_manifest: Mutex::new(None),
            pending_path: Mutex::new(None),
            license_info: Mutex::new(None),
        }
    }
}

// ---------------------------------------------------------------------------
// Load result — returned by load/probe commands
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum LoadResult {
    /// App loaded successfully; caller receives the serialised manifest JSON.
    Loaded { manifest: String },
    /// App requires a PIN; caller must show a PIN dialog and call unlock_with_pin.
    PinRequired { app_name: String, app_id: String },
    /// App requires a .uixlicense; caller must prompt the user to install one then retry.
    LicenseRequired { app_name: String, app_id: String, device_id: String, uix_path: String },
}

// ---------------------------------------------------------------------------
// Record type — mirrors the @dotuix/core `records` table schema
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct Record {
    id: String,
    #[serde(rename = "type")]
    r#type: String,
    body: String,
    created_at: i64,
    updated_at: i64,
}

/// Parsed payload section of a `.uixlicense` file.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct LicensePayload {
    #[serde(rename = "appId")]
    app_id: String,
    #[serde(rename = "issuedTo")]
    issued_to: String,
    #[serde(rename = "issuedAt")]
    issued_at: String,
    #[serde(rename = "expiresAt", default, skip_serializing_if = "Option::is_none")]
    expires_at: Option<String>,
    #[serde(default)]
    features: Vec<String>,
    #[serde(rename = "maxDevices", default, skip_serializing_if = "Option::is_none")]
    max_devices: Option<u32>,
    #[serde(rename = "deviceId", default, skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
}

/// On-disk format of a `.uixlicense` file: payload object + detached Ed25519 signature.
#[derive(serde::Deserialize)]
struct LicenseFile {
    payload: LicensePayload,
    signature: String,
}

/// Public license info returned to bridge callers via `uix.license.get()`.
#[derive(serde::Serialize, Clone)]
struct LicenseInfo {
    #[serde(rename = "issuedTo")]
    issued_to: String,
    #[serde(rename = "issuedAt")]
    issued_at: String,
    #[serde(rename = "expiresAt")]
    expires_at: Option<String>,
    features: Vec<String>,
    valid: bool,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Returns true if a process with the given PID is currently running.
/// On Unix we send signal 0 (no-op) — succeeds iff the process exists.
/// On Windows we open a handle with SYNCHRONIZE rights.
fn pid_is_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        const SYNCHRONIZE: u32 = 0x00100000;
        let handle = unsafe { windows_sys::Win32::System::Threading::OpenProcess(SYNCHRONIZE, 0, pid) };
        if handle == std::ptr::null_mut() { return false; }
        unsafe { windows_sys::Win32::Foundation::CloseHandle(handle) };
        true
    }
    #[cfg(not(any(unix, windows)))]
    { let _ = pid; false }
}

/// Parse the PID from a lock file written by this app: {"pid":12345,...}
fn lock_file_pid(lock_path: &str) -> Option<u32> {
    std::fs::read_to_string(lock_path).ok()
        .and_then(|s| s.split("\"pid\":").nth(1).map(str::to_string))
        .and_then(|s| s.split([',', '}']).next().map(str::to_string))
        .and_then(|s| s.trim().parse::<u32>().ok())
}

fn gen_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// MIME
// ---------------------------------------------------------------------------

fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs"   => "application/javascript",
        "css"           => "text/css",
        "json"          => "application/json",
        "png"           => "image/png",
        "jpg" | "jpeg"  => "image/jpeg",
        "gif"           => "image/gif",
        "svg"           => "image/svg+xml",
        "wasm"          => "application/wasm",
        "ico"           => "image/x-icon",
        "woff2"         => "font/woff2",
        "woff"          => "font/woff",
        _               => "application/octet-stream",
    }
}

// ---------------------------------------------------------------------------
// .uix loading helpers
// ---------------------------------------------------------------------------

fn read_uix(path: &str) -> Result<HashMap<String, Vec<u8>>, String> {
    let data = std::fs::read(path).map_err(|e| format!("Cannot read file: {e}"))?;
    let cursor = Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid ZIP: {e}"))?;
    let mut files = HashMap::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() { continue; }
        let name = entry.name().to_string();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        files.insert(name, buf);
    }
    Ok(files)
}

fn ensure_state_schema(conn: &rusqlite::Connection, app_id: &str) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS records (
            id          TEXT    PRIMARY KEY,
            type        TEXT    NOT NULL,
            body        TEXT    NOT NULL DEFAULT '{}',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS records_type_idx ON records(type);
        CREATE INDEX IF NOT EXISTS records_created_at_idx ON records(created_at);
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );",
    )
    .map_err(|e| e.to_string())?;

    // Enable WAL for better read concurrency; incremental auto-vacuum so freed
    // pages can be reclaimed via PRAGMA incremental_vacuum without a full VACUUM.
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA auto_vacuum = INCREMENTAL;")
        .map_err(|e| e.to_string())?;

    // Populate meta once; INSERT OR IGNORE is a no-op on subsequent opens.
    conn.execute_batch(&format!(
        "INSERT OR IGNORE INTO meta VALUES ('schema_version', '1');
         INSERT OR IGNORE INTO meta VALUES ('uix_version',    '1.0');
         INSERT OR IGNORE INTO meta VALUES ('app_id',         '{}');",
        app_id.replace('\'', "''")
    ))
    .map_err(|e| e.to_string())?;

    // Ensure a stable per-device UUID exists (generated once on first open, never changed).
    let has_device: bool = conn
        .query_row("SELECT COUNT(*) FROM meta WHERE key = 'device_id'", [], |r| r.get::<_, i64>(0))
        .map(|n| n > 0)
        .unwrap_or(false);
    if !has_device {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute("INSERT INTO meta (key, value) VALUES ('device_id', ?1)", [&id])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Compare semver strings: returns true if v1 >= v2.
fn version_gte(v1: &str, v2: &str) -> bool {
    let parse = |v: &str| -> (u32, u32, u32) {
        let mut p = v.splitn(3, '.').map(|s| s.parse::<u32>().unwrap_or(0));
        (p.next().unwrap_or(0), p.next().unwrap_or(0), p.next().unwrap_or(0))
    };
    parse(v1) >= parse(v2)
}

/// Compute today as an ISO YYYY-MM-DD string (no external crate needed).
fn today_iso() -> String {
    let mut remaining = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut year = 1970u32;
    loop {
        let days = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) { 366u64 } else { 365 };
        let secs = days * 86400;
        if remaining < secs { break; }
        remaining -= secs;
        year += 1;
    }

    let is_leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let dim: [u32; 13] = [0, 31, if is_leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1u32;
    let mut day = (remaining / 86400) as u32;
    for m in 1..=12u32 {
        if day < dim[m as usize] { month = m; break; }
        day -= dim[m as usize];
    }
    format!("{:04}-{:02}-{:02}", year, month, day + 1)
}

/// Parse a human-readable duration ("30d", "12h", "1y") into seconds.
fn parse_duration(s: &str) -> Result<u64, String> {
    if s.len() < 2 {
        return Err(format!("Invalid duration: '{s}'. Use e.g. 30d, 12h, 1y."));
    }
    let (num_str, unit) = s.split_at(s.len() - 1);
    let n: u64 = num_str.parse().map_err(|_| format!("Invalid duration number: '{num_str}'"))?;
    match unit {
        "s" => Ok(n),
        "m" => Ok(n * 60),
        "h" => Ok(n * 3_600),
        "d" => Ok(n * 86_400),
        "y" => Ok(n * 86_400 * 365),
        _   => Err(format!("Unknown duration unit '{unit}'. Use s, m, h, d, or y.")),
    }
}

// ---------------------------------------------------------------------------
// Crypto helpers — signature verification and AES-256-GCM decryption
// ---------------------------------------------------------------------------

/// Recursively sort JSON object keys (needed for canonical signature payload).
fn sort_json_keys(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut sorted = serde_json::Map::new();
            let mut keys: Vec<String> = map.keys().cloned().collect();
            keys.sort();
            for k in keys {
                sorted.insert(k.clone(), sort_json_keys(map[&k].clone()));
            }
            serde_json::Value::Object(sorted)
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(sort_json_keys).collect())
        }
        other => other,
    }
}

/// SHA-256 of `data` returned as lowercase hex.
fn sha256_hex(data: &[u8]) -> String {
    use sha2::Digest;
    let hash = sha2::Sha256::digest(data);
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

/// Format a UNIX timestamp (seconds since epoch) as an ISO-8601 UTC string.
/// Uses the civil_from_days algorithm — Howard Hinnant (date_algorithms.html).
fn format_iso8601(secs: u64) -> String {
    let sec = (secs % 60) as i64;
    let min = ((secs / 60) % 60) as i64;
    let hour = ((secs / 3600) % 24) as i64;
    let z = (secs / 86400) as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}Z")
}

/// Decode a base64url (no-padding) string to bytes.
fn base64_url_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s)
        .map_err(|e| format!("base64url decode error: {e}"))
}

/// Verify the `signature` block of a manifest against the archive files.
/// Returns `Ok(())` when absent (unsigned) or when the signature is valid.
/// Returns `Err(msg)` when the signature is present but invalid.
fn verify_signature(files: &HashMap<String, Vec<u8>>, manifest: &serde_json::Value) -> Result<(), String> {
    let sig_obj = match manifest.get("signature") {
        Some(v) if !v.is_null() => v,
        _ => return Ok(()), // unsigned — allowed
    };

    let algorithm = sig_obj.get("algorithm").and_then(|v| v.as_str()).unwrap_or("");
    if algorithm != "Ed25519" {
        return Err(format!("Unsupported signature algorithm: '{algorithm}'"));
    }

    let pub_key_b64 = sig_obj.get("publicKey").and_then(|v| v.as_str())
        .ok_or("signature.publicKey missing")?;
    let sig_val_b64 = sig_obj.get("value").and_then(|v| v.as_str())
        .ok_or("signature.value missing")?;

    let pub_key_bytes = base64_url_decode(pub_key_b64)
        .map_err(|e| format!("signature.publicKey: {e}"))?;
    let sig_bytes = base64_url_decode(sig_val_b64)
        .map_err(|e| format!("signature.value: {e}"))?;

    // Rebuild the canonical payload — must match @dotuix/core sign.ts exactly.
    let mut manifest_clone = manifest.clone();
    if let Some(obj) = manifest_clone.as_object_mut() { obj.remove("signature"); }
    let sorted_manifest = sort_json_keys(manifest_clone);
    let manifest_canon = serde_json::to_string(&sorted_manifest).map_err(|e| e.to_string())?;

    let mut paths: Vec<&str> = files.keys()
        .filter(|p| *p != "manifest.json" && *p != "state.db")
        .map(String::as_str)
        .collect();
    paths.sort_unstable();

    let mut payload = format!("DOTUIX-SIGN-V1\nmanifest:{manifest_canon}\n");
    for p in &paths {
        payload.push_str(&format!("file:{p}:{}\n", sha256_hex(&files[*p])));
    }

    use ed25519_dalek::{Signature, VerifyingKey, Verifier};
    let key_arr: [u8; 32] = pub_key_bytes.try_into()
        .map_err(|_| "signature.publicKey must be 32 bytes".to_string())?;
    let sig_arr: [u8; 64] = sig_bytes.try_into()
        .map_err(|_| "signature.value must be 64 bytes".to_string())?;
    let vk = VerifyingKey::from_bytes(&key_arr)
        .map_err(|e| format!("Invalid Ed25519 public key: {e}"))?;

    vk.verify(payload.as_bytes(), &Signature::from_bytes(&sig_arr))
        .map_err(|_| "Signature verification failed — file may have been tampered with.".to_string())
}

/// Derive a 32-byte AES-256 key from a PIN using PBKDF2-HMAC-SHA256.
fn derive_aes_key(pin: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    use pbkdf2::pbkdf2_hmac;
    let mut key = [0u8; 32];
    pbkdf2_hmac::<sha2::Sha256>(pin.as_bytes(), salt, iterations, &mut key);
    key
}

/// Decrypt a single file encrypted with AES-256-GCM.
/// Expected layout: `[12-byte nonce][ciphertext][16-byte GCM auth tag]`
fn decrypt_aes_gcm(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    if data.len() < 29 {
        return Err("Encrypted file is too short".into());
    }
    let (nonce_bytes, ct_with_tag) = data.split_at(12);
    use aes_gcm::{Aes256Gcm, Key, Nonce, aead::{Aead, KeyInit}};
    let k = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(k);
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct_with_tag)
        .map_err(|_| "Decryption failed — wrong PIN or corrupted file.".to_string())
}

/// Read the stored open count for an app-id data directory.
fn read_open_count(data_dir: &std::path::Path) -> u64 {
    std::fs::read_to_string(data_dir.join("opens"))
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// Increment and persist the open count; returns the new value.
fn increment_open_count(data_dir: &std::path::Path) -> u64 {
    let n = read_open_count(data_dir) + 1;
    let _ = std::fs::write(data_dir.join("opens"), n.to_string());
    n
}

// ---------------------------------------------------------------------------
// License helpers
// ---------------------------------------------------------------------------

/// Get or create a stable per-device UUID stored at `$APP_DATA/device_id`.
fn ensure_global_device_id(app: &AppHandle) -> String {
    let Ok(base) = app.path().app_data_dir() else {
        return uuid::Uuid::new_v4().to_string();
    };
    let id_file = base.join("device_id");
    if let Ok(id) = std::fs::read_to_string(&id_file) {
        let trimmed = id.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    let new_id = uuid::Uuid::new_v4().to_string();
    let _ = std::fs::create_dir_all(&base);
    let _ = std::fs::write(&id_file, &new_id);
    new_id
}

/// Attempt to load and verify the `.uixlicense` file stored in `app_data_dir`.
/// Returns `Some(payload)` only when the file exists, the signature is valid,
/// the appId matches, the license has not expired, and (if device-bound) the
/// device ID matches.  All failures return `None` without leaking details.
fn verify_and_load_license(
    app_data_dir: &std::path::Path,
    app_id: &str,
    publisher_key_str: &str,
    device_id: &str,
) -> Option<LicensePayload> {
    let data = std::fs::read_to_string(app_data_dir.join("license.uixlicense")).ok()?;
    let lf: LicenseFile = serde_json::from_str(&data).ok()?;

    // AppId must match the manifest
    if lf.payload.app_id != app_id { return None; }

    // Expiry — treat missing expiresAt as perpetual
    if let Some(ref exp) = lf.payload.expires_at {
        if exp.as_str() < today_iso().as_str() { return None; }
    }

    // Device binding — if deviceId is set (non-empty) it must match this device
    if let Some(ref lic_device) = lf.payload.device_id {
        if !lic_device.is_empty() && lic_device != device_id { return None; }
    }

    // Signature verification over sorted canonical JSON of the payload
    let key_b64 = publisher_key_str.strip_prefix("ed25519:").unwrap_or(publisher_key_str);
    let key_bytes = base64_url_decode(key_b64).ok()?;
    let sig_bytes = base64_url_decode(&lf.signature).ok()?;

    let payload_val = serde_json::to_value(&lf.payload).ok()?;
    let sorted = sort_json_keys(payload_val);
    let payload_canon = serde_json::to_string(&sorted).ok()?;
    let msg = format!("DOTUIX-LICENSE-V1\n{payload_canon}");

    use ed25519_dalek::{Signature, VerifyingKey, Verifier};
    let key_arr: [u8; 32] = key_bytes.try_into().ok()?;
    let sig_arr: [u8; 64] = sig_bytes.try_into().ok()?;
    let vk = VerifyingKey::from_bytes(&key_arr).ok()?;
    vk.verify(msg.as_bytes(), &Signature::from_bytes(&sig_arr)).ok()?;

    Some(lf.payload)
}

// ---------------------------------------------------------------------------
// .uix loading — two-phase: probe (validate + optional PIN gate) + complete
// ---------------------------------------------------------------------------

/// Phase 1: read the archive, run all validation checks, verify signature.
/// If the manifest requires a PIN, save the raw files to `AppState.pending_*`
/// and return `LoadResult::PinRequired`. Otherwise call `complete_load`.
fn probe_uix_inner(path: &str, app: &AppHandle, state: &AppState) -> Result<LoadResult, String> {
    let files = read_uix(path)?;

    let manifest_bytes = files
        .get("manifest.json")
        .ok_or_else(|| "manifest.json not found in archive".to_string())?;
    let manifest_json = String::from_utf8_lossy(manifest_bytes).into_owned();
    let manifest: serde_json::Value = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("Invalid manifest.json: {e}"))?;

    // --- Expiry check ---
    if let Some(exp) = manifest.get("expires").and_then(|v| v.as_str()) {
        if exp < today_iso().as_str() {
            return Err(format!("This .uix file expired on {exp}. It can no longer be opened."));
        }
    }

    // --- minViewer check ---
    if let Some(min_ver) = manifest.get("minViewer").and_then(|v| v.as_str()) {
        if !version_gte(VIEWER_VERSION, min_ver) {
            return Err(format!(
                "This file requires viewer v{min_ver} or later. Current viewer: v{VIEWER_VERSION}."
            ));
        }
    }

    // --- Signature verification ---
    verify_signature(&files, &manifest)?;

    // --- maxOpens check ---
    let app_id = manifest["id"].as_str().unwrap_or("unknown").to_string();
    let app_name = manifest.get("name").and_then(|v| v.as_str()).unwrap_or(&app_id).to_string();

    if let Some(max_opens) = manifest
        .get("security").and_then(|s| s.get("maxOpens")).and_then(|v| v.as_u64())
    {
        let data_dir = app
            .path().app_data_dir()
            .map_err(|e| format!("Cannot get app data dir: {e}"))?.join(&app_id);
        let _ = std::fs::create_dir_all(&data_dir);
        if read_open_count(&data_dir) >= max_opens {
            return Err(format!(
                "This .uix file has reached its maximum number of opens ({max_opens})."
            ));
        }
    }

    // --- PIN gate ---
    let security = manifest.get("security");
    let requires_pin = security
        .and_then(|s| s.get("auth")).and_then(|v| v.as_str()) == Some("pin");
    let has_encrypted_paths = security
        .and_then(|s| s.get("encryptedPaths")).and_then(|v| v.as_array())
        .map(|a| !a.is_empty()).unwrap_or(false);

    if requires_pin && has_encrypted_paths {
        *state.pending_files.lock().unwrap() = Some(files);
        *state.pending_manifest.lock().unwrap() = Some(manifest);
        *state.pending_path.lock().unwrap() = Some(path.to_string());
        return Ok(LoadResult::PinRequired { app_name, app_id });
    }

    complete_load(path, files, &manifest, app, state)
}

/// Phase 2: create the lock, set up databases, store everything in AppState.
fn complete_load(
    path: &str,
    files: HashMap<String, Vec<u8>>,
    manifest: &serde_json::Value,
    app: &AppHandle,
    state: &AppState,
) -> Result<LoadResult, String> {
    let manifest_json = serde_json::to_string(manifest).map_err(|e| e.to_string())?;
    let app_id = manifest["id"].as_str().unwrap_or("unknown").to_string();
    let app_name = manifest.get("name").and_then(|v| v.as_str()).unwrap_or(&app_id).to_string();

    let permissions: Vec<String> = manifest
        .get("permissions").and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    // --- Close any previously open file first ---
    {
        let prev_path = state.uix_path.lock().unwrap().clone();
        if !prev_path.is_empty() && prev_path != path {
            let prev_state_db_path = state.state_db_path.lock().unwrap().clone();
            let prev_mode = state.state_mode.lock().unwrap().clone();
            { let _ = state.state_db.lock().unwrap().take(); }
            { let _ = state.data_db.lock().unwrap().take(); }
            if prev_mode != "device" {
                if let Some(db_path) = prev_state_db_path {
                    if db_path.exists() { let _ = repack_uix(&prev_path, &db_path); }
                }
            }
            let _ = std::fs::remove_file(format!("{prev_path}.lock"));
        }
    }

    // --- Per-app data directory (created early — needed for license file lookup) ---
    let data_dir = app
        .path().app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {e}"))?.join(&app_id);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    // --- License check (before lock + DB setup) ---
    let license_required = manifest
        .get("license").and_then(|l| l.get("required")).and_then(|v| v.as_bool())
        .unwrap_or(false);
    let publisher_key = manifest
        .get("license").and_then(|l| l.get("publisherKey")).and_then(|v| v.as_str())
        .map(str::to_string);
    let device_id = ensure_global_device_id(app);
    let license_payload: Option<LicensePayload> = publisher_key
        .as_deref()
        .and_then(|key| verify_and_load_license(&data_dir, &app_id, key, &device_id));
    if license_required && license_payload.is_none() {
        // Clear the stale uix_path so a subsequent open works cleanly.
        *state.uix_path.lock().unwrap() = String::new();
        return Ok(LoadResult::LicenseRequired {
            app_name,
            app_id,
            device_id,
            uix_path: path.to_string(),
        });
    }

    // --- Lock file ---
    let lock_path = format!("{path}.lock");
    if std::path::Path::new(&lock_path).exists() {
        let owner_running = lock_file_pid(&lock_path)
            .map(pid_is_running)
            .unwrap_or(false);
        if owner_running {
            return Err("This file is already open in another window.".into());
        }
        // Stale lock (crashed or force-quit) — remove and continue.
        let _ = std::fs::remove_file(&lock_path);
    }
    std::fs::write(&lock_path, format!("{{\"pid\":{},\"opened_at\":{}}}", std::process::id(), now_ms()).as_bytes())
        .map_err(|e| format!("Cannot create lock file: {e}"))?;

    // --- state.db ---
    let state_db_path = data_dir.join("state.db");
    let should_seed = manifest
        .get("state").and_then(|s| s.get("seed")).and_then(|v| v.as_bool()).unwrap_or(false);
    if !state_db_path.exists() && should_seed {
        if let Some(seed) = files.get("state.db") {
            std::fs::write(&state_db_path, seed).map_err(|e| e.to_string())?;
            // Save the original seed as a permanent backup (never overwritten).
            // state_reset() uses this to restore the app to its shipped state.
            let seed_backup = data_dir.join("state_seed.db");
            if !seed_backup.exists() {
                let _ = std::fs::write(&seed_backup, seed);
            }
        }
    }
    let state_conn = rusqlite::Connection::open(&state_db_path)
        .map_err(|e| format!("Cannot open state.db: {e}"))?;
    ensure_state_schema(&state_conn, &app_id)?;
    let stored_schema_version: u32 = state_conn
        .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |r| r.get::<_, String>(0))
        .map(|s| s.parse::<u32>().unwrap_or(1))
        .unwrap_or(1);

    // --- data.db (read-only copy) ---
    let data_conn = if let Some(bytes) = files.get("data.db") {
        let tmp = std::env::temp_dir().join(format!("dotuix_{app_id}_data.db"));
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        Some(rusqlite::Connection::open_with_flags(&tmp, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Cannot open data.db: {e}"))?)
    } else {
        None
    };

    // --- Increment opens counter ---
    increment_open_count(&data_dir);

    // --- Commit to AppState ---
    *state.files.lock().unwrap() = files;
    *state.state_db.lock().unwrap() = Some(state_conn);
    *state.data_db.lock().unwrap() = data_conn;
    *state.app_id.lock().unwrap() = app_id;
    *state.app_name.lock().unwrap() = app_name;
    *state.uix_path.lock().unwrap() = path.to_string();
    *state.state_db_path.lock().unwrap() = Some(state_db_path);
    *state.permissions.lock().unwrap() = permissions;
    *state.state_mode.lock().unwrap() = manifest
        .get("state").and_then(|s| s.get("mode")).and_then(|v| v.as_str())
        .unwrap_or("file").to_string();
    *state.stored_schema_version.lock().unwrap() = stored_schema_version;
    *state.sync_endpoint.lock().unwrap() = manifest
        .get("sync").and_then(|s| s.get("endpoint")).and_then(|v| v.as_str())
        .map(str::to_string);
    *state.sync_secret.lock().unwrap() = manifest
        .get("sync").and_then(|s| s.get("secret")).and_then(|v| v.as_str())
        .map(str::to_string);
    *state.license_info.lock().unwrap() = license_payload;

    Ok(LoadResult::Loaded { manifest: manifest_json })
}

// ---------------------------------------------------------------------------
// Repack: write state.db back into the .uix file (atomic write)
//
// 1. Read original .uix → raw-copy every entry except state.db → add fresh state.db
// 2. Write to <path>.tmp
// 3. Rename original → <path>.bak (keep 1 rolling backup)
// 4. Rename .tmp → original  (OS-atomic on same filesystem)
// ---------------------------------------------------------------------------

fn repack_uix(uix_path: &str, state_db_path: &std::path::Path) -> Result<(), String> {
    let state_db_bytes = std::fs::read(state_db_path)
        .map_err(|e| format!("Cannot read state.db for repack: {e}"))?;

    let original = std::fs::read(uix_path)
        .map_err(|e| format!("Cannot read .uix for repack: {e}"))?;

    let tmp_path = format!("{uix_path}.tmp");
    let tmp_file = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("Cannot create .tmp: {e}"))?;
    let mut writer = zip::ZipWriter::new(tmp_file);

    let mut archive = zip::ZipArchive::new(Cursor::new(original))
        .map_err(|e| format!("Repack: invalid ZIP: {e}"))?;

    for i in 0..archive.len() {
        let entry = archive.by_index_raw(i)
            .map_err(|e| format!("Repack: cannot read entry {i}: {e}"))?;
        if entry.name() == "state.db" {
            continue; // will be replaced below
        }
        writer.raw_copy_file(entry)
            .map_err(|e| format!("Repack: raw copy failed: {e}"))?;
    }

    // Add current state.db with STORE compression (SQLite binary is not compressible).
    writer
        .start_file(
            "state.db",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .map_err(|e| format!("Repack: cannot start state.db entry: {e}"))?;
    writer
        .write_all(&state_db_bytes)
        .map_err(|e| format!("Repack: write state.db failed: {e}"))?;

    writer.finish().map_err(|e| format!("Repack: finish failed: {e}"))?;

    // Atomic rename sequence
    let bak_path = format!("{uix_path}.bak");
    let _ = std::fs::rename(uix_path, &bak_path); // temporary backup during swap
    std::fs::rename(&tmp_path, uix_path)
        .map_err(|e| format!("Repack: atomic rename failed: {e}"))?;
    // New file written successfully — remove the backup
    let _ = std::fs::remove_file(&bak_path);

    Ok(())
}

// ---------------------------------------------------------------------------
// Bridge script injected into every .uix HTML page
//
// The iframe at uix:// is cross-origin from the Tauri shell (tauri://localhost),
// so it cannot call window.__TAURI_INTERNALS__ directly.  Instead we use a
// postMessage relay: iframe -> parent shell -> invoke() -> Rust -> reply back.
// ---------------------------------------------------------------------------

fn bridge_script(manifest_json: &str, stored_schema_version: u32) -> String {
    let viewer_version = VIEWER_VERSION;
    format!(
        r#"<script>
(function () {{
  var m = {manifest_json};
  var _viewer_version = "{viewer_version}";
  var _storedSchemaVersion = {stored_schema_version};
  var _currentSchemaVersion = (m.schemaVersion || 1);
  var _perms = (m.permissions || []);
  var _seq = 0;
  var _pending = {{}};

  function relay(cmd, payload) {{
    return new Promise(function (resolve, reject) {{
      var id = ++_seq;
      _pending[id] = {{ resolve: resolve, reject: reject }};
      parent.postMessage({{ __dotuix: true, id: id, cmd: cmd, payload: payload || {{}} }}, '*');
    }});
  }}

  window.addEventListener('message', function (e) {{
    var d = e.data;
    if (!d || !d.__dotuix_reply) return;
    var p = _pending[d.id];
    if (!p) return;
    delete _pending[d.id];
    if (d.error) p.reject(new Error(d.error));
    else p.resolve(d.result);
  }});

  window.__uix = {{
    manifest: function() {{ return m; }},
    data: {{

      find: function (opts) {{
        var q = (typeof opts === 'string') ? {{ type: opts }} : Object.assign({{}}, opts);
        return relay('data_find', {{ query: q }});
      }},
      get:  function (id)              {{ return relay('data_get',  {{ id: id }}); }},
      count: function (opts)            {{
        var q = (typeof opts === 'string') ? {{ type: opts }} : Object.assign({{}}, opts);
        return relay('data_count', {{ query: q }});
      }},
      raw:  function (sql, params)     {{ return relay('data_raw',  {{ sql: sql, params: params || [] }}); }},
    }},
    state: {{
      find:   function (opts) {{
        var q = (typeof opts === 'string') ? {{ type: opts }} : Object.assign({{}}, opts);
        return relay('state_find', {{ query: q }});
      }},
      get:    function (id)          {{ return relay('state_get',   {{ id: id }}); }},
      insert: function (opts)        {{
        var body = opts.body;
        if (typeof body !== 'string') body = JSON.stringify(body);
        return relay('state_insert', {{ type: opts.type, body: body }});
      }},
      update: function (id, body)    {{
        if (typeof body !== 'string') body = JSON.stringify(body);
        return relay('state_update', {{ id: id, body: body }});
      }},
      delete: function (id)          {{ return relay('state_delete', {{ id: id }}); }},
      purge:  function (opts)        {{
        return relay('state_purge', {{ type: (opts && opts.type) || opts, older_than: opts.olderThan || '30d' }});
      }},
      count: function (opts) {{
        var q = (typeof opts === 'string') ? {{ type: opts }} : Object.assign({{}}, opts);
        return relay('state_count', {{ query: q }});
      }},
      transaction: function (ops) {{
        var normalized = (ops || []).map(function(op) {{
          var o = Object.assign({{}}, op);
          if (o.body && typeof o.body === 'string') {{
            try {{ o.body = JSON.parse(o.body); }} catch(e) {{}}
          }}
          return o;
        }});
        return relay('state_transaction', {{ ops: normalized }});
      }},
      clear: function (opts) {{
        var payload = {{}};
        if (opts && opts.type) payload.record_type = opts.type;
        return relay('state_clear', payload);
      }},
      reset: function () {{ return relay('state_reset', {{}}); }},
      upsert: function (opts) {{
        var body = opts.body;
        if (typeof body !== 'string') body = JSON.stringify(body);
        return relay('state_upsert', {{ id: opts.id, type: opts.type, body: body }});
      }},
      insertMany: function (records) {{
        var normalized = (records || []).map(function(r) {{
          var o = Object.assign({{}}, r);
          if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
          return o;
        }});
        return relay('state_insert_many', {{ records: normalized }});
      }},
      size:   function ()            {{ return relay('state_size',   {{}}); }},
      vacuum: function ()            {{ return relay('state_vacuum', {{}}); }},
      export: function (opts) {{
        opts = opts || {{}};
        var p;
        if (opts.type) {{
          p = relay('state_find', {{ query: {{ type: opts.type }} }});
        }} else if (_perms.indexOf('raw-sql') !== -1) {{
          p = relay('state_raw', {{ sql: 'SELECT id, type, body, created_at, updated_at FROM records ORDER BY created_at', params: [] }});
        }} else {{
          return Promise.reject(new Error("state.export() without a type filter requires the 'raw-sql' permission."));
        }}
        return p.then(function(all) {{
          if (opts.before) {{
            var cutoff = opts.before;
            all = all.filter(function(r) {{ return r.created_at < cutoff; }});
          }}
          return JSON.stringify(all);
        }});
      }},
      raw:    function (sql, params) {{ return relay('state_raw',  {{ sql: sql, params: params || [] }}); }},
      exportBundle: function(opts) {{
        opts = opts || {{}};
        var types = (opts.types && opts.types.length > 0) ? opts.types : null;
        return relay('state_export_bundle', {{ types: types }});
      }},
      importBundle: function(json, opts) {{
        opts = opts || {{}};
        return relay('state_import_bundle', {{ bundle: json, merge: opts.merge ? true : false }});
      }},
      sync: function () {{
        if (_perms.indexOf('local-sync') === -1)
          return Promise.reject(new Error("Permission denied: 'local-sync' not declared in manifest.json permissions."));
        return relay('state_sync', {{}});
      }},
    }},
    clipboard: {{
      write: function (text) {{
        if (_perms.indexOf('clipboard-write') === -1)
          return Promise.reject(new Error("Permission denied: 'clipboard-write' not declared in manifest.json permissions."));
        return navigator.clipboard.writeText(text);
      }},
    }},
    fullscreen: {{
      enter:  function () {{ return relay('uix_enter_fullscreen',  {{}}); }},
      exit:   function () {{ return relay('uix_exit_fullscreen',   {{}}); }},
      toggle: function () {{ return relay('uix_toggle_fullscreen', {{}}); }},
    }},
    viewer: {{
      version: function () {{ return _viewer_version; }},
    }},
    file: {{
      save: function (filename, content, mimeType) {{
        var b64;
        if (content instanceof ArrayBuffer) {{
          var bytes = new Uint8Array(content);
          var str = '';
          for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
          b64 = btoa(str);
        }} else {{
          b64 = btoa(unescape(encodeURIComponent(String(content))));
        }}
        return relay('uix_save_file', {{ filename: filename, content_b64: b64 }});
      }},
      open: function (opts) {{
        var o = opts || {{}};
        return relay('uix_open_file', {{ filter: o.filter || null }}).then(function(r) {{
          if (!r) return null;
          var bin = atob(r.content_b64);
          var buf = new ArrayBuffer(bin.length);
          var view = new Uint8Array(buf);
          for (var i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
          return {{ name: r.name, content: buf }};
        }});
      }},
    }},
    browser: {{
      open: function (url) {{ return relay('uix_open_url', {{ url: url }}); }},
    }},
    window: {{
      setTitle: function (title) {{ return relay('uix_set_window_title', {{ title: title }}); }},
    }},
    notify: function (title, body, opts) {{
      return relay('uix_notify', {{ title: title, body: body }});
    }},
    print: function () {{ window.print(); }},
    exit:  function () {{ return relay('uix_exit', {{}}); }},
    schema: {{
      onUpgrade: function(fn) {{
        var from = _storedSchemaVersion;
        var to   = _currentSchemaVersion;
        if (from >= to) return Promise.resolve();
        return relay('schema_upgrade_begin', {{}}).then(function() {{
          return Promise.resolve()
            .then(function() {{ return fn({{ from: from, to: to, state: window.__uix.state }}); }})
            .then(function() {{ return relay('schema_upgrade_commit', {{ version: to }}); }})
            .catch(function(err) {{
              return relay('schema_upgrade_rollback', {{}}).then(function() {{ throw err; }});
            }});
        }});
      }},
      version:       function() {{ return _currentSchemaVersion; }},
      storedVersion: function() {{ return _storedSchemaVersion; }},
      needsUpgrade:  function() {{ return _storedSchemaVersion < _currentSchemaVersion; }},
    }},
    license: {{
      get:        function()        {{ return relay('license_get',         {{}}); }},
      hasFeature: function(feature) {{ return relay('license_has_feature', {{ feature: feature }}); }},
    }},
  }};
  // Convenience alias — uix.data.find() works without window.__uix prefix
  window.uix = window.__uix;
}})();
</script>"#
    )
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/// find() query parameters — all fields except type are optional.
#[derive(serde::Deserialize, Default)]
struct FindQuery {
    #[serde(rename = "type")]
    record_type: String,
    /// Field equality filters applied via json_extract(body, '$.key') = value.
    #[serde(rename = "where")]
    filters: Option<HashMap<String, serde_json::Value>>,
    /// Column or body field to sort by. Accepts either a plain string ("created_at", "sort", …)
    /// or an object { field: "sort", direction: "asc"|"desc" } as documented in llms.txt.
    #[serde(rename = "orderBy")]
    order_by: Option<serde_json::Value>,
    /// Maximum number of rows to return.
    limit: Option<u32>,
    /// Number of rows to skip before returning results (pagination). SQLite requires
    /// LIMIT when OFFSET is used; LIMIT -1 is appended automatically if needed.
    offset: Option<u32>,
}

/// Reject identifier strings that could be used for SQL injection.
/// Only alphanumeric characters, underscores, and dots are allowed.
fn validate_identifier(s: &str, context: &str) -> Result<(), String> {
    if s.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '.') && !s.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Invalid {context}: '{s}'. Only alphanumeric characters, underscores, and dots are allowed."
        ))
    }
}

/// Convert a serde_json value into a boxed rusqlite ToSql parameter.
fn json_to_sql_param(val: &serde_json::Value) -> Box<dyn rusqlite::ToSql> {
    match val {
        serde_json::Value::String(s) => Box::new(s.clone()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() { Box::new(i) }
            else if let Some(f) = n.as_f64() { Box::new(f) }
            else { Box::new(n.to_string()) }
        }
        serde_json::Value::Bool(b) => Box::new(*b as i64),
        serde_json::Value::Null => Box::new(rusqlite::types::Null),
        other => Box::new(other.to_string()),
    }
}

/// Convert a rusqlite runtime Value to a serde_json Value.
fn sqlite_val_to_json(val: rusqlite::types::Value) -> serde_json::Value {
    match val {
        rusqlite::types::Value::Null       => serde_json::Value::Null,
        rusqlite::types::Value::Integer(i) => serde_json::json!(i),
        rusqlite::types::Value::Real(f)    => serde_json::json!(f),
        rusqlite::types::Value::Text(s)    => serde_json::Value::String(s),
        rusqlite::types::Value::Blob(b)    => {
            // Encode as lowercase hex so callers can detect/decode binary data.
            serde_json::Value::String(b.iter().map(|byte| format!("{byte:02x}")).collect())
        }
    }
}

/// Build WHERE conditions and bound parameters from a filters map.
/// Supports plain scalars (equality) and operator objects:
/// eq, neq, gt, gte, lt, lte, like, in, is_null.
/// Parameter indices start at 2 (?1 is always the type field).
fn build_where_clause(
    filters: &HashMap<String, serde_json::Value>,
) -> Result<(Vec<String>, Vec<Box<dyn rusqlite::ToSql>>), String> {
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    for (key, val) in filters {
        validate_identifier(key, "where field")?;
        let col = format!("json_extract(body, '$.{key}')");

        match val {
            serde_json::Value::Object(ops) => {
                for (op, op_val) in ops {
                    match op.as_str() {
                        "eq" => {
                            let idx = params.len() + 2;
                            conditions.push(format!("{col} = ?{idx}"));
                            params.push(json_to_sql_param(op_val));
                        }
                        "neq" => {
                            let idx = params.len() + 2;
                            conditions.push(format!("{col} != ?{idx}"));
                            params.push(json_to_sql_param(op_val));
                        }
                        "gt" => {
                            let idx = params.len() + 2;
                            conditions.push(format!("{col} > ?{idx}"));
                            params.push(json_to_sql_param(op_val));
                        }
                        "gte" => {
                            let idx = params.len() + 2;
                            conditions.push(format!("{col} >= ?{idx}"));
                            params.push(json_to_sql_param(op_val));
                        }
                        "lt" => {
                            let idx = params.len() + 2;
                            conditions.push(format!("{col} < ?{idx}"));
                            params.push(json_to_sql_param(op_val));
                        }
                        "lte" => {
                            let idx = params.len() + 2;
                            conditions.push(format!("{col} <= ?{idx}"));
                            params.push(json_to_sql_param(op_val));
                        }
                        "like" => {
                            let idx = params.len() + 2;
                            conditions.push(format!("{col} LIKE ?{idx}"));
                            params.push(json_to_sql_param(op_val));
                        }
                        "in" => {
                            if let serde_json::Value::Array(arr) = op_val {
                                if arr.is_empty() {
                                    conditions.push("1 = 0".to_string()); // IN () is invalid SQL
                                } else {
                                    let placeholders: Vec<String> = (0..arr.len())
                                        .map(|i| format!("?{}", params.len() + 2 + i))
                                        .collect();
                                    conditions.push(format!("{col} IN ({})", placeholders.join(", ")));
                                    for item in arr {
                                        params.push(json_to_sql_param(item));
                                    }
                                }
                            } else {
                                return Err(format!(
                                    "'in' operator for '{key}' requires an array value"
                                ));
                            }
                        }
                        "is_null" => {
                            if op_val.as_bool().unwrap_or(false) {
                                conditions.push(format!("{col} IS NULL"));
                            } else {
                                conditions.push(format!("{col} IS NOT NULL"));
                            }
                        }
                        unknown => return Err(format!(
                            "Unknown where operator '{unknown}' for field '{key}'. \
                             Valid: eq, neq, gt, gte, lt, lte, like, in, is_null"
                        )),
                    }
                }
            }
            _ => {
                let idx = params.len() + 2;
                conditions.push(format!("{col} = ?{idx}"));
                params.push(json_to_sql_param(val));
            }
        }
    }

    Ok((conditions, params))
}

/// Convert one orderBy entry (String or { field, direction } object) into a SQL ORDER BY term.
fn order_term(val: &serde_json::Value) -> Result<String, String> {
    let (col, dir) = match val {
        serde_json::Value::String(s) => (s.as_str(), "ASC"),
        serde_json::Value::Object(obj) => {
            let field = obj.get("field").and_then(|v| v.as_str()).unwrap_or("created_at");
            let dir = obj.get("direction").and_then(|v| v.as_str())
                .map(|d| if d.eq_ignore_ascii_case("desc") { "DESC" } else { "ASC" })
                .unwrap_or("ASC");
            (field, dir)
        }
        _ => ("created_at", "ASC"),
    };
    let col_sql = match col {
        "id" | "type" | "created_at" | "updated_at" => col.to_string(),
        _ => {
            validate_identifier(col, "orderBy")?;
            format!("json_extract(body, '$.{col}')")
        }
    };
    Ok(format!("{col_sql} {dir}"))
}

/// Build and execute a filtered SELECT against a `records` table.
fn query_records(conn: &rusqlite::Connection, query: &FindQuery) -> Result<Vec<Record>, String> {
    let mut conditions: Vec<String> = vec!["type = ?1".to_string()];
    let mut extra_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(filters) = &query.filters {
        let (conds, fparams) = build_where_clause(filters)?;
        conditions.extend(conds);
        extra_params.extend(fparams);
    }

    let mut sql = format!(
        "SELECT id, type, body, created_at, updated_at FROM records WHERE {}",
        conditions.join(" AND ")
    );

    if let Some(order_val) = &query.order_by {
        let clause = match order_val {
            serde_json::Value::Array(entries) => {
                let terms: Result<Vec<String>, String> = entries.iter().map(order_term).collect();
                let terms = terms?;
                if terms.is_empty() { "created_at ASC".to_string() } else { terms.join(", ") }
            }
            other => order_term(other)?,
        };
        sql.push_str(&format!(" ORDER BY {clause}"));
    }

    if let Some(limit) = query.limit {
        sql.push_str(&format!(" LIMIT {limit}"));
    }
    if let Some(offset) = query.offset {
        if query.limit.is_none() {
            sql.push_str(" LIMIT -1"); // SQLite requires LIMIT before OFFSET
        }
        sql.push_str(&format!(" OFFSET {offset}"));
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let type_param: &dyn rusqlite::ToSql = &query.record_type;
    let mut all_params: Vec<&dyn rusqlite::ToSql> = vec![type_param];
    for p in &extra_params {
        all_params.push(p.as_ref());
    }

    let rows = stmt
        .query_map(all_params.as_slice(), |row| {
            Ok(Record {
                id: row.get(0)?,
                r#type: row.get(1)?,
                body: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn get_record(conn: &rusqlite::Connection, id: &str) -> Result<Option<Record>, String> {
    let result = conn.query_row(
        "SELECT id, type, body, created_at, updated_at FROM records WHERE id = ?1",
        [id],
        |row| {
            Ok(Record {
                id: row.get(0)?,
                r#type: row.get(1)?,
                body: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    );
    match result {
        Ok(r) => Ok(Some(r)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Execute an arbitrary SQL query and return rows as JSON objects keyed by column name.
fn exec_raw_sql(
    conn: &rusqlite::Connection,
    sql: &str,
    params: &[serde_json::Value],
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("").to_string())
        .collect();

    let raw_params: Vec<Box<dyn rusqlite::ToSql>> = params.iter().map(json_to_sql_param).collect();
    let param_refs: Vec<&dyn rusqlite::ToSql> = raw_params.iter().map(|b| b.as_ref()).collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let mut obj = serde_json::Map::new();
            for i in 0..col_count {
                let val: rusqlite::types::Value = row.get(i)?;
                obj.insert(col_names[i].clone(), sqlite_val_to_json(val));
            }
            Ok(serde_json::Value::Object(obj))
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Query parameters for count() — type is required, where filters are optional.
#[derive(serde::Deserialize, Default)]
struct CountQuery {
    #[serde(rename = "type")]
    record_type: String,
    #[serde(rename = "where")]
    filters: Option<HashMap<String, serde_json::Value>>,
}

/// Run SELECT COUNT(*) with optional where-equality filters, same semantics as find().
fn count_records(
    conn: &rusqlite::Connection,
    record_type: &str,
    filters: &Option<HashMap<String, serde_json::Value>>,
) -> Result<i64, String> {
    let mut conditions: Vec<String> = vec!["type = ?1".to_string()];
    let mut extra_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(f) = filters {
        let (conds, fparams) = build_where_clause(f)?;
        conditions.extend(conds);
        extra_params.extend(fparams);
    }

    let sql = format!(
        "SELECT COUNT(*) FROM records WHERE {}",
        conditions.join(" AND ")
    );

    let type_owned = record_type.to_owned();
    let type_param: &dyn rusqlite::ToSql = &type_owned;
    let mut all_params: Vec<&dyn rusqlite::ToSql> = vec![type_param];
    for p in &extra_params {
        all_params.push(p.as_ref());
    }

    conn.query_row(&sql, all_params.as_slice(), |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands -- file loading
// ---------------------------------------------------------------------------

#[tauri::command]
async fn pick_and_load_uix(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LoadResult, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("UIX App", &["uix"])
        .pick_file(move |maybe_path| { let _ = tx.send(maybe_path); });

    let file = rx
        .await
        .map_err(|_| "Dialog closed unexpectedly".to_string())?
        .ok_or_else(|| "No file selected".to_string())?;

    probe_uix_inner(&file.to_string(), &app, &state)
}

#[tauri::command]
fn load_uix(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LoadResult, String> {
    probe_uix_inner(&path, &app, &state)
}

#[tauri::command]
fn close_uix(state: State<'_, AppState>) {
    let uix_path = state.uix_path.lock().unwrap().clone();
    if uix_path.is_empty() { return; }
    let state_db_path = state.state_db_path.lock().unwrap().clone();
    let state_mode = state.state_mode.lock().unwrap().clone();
    { let _ = state.state_db.lock().unwrap().take(); }
    { let _ = state.data_db.lock().unwrap().take(); }
    if state_mode != "device" {
        if let Some(db_path) = state_db_path {
            if db_path.exists() { let _ = repack_uix(&uix_path, &db_path); }
        }
    }
    let _ = std::fs::remove_file(format!("{uix_path}.lock"));
    *state.uix_path.lock().unwrap() = String::new();
    *state.state_db_path.lock().unwrap() = None;
    *state.license_info.lock().unwrap() = None;
    state.files.lock().unwrap().clear();
}

/// Returns (and clears) the .uix path that was passed as a CLI argument on launch.
/// Called once by the frontend on startup to auto-open a file from file association.
#[tauri::command]
fn get_initial_file(state: State<'_, AppState>) -> Option<String> {
    state.initial_path.lock().unwrap().take()
}

/// Complete loading a PIN-protected .uix file.
/// The pending files must already have been stored by a previous `load_uix` / `pick_and_load_uix`
/// call that returned `{ status: "pin_required" }`.
#[tauri::command]
fn unlock_with_pin(
    pin: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LoadResult, String> {
    let path = state.pending_path.lock().unwrap().take()
        .ok_or("No pending app to unlock — call load_uix first")?;
    let mut files = state.pending_files.lock().unwrap().take()
        .ok_or("No pending files to decrypt")?;
    let manifest = state.pending_manifest.lock().unwrap().take()
        .ok_or("No pending manifest")?;

    // Read security parameters from manifest.
    let security = manifest.get("security")
        .ok_or("Manifest has no 'security' block")?;
    let key_salt_b64 = security.get("keySalt").and_then(|v| v.as_str())
        .ok_or("security.keySalt missing")?;
    let iterations = security.get("kdfIterations").and_then(|v| v.as_u64())
        .unwrap_or(200_000) as u32;
    let encrypted_paths: Vec<String> = security
        .get("encryptedPaths").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let salt = base64_url_decode(key_salt_b64)?;
    let key = derive_aes_key(&pin, &salt, iterations);

    for ep in &encrypted_paths {
        let encrypted = files.get(ep)
            .ok_or_else(|| format!("Encrypted path not found in archive: {ep}"))?
            .clone();
        let decrypted = decrypt_aes_gcm(&encrypted, &key)?;
        files.insert(ep.clone(), decrypted);
    }

    complete_load(&path, files, &manifest, &app, &state)
}


/// Return the manifest of the currently open .uix app.
#[tauri::command]
fn get_manifest(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let files = state.files.lock().unwrap();
    let bytes = files.get("manifest.json").ok_or("No app loaded")?;
    serde_json::from_slice(bytes).map_err(|e| e.to_string())
}

/// Close the viewer window (kiosk exit). PIN protection is a future enhancement.
#[tauri::command]
async fn uix_exit(app: AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------------------
// Tauri commands -- data bridge (read-only product data from data.db)
// ---------------------------------------------------------------------------

#[tauri::command]
fn data_find(query: FindQuery, state: State<'_, AppState>) -> Result<Vec<Record>, String> {
    let db = state.data_db.lock().unwrap();
    match db.as_ref() {
        None => Ok(vec![]),
        Some(conn) => query_records(conn, &query),
    }
}

#[tauri::command]
fn data_get(id: String, state: State<'_, AppState>) -> Result<Option<Record>, String> {
    let db = state.data_db.lock().unwrap();
    match db.as_ref() {
        None => Ok(None),
        Some(conn) => get_record(conn, &id),
    }
}

/// Execute raw SQL against data.db (SELECT only).
/// Requires "raw-sql" in manifest.json permissions.
#[tauri::command]
fn data_raw(
    sql: String,
    params: Option<Vec<serde_json::Value>>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    {
        let perms = state.permissions.lock().unwrap();
        if !perms.contains(&"raw-sql".to_string()) {
            return Err("Permission denied: 'raw-sql' is not declared in manifest.json permissions.".into());
        }
    }
    // data.db is read-only by contract — restrict to SELECT statements.
    if !sql.trim().to_lowercase().starts_with("select") {
        return Err("data.raw() is read-only. Only SELECT statements are permitted.".into());
    }
    let db = state.data_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    exec_raw_sql(conn, &sql, &params.unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Tauri commands -- state bridge (mutable records in state.db)
// ---------------------------------------------------------------------------

#[tauri::command]
fn state_find(query: FindQuery, state: State<'_, AppState>) -> Result<Vec<Record>, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    query_records(conn, &query)
}

#[tauri::command]
fn state_get(id: String, state: State<'_, AppState>) -> Result<Option<Record>, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    get_record(conn, &id)
}

#[tauri::command]
fn state_insert(
    r#type: String,
    body: String,
    state: State<'_, AppState>,
) -> Result<Record, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    let id = gen_id();
    let now = now_ms();
    conn.execute(
        "INSERT INTO records (id, type, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, r#type, body, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(Record { id, r#type, body, created_at: now, updated_at: now })
}

#[tauri::command]
fn state_update(
    id: String,
    body: String,
    state: State<'_, AppState>,
) -> Result<Record, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    let now = now_ms();
    let changed = conn
        .execute(
            "UPDATE records SET body = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![body, now, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("Record not found: {id}"));
    }
    get_record(conn, &id)?.ok_or_else(|| format!("Record disappeared after update: {id}"))
}

#[tauri::command]
fn state_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    conn.execute("DELETE FROM records WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete records of a given type older than a duration ("30d", "12h", "1y").
/// Returns the number of records deleted.
#[tauri::command]
fn state_purge(
    r#type: String,
    older_than: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let seconds = parse_duration(&older_than)?;
    let cutoff_ms = now_ms() - (seconds * 1000) as i64;
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    let n = conn
        .execute(
            "DELETE FROM records WHERE type = ?1 AND created_at < ?2",
            rusqlite::params![r#type, cutoff_ms],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as u64)
}

/// Execute raw SQL against state.db (read + write allowed).
/// Requires "raw-sql" in manifest.json permissions.
#[tauri::command]
fn state_raw(
    sql: String,
    params: Option<Vec<serde_json::Value>>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    {
        let perms = state.permissions.lock().unwrap();
        if !perms.contains(&"raw-sql".to_string()) {
            return Err("Permission denied: 'raw-sql' is not declared in manifest.json permissions.".into());
        }
    }
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    exec_raw_sql(conn, &sql, &params.unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Phase 1 additions: count, transaction, clear, reset
// ---------------------------------------------------------------------------

#[tauri::command]
fn data_count(query: CountQuery, state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.data_db.lock().unwrap();
    match db.as_ref() {
        None => Ok(0),
        Some(conn) => count_records(conn, &query.record_type, &query.filters),
    }
}

#[tauri::command]
fn state_count(query: CountQuery, state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    count_records(conn, &query.record_type, &query.filters)
}

/// Operation item for state_transaction — op is one of: insert, update, upsert, delete.
#[derive(serde::Deserialize)]
struct TransactionOp {
    op: String,
    #[serde(rename = "type")]
    record_type: Option<String>,
    id: Option<String>,
    body: Option<serde_json::Value>,
}

/// Execute a list of write operations atomically: all succeed or all roll back.
/// Returns a parallel array — Some(Record) for write ops, None for deletes.
#[tauri::command]
fn state_transaction(
    ops: Vec<TransactionOp>,
    state: State<'_, AppState>,
) -> Result<Vec<Option<Record>>, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;

    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;

    let result: Result<Vec<Option<Record>>, String> = (|| {
        let mut results: Vec<Option<Record>> = Vec::with_capacity(ops.len());
        for item in &ops {
            match item.op.as_str() {
                "insert" => {
                    let rtype = item.record_type.as_deref()
                        .ok_or("transaction insert: 'type' is required")?;
                    let bval = item.body.as_ref()
                        .ok_or("transaction insert: 'body' is required")?;
                    let body_str = match bval {
                        serde_json::Value::String(s) => s.clone(),
                        v => serde_json::to_string(v).map_err(|e| e.to_string())?,
                    };
                    let id = item.id.clone()
                        .unwrap_or_else(|| format!("{}:{}", rtype, gen_id()));
                    let now = now_ms() / 1000;
                    conn.execute(
                        "INSERT INTO records (id, type, body, created_at, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        rusqlite::params![id, rtype, body_str, now, now],
                    ).map_err(|e| e.to_string())?;
                    results.push(Some(Record {
                        id,
                        r#type: rtype.to_string(),
                        body: body_str,
                        created_at: now,
                        updated_at: now,
                    }));
                }
                "update" => {
                    let id = item.id.as_deref()
                        .ok_or("transaction update: 'id' is required")?;
                    let bval = item.body.as_ref()
                        .ok_or("transaction update: 'body' is required")?;
                    let body_str = match bval {
                        serde_json::Value::String(s) => s.clone(),
                        v => serde_json::to_string(v).map_err(|e| e.to_string())?,
                    };
                    let now = now_ms() / 1000;
                    let changed = conn.execute(
                        "UPDATE records SET body = ?1, updated_at = ?2 WHERE id = ?3",
                        rusqlite::params![body_str, now, id],
                    ).map_err(|e| e.to_string())?;
                    if changed == 0 {
                        return Err(format!("transaction update: record not found: {id}"));
                    }
                    results.push(get_record(conn, id)?);
                }
                "upsert" => {
                    let id = item.id.as_deref()
                        .ok_or("transaction upsert: 'id' is required")?;
                    let rtype = item.record_type.as_deref()
                        .ok_or("transaction upsert: 'type' is required")?;
                    let bval = item.body.as_ref()
                        .ok_or("transaction upsert: 'body' is required")?;
                    let body_str = match bval {
                        serde_json::Value::String(s) => s.clone(),
                        v => serde_json::to_string(v).map_err(|e| e.to_string())?,
                    };
                    let now = now_ms() / 1000;
                    conn.execute(
                        "INSERT INTO records (id, type, body, created_at, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5) \
                         ON CONFLICT(id) DO UPDATE SET body = excluded.body, \
                         updated_at = excluded.updated_at",
                        rusqlite::params![id, rtype, body_str, now, now],
                    ).map_err(|e| e.to_string())?;
                    results.push(get_record(conn, id)?);
                }
                "delete" => {
                    let id = item.id.as_deref()
                        .ok_or("transaction delete: 'id' is required")?;
                    conn.execute("DELETE FROM records WHERE id = ?1", [id])
                        .map_err(|e| e.to_string())?;
                    results.push(None);
                }
                other => return Err(format!(
                    "Unknown transaction op: '{other}'. Valid: insert, update, upsert, delete"
                )),
            }
        }
        Ok(results)
    })();

    match result {
        Ok(rows) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(rows)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// Delete records of one type, or all records when no type is given.
/// Runs incremental_vacuum to partially reclaim freed pages.
#[tauri::command]
fn state_clear(
    record_type: Option<String>,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    let n = match &record_type {
        Some(t) => conn
            .execute("DELETE FROM records WHERE type = ?1", [t])
            .map_err(|e| e.to_string())?,
        None => conn
            .execute("DELETE FROM records", [])
            .map_err(|e| e.to_string())?,
    };
    conn.execute_batch("PRAGMA incremental_vacuum").map_err(|e| e.to_string())?;
    Ok(n as u64)
}

/// Restore state.db to its original shipped state:
/// - If state.seed=true, copies state_seed.db (saved on first open) back over state.db.
/// - If no seed, deletes all records (same as state_clear with no type).
#[tauri::command]
fn state_reset(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_id = state.app_id.lock().unwrap().clone();
    if app_id.is_empty() {
        return Err("No app loaded".into());
    }
    let state_db_path = state.state_db_path.lock().unwrap().clone()
        .ok_or("No state.db path — app may not be fully loaded")?;
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {e}"))?.join(&app_id);
    let seed_backup = data_dir.join("state_seed.db");
    let tmp = data_dir.join("state_reset.tmp");

    // Hold the lock for the entire operation to block concurrent DB access.
    let mut db_guard = state.state_db.lock().unwrap();
    *db_guard = None; // drop existing connection before touching the file

    if seed_backup.exists() {
        // Atomic restore: copy seed to tmp, then rename over state.db.
        std::fs::copy(&seed_backup, &tmp)
            .map_err(|e| format!("Cannot copy seed backup: {e}"))?;
        std::fs::rename(&tmp, &state_db_path)
            .map_err(|e| format!("Cannot restore state.db from seed: {e}"))?;
    } else {
        // No seed — open temporarily to clear all records.
        let conn = rusqlite::Connection::open(&state_db_path)
            .map_err(|e| format!("Cannot open state.db for reset: {e}"))?;
        conn.execute("DELETE FROM records", []).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA incremental_vacuum").map_err(|e| e.to_string())?;
    }

    // Reopen and restore to AppState.
    let conn = rusqlite::Connection::open(&state_db_path)
        .map_err(|e| format!("Cannot reopen state.db after reset: {e}"))?;
    ensure_state_schema(&conn, &app_id)?;
    *db_guard = Some(conn);
    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 2 additions: upsert, insertMany, size, vacuum, fullscreen
// ---------------------------------------------------------------------------

#[tauri::command]
fn state_upsert(
    id: String,
    r#type: String,
    body: String,
    state: State<'_, AppState>,
) -> Result<Record, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    let now = now_ms() / 1000;
    conn.execute(
        "INSERT INTO records (id, type, body, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(id) DO UPDATE SET body = excluded.body, \
         updated_at = excluded.updated_at",
        rusqlite::params![id, r#type, body, now, now],
    ).map_err(|e| e.to_string())?;
    get_record(conn, &id)?.ok_or_else(|| "upsert: record not found after write".into())
}

/// Item shape accepted by state_insert_many.
#[derive(serde::Deserialize)]
struct InsertItem {
    #[serde(rename = "type")]
    record_type: String,
    id: Option<String>,
    body: String,
}

/// Insert a batch of records atomically: all succeed or all roll back.
#[tauri::command]
fn state_insert_many(
    records: Vec<InsertItem>,
    state: State<'_, AppState>,
) -> Result<Vec<Record>, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;

    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;

    let result: Result<Vec<Record>, String> = (|| {
        let mut out: Vec<Record> = Vec::with_capacity(records.len());
        for item in &records {
            let id = item.id.clone()
                .unwrap_or_else(|| format!("{}:{}", item.record_type, gen_id()));
            let now = now_ms() / 1000;
            conn.execute(
                "INSERT INTO records (id, type, body, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![id, item.record_type, item.body, now, now],
            ).map_err(|e| e.to_string())?;
            out.push(Record {
                id,
                r#type: item.record_type.clone(),
                body: item.body.clone(),
                created_at: now,
                updated_at: now,
            });
        }
        Ok(out)
    })();

    match result {
        Ok(rows) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(rows)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// Return the file size, total record count, and per-type record counts for state.db.
#[derive(serde::Serialize)]
struct StateSize {
    bytes: u64,
    records: i64,
    types: HashMap<String, i64>,
}

#[tauri::command]
fn state_size(state: State<'_, AppState>) -> Result<StateSize, String> {
    let state_db_path = state.state_db_path.lock().unwrap().clone()
        .ok_or("No state.db path")?;
    let bytes = std::fs::metadata(&state_db_path).map(|m| m.len()).unwrap_or(0);

    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;

    let records: i64 = conn
        .query_row("SELECT COUNT(*) FROM records", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT type, COUNT(*) FROM records GROUP BY type")
        .map_err(|e| e.to_string())?;
    let types: HashMap<String, i64> = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(StateSize { bytes, records, types })
}

/// Reclaim all free pages in state.db via VACUUM. Returns bytes before and after.
#[tauri::command]
fn state_vacuum(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let state_db_path = state.state_db_path.lock().unwrap().clone()
        .ok_or("No state.db path")?;
    let before = std::fs::metadata(&state_db_path).map(|m| m.len()).unwrap_or(0);
    {
        let db = state.state_db.lock().unwrap();
        let conn = db.as_ref().ok_or("No app loaded")?;
        conn.execute_batch("VACUUM").map_err(|e| e.to_string())?;
    }
    let after = std::fs::metadata(&state_db_path).map(|m| m.len()).unwrap_or(0);
    Ok(serde_json::json!({ "before": before, "after": after }))
}

/// Updates the schema_version stored in meta.  Called by the bridge after a successful
/// `uix.schema.onUpgrade()` run.  Persists the new version so upgrades don't re-run.
#[tauri::command]
fn schema_version_set(version: u32, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?1)",
        rusqlite::params![version.to_string()],
    )
    .map_err(|e| e.to_string())?;
    *state.stored_schema_version.lock().unwrap() = version;
    Ok(())
}

/// Opens an EXCLUSIVE SQLite transaction on state.db for a schema upgrade.
/// All subsequent uix.state.* bridge calls run inside this transaction until
/// `schema_upgrade_commit` or `schema_upgrade_rollback` is called.
#[tauri::command]
fn schema_upgrade_begin(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    conn.execute_batch("BEGIN EXCLUSIVE").map_err(|e| e.to_string())
}

/// Commits the open schema-upgrade transaction and persists the new schema version.
#[tauri::command]
fn schema_upgrade_commit(version: u32, state: State<'_, AppState>) -> Result<(), String> {
    {
        let db = state.state_db.lock().unwrap();
        let conn = db.as_ref().ok_or("No app loaded")?;
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?1)",
            rusqlite::params![version.to_string()],
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    }
    *state.stored_schema_version.lock().unwrap() = version;
    Ok(())
}

/// Rolls back the open schema-upgrade transaction, leaving state.db and schemaVersion untouched.
#[tauri::command]
fn schema_upgrade_rollback(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    conn.execute_batch("ROLLBACK").map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Phase 6 additions: license
// ---------------------------------------------------------------------------

/// Returns the license info for the currently open app, or null if no license is loaded.
#[tauri::command]
fn license_get(state: State<'_, AppState>) -> Result<Option<LicenseInfo>, String> {
    let lic = state.license_info.lock().unwrap().clone();
    Ok(lic.map(|p| LicenseInfo {
        issued_to: p.issued_to,
        issued_at: p.issued_at,
        expires_at: p.expires_at,
        features: p.features,
        valid: true,
    }))
}

/// Returns true if the current license includes the named feature.
#[tauri::command]
fn license_has_feature(feature: String, state: State<'_, AppState>) -> Result<bool, String> {
    let lic = state.license_info.lock().unwrap().clone();
    Ok(lic.map_or(false, |p| p.features.contains(&feature)))
}

/// Open a file dialog for a `.uixlicense` file and save it to the per-app data directory.
/// Validates that the JSON is parseable and `payload.appId` is non-empty.
/// If `app_id` is provided, rejects licenses for a different app.
/// Full signature + expiry verification happens in the subsequent `load_uix` call.
#[tauri::command]
async fn pick_and_install_license(
    app_id: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("UIX License", &["uixlicense"])
        .pick_file(move |p| { let _ = tx.send(p); });

    let path = rx
        .await
        .map_err(|_| "Dialog closed unexpectedly".to_string())?
        .ok_or_else(|| "No file selected".to_string())?;

    let data = std::fs::read_to_string(path.to_string())
        .map_err(|e| format!("Cannot read license file: {e}"))?;

    let parsed: serde_json::Value = serde_json::from_str(&data)
        .map_err(|e| format!("Invalid license file (not valid JSON): {e}"))?;

    let file_app_id = parsed
        .get("payload").and_then(|p| p.get("appId")).and_then(|v| v.as_str())
        .ok_or("License file is missing payload.appId")?
        .to_string();

    if file_app_id.is_empty() {
        return Err("License file has an empty appId".into());
    }

    if let Some(ref expected) = app_id {
        if &file_app_id != expected {
            return Err(format!(
                "This license is for app '{}', not '{}'.",
                file_app_id, expected
            ));
        }
    }

    let data_dir = app
        .path().app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {e}"))?.join(&file_app_id);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    std::fs::write(data_dir.join("license.uixlicense"), data.as_bytes())
        .map_err(|e| format!("Cannot save license file: {e}"))?;

    Ok(())
}

/// Return the stable per-device UUID (creates it on first call).
/// App creators use this to issue device-bound licenses.
#[tauri::command]
fn get_device_id(app: AppHandle) -> String {
    ensure_global_device_id(&app)
}
// ---------------------------------------------------------------------------

/// Return value from state_import_bundle.
#[derive(serde::Serialize)]
struct ImportBundleResult {
    imported: u64,
    skipped: u64,
}

/// Export state records as a .uixdata JSON bundle string.
/// When `types` is non-empty only records of those types are included.
/// The bundle includes a SHA-256 checksum of the compact JSON records array,
/// matching the checksum produced by `dotuix export --output *.uixdata`.
#[tauri::command]
fn state_export_bundle(
    types: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;

    // 1. Collect records
    let records: Vec<Record> = match types.as_deref() {
        Some(ts) if !ts.is_empty() => {
            let mut all: Vec<Record> = Vec::new();
            for t in ts {
                let q = FindQuery { record_type: t.clone(), ..Default::default() };
                all.extend(query_records(conn, &q)?);
            }
            all
        }
        _ => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, type, body, created_at, updated_at \
                     FROM records ORDER BY created_at",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(Record {
                        id: row.get(0)?,
                        r#type: row.get(1)?,
                        body: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        }
    };

    // 2. Checksum — must match CLI's sha256(JSON.stringify(records))
    let records_json = serde_json::to_string(&records).map_err(|e| e.to_string())?;
    let checksum = format!("sha256:{}", sha256_hex(records_json.as_bytes()));

    // 3. Unique types (in encounter order)
    let mut seen = std::collections::HashSet::new();
    let unique_types: Vec<&str> = records
        .iter()
        .filter(|r| seen.insert(r.r#type.as_str()))
        .map(|r| r.r#type.as_str())
        .collect();

    // 4. Metadata
    let app_id = state.app_id.lock().unwrap().clone();
    let schema_version = *state.stored_schema_version.lock().unwrap();
    let exported_at = {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        format_iso8601(secs)
    };

    // 5. Build bundle
    let bundle = serde_json::json!({
        "format": "uixdata/1.0",
        "appId": app_id,
        "schemaVersion": schema_version,
        "exportedAt": exported_at,
        "exportedBy": format!("dotuix-viewer/{VIEWER_VERSION}"),
        "checksum": checksum,
        "types": unique_types,
        "records": records,
    });
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

/// Import a .uixdata bundle (JSON string) into state.db.
/// `merge = false` (default): existing records of matching types are deleted first.
/// `merge = true`: records whose ID already exists are skipped.
#[tauri::command]
fn state_import_bundle(
    bundle: String,
    merge: Option<bool>,
    state: State<'_, AppState>,
) -> Result<ImportBundleResult, String> {
    let merge = merge.unwrap_or(false);

    // 1. Parse + validate
    let parsed: serde_json::Value = serde_json::from_str(&bundle)
        .map_err(|e| format!("Invalid bundle JSON: {e}"))?;

    if parsed["format"].as_str() != Some("uixdata/1.0") {
        return Err(format!(
            "Unsupported bundle format: \"{}\"",
            parsed["format"].as_str().unwrap_or("(none)")
        ));
    }

    let records_arr = parsed["records"]
        .as_array()
        .ok_or("Bundle has no records array")?;

    // 2. Verify checksum via canonical re-serialisation through Record struct.
    //    This ensures the same field order as the CLI's JSON.stringify.
    if let Some(stored_checksum) = parsed["checksum"].as_str() {
        let recs: Vec<Record> =
            serde_json::from_value(serde_json::Value::Array(records_arr.clone()))
                .map_err(|e| format!("Invalid record shape in bundle: {e}"))?;
        let recs_json = serde_json::to_string(&recs).map_err(|e| e.to_string())?;
        let expected = format!("sha256:{}", sha256_hex(recs_json.as_bytes()));
        if stored_checksum != expected {
            return Err(
                "Checksum mismatch — bundle may be corrupted or tampered with".into(),
            );
        }
    }

    // 3. Deserialise records
    let records: Vec<Record> =
        serde_json::from_value(serde_json::Value::Array(records_arr.clone()))
            .map_err(|e| format!("Cannot deserialise bundle records: {e}"))?;

    // 4. Transactional import
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;

    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;

    let result: Result<ImportBundleResult, String> = (|| {
        if !merge {
            let types: std::collections::HashSet<&str> =
                records.iter().map(|r| r.r#type.as_str()).collect();
            for t in &types {
                conn.execute("DELETE FROM records WHERE type = ?1", [*t])
                    .map_err(|e| e.to_string())?;
            }
        }

        let mut imported: u64 = 0;
        let mut skipped: u64 = 0;

        for rec in &records {
            if merge {
                let exists: bool = conn
                    .query_row(
                        "SELECT 1 FROM records WHERE id = ?1",
                        [&rec.id],
                        |_| Ok(true),
                    )
                    .unwrap_or(false);
                if exists {
                    skipped += 1;
                    continue;
                }
            }
            conn.execute(
                "INSERT OR IGNORE INTO records \
                 (id, type, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![rec.id, rec.r#type, rec.body, rec.created_at, rec.updated_at],
            )
            .map_err(|e| e.to_string())?;
            imported += 1;
        }

        Ok(ImportBundleResult { imported, skipped })
    })();

    match result {
        Ok(res) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(res)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// Sync state.db records with a remote sync server (push local changes, pull remote changes).
/// Requires the "local-sync" permission and `sync.endpoint` + `sync.secret` in the manifest.
/// Conflict resolution: last-write-wins on `updated_at`.
#[tauri::command]
async fn state_sync(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // ── 1. Permission check ────────────────────────────────────────────────
    {
        let perms = state.permissions.lock().unwrap();
        if !perms.contains(&"local-sync".to_string()) {
            return Err(
                "Permission denied: 'local-sync' not declared in manifest.json permissions.".into(),
            );
        }
    }

    // ── 2. Read sync config ────────────────────────────────────────────
    let endpoint = state
        .sync_endpoint
        .lock()
        .unwrap()
        .clone()
        .ok_or("Sync not configured: 'sync.endpoint' missing from manifest.")?;
    let app_id = state.app_id.lock().unwrap().clone();

    // ── 3. Collect push payload (lock held, no await) ────────────────────
    let (device_id, last_sync, push_records) = {
        let db = state.state_db.lock().unwrap();
        let conn = db.as_ref().ok_or("No app loaded")?;

        let device_id: String = conn
            .query_row("SELECT value FROM meta WHERE key = 'device_id'", [], |r| r.get(0))
            .map_err(|e| format!("Cannot read device_id: {e}"))?;

        let last_sync: i64 = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'last_sync'",
                [],
                |r| r.get::<_, String>(0).map(|s| s.parse::<i64>().unwrap_or(0)),
            )
            .unwrap_or(0);

        let mut stmt = conn
            .prepare(
                "SELECT id, type, body, created_at, updated_at \
                 FROM records WHERE updated_at > ?1",
            )
            .map_err(|e| e.to_string())?;

        let push_records: Vec<serde_json::Value> = stmt
            .query_map([last_sync], |r| {
                Ok(serde_json::json!({
                    "id":         r.get::<_, String>(0)?,
                    "type":       r.get::<_, String>(1)?,
                    "body":       r.get::<_, String>(2)?,
                    "created_at": r.get::<_, i64>(3)?,
                    "updated_at": r.get::<_, i64>(4)?,
                    "deleted":    false,
                }))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        (device_id, last_sync, push_records)
    }; // mutex released before await

    // ── 4. HTTP push + pull ───────────────────────────────────────────────
    let url = format!("{}/sync", endpoint.trim_end_matches('/'));
    let body = serde_json::json!({
        "appId":    app_id,
        "deviceId": device_id,
        "lastSync": last_sync,
        "push":     push_records,
    });

    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Sync request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Sync server returned HTTP {}", resp.status().as_u16()));
    }

    let result: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid sync response: {e}"))?;

    // ── 5. Merge pulled records + persist last_sync ─────────────────────
    let pull  = result.get("pull").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let pushed = result.get("pushed").and_then(|v| v.as_i64()).unwrap_or(0);
    let server_time = result.get("serverTime").and_then(|v| v.as_i64()).unwrap_or_else(now_ms);
    let pulled_count = pull.len() as i64;

    {
        let db = state.state_db.lock().unwrap();
        let conn = db.as_ref().ok_or("No app loaded")?;

        for record in &pull {
            let id         = record["id"].as_str().unwrap_or_default();
            let rtype      = record["type"].as_str().unwrap_or_default();
            let body       = record["body"].as_str().unwrap_or("{}");
            let created_at = record["created_at"].as_i64().unwrap_or(0);
            let updated_at = record["updated_at"].as_i64().unwrap_or(0);
            let deleted    = record["deleted"].as_bool().unwrap_or(false);

            if deleted {
                conn.execute("DELETE FROM records WHERE id = ?1", [id])
                    .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "INSERT INTO records (id, type, body, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5) \
                     ON CONFLICT (id) DO UPDATE SET \
                       type       = CASE WHEN excluded.updated_at > updated_at THEN excluded.type       ELSE type       END, \
                       body       = CASE WHEN excluded.updated_at > updated_at THEN excluded.body       ELSE body       END, \
                       updated_at = CASE WHEN excluded.updated_at > updated_at THEN excluded.updated_at ELSE updated_at END",
                    rusqlite::params![id, rtype, body, created_at, updated_at],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('last_sync', ?1) \
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            [&server_time.to_string()],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(serde_json::json!({ "pushed": pushed, "pulled": pulled_count }))
}

/// Bridge-accessible fullscreen controls — all require the "fullscreen" permission.
#[tauri::command]
async fn uix_enter_fullscreen(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let perms = state.permissions.lock().unwrap();
        if !perms.contains(&"fullscreen".to_string()) {
            return Err("Permission denied: 'fullscreen' not declared in manifest.json permissions.".into());
        }
    }
    window.set_fullscreen(true).map_err(|e| e.to_string())
}

#[tauri::command]
async fn uix_exit_fullscreen(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let perms = state.permissions.lock().unwrap();
        if !perms.contains(&"fullscreen".to_string()) {
            return Err("Permission denied: 'fullscreen' not declared in manifest.json permissions.".into());
        }
    }
    window.set_fullscreen(false).map_err(|e| e.to_string())
}

#[tauri::command]
async fn uix_toggle_fullscreen(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let perms = state.permissions.lock().unwrap();
        if !perms.contains(&"fullscreen".to_string()) {
            return Err("Permission denied: 'fullscreen' not declared in manifest.json permissions.".into());
        }
    }
    let is_full = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(!is_full).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Phase 3 additions: file.save, file.open, browser.open, window.setTitle
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct FileResult {
    name: String,
    content_b64: String,
}

/// Save bytes (base64-encoded) to a user-chosen path via the OS save dialog.
/// Requires the `"file-save"` permission.
#[tauri::command]
fn uix_save_file(
    filename: String,
    content_b64: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    {
        let perms = state.permissions.lock().unwrap();
        if !perms.contains(&"file-save".to_string()) {
            return Err("Permission denied: 'file-save' not declared in manifest.json permissions.".into());
        }
    }
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&content_b64)
        .map_err(|e| format!("Invalid base64 content: {e}"))?;
    use tauri_plugin_dialog::DialogExt;
    let result = app.dialog().file().set_file_name(&filename).blocking_save_file();
    match result {
        None => Ok(false),
        Some(p) => {
            std::fs::write(std::path::PathBuf::from(p.to_string()), &bytes)
                .map_err(|e| e.to_string())?;
            Ok(true)
        }
    }
}

/// Open a user-chosen file and return its contents as base64.
/// Requires the `"file-open"` permission.
#[tauri::command]
fn uix_open_file(
    filter: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<FileResult>, String> {
    {
        let perms = state.permissions.lock().unwrap();
        if !perms.contains(&"file-open".to_string()) {
            return Err("Permission denied: 'file-open' not declared in manifest.json permissions.".into());
        }
    }
    use base64::Engine as _;
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file();
    if let Some(ref ext) = filter {
        dialog = dialog.add_filter("File", &[ext.as_str()]);
    }
    let result = dialog.blocking_pick_file();
    match result {
        None => Ok(None),
        Some(p) => {
            let path_buf = std::path::PathBuf::from(p.to_string());
            let name = path_buf.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();
            let bytes = std::fs::read(&path_buf).map_err(|e| e.to_string())?;
            let content_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Ok(Some(FileResult { name, content_b64 }))
        }
    }
}

/// Open a URL in the OS default browser.
/// Only `https://` and `http://` schemes are allowed.
/// Requires the `"open-url"` permission.
#[tauri::command]
fn uix_open_url(url: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let perms = state.permissions.lock().unwrap();
        if !perms.contains(&"open-url".to_string()) {
            return Err("Permission denied: 'open-url' not declared in manifest.json permissions.".into());
        }
    }
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("uix.browser.open: only https:// and http:// URLs are permitted.".into());
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&url).status().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&url).status().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd").args(["/C", "start", "", &url]).status().map_err(|e| e.to_string())?;
    Ok(())
}

/// Set the OS window title. The app name is always prepended to prevent misleading titles.
#[tauri::command]
fn uix_set_window_title(
    title: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let app_name = state.app_name.lock().unwrap().clone();
    let full_title = if app_name.is_empty() {
        title
    } else {
        format!("{app_name} \u{2014} {title}")
    };
    window.set_title(&full_title).map_err(|e| e.to_string())
}

/// Fire a native OS desktop notification.
/// Requires the `"notifications"` permission.
#[tauri::command]
fn uix_notify(
    title: String,
    body: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let perms = state.permissions.lock().unwrap();
        if !perms.contains(&"notifications".to_string()) {
            return Err("Permission denied: 'notifications' not declared in manifest.json permissions.".into());
        }
    }
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct DbLoadResult {
    exists: bool,
    records: Vec<Record>,
}

// ---------------------------------------------------------------------------

#[tauri::command]
fn get_state_db_dir(state: State<AppState>) -> Option<String> {
    state.state_db_path.lock().unwrap()
        .as_ref()
        .and_then(|p| p.parent().map(|d| d.to_string_lossy().into_owned()))
}

// ---------------------------------------------------------------------------
// DB viewer commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn db_load_all(db_path: String) -> Result<DbLoadResult, String> {
    if !std::path::Path::new(&db_path).exists() {
        return Ok(DbLoadResult { exists: false, records: vec![] });
    }
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, type, body, created_at, updated_at \
             FROM records ORDER BY type, created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let records = stmt
        .query_map([], |row| {
            Ok(Record {
                id: row.get(0)?,
                r#type: row.get(1)?,
                body: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(DbLoadResult { exists: true, records })
}

#[tauri::command]
fn db_update_record(db_path: String, id: String, body: String) -> Result<(), String> {
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let now = now_ms() / 1000;
    conn.execute(
        "UPDATE records SET body = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![body, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_delete_record(db_path: String, id: String) -> Result<(), String> {
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM records WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_insert_record(db_path: String, r#type: String, body: String) -> Result<Record, String> {
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS records (\
            id TEXT PRIMARY KEY, \
            type TEXT NOT NULL, \
            body TEXT NOT NULL, \
            created_at INTEGER NOT NULL, \
            updated_at INTEGER NOT NULL\
        );\
        CREATE INDEX IF NOT EXISTS records_type_idx ON records(type);",
    )
    .map_err(|e| e.to_string())?;
    let id = format!("{}:{}", r#type, gen_id());
    let now = now_ms() / 1000;
    conn.execute(
        "INSERT INTO records (id, type, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        rusqlite::params![id, r#type, body, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(Record { id, r#type, body, created_at: now, updated_at: now })
}

// ---------------------------------------------------------------------------

#[tauri::command]
async fn toggle_fullscreen(window: tauri::WebviewWindow) -> Result<(), String> {
    let is_full = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(!is_full).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------

pub fn run() {
    let app_state = AppState::default();
    // Clone the Arcs so protocol closures can access state without going
    // through Tauri State (UriSchemeContext has no .state() method).
    let protocol_files = Arc::clone(&app_state.files);
    let protocol_schema_version = Arc::clone(&app_state.stored_schema_version);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(app_state)
        .setup(|app| {
            // --- File association: handle .uix path passed as a CLI argument ---
            // On Windows/Linux, double-clicking a .uix sends it as argv[1].
            // On macOS, the deep-link plugin is needed; argv works in dev mode.
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = args.get(1).filter(|p| p.ends_with(".uix")) {
                *app.state::<AppState>().initial_path.lock().unwrap() = Some(path.clone());
            }

            // --- Window refs ---
            let main_window = app.get_webview_window("main").expect("main window must exist");
            let win_for_menu = main_window.clone();
            let handle = app.handle().clone();

            // --- Cleanup on window destroy: repack state.db into .uix + delete lock ---
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    let state = handle.state::<AppState>();
                    let uix_path = state.uix_path.lock().unwrap().clone();
                    if uix_path.is_empty() { return; }

                    let state_db_path = state.state_db_path.lock().unwrap().clone();
                    let state_mode = state.state_mode.lock().unwrap().clone();

                    // Drop DB connections before touching the files (important for WAL mode).
                    { let _ = state.state_db.lock().unwrap().take(); }
                    { let _ = state.data_db.lock().unwrap().take(); }

                    // Repack state.db back into the .uix file so state travels with it.
                    // Skipped when state.mode is "device" — archive must stay clean.
                    if state_mode != "device" {
                        if let Some(db_path) = state_db_path {
                            if db_path.exists() {
                                if let Err(e) = repack_uix(&uix_path, &db_path) {
                                    eprintln!("dotuix-viewer: repack failed: {e}");
                                    // The .tmp file (if created) is the recovery path.
                                }
                                // SM-6: warn if state.db exceeds 50 MB after repacking.
                                if let Ok(meta) = std::fs::metadata(&db_path) {
                                    if meta.len() > 50 * 1024 * 1024 {
                                        let _ = handle.emit("state-db-large", serde_json::json!({
                                            "bytes": meta.len(),
                                            "mb": meta.len() / (1024 * 1024)
                                        }));
                                    }
                                }
                            }
                        }
                    }

                    // Always delete the lock file, even if repack failed.
                    let _ = std::fs::remove_file(format!("{uix_path}.lock"));
                }
            });

            // --- App menu ---
            use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
            let open_m  = MenuItemBuilder::with_id("open_file", "Open\u{2026}").accelerator("CmdOrCtrl+O").build(app)?;
            let close_m = MenuItemBuilder::with_id("close_app", "Close File").accelerator("CmdOrCtrl+W").build(app)?;
            let fs_m    = MenuItemBuilder::with_id("toggle_fullscreen", "Enter Full Screen").accelerator("Ctrl+Cmd+F").build(app)?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_m).separator().item(&close_m).separator().quit().build()?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&fs_m).build()?;
            let menu = MenuBuilder::new(app).item(&file_menu).item(&view_menu).build()?;
            app.set_menu(menu)?;

            app.on_menu_event(move |_app, event| {
                match event.id().as_ref() {
                    "open_file"         => { win_for_menu.emit("menu-open-file", ()).ok(); }
                    "close_app"         => { win_for_menu.emit("menu-close-app", ()).ok(); }
                    "toggle_fullscreen" => {
                        let is = win_for_menu.is_fullscreen().unwrap_or(false);
                        win_for_menu.set_fullscreen(!is).ok();
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .register_uri_scheme_protocol("uix", move |_ctx, req: Request<Vec<u8>>| {
            let raw_path = req.uri().path().to_string();
            let path = raw_path.trim_start_matches('/');
            let path = if path.is_empty() { "index.html" } else { path };

            let map = protocol_files.lock().unwrap();

            match map.get(path) {
                Some(data) => {
                    let mime = mime_for(path);
                    let body = if mime.starts_with("text/html") {
                        let manifest_json = map
                            .get("manifest.json")
                            .map(|b| String::from_utf8_lossy(b).into_owned())
                            .unwrap_or_else(|| "{}".to_string());
                        let stored_v = *protocol_schema_version.lock().unwrap();
                        let script = bridge_script(&manifest_json, stored_v);
                        let html = String::from_utf8_lossy(data);
                        if html.contains("<head>") {
                            html.replacen("<head>", &format!("<head>{script}"), 1)
                                .into_bytes()
                        } else {
                            let mut out = script.into_bytes();
                            out.extend_from_slice(data);
                            out
                        }
                    } else {
                        data.to_vec()
                    };

                    Response::builder()
                        .status(200)
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(body)
                        .unwrap()
                }
                None => Response::builder()
                    .status(404)
                    .header("Content-Type", "text/plain")
                    .body(format!("Not found: {path}").into_bytes())
                    .unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![
            pick_and_load_uix,
            load_uix,
            close_uix,
            unlock_with_pin,
            get_initial_file,
            get_manifest,
            uix_exit,
            data_find,
            data_get,
            data_raw,
            state_find,
            state_get,
            state_insert,
            state_update,
            state_delete,
            state_purge,
            state_raw,
            data_count,
            state_count,
            state_transaction,
            state_clear,
            state_reset,
            state_upsert,
            state_insert_many,
            state_size,
            state_vacuum,
            schema_version_set,
            schema_upgrade_begin,
            schema_upgrade_commit,
            schema_upgrade_rollback,
            state_export_bundle,
            state_import_bundle,
            state_sync,
            uix_enter_fullscreen,
            uix_exit_fullscreen,
            uix_toggle_fullscreen,
            uix_save_file,
            uix_open_file,
            uix_open_url,
            uix_set_window_title,
            uix_notify,
            get_state_db_dir,
            db_load_all,
            db_update_record,
            db_delete_record,
            db_insert_record,
            toggle_fullscreen,
            license_get,
            license_has_feature,
            pick_and_install_license,
            get_device_id,
        ])
.build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS: handle file-association opens (Apple Events / NSApplicationDelegate).
            // Double-clicking a .uix file does NOT pass it as argv[1] on macOS —
            // the OS delivers it via RunEvent::Opened (NSApplicationDelegate openURLs:).
            #[cfg(target_os = "macos")]
            {
                if let tauri::RunEvent::Opened { urls } = event {
                    let paths: Vec<String> = urls
                        .iter()
                        .filter_map(|u| u.to_file_path().ok())
                        .filter(|p| p.extension().map(|e| e == "uix").unwrap_or(false))
                        .filter_map(|p| p.to_str().map(String::from))
                        .collect();
                    if let Some(path) = paths.first().cloned() {
                        // Store so get_initial_file() picks it up on frontend mount
                        let state = app.state::<AppState>();
                        *state.initial_path.lock().unwrap() = Some(path.clone());
                        // Also emit for the case where the window is already loaded
                        if let Some(win) = app.get_webview_window("main") {
                            win.emit("uix-file-opened", &path).ok();
                        }
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

// =============================================================================
// Unit tests
// =============================================================================
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn filters(pairs: &[(&str, serde_json::Value)]) -> HashMap<String, serde_json::Value> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    // ── order_term ────────────────────────────────────────────────────────────

    #[test]
    fn order_term_string_shorthand_is_body_asc() {
        assert_eq!(
            order_term(&json!("price")).unwrap(),
            "json_extract(body, '$.price') ASC"
        );
    }

    #[test]
    fn order_term_builtin_columns_bypass_json_extract() {
        for col in &["id", "type", "created_at", "updated_at"] {
            assert_eq!(
                order_term(&json!(col)).unwrap(),
                format!("{col} ASC"),
                "failed for column '{col}'"
            );
        }
    }

    #[test]
    fn order_term_object_asc() {
        assert_eq!(
            order_term(&json!({ "field": "sort", "direction": "asc" })).unwrap(),
            "json_extract(body, '$.sort') ASC"
        );
    }

    #[test]
    fn order_term_object_desc() {
        assert_eq!(
            order_term(&json!({ "field": "price", "direction": "desc" })).unwrap(),
            "json_extract(body, '$.price') DESC"
        );
    }

    #[test]
    fn order_term_direction_is_case_insensitive() {
        assert_eq!(
            order_term(&json!({ "field": "price", "direction": "DESC" })).unwrap(),
            "json_extract(body, '$.price') DESC"
        );
    }

    #[test]
    fn order_term_missing_direction_defaults_to_asc() {
        assert_eq!(
            order_term(&json!({ "field": "name" })).unwrap(),
            "json_extract(body, '$.name') ASC"
        );
    }

    #[test]
    fn order_term_builtin_column_with_desc() {
        assert_eq!(
            order_term(&json!({ "field": "created_at", "direction": "desc" })).unwrap(),
            "created_at DESC"
        );
    }

    #[test]
    fn order_term_non_string_non_object_falls_back_to_created_at_asc() {
        assert_eq!(order_term(&json!(42)).unwrap(), "created_at ASC");
        assert_eq!(order_term(&json!(null)).unwrap(), "created_at ASC");
    }

    // ── build_where_clause ────────────────────────────────────────────────────

    #[test]
    fn where_empty_filters_returns_nothing() {
        let (conds, params) = build_where_clause(&HashMap::new()).unwrap();
        assert!(conds.is_empty());
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn where_scalar_shorthand_is_equality() {
        let (conds, params) =
            build_where_clause(&filters(&[("category", json!("burgers"))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.category') = ?2"]);
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn where_eq_operator() {
        let (conds, params) =
            build_where_clause(&filters(&[("status", json!({ "eq": "active" }))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.status') = ?2"]);
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn where_neq_operator() {
        let (conds, params) =
            build_where_clause(&filters(&[("status", json!({ "neq": "archived" }))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.status') != ?2"]);
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn where_gt_operator() {
        let (conds, params) =
            build_where_clause(&filters(&[("price", json!({ "gt": 10 }))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.price') > ?2"]);
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn where_gte_operator() {
        let (conds, params) =
            build_where_clause(&filters(&[("price", json!({ "gte": 10 }))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.price') >= ?2"]);
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn where_lt_operator() {
        let (conds, params) =
            build_where_clause(&filters(&[("qty", json!({ "lt": 5 }))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.qty') < ?2"]);
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn where_lte_operator() {
        let (conds, params) =
            build_where_clause(&filters(&[("qty", json!({ "lte": 5 }))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.qty') <= ?2"]);
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn where_like_operator() {
        let (conds, params) =
            build_where_clause(&filters(&[("name", json!({ "like": "%burger%" }))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.name') LIKE ?2"]);
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn where_in_operator_binds_all_items() {
        let (conds, params) =
            build_where_clause(&filters(&[("cat", json!({ "in": ["a", "b", "c"] }))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.cat') IN (?2, ?3, ?4)"]);
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn where_in_empty_array_produces_always_false() {
        let (conds, params) =
            build_where_clause(&filters(&[("cat", json!({ "in": [] }))])).unwrap();
        assert_eq!(conds, ["1 = 0"]);
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn where_is_null_true_is_null() {
        let (conds, params) =
            build_where_clause(&filters(&[("archived", json!({ "is_null": true }))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.archived') IS NULL"]);
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn where_is_null_false_is_not_null() {
        let (conds, params) =
            build_where_clause(&filters(&[("archived", json!({ "is_null": false }))])).unwrap();
        assert_eq!(conds, ["json_extract(body, '$.archived') IS NOT NULL"]);
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn where_unknown_operator_returns_error_mentioning_it() {
        let result = build_where_clause(&filters(&[("f", json!({ "regex": ".*" }))]));
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.contains("regex"), "expected 'regex' in error: {err}");
    }

    #[test]
    fn where_in_non_array_operand_returns_error() {
        let result = build_where_clause(&filters(&[("f", json!({ "in": "not-array" }))]));
        assert!(result.is_err());
    }

    #[test]
    fn where_invalid_identifier_is_rejected() {
        let result = build_where_clause(&filters(&[("field;drop", json!("value"))]));
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.contains("field;drop"), "expected field name in error: {err}");
    }
}
