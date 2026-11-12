"""Run after `tauri android init`: adds the switchable launcher icons and the icon plugin."""
import pathlib, re, shutil, sys

root = pathlib.Path(__file__).resolve().parent.parent          # desktop/
gen = root / "src-tauri" / "gen" / "android" / "app" / "src" / "main"
manifest = gen / "AndroidManifest.xml"
if not manifest.exists():
    sys.exit("Run `tauri android init` first.")

# 1. the three icons as mipmaps
for dens in (root / "src-tauri" / "icons" / "variants" / "android").iterdir():
    dest = gen / "res" / dens.name
    dest.mkdir(parents=True, exist_ok=True)
    for f in dens.iterdir():
        shutil.copy(f, dest / f.name)

# 2. the plugin, next to MainActivity
mains = list((gen / "java").rglob("MainActivity.kt"))
if not mains:
    sys.exit("MainActivity.kt not found")
shutil.copy(root / "android" / "IconPlugin.kt", mains[0].parent / "IconPlugin.kt")

# 3. launcher aliases: MainActivity stops being the launcher entry, three aliases take turns
xml = manifest.read_text()
if "IconBlue" not in xml:
    xml = xml.replace('<category android:name="android.intent.category.LAUNCHER" />', "", 1)
    xml = xml.replace('<category android:name="android.intent.category.LAUNCHER"/>', "", 1)
    aliases = ""
    for v, on in (("Blue", "true"), ("White", "false"), ("Black", "false")):
        icon = f"@mipmap/ic_launcher_{v.lower()}"
        aliases += f'''
        <activity-alias android:name=".Icon{v}" android:targetActivity=".MainActivity" android:enabled="{on}"
            android:exported="true" android:icon="{icon}" android:roundIcon="{icon}" android:label="Windmill">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity-alias>'''
    xml = xml.replace("</application>", aliases + "\n    </application>", 1)
    manifest.write_text(xml)
print("Android project patched: switchable icons + IconPlugin")
