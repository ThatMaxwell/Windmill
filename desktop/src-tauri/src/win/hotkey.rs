//! Ctrl + Win: press both (and nothing else), let go, and Windmill's panel pops up.
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
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, HHOOK, KBDLLHOOKSTRUCT,
    LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

static APP: OnceLock<AppHandle> = OnceLock::new();
static CTRL: AtomicBool = AtomicBool::new(false);
static WIN: AtomicBool = AtomicBool::new(false);
static ARMED: AtomicBool = AtomicBool::new(false); // both were down together
static SPOILED: AtomicBool = AtomicBool::new(false); // another key was pressed during the combo

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

fn fire() {
    if let Some(app) = APP.get() {
        let app = app.clone();
        let _ = app.clone().run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            let _ = app.emit("windmill://panel", ());
        });
    }
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
            } else if down && (CTRL.load(Ordering::SeqCst) || WIN.load(Ordering::SeqCst)) {
                // Ctrl+C, Win+D and friends keep working as usual.
                SPOILED.store(true, Ordering::SeqCst);
            }
        }
    }
    CallNextHookEx(HHOOK::default(), code, wp, lp)
}

pub fn start(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(|| unsafe {
        let module = GetModuleHandleW(None).unwrap_or_default();
        let Ok(_hook) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_key), HINSTANCE(module.0), 0) else {
            return;
        };
        // The hook only runs while this thread keeps pumping messages.
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}
