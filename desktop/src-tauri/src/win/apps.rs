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
    // Windows' own admin tools and Control Panel entries: not apps you'd keep in a dock
    "firewall", "event viewer", "registry editor", "odbc", "disk cleanup", "windows tools", "component services",
    "computer management", "performance monitor", "resource monitor", "system configuration", "system information",
    "task scheduler", "memory diagnostic", "recovery drive", "iscsi", "print management", "steps recorder",
    "fax and scan", "powershell ise", "defragment", "local security policy", "media player legacy", "math input panel",
    "xps viewer", "speech recognition", "on-screen keyboard", "administrative tools", "feedback hub", "mixed reality",
    "3d viewer", "print 3d", "windows security", "internet explorer", "mobility center", "security configuration",
    "disk management", "device manager", "hyper-v", "windows memory", "dfrgui", "msconfig", "sql server",
];

/// Exact names that are system utilities (too generic to match by contains).
const SKIP_EXACT: &[&str] = &[
    "services", "run", "tips", "get help", "control panel", "narrator", "magnifier", "command prompt", "dialer",
    "character map", "windows powershell", "windows powershell (x86)", "cortana", "quick assist", "windows fax and scan",
    "work folders", "windows backup", "file history", "recovery", "wordpad", "windows media player legacy",
];

/// System32 and SysWOW64, as the apps folder spells them. Only a few apps that live there are ones people open.
const SYSTEM_FOLDERS: &[&str] = &["{1ac14e77-02e7-4e5d-b744-2eb1ae5198b7}", "{d65231b0-b2f1-4857-a4ce-a8e7c6ea7d27}", "c:\\windows\\"];
const SYSTEM_KEEP: &[&str] = &["notepad", "paint", "snipping tool", "calculator", "task manager", "file explorer", "remote desktop connection"];

fn is_regular_app(name: &str, id: &str) -> bool {
    let n = name.to_lowercase();
    let i = id.to_lowercase();
    if n.is_empty() || n.starts_with("http") || i.starts_with("http") { return false; }
    if i.starts_with("::{") || i.starts_with("shell:") { return false; }                    // Control Panel and shell folders
    for ext in [".msc", ".cpl", ".chm", ".url", ".txt", ".pdf", ".html", ".htm", ".ini", ".log", ".rtf", ".docx", ".doc", ".xml", ".bat", ".cmd", ".vbs"] {
        if i.ends_with(ext) { return false; }
    }
    if SKIP.iter().any(|s| n.contains(s)) || SKIP_EXACT.iter().any(|s| n == *s) { return false; }
    if SYSTEM_FOLDERS.iter().any(|f| i.starts_with(f)) && !SYSTEM_KEEP.iter().any(|k| n.contains(k)) { return false; }
    true
}

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
            if !is_regular_app(&name, &id) {
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
