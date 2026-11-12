/* =====================================================================
   Windmill OS layer.
   Inside the desktop app (Tauri) every action here is real: your installed
   apps, your open windows, your volume, battery, power, screen time.
   On the preview website the same interface runs on clearly marked example data.
   ===================================================================== */
(() => {
  "use strict";
  const W = window.Windmill;
  if (!W) return;
  const T = window.__TAURI__;
  const isApp = !!(T && T.core && T.core.invoke);
  const call = (cmd, args) => (isApp ? T.core.invoke(cmd, args) : Promise.reject(new Error("preview")));
  const { $, NS, prefs } = W;
  const save = () => W.savePrefs();
  const reduce = W.reduce;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD = isMac ? "⌘" : "Ctrl";
  let platform = { windows: false, mobile: false, os: "web" };
  let homeReady = false;

  // ---------- icons used by this layer ----------
  const MARK = '<svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><g fill="currentColor">' +
    [0, 90, 180, 270].map(a => `<g transform="rotate(${a} 50 50)"><polygon points="50,52 29,9 64,1 60,47"/></g>`).join("") +
    '<circle cx="50" cy="50" r="10"/></g></svg>';
  const I = {
    gear: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.6"/><path d="M12 12l2.6-2.6"/><g class="softfill"><circle cx="12" cy="3.6" r=".95"/><circle cx="12" cy="20.4" r=".95"/><circle cx="3.6" cy="12" r=".95"/><circle cx="20.4" cy="12" r=".95"/></g></svg>',
    lock: '<svg class="ic" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.6"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/><circle class="softfill" cx="12" cy="15.5" r="1.4"/></svg>',
    restart: '<svg class="ic" viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.6 4.2v4.3h-4.3"/></svg>',
    power: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5v8"/><path d="M7.2 6.6a7.5 7.5 0 1 0 9.6 0"/></svg>',
    search: '<svg class="ic" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.6 15.6l4.4 4.4"/></svg>',
    left: '<svg class="ic" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><rect class="softfill" x="5" y="6.5" width="6.5" height="11" rx="1.2"/></svg>',
    right: '<svg class="ic" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><rect class="softfill" x="12.5" y="6.5" width="6.5" height="11" rx="1.2"/></svg>',
    full: '<svg class="ic" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><rect class="softfill" x="5" y="6.5" width="14" height="11" rx="1.2"/></svg>',
    min: '<svg class="ic" viewBox="0 0 24 24"><path d="M6 16h12"/></svg>',
    close: '<svg class="ic" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    split: '<svg class="ic" viewBox="0 0 24 24"><rect x="3.5" y="5" width="7.5" height="14" rx="2"/><rect x="13" y="5" width="7.5" height="14" rx="2"/></svg>',
    grid: '<svg viewBox="0 0 60 60"><rect width="60" height="60" rx="14" fill="rgba(255,255,255,.75)"/><g fill="#5b6070">' +
      [16, 30, 44].map(y => [16, 30, 44].map(x => `<circle cx="${x}" cy="${y}" r="4.2"/>`).join("")).join("") + "</g></svg>",
    wifi: '<svg class="ic" viewBox="0 0 24 24"><path d="M3.5 9.5a12 12 0 0 1 17 0"/><path d="M6.6 12.7a7.6 7.6 0 0 1 10.8 0"/><path d="M9.7 15.8a3.2 3.2 0 0 1 4.6 0"/><circle class="fill" cx="12" cy="18.6" r="1.2"/></svg>',
    bt: '<svg class="ic" viewBox="0 0 24 24"><path d="M7.5 8l9 8-4.5 4V4l4.5 4-9 8"/></svg>',
    moon: '<svg class="ic" viewBox="0 0 24 24"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/></svg>',
    bar: '<svg class="ic" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="3"/><path class="soft" d="M3.5 16h17"/></svg>',
    sun: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path class="soft" d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3"/></svg>',
    speaker: '<svg class="ic" viewBox="0 0 24 24"><path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15 9.6a3.4 3.4 0 0 1 0 4.8"/></svg>',
    image: '<svg class="ic" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="3"/><path class="soft" d="M3.5 16.5l5-5 4 4 2.5-2.5 5.5 5"/></svg>',
    keys: '<svg class="ic" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2.6"/><path class="soft" d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    bell: '<svg class="ic" viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path class="soft" d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>',
    battery: '<svg class="ic" viewBox="0 0 24 24"><rect x="2.5" y="7.5" width="17" height="9" rx="2.4"/><path d="M21.5 10.5v3"/><rect class="softfill bfill" x="4.2" y="9.2" width="10" height="5.6" rx="1.2"/></svg>',
  };

  // ======================= small helpers =======================
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  // SVG icons carry gradient and clip ids; give every copy its own so they never point at a hidden twin.
  let uid = 0;
  const uniq = svg => { const n = ++uid; return svg.replace(/id="([^"]+)"/g, `id="$1-${n}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${n})`).replace(/href="#([^"]+)"/g, `href="#$1-${n}"`); };
  const iconHTML = item => item && item.img ? `<img class="app-ico" src="${esc(item.img)}" alt="" draggable="false">` : uniq((item && item.svg) || I.grid);
  const fmtDur = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
  function popToggle(node, on) { node.classList.toggle("on", on); node.setAttribute("aria-hidden", String(!on)); }

  // ======================= returning people skip sign-in and setup =======================
  window.WindmillHooks = { returning: isApp && !!prefs.setupDone, tile: onTile };

  // ======================= sign in with GitHub (in the app) =======================
  const pill = $("signin");
  let ghReady = false;
  if (isApp) {
    call("platform").then(p => { platform = p; }).catch(() => {});
    call("github_ready").then(ok => {
      ghReady = !!ok;
      if (!ghReady && pill) { const l = pill.querySelector(".label"); if (l) l.textContent = "Continue"; }
    }).catch(() => {});
    window.addEventListener("windmill:signin", () => {
      if (!ghReady) return setTimeout(() => window.dispatchEvent(new CustomEvent("windmill:signin-success")), 900);
      deviceFlow(pill.parentElement, ok => window.dispatchEvent(new CustomEvent(ok ? "windmill:signin-success" : "windmill:signin-reset")));
    });
  }

  async function deviceFlow(host, done) {
    let card;
    try {
      const start = await call("github_device_start");
      card = el("div", "glass signin-card devcode");
      card.innerHTML = `<p>On GitHub, enter this code to sign in to Windmill.</p><div class="code">${esc(start.user_code)}</div>
        <div class="row"><button class="os-btn" type="button" data-a="copy">Copy code</button><button class="os-btn primary" type="button" data-a="open">Open GitHub</button></div>`;
      host.appendChild(card);
      card.addEventListener("click", e => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        if (a.dataset.a === "copy") navigator.clipboard.writeText(start.user_code).then(() => { a.textContent = "Copied"; }).catch(() => {});
        if (a.dataset.a === "open") call("plugin:opener|open_url", { url: start.verification_uri }).catch(() => window.open(start.verification_uri));
      });
      let wait = (start.interval || 5) * 1000;
      const until = Date.now() + (start.expires_in || 900) * 1000;
      while (Date.now() < until) {
        await sleep(wait);
        const r = await call("github_device_poll", { deviceCode: start.device_code });
        if (r.status === "done") { prefs.profile = r.profile; save(); card.remove(); paintAccount(); return done(true); }
        if (r.status === "slow_down") wait += 5000;
        if (r.status === "expired" || r.status === "denied") break;
      }
      card.remove();
      notify("Sign-in didn't finish", "Try again when you're ready.");
      done(false);
    } catch (e) {
      if (card) card.remove();
      notify("Couldn't reach GitHub", String(e.message || e));
      done(false);
    }
  }
  if (isApp) call("github_profile").then(p => { prefs.profile = p || null; save(); }).catch(() => {});

  // ======================= apps =======================
  const state = { apps: [], windows: [], loaded: false };
  const DEMO_WINDOWS = [
    { id: 1, app: "Browser", title: "Windmill: preview", exe: "browser.exe" },
    { id: 2, app: "Terminal", title: "npm run tauri dev", exe: "terminal.exe" },
    { id: 3, app: "Code", title: "windmill-os.js", exe: "code.exe" },
  ];
  function demoApps() {
    return [...W.dock.querySelectorAll(".tile[data-app]")]
      .filter(t => t.dataset.app !== "windmill")
      .map(t => ({ id: t.dataset.app, name: t.dataset.label, svg: t.querySelector(".rise").innerHTML }));
  }
  const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function windowsFor(app) {
    const n = norm(app.name), id = (app.id || "").toLowerCase();
    return state.windows.filter(w => {
      const base = (w.exe || "").toLowerCase().split(/[\\/]/).pop();
      const a = norm(w.app);
      return (base && id.endsWith(base)) || a === n || (n.length > 3 && a.includes(n)) || (a.length > 3 && n.includes(a));
    });
  }
  const appFor = w => state.apps.find(a => windowsFor(a).includes(w));
  const winIcon = w => (w.icon ? { img: w.icon } : (appFor(w) || null));

  async function loadApps() {
    if (isApp) platform = await call("platform").catch(() => platform);
    if (isApp && platform.windows) {
      try { state.apps = (await call("list_apps")).map(a => ({ id: a.id, name: a.name, img: a.icon })); }
      catch (e) { state.apps = []; notify("Couldn't read your apps", String(e.message || e)); }
    } else {
      state.apps = demoApps();
      state.windows = DEMO_WINDOWS.map(w => ({ ...w }));
    }
    state.loaded = true;
    if (!prefs.pins) prefs.pins = defaultPins();
    save();
    indexApps();
    renderDock();
    if (launcher.classList.contains("on")) renderLauncher();
  }
  function defaultPins() {
    if (!isApp) return state.apps.map(a => a.id);
    const want = [/^file explorer$/i, /edge|chrome|firefox|brave|opera|vivaldi/i, /^settings$/i, /terminal|command prompt|powershell/i,
      /visual studio code|notepad/i, /spotify|music|media player/i, /discord|teams|whatsapp|slack/i, /^photos$/i, /calculator/i];
    const picks = [];
    for (const re of want) { const a = state.apps.find(x => re.test(x.name) && !picks.includes(x.id)); if (a) picks.push(a.id); }
    return picks.length ? picks : state.apps.slice(0, 8).map(a => a.id);
  }
  const appById = id => state.apps.find(a => a.id === id);
  function remember(app) {
    if (!app) return;
    prefs.recent = [app.id, ...(prefs.recent || []).filter(x => x !== app.id)].slice(0, 12);
    save();
  }

  async function launch(app, tile) {
    remember(app);
    if (tile) { tile.classList.remove("bounce"); void tile.offsetWidth; tile.classList.add("bounce"); }
    if (!isApp) {
      if (!state.windows.some(w => windowsFor(app).includes(w)))
        state.windows.push({ id: Date.now(), app: app.name, title: app.name, exe: app.id });
      setTimeout(() => { tile && tile.classList.remove("bounce"); renderDock(); }, 1800);
      return;
    }
    try { await call("launch_app", { id: app.id }); }
    catch (e) { notify(`Couldn't open ${app.name}`, String(e.message || e)); }
    setTimeout(() => { tile && tile.classList.remove("bounce"); refreshWindows(); }, 1800);
  }
  async function focusWin(w) {
    const a = appFor(w); remember(a);
    if (!isApp) return notify(w.app, "In the app, this brings the window to the front.");
    try { await call("focus_window", { id: w.id }); } catch (e) { notify("That window is gone", String(e.message || e)); refreshWindows(); }
  }
  async function winAct(w, act, other) {
    if (!isApp) {
      if (act === "close") { state.windows = state.windows.filter(x => x !== w); renderDock(); paintPanel(); }
      return notify(w.app, ({ left: "Snapped to the left half.", right: "Snapped to the right half.", full: "Filled the screen.", min: "Minimized.", close: "Closed.", side: `Side by side with ${other && other.app}.` })[act] + " (preview)");
    }
    try {
      if (act === "close") await call("close_window", { id: w.id });
      else if (act === "min") await call("minimize_window", { id: w.id });
      else if (act === "side") await call("side_by_side", { left: w.id, right: other.id });
      else await call("snap_window", { id: w.id, side: act });
    } catch (e) { notify("Couldn't do that", String(e.message || e)); }
    setTimeout(refreshWindows, 400);
  }

  let sig = "";
  async function refreshWindows() {
    if (!isApp) return;
    try { state.windows = await call("list_windows"); } catch (e) { return; }
    const nsig = state.windows.map(w => w.id + w.title).join("|");
    if (nsig !== sig) { sig = nsig; renderDock(); indexWindows(); if (panel.classList.contains("on")) paintPanel(); }
  }

  // ======================= the dock =======================
  const dock = W.dock;
  const windmillTile = dock.querySelector('[data-app="windmill"]');
  let dockSig = "";
  function tileFor(kind, id, label, iconItem, extra = "") {
    const t = el("button", `tile ${extra}`);
    t.type = "button"; t.dataset.kind = kind; t.dataset.id = id; t.dataset.label = label; t.dataset.app = kind === "app" ? id : "";
    t.innerHTML = `<span class="rise">${iconHTML(iconItem)}</span>`;
    W.pressable(t); W.wireTip(t);
    t.addEventListener("pointerenter", () => scheduleCard(t));
    t.addEventListener("pointerleave", () => scheduleCard(null));
    return t;
  }
  function renderDock() {
    if (!state.loaded) return;
    const pins = (prefs.pins || []).map(appById).filter(Boolean);
    const claimed = new Set();
    pins.forEach(a => windowsFor(a).forEach(w => claimed.add(w)));
    const loose = [];
    state.windows.forEach(w => {
      if (claimed.has(w)) return;
      const key = norm(w.app);
      if (!loose.some(x => norm(x.app) === key)) loose.push(w);
    });
    const nsig = pins.map(a => a.id + ":" + windowsFor(a).length).join(",") + "|" + loose.map(w => w.id).join(",");
    if (nsig === dockSig) return;
    dockSig = nsig;
    [...dock.children].forEach(c => { if (c !== windmillTile && !c.classList.contains("sep")) c.remove(); });
    dock.querySelectorAll(".sep").forEach((s, i) => { if (i > 0) s.remove(); });
    let i = 1;
    const add = t => { t.style.setProperty("--i", i++); dock.appendChild(t); };
    pins.forEach(a => add(tileFor("app", a.id, a.name, a, windowsFor(a).length ? "running" : "")));
    loose.forEach(w => add(tileFor("win", String(w.id), w.app, winIcon(w), "running")));
    const sep = el("span", "sep"); sep.setAttribute("aria-hidden", "true"); dock.appendChild(sep);
    add(tileFor("all", "all", "All apps", { svg: I.grid }));
    if (dock.classList.contains("open")) requestAnimationFrame(() => W.lens(dock));
  }
  const cycle = {};
  function onTile(t) {
    const kind = t.dataset.kind;
    if (!kind) return false;                          // Windmill's own tile: Settings
    hideCard();
    if (kind === "all") { openLauncher(); return true; }
    if (kind === "win") { const w = state.windows.find(x => String(x.id) === t.dataset.id); if (w) focusWin(w); return true; }
    const app = appById(t.dataset.id);
    if (!app) return true;
    const ws = windowsFor(app);
    if (!ws.length) { launch(app, t); return true; }
    cycle[app.id] = ((cycle[app.id] ?? -1) + 1) % ws.length;   // click again to go through its windows
    focusWin(ws[cycle[app.id]]);
    return true;
  }

  // ---------- multitasking: hover an app in the dock ----------
  const mcard = el("div", "glass mcard os-pop");
  mcard.setAttribute("role", "menu");
  document.body.appendChild(mcard);
  let cardT = 0, cardFor = null;
  function windowsOfTile(t) {
    if (t.dataset.kind === "win") return state.windows.filter(w => String(w.id) === t.dataset.id);
    if (t.dataset.kind === "app") { const a = appById(t.dataset.id); return a ? windowsFor(a) : []; }
    return [];
  }
  function scheduleCard(t) {
    clearTimeout(cardT);
    if (!t) { cardT = setTimeout(() => { if (!mcard.matches(":hover")) hideCard(); }, 260); return; }
    cardT = setTimeout(() => showCard(t), 480);
  }
  function wrowHTML(w, withIcon = true) {
    return `<div class="wrow" data-w="${esc(w.id)}">${withIcon ? `<span class="wi-ico">${iconHTML(winIcon(w))}</span>` : ""}
      <span class="wt" data-a="focus"><b>${esc(w.app)}</b><span>${esc(w.title)}</span></span>
      <span class="acts">
        <button class="os-icon" type="button" data-a="left" aria-label="Left half" data-label="Left half">${I.left}</button>
        <button class="os-icon" type="button" data-a="right" aria-label="Right half" data-label="Right half">${I.right}</button>
        <button class="os-icon" type="button" data-a="full" aria-label="Full screen" data-label="Full screen">${I.full}</button>
        <button class="os-icon" type="button" data-a="min" aria-label="Minimize" data-label="Minimize">${I.min}</button>
        <button class="os-icon" type="button" data-a="close" aria-label="Close window" data-label="Close">${I.close}</button>
      </span></div>`;
  }
  function showCard(t) {
    const ws = windowsOfTile(t);
    if (!ws.length || !dock.classList.contains("open")) return;
    cardFor = t;
    const others = state.windows.filter(w => !ws.includes(w)).slice(0, 5);
    mcard.innerHTML = `<div class="mh">${esc(t.dataset.label)}</div>` + ws.map(w => wrowHTML(w, false)).join("") +
      (others.length ? `<div class="mside"><div class="mh">Side by side with</div>${others.map(o =>
        `<button type="button" data-side="${esc(o.id)}">${I.split}<span>${esc(o.app)}</span></button>`).join("")}</div>` : "");
    const r = t.getBoundingClientRect();
    mcard.style.left = `${Math.max(12, Math.min(innerWidth - 312, r.left + r.width / 2 - 150))}px`;
    mcard.style.top = "0px";
    popToggle(mcard, true);
    mcard.style.top = `${r.top - mcard.offsetHeight - 14}px`;
    W.hideTip();
    requestAnimationFrame(() => W.lens(mcard));
  }
  function hideCard() { clearTimeout(cardT); cardFor = null; popToggle(mcard, false); }
  mcard.addEventListener("pointerleave", () => scheduleCard(null));
  mcard.addEventListener("pointerenter", () => clearTimeout(cardT));
  mcard.addEventListener("click", e => {
    e.stopPropagation();
    const side = e.target.closest("[data-side]");
    const tileWins = cardFor ? windowsOfTile(cardFor) : [];
    if (side && tileWins[0]) { const o = state.windows.find(w => String(w.id) === side.dataset.side); if (o) winAct(tileWins[0], "side", o); return hideCard(); }
    const row = e.target.closest(".wrow"); const a = e.target.closest("[data-a]");
    if (!row || !a) return;
    const w = state.windows.find(x => String(x.id) === row.dataset.w); if (!w) return;
    a.dataset.a === "focus" ? focusWin(w) : winAct(w, a.dataset.a);
    hideCard();
  });

  // ======================= all apps =======================
  const launcher = el("div", "launcher");
  launcher.setAttribute("role", "dialog"); launcher.setAttribute("aria-label", "All apps"); launcher.setAttribute("aria-hidden", "true");
  launcher.innerHTML = `<label class="glass lsearch">${I.search}<input id="lq" type="text" placeholder="Search your apps" autocomplete="off" spellcheck="false"></label><div class="lgrid" id="lgrid"></div>`;
  document.body.appendChild(launcher);
  const lq = launcher.querySelector("#lq"), lgrid = launcher.querySelector("#lgrid");
  function renderLauncher() {
    const term = lq.value.trim().toLowerCase();
    const list = state.apps.filter(a => !term || a.name.toLowerCase().includes(term));
    lgrid.innerHTML = "";
    if (!state.loaded) { lgrid.innerHTML = '<div class="lempty">Finding your apps…</div>'; return; }
    if (!list.length) { lgrid.innerHTML = `<div class="lempty">No apps called “${esc(lq.value.trim())}”.</div>`; return; }
    list.forEach((a, i) => {
      const b = el("button", "lapp" + ((prefs.pins || []).includes(a.id) ? " pinned" : ""));
      b.type = "button"; b.dataset.id = a.id;
      b.innerHTML = `<span class="li">${iconHTML(a)}</span><span>${esc(a.name)}</span>`;
      if (!reduce && i < 40) b.animate([{ opacity: 0, transform: "translateY(10px) scale(.92)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: i * 12, easing: "cubic-bezier(.2,.9,.25,1.1)", fill: "backwards" });
      lgrid.appendChild(b);
    });
    if (!isApp) lgrid.appendChild(el("div", "lnote", "Example apps. In the Windows app, this shows everything installed on your PC. Right-click an app to pin it to the dock."));
  }
  function openLauncher() {
    W.closeDock(); closeAll("launcher");
    lq.value = ""; renderLauncher();
    launcher.classList.add("on"); launcher.setAttribute("aria-hidden", "false");
    setTimeout(() => lq.focus({ preventScroll: true }), 40);
  }
  function closeLauncher() { launcher.classList.remove("on"); launcher.setAttribute("aria-hidden", "true"); }
  lq.addEventListener("input", renderLauncher);
  lq.addEventListener("keydown", e => { if (e.key === "Enter") { const first = lgrid.querySelector(".lapp"); if (first) first.click(); } });
  launcher.addEventListener("click", e => {
    const b = e.target.closest(".lapp");
    if (b) { const a = appById(b.dataset.id); closeLauncher(); if (a) { const ws = windowsFor(a); ws.length ? focusWin(ws[0]) : launch(a); } return; }
    if (!e.target.closest(".lsearch")) closeLauncher();
  });
  launcher.addEventListener("contextmenu", e => {
    const b = e.target.closest(".lapp"); if (!b) return;
    e.preventDefault();
    const a = appById(b.dataset.id); if (!a) return;
    const pinned = (prefs.pins || []).includes(a.id);
    menu(e.clientX, e.clientY, [
      { label: "Open", icon: I.full, run: () => { closeLauncher(); launch(a); } },
      { label: pinned ? "Remove from dock" : "Keep in dock", icon: I.bar, run: () => togglePin(a) },
    ]);
  });
  function togglePin(a) {
    const pins = prefs.pins || [];
    prefs.pins = pins.includes(a.id) ? pins.filter(x => x !== a.id) : [...pins, a.id];
    save(); dockSig = ""; renderDock(); if (launcher.classList.contains("on")) renderLauncher();
  }

  // ======================= Windmill Search: real apps and windows =======================
  function replaceGroup(group, entries) {
    for (let i = W.INDEX.length - 1; i >= 0; i--) if (W.INDEX[i].group === group) W.INDEX.splice(i, 1);
    W.INDEX.unshift(...entries);
  }
  function indexApps() {
    replaceGroup("Apps", state.apps.map(a => ({
      group: "Apps", label: a.name, hint: "App", icon: iconHTML(a),
      suggest: (prefs.recent || []).slice(0, 3).includes(a.id),
      run: () => { const ws = windowsFor(a); ws.length ? focusWin(ws[0]) : launch(a); },
    })));
  }
  function indexWindows() {
    replaceGroup("Open windows", state.windows.map(w => ({
      group: "Open windows", label: w.title, hint: w.app, icon: iconHTML(winIcon(w)), keys: w.app, run: () => focusWin(w),
    })));
  }
  W.INDEX.push(
    { group: "Windmill", label: "All apps", hint: "Open", icon: I.grid, keys: "launcher apps", run: () => openLauncher() },
    { group: "Windmill", label: "Windmill panel", hint: "Ctrl + Win", icon: MARK, keys: "start menu panel", suggest: true, run: () => openPanel() },
    { group: "Windmill", label: "Control center", hint: "Volume, Wi-Fi", icon: I.speaker, keys: "volume brightness wifi bluetooth", run: () => openCC() },
    { group: "Windmill", label: "Lock Windmill", hint: `${MOD} Shift L`, icon: I.lock, keys: "lock screen", run: () => lock() },
    { group: "Windmill", label: "Keyboard shortcuts", hint: `${MOD} /`, icon: I.keys, keys: "keys help", run: () => openKeys() },
    { group: "Windmill", label: "Restart Windmill", hint: "Power", icon: I.restart, keys: "reload", run: () => restartWindmill() },
    { group: "Windmill", label: "Shut down Windmill", hint: "Power", icon: I.power, keys: "quit exit close off", run: () => shutdownWindmill() },
    { group: "Settings", label: "Add a wallpaper", hint: "Image or video", icon: I.image, keys: "background custom live", run: () => addWallpaper() },
    { group: "Settings", label: "Live wallpaper: Drift", keys: "background animated", icon: '<span class="wprev wp-live-drift"></span>', run: () => W.setWall("live-drift") },
    { group: "Settings", label: "Live wallpaper: Waves", keys: "background animated", icon: '<span class="wprev wp-live-waves"></span>', run: () => W.setWall("live-waves") },
    { group: "Settings", label: "Live wallpaper: Aurora", keys: "background animated", icon: '<span class="wprev wp-live-aurora"></span>', run: () => W.setWall("live-aurora") },
  );

  // ======================= Windmill panel (Ctrl + Win) =======================
  const capL = $("capL");
  const panelBtn = el("button", "item icon", MARK);
  panelBtn.type = "button"; panelBtn.id = "panelBtn"; panelBtn.style.setProperty("--i", 0);
  panelBtn.dataset.label = isApp ? "Windmill  Ctrl + Win" : "Windmill";
  capL.insertBefore(panelBtn, capL.querySelector(".item"));
  W.pressable(panelBtn); W.wireTip(panelBtn);
  panelBtn.addEventListener("pointerenter", () => {
    const bub = capL.querySelector(".bubble");
    bub.style.translate = `${panelBtn.offsetLeft}px 0`; bub.style.width = `${panelBtn.offsetWidth}px`; capL.classList.add("hot");
  });
  panelBtn.addEventListener("click", e => { e.stopPropagation(); togglePanel(); });

  const panel = el("div", "glass wpanel os-pop");
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Windmill"); panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <header class="ph">${MARK}<b>Windmill</b><span class="who" id="pWho"></span>${isApp ? "" : '<span class="os-tag">Example data</span>'}<span class="sp"></span>
      <button class="os-icon" type="button" data-a="settings" aria-label="Settings" data-label="Settings">${I.gear}</button>
      <button class="os-icon" type="button" data-a="lock" aria-label="Lock Windmill" data-label="Lock">${I.lock}</button></header>
    <div class="pstats">
      <div class="os-card pstat"><div class="k">Open <i id="pLive">Live</i></div><div class="v"><span id="pOpen">0</span><small id="pOpenSub">windows</small></div></div>
      <div class="os-card pstat"><div class="k">Memory</div><div class="v"><span id="pMem">–</span><small id="pMemSub"></small></div><div class="spark" id="pCpu"></div></div>
      <div class="os-card pstat"><div class="k" id="pBatK">Battery</div><div class="v"><span id="pBat">–</span><small id="pBatSub"></small></div><div class="meter"><i id="pBatBar"></i></div></div>
    </div>
    <section class="os-card psec"><h4 class="os-h">Recent</h4><div class="precent" id="pRecent"></div></section>
    <section class="os-card psec"><h4 class="os-h">Open now <em id="pOpenN"></em></h4><div class="popen" id="pWins"></div></section>
    <section class="os-card psec"><div class="pst-h"><h4 class="os-h">Last 24 hours</h4><em id="pSt"></em></div><div class="bars" id="pBars"></div>
      <div class="axis"><span id="pAxis0"></span><span>Now</span></div><div class="ptop" id="pTop"></div></section>
    <section class="os-card pnotes" id="pNotes" hidden></section>
    <button class="os-card psearch" type="button" data-a="search">${I.search}<span>Search apps, windows and settings</span><kbd>${MOD} K</kbd></button>
    <footer class="ppower">
      <button class="os-btn" type="button" data-a="lock">${I.lock}Lock</button>
      <button class="os-btn" type="button" data-a="restart">${I.restart}Restart</button>
      <button class="os-btn danger" type="button" data-a="shutdown">${I.power}Shut down</button>
    </footer>`;
  document.body.appendChild(panel);
  panel.querySelectorAll("[data-label]").forEach(W.wireTip);
  panel.addEventListener("click", e => {
    e.stopPropagation();
    const a = e.target.closest("[data-a]");
    const row = e.target.closest(".wrow");
    if (row && a) {
      const w = state.windows.find(x => String(x.id) === row.dataset.w); if (!w) return;
      if (a.dataset.a === "focus") { closePanel(); focusWin(w); } else winAct(w, a.dataset.a);
      return;
    }
    const r = e.target.closest(".rapp");
    if (r) { const app = appById(r.dataset.id); closePanel(); if (app) { const ws = windowsFor(app); ws.length ? focusWin(ws[0]) : launch(app); } return; }
    if (!a) return;
    const act = a.dataset.a;
    if (act === "settings") { closePanel(); W.openWin("settings", a); }
    if (act === "lock") { closePanel(); lock(); }
    if (act === "restart") { closePanel(); restartWindmill(); }
    if (act === "shutdown") { closePanel(); shutdownWindmill(); }
    if (act === "search") { closePanel(); W.openSearch(); }
  });
  let panelTimer = 0, cpuHist = [];
  function openPanel() {
    if (!homeReady) return;
    closeAll("panel");
    paintPanel(); paintScreenTime();
    popToggle(panel, true);
    requestAnimationFrame(() => W.lens(panel));
    clearInterval(panelTimer);
    panelTimer = setInterval(() => { refreshWindows(); paintStats(); }, 2000);
  }
  function closePanel() { popToggle(panel, false); clearInterval(panelTimer); }
  function togglePanel() { panel.classList.contains("on") ? closePanel() : openPanel(); }
  function paintPanel() {
    const who = $("pWho");
    who.innerHTML = prefs.profile ? `${prefs.profile.avatar ? `<img src="${esc(prefs.profile.avatar)}" alt="">` : ""}${esc(prefs.profile.name || prefs.profile.login)}` : "";
    const rec = (prefs.recent || []).map(appById).filter(Boolean).slice(0, 8);
    const show = rec.length ? rec : state.apps.slice(0, 6);
    $("pRecent").innerHTML = show.length ? show.map(a => `<button class="rapp" type="button" data-id="${esc(a.id)}"><span class="ri">${iconHTML(a)}</span><span>${esc(a.name)}</span></button>`).join("")
      : '<div class="pempty">Apps you open show up here.</div>';
    $("pOpenN").textContent = state.windows.length || "";
    $("pWins").innerHTML = state.windows.length ? state.windows.slice(0, 7).map(w => wrowHTML(w)).join("")
      : '<div class="pempty">Nothing open. Your apps are one click away in the dock.</div>';
    $("pWins").querySelectorAll("[data-label]").forEach(W.wireTip);
    $("pOpen").textContent = state.windows.length;
    $("pOpenSub").textContent = state.windows.length === 1 ? "window" : "windows";
    const notes = $("pNotes");
    notes.hidden = !history_.length;
    notes.innerHTML = `<h4 class="os-h">Notifications</h4>` + history_.slice(0, 4).map(n => `<div class="pnote"><b>${esc(n.title)}</b>${esc(n.body || "")}</div>`).join("");
    paintStats();
  }
  async function paintStats() {
    let mem = 58, used = 9.3, total = 16, cpu = 18 + Math.random() * 14, bat = null;
    if (isApp) {
      try { const s = await call("system_stats"); mem = s.memory; used = s.memory_used_gb; total = s.memory_total_gb; cpu = s.cpu; } catch (e) {}
      try { bat = await call("battery"); } catch (e) {}
    } else if (navigator.getBattery) {
      try { const b = await navigator.getBattery(); bat = { present: true, percent: Math.round(b.level * 100), charging: b.charging }; } catch (e) {}
    }
    $("pMem").textContent = `${Math.round(mem)}%`;
    $("pMemSub").textContent = `${used.toFixed(1)} of ${Math.round(total)} GB`;
    cpuHist = [...cpuHist, cpu].slice(-16);
    $("pCpu").innerHTML = cpuHist.map(v => `<i style="height:${Math.max(8, v)}%"></i>`).join("");
    $("pCpu").title = `Processor ${Math.round(cpu)}%`;
    if (bat && bat.present && bat.percent != null) {
      $("pBatK").textContent = "Battery";
      $("pBat").textContent = `${bat.percent}%`;
      $("pBatSub").textContent = bat.charging ? "Charging" : bat.minutes_left ? fmtDur(bat.minutes_left * 60) + " left" : "";
      $("pBatBar").style.width = `${bat.percent}%`;
    } else {
      $("pBatK").textContent = "Processor";
      $("pBat").textContent = `${Math.round(cpu)}%`;
      $("pBatSub").textContent = "busy";
      $("pBatBar").style.width = `${Math.round(cpu)}%`;
    }
  }
  async function paintScreenTime() {
    let st;
    if (isApp) { try { st = await call("screen_time"); } catch (e) {} }
    if (!st) {
      const hours = Array.from({ length: 24 }, (_, i) => (i < 6 || (i > 14 && i < 18) ? 0 : Math.round(900 + 2600 * Math.abs(Math.sin(i * 1.7)))));
      st = { hours, first_hour: Math.floor(Date.now() / 3.6e6) - 23, total_seconds: hours.reduce((a, b) => a + b, 0),
        top: [{ app: "Browser", seconds: 9000 }, { app: "Code", seconds: 7200 }, { app: "Terminal", seconds: 3100 }] };
    }
    const max = Math.max(1, ...st.hours);
    $("pBars").innerHTML = st.hours.map((s, i) => `<i class="${i >= 22 && s ? "hot" : ""}" style="height:${Math.round((s / max) * 100)}%" title="${fmtDur(s)}"></i>`).join("");
    $("pSt").textContent = st.total_seconds ? fmtDur(st.total_seconds) : "Nothing yet";
    const h0 = new Date(st.first_hour * 3.6e6);
    $("pAxis0").textContent = h0.toLocaleTimeString(undefined, { hour: "numeric" });
    $("pTop").innerHTML = st.top.slice(0, 4).map(t => `<span><b>${esc(t.app)}</b> ${fmtDur(t.seconds)}</span>`).join("");
  }
  if (isApp && T.event) T.event.listen("windmill://panel", () => { if (homeReady) togglePanel(); });

  // ======================= control center =======================
  const cc = el("div", "glass cc os-pop");
  cc.setAttribute("role", "dialog"); cc.setAttribute("aria-label", "Control center"); cc.setAttribute("aria-hidden", "true");
  cc.innerHTML = `
    <div class="cct-grid">
      <button class="cct" type="button" data-a="wifi"><span class="ci">${I.wifi}</span><span>Wi-Fi<small id="ccWifi">Checking…</small></span></button>
      <button class="cct" type="button" data-a="bt"><span class="ci">${I.bt}</span><span>Bluetooth<small>Open settings</small></span></button>
      <button class="cct" type="button" data-a="dnd"><span class="ci">${I.moon}</span><span>Do Not Disturb<small id="ccDnd">Off</small></span></button>
      <button class="cct" type="button" data-a="dark"><span class="ci">${I.sun}</span><span>Dark mode<small id="ccDark">Off</small></span></button>
    </div>
    <label class="slide" id="ccVolS"><input id="ccVol" type="range" min="0" max="100" step="1" aria-label="Volume"><span class="si">${I.speaker}</span><span class="sv" id="ccVolV"></span></label>
    <label class="slide" id="ccBriS"><input id="ccBri" type="range" min="0" max="100" step="1" aria-label="Brightness"><span class="si">${I.sun}</span><span class="sv" id="ccBriV"></span></label>
    <div class="ccfoot"><span id="ccBat"></span><span id="ccDate"></span></div>`;
  document.body.appendChild(cc);
  const ccVol = cc.querySelector("#ccVol"), ccBri = cc.querySelector("#ccBri");
  const paintSlide = (inp, label) => { inp.style.setProperty("--p", inp.value + "%"); label.textContent = inp.value + "%"; };
  let volT = 0, briT = 0;
  ccVol.addEventListener("input", () => {
    paintSlide(ccVol, $("ccVolV")); W.setVolumeUI(+ccVol.value, +ccVol.value === 0);
    clearTimeout(volT); volT = setTimeout(() => call("set_volume", { level: ccVol.value / 100 }).catch(() => {}), 40);
  });
  ccBri.addEventListener("input", () => {
    paintSlide(ccBri, $("ccBriV"));
    clearTimeout(briT); briT = setTimeout(() => call("set_brightness", { level: +ccBri.value }).catch(() => {}), 150);
  });
  cc.addEventListener("click", e => {
    e.stopPropagation();
    const a = e.target.closest("[data-a]"); if (!a) return;
    if (a.dataset.a === "wifi") openSystem("network-wifi");
    if (a.dataset.a === "bt") openSystem("bluetooth");
    if (a.dataset.a === "dnd") { prefs.dnd = !prefs.dnd; save(); paintCC(); }
    if (a.dataset.a === "dark") { prefs.theme = prefs.theme === "dark" ? "light" : "dark"; save(); W.setTheme(prefs.theme); paintCC(); setTimeout(W.lensAll, 50); }
  });
  function openSystem(page) {
    if (!isApp) return notify("Windows Settings", "In the app, this opens the right page of Windows Settings.");
    call("open_system_settings", { page }).catch(e => notify("Couldn't open Settings", String(e.message || e)));
  }
  async function paintCC() {
    cc.querySelector('[data-a="dnd"]').classList.toggle("on", !!prefs.dnd); $("ccDnd").textContent = prefs.dnd ? "On" : "Off";
    cc.querySelector('[data-a="dark"]').classList.toggle("on", prefs.theme === "dark"); $("ccDark").textContent = prefs.theme === "dark" ? "On" : "Off";
    $("ccDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    let v = W.volume.level, muted = W.volume.muted;
    if (isApp) { try { const r = await call("get_volume"); v = Math.round(r.level * 100); muted = r.muted; W.setVolumeUI(v, muted); } catch (e) {} }
    ccVol.value = muted ? 0 : v; paintSlide(ccVol, $("ccVolV"));
    const wifiCard = cc.querySelector('[data-a="wifi"]');
    if (isApp) {
      call("wifi_status").then(w => { $("ccWifi").textContent = w.connected ? `${w.name}${w.signal ? ` · ${w.signal}%` : ""}` : "Not connected"; wifiCard.classList.toggle("on", !!w.connected); })
        .catch(() => { $("ccWifi").textContent = "Open settings"; });
      call("get_brightness").then(b => { ccBri.value = b; paintSlide(ccBri, $("ccBriV")); $("ccBriS").classList.remove("off"); })
        .catch(() => { $("ccBriS").classList.add("off"); $("ccBriV").textContent = "Not on this screen"; });
      call("battery").then(b => { $("ccBat").textContent = b.present && b.percent != null ? `Battery ${b.percent}%${b.charging ? ", charging" : ""}` : "Plugged in"; }).catch(() => {});
    } else {
      $("ccWifi").textContent = navigator.onLine ? "Connected" : "Offline"; wifiCard.classList.toggle("on", navigator.onLine);
      ccBri.value = 70; paintSlide(ccBri, $("ccBriV"));
      $("ccBat").textContent = "Example values";
    }
  }
  function openCC() { closeAll("cc"); paintCC(); popToggle(cc, true); requestAnimationFrame(() => W.lens(cc)); }
  function closeCC() { popToggle(cc, false); }
  ["volBtn", "timeBtn"].forEach(id => $(id).addEventListener("click", e => { e.stopPropagation(); cc.classList.contains("on") ? closeCC() : openCC(); }));
  $("volBtn").dataset.label = "Sound and controls"; $("timeBtn").dataset.label = "Control center";

  // ======================= notifications =======================
  const toasts = el("div", "toasts"); toasts.setAttribute("aria-live", "polite"); document.body.appendChild(toasts);
  const history_ = [];
  function notify(title, body = "", icon = I.bell) {
    history_.unshift({ title, body, at: Date.now() }); history_.length = Math.min(history_.length, 20);
    if (prefs.dnd) return;
    const t = el("div", "glass toast", `<span class="ti">${icon}</span><span><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}</span>`);
    toasts.prepend(t);
    const kill = () => { t.classList.add("out"); setTimeout(() => t.remove(), 300); };
    t.addEventListener("click", kill);
    setTimeout(kill, 4800);
    while (toasts.children.length > 3) toasts.lastElementChild.remove();
  }
  let warnedLow = false, wasCharging = null;
  async function watchBattery() {
    if (!isApp) return;
    try {
      const b = await call("battery");
      if (!b.present || b.percent == null) return;
      if (wasCharging !== null && b.charging !== wasCharging) notify(b.charging ? "Charging" : "On battery", `${b.percent}%`, I.battery);
      wasCharging = b.charging;
      if (b.percent <= 20 && !b.charging && !warnedLow) { warnedLow = true; notify("Battery is low", `${b.percent}% left. Plug in soon.`, I.battery); }
      if (b.charging) warnedLow = false;
    } catch (e) {}
  }

  // ======================= lock screen =======================
  const lockEl = el("div", "lock");
  lockEl.setAttribute("role", "dialog"); lockEl.setAttribute("aria-label", "Windmill is locked");
  lockEl.innerHTML = `<div style="color:#fff">${MARK.replace('class="mark"', 'class="lmark"')}</div><div class="ltime" id="lTime"></div><div class="ldate" id="lDate"></div>
    <div class="pin" id="lPin" hidden><div class="pdots" id="lDots"><i></i><i></i><i></i><i></i></div>
    <div class="pkeys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join("")}<button type="button" class="ghost" data-k="c">Clear</button><button type="button" data-k="0">0</button><button type="button" class="ghost" data-k="b">Delete</button></div></div>
    <div class="lhint" id="lHint">Click or press any key</div>`;
  document.body.appendChild(lockEl);
  let locked = false, pinBuf = "", lockClock = 0;
  async function sha(s) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("windmill:" + s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  function paintLock() {
    const now = new Date();
    $("lTime").textContent = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: prefs.hour12 ?? undefined }).replace(/\s?[AP]M$/i, "");
    $("lDate").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }
  function lock() {
    if (locked || !homeReady) return;
    closeAll(); W.closeDock(); W.closeSearch(); if (W.openWindow) W.closeWin();
    locked = true; pinBuf = ""; paintDots();
    paintLock(); clearInterval(lockClock); lockClock = setInterval(paintLock, 5000);
    $("lPin").hidden = true; $("lHint").textContent = prefs.pinHash ? "Click or press any key, then enter your PIN" : "Click or press any key";
    lockEl.classList.remove("leaving"); lockEl.classList.add("on");
  }
  function unlock() {
    locked = false; clearInterval(lockClock);
    lockEl.classList.add("leaving");
    setTimeout(() => { lockEl.classList.remove("on", "leaving"); }, 600);
  }
  function wake() {
    if (!prefs.pinHash) return unlock();
    $("lPin").hidden = false; $("lHint").textContent = "Enter your PIN";
  }
  function paintDots() { $("lDots").querySelectorAll("i").forEach((d, i) => d.classList.toggle("f", i < pinBuf.length)); }
  async function pinKey(k) {
    if (k === "c") pinBuf = ""; else if (k === "b") pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 4) pinBuf += k;
    paintDots();
    if (pinBuf.length === 4) {
      const ok = (await sha(pinBuf)) === prefs.pinHash;
      if (ok) { unlock(); return; }
      const d = $("lDots"); d.classList.remove("shake"); void d.offsetWidth; d.classList.add("shake");
      setTimeout(() => { pinBuf = ""; paintDots(); }, 380);
    }
  }
  lockEl.addEventListener("click", e => {
    const k = e.target.closest("[data-k]");
    if (k) return pinKey(k.dataset.k);
    if ($("lPin").hidden) wake();
  });
  // idle auto-lock: only counts while Windmill itself is in front
  let idleAt = Date.now();
  ["pointermove", "pointerdown", "keydown", "wheel"].forEach(t => addEventListener(t, () => { idleAt = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => {
    if (locked || !prefs.autoLock || !homeReady || !document.hasFocus()) { idleAt = document.hasFocus() ? idleAt : Date.now(); return; }
    if (Date.now() - idleAt > prefs.autoLock * 60000) lock();
  }, 15000);

  // ======================= power: restart and shut down Windmill =======================
  const fx = el("div", "powerfx", `${MARK}<p id="fxText"></p><small id="fxSub"></small>`);
  document.body.appendChild(fx);
  function spinMark(duration) {
    const m = fx.querySelector("svg");
    if (reduce) return;
    m.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(-1080deg)" }], { duration, easing: "cubic-bezier(.15,.6,.25,1)", fill: "forwards" });
  }
  async function shutdownWindmill() {
    closeAll(); fx.classList.add("on");
    $("fxText").textContent = "Closing your apps…"; $("fxSub").textContent = "Each app gets a chance to save first.";
    spinMark(3200);
    if (isApp) { try { await call("close_all_windows"); } catch (e) {} }
    await sleep(1800);
    $("fxText").textContent = "See you soon."; $("fxSub").textContent = "";
    await sleep(1300);
    if (isApp) return call("quit_windmill");
    $("fxText").textContent = "Windmill is off."; $("fxSub").innerHTML = '<button class="os-btn primary" type="button" id="fxOn">Start Windmill</button>';
    $("fxOn").addEventListener("click", () => location.reload());
  }
  async function restartWindmill() {
    closeAll(); fx.classList.add("on");
    $("fxText").textContent = "Restarting Windmill…"; $("fxSub").textContent = "Your apps stay open.";
    spinMark(1800);
    await sleep(1600);
    if (isApp) return call("restart_windmill");
    location.reload();
  }

  // ======================= right-click menu =======================
  const ctx = el("div", "glass ctx os-pop"); ctx.setAttribute("role", "menu"); document.body.appendChild(ctx);
  function menu(x, y, items) {
    ctx.innerHTML = items.map((it, i) => it.sep ? "<hr>" : `<button type="button" role="menuitem" data-i="${i}">${it.icon || ""}<span>${esc(it.label)}</span>${it.key ? `<span class="os-kbd">${esc(it.key)}</span>` : ""}</button>`).join("");
    ctx._items = items;
    popToggle(ctx, true);
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = `${Math.min(x, innerWidth - w - 8)}px`; ctx.style.top = `${Math.min(y, innerHeight - h - 8)}px`;
    const first = ctx.querySelector("button"); if (first) first.focus({ preventScroll: true });
  }
  ctx.addEventListener("click", e => {
    e.stopPropagation();
    const b = e.target.closest("[data-i]"); if (!b) return;
    popToggle(ctx, false);
    const it = ctx._items[+b.dataset.i]; if (it && it.run) it.run();
  });
  W.homeEl.addEventListener("contextmenu", e => {
    if (e.target.closest(".win, .search, input, textarea")) return;
    e.preventDefault();
    const t = e.target.closest(".tile");
    if (t && t.dataset.kind === "app") {
      const a = appById(t.dataset.id); if (!a) return;
      const ws = windowsFor(a);
      return menu(e.clientX, e.clientY, [
        { label: ws.length ? "New window" : "Open", icon: I.full, run: () => launch(a, t) },
        ...(ws[0] ? [{ label: "Left half", icon: I.left, run: () => winAct(ws[0], "left") }, { label: "Right half", icon: I.right, run: () => winAct(ws[0], "right") },
          { label: "Close all windows", icon: I.close, run: () => ws.forEach(w => winAct(w, "close")) }] : []),
        { sep: true },
        { label: "Remove from dock", icon: I.bar, run: () => togglePin(a) },
      ]);
    }
    if (t && t.dataset.kind === "win") {
      const w = state.windows.find(x => String(x.id) === t.dataset.id); if (!w) return;
      const a = appFor(w);
      return menu(e.clientX, e.clientY, [
        { label: "Left half", icon: I.left, run: () => winAct(w, "left") }, { label: "Right half", icon: I.right, run: () => winAct(w, "right") },
        { label: "Full screen", icon: I.full, run: () => winAct(w, "full") }, { label: "Close window", icon: I.close, run: () => winAct(w, "close") },
        ...(a ? [{ sep: true }, { label: "Keep in dock", icon: I.bar, run: () => togglePin(a) }] : []),
      ]);
    }
    if (e.target.closest(".capsule, .dock, .chevron")) return;
    menu(e.clientX, e.clientY, [
      { label: "Windmill panel", icon: MARK.replace('class="mark"', 'class="ic"'), key: "Ctrl Win", run: () => openPanel() },
      { label: "All apps", icon: I.full, run: () => openLauncher() },
      { label: "Windmill Search", icon: I.search, key: `${MOD} K`, run: () => W.openSearch() },
      { sep: true },
      { label: "Change wallpaper", icon: I.image, run: () => W.openWin("settings", null, "wallpaper") },
      { label: "Add a wallpaper", icon: I.plus, run: () => addWallpaper() },
      { sep: true },
      { label: "Keyboard shortcuts", icon: I.keys, key: `${MOD} /`, run: () => openKeys() },
      { label: "Lock Windmill", icon: I.lock, key: `${MOD} Shift L`, run: () => lock() },
    ]);
  });

  // ======================= keyboard shortcuts =======================
  const keys = el("div", "glass keys os-pop");
  keys.setAttribute("role", "dialog"); keys.setAttribute("aria-label", "Keyboard shortcuts");
  const KEYS = [
    ["Windmill panel", isApp ? ["Ctrl", "Win"] : ["Windmill button"]], ["Windmill Search", [MOD, "K"]], ["All apps", [MOD, "Shift", "A"]],
    ["Control center", [MOD, "Shift", "C"]], ["Lock Windmill", [MOD, "Shift", "L"]], ["These shortcuts", [MOD, "/"]], ["Close what's open", ["Esc"]],
  ];
  keys.innerHTML = `<h3>Shortcuts</h3>` + KEYS.map(([k, v]) => `<div class="krow2"><span>${esc(k)}</span><span>${v.map(x => `<kbd class="os-kbd">${esc(x)}</kbd>`).join("")}</span></div>`).join("");
  document.body.appendChild(keys);
  function openKeys() { closeAll("keys"); popToggle(keys, true); requestAnimationFrame(() => W.lens(keys)); }

  // ======================= one place that closes things =======================
  function closeAll(except) {
    if (except !== "panel") closePanel();
    if (except !== "cc") closeCC();
    if (except !== "launcher") closeLauncher();
    if (except !== "keys") popToggle(keys, false);
    popToggle(ctx, false); hideCard();
  }
  addEventListener("click", e => {
    if (e.target.closest(".wpanel, .cc, .ctx, .mcard, .keys, #panelBtn, #volBtn, #timeBtn, .launcher, .lock")) return;
    closeAll();
  });
  addEventListener("keydown", e => {
    if (locked) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!$("lPin").hidden) { if (/^\d$/.test(e.key)) pinKey(e.key); else if (e.key === "Backspace") pinKey("b"); }
      else wake();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      const open = [panel, cc, keys, ctx, mcard].some(n => n.classList.contains("on")) || launcher.classList.contains("on");
      if (open) { closeAll(); e.stopImmediatePropagation(); }
      return;
    }
    if (!homeReady) return;
    if (mod && e.key === "/") { e.preventDefault(); keys.classList.contains("on") ? popToggle(keys, false) : openKeys(); }
    else if (mod && e.shiftKey && (e.key === "L" || e.key === "l")) { e.preventDefault(); lock(); }
    else if (mod && e.shiftKey && (e.key === "A" || e.key === "a")) { e.preventDefault(); launcher.classList.contains("on") ? closeLauncher() : openLauncher(); }
    else if (mod && e.shiftKey && (e.key === "C" || e.key === "c")) { e.preventDefault(); cc.classList.contains("on") ? closeCC() : openCC(); }
  }, true);
  // In a browser, Ctrl + Win (Meta) still works when the system lets the page see it.
  let metaCtrl = false;
  if (!isApp) {
    addEventListener("keydown", e => { if ((e.key === "Meta" && e.ctrlKey) || (e.key === "Control" && e.metaKey)) metaCtrl = true; else metaCtrl = false; });
    addEventListener("keyup", e => { if (metaCtrl && (e.key === "Meta" || e.key === "Control") && homeReady) { metaCtrl = false; togglePanel(); } });
  }

  // ======================= wallpapers: live and your own =======================
  const wall = $("wall");
  ["live-drift", "live-waves", "live-aurora"].forEach(k => {
    const i = el("i"); i.dataset.w = k;
    i.innerHTML = k === "live-aurora" ? "<b></b><b></b><b></b>" : "<canvas></canvas>";
    wall.appendChild(i);
  });
  let liveRaf = 0, liveKind = "";
  function runLive(kind) {
    cancelAnimationFrame(liveRaf); liveKind = kind;
    const layer = wall.querySelector(`[data-w="${kind}"]`);
    const cv = layer && layer.querySelector("canvas");
    if (!cv) return;
    const ctx2 = cv.getContext("2d");
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
    size();
    const dots = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: .6 + Math.random() * 2.2, s: .2 + Math.random() * .8, a: Math.random() * 6.28 }));
    const t0 = performance.now();
    const draw = now => {
      if (liveKind !== kind) return;
      if (cv.width !== innerWidth * dpr) size();
      const t = (now - t0) / 1000, w = cv.width, h = cv.height, dark = document.documentElement.classList.contains("dark");
      ctx2.clearRect(0, 0, w, h);
      ctx2.fillStyle = dark ? "#0b0e15" : "#f6f8ff"; ctx2.fillRect(0, 0, w, h);
      if (kind === "live-drift") {
        dots.forEach(d => {
          const x = ((d.x + Math.sin(t * .05 * d.s + d.a) * .04 + t * .004 * d.s) % 1) * w;
          const y = ((d.y + Math.cos(t * .04 * d.s + d.a) * .05) % 1) * h;
          ctx2.beginPath(); ctx2.arc(x, y, d.r * dpr * 1.4, 0, 6.283);
          ctx2.fillStyle = dark ? `rgba(111,147,255,${.25 + d.s * .5})` : `rgba(1,65,253,${.18 + d.s * .45})`; ctx2.fill();
        });
      } else {
        for (let k = 0; k < 7; k++) {
          ctx2.beginPath();
          for (let x = 0; x <= w; x += 8 * dpr) {
            const y = h * (.45 + k * .07) + Math.sin(x / (220 * dpr) + t * (.25 + k * .05) + k) * (28 + k * 6) * dpr;
            x === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y);
          }
          ctx2.strokeStyle = dark ? `rgba(111,147,255,${.12 + k * .06})` : `rgba(1,65,253,${.08 + k * .05})`;
          ctx2.lineWidth = 1.4 * dpr; ctx2.stroke();
        }
      }
      if (!reduce) liveRaf = requestAnimationFrame(draw);
    };
    liveRaf = requestAnimationFrame(draw);
  }
  const customs = new Map(); // name -> { src, kind }
  function addCustomLayer(name, src, kind) {
    customs.set(name, { src, kind });
    let i = wall.querySelector(`[data-w="file:${CSS.escape(name)}"]`);
    if (!i) { i = el("i"); i.dataset.w = "file:" + name; wall.appendChild(i); }
    i.innerHTML = kind === "video" ? `<video src="${esc(src)}" muted loop playsinline preload="auto"></video>` : `<img src="${esc(src)}" alt="">`;
  }
  window.addEventListener("windmill:wall", e => {
    const w = e.detail || "";
    w.startsWith("live-") && w !== "live-aurora" ? runLive(w) : (liveKind = "", cancelAnimationFrame(liveRaf));
    wall.querySelectorAll("video").forEach(v => { const on = v.closest("i").dataset.w === w; on ? v.play().catch(() => {}) : v.pause(); });
    paintWallCards();
  });
  async function loadCustoms() {
    if (!isApp) return;
    try {
      const list = await call("list_wallpapers");
      list.forEach(f => addCustomLayer(f.name, T.core.convertFileSrc(f.path), f.kind));
      paintWallCards();
      if ((prefs.wall || "").startsWith("file:")) W.setWall(prefs.wall, false);
    } catch (e) {}
  }
  const filePick = el("input"); filePick.type = "file"; filePick.accept = "image/*,video/mp4,video/webm"; filePick.hidden = true; document.body.appendChild(filePick);
  filePick.addEventListener("change", () => {
    const f = filePick.files && filePick.files[0]; if (!f) return;
    const kind = f.type.startsWith("video") ? "video" : "image";
    addCustomLayer(f.name, URL.createObjectURL(f), kind);
    W.setWall("file:" + f.name, false);
    notify("Wallpaper set", "In the preview it lasts until you reload. The app keeps it.");
    filePick.value = "";
  });
  async function addWallpaper() {
    if (!isApp) return filePick.click();
    try {
      const path = await call("plugin:dialog|open", { options: { multiple: false, directory: false, title: "Choose a wallpaper",
        filters: [{ name: "Images and videos", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "mp4", "webm", "mov", "m4v"] }] } });
      if (!path) return;
      const f = await call("import_wallpaper", { path: typeof path === "string" ? path : path.path });
      addCustomLayer(f.name, T.core.convertFileSrc(f.path), f.kind);
      W.setWall("file:" + f.name);
      notify("Wallpaper set", f.kind === "video" ? "Live wallpaper from your video." : f.name, I.image);
    } catch (e) { notify("Couldn't use that file", String(e.message || e)); }
  }
  // settings: two more wallpaper groups
  const wallPanel = document.querySelector('#win-settings [data-panel="wallpaper"]');
  wallPanel.insertAdjacentHTML("beforeend", `<h4 class="walls-h">Live</h4><div class="walls" id="liveWalls">
      <button class="wcard" type="button" data-wall="live-drift"><span class="wprev wp-live-drift"></span>Drift</button>
      <button class="wcard" type="button" data-wall="live-waves"><span class="wprev wp-live-waves"></span>Waves</button>
      <button class="wcard" type="button" data-wall="live-aurora"><span class="wprev wp-live-aurora"></span>Aurora</button></div>
    <h4 class="walls-h">Yours</h4><div class="walls" id="myWalls"></div>`);
  wallPanel.addEventListener("click", e => {
    const del = e.target.closest(".wdel");
    if (del) { e.stopPropagation(); return removeWallpaper(del.dataset.name); }
    const c = e.target.closest("#liveWalls .wcard, #myWalls .wcard[data-wall]");
    if (c) W.setWall(c.dataset.wall);
    if (e.target.closest(".wadd")) addWallpaper();
  });
  function paintWallCards() {
    const mine = $("myWalls"); if (!mine) return;
    mine.innerHTML = [...customs.entries()].map(([name, f]) => `<span class="wcard" role="button" tabindex="0" data-wall="file:${esc(name)}">
      <span class="wprev custom" style="${f.kind === "image" ? `background-image:url('${esc(f.src)}')` : ""}">${f.kind === "video" ? `<video src="${esc(f.src)}" muted playsinline preload="metadata"></video>` : ""}</span>
      ${esc(name.replace(/\.[^.]+$/, ""))}<button class="wdel" type="button" data-name="${esc(name)}" aria-label="Remove ${esc(name)}">${I.close}</button></span>`).join("") +
      `<button class="wcard" type="button"><span class="wprev wadd">${I.plus}<span style="font:600 12px var(--sans)">Add image or video</span></span>${isApp ? "Your files" : "Try one"}</button>`;
    document.querySelectorAll("#win-settings .wcard[data-wall]").forEach(c => c.classList.toggle("on", c.dataset.wall === prefs.wall));
  }
  async function removeWallpaper(name) {
    if (isApp) { try { await call("remove_wallpaper", { name }); } catch (e) { return notify("Couldn't remove it", String(e.message || e)); } }
    customs.delete(name);
    const layer = wall.querySelector(`[data-w="file:${CSS.escape(name)}"]`); if (layer) layer.remove();
    if (prefs.wall === "file:" + name) W.setWall("dots");
    paintWallCards();
  }
  paintWallCards();

  // ======================= settings: Windmill and Account =======================
  const side = document.querySelector("#win-settings .side");
  const about = side.querySelector('[data-sec="about"]');
  about.insertAdjacentHTML("beforebegin",
    `<button class="sec" type="button" data-sec="windmill">${MARK.replace('class="mark"', 'class="ic" style="color:var(--blue)"')}Windmill</button>
     <button class="sec" type="button" data-sec="account"><svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.6"/><path d="M5.5 19.5a6.8 6.8 0 0 1 13 0"/></svg>Account</button>`);
  side.querySelectorAll('[data-sec="windmill"], [data-sec="account"]').forEach(b => b.addEventListener("click", () => W.showSection(b.dataset.sec)));
  const pane = document.querySelector("#win-settings .pane");
  pane.insertAdjacentHTML("beforeend", `
    <div class="panel" data-panel="windmill">
      <h3>Windmill</h3><p class="lead">${isApp ? "How Windmill sits on this PC." : "These work in the Windows app."}</p>
      <div class="rows">
        <div class="srow tall"><span>Start with Windows<span class="sub2">Windmill opens when your PC starts.</span></span><button class="sw" type="button" role="switch" aria-checked="false" aria-label="Start with Windows" id="swStart"><i></i></button></div>
        <div class="srow tall"><span>Hide the Windows taskbar<span class="sub2">Windmill takes the whole screen. It comes back when Windmill closes.</span></span><button class="sw" type="button" role="switch" aria-checked="false" aria-label="Hide the Windows taskbar" id="swBar"><i></i></button></div>
        <div class="srow tall"><span>Lock after<span class="sub2">While Windmill is in front and you step away.</span></span><span class="chips" id="lockChips">${[0, 5, 15, 30].map(m => `<button class="chip" type="button" data-m="${m}">${m ? m + " min" : "Never"}</button>`).join("")}</span></div>
        <div class="srow tall"><span>Lock screen PIN<span class="sub2" id="pinSub"></span></span><span class="chips" id="pinBox"></span></div>
        <div class="srow"><span>Keyboard shortcuts</span><button class="os-btn" type="button" id="showKeys">Show</button></div>
      </div>
    </div>
    <div class="panel" data-panel="account"><h3>Account</h3><p class="lead">Your GitHub account in Windmill.</p><div class="os-card" id="acct"></div></div>`);
  function paintWindmillSettings() {
    const sb = $("swBar"); sb.setAttribute("aria-checked", String(isApp ? prefs.hideTaskbar !== false : false));
    $("lockChips").querySelectorAll(".chip").forEach(c => c.classList.toggle("on", +c.dataset.m === (prefs.autoLock || 0)));
    $("pinSub").textContent = prefs.pinHash ? "Unlocking asks for your 4-digit PIN." : "No PIN. Any key unlocks.";
    $("pinBox").innerHTML = prefs.pinHash ? '<button class="chip" type="button" data-pin="change">Change</button><button class="chip" type="button" data-pin="off">Remove</button>'
      : '<button class="chip" type="button" data-pin="set">Set a PIN</button>';
    if (isApp) call("plugin:autostart|is_enabled").then(on => $("swStart").setAttribute("aria-checked", String(!!on))).catch(() => {});
  }
  $("swStart").addEventListener("click", async e => {
    if (!isApp) return notify("Start with Windows", "Available in the Windows app.");
    const on = e.currentTarget.getAttribute("aria-checked") !== "true";
    try { await call(on ? "plugin:autostart|enable" : "plugin:autostart|disable"); e.currentTarget.setAttribute("aria-checked", String(on)); }
    catch (err) { notify("Couldn't change that", String(err.message || err)); }
  });
  $("swBar").addEventListener("click", async e => {
    if (!isApp) return notify("Hide the taskbar", "Available in the Windows app.");
    prefs.hideTaskbar = !(prefs.hideTaskbar !== false); save();
    e.currentTarget.setAttribute("aria-checked", String(prefs.hideTaskbar));
    call("set_taskbar_hidden", { hidden: prefs.hideTaskbar }).catch(() => {});
  });
  $("lockChips").addEventListener("click", e => { const c = e.target.closest(".chip"); if (!c) return; prefs.autoLock = +c.dataset.m; save(); paintWindmillSettings(); });
  $("pinBox").addEventListener("click", async e => {
    const b = e.target.closest("[data-pin]"); if (!b) return;
    if (b.dataset.pin === "off") { delete prefs.pinHash; save(); return paintWindmillSettings(); }
    $("pinBox").innerHTML = '<input id="pinIn" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="4 digits" style="width:96px;height:32px;border-radius:999px;border:1px solid rgba(20,24,40,.15);padding:0 12px;font:600 14px var(--sans);letter-spacing:.2em;background:transparent;color:var(--glass-ink)"><button class="chip on" type="button" data-pin="save">Save</button>';
    const inp = $("pinIn"); inp.focus();
    const commit = async () => {
      if (!/^\d{4}$/.test(inp.value)) { inp.animate([{ transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "none" }], { duration: 240 }); return; }
      prefs.pinHash = await sha(inp.value); save(); paintWindmillSettings(); notify("PIN set", "Windmill asks for it when you unlock.", I.lock);
    };
    $("pinBox").querySelector('[data-pin="save"]').addEventListener("click", commit);
    inp.addEventListener("keydown", ev => { if (ev.key === "Enter") commit(); });
  });
  $("showKeys").addEventListener("click", () => { W.closeWin(); openKeys(); });
  function paintAccount() {
    const box = $("acct"); if (!box) return;
    const p = prefs.profile;
    if (p) {
      box.innerHTML = `<div class="acct">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : ""}<span class="an"><b>${esc(p.name || p.login)}</b><span>@${esc(p.login)} on GitHub</span></span><button class="os-btn" type="button" id="signOut">Sign out</button></div>`;
      $("signOut").addEventListener("click", async () => { if (isApp) await call("github_sign_out").catch(() => {}); prefs.profile = null; save(); paintAccount(); });
    } else {
      box.innerHTML = `<div class="acct"><span class="an"><b>Not signed in</b><span>${isApp ? (ghReady ? "Sign in to show your profile here. Settings sync comes next." : "Sign-in isn't set up in this build yet.") : "Sign-in works in the Windows app."}</span></span>${isApp && ghReady ? '<button class="os-btn primary" type="button" id="signIn">Sign in with GitHub</button>' : ""}</div>`;
      const b = $("signIn");
      if (b) b.addEventListener("click", () => { b.disabled = true; deviceFlow(box, ok => { b.disabled = false; if (ok) notify("Signed in", `Hi, ${prefs.profile.name || prefs.profile.login}.`); }); });
    }
  }
  paintWindmillSettings(); paintAccount();
  document.querySelector("#win-settings").addEventListener("click", e => { if (e.target.closest('[data-sec="windmill"], [data-sec="account"]')) { paintWindmillSettings(); paintAccount(); } });

  // ======================= battery in the bar =======================
  const capR = $("capR");
  const batBtn = el("button", "item icon", I.battery);
  batBtn.type = "button"; batBtn.id = "batBtn"; batBtn.dataset.label = "Battery"; batBtn.hidden = true; batBtn.style.setProperty("--i", 3);
  capR.insertBefore(batBtn, $("timeBtn"));
  W.pressable(batBtn); W.wireTip(batBtn);
  batBtn.addEventListener("click", e => { e.stopPropagation(); openCC(); });
  async function paintBarBattery() {
    let b = null;
    if (isApp) { try { b = await call("battery"); } catch (e) {} }
    else if (navigator.getBattery) { try { const x = await navigator.getBattery(); b = { present: true, percent: Math.round(x.level * 100), charging: x.charging }; } catch (e) {} }
    if (!b || !b.present || b.percent == null) { batBtn.hidden = true; return; }
    batBtn.hidden = false;
    batBtn.dataset.label = `Battery ${b.percent}%${b.charging ? ", charging" : ""}`;
    const f = batBtn.querySelector(".bfill"); if (f) f.setAttribute("width", (10 * b.percent / 100).toFixed(1));
  }

  // ======================= start =======================
  window.addEventListener("windmill:home", () => {
    homeReady = true;
    if (isApp) {
      call("set_taskbar_hidden", { hidden: prefs.hideTaskbar !== false }).catch(() => {});
      if (prefs.profile) notify(`Welcome back, ${prefs.profile.name || prefs.profile.login}`, "Press Ctrl + Win any time for your Windmill panel.");
      else if (!prefs.seenPanelTip) { prefs.seenPanelTip = true; save(); notify("Tip", "Press Ctrl + Win any time for your Windmill panel."); }
    }
    loadApps(); loadCustoms(); paintBarBattery();
    setInterval(() => { if (document.visibilityState === "visible") refreshWindows(); }, 2500);
    setInterval(() => { paintBarBattery(); watchBattery(); }, 60000);
    if ((prefs.wall || "").startsWith("live-")) window.dispatchEvent(new CustomEvent("windmill:wall", { detail: prefs.wall }));
  });
})();
