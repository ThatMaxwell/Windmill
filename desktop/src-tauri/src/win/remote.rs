//! Use this PC from your phone, from anywhere: Wi-Fi, Ethernet, mobile data, another network.
//!
//! The connection itself lives in Windmill's window (remote.js): the PC and the phone find each
//! other through a public matchmaking server using the pairing code, then talk directly over an
//! encrypted WebRTC link (or, when a network blocks that, through an encrypted relay).
//! This side only does what a web page can't: grab the screen, and press keys and click for the phone.
//! Nothing listens on a port, and nothing happens unless "Let my phone connect" is on.

use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::ffi::c_void;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
    SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
    HALFTONE, SRCCOPY,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS,
    VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DrawIconEx, GetCursorInfo, GetSystemMetrics, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, HICON, SM_CXSCREEN,
    SM_CYSCREEN,
};

/// The last frame handed out, so an unchanged screen isn't sent again.
static LAST_HASH: AtomicU64 = AtomicU64::new(0);
static LAST_AT: Mutex<Option<Instant>> = Mutex::new(None);
static TICKING: AtomicBool = AtomicBool::new(false);
/// At most ~20 frames a second, even on a fast network.
const MIN_GAP: Duration = Duration::from_millis(50);
/// A frame goes out at least this often, even when nothing on screen changed.
const REFRESH: Duration = Duration::from_millis(1500);

/// The screen size and the PC's name, for a phone that just paired. Also starts frames fresh.
pub fn hello() -> Value {
    LAST_HASH.store(0, Ordering::SeqCst);
    *LAST_AT.lock().unwrap() = None;
    let (w, h) = unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) };
    let name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "your PC".into());
    json!({ "w": w, "h": h, "name": name })
}

/// The next JPEG of the main screen: waits until the screen changes (or a refresh is due),
/// so the window never has to poll. Empty when there's nothing new for a while.
pub fn next_frame(max_width: i32, quality: u8) -> Vec<u8> {
    let started = Instant::now();
    if let Some(at) = *LAST_AT.lock().unwrap() {
        let since = at.elapsed();
        if since < MIN_GAP {
            std::thread::sleep(MIN_GAP - since);
        }
    }
    loop {
        if let Some((px, w, h, hash)) = capture(max_width.clamp(480, 1920)) {
            let due = LAST_AT.lock().unwrap().map(|t| t.elapsed() > REFRESH).unwrap_or(true);
            if hash != LAST_HASH.load(Ordering::SeqCst) || due {
                let mut out = Vec::with_capacity(120_000);
                if jpeg_encoder::Encoder::new(&mut out, quality.clamp(25, 90))
                    .encode(&px, w as u16, h as u16, jpeg_encoder::ColorType::Bgra)
                    .is_ok()
                {
                    LAST_HASH.store(hash, Ordering::SeqCst);
                    *LAST_AT.lock().unwrap() = Some(Instant::now());
                    return out;
                }
            }
        }
        if started.elapsed() > Duration::from_secs(2) {
            return vec![];
        }
        std::thread::sleep(Duration::from_millis(60));
    }
}

/// While the phone feature is on, a heartbeat for the window every 10 seconds, so the connection to
/// the matchmaking server stays up even when Windows lets Windmill's window sleep behind your apps.
pub fn keepalive<R: Runtime>(app: AppHandle<R>, on: bool) {
    if !on {
        TICKING.store(false, Ordering::SeqCst);
        return;
    }
    if TICKING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        while TICKING.load(Ordering::SeqCst) {
            let _ = app.emit("windmill://remote-tick", ());
            std::thread::sleep(Duration::from_secs(10));
        }
    });
}

/// The main screen as BGRA pixels, cursor included, scaled to at most `max_width`, plus a hash.
fn capture(max_width: i32) -> Option<(Vec<u8>, i32, i32, u64)> {
    unsafe {
        let (sw, sh) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
        if sw <= 0 || sh <= 0 {
            return None;
        }
        let scale = (max_width as f32 / sw as f32).min(1.0);
        let (tw, th) = (((sw as f32) * scale) as i32, ((sh as f32) * scale) as i32);
        let screen = GetDC(HWND::default());
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, tw, th);
        let old = SelectObject(mem, bmp);
        if scale < 1.0 {
            SetStretchBltMode(mem, HALFTONE);
            let _ = StretchBlt(mem, 0, 0, tw, th, screen, 0, 0, sw, sh, SRCCOPY | CAPTUREBLT);
        } else {
            let _ = BitBlt(mem, 0, 0, tw, th, screen, 0, 0, SRCCOPY | CAPTUREBLT);
        }
        let mut ci = CURSORINFO { cbSize: std::mem::size_of::<CURSORINFO>() as u32, ..Default::default() };
        if GetCursorInfo(&mut ci).is_ok() && (ci.flags.0 & CURSOR_SHOWING.0) != 0 {
            let size = (32.0 * scale.max(0.6)) as i32;
            let _ = DrawIconEx(
                mem,
                (ci.ptScreenPos.x as f32 * scale) as i32,
                (ci.ptScreenPos.y as f32 * scale) as i32,
                HICON(ci.hCursor.0),
                size,
                size,
                0,
                None,
                DI_NORMAL,
            );
        }
        let mut bi = BITMAPINFO::default();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = tw;
        bi.bmiHeader.biHeight = -th;
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB.0;
        let mut px = vec![0u8; (tw * th * 4) as usize];
        let lines = GetDIBits(mem, bmp, 0, th as u32, Some(px.as_mut_ptr() as *mut c_void), &mut bi, DIB_RGB_COLORS);
        SelectObject(mem, old);
        let _ = DeleteObject(bmp);
        let _ = DeleteDC(mem);
        ReleaseDC(HWND::default(), screen);
        if lines == 0 {
            return None;
        }
        let mut h = DefaultHasher::new();
        (tw, th).hash(&mut h);
        px.iter().step_by(97).for_each(|b| b.hash(&mut h));
        Some((px, tw, th, h.finish()))
    }
}

fn send(inputs: &[INPUT]) {
    unsafe {
        SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn mouse(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32, data: i32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx, dy, mouseData: data as _, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn key(vk: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

/// A tap, drag, scroll, or typing from the phone.
pub fn input<R: Runtime>(app: &AppHandle<R>, v: &Value) {
    let at = || {
        let x = (v["x"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0) * 65535.0) as i32;
        let y = (v["y"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0) * 65535.0) as i32;
        mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, x, y, 0)
    };
    let right = v["b"].as_i64() == Some(2);
    let (down, up) = if right {
        (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
    } else {
        (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
    };
    match v["t"].as_str().unwrap_or("") {
        "move" => send(&[at()]),
        "down" => send(&[at(), mouse(down, 0, 0, 0)]),
        "up" => send(&[at(), mouse(up, 0, 0, 0)]),
        "click" => send(&[at(), mouse(down, 0, 0, 0), mouse(up, 0, 0, 0)]),
        "wheel" => {
            let dy = v["dy"].as_f64().unwrap_or(0.0).clamp(-2400.0, 2400.0) as i32;
            let dx = v["dx"].as_f64().unwrap_or(0.0).clamp(-2400.0, 2400.0) as i32;
            if dy != 0 {
                send(&[mouse(MOUSEEVENTF_WHEEL, 0, 0, dy)]);
            }
            if dx != 0 {
                send(&[mouse(MOUSEEVENTF_HWHEEL, 0, 0, dx)]);
            }
        }
        "text" => {
            let mut inputs = vec![];
            for u in v["s"].as_str().unwrap_or("").chars().take(500).collect::<String>().encode_utf16() {
                inputs.push(key(0, u, KEYEVENTF_UNICODE));
                inputs.push(key(0, u, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
            }
            send(&inputs);
        }
        "key" => {
            let vk: u16 = match v["k"].as_str().unwrap_or("") {
                "Enter" => 0x0D,
                "Backspace" => 0x08,
                "Tab" => 0x09,
                "Escape" => 0x1B,
                "Delete" => 0x2E,
                "ArrowLeft" => 0x25,
                "ArrowUp" => 0x26,
                "ArrowRight" => 0x27,
                "ArrowDown" => 0x28,
                "Home" => 0x24,
                "End" => 0x23,
                "Win" => 0x5B,
                _ => return,
            };
            send(&[key(vk, 0, KEYBD_EVENT_FLAGS(0)), key(vk, 0, KEYEVENTF_KEYUP)]);
        }
        "panel" => {
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(w) = app2.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                let _ = app2.emit("windmill://panel", ());
            });
        }
        _ => {}
    }
}
