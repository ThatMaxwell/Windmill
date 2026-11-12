//! Battery, memory, processor, brightness, Wi-Fi, power, and the Windows taskbar.

use serde::Serialize;
use std::sync::Mutex;
use windows::core::w;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::Power::{GetSystemPowerStatus, SetSuspendState, SYSTEM_POWER_STATUS};
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::System::SystemInformation::{GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::GetSystemTimes;
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetSystemMetrics, GetWindowRect, ShowWindow, SystemParametersInfoW, SM_CXSCREEN, SM_CYSCREEN, SPIF_SENDCHANGE,
    SPI_GETWORKAREA, SPI_SETWORKAREA, SW_HIDE, SW_SHOW, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};

#[derive(Serialize)]
pub struct Battery {
    pub present: bool,
    pub percent: Option<u8>,
    pub charging: bool,
    pub minutes_left: Option<u32>,
}

pub fn battery() -> Battery {
    let mut s = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut s) }.is_err() {
        return Battery { present: false, percent: None, charging: false, minutes_left: None };
    }
    let present = s.BatteryFlag & 128 == 0 && s.BatteryFlag != 255;
    Battery {
        present,
        percent: (s.BatteryLifePercent != 255).then_some(s.BatteryLifePercent),
        charging: s.ACLineStatus == 1,
        minutes_left: (s.BatteryLifeTime != u32::MAX).then_some(s.BatteryLifeTime / 60),
    }
}

#[derive(Serialize)]
pub struct Stats {
    pub cpu: f32,
    pub memory: u32,
    pub memory_used_gb: f32,
    pub memory_total_gb: f32,
    pub uptime_minutes: u64,
}

static LAST: Mutex<Option<(u64, u64)>> = Mutex::new(None);

fn ft(t: FILETIME) -> u64 {
    ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64
}

pub fn stats() -> Stats {
    let mut cpu = 0.0;
    unsafe {
        let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
        if GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).is_ok() {
            let busy_total = (ft(kernel) + ft(user), ft(idle));
            if let Ok(mut last) = LAST.lock() {
                if let Some((t0, i0)) = *last {
                    let dt = busy_total.0.saturating_sub(t0);
                    let di = busy_total.1.saturating_sub(i0);
                    if dt > 0 {
                        cpu = (1.0 - di as f32 / dt as f32).clamp(0.0, 1.0) * 100.0;
                    }
                }
                *last = Some(busy_total);
            }
        }
    }
    let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    let _ = unsafe { GlobalMemoryStatusEx(&mut m) };
    let gb = |b: u64| b as f32 / 1_073_741_824.0;
    Stats {
        cpu,
        memory: m.dwMemoryLoad,
        memory_used_gb: gb(m.ullTotalPhys - m.ullAvailPhys),
        memory_total_gb: gb(m.ullTotalPhys),
        uptime_minutes: unsafe { GetTickCount64() } / 60_000,
    }
}

fn powershell(script: &str) -> Result<String, String> {
    let out = super::quiet("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Built-in screens (laptops) only; external monitors don't expose this to Windows.
pub fn get_brightness() -> Result<u32, String> {
    powershell("(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness")
        .ok()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "This screen doesn't let Windows change its brightness.".to_string())
}

pub fn set_brightness(level: u32) -> Result<(), String> {
    powershell(&format!(
        "(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1) | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{{Timeout=1;Brightness={level}}} | Out-Null"
    ))
    .map(|_| ())
    .map_err(|_| "This screen doesn't let Windows change its brightness.".to_string())
}

#[derive(Serialize)]
pub struct Wifi {
    pub connected: bool,
    pub name: Option<String>,
    pub signal: Option<u32>,
}

pub fn wifi() -> Wifi {
    let text = super::quiet("netsh")
        .args(["wlan", "show", "interfaces"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let field = |key: &str| {
        text.lines()
            .find(|l| l.trim_start().starts_with(key) && l.contains(':'))
            .and_then(|l| l.splitn(2, ':').nth(1))
            .map(|v| v.trim().to_string())
    };
    let name = field("SSID").filter(|s| !s.is_empty());
    let signal = field("Signal").and_then(|s| s.trim_end_matches('%').trim().parse().ok());
    Wifi { connected: name.is_some(), name, signal }
}

pub fn open_settings(page: &str) -> Result<(), String> {
    let page: String = page.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    super::quiet("explorer.exe")
        .arg(format!("ms-settings:{page}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn power(action: &str) -> Result<(), String> {
    match action {
        "lock" => unsafe { LockWorkStation() }.map_err(|e| e.to_string()),
        "sleep" => {
            unsafe { SetSuspendState(false, false, false) };
            Ok(())
        }
        "restart" | "shutdown" | "signout" => {
            let flag = match action {
                "restart" => "/r",
                "shutdown" => "/s",
                _ => "/l",
            };
            set_taskbar_hidden(false);
            let mut c = super::quiet("shutdown.exe");
            c.arg(flag);
            if action != "signout" {
                c.args(["/t", "0"]);
            }
            c.spawn().map(|_| ()).map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown power action: {action}")),
    }
}

/// The work area (the screen minus the taskbar) from before Windmill hid the taskbar.
static SAVED_WORK_AREA: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);

/// Hides (or brings back) the Windows taskbar on every screen. While it's hidden, its space
/// goes to your apps too, so a maximized app fills the screen. Bringing it back restores
/// the space exactly as it was.
pub fn set_taskbar_hidden(hidden: bool) {
    super::hotkey::FULL_SCREEN.store(hidden, std::sync::atomic::Ordering::SeqCst);
    unsafe {
        for class in [w!("Shell_TrayWnd"), w!("Shell_SecondaryTrayWnd")] {
            if let Ok(h) = FindWindowW(class, None) {
                let _ = ShowWindow(h, if hidden { SW_HIDE } else { SW_SHOW });
            }
        }
        let mut saved = match SAVED_WORK_AREA.lock() { Ok(g) => g, Err(p) => p.into_inner() };
        if hidden {
            if saved.is_none() {
                let mut r = RECT::default();
                if SystemParametersInfoW(SPI_GETWORKAREA, 0, Some(&mut r as *mut RECT as *mut _), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)).is_ok() {
                    *saved = Some((r.left, r.top, r.right, r.bottom));
                }
            }
            let mut full = RECT { left: 0, top: 0, right: GetSystemMetrics(SM_CXSCREEN), bottom: GetSystemMetrics(SM_CYSCREEN) };
            let _ = SystemParametersInfoW(SPI_SETWORKAREA, 0, Some(&mut full as *mut RECT as *mut _), SPIF_SENDCHANGE);
        } else {
            let back = saved.take().or_else(work_area_from_taskbar);
            if let Some((left, top, right, bottom)) = back {
                let mut r = RECT { left, top, right, bottom };
                let _ = SystemParametersInfoW(SPI_SETWORKAREA, 0, Some(&mut r as *mut RECT as *mut _), SPIF_SENDCHANGE);
            }
        }
    }
}

/// If Windmill never saw the old work area (say it closed badly last time), work it out
/// from where the taskbar sits: the whole screen minus the taskbar's edge.
fn work_area_from_taskbar() -> Option<(i32, i32, i32, i32)> {
    unsafe {
        let (w, h) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
        let tray = FindWindowW(w!("Shell_TrayWnd"), None).ok()?;
        let mut t = RECT::default();
        GetWindowRect(tray, &mut t).ok()?;
        let (tw, th) = (t.right - t.left, t.bottom - t.top);
        if tw < 8 || th < 8 { return Some((0, 0, w, h)); }          // an auto-hiding taskbar takes no room
        Some(if tw >= th {
            if t.top <= 0 { (0, t.bottom, w, h) } else { (0, 0, w, t.top) }
        } else if t.left <= 0 { (t.right, 0, w, h) } else { (0, 0, t.left, h) })
    }
}
