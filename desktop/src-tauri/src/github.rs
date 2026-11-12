//! Sign in with GitHub using the device flow: no secret and no server needed, only the
//! OAuth App's public Client ID. The token stays on this computer, in Windmill's data folder.
//!
//! Set the Client ID in `CLIENT_ID` below, or at build time with WINDMILL_GITHUB_CLIENT_ID.
//! The OAuth App must have "Enable Device Flow" ticked.

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

/// Windmill's OAuth App (public; the device flow needs no secret).
const CLIENT_ID: &str = "Ov23liKp9NhxyU6dlyLM";

fn client_id() -> Option<&'static str> {
    // A build-time value wins, unless it's empty (the build passes an empty one when it isn't set).
    let id = option_env!("WINDMILL_GITHUB_CLIENT_ID").map(str::trim).filter(|s| !s.is_empty()).unwrap_or(CLIENT_ID).trim();
    (!id.is_empty()).then_some(id)
}

fn store<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("github.json"))
}

#[cfg(windows)]
fn agent() -> Result<ureq::Agent, String> {
    // Windows' own TLS, so there is nothing extra to build or ship.
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    Ok(ureq::AgentBuilder::new().tls_connector(std::sync::Arc::new(tls)).build())
}

#[cfg(windows)]
fn post(url: &str, form: &[(&str, &str)]) -> Result<Value, String> {
    agent()?
        .post(url)
        .set("Accept", "application/json")
        .set("User-Agent", "Windmill")
        .send_form(form)
        .map_err(|e| format!("GitHub didn't answer: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn post(_url: &str, _form: &[(&str, &str)]) -> Result<Value, String> {
    Err("Sign-in works in the Windows app for now.".into())
}

#[cfg(windows)]
fn get_user(token: &str) -> Result<Value, String> {
    agent()?
        .get("https://api.github.com/user")
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "Windmill")
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|e| format!("Could not read your GitHub profile: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn get_user(_token: &str) -> Result<Value, String> {
    Err("Sign-in works in the Windows app for now.".into())
}

#[derive(Serialize)]
pub struct Profile {
    login: String,
    name: Option<String>,
    avatar: Option<String>,
}

fn profile(u: &Value) -> Profile {
    Profile {
        login: u["login"].as_str().unwrap_or_default().to_string(),
        name: u["name"].as_str().map(str::to_string),
        avatar: u["avatar_url"].as_str().map(str::to_string),
    }
}

/// Is sign-in set up in this build?
#[tauri::command]
pub fn github_ready() -> bool {
    client_id().is_some()
}

/// Step 1: get a short code the person types at github.com/login/device.
#[tauri::command]
pub async fn github_device_start() -> Result<Value, String> {
    let id = client_id().ok_or("Sign-in isn't set up in this build yet.")?;
    tauri::async_runtime::spawn_blocking(move || {
        post("https://github.com/login/device/code", &[("client_id", id), ("scope", "read:user gist")])
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Step 2: ask GitHub whether the person has entered the code yet.
/// Returns { status: "pending" | "slow_down" | "done" | "expired" | "denied", profile? }.
#[tauri::command]
pub async fn github_device_poll<R: Runtime>(app: AppHandle<R>, device_code: String) -> Result<Value, String> {
    let id = client_id().ok_or("Sign-in isn't set up in this build yet.")?;
    let file = store(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let r = post(
            "https://github.com/login/oauth/access_token",
            &[
                ("client_id", id),
                ("device_code", device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ],
        )?;
        if let Some(token) = r["access_token"].as_str() {
            let user = get_user(token)?;
            let _ = std::fs::write(&file, serde_json::json!({ "token": token, "user": user }).to_string());
            return Ok(serde_json::json!({ "status": "done", "profile": profile(&user) }));
        }
        let status = match r["error"].as_str().unwrap_or("authorization_pending") {
            "authorization_pending" => "pending",
            "slow_down" => "slow_down",
            "expired_token" => "expired",
            "access_denied" => "denied",
            other => return Err(format!("GitHub said: {other}")),
        };
        Ok(serde_json::json!({ "status": status }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The signed-in person, if any.
#[tauri::command]
pub fn github_profile<R: Runtime>(app: AppHandle<R>) -> Option<Profile> {
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(store(&app).ok()?).ok()?).ok()?;
    Some(profile(&saved["user"]))
}

#[tauri::command]
pub fn github_sign_out<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let f = store(&app)?;
    if f.exists() {
        std::fs::remove_file(f).map_err(|e| e.to_string())?;
    }
    Ok(())
}
