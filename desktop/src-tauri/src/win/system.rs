//! Battery, memory, processor, brightness, Wi-Fi, power, and the Windows taskbar.

use serde::Serialize;
use std::sync::Mutex;
use windows::core::w;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::Power::{GetSystemPowerStatus, SetSuspendState, SYSTEM_POWER_STATUS};
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::System::SystemInformation::{GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::GetSystemTimes;
use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, ShowWindow, SW_HIDE, SW_SHOW};

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

/// Hides (or brings back) the Windows taskbar on every screen.
pub fn set_taskbar_hidden(hidden: bool) {
    unsafe {
        for class in [w!("Shell_TrayWnd"), w!("Shell_SecondaryTrayWnd")] {
            if let Ok(h) = FindWindowW(class, None) {
                let _ = ShowWindow(h, if hidden { SW_HIDE } else { SW_SHOW });
            }
        }
    }
}
