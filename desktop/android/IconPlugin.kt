package app.windmill.desktop

import android.app.Activity
import android.content.ComponentName
import android.content.pm.PackageManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class IconArgs {
    var variant: String = "blue"
}

/** Switches Windmill's launcher icon by enabling one activity alias and disabling the others. */
@TauriPlugin
class IconPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun setIcon(invoke: Invoke) {
        val args = invoke.parseArgs(IconArgs::class.java)
        val pm = activity.packageManager
        for (v in listOf("White", "Blue", "Black")) {
            val on = v.equals(args.variant, ignoreCase = true)
            pm.setComponentEnabledSetting(
                ComponentName(activity.packageName, "${activity.packageName}.Icon$v"),
                if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            )
        }
        invoke.resolve()
    }
}
