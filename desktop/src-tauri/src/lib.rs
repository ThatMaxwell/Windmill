//! Windmill: a calm space for the apps already on your computer.
//!
//! The interface is one web page (the same one the preview site serves). Everything the page
//! needs from the computer goes through the commands in `shell.rs`; on Windows they are backed
//! by the Win32 code in `win/`. Elsewhere they report that the feature is Windows-only for now.

#[cfg(target_os = "android")]
mod android_icon;
mod appicon;
mod github;
mod shell;
#[cfg(windows)]
mod win;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(android_icon::init());
    }

    #[cfg(desktop)]
    {
        builder = builder
            // A second launch just brings Windmill forward.
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                let _ = shell::bring_forward(app);
            }))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--autostart"]),
            ));
    }

    builder
        .invoke_handler(tauri::generate_handler![
            shell::platform,
            shell::list_apps,
            shell::launch_app,
            shell::list_windows,
            shell::focus_window,
            shell::minimize_window,
            shell::close_window,
            shell::snap_window,
            shell::side_by_side,
            shell::get_volume,
            shell::set_volume,
            shell::set_mute,
            shell::battery,
            shell::system_stats,
            shell::get_brightness,
            shell::set_brightness,
            shell::wifi_status,
            shell::open_system_settings,
            shell::power,
            shell::import_wallpaper,
            shell::list_wallpapers,
            shell::remove_wallpaper,
            shell::screen_time,
            shell::set_taskbar_hidden,
            shell::show_windmill,
            shell::quit_windmill,
            shell::restart_windmill,
            shell::close_all_windows,
            github::github_ready,
            github::github_device_start,
            github::github_device_poll,
            github::github_profile,
            github::github_sign_out,
            appicon::get_app_icon,
            appicon::set_app_icon,
            shell::remote_start,
            shell::remote_stop,
            shell::remote_status,
            shell::remote_new_code,
        ])
        .setup(|app| {
            // Like pressing F11: Windmill fills the screen from the very first frame, with the taskbar
            // out of the way. (Settings can bring the taskbar back; F11 switches between the two.)
            #[cfg(windows)]
            {
                win::system::set_taskbar_hidden(true);
                // Even if something goes badly wrong, the taskbar comes back.
                let previous = std::panic::take_hook();
                std::panic::set_hook(Box::new(move |info| {
                    win::system::set_taskbar_hidden(false);
                    previous(info);
                }));
            }
            if let Some(w) = app.get_webview_window("main") {
                #[cfg(desktop)]
                let _ = w.set_fullscreen(true);
                let _ = w.set_focus();
            }
            appicon::apply_window_icon(app.handle());
            // First launch: start with Windows from now on (it can be switched off in Settings).
            #[cfg(desktop)]
            if let Ok(dir) = app.path().app_data_dir() {
                let marker = dir.join("first-run-done");
                if !marker.exists() {
                    use tauri_plugin_autostart::ManagerExt;
                    let _ = app.autolaunch().enable();
                    let _ = std::fs::create_dir_all(&dir);
                    let _ = std::fs::write(marker, "1");
                }
            }
            #[cfg(windows)]
            {
                win::hotkey::start(app.handle().clone());
                win::usage::start(app.handle().clone());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Windmill could not start")
        .run(|_app, event| {
            // Never leave the Windows taskbar hidden after Windmill closes.
            if let tauri::RunEvent::Exit = event {
                #[cfg(windows)]
                win::system::set_taskbar_hidden(false);
            }
        });
}
