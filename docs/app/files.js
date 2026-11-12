/* Files, for real (Windows app): your folders and drives, real icons, open with the usual app, show in Explorer.
   In a browser the example Files window stays. */
(() => {
  const W = window.Windmill, T = window.__TAURI__;
  const isApp = !!(T && T.core && T.core.invoke);
  if (!W || !isApp || /Android/i.test(navigator.userAgent)) return;
  const call = (c, a) => T.core.invoke(c, a);
  const win = document.getElementById("win-files"); if (!win) return;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  win.dataset.w = "1000"; win.dataset.h = "620";
  win.style.setProperty("--ww", "1000px"); win.style.setProperty("--wh", "620px");
  const sub = win.querySelector(".wsub"); if (sub) sub.textContent = "";
  const body = win.querySelector(".wbody");
  body.className = "wbody fx";
  body.innerHTML = `
    <nav class="side fx-side" id="fxSide" aria-label="Places"></nav>
    <div class="fx-main">
      <div class="fx-bar">
        <button class="fx-nav" type="button" id="fxBack" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg></button>
        <button class="fx-nav" type="button" id="fxUp" aria-label="Up one folder"><svg viewBox="0 0 24 24"><path d="M12 19V5.5M6 11.5l6-6 6 6"/></svg></button>
        <div class="fx-crumbs" id="fxCrumbs"></div>
        <label class="fx-filter"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.6 15.6l4.4 4.4"/></svg><input id="fxFilter" placeholder="Filter" spellcheck="false" autocomplete="off"></label>
      </div>
      <div class="fx-list" id="fxList" role="listbox" tabindex="0" aria-label="Files"></div>
    </div>
    <aside class="fx-info" id="fxInfo"></aside>`;
  const $ = id => document.getElementById(id);
  const FOLDER = '<svg class="fx-ico" viewBox="0 0 48 48"><path d="M5 13a4 4 0 0 1 4-4h9.5l4 4H39a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#2f6cf0"/><path d="M5 18a4 4 0 0 1 4-4h30a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#5b93ff"/></svg>';
  const FILE = ext => `<svg class="fx-ico" viewBox="0 0 48 48"><path d="M12 5h17l9 9v27a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z" fill="#fff" stroke="#c9cfdb" stroke-width="1.5"/><path d="M29 5v7a2 2 0 0 0 2 2h7" fill="#eef1f7" stroke="#c9cfdb" stroke-width="1.5"/>${ext ? `<text x="24" y="35" text-anchor="middle" font-size="9" font-weight="700" fill="#5c6275" font-family="Segoe UI, sans-serif">${esc(ext.slice(0, 4).toUpperCase())}</text>` : ""}</svg>`;
  const PLACE = {
    home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
    desktop: '<rect x="3.5" y="5" width="17" height="11.5" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
    documents: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5v4h4M9.5 12h5M9.5 15.5h5"/>',
    downloads: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    pictures: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 2.5-2 4.5 3.5"/>',
    music: '<path d="M9.5 17.5V6l9-2v11.5"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="16" cy="15.5" r="2.5"/>',
    videos: '<rect x="3.5" y="6" width="12.5" height="12" rx="2.5"/><path d="m16 10 4.5-2.5v9L16 14"/>',
    drive: '<rect x="3.5" y="7" width="17" height="10" rx="2.5"/><circle cx="16.5" cy="12" r="1" fill="currentColor"/>',
  };
  const fmtSize = b => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(1)} GB`;
  const fmtDate = s => s ? new Date(s * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  const KIND = { pdf: "PDF", doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel", ppt: "PowerPoint", pptx: "PowerPoint", txt: "Text", md: "Markdown",
    png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", webp: "Image", svg: "Image", mp4: "Video", mov: "Video", mkv: "Video", mp3: "Audio", wav: "Audio", flac: "Audio",
    zip: "Archive", rar: "Archive", "7z": "Archive", exe: "App", msi: "Installer", lnk: "Shortcut" };

  let path = "", back = [], entries = [], sel = -1, places = [];
  const iconCache = new Map();
  const iconKey = e => (["exe", "lnk", "ico", "url", "msi", ""].includes(e.ext) ? e.path : "." + e.ext);

  async function loadPlaces() {
    try { places = await call("files_places"); } catch (e) { places = []; }
    $("fxSide").innerHTML = `<div class="tlabel">Places</div>` + places.filter(p => p.kind !== "drive").map(p => btn(p)).join("") +
      (places.some(p => p.kind === "drive") ? `<div class="tlabel" style="margin-top:8px">Drives</div>` + places.filter(p => p.kind === "drive").map(p => btn(p)).join("") : "");
    const home = places.find(p => p.kind === "desktop") || places[0];
    if (home && !path) go(home.path, false);
  }
  const btn = p => `<button class="fx-place" type="button" data-path="${esc(p.path)}"><svg class="ic" viewBox="0 0 24 24">${PLACE[p.kind] || PLACE.drive}</svg><span>${esc(p.name)}</span></button>`;
  $("fxSide").addEventListener("click", e => { const b = e.target.closest(".fx-place"); if (b) go(b.dataset.path); });

  async function go(p, push = true) {
    let list;
    try { list = await call("files_list", { path: p }); } catch (err) { return W.os && window.Windmill && notifyErr(String(err.message || err)); }
    if (push && path && path !== p) back.push(path);
    path = p; entries = list; sel = -1; $("fxFilter").value = "";
    paintCrumbs(); paintList(); paintInfo();
    document.querySelectorAll(".fx-place").forEach(b => b.classList.toggle("on", b.dataset.path === p));
    $("fxList").scrollTop = 0;
  }
  function notifyErr(msg) { $("fxList").innerHTML = `<div class="fx-empty">${esc(msg)}</div>`; }
  function paintCrumbs() {
    const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
    let acc = "";
    $("fxCrumbs").innerHTML = parts.map((part, i) => {
      acc += (i === 0 ? part : "\\" + part); const target = i === 0 ? acc + "\\" : acc;
      return `<button type="button" data-path="${esc(target)}">${esc(i === 0 ? part.replace(":", ":") : part)}</button>`;
    }).join('<span class="fx-sep">›</span>');
    const c = $("fxCrumbs"); c.scrollLeft = c.scrollWidth;
  }
  $("fxCrumbs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) go(b.dataset.path); });
  $("fxBack").addEventListener("click", () => { const p = back.pop(); if (p) go(p, false); });
  $("fxUp").addEventListener("click", () => up());
  function up() { const p = path.replace(/[\\/]+$/, ""); const i = p.lastIndexOf("\\"); if (i > 2) go(p.slice(0, i)); else if (i === 2 && p.length > 3) go(p.slice(0, 3)); }

  function shown() { const q = $("fxFilter").value.trim().toLowerCase(); return entries.map((e, i) => [e, i]).filter(([e]) => !q || e.name.toLowerCase().includes(q)); }
  function paintList() {
    const rows = shown();
    if (!rows.length) { $("fxList").innerHTML = `<div class="fx-empty">${entries.length ? "Nothing matches." : "This folder is empty."}</div>`; return; }
    $("fxList").innerHTML = rows.map(([e, i]) => `<div class="fx-row${i === sel ? " on" : ""}" role="option" data-i="${i}" style="--d:${Math.min(i, 24) * 12}ms">
      <span class="fx-i" data-k="${esc(iconKey(e))}">${e.dir ? FOLDER : (iconCache.get(iconKey(e)) ? `<img class="fx-ico" src="${iconCache.get(iconKey(e))}" alt="">` : FILE(e.ext))}</span>
      <span class="fx-n">${esc(e.name)}</span>
      <span class="fx-s">${e.dir ? "" : fmtSize(e.size)}</span><span class="fx-d">${fmtDate(e.modified)}</span></div>`).join("");
    loadIcons();
  }
  // real icons, a few at a time, for the rows you can see
  let iconRun = 0;
  async function loadIcons() {
    const run = ++iconRun;
    const need = [...$("fxList").querySelectorAll(".fx-row")].slice(0, 120).map(r => entries[+r.dataset.i]).filter(e => !e.dir && !iconCache.has(iconKey(e)));
    const seen = new Set();
    for (const e of need) {
      if (run !== iconRun) return;
      const k = iconKey(e); if (seen.has(k)) continue; seen.add(k);
      try { iconCache.set(k, await call("files_icon", { path: e.path })); } catch (err) { iconCache.set(k, null); }
      const src = iconCache.get(k);
      if (src) $("fxList").querySelectorAll(`.fx-i[data-k="${CSS.escape(k)}"]`).forEach(s => { s.innerHTML = `<img class="fx-ico" src="${src}" alt="">`; });
    }
  }
  function paintInfo() {
    const e = entries[sel];
    if (!e) { $("fxInfo").innerHTML = `<div class="fx-big">${FOLDER}</div><b>${esc(path.split("\\").filter(Boolean).pop() || path)}</b><span>${entries.filter(x => x.dir).length} folders, ${entries.filter(x => !x.dir).length} files</span>`; return; }
    const ic = e.dir ? FOLDER : (iconCache.get(iconKey(e)) ? `<img class="fx-ico" src="${iconCache.get(iconKey(e))}" alt="">` : FILE(e.ext));
    $("fxInfo").innerHTML = `<div class="fx-big">${ic}</div><b>${esc(e.name)}</b><span>${e.dir ? "Folder" : `${KIND[e.ext] || "File"} · ${fmtSize(e.size)}`}</span><span>Changed ${fmtDate(e.modified)}</span>
      <div class="fx-acts"><button class="os-btn primary" type="button" id="fxOpen">${e.dir ? "Open folder" : "Open"}</button><button class="os-btn" type="button" id="fxReveal">Show in Explorer</button></div>`;
    $("fxOpen").addEventListener("click", () => open(e));
    $("fxReveal").addEventListener("click", () => call("files_reveal", { path: e.path }).catch(() => {}));
  }
  function open(e) { if (e.dir) go(e.path); else call("files_open", { path: e.path }).catch(err => notifyErr(String(err.message || err))); }
  function select(i) { sel = i; $("fxList").querySelectorAll(".fx-row").forEach(r => r.classList.toggle("on", +r.dataset.i === i)); paintInfo(); }

  $("fxList").addEventListener("click", e => { const r = e.target.closest(".fx-row"); if (r) select(+r.dataset.i); });
  $("fxList").addEventListener("dblclick", e => { const r = e.target.closest(".fx-row"); if (r) open(entries[+r.dataset.i]); });
  $("fxList").addEventListener("keydown", e => {
    const rows = shown().map(([, i]) => i); const at = rows.indexOf(sel);
    if (e.key === "ArrowDown") { e.preventDefault(); select(rows[Math.min(rows.length - 1, at + 1)] ?? rows[0]); }
    else if (e.key === "ArrowUp") { e.preventDefault(); select(rows[Math.max(0, at - 1)] ?? rows[0]); }
    else if (e.key === "Enter" && entries[sel]) open(entries[sel]);
    else if (e.key === "Backspace") { e.preventDefault(); up(); }
    const r = $("fxList").querySelector(`.fx-row[data-i="${sel}"]`); if (r) r.scrollIntoView({ block: "nearest" });
  });
  $("fxFilter").addEventListener("input", () => { sel = -1; paintList(); paintInfo(); });
  $("fxList").addEventListener("scroll", () => { clearTimeout(window.__fxIcons); window.__fxIcons = setTimeout(loadIcons, 120); }, { passive: true });

  // the Files button and Windmill Search open it; load the places the first time
  let loaded = false;
  new MutationObserver(() => { if (win.classList.contains("open") && !loaded) { loaded = true; loadPlaces(); } }).observe(win, { attributes: true, attributeFilter: ["class"] });
})();
