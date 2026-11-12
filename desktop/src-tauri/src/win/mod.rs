//! The Windows side of Windmill: real apps, real windows, real sound and power.

pub mod apps;
pub mod audio;
pub mod hotkey;
pub mod icons;
pub mod remote;
pub mod system;
pub mod usage;
pub mod windows;

/// Initialise COM on the current thread (needed by the shell and audio APIs). Safe to call twice.
pub fn com() {
    unsafe {
        let _ = ::windows::Win32::System::Com::CoInitializeEx(
            None,
            ::windows::Win32::System::Com::COINIT_APARTMENTTHREADED,
        );
    }
}

/// Run a command line tool without flashing a console window.
pub fn quiet(cmd: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut c = std::process::Command::new(cmd);
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}
