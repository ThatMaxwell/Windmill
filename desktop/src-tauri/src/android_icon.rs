//! Android side of the app icon switch: a tiny native plugin (android/IconPlugin.kt) that turns
//! one launcher alias on and the others off.

use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

pub struct IconHandle<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("windmill-icon")
        .setup(|app, api| {
            let handle = api.register_android_plugin("app.windmill.desktop", "IconPlugin")?;
            app.manage(IconHandle(handle));
            Ok(())
        })
        .build()
}

pub fn set<R: Runtime>(app: &AppHandle<R>, variant: &str) -> Result<(), String> {
    let h = app.try_state::<IconHandle<R>>().ok_or("Icon switching isn't ready yet.")?;
    h.0
        .run_mobile_plugin::<serde_json::Value>("setIcon", serde_json::json!({ "variant": variant }))
        .map(|_| ())
        .map_err(|e| e.to_string())
}
