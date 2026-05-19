use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    http::{Request, Response},
    AppHandle, Manager, State,
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
        }
    }
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

fn load_uix_impl(path: &str, app: &AppHandle, state: &AppState) -> Result<String, String> {
    let files = read_uix(path)?;

    let manifest_json = files
        .get("manifest.json")
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .ok_or_else(|| "manifest.json not found in archive".to_string())?;

    let manifest: serde_json::Value = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("Invalid manifest.json: {e}"))?;

    // --- Expiry check (before touching any files) ---
    if let Some(exp) = manifest.get("expires").and_then(|v| v.as_str()) {
        let today = today_iso();
        if exp < today.as_str() {
            return Err(format!("This .uix file expired on {exp}. It can no longer be opened."));
        }
    }

    // --- minViewer check ---
    if let Some(min_ver) = manifest.get("minViewer").and_then(|v| v.as_str()) {
        if !version_gte(VIEWER_VERSION, min_ver) {
            return Err(format!(
                "This file requires viewer v{min_ver} or later. Current viewer: v{VIEWER_VERSION}. Please update."
            ));
        }
    }

    let app_id = manifest["id"].as_str().unwrap_or("unknown").to_string();

    // --- Lock file ---
    let lock_path = format!("{path}.lock");
    if std::path::Path::new(&lock_path).exists() {
        return Err(format!(
            "This file is already open in another viewer instance, or the previous session crashed.\n\
             Delete '{lock_path}' to open it."
        ));
    }
    let lock_content = format!(
        "{{\"pid\":{},\"opened_at\":{}}}",
        std::process::id(),
        now_ms()
    );
    std::fs::write(&lock_path, lock_content.as_bytes())
        .map_err(|e| format!("Cannot create lock file: {e}"))?;

    // --- state.db: persisted per app-id so cart survives viewer restarts ---
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {e}"))?
        .join(&app_id);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let state_db_path = data_dir.join("state.db");

    // On first run: seed from the archive's state.db if manifest.state.seed == true.
    let should_seed = manifest
        .get("state")
        .and_then(|s| s.get("seed"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if !state_db_path.exists() {
        if should_seed {
            if let Some(seed) = files.get("state.db") {
                std::fs::write(&state_db_path, seed).map_err(|e| e.to_string())?;
            }
        }
        // else: rusqlite creates a fresh file
    }

    let state_conn = rusqlite::Connection::open(&state_db_path)
        .map_err(|e| format!("Cannot open state.db: {e}"))?;
    ensure_state_schema(&state_conn, &app_id)?;

    // --- data.db: read-only, extracted fresh from .uix each run ---
    let data_conn = if let Some(bytes) = files.get("data.db") {
        let tmp = std::env::temp_dir().join(format!("dotuix_{app_id}_data.db"));
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        let conn = rusqlite::Connection::open_with_flags(
            &tmp,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| format!("Cannot open data.db: {e}"))?;
        Some(conn)
    } else {
        None
    };

    *state.files.lock().unwrap() = files;
    *state.state_db.lock().unwrap() = Some(state_conn);
    *state.data_db.lock().unwrap() = data_conn;
    *state.app_id.lock().unwrap() = app_id;
    *state.uix_path.lock().unwrap() = path.to_string();
    *state.state_db_path.lock().unwrap() = Some(state_db_path);

    Ok(manifest_json)
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
    let _ = std::fs::rename(uix_path, &bak_path); // keep rolling backup (ignore error)
    std::fs::rename(&tmp_path, uix_path)
        .map_err(|e| format!("Repack: atomic rename failed: {e}"))?;

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
      find: function (opts)  {{ return relay('data_find',   {{ type: (opts && opts.type) || opts }}); }},
      get:  function (id)    {{ return relay('data_get',    {{ id: id }}); }},
    }},
    state: {{
      find:   function (opts)        {{ return relay('state_find',  {{ type: (opts && opts.type) || opts }}); }},
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
    }},
    print: function () {{ window.print(); }},
    exit:  function () {{ return relay('uix_exit', {{}}); }},
  }};
}})();
</script>"#
    )
}

// ---------------------------------------------------------------------------
// Tauri commands -- file loading
// ---------------------------------------------------------------------------

#[tauri::command]
async fn pick_and_load_uix(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
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

    load_uix_impl(&file.to_string(), &app, &state)
}

#[tauri::command]
fn load_uix(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    load_uix_impl(&path, &app, &state)
}

/// Returns (and clears) the .uix path that was passed as a CLI argument on launch.
/// Called once by the frontend on startup to auto-open a file from file association.
#[tauri::command]
fn get_initial_file(state: State<'_, AppState>) -> Option<String> {
    state.initial_path.lock().unwrap().take()
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

fn query_records(conn: &rusqlite::Connection, type_filter: &str) -> Result<Vec<Record>, String> {
    let mut stmt = conn
        .prepare("SELECT id, type, body, created_at, updated_at FROM records WHERE type = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([type_filter], |row| {
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

#[tauri::command]
fn data_find(r#type: String, state: State<'_, AppState>) -> Result<Vec<Record>, String> {
    let db = state.data_db.lock().unwrap();
    match db.as_ref() {
        None => Ok(vec![]),
        Some(conn) => query_records(conn, &r#type),
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

// ---------------------------------------------------------------------------
// Tauri commands -- state bridge (mutable records in state.db)
// ---------------------------------------------------------------------------

#[tauri::command]
fn state_find(r#type: String, state: State<'_, AppState>) -> Result<Vec<Record>, String> {
    let db = state.state_db.lock().unwrap();
    let conn = db.as_ref().ok_or("No app loaded")?;
    query_records(conn, &r#type)
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

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::default();
    // Clone the files Arc so the uix:// protocol closure can access it without
    // going through Tauri State (UriSchemeContext has no .state() method).
    let protocol_files = Arc::clone(&app_state.files);

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

            // --- Cleanup on window destroy: repack state.db into .uix + delete lock ---
            let main_window = app.get_webview_window("main").expect("main window must exist");
            let handle = app.handle().clone();
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
        .invoke_handler(tauri::generate_handler![
            pick_and_load_uix,
            load_uix,
            get_initial_file,
            get_manifest,
            uix_exit,
            data_find,
            data_get,
            state_find,
            state_get,
            state_insert,
            state_update,
            state_delete,
            state_purge,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
