use base64::Engine;
use reqwest::{header, Client, StatusCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::AppState;

const KEYRING_SERVICE: &str = "postcall";
const KEYRING_USER: &str = "github-token";
const API_BASE: &str = "https://api.github.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubConfig {
    pub owner: String,
    pub repo: String,
    pub branch: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CollectionPush {
    pub id: String,
    pub name: String,
    pub data: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionPullOutcome {
    collection_id: String,
    file: String,
    outcome: String, // "updated" | "unchanged" | "error"
    data: Option<Value>,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionPushOutcome {
    collection_id: String,
    outcome: String, // "pushed" | "conflict" | "error"
    remote: Option<Value>,
    message: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Manifest {
    version: u32,
    collections: Vec<ManifestEntry>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct ManifestEntry {
    id: String,
    file: String,
}

struct RemoteFile {
    content: Vec<u8>,
    sha: String,
}

enum PutOutcome {
    Updated(String),
    Conflict,
}

pub fn init_schema(database: &Connection) -> rusqlite::Result<()> {
    database.execute_batch(
        "CREATE TABLE IF NOT EXISTS github_config (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           owner TEXT NOT NULL,
           repo TEXT NOT NULL,
           branch TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS github_sync_state (
           collection_id TEXT PRIMARY KEY,
           remote_sha TEXT NOT NULL,
           local_hash TEXT NOT NULL,
           synced_at INTEGER NOT NULL
         );",
    )
}

#[tauri::command]
pub fn github_set_config(
    config: GitHubConfig,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let database = state.database.lock().map_err(|_| "Database lock failed")?;
        database
            .execute(
                "INSERT INTO github_config (id, owner, repo, branch) VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, repo = excluded.repo, branch = excluded.branch",
                params![config.owner, config.repo, config.branch],
            )
            .map_err(|error| format!("Could not save GitHub config: {error}"))?;
    }

    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|entry| entry.set_password(&token))
        .map_err(|error| format!("Could not store the GitHub token securely: {error}"))
}

#[tauri::command]
pub fn github_get_config(state: State<'_, AppState>) -> Result<Option<GitHubConfig>, String> {
    let database = state.database.lock().map_err(|_| "Database lock failed")?;
    read_config(&database)
}

#[tauri::command]
pub fn github_clear_config(state: State<'_, AppState>) -> Result<(), String> {
    {
        let database = state.database.lock().map_err(|_| "Database lock failed")?;
        database
            .execute("DELETE FROM github_config WHERE id = 1", [])
            .map_err(|error| format!("Could not clear GitHub config: {error}"))?;
        database
            .execute("DELETE FROM github_sync_state", [])
            .map_err(|error| format!("Could not clear sync state: {error}"))?;
    }

    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).and_then(|entry| entry.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not remove the stored GitHub token: {error}")),
    }
}

#[tauri::command]
pub async fn github_test_connection(state: State<'_, AppState>) -> Result<(), String> {
    let (config, token) = load_config_and_token(&state)?;
    let client = build_client()?;
    let response = client
        .get(format!("{API_BASE}/repos/{}/{}", config.owner, config.repo))
        .headers(auth_headers(&token))
        .send()
        .await
        .map_err(|error| format!("Could not reach GitHub: {error}"))?;

    match response.status() {
        StatusCode::OK => {
            let body: Value = response
                .json()
                .await
                .map_err(|error| format!("Unexpected response from GitHub: {error}"))?;
            let can_push = body
                .get("permissions")
                .and_then(|permissions| permissions.get("push"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if can_push {
                Ok(())
            } else {
                Err("This token does not have push access to the repository.".into())
            }
        }
        StatusCode::NOT_FOUND => Err("Repository not found, or the token cannot see it.".into()),
        StatusCode::UNAUTHORIZED => Err("GitHub rejected the token.".into()),
        status => Err(format!("GitHub returned an unexpected status: {status}")),
    }
}

/// Fetches every collection listed in the remote manifest and reports which ones changed
/// since our last known `remote_sha`. Deciding whether that collides with unsaved local
/// edits is left to the caller — this command only reports what changed on GitHub.
#[tauri::command]
pub async fn github_pull(state: State<'_, AppState>) -> Result<Vec<CollectionPullOutcome>, String> {
    let (config, token) = load_config_and_token(&state)?;
    let client = build_client()?;

    let manifest = match get_content(&client, &config, &token, "manifest.json").await? {
        Some(file) => serde_json::from_slice::<Manifest>(&file.content)
            .map_err(|error| format!("Remote manifest.json is invalid: {error}"))?,
        None => return Ok(Vec::new()),
    };

    // Each collection is fetched independently: one collection failing (bad JSON, a transient
    // network error) is reported as an "error" outcome for that id instead of aborting the
    // whole pull, so the caller always learns the fate of every collection in the manifest.
    let mut outcomes = Vec::with_capacity(manifest.collections.len());
    for entry in manifest.collections {
        macro_rules! fail {
            ($message:expr) => {{
                outcomes.push(CollectionPullOutcome {
                    collection_id: entry.id,
                    file: entry.file,
                    outcome: "error".into(),
                    data: None,
                    message: Some($message),
                });
                continue;
            }};
        }

        let file = match get_content(&client, &config, &token, &entry.file).await {
            Ok(Some(file)) => file,
            Ok(None) => continue,
            Err(message) => fail!(message),
        };

        let known_sha = {
            let database = match state.database.lock() {
                Ok(database) => database,
                Err(_) => fail!("Database lock failed".to_string()),
            };
            match known_remote_sha(&database, &entry.id) {
                Ok(sha) => sha,
                Err(error) => fail!(format!("Could not read sync state: {error}")),
            }
        };

        if known_sha.as_deref() == Some(file.sha.as_str()) {
            outcomes.push(CollectionPullOutcome {
                collection_id: entry.id,
                file: entry.file,
                outcome: "unchanged".into(),
                data: None,
                message: None,
            });
            continue;
        }

        let data: Value = match serde_json::from_slice(&file.content) {
            Ok(data) => data,
            Err(error) => {
                let message = format!("Collection '{}' is invalid JSON: {error}", entry.file);
                fail!(message);
            }
        };
        let local_hash = hash_bytes(&file.content);
        {
            let database = match state.database.lock() {
                Ok(database) => database,
                Err(_) => fail!("Database lock failed".to_string()),
            };
            if let Err(error) = store_sync_state(&database, &entry.id, &file.sha, &local_hash) {
                fail!(format!("Could not persist sync state: {error}"));
            }
        }
        outcomes.push(CollectionPullOutcome {
            collection_id: entry.id,
            file: entry.file,
            outcome: "updated".into(),
            data: Some(data),
            message: None,
        });
    }

    Ok(outcomes)
}

/// Pushes each collection using its last-known `remote_sha` as an optimistic-concurrency
/// precondition, so a change GitHub received from elsewhere since our last pull surfaces
/// as a `Conflict` outcome instead of being silently overwritten.
#[tauri::command]
pub async fn github_push(
    collections: Vec<CollectionPush>,
    state: State<'_, AppState>,
) -> Result<Vec<CollectionPushOutcome>, String> {
    let (config, token) = load_config_and_token(&state)?;
    let client = build_client()?;

    let (mut manifest, manifest_sha) = match get_content(&client, &config, &token, "manifest.json").await? {
        Some(file) => {
            let parsed = serde_json::from_slice::<Manifest>(&file.content)
                .unwrap_or(Manifest { version: 1, collections: Vec::new() });
            (parsed, Some(file.sha))
        }
        None => (Manifest { version: 1, collections: Vec::new() }, None),
    };
    let mut manifest_changed = false;

    // As with the pull, one collection failing to push doesn't stop the rest — it's reported
    // as an "error" outcome for that id so the caller learns exactly which collections made
    // it and which didn't, rather than the whole batch failing opaquely on the first hiccup.
    let mut outcomes = Vec::with_capacity(collections.len());
    for collection in collections {
        macro_rules! fail {
            ($message:expr) => {{
                outcomes.push(CollectionPushOutcome {
                    collection_id: collection.id,
                    outcome: "error".into(),
                    remote: None,
                    message: Some($message),
                });
                continue;
            }};
        }

        let file_path = format!("collections/{}.json", slugify(&collection.id, &collection.name));
        let bytes = match serde_json::to_vec_pretty(&collection.data) {
            Ok(bytes) => bytes,
            Err(error) => {
                let message = format!("Could not serialize collection '{}': {error}", collection.name);
                fail!(message);
            }
        };
        let local_hash = hash_bytes(&bytes);

        let known_sha = {
            let database = match state.database.lock() {
                Ok(database) => database,
                Err(_) => fail!("Database lock failed".to_string()),
            };
            match known_remote_sha(&database, &collection.id) {
                Ok(sha) => sha,
                Err(error) => fail!(format!("Could not read sync state: {error}")),
            }
        };

        let commit_message = format!("Sync collection: {}", collection.name);
        let put_result = put_content(&client, &config, &token, &file_path, &bytes, &commit_message, known_sha.as_deref()).await;
        match put_result {
            Ok(PutOutcome::Updated(new_sha)) => {
                {
                    let database = match state.database.lock() {
                        Ok(database) => database,
                        Err(_) => fail!("Database lock failed".to_string()),
                    };
                    if let Err(error) = store_sync_state(&database, &collection.id, &new_sha, &local_hash) {
                        fail!(format!("Could not persist sync state: {error}"));
                    }
                }
                if !manifest.collections.iter().any(|entry| entry.id == collection.id) {
                    manifest.collections.push(ManifestEntry { id: collection.id.clone(), file: file_path.clone() });
                    manifest_changed = true;
                }
                outcomes.push(CollectionPushOutcome { collection_id: collection.id, outcome: "pushed".into(), remote: None, message: None });
            }
            Ok(PutOutcome::Conflict) => {
                // Record the sha GitHub actually holds now, so a follow-up push (once the
                // user resolves the conflict) uses it as the precondition and succeeds
                // instead of failing the same 409 again.
                let remote_file = match get_content(&client, &config, &token, &file_path).await {
                    Ok(file) => file,
                    Err(error) => fail!(error),
                };
                if let Some(file) = &remote_file {
                    let database = match state.database.lock() {
                        Ok(database) => database,
                        Err(_) => fail!("Database lock failed".to_string()),
                    };
                    if let Err(error) = store_sync_state(&database, &collection.id, &file.sha, &hash_bytes(&file.content)) {
                        fail!(format!("Could not persist sync state: {error}"));
                    }
                }
                let remote = remote_file.and_then(|file| serde_json::from_slice(&file.content).ok());
                outcomes.push(CollectionPushOutcome { collection_id: collection.id, outcome: "conflict".into(), remote, message: None });
            }
            Err(error) => fail!(error),
        }
    }

    // A failed manifest update doesn't invalidate the collection pushes above — those already
    // landed in the repo. It only means a brand-new collection might not show up on the next
    // pull until the manifest is retried, so surface it as its own outcome rather than
    // discarding everything already recorded in `outcomes`.
    if manifest_changed {
        let outcome = match serde_json::to_vec_pretty(&manifest) {
            Ok(bytes) => put_content(&client, &config, &token, "manifest.json", &bytes, "Update collection manifest", manifest_sha.as_deref()).await,
            Err(error) => Err(format!("Could not serialize manifest: {error}")),
        };
        match outcome {
            Ok(PutOutcome::Updated(_)) => {}
            Ok(PutOutcome::Conflict) => outcomes.push(CollectionPushOutcome {
                collection_id: "__manifest__".into(),
                outcome: "error".into(),
                remote: None,
                message: Some("The collection manifest changed remotely during push. Pull and try again.".into()),
            }),
            Err(error) => outcomes.push(CollectionPushOutcome {
                collection_id: "__manifest__".into(),
                outcome: "error".into(),
                remote: None,
                message: Some(format!("Could not update the collection manifest: {error}")),
            }),
        }
    }

    Ok(outcomes)
}

fn load_config_and_token(state: &State<'_, AppState>) -> Result<(GitHubConfig, String), String> {
    let config = {
        let database = state.database.lock().map_err(|_| "Database lock failed")?;
        read_config(&database)?.ok_or("GitHub is not linked yet. Add a repository in Settings first.")?
    };
    let token = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|entry| entry.get_password())
        .map_err(|_| "No GitHub token is stored. Link GitHub again in Settings.".to_string())?;
    Ok((config, token))
}

fn read_config(database: &Connection) -> Result<Option<GitHubConfig>, String> {
    database
        .query_row("SELECT owner, repo, branch FROM github_config WHERE id = 1", [], |row| {
            Ok(GitHubConfig { owner: row.get(0)?, repo: row.get(1)?, branch: row.get(2)? })
        })
        .optional()
        .map_err(|error| format!("Could not read GitHub config: {error}"))
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(format!("Postcall/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not initialize GitHub client: {error}"))
}

fn auth_headers(token: &str) -> header::HeaderMap {
    let mut headers = header::HeaderMap::new();
    headers.insert(header::AUTHORIZATION, format!("Bearer {token}").parse().unwrap());
    headers.insert(header::ACCEPT, "application/vnd.github+json".parse().unwrap());
    headers.insert(
        header::HeaderName::from_static("x-github-api-version"),
        "2022-11-28".parse().unwrap(),
    );
    headers
}

async fn get_content(
    client: &Client,
    config: &GitHubConfig,
    token: &str,
    path: &str,
) -> Result<Option<RemoteFile>, String> {
    let url = format!(
        "{API_BASE}/repos/{}/{}/contents/{path}?ref={}",
        config.owner, config.repo, config.branch
    );
    let response = client
        .get(url)
        .headers(auth_headers(token))
        .send()
        .await
        .map_err(|error| format!("Could not fetch '{path}' from GitHub: {error}"))?;

    match response.status() {
        StatusCode::OK => {
            let body: Value = response
                .json()
                .await
                .map_err(|error| format!("Unexpected response for '{path}': {error}"))?;
            let sha = body
                .get("sha")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Missing sha for '{path}'"))?
                .to_string();
            let encoded = body.get("content").and_then(Value::as_str).unwrap_or_default().replace('\n', "");
            let content = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|error| format!("Could not decode '{path}': {error}"))?;
            Ok(Some(RemoteFile { content, sha }))
        }
        StatusCode::NOT_FOUND => Ok(None),
        status => Err(format!("GitHub returned {status} for '{path}'")),
    }
}

async fn put_content(
    client: &Client,
    config: &GitHubConfig,
    token: &str,
    path: &str,
    content: &[u8],
    message: &str,
    sha: Option<&str>,
) -> Result<PutOutcome, String> {
    let url = format!("{API_BASE}/repos/{}/{}/contents/{path}", config.owner, config.repo);
    let mut body = serde_json::json!({
        "message": message,
        "content": base64::engine::general_purpose::STANDARD.encode(content),
        "branch": config.branch,
    });
    if let Some(sha) = sha {
        body["sha"] = Value::String(sha.to_string());
    }

    let response = client
        .put(url)
        .headers(auth_headers(token))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Could not push '{path}' to GitHub: {error}"))?;

    match response.status() {
        StatusCode::OK | StatusCode::CREATED => {
            let body: Value = response
                .json()
                .await
                .map_err(|error| format!("Unexpected response after pushing '{path}': {error}"))?;
            let new_sha = body
                .get("content")
                .and_then(|content| content.get("sha"))
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Missing sha after pushing '{path}'"))?
                .to_string();
            Ok(PutOutcome::Updated(new_sha))
        }
        StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY => Ok(PutOutcome::Conflict),
        status => Err(format!("GitHub returned {status} while pushing '{path}'")),
    }
}

fn known_remote_sha(database: &Connection, collection_id: &str) -> rusqlite::Result<Option<String>> {
    database
        .query_row(
            "SELECT remote_sha FROM github_sync_state WHERE collection_id = ?1",
            params![collection_id],
            |row| row.get(0),
        )
        .optional()
}

fn store_sync_state(database: &Connection, collection_id: &str, remote_sha: &str, local_hash: &str) -> rusqlite::Result<()> {
    database.execute(
        "INSERT INTO github_sync_state (collection_id, remote_sha, local_hash, synced_at) VALUES (?1, ?2, ?3, unixepoch())
         ON CONFLICT(collection_id) DO UPDATE SET remote_sha = excluded.remote_sha, local_hash = excluded.local_hash, synced_at = excluded.synced_at",
        params![collection_id, remote_sha, local_hash],
    )?;
    Ok(())
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn slugify(id: &str, name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect();
    let trimmed = slug.trim_matches('-');
    let short_id: String = id.chars().take(8).collect();
    if trimmed.is_empty() { short_id } else { format!("{trimmed}-{short_id}") }
}
