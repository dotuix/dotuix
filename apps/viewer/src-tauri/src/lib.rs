use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::sync::{Arc, Mutex};
use tauri::{
    http::{Request, Response},
    AppHandle, State,
};

// In-memory store of the currently loaded .uix file contents (filename → bytes).
type FileStore = Arc<Mutex<HashMap<String, Vec<u8>>>>;

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

/// Read a .uix ZIP archive from disk into a filename→bytes map.
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

/// Minimal __uix bridge script injected into the .uix HTML before it runs.
/// Provides manifest data; data/state return empty results for M4.
/// M5 will replace these stubs with full Tauri IPC calls.
fn bridge_script(manifest_json: &str) -> String {
    format!(
        r#"<script>
(function () {{
  var m = {manifest_json};
  window.__uix = {{
    manifest: m,
    data: {{
      find: function () {{ return Promise.resolve([]); }},
      get:  function () {{ return Promise.resolve(null); }},
    }},
    state: {{
      find:   function () {{ return Promise.resolve([]); }},
      get:    function () {{ return Promise.resolve(null); }},
      insert: function () {{ return Promise.reject(new Error('state not available in M4')); }},
      update: function () {{ return Promise.reject(new Error('state not available in M4')); }},
      delete: function () {{ return Promise.reject(new Error('state not available in M4')); }},
    }},
  }};
}})();
</script>"#
    )
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Open a native file-picker and load the chosen .uix file.
/// Returns the manifest JSON string on success.
#[tauri::command]
fn pick_and_load_uix(app: AppHandle, store: State<'_, FileStore>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let maybe_path = app
        .dialog()
        .file()
        .add_filter("UIX App", &["uix"])
        .blocking_pick_file();

    let file = maybe_path.ok_or_else(|| "No file selected".to_string())?;
    let path_str = file.to_string();

    load_uix_impl(&path_str, &store)
}

/// Load a .uix file from an explicit path (e.g. from CLI argv / file association).
#[tauri::command]
fn load_uix(path: String, store: State<'_, FileStore>) -> Result<String, String> {
    load_uix_impl(&path, &store)
}

fn load_uix_impl(path: &str, store: &FileStore) -> Result<String, String> {
    let files = read_uix(path)?;
    let manifest_json = files
        .get("manifest.json")
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .ok_or_else(|| "manifest.json not found in archive".to_string())?;

    // Validate it's parseable JSON before storing
    serde_json::from_str::<serde_json::Value>(&manifest_json)
        .map_err(|e| format!("Invalid manifest.json: {e}"))?;

    *store.lock().unwrap() = files;
    Ok(manifest_json)
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store: FileStore = Arc::new(Mutex::new(HashMap::new()));
    // Clone the Arc so the protocol handler can capture it without going through app state.
    let protocol_store = Arc::clone(&store);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(store)
        .register_uri_scheme_protocol("uix", move |_ctx, req: Request<Vec<u8>>| {
            let raw_path = req.uri().path().to_string();
            let path = raw_path.trim_start_matches('/');
            let path = if path.is_empty() { "index.html" } else { path };

            let map = protocol_store.lock().unwrap();

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
        .invoke_handler(tauri::generate_handler![pick_and_load_uix, load_uix])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
