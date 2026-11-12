//! The Windmill app icon: white, blue (default) or black.
//!
//! Windows: the window icon changes right away, and Windmill's Start menu and desktop shortcuts are
//! pointed at the new icon so the taskbar and Start show it too.
//! Android: the launcher icon is switched through activity aliases (see android/IconPlugin.kt).

use tauri::{AppHandle, Manager, Runtime};

pub const VARIANTS: [&str; 3] = ["white", "blue", "black"];

#[allow(dead_code)]
fn png(variant: &str) -> &'static [u8] {
    match variant {
        "white" => include_bytes!("../icons/variants/white.png"),
        "black" => include_bytes!("../icons/variants/black.png"),
        _ => include_bytes!("../icons/variants/blue.png"),
    }
}

#[allow(dead_code)]
fn ico(variant: &str) -> &'static [u8] {
    match variant {
        "white" => include_bytes!("../icons/variants/white.ico"),
        "black" => include_bytes!("../icons/variants/black.ico"),
        _ => include_bytes!("../icons/variants/blue.ico"),
    }
}

fn saved_file<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("app-icon.txt"))
}

pub fn saved<R: Runtime>(app: &AppHandle<R>) -> String {
    saved_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| VARIANTS.contains(&s.as_str()))
        .unwrap_or_else(|| "blue".into())
}

/// Called at startup so the window wears the chosen icon.
pub fn apply_window_icon<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(desktop)]
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(img) = tauri::image::Image::from_bytes(png(&saved(app))) {
            let _ = w.set_icon(img);
        }
    }
    let _ = app;
}

#[tauri::command]
pub fn get_app_icon<R: Runtime>(app: AppHandle<R>) -> String {
    saved(&app)
}

#[tauri::command]
pub fn set_app_icon<R: Runtime>(app: AppHandle<R>, variant: String) -> Result<(), String> {
    if !VARIANTS.contains(&variant.as_str()) {
        return Err("Pick white, blue or black.".into());
    }
    if let Some(f) = saved_file(&app) {
        std::fs::write(f, &variant).map_err(|e| e.to_string())?;
    }
    apply_window_icon(&app);
    #[cfg(windows)]
    windows_shortcuts(&app, &variant)?;
    #[cfg(target_os = "android")]
    {
        crate::android_icon::set(&app, &variant)?;
    }
    Ok(())
}

/// Point Windmill's shortcuts (Start menu, desktop) at an .ico of the chosen color.
#[cfg(windows)]
fn windows_shortcuts<R: Runtime>(app: &AppHandle<R>, variant: &str) -> Result<(), String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READWRITE};
    use windows::Win32::UI::Shell::{IShellLinkW, SHChangeNotify, ShellLink, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let icon_path = dir.join(format!("windmill-{variant}.ico"));
    std::fs::write(&icon_path, ico(variant)).map_err(|e| e.to_string())?;

    let mut shortcuts = vec![];
    if let Ok(a) = std::env::var("APPDATA") {
        shortcuts.push(std::path::PathBuf::from(&a).join(r"Microsoft\Windows\Start Menu\Programs\Windmill.lnk"));
        shortcuts.push(std::path::PathBuf::from(&a).join(r"Microsoft\Windows\Start Menu\Programs\Windmill\Windmill.lnk"));
    }
    if let Ok(p) = std::env::var("ProgramData") {
        shortcuts.push(std::path::PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs\Windmill.lnk"));
    }
    if let Ok(u) = std::env::var("USERPROFILE") {
        shortcuts.push(std::path::PathBuf::from(&u).join(r"Desktop\Windmill.lnk"));
        shortcuts.push(std::path::PathBuf::from(&u).join(r"OneDrive\Desktop\Windmill.lnk"));
    }
    crate::win::com();
    unsafe {
        for lnk in shortcuts.into_iter().filter(|p| p.exists()) {
            let link: IShellLinkW = match CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) {
                Ok(l) => l,
                Err(_) => continue,
            };
            let Ok(file) = link.cast::<IPersistFile>() else { continue };
            let path = HSTRING::from(lnk.as_os_str());
            if file.Load(&path, STGM_READWRITE).is_err() {
                continue;
            }
            let _ = link.SetIconLocation(&HSTRING::from(icon_path.as_os_str()), 0);
            let _ = file.Save(&path, true);
        }
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }
    Ok(())
}
