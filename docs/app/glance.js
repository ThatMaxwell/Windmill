/* Windmill's home glance: a clock that rolls into place, and four widgets with live numbers.
   Weather, battery, screen time and open windows come from the same places the panel uses. */
(() => {
  const W = window.Windmill;
  const home = document.getElementById("home");
  if (!W || !home) return;
  const reduce = () => !!W.reduce;
  const prefs = W.prefs;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDur = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? [h, m] : [0, m]; };

  const ICON = {
    bolt: '<svg class="g-bolt" viewBox="0 0 24 24" fill="currentColor"><path d="M13.2 2.5 5.5 13.2h5.6l-1.2 8.3 7.6-10.7h-5.6z"/></svg>',
    hour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    win: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M3.5 9h17" stroke-linecap="round"/></svg>',
  };

  // ---------- the markup ----------
  const g = document.createElement("section");
  g.className = "glance"; g.id = "glance"; g.setAttribute("aria-label", "At a glance");
  g.innerHTML = `
    <div class="g-head">
      <div class="g-hi" id="gHi" style="--i:0"></div>
      <div class="g-time" id="gTime" style="--i:1" role="timer" aria-live="off"></div>
      <div class="g-date" id="gDate" style="--i:2"></div>
    </div>
    <div class="g-cards">
      <button class="glass g-card g-wx" type="button" id="gWx" style="--i:3" aria-label="Weather">
        <span class="g-k"><span id="gWxPlace">Weather</span><span class="wxi" id="gWxIcon"></span></span><span></span>
        <span class="g-v wait" id="gWxT">Checking the sky</span><span class="g-s" id="gWxWord">&nbsp;</span>
      </button>
      <button class="glass g-card g-bat" type="button" id="gBat" style="--i:4" aria-label="Battery">
        <span class="g-k"><span>Battery</span>${ICON.bolt}</span>
        <svg class="g-ring" id="gRing" viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="14"/><circle class="fg" cx="18" cy="18" r="14"/></svg>
        <span class="g-v" id="gBatV">&ndash;</span><span class="g-s" id="gBatS">&nbsp;</span>
      </button>
      <button class="glass g-card g-st" type="button" id="gSt" style="--i:5" aria-label="Screen time today">
        <span class="g-k"><span>Screen time</span>${ICON.hour}</span>
        <span class="g-bars" id="gBars" aria-hidden="true"></span>
        <span class="g-v" id="gStV">&ndash;</span><span class="g-s">Last 12 hours</span>
      </button>
      <button class="glass g-card g-open" type="button" id="gOpen" style="--i:6" aria-label="Open windows">
        <span class="g-k"><span>Open now</span>${ICON.win}</span>
        <span class="g-icons" id="gIcons" aria-hidden="true"></span>
        <span class="g-v" id="gOpenV">&ndash;</span><span class="g-s" id="gOpenS">windows</span>
      </button>
    </div>`;
  home.appendChild(g);
  const $ = id => document.getElementById(id);
  g.querySelectorAll(".g-card").forEach(c => { if (W.pressable) W.pressable(c); });

  // ---------- numbers that count up ----------
  function count(el, to, fmt = v => String(Math.round(v)), ms = 1100) {
    const from = +el.dataset.v || 0; el.dataset.v = to;
    if (reduce() || from === to) { el.innerHTML = fmt(to); return; }
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 4);
      el.innerHTML = fmt(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- the clock: each digit is a strip that rolls ----------
  let shape = "";
  function paintTime(first) {
    const now = new Date();
    const h12 = prefs.hour12 ?? (new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 !== false);
    let h = now.getHours();
    const ampm = h12 ? (h >= 12 ? "PM" : "AM") : "";
    if (h12) h = h % 12 || 12;
    const hs = h12 ? String(h) : String(h).padStart(2, "0"), ms = String(now.getMinutes()).padStart(2, "0");
    const digits = (hs + ms).split("").map(Number);
    const box = $("gTime");
    const sig = hs.length + (ampm ? "a" : "");
    if (sig !== shape) {
      shape = sig;
      const strip = () => `<span class="g-dg"><span class="g-strip">${Array.from({ length: 10 }, (_, i) => `<span>${i}</span>`).join("")}</span></span>`;
      box.innerHTML = hs.split("").map(strip).join("") + '<span class="g-colon">:</span>' + strip() + strip() + (ampm ? `<span class="g-ampm" id="gAmpm"></span>` : "");
      first = true;
    }
    const strips = box.querySelectorAll(".g-strip");
    strips.forEach((s, i) => {
      s.style.setProperty("--dl", first ? `${.35 + i * .09}s` : "0s");
      if (first && !reduce()) { s.style.transition = "none"; s.style.setProperty("--n", 0); void s.offsetWidth; s.style.transition = ""; }
      s.style.setProperty("--n", digits[i]);
    });
    if (ampm) $("gAmpm").textContent = ampm;
    box.setAttribute("aria-label", now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: h12 }));
    $("gDate").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const hr = now.getHours();
    const part = hr < 5 ? "Good night" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
    const who = prefs.profile && (prefs.profile.name || prefs.profile.login);
    $("gHi").textContent = who ? `${part}, ${String(who).split(" ")[0]}` : part;
  }

  // ---------- the widgets ----------
  function paintWeather() {
    const wx = W.weather;
    if (!wx) return false;
    $("gWxIcon").innerHTML = (W.WX && W.WX[wx.kind]) || "";
    $("gWxPlace").textContent = wx.place || "Weather";
    $("gWxWord").textContent = wx.word ? wx.word[0].toUpperCase() + wx.word.slice(1) : "";
    $("gWxT").classList.remove("wait");
    count($("gWxT"), Math.round(wx.t), v => `${Math.round(v)}<small style="margin-left:0">&deg;</small>`);
    return true;
  }
  async function paintBattery() {
    const os = W.os; if (!os) return;
    const b = await os.battery();
    const card = $("gBat");
    if (!b || !b.present) { card.hidden = true; return; }
    card.hidden = false;
    card.classList.toggle("charging", !!b.charging);
    $("gRing").style.setProperty("--p", b.percent);
    $("gRing").classList.toggle("low", b.percent <= 20 && !b.charging);
    count($("gBatV"), b.percent, v => `${Math.round(v)}<small>%</small>`);
    $("gBatS").textContent = b.charging ? "Charging" : b.percent <= 20 ? "Low" : "On battery";
  }
  async function paintScreenTime() {
    const os = W.os; if (!os) return;
    const st = await os.screenTime();
    const last = st.hours.slice(-12), max = Math.max(1, ...last);
    const bars = $("gBars");
    if (bars.children.length !== last.length) bars.innerHTML = last.map((_, i) => `<i style="--i:${i}"></i>`).join("");
    requestAnimationFrame(() => [...bars.children].forEach((b, i) => { b.style.height = `${Math.max(10, Math.round(last[i] / max * 100))}%`; b.classList.toggle("now", i === last.length - 1); }));
    const total = last.reduce((a, b) => a + b, 0);
    count($("gStV"), Math.round(total / 60), v => { const [h, m] = fmtDur(Math.round(v) * 60); return h ? `${h}<small>h</small> ${m}<small>m</small>` : `${m}<small>m</small>`; });
  }
  function paintOpen() {
    const os = W.os; if (!os) return;
    const wins = os.windows() || [];
    count($("gOpenV"), wins.length, v => String(Math.round(v)), 700);
    $("gOpenS").textContent = wins.length === 1 ? "window" : "windows";
    $("gIcons").innerHTML = wins.slice(0, 5).map(w => `<span>${os.iconFor(w)}</span>`).join("");
  }

  $("gBat").addEventListener("click", () => W.os && W.os.openCC());
  $("gSt").addEventListener("click", () => W.os && W.os.openPanel());
  $("gOpen").addEventListener("click", () => W.os && W.os.openPanel());
  $("gWx").addEventListener("click", () => document.getElementById("wxBtn") && document.getElementById("wxBtn").click());

  // ---------- showing and hiding ----------
  const on = () => prefs.glance !== false;
  let started = false;
  function enter() {
    if (!on() || started) return;
    started = true;
    g.hidden = false; home.classList.add("glance-on");
    paintTime(true);
    requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add("in")));
    let tries = 0;
    const wxWait = setInterval(() => {
      if (paintWeather()) return clearInterval(wxWait);
      if (++tries > 40) { clearInterval(wxWait); $("gWxT").textContent = "Not available"; $("gWxWord").textContent = "Windmill tries again soon."; }
    }, 500);
    setTimeout(() => { paintBattery(); paintScreenTime(); paintOpen(); }, 450);
    if (g.querySelectorAll(".g-card").length && W.lensAll) setTimeout(() => W.lensAll(), 1400);
  }
  function setOn(v) {
    prefs.glance = v; W.savePrefs();
    const sw = document.getElementById("swGlance"); if (sw) sw.setAttribute("aria-checked", String(v));
    if (v) { g.classList.remove("out"); started = false; enter(); }
    else { g.classList.add("out"); g.classList.remove("in"); setTimeout(() => { if (prefs.glance === false) { g.hidden = true; home.classList.remove("glance-on"); } }, 400); }
  }
  g.hidden = true;
  // it arrives when the "Welcome" has said hello and left
  const welcome = document.getElementById("welcome");
  if (welcome) new MutationObserver(() => { if (welcome.classList.contains("gone")) setTimeout(enter, 350); }).observe(welcome, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("windmill:home", () => setTimeout(enter, 4200));

  // every minute, on the minute; the widgets every half minute
  const tick = () => { if (started) paintTime(false); setTimeout(tick, 60000 - (Date.now() % 60000) + 30); };
  setTimeout(tick, 60000 - (Date.now() % 60000) + 30);
  setInterval(() => { if (!started || document.visibilityState !== "visible") return; paintWeather(); paintBattery(); paintScreenTime(); paintOpen(); }, 30000);
  setInterval(() => { if (started && document.visibilityState === "visible") paintOpen(); }, 3000);

  // white letters over your own photos and the deep wallpaper
  window.addEventListener("windmill:wall", e => g.classList.toggle("on-photo", String(e.detail || "").startsWith("file:")));
  if (String(prefs.wall || "").startsWith("file:")) g.classList.add("on-photo");

  // ---------- the wallpaper leans with your pointer ----------
  const wall = document.getElementById("wall");
  if (wall) {
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const loop = () => {
      cx += (tx - cx) * .06; cy += (ty - cy) * .06;
      wall.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0) scale(1.035)`;
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > .05 ? requestAnimationFrame(loop) : 0;
    };
    addEventListener("pointermove", e => {
      if (reduce() || home.hidden) return;
      tx = (e.clientX / innerWidth - .5) * -18; ty = (e.clientY / innerHeight - .5) * -12;
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
  }

  // ---------- Settings -> Wallpaper: a switch for it; and in Windmill Search ----------
  const pane = document.querySelector('#win-settings [data-panel="wallpaper"]');
  if (pane) {
    pane.insertAdjacentHTML("beforeend", `<div class="walls-h">Home</div><div class="rows"><div class="srow tall"><span>Clock and widgets<span class="sub2">The time, weather, battery, screen time and what's open, on your wallpaper.</span></span><button class="sw" type="button" role="switch" aria-checked="${on()}" aria-label="Clock and widgets" id="swGlance"><i></i></button></div></div>`);
    document.getElementById("swGlance").addEventListener("click", () => setOn(!on()));
  }
  if (W.INDEX) {
    const gear = (W.INDEX.find(x => x.label === "Settings") || {}).icon || "";
    W.INDEX.push({ group: "Settings", label: "Clock and widgets", hint: "Show or hide", keys: "home glance time weather battery screen time", icon: gear, run: () => setOn(!on()) });
  }
})();
