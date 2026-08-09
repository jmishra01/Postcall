use base64::Engine;
use reqwest::{header::HeaderMap, Method};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, sync::Mutex, time::Instant};
use tauri::{Manager, State};

struct AppState {
    database: Mutex<Connection>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestInput {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    #[serde(default)]
    multipart: Vec<MultipartField>,
    binary: Option<BinaryFile>,
    timeout_ms: u64,
    follow_redirects: bool,
    validate_certificates: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MultipartField {
    name: String,
    value: String,
    kind: String,
    file_name: Option<String>,
    mime_type: Option<String>,
    data_base64: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinaryFile {
    file_name: String,
    mime_type: String,
    data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyValue {
    id: String,
    key: String,
    value: String,
    enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseData {
    status: u16,
    status_text: String,
    headers: Vec<KeyValue>,
    body: String,
    content_type: String,
    elapsed_ms: u128,
    size_bytes: usize,
    url: String,
}

#[tauri::command]
async fn execute_http(input: RequestInput) -> Result<ResponseData, String> {
    let method = Method::from_bytes(input.method.as_bytes())
        .map_err(|error| format!("Invalid HTTP method: {error}"))?;
    let parsed_url =
        url::Url::parse(&input.url).map_err(|error| format!("Invalid request URL: {error}"))?;

    let redirect_policy = if input.follow_redirects {
        reqwest::redirect::Policy::limited(10)
    } else {
        reqwest::redirect::Policy::none()
    };

    let client = reqwest::Client::builder()
        .redirect(redirect_policy)
        .danger_accept_invalid_certs(!input.validate_certificates)
        .timeout(std::time::Duration::from_millis(input.timeout_ms))
        .user_agent(format!("Postcall/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not initialize HTTP client: {error}"))?;

    let mut request = client.request(method.clone(), parsed_url);
    for (name, value) in input.headers {
        let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("Invalid header name '{name}': {error}"))?;
        let header_value = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|error| format!("Invalid value for header '{name}': {error}"))?;
        request = request.header(header_name, header_value);
    }

    if method != Method::GET && method != Method::HEAD {
        if !input.multipart.is_empty() {
            let mut form = reqwest::multipart::Form::new();
            for field in input.multipart {
                if field.kind == "file" {
                    let data = base64::engine::general_purpose::STANDARD
                        .decode(field.data_base64.unwrap_or_default())
                        .map_err(|error| {
                            format!("Could not decode upload '{}': {error}", field.name)
                        })?;
                    let mut part = reqwest::multipart::Part::bytes(data)
                        .file_name(field.file_name.unwrap_or_else(|| "upload.bin".into()));
                    if let Some(mime_type) = field.mime_type {
                        part = part
                            .mime_str(&mime_type)
                            .map_err(|error| format!("Invalid upload MIME type: {error}"))?;
                    }
                    form = form.part(field.name, part);
                } else {
                    form = form.text(field.name, field.value);
                }
            }
            request = request.multipart(form);
        } else if let Some(binary) = input.binary {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(binary.data_base64)
                .map_err(|error| {
                    format!(
                        "Could not decode binary file '{}': {error}",
                        binary.file_name
                    )
                })?;
            if !binary.mime_type.is_empty() {
                request = request.header(reqwest::header::CONTENT_TYPE, binary.mime_type);
            }
            request = request.body(bytes);
        } else if let Some(body) = input.body {
            request = request.body(body);
        }
    }

    let started = Instant::now();
    let response = request.send().await.map_err(describe_request_error)?;
    let elapsed_ms = started.elapsed().as_millis();
    let status = response.status();
    let final_url = response.url().to_string();
    let response_headers = response.headers().clone();
    let content_type = response_headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed while reading the response: {error}"))?;
    let size_bytes = bytes.len();
    let body = String::from_utf8_lossy(&bytes).into_owned();

    Ok(ResponseData {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("Unknown").to_string(),
        headers: serialize_headers(&response_headers),
        body,
        content_type,
        elapsed_ms,
        size_bytes,
        url: final_url,
    })
}

fn describe_request_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "The request timed out. Increase the timeout in Settings or check the server.".into()
    } else if error.is_connect() {
        format!("Could not connect to the server: {error}")
    } else if error.is_redirect() {
        format!("The redirect limit was reached: {error}")
    } else {
        format!("Request failed: {error}")
    }
}

fn serialize_headers(headers: &HeaderMap) -> Vec<KeyValue> {
    headers
        .iter()
        .enumerate()
        .map(|(index, (name, value))| KeyValue {
            id: format!("response-header-{index}"),
            key: name.to_string(),
            value: value.to_str().unwrap_or("<binary value>").to_string(),
            enabled: true,
        })
        .collect()
}

#[tauri::command]
fn load_workspace(state: State<'_, AppState>) -> Result<Option<Value>, String> {
    let database = state.database.lock().map_err(|_| "Database lock failed")?;
    let mut statement = database
        .prepare("SELECT data FROM workspace_state WHERE id = 1")
        .map_err(|error| format!("Could not prepare workspace query: {error}"))?;

    let result: Result<String, _> = statement.query_row([], |row| row.get(0));
    match result {
        Ok(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|error| format!("Stored workspace is invalid: {error}")),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Could not load workspace: {error}")),
    }
}

#[tauri::command]
fn save_workspace(workspace: Value, state: State<'_, AppState>) -> Result<(), String> {
    let json = serde_json::to_string(&workspace)
        .map_err(|error| format!("Could not serialize workspace: {error}"))?;
    let database = state.database.lock().map_err(|_| "Database lock failed")?;
    database
        .execute(
            "INSERT INTO workspace_state (id, data, updated_at)
             VALUES (1, ?1, unixepoch())
             ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            params![json],
        )
        .map_err(|error| format!("Could not save workspace: {error}"))?;
    Ok(())
}

#[tauri::command]
fn get_storage_path(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("postcall.sqlite3").display().to_string())
        .map_err(|error| format!("Could not resolve the storage path: {error}"))
}

fn open_database(app: &tauri::App) -> Result<Connection, Box<dyn std::error::Error>> {
    let app_data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_data_dir)?;
    let database = Connection::open(app_data_dir.join("postcall.sqlite3"))?;
    database.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS workspace_state (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           data TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         );",
    )?;
    Ok(database)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database = open_database(app)?;
            app.manage(AppState {
                database: Mutex::new(database),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            execute_http,
            load_workspace,
            save_workspace,
            get_storage_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Postcall");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_headers_are_serialized() {
        let mut headers = HeaderMap::new();
        headers.insert("x-postcall", "ready".parse().unwrap());
        let result = serialize_headers(&headers);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].key, "x-postcall");
        assert_eq!(result[0].value, "ready");
    }
}
