//! Files: your real folders, listed, opened and shown in Explorer.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

type Res<T> = Result<T, String>;

#[derive(Serialize)]
pub struct Place {
    pub name: String,
    pub path: String,
    pub kind: String,
}

#[derive(Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub size: u64,
    pub modified: u64,
    pub ext: String,
}

#[cfg(windows)]
fn known(id: &windows::core::GUID) -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s.map(PathBuf::from)
    }
}

/// Home, the usual folders (wherever Windows keeps them, OneDrive included) and the drives.
#[tauri::command]
pub fn files_places() -> Res<Vec<Place>> {
    let mut out = vec![];
    #[cfg(windows)]
    {
        use windows::Win32::UI::Shell::*;
        let list: [(&str, &windows::core::GUID, &str); 7] = [
            ("Home", &FOLDERID_Profile, "home"),
            ("Desktop", &FOLDERID_Desktop, "desktop"),
            ("Documents", &FOLDERID_Documents, "documents"),
            ("Downloads", &FOLDERID_Downloads, "downloads"),
            ("Pictures", &FOLDERID_Pictures, "pictures"),
            ("Music", &FOLDERID_Music, "music"),
            ("Videos", &FOLDERID_Videos, "videos"),
        ];
        for (name, id, kind) in list {
            if let Some(p) = known(id) {
                if p.exists() {
                    out.push(Place { name: name.into(), path: p.to_string_lossy().into(), kind: kind.into() });
                }
            }
        }
        for c in b'C'..=b'Z' {
            let root = format!("{}:\\", c as char);
            if Path::new(&root).exists() {
                out.push(Place { name: format!("Drive {}", c as char), path: root, kind: "drive".into() });
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(h) = std::env::var_os("HOME") {
            out.push(Place { name: "Home".into(), path: h.to_string_lossy().into(), kind: "home".into() });
        }
    }
    Ok(out)
}

fn hidden(meta: &std::fs::Metadata, name: &str) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        let a = meta.file_attributes();
        if a & 0x2 != 0 || a & 0x4 != 0 {
            return true; // hidden or system
        }
    }
    let _ = meta;
    name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") || name.eq_ignore_ascii_case("thumbs.db")
}

/// What's in a folder: folders first, then files, by name. Hidden and system files stay hidden.
#[tauri::command]
pub fn files_list(path: String) -> Res<Vec<Entry>> {
    let rd = std::fs::read_dir(&path).map_err(|e| format!("Couldn't open this folder: {e}"))?;
    let mut out: Vec<Entry> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let meta = e.metadata().ok()?;
            if hidden(&meta, &name) {
                return None;
            }
            let modified = meta.modified().ok().and_then(|m| m.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            let ext = Path::new(&name).extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            Some(Entry { name, path: e.path().to_string_lossy().into(), dir: meta.is_dir(), size: if meta.is_dir() { 0 } else { meta.len() }, modified, ext })
        })
        .take(5000)
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// Opens a file with its usual app, or a folder in Explorer.
#[tauri::command]
pub fn files_open(path: String) -> Res<()> {
    if !Path::new(&path).exists() {
        return Err("That file isn't there anymore.".into());
    }
    #[cfg(windows)]
    {
        return crate::win::quiet("explorer.exe").arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    #[cfg(not(windows))]
    Err("Opening files works in the Windows app.".into())
}

/// Shows a file in Explorer, selected.
#[tauri::command]
pub fn files_reveal(path: String) -> Res<()> {
    #[cfg(windows)]
    {
        return crate::win::quiet("explorer.exe").arg(format!("/select,{path}")).spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Works in the Windows app.".into())
    }
}

/// The icon Windows shows for this file or folder, as a data URL.
#[tauri::command]
pub async fn files_icon(path: String) -> Res<Option<String>> {
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            crate::win::com();
            crate::win::icons::for_parsing_name(&path)
        })
        .await
        .map_err(|e| e.to_string());
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(None)
    }
}
