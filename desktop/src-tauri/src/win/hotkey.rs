//! Ctrl + Win: press both (and nothing else), let go, and Windmill's panel pops up.
//! Also, while another app is in front: Ctrl + K opens Windmill Search, pushing the pointer against the
//! bottom edge brings up the dock, and new app windows open full screen.
//!
//! Windows can't register a shortcut made only of modifier keys, so this watches the keyboard
//! with a low-level hook. When the combo fires it also stops the Start menu from opening.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetCursorPos, GetForegroundWindow, GetMessageW, GetSystemMetrics, GetWindowLongW,
    GetWindowThreadProcessId, IsIconic, IsZoomed, SetWindowsHookExW, ShowWindow, TranslateMessage, GWL_STYLE, HHOOK,
    KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, SM_CXSCREEN, SM_CYSCREEN, SW_MAXIMIZE, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
    WM_SYSKEYDOWN, WM_SYSKEYUP, WS_CAPTION, WS_MAXIMIZEBOX, WS_THICKFRAME,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::System::Threading::GetCurrentProcessId;
use std::collections::HashSet;
use std::sync::Mutex;

static APP: OnceLock<AppHandle> = OnceLock::new();
static CTRL: AtomicBool = AtomicBool::new(false);
static WIN: AtomicBool = AtomicBool::new(false);
static ARMED: AtomicBool = AtomicBool::new(false); // both were down together
static SPOILED: AtomicBool = AtomicBool::new(false); // another key was pressed during the combo

/// Windmill is full screen with the taskbar out of the way (set by system::set_taskbar_hidden).
pub static FULL_SCREEN: AtomicBool = AtomicBool::new(false);
/// Settings -> Windmill: new app windows open full screen.
pub static APPS_FULL_SCREEN: AtomicBool = AtomicBool::new(true);
/// Settings -> Windmill: Ctrl + K opens Windmill Search even when another app is in front.
pub static GLOBAL_SEARCH: AtomicBool = AtomicBool::new(true);
/// Settings -> Windmill: the bottom edge of the screen calls the dock.
pub static EDGE_DOCK: AtomicBool = AtomicBool::new(true);
static SEEN: Mutex<Option<HashSet<isize>>> = Mutex::new(None);

/// Apps where Ctrl + K already means something people rely on: code editors (chords), Office (insert link),
/// and chat apps (quick switcher). There, Ctrl + K stays theirs.
const KEEPS_CTRL_K: &[&str] = &[
    "code.exe", "code - insiders.exe", "cursor.exe", "windsurf.exe", "zed.exe", "devenv.exe", "sublime_text.exe",
    "idea64.exe", "pycharm64.exe", "webstorm64.exe", "rider64.exe", "clion64.exe", "goland64.exe", "rustrover64.exe",
    "winword.exe", "excel.exe", "powerpnt.exe", "outlook.exe", "onenote.exe", "olk.exe",
    "slack.exe", "discord.exe", "teams.exe", "ms-teams.exe", "notion.exe", "linear.exe", "figma.exe",
];
const VK_K: u32 = 0x4B;

const VK_LCONTROL: u32 = 0xA2;
const VK_RCONTROL: u32 = 0xA3;
const VK_CONTROL: u32 = 0x11;
const VK_LWIN: u32 = 0x5B;
const VK_RWIN: u32 = 0x5C;
const VK_MASK: u16 = 0xE8; // an unassigned key: tapping it stops Windows from opening Start

fn tap_mask() {
    let key = |flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: VIRTUAL_KEY(VK_MASK), wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
        },
    };
    let inputs = [key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)];
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn fire() { bring("windmill://panel"); }

/// Bring Windmill to the front and tell the page what to open.
fn bring(event: &'static str) {
    if let Some(app) = APP.get() {
        let app = app.clone();
        let _ = app.clone().run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            let _ = app.emit(event, ());
        });
    }
}

unsafe fn windmill_in_front() -> bool {
    let h = GetForegroundWindow();
    let mut pid = 0u32;
    GetWindowThreadProcessId(h, Some(&mut pid));
    pid == GetCurrentProcessId()
}

unsafe fn front_keeps_ctrl_k() -> bool {
    let exe = super::windows::exe_path(GetForegroundWindow()).to_lowercase();
    let name = exe.rsplit(['\\', '/']).next().unwrap_or("").to_string();
    KEEPS_CTRL_K.iter().any(|k| *k == name)
}

unsafe extern "system" fn on_key(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if code >= 0 {
        let k = &*(lp.0 as *const KBDLLHOOKSTRUCT);
        if k.flags.0 & LLKHF_INJECTED.0 == 0 {
            let msg = wp.0 as u32;
            let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            let up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
            let is_ctrl = matches!(k.vkCode, VK_LCONTROL | VK_RCONTROL | VK_CONTROL);
            let is_win = matches!(k.vkCode, VK_LWIN | VK_RWIN);
            if is_ctrl || is_win {
                let flag = if is_ctrl { &CTRL } else { &WIN };
                if down {
                    flag.store(true, Ordering::SeqCst);
                    if CTRL.load(Ordering::SeqCst) && WIN.load(Ordering::SeqCst) {
                        ARMED.store(true, Ordering::SeqCst);
                    }
                } else if up {
                    if ARMED.load(Ordering::SeqCst) && !SPOILED.load(Ordering::SeqCst) {
                        tap_mask();
                        fire();
                    }
                    if is_win {
                        // a lone Win tap after the combo shouldn't open Start either
                        if ARMED.load(Ordering::SeqCst) {
                            tap_mask();
                        }
                    }
                    flag.store(false, Ordering::SeqCst);
                    ARMED.store(false, Ordering::SeqCst);
                    if !CTRL.load(Ordering::SeqCst) && !WIN.load(Ordering::SeqCst) {
                        SPOILED.store(false, Ordering::SeqCst);
                    } else {
                        // one of the two is still held; don't fire twice
                        SPOILED.store(true, Ordering::SeqCst);
                    }
                }
            } else if down
                && k.vkCode == VK_K
                && CTRL.load(Ordering::SeqCst)
                && !WIN.load(Ordering::SeqCst)
                && GLOBAL_SEARCH.load(Ordering::SeqCst)
                && GetAsyncKeyState(0x10) as u16 & 0x8000 == 0
                && GetAsyncKeyState(0x12) as u16 & 0x8000 == 0
                && !windmill_in_front()
                && !front_keeps_ctrl_k()
            {
                // Ctrl + K from anywhere: Windmill Search
                SPOILED.store(true, Ordering::SeqCst);
                bring("windmill://search");
                return LRESULT(1);
            } else if down && (CTRL.load(Ordering::SeqCst) || WIN.load(Ordering::SeqCst)) {
                // Ctrl+C, Win+D and friends keep working as usual.
                SPOILED.store(true, Ordering::SeqCst);
            }
        }
    }
    CallNextHookEx(HHOOK::default(), code, wp, lp)
}

/// A new app window came to the front: the first time we see it, it opens full screen.
unsafe extern "system" fn on_foreground(_h: HWINEVENTHOOK, _e: u32, hwnd: HWND, id_object: i32, _c: i32, _t: u32, _ms: u32) {
    if id_object != 0 || !APPS_FULL_SCREEN.load(Ordering::SeqCst) || !FULL_SCREEN.load(Ordering::SeqCst) {
        return;
    }
    if !super::windows::is_app_window(hwnd, GetCurrentProcessId()) || IsIconic(hwnd).as_bool() || IsZoomed(hwnd).as_bool() {
        return;
    }
    let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
    if style & WS_MAXIMIZEBOX.0 == 0 || style & WS_THICKFRAME.0 == 0 {
        return; // dialogs and fixed-size windows stay as they are
    }
    let mut seen = match SEEN.lock() { Ok(g) => g, Err(p) => p.into_inner() };
    if seen.get_or_insert_with(HashSet::new).insert(hwnd.0 as isize) {
        let _ = ShowWindow(hwnd, SW_MAXIMIZE);
    }
}

/// Push the pointer against the bottom edge for a moment, over any app, and the dock comes up.
fn watch_bottom_edge() {
    std::thread::spawn(|| unsafe {
        let (mut held, mut fired) = (0u32, false);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(40));
            if !EDGE_DOCK.load(Ordering::SeqCst) || !FULL_SCREEN.load(Ordering::SeqCst) {
                held = 0;
                continue;
            }
            let mut p = POINT::default();
            if GetCursorPos(&mut p).is_err() { continue; }
            let (w, h) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
            let at_edge = p.y >= h - 2 && p.x > w / 5 && p.x < w * 4 / 5;
            if at_edge {
                held += 40;
                let front = GetForegroundWindow();
                let borderless = GetWindowLongW(front, GWL_STYLE) as u32 & WS_CAPTION.0 == 0;
                if held >= 240 && !fired && !windmill_in_front() && !borderless {
                    fired = true;
                    bring("windmill://dock");
                }
            } else {
                held = 0;
                if p.y < h - 160 { fired = false; }
            }
        }
    });
}

pub fn start(app: AppHandle) {
    let _ = APP.set(app);
    watch_bottom_edge();
    std::thread::spawn(|| unsafe {
        let module = GetModuleHandleW(None).unwrap_or_default();
        let Ok(_hook) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_key), HINSTANCE(module.0), 0) else {
            return;
        };
        // EVENT_SYSTEM_FOREGROUND, delivered to this thread's message loop
        let _fg = SetWinEventHook(3, 3, None, Some(on_foreground), 0, 0, 0 | 2);
        // The hook only runs while this thread keeps pumping messages.
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}
