//! Commands the Windmill page can call. Each one does the real thing on Windows and
//! returns a clear "not on this platform yet" error elsewhere, so the page can hide the feature.

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

#[cfg(windows)]
use crate::win;

type Res<T> = Result<T, String>;

#[allow(dead_code)]
fn unsupported<T>() -> Res<T> {
    Err("This works on Windows for now.".into())
}

#[derive(Serialize)]
pub struct Platform {
    os: &'static str,
    windows: bool,
    mobile: bool,
    version: String,
}

#[tauri::command]
pub fn platform<R: Runtime>(app: AppHandle<R>) -> Platform {
    Platform {
        os: std::env::consts::OS,
        windows: cfg!(windows),
        mobile: cfg!(any(target_os = "android", target_os = "ios")),
        version: app.package_info().version.to_string(),
    }
}

// ---------- apps ----------

#[tauri::command]
pub async fn list_apps() -> Res<serde_json::Value> {
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(win::apps::list)
            .await
            .map_err(|e| e.to_string())?
            .map(|v| serde_json::to_value(v).unwrap_or_default());
    }
    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
pub fn launch_app(id: String) -> Res<()> {
    #[cfg(windows)]
    {
        return win::apps::launch(&id);
    }
    #[allow(unreachable_code)]
    {
        let _ = id;
        unsupported()
    }
}

// ---------- windows of other apps ----------

#[tauri::command]
pub async fn list_windows() -> Res<serde_json::Value> {
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(win::windows::list)
            .await
            .map_err(|e| e.to_string())
            .map(|v| serde_json::to_value(v).unwrap_or_default());
    }
    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
pub fn focus_window(id: isize) -> Res<()> {
    #[cfg(windows)]
    {
        return win::windows::focus(id);
    }
    #[allow(unreachable_code)]
    {
        let _ = id;
        unsupported()
    }
}

#[tauri::command]
pub fn minimize_window(id: isize) -> Res<()> {
    #[cfg(windows)]
    {
        return win::windows::minimize(id);
    }
    #[allow(unreachable_code)]
    {
        let _ = id;
        unsupported()
    }
}

#[tauri::command]
pub fn close_window(id: isize) -> Res<()> {
    #[cfg(windows)]
    {
        return win::windows::close(id);
    }
    #[allow(unreachable_code)]
    {
        let _ = id;
        unsupported()
    }
}

/// `side` is one of: left, right, top, bottom, full, center.
#[tauri::command]
pub fn snap_window(id: isize, side: String) -> Res<()> {
    #[cfg(windows)]
    {
        return win::windows::snap(id, &side);
    }
    #[allow(unreachable_code)]
    {
        let _ = (id, side);
        unsupported()
    }
}

#[tauri::command]
pub fn side_by_side(left: isize, right: isize) -> Res<()> {
    #[cfg(windows)]
    {
        win::windows::snap(left, "left")?;
        win::windows::snap(right, "right")?;
        return win::windows::focus(right);
    }
    #[allow(unreachable_code)]
    {
        let _ = (left, right);
        unsupported()
    }
}

// ---------- sound, power, system ----------

#[derive(Serialize)]
pub struct Volume {
    level: f32,
    muted: bool,
}

#[tauri::command]
pub fn get_volume() -> Res<Volume> {
    #[cfg(windows)]
    {
        let (level, muted) = win::audio::get()?;
        return Ok(Volume { level, muted });
    }
    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
pub fn set_volume(level: f32) -> Res<()> {
    #[cfg(windows)]
    {
        return win::audio::set_level(level.clamp(0.0, 1.0));
    }
    #[allow(unreachable_code)]
    {
        let _ = level;
        unsupported()
    }
}

#[tauri::command]
pub fn set_mute(muted: bool) -> Res<()> {
    #[cfg(windows)]
    {
        return win::audio::set_mute(muted);
    }
    #[allow(unreachable_code)]
    {
        let _ = muted;
        unsupported()
    }
}

#[tauri::command]
pub fn battery() -> Res<serde_json::Value> {
    #[cfg(windows)]
    {
        return Ok(serde_json::to_value(win::system::battery()).unwrap_or_default());
    }
    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
pub fn system_stats() -> Res<serde_json::Value> {
    #[cfg(windows)]
    {
        return Ok(serde_json::to_value(win::system::stats()).unwrap_or_default());
    }
    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
pub async fn get_brightness() -> Res<u32> {
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(win::system::get_brightness)
            .await
            .map_err(|e| e.to_string())?;
    }
    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
pub async fn set_brightness(level: u32) -> Res<()> {
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || win::system::set_brightness(level.min(100)))
            .await
            .map_err(|e| e.to_string())?;
    }
    #[allow(unreachable_code)]
    {
        let _ = level;
        unsupported()
    }
}

#[tauri::command]
pub async fn wifi_status() -> Res<serde_json::Value> {
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(win::system::wifi)
            .await
            .map_err(|e| e.to_string())
            .map(|v| serde_json::to_value(v).unwrap_or_default());
    }
    #[allow(unreachable_code)]
    unsupported()
}

/// Opens a page of the Windows Settings app, e.g. "network-wifi", "bluetooth", "display".
#[tauri::command]
pub fn open_system_settings(page: String) -> Res<()> {
    #[cfg(windows)]
    {
        return win::system::open_settings(&page);
    }
    #[allow(unreachable_code)]
    {
        let _ = page;
        unsupported()
    }
}

/// `action` is one of: lock, sleep, restart, shutdown, signout.
#[tauri::command]
pub fn power(action: String) -> Res<()> {
    #[cfg(windows)]
    {
        return win::system::power(&action);
    }
    #[allow(unreachable_code)]
    {
        let _ = action;
        unsupported()
    }
}

// ---------- wallpapers (work everywhere) ----------

#[derive(Serialize)]
pub struct Wallpaper {
    name: String,
    path: String,
    kind: &'static str,
}

fn wallpaper_dir<R: Runtime>(app: &AppHandle<R>) -> Res<std::path::PathBuf> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("wallpapers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn kind_of(path: &std::path::Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "avif" | "bmp" => Some("image"),
        "mp4" | "webm" | "mov" | "m4v" => Some("video"),
        _ => None,
    }
}

#[tauri::command]
pub fn import_wallpaper<R: Runtime>(app: AppHandle<R>, path: String) -> Res<Wallpaper> {
    let src = std::path::PathBuf::from(&path);
    let kind = kind_of(&src).ok_or("Pick an image or a video (png, jpg, webp, gif, mp4, webm).")?;
    let name = src.file_name().ok_or("That file has no name.")?.to_string_lossy().to_string();
    let dest = wallpaper_dir(&app)?.join(&name);
    std::fs::copy(&src, &dest).map_err(|e| format!("Could not copy the file: {e}"))?;
    Ok(Wallpaper { name, path: dest.to_string_lossy().to_string(), kind })
}

#[tauri::command]
pub fn list_wallpapers<R: Runtime>(app: AppHandle<R>) -> Res<Vec<Wallpaper>> {
    let mut out = vec![];
    for entry in std::fs::read_dir(wallpaper_dir(&app)?).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if let Some(kind) = kind_of(&p) {
            out.push(Wallpaper {
                name: p.file_name().unwrap_or_default().to_string_lossy().to_string(),
                path: p.to_string_lossy().to_string(),
                kind,
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub fn remove_wallpaper<R: Runtime>(app: AppHandle<R>, name: String) -> Res<()> {
    let p = wallpaper_dir(&app)?.join(std::path::Path::new(&name).file_name().ok_or("Bad name")?);
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

// ---------- screen time ----------

#[tauri::command]
pub fn screen_time() -> Res<serde_json::Value> {
    #[cfg(windows)]
    {
        return Ok(win::usage::summary());
    }
    #[allow(unreachable_code)]
    unsupported()
}

// ---------- how Windmill treats other apps ----------

#[tauri::command]
pub fn set_shell_options(apps_full_screen: bool, global_search: bool, edge_dock: bool) -> Res<()> {
    #[cfg(windows)]
    {
        use std::sync::atomic::Ordering;
        win::hotkey::APPS_FULL_SCREEN.store(apps_full_screen, Ordering::SeqCst);
        win::hotkey::GLOBAL_SEARCH.store(global_search, Ordering::SeqCst);
        win::hotkey::EDGE_DOCK.store(edge_dock, Ordering::SeqCst);
    }
    let _ = (apps_full_screen, global_search, edge_dock);
    Ok(())
}

// ---------- Windmill's own window ----------

#[tauri::command]
pub fn set_taskbar_hidden<R: Runtime>(app: AppHandle<R>, hidden: bool) -> Res<()> {
    #[cfg(windows)]
    {
        win::system::set_taskbar_hidden(hidden);
    }
    if let Some(w) = app.get_webview_window("main") {
        #[cfg(desktop)]
        {
            w.set_fullscreen(hidden).map_err(|e| e.to_string())?;
            if !hidden {
                let _ = w.maximize();
            }
        }
        let _ = (w, hidden);
    }
    Ok(())
}

pub fn bring_forward<R: Runtime>(app: &AppHandle<R>) -> Res<()> {
    let w = app.get_webview_window("main").ok_or("Windmill's window is missing.")?;
    #[cfg(desktop)]
    {
        let _ = w.unminimize();
        let _ = w.show();
    }
    w.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_windmill<R: Runtime>(app: AppHandle<R>) -> Res<()> {
    bring_forward(&app)
}

/// Restart Windmill itself (not the PC).
#[tauri::command]
pub fn restart_windmill<R: Runtime>(app: AppHandle<R>) {
    #[cfg(windows)]
    win::system::set_taskbar_hidden(false);
    app.restart();
}

/// Politely ask every open app window to close, so each app can save or ask first.
/// Returns how many were asked.
#[tauri::command]
pub fn close_all_windows() -> Res<usize> {
    #[cfg(windows)]
    {
        let list = win::windows::list();
        for w in &list {
            let _ = win::windows::close(w.id);
        }
        return Ok(list.len());
    }
    #[allow(unreachable_code)]
    unsupported()
}

/// The only way out of Windmill: from its own panel.
#[tauri::command]
pub fn quit_windmill<R: Runtime>(app: AppHandle<R>) {
    #[cfg(windows)]
    win::system::set_taskbar_hidden(false);
    app.exit(0);
}

// ---------- use this PC from your phone (from anywhere; the link itself lives in remote.js) ----------

/// Screen size and PC name for a phone that just paired.
#[tauri::command]
pub fn remote_hello() -> Res<serde_json::Value> {
    #[cfg(windows)]
    {
        return Ok(win::remote::hello());
    }
    #[allow(unreachable_code)]
    unsupported()
}

/// The next JPEG of the screen, as raw bytes (an ArrayBuffer in the page). Waits for a change.
#[tauri::command]
pub async fn remote_frame(width: Option<i32>, quality: Option<u8>) -> Res<tauri::ipc::Response> {
    #[cfg(windows)]
    {
        let (w, q) = (width.unwrap_or(1280), quality.unwrap_or(60));
        let bytes = tauri::async_runtime::spawn_blocking(move || win::remote::next_frame(w, q))
            .await
            .map_err(|e| e.to_string())?;
        return Ok(tauri::ipc::Response::new(bytes));
    }
    #[allow(unreachable_code)]
    {
        let _ = (width, quality);
        unsupported()
    }
}

/// A tap, drag, scroll or typing from the paired phone.
#[tauri::command]
pub fn remote_input<R: Runtime>(app: AppHandle<R>, event: serde_json::Value) -> Res<()> {
    #[cfg(windows)]
    {
        win::remote::input(&app, &event);
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, event);
        unsupported()
    }
}

/// Keeps the matchmaking connection alive while "Let my phone connect" is on.
#[tauri::command]
pub fn remote_keepalive<R: Runtime>(app: AppHandle<R>, on: bool) -> Res<()> {
    #[cfg(windows)]
    {
        win::remote::keepalive(app, on);
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, on);
        unsupported()
    }
}
