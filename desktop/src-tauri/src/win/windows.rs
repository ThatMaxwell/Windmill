//! The windows of your other apps: list them, bring one forward, tuck it away, close it,
//! or snap it to half of the screen.

use serde::Serialize;
use std::ffi::c_void;
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MENU};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowRect,
    GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
    PostMessageW, SetForegroundWindow, SetWindowPos, ShowWindow, GWL_EXSTYLE, GW_OWNER, SWP_NOZORDER,
    SWP_SHOWWINDOW, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE, WM_CLOSE, WS_EX_TOOLWINDOW,
};

#[derive(Serialize, Clone)]
pub struct Win {
    pub id: isize,
    pub title: String,
    pub exe: String,
    pub app: String,
    pub icon: Option<String>,
    pub minimized: bool,
    pub focused: bool,
}

fn hwnd(id: isize) -> Result<HWND, String> {
    let h = HWND(id as *mut c_void);
    if unsafe { IsWindow(h).as_bool() } {
        Ok(h)
    } else {
        Err("That window has closed.".into())
    }
}

pub(crate) unsafe fn exe_path(h: HWND) -> String {
    let mut pid = 0u32;
    GetWindowThreadProcessId(h, Some(&mut pid));
    let Ok(proc_) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let path = if QueryFullProcessImageNameW(proc_, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok() {
        String::from_utf16_lossy(&buf[..len as usize])
    } else {
        String::new()
    };
    let _ = CloseHandle(proc_);
    path
}

pub(crate) unsafe fn is_app_window(h: HWND, me: u32) -> bool {
    if !IsWindowVisible(h).as_bool() || GetWindowTextLengthW(h) == 0 {
        return false;
    }
    if GetWindow(h, GW_OWNER).map(|o| !o.is_invalid()).unwrap_or(false) {
        return false;
    }
    if (GetWindowLongW(h, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW.0 != 0 {
        return false;
    }
    let mut cloaked = 0u32;
    let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut c_void, 4);
    if cloaked != 0 {
        return false;
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(h, Some(&mut pid));
    if pid == me {
        return false;
    }
    let mut class = [0u16; 64];
    let n = GetClassNameW(h, &mut class) as usize;
    let class = String::from_utf16_lossy(&class[..n]);
    !matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}

unsafe extern "system" fn collect(h: HWND, lp: LPARAM) -> BOOL {
    let list = &mut *(lp.0 as *mut Vec<HWND>);
    list.push(h);
    true.into()
}

fn pretty_app(exe: &str, title: &str) -> String {
    let stem = std::path::Path::new(exe)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    match stem.to_lowercase().as_str() {
        "" | "applicationframehost" => title.rsplit(" - ").next().unwrap_or(title).to_string(),
        "msedge" => "Microsoft Edge".into(),
        "chrome" => "Google Chrome".into(),
        "explorer" => "File Explorer".into(),
        "code" => "Visual Studio Code".into(),
        "windowsterminal" => "Terminal".into(),
        _ => {
            let mut c = stem.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        }
    }
}

pub fn list() -> Vec<Win> {
    super::com();
    let mut handles: Vec<HWND> = vec![];
    let mut out = vec![];
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut handles as *mut _ as isize));
        let me = GetCurrentProcessId();
        let fg = GetForegroundWindow();
        for h in handles {
            if !is_app_window(h, me) {
                continue;
            }
            let mut buf = vec![0u16; GetWindowTextLengthW(h) as usize + 1];
            let n = GetWindowTextW(h, &mut buf) as usize;
            let title = String::from_utf16_lossy(&buf[..n]);
            let exe = exe_path(h);
            let icon = if exe.is_empty() { None } else { super::icons::for_parsing_name(&exe) };
            out.push(Win {
                id: h.0 as isize,
                app: pretty_app(&exe, &title),
                title,
                exe,
                icon,
                minimized: IsIconic(h).as_bool(),
                focused: h == fg,
            });
        }
    }
    out
}

pub fn focus(id: isize) -> Result<(), String> {
    let h = hwnd(id)?;
    unsafe {
        if IsIconic(h).as_bool() {
            let _ = ShowWindow(h, SW_RESTORE);
        }
        if !SetForegroundWindow(h).as_bool() {
            // Windows only lets the app that last had input change focus; a tap of Alt grants it.
            keybd_event(VK_MENU.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
            keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);
            let _ = SetForegroundWindow(h);
        }
    }
    Ok(())
}

pub fn minimize(id: isize) -> Result<(), String> {
    let h = hwnd(id)?;
    unsafe {
        let _ = ShowWindow(h, SW_MINIMIZE);
    }
    Ok(())
}

pub fn close(id: isize) -> Result<(), String> {
    let h = hwnd(id)?;
    unsafe { PostMessageW(h, WM_CLOSE, WPARAM(0), LPARAM(0)) }.map_err(|e| e.to_string())
}

pub fn snap(id: isize, side: &str) -> Result<(), String> {
    let h = hwnd(id)?;
    unsafe {
        if side == "full" {
            let _ = ShowWindow(h, SW_MAXIMIZE);
            return focus(id);
        }
        let _ = ShowWindow(h, SW_RESTORE);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let _ = GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mut mi);
        let r = mi.rcWork;
        let (w, hh) = (r.right - r.left, r.bottom - r.top);
        let (x, y, cw, ch) = match side {
            "left" => (r.left, r.top, w / 2, hh),
            "right" => (r.left + w / 2, r.top, w - w / 2, hh),
            "top" => (r.left, r.top, w, hh / 2),
            "bottom" => (r.left, r.top + hh / 2, w, hh - hh / 2),
            "center" => (r.left + w / 8, r.top + hh / 10, w * 3 / 4, hh * 4 / 5),
            _ => return Err(format!("Unknown place: {side}")),
        };
        // Windows 10/11 windows carry an invisible border; grow the box so the visible edges meet exactly.
        let mut outer = RECT::default();
        let mut visible = RECT::default();
        let _ = GetWindowRect(h, &mut outer);
        let shadow = DwmGetWindowAttribute(
            h,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut visible as *mut _ as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        )
        .is_ok();
        let (l, t, rr, b) = if shadow {
            (visible.left - outer.left, visible.top - outer.top, outer.right - visible.right, outer.bottom - visible.bottom)
        } else {
            (0, 0, 0, 0)
        };
        SetWindowPos(h, HWND::default(), x - l, y - t, cw + l + rr, ch + t + b, SWP_NOZORDER | SWP_SHOWWINDOW)
            .map_err(|e| e.to_string())?;
    }
    focus(id)
}
