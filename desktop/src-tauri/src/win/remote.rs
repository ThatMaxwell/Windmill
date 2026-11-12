//! Use this PC from your Android phone, over your own Wi-Fi.
//!
//! When you turn it on in Windmill (Phone), the PC listens on port 47321 of your local network.
//! The phone must send the 6-digit code shown on the PC before anything else; only one phone at a time.
//! The PC streams small JPEG frames of the main screen (one at a time: the phone asks for the next one)
//! and the phone sends taps, drags, scrolls and typing back.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::ffi::c_void;
use std::hash::{BuildHasher, Hash, Hasher};
use std::io::ErrorKind;
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tungstenite::{accept, Message};
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

pub const PORT: u16 = 47321;
const MAX_WIDTH: i32 = 1280;

#[derive(Serialize, Clone, Default)]
pub struct Status {
    pub running: bool,
    pub port: u16,
    pub address: Option<String>,
    pub code: String,
    pub phone: Option<String>,
}

struct State {
    running: bool,
    code: String,
    phone: Option<String>,
    stop: Arc<AtomicBool>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn random_code() -> String {
    let mut h: DefaultHasher = std::collections::hash_map::RandomState::new().build_hasher();
    std::time::SystemTime::now().hash(&mut h);
    std::process::id().hash(&mut h);
    format!("{:06}", h.finish() % 1_000_000)
}

/// The PC's address on the local network (no traffic is sent to find it).
fn local_address() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

pub fn status() -> Status {
    let st = STATE.lock().unwrap();
    match st.as_ref() {
        Some(s) => Status {
            running: s.running,
            port: PORT,
            address: local_address(),
            code: s.code.clone(),
            phone: s.phone.clone(),
        },
        None => Status { port: PORT, address: local_address(), ..Default::default() },
    }
}

pub fn new_code() -> Status {
    if let Some(s) = STATE.lock().unwrap().as_mut() {
        s.code = random_code();
    }
    status()
}

pub fn stop() -> Status {
    if let Some(s) = STATE.lock().unwrap().as_mut() {
        s.stop.store(true, Ordering::SeqCst);
        s.running = false;
        s.phone = None;
    }
    status()
}

pub fn start<R: Runtime>(app: AppHandle<R>) -> Result<Status, String> {
    {
        let st = STATE.lock().unwrap();
        if st.as_ref().map(|s| s.running).unwrap_or(false) {
            drop(st);
            return Ok(status());
        }
    }
    let listener = TcpListener::bind(("0.0.0.0", PORT))
        .map_err(|e| format!("Couldn't open port {PORT}: {e}. Is another copy of Windmill running?"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    *STATE.lock().unwrap() = Some(State { running: true, code: random_code(), phone: None, stop: stop.clone() });

    std::thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, peer)) => {
                    let busy = STATE.lock().unwrap().as_ref().map(|s| s.phone.is_some()).unwrap_or(true);
                    if busy {
                        let _ = stream.shutdown(std::net::Shutdown::Both);
                        continue;
                    }
                    let app = app.clone();
                    let stop = stop.clone();
                    std::thread::spawn(move || session(app, stream, peer.ip().to_string(), stop));
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
                Err(_) => std::thread::sleep(Duration::from_millis(500)),
            }
        }
    });
    Ok(status())
}

fn set_phone(p: Option<String>) {
    if let Some(s) = STATE.lock().unwrap().as_mut() {
        s.phone = p;
    }
}

fn session<R: Runtime>(app: AppHandle<R>, stream: TcpStream, peer: String, stop: Arc<AtomicBool>) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let Ok(mut ws) = accept(stream) else { return };

    // 1. the phone proves it knows the code
    let ok = match ws.read() {
        Ok(Message::Text(t)) => {
            let v: Value = serde_json::from_str(&t).unwrap_or_default();
            let want = STATE.lock().unwrap().as_ref().map(|s| s.code.clone()).unwrap_or_default();
            v["t"] == "hello" && v["code"].as_str().map(|c| c.replace(' ', "")) == Some(want)
        }
        _ => false,
    };
    if !ok {
        let _ = ws.send(Message::Text(json!({ "t": "error", "why": "That code doesn't match. Check the code on your PC." }).to_string()));
        let _ = ws.close(None);
        return;
    }
    let (sw, sh) = unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) };
    let name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "your PC".into());
    let _ = ws.send(Message::Text(json!({ "t": "ok", "w": sw, "h": sh, "name": name }).to_string()));
    set_phone(Some(peer.clone()));
    let _ = app.emit("windmill://remote", json!({ "phone": peer }));

    // 2. frames out, input in
    let _ = ws.get_ref().set_read_timeout(Some(Duration::from_millis(12)));
    let mut want_frame = true;
    let mut last_hash = 0u64;
    let mut last_sent = Instant::now() - Duration::from_secs(5);
    let mut waiting_since = Instant::now();
    'outer: while !stop.load(Ordering::SeqCst) {
        loop {
            match ws.read() {
                Ok(Message::Text(t)) => {
                    let v: Value = serde_json::from_str(&t).unwrap_or_default();
                    if v["t"] == "ack" {
                        want_frame = true;
                    } else if v["t"] == "bye" {
                        break 'outer;
                    } else {
                        handle(&app, &v, sw, sh);
                    }
                }
                Ok(Message::Close(_)) => break 'outer,
                Ok(_) => {}
                Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => break,
                Err(_) => break 'outer,
            }
        }
        // the phone asks for each frame, so slow Wi-Fi never piles them up; resend if an ack got lost
        if !want_frame && waiting_since.elapsed() > Duration::from_secs(3) {
            want_frame = true;
        }
        if want_frame && last_sent.elapsed() >= Duration::from_millis(70) {
            if let Some((jpeg, hash)) = frame() {
                if hash != last_hash || last_sent.elapsed() > Duration::from_millis(1500) {
                    if ws.send(Message::Binary(jpeg)).is_err() {
                        break;
                    }
                    last_hash = hash;
                    last_sent = Instant::now();
                    want_frame = false;
                    waiting_since = Instant::now();
                }
            }
        }
        std::thread::sleep(Duration::from_millis(8));
    }
    let _ = ws.close(None);
    set_phone(None);
    let _ = app.emit("windmill://remote", json!({ "phone": null }));
}

/// One small JPEG of the main screen, cursor included, plus a hash to skip identical frames.
fn frame() -> Option<(Vec<u8>, u64)> {
    unsafe {
        let (sw, sh) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
        if sw <= 0 || sh <= 0 {
            return None;
        }
        let scale = (MAX_WIDTH as f32 / sw as f32).min(1.0);
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
        px.iter().step_by(97).for_each(|b| b.hash(&mut h));
        let mut out = Vec::with_capacity(120_000);
        jpeg_encoder::Encoder::new(&mut out, 58)
            .encode(&px, tw as u16, th as u16, jpeg_encoder::ColorType::Bgra)
            .ok()?;
        Some((out, h.finish()))
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

fn handle<R: Runtime>(app: &AppHandle<R>, v: &Value, _sw: i32, _sh: i32) {
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
            let dy = v["dy"].as_f64().unwrap_or(0.0) as i32;
            let dx = v["dx"].as_f64().unwrap_or(0.0) as i32;
            if dy != 0 {
                send(&[mouse(MOUSEEVENTF_WHEEL, 0, 0, dy)]);
            }
            if dx != 0 {
                send(&[mouse(MOUSEEVENTF_HWHEEL, 0, 0, dx)]);
            }
        }
        "text" => {
            let mut inputs = vec![];
            for u in v["s"].as_str().unwrap_or("").encode_utf16() {
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
