use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    http::{Request, Response},
    AppHandle, Manager, State,
};

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
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            files: Arc::new(Mutex::new(HashMap::new())),
            state_db: Mutex::new(None),
            data_db: Mutex::new(None),
            app_id: Mutex::new(String::new()),
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
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "wasm" => "application/wasm",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "application/octet-stream",
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
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        files.insert(name, buf);
    }
    Ok(files)
}

fn ensure_state_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS records (
            id          TEXT    PRIMARY KEY,
            type        TEXT    NOT NULL,
            body        TEXT    NOT NULL DEFAULT '{}',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS records_type_idx ON records(type);",
    )
    .map_err(|e| e.to_string())
}

fn load_uix_impl(path: &str, app: &AppHandle, state: &AppState) -> Result<String, String> {
    let files = read_uix(path)?;

    let manifest_json = files
        .get("manifest.json")
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .ok_or_else(|| "manifest.json not found in archive".to_string())?;

    let manifest: serde_json::Value = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("Invalid manifest.json: {e}"))?;

    let app_id = manifest["id"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    // --- state.db: persisted per app-id so cart survives viewer restarts ---
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {e}"))?
        .join(&app_id);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let state_db_path = data_dir.join("state.db");

    // On first run: seed from the archive's state.db (if present), else create fresh.
    if !state_db_path.exists() {
        if let Some(seed) = files.get("state.db") {
            std::fs::write(&state_db_path, seed).map_err(|e| e.to_string())?;
        }
    }

    let state_conn = rusqlite::Connection::open(&state_db_path)
        .map_err(|e| format!("Cannot open state.db: {e}"))?;
    ensure_state_schema(&state_conn)?;

    // --- data.db: read-only, extracted fresh from .uix each run ---
    let data_conn = if let Some(bytes) = files.get("data.db") {
        let tmp = std::env::temp_dir().join(format!("dotuix_{}_data.db", &app_id));
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

    Ok(manifest_json)
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
      find: function (opts)  {{ return relay('data_find', {{ type: (opts && opts.type) || opts }}); }},
      get:  function (id)    {{ return relay('data_get',  {{ id: id }}); }},
    }},
    state: {{
      find:   function (opts)        {{ return relay('state_find', {{ type: (opts && opts.type) || opts }}); }},
      get:    function (id)          {{ return relay('state_get',  {{ id: id }}); }},
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
    }},
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
        .pick_file(move |maybe_path| {
            let _ = tx.send(maybe_path);
        });

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
    Ok(Record {
        id,
        r#type,
        body,
        created_at: now,
        updated_at: now,
    })
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
            data_find,
            data_get,
            state_find,
            state_get,
            state_insert,
            state_update,
            state_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
