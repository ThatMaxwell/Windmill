//! Every app installed on this PC, the same list the Start menu uses (including Store apps).

use serde::Serialize;
use std::collections::HashSet;
use windows::core::{HSTRING, PWSTR};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{
    BHID_EnumItems, IEnumShellItems, IShellItem, SHCreateItemFromParsingName, SIGDN_NORMALDISPLAY,
    SIGDN_PARENTRELATIVEPARSING,
};

#[derive(Serialize, Clone)]
pub struct App {
    /// What `launch` needs: an AppUserModelID or a path, as the shell knows it.
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
}

const SKIP: &[&str] = &[
    "uninstall", "uninstaller", "remove ", "readme", "read me", "help", "documentation", "release notes",
    "license", "manual", "website", "debuggable package manager",
];

unsafe fn text(p: PWSTR) -> String {
    let s = p.to_string().unwrap_or_default();
    CoTaskMemFree(Some(p.0 as *const _));
    s
}

pub fn list() -> Result<Vec<App>, String> {
    super::com();
    let mut out = vec![];
    let mut seen = HashSet::new();
    unsafe {
        let folder: IShellItem = SHCreateItemFromParsingName(&HSTRING::from("shell:AppsFolder"), None)
            .map_err(|e| format!("Could not read your apps: {e}"))?;
        let items: IEnumShellItems = folder
            .BindToHandler(None, &BHID_EnumItems)
            .map_err(|e| format!("Could not list your apps: {e}"))?;
        loop {
            let mut batch: [Option<IShellItem>; 1] = [None];
            let mut fetched = 0u32;
            let _ = items.Next(&mut batch, Some(&mut fetched));
            if fetched == 0 {
                break;
            }
            let Some(item) = batch[0].take() else { break };
            let name = match item.GetDisplayName(SIGDN_NORMALDISPLAY) {
                Ok(p) => text(p),
                Err(_) => continue,
            };
            let id = match item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING) {
                Ok(p) => text(p),
                Err(_) => continue,
            };
            let lower = name.to_lowercase();
            if name.is_empty() || SKIP.iter().any(|s| lower.contains(s)) || lower.starts_with("http") {
                continue;
            }
            if !seen.insert(lower) {
                continue;
            }
            let icon = super::icons::for_item(&item);
            out.push(App { id, name, icon });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

pub fn launch(id: &str) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("No app was given.".into());
    }
    // explorer understands every kind of entry in the apps folder: Store apps, shortcuts and paths.
    super::quiet("explorer.exe")
        .arg(format!("shell:AppsFolder\\{id}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open that app: {e}"))
}
