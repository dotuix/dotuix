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
    /// manifest.permissions — gates raw-sql and other optional bridge capabilities.
    permissions: Mutex<Vec<String>>,
    /// Files from the archive pending PIN-based decryption.
    pending_files: Mutex<Option<HashMap<String, Vec<u8>>>>,
    /// Parsed manifest pending completion after PIN unlock.
    pending_manifest: Mutex<Option<serde_json::Value>>,
    /// .uix path whose load is awaiting PIN entry.
    pending_path: Mutex<Option<String>>,
    /// Project folder currently open in developer mode; shared with devpreview:// protocol.
    preview_dir: Arc<Mutex<Option<String>>>,
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
            permissions: Mutex::new(Vec::new()),
            pending_files: Mutex::new(None),
            pending_manifest: Mutex::new(None),
            pending_path: Mutex::new(None),
            preview_dir: Arc::new(Mutex::new(None)),
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
        use std::os::windows::io::RawHandle;
        const SYNCHRONIZE: u32 = 0x00100000;
        let handle = unsafe { windows_sys::Win32::System::Threading::OpenProcess(SYNCHRONIZE, 0, pid) };
        if handle == 0 { return false; }
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

    // Populate meta once; INSERT OR IGNORE is a no-op on subsequent opens.
    conn.execute_batch(&format!(
        "INSERT OR IGNORE INTO meta VALUES ('schema_version', '1');
         INSERT OR IGNORE INTO meta VALUES ('uix_version',    '1.0');
         INSERT OR IGNORE INTO meta VALUES ('app_id',         '{}');",
        app_id.replace('\'', "''")
    ))
    .map_err(|e| e.to_string())
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

    let permissions: Vec<String> = manifest
        .get("permissions").and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    // --- Close any previously open file first ---
    {
        let prev_path = state.uix_path.lock().unwrap().clone();
        if !prev_path.is_empty() && prev_path != path {
            let prev_state_db_path = state.state_db_path.lock().unwrap().clone();
            { let _ = state.state_db.lock().unwrap().take(); }
            { let _ = state.data_db.lock().unwrap().take(); }
            if let Some(db_path) = prev_state_db_path {
                if db_path.exists() { let _ = repack_uix(&prev_path, &db_path); }
            }
            let _ = std::fs::remove_file(format!("{prev_path}.lock"));
        }
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

    // --- Per-app data directory ---
    let data_dir = app
        .path().app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {e}"))?.join(&app_id);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    // --- state.db ---
    let state_db_path = data_dir.join("state.db");
    let should_seed = manifest
        .get("state").and_then(|s| s.get("seed")).and_then(|v| v.as_bool()).unwrap_or(false);
    if !state_db_path.exists() && should_seed {
        if let Some(seed) = files.get("state.db") {
            std::fs::write(&state_db_path, seed).map_err(|e| e.to_string())?;
        }
    }
    let state_conn = rusqlite::Connection::open(&state_db_path)
        .map_err(|e| format!("Cannot open state.db: {e}"))?;
    ensure_state_schema(&state_conn, &app_id)?;

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
    *state.uix_path.lock().unwrap() = path.to_string();
    *state.state_db_path.lock().unwrap() = Some(state_db_path);
    *state.permissions.lock().unwrap() = permissions;

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

fn bridge_script(manifest_json: &str) -> String {
    format!(
        r#"<script>
(function () {{
  var m = {manifest_json};
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
    manifest: m,
    data: {{
      find: function (opts) {{
        var q = (typeof opts === 'string') ? {{ type: opts }} : Object.assign({{}}, opts);
        return relay('data_find', {{ query: q }});
      }},
      get:  function (id)              {{ return relay('data_get',  {{ id: id }}); }},
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
      raw:    function (sql, params) {{ return relay('state_raw',  {{ sql: sql, params: params || [] }}); }},
    }},
    print: function () {{ window.print(); }},
    exit:  function () {{ return relay('uix_exit', {{}}); }},
  }};
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
    /// Column or body field to sort by: "created_at", "updated_at", "id", or any body field.
    #[serde(rename = "orderBy")]
    order_by: Option<String>,
    /// Maximum number of rows to return.
    limit: Option<u32>,
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

/// Build and execute a filtered SELECT against a `records` table.
fn query_records(conn: &rusqlite::Connection, query: &FindQuery) -> Result<Vec<Record>, String> {
    let mut conditions: Vec<String> = vec!["type = ?1".to_string()];
    let mut extra_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(filters) = &query.filters {
        for (key, val) in filters {
            validate_identifier(key, "where field")?;
            let idx = extra_params.len() + 2; // ?1 = type, ?2.. = filter values
            conditions.push(format!("json_extract(body, '$.{key}') = ?{idx}"));
            extra_params.push(json_to_sql_param(val));
        }
    }

    let mut sql = format!(
        "SELECT id, type, body, created_at, updated_at FROM records WHERE {}",
        conditions.join(" AND ")
    );

    if let Some(order) = &query.order_by {
        let order_sql = match order.as_str() {
            "id" | "type" | "created_at" | "updated_at" => order.clone(),
            col => {
                validate_identifier(col, "orderBy")?;
                format!("json_extract(body, '$.{col}')")
            }
        };
        sql.push_str(&format!(" ORDER BY {order_sql}"));
    }

    if let Some(limit) = query.limit {
        sql.push_str(&format!(" LIMIT {limit}"));
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
    { let _ = state.state_db.lock().unwrap().take(); }
    { let _ = state.data_db.lock().unwrap().take(); }
    if let Some(db_path) = state_db_path {
        if db_path.exists() { let _ = repack_uix(&uix_path, &db_path); }
    }
    let _ = std::fs::remove_file(format!("{uix_path}.lock"));
    *state.uix_path.lock().unwrap() = String::new();
    *state.state_db_path.lock().unwrap() = None;
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
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// ---------------------------------------------------------------------------
// Developer mode — types & helpers
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<DirEntry>>,
}

fn read_dir_recursive(dir: &std::path::Path, depth: u32) -> Vec<DirEntry> {
    if depth > 8 {
        return vec![];
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let mut result: Vec<DirEntry> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            let path = e.path();
            let path_str = path.to_string_lossy().to_string();
            if path.is_dir() {
                Some(DirEntry {
                    name,
                    path: path_str,
                    is_dir: true,
                    children: Some(read_dir_recursive(&path, depth + 1)),
                })
            } else {
                Some(DirEntry { name, path: path_str, is_dir: false, children: None })
            }
        })
        .collect();
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    result
}

fn pack_add_dir(
    zip: &mut zip::ZipWriter<std::fs::File>,
    base: &std::path::Path,
    dir: &std::path::Path,
) -> Result<(), String> {
    const TEXT_EXTS: &[&str] = &[
        "html", "htm", "js", "mjs", "cjs", "css", "json", "ts", "tsx", "jsx",
        "svg", "txt", "md", "yaml", "yml", "xml",
    ];
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let rel = path.strip_prefix(base).map_err(|e| e.to_string())?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        // Skip hidden paths
        if rel_str.split('/').any(|seg| seg.starts_with('.')) {
            continue;
        }
        if path.is_dir() {
            pack_add_dir(zip, base, &path)?;
        } else {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            let method = if TEXT_EXTS.contains(&ext.as_str()) {
                zip::CompressionMethod::Deflated
            } else {
                zip::CompressionMethod::Stored
            };
            let opts = zip::write::SimpleFileOptions::default().compression_method(method);
            zip.start_file(&rel_str, opts).map_err(|e| e.to_string())?;
            let data = std::fs::read(&path).map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn pack_dir_to_zip(src_dir: &str, out_path: &str) -> Result<(), String> {
    let src = std::path::Path::new(src_dir);
    let out_file = std::fs::File::create(out_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(out_file);
    pack_add_dir(&mut zip, src, src)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct DbLoadResult {
    exists: bool,
    records: Vec<Record>,
}

// ---------------------------------------------------------------------------
// Developer mode — Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn editor_open_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .pick_folder(move |maybe_path| { let _ = tx.send(maybe_path); });
    let result = rx.await.map_err(|_| "Dialog closed unexpectedly".to_string())?;
    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
fn editor_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    Ok(read_dir_recursive(std::path::Path::new(&path), 0))
}

#[tauri::command]
fn editor_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn editor_write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn editor_pack_uix(src_dir: String, out_path: String) -> Result<(), String> {
    pack_dir_to_zip(&src_dir, &out_path)
}

#[tauri::command]
fn editor_show_save_dialog(app: AppHandle, default_name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let result = app
        .dialog()
        .file()
        .add_filter("UIX App", &["uix"])
        .set_file_name(&default_name)
        .blocking_save_file();
    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
fn editor_set_preview_dir(path: String, state: State<AppState>) -> Result<(), String> {
    *state.preview_dir.lock().unwrap() = Some(path);
    Ok(())
}

#[tauri::command]
fn editor_clear_preview_dir(state: State<AppState>) {
    *state.preview_dir.lock().unwrap() = None;
}

#[tauri::command]
fn editor_reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    {
        let p = std::path::Path::new(&path);
        let dir = if p.is_file() {
            p.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or(path)
        } else {
            path
        };
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

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
    let protocol_preview_dir = Arc::clone(&app_state.preview_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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

                    // Drop DB connections before touching the files (important for WAL mode).
                    { let _ = state.state_db.lock().unwrap().take(); }
                    { let _ = state.data_db.lock().unwrap().take(); }

                    // Repack state.db back into the .uix file so state travels with it.
                    if let Some(db_path) = state_db_path {
                        if db_path.exists() {
                            if let Err(e) = repack_uix(&uix_path, &db_path) {
                                eprintln!("dotuix-viewer: repack failed: {e}");
                                // The .tmp file (if created) is the recovery path.
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
            let dev_m   = MenuItemBuilder::with_id("dev_mode", "Developer Mode").accelerator("CmdOrCtrl+Shift+D").build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_m).separator().item(&close_m).separator().quit().build()?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&fs_m).separator().item(&dev_m).build()?;
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
                    "dev_mode"          => { win_for_menu.emit("menu-dev-mode", ()).ok(); }
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
                        let script = bridge_script(&manifest_json);
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
        .register_uri_scheme_protocol("devpreview", move |_ctx, req: Request<Vec<u8>>| {
            let raw_path = req.uri().path().to_string();
            let rel = raw_path.trim_start_matches('/');
            let rel = if rel.is_empty() { "index.html" } else { rel };

            let dir_opt = protocol_preview_dir.lock().unwrap().clone();
            match dir_opt {
                None => Response::builder()
                    .status(503)
                    .header("Content-Type", "text/plain")
                    .body(b"No preview directory set".to_vec())
                    .unwrap(),
                Some(dir) => {
                    let full = std::path::Path::new(&dir).join(rel);
                    match std::fs::read(&full) {
                        Ok(data) => Response::builder()
                            .status(200)
                            .header("Content-Type", mime_for(rel))
                            .header("Access-Control-Allow-Origin", "*")
                            .body(data)
                            .unwrap(),
                        Err(_) => Response::builder()
                            .status(404)
                            .header("Content-Type", "text/plain")
                            .body(format!("Not found: {rel}").into_bytes())
                            .unwrap(),
                    }
                }
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
            // Editor / developer mode
            editor_open_folder,
            editor_read_dir,
            editor_read_file,
            editor_write_file,
            editor_pack_uix,
            editor_show_save_dialog,
            editor_set_preview_dir,
            editor_clear_preview_dir,
            editor_reveal_in_folder,
            db_load_all,
            db_update_record,
            db_delete_record,
            db_insert_record,
            toggle_fullscreen,
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
