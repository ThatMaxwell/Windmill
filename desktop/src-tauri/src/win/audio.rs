//! The PC's real master volume.

use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

fn endpoint() -> Result<IAudioEndpointVolume, String> {
    super::com();
    unsafe {
        let devices: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let speakers = devices
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|_| "No speakers or headphones found.".to_string())?;
        speakers.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).map_err(|e| e.to_string())
    }
}

pub fn get() -> Result<(f32, bool), String> {
    let v = endpoint()?;
    unsafe {
        let level = v.GetMasterVolumeLevelScalar().map_err(|e| e.to_string())?;
        let muted = v.GetMute().map_err(|e| e.to_string())?.as_bool();
        Ok((level, muted))
    }
}

pub fn set_level(level: f32) -> Result<(), String> {
    let v = endpoint()?;
    unsafe {
        v.SetMasterVolumeLevelScalar(level, std::ptr::null()).map_err(|e| e.to_string())?;
        if level > 0.0 {
            let _ = v.SetMute(false, std::ptr::null());
        }
    }
    Ok(())
}

pub fn set_mute(muted: bool) -> Result<(), String> {
    let v = endpoint()?;
    unsafe { v.SetMute(muted, std::ptr::null()) }.map_err(|e| e.to_string())
}
