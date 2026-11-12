//! Screen time: which app had your attention, hour by hour. Kept only on this PC.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

const TICK: u64 = 15; // seconds between samples
const IDLE_AFTER: u64 = 120; // seconds without input before time stops counting

/// hour (unix seconds / 3600) -> app -> seconds
type Log = BTreeMap<u64, BTreeMap<String, u64>>;

static LOG: Mutex<Option<Log>> = Mutex::new(None);
static FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

fn now_hour() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() / 3600
}

fn idle_seconds() -> u64 {
    let mut li = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    unsafe {
        if GetLastInputInfo(&mut li).as_bool() {
            let now = GetTickCount64() as u32;
            return now.wrapping_sub(li.dwTime) as u64 / 1000;
        }
    }
    0
}

fn current_app() -> Option<String> {
    let fg = unsafe { GetForegroundWindow() };
    if fg.is_invalid() {
        return None;
    }
    let list = super::windows::list();
    list.into_iter().find(|w| w.id == fg.0 as isize).map(|w| w.app).or(Some("Windmill".into()))
}

fn save() {
    let (Ok(log), Ok(file)) = (LOG.lock(), FILE.lock()) else { return };
    if let (Some(log), Some(file)) = (log.as_ref(), file.as_ref()) {
        if let Ok(json) = serde_json::to_string(log) {
            let _ = std::fs::write(file, json);
        }
    }
}

pub fn start(app: AppHandle) {
    let file = app.path().app_data_dir().ok().map(|d| {
        let _ = std::fs::create_dir_all(&d);
        d.join("screen-time.json")
    });
    let loaded: Log = file
        .as_ref()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    *LOG.lock().unwrap() = Some(loaded);
    *FILE.lock().unwrap() = file;

    std::thread::spawn(|| {
        let mut n = 0u64;
        loop {
            std::thread::sleep(Duration::from_secs(TICK));
            if idle_seconds() > IDLE_AFTER {
                continue;
            }
            if let Some(app) = current_app() {
                if let Ok(mut log) = LOG.lock() {
                    let log = log.get_or_insert_with(Log::new);
                    *log.entry(now_hour()).or_default().entry(app).or_default() += TICK;
                    let cutoff = now_hour().saturating_sub(24 * 8);
                    log.retain(|h, _| *h >= cutoff);
                }
            }
            n += 1;
            if n % 20 == 0 {
                save();
            }
        }
    });
}

/// Last 24 hours, oldest first, plus the apps you used most today.
pub fn summary() -> serde_json::Value {
    let log = LOG.lock().ok().and_then(|l| l.clone()).unwrap_or_default();
    let now = now_hour();
    let hours: Vec<u64> = (0..24).rev().map(|i| now - i).collect();
    let per_hour: Vec<u64> = hours.iter().map(|h| log.get(h).map(|m| m.values().sum()).unwrap_or(0)).collect();
    let mut apps: BTreeMap<String, u64> = BTreeMap::new();
    for h in &hours {
        if let Some(m) = log.get(h) {
            for (a, s) in m {
                *apps.entry(a.clone()).or_default() += s;
            }
        }
    }
    let mut top: Vec<(String, u64)> = apps.into_iter().collect();
    top.sort_by(|a, b| b.1.cmp(&a.1));
    top.truncate(6);
    serde_json::json!({
        "hours": per_hour,
        "first_hour": hours.first().copied().unwrap_or(now),
        "total_seconds": per_hour.iter().sum::<u64>(),
        "top": top.into_iter().map(|(app, secs)| serde_json::json!({ "app": app, "seconds": secs })).collect::<Vec<_>>(),
    })
}
