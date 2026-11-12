//! Real app icons, straight from the Windows shell, as PNG data URLs the page can show.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::Mutex;
use windows::core::{Interface, HSTRING};
use windows::Win32::Foundation::{HWND, SIZE};
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::UI::Shell::{
    IShellItem, IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
};

static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

/// Icon for anything the shell can parse: an exe path, a shortcut, or `shell:AppsFolder\<id>`.
pub fn for_parsing_name(name: &str) -> Option<String> {
    if let Some(hit) = CACHE.lock().ok()?.get_or_insert_with(HashMap::new).get(name) {
        return hit.clone();
    }
    let icon = unsafe {
        SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(name), None)
            .ok()
            .and_then(|item| for_item(&item))
    };
    if let Ok(mut c) = CACHE.lock() {
        c.get_or_insert_with(HashMap::new).insert(name.to_string(), icon.clone());
    }
    icon
}

pub unsafe fn for_item(item: &IShellItem) -> Option<String> {
    let factory: IShellItemImageFactory = item.cast().ok()?;
    let hbm = factory
        .GetImage(SIZE { cx: 96, cy: 96 }, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK)
        .ok()?;
    let png = bitmap_to_png(hbm);
    let _ = DeleteObject(hbm);
    png.map(|b| format!("data:image/png;base64,{}", B64.encode(b)))
}

unsafe fn bitmap_to_png(hbm: HBITMAP) -> Option<Vec<u8>> {
    let mut bm = BITMAP::default();
    if GetObjectW(hbm, std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut c_void)) == 0 {
        return None;
    }
    let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
    if w <= 0 || h <= 0 {
        return None;
    }
    let mut bi = BITMAPINFO::default();
    bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bi.bmiHeader.biWidth = w;
    bi.bmiHeader.biHeight = -h; // top-down rows
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 32;
    bi.bmiHeader.biCompression = BI_RGB.0;
    let mut px = vec![0u8; (w * h * 4) as usize];
    let hdc = GetDC(HWND::default());
    let lines = GetDIBits(hdc, hbm, 0, h as u32, Some(px.as_mut_ptr() as *mut c_void), &mut bi, DIB_RGB_COLORS);
    ReleaseDC(HWND::default(), hdc);
    if lines == 0 {
        return None;
    }
    let has_alpha = px.chunks(4).any(|p| p[3] != 0);
    for p in px.chunks_mut(4) {
        p.swap(0, 2); // BGRA -> RGBA
        if !has_alpha {
            p[3] = 255;
        } else if p[3] > 0 && p[3] < 255 {
            // the shell hands back premultiplied alpha
            let a = p[3] as u32;
            for c in &mut p[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().ok()?;
        wr.write_image_data(&px).ok()?;
    }
    Some(out)
}
