/* Windmill accessibility.
   Loaded in <head>, so a reading font, reduced motion or contrast is in place before anything is drawn.
   Once the page is ready it adds Settings -> Accessibility, a few Windmill Search entries and Ctrl + Shift + U. */
(() => {
  const KEY = "windmill-preview";
  const root = document.documentElement;
  const DEF = {
    font: "default", size: 1, space: false, bold: false, guide: false, tint: "none",
    contrast: false, solid: false, gray: false, pointer: 1, focus: false,
    motion: "system", labels: false, toast: 4800,
  };
  const stored = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } };
  let a = Object.assign({}, DEF, stored().a11y || {});
  let cursorKind = stored().cursor || "system";
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => a.motion === "reduce" || (a.motion === "system" && mq.matches);
  const tauri = () => window.__TAURI__ || null;
  const isApp = !!(window.__TAURI__ && window.__TAURI__.core);

  const FONTS = [
    { v: "default", l: "Windmill", css: '"Inter", "Segoe UI", system-ui, sans-serif', note: "The usual" },
    { v: "dyslexic", l: "OpenDyslexic", css: '"OpenDyslexic", sans-serif', note: "Weighted letters" },
    { v: "atkinson", l: "Atkinson Hyperlegible", css: '"Atkinson Hyperlegible Next", sans-serif', note: "Distinct letters" },
  ];
  const TINTS = [
    ["none", "No tint", ""], ["cream", "Cream", "#fff1c4"], ["peach", "Peach", "#ffdcc4"], ["rose", "Rose", "#ffd8e6"],
    ["mint", "Mint", "#d3f3dc"], ["sky", "Sky", "#d2e5ff"], ["lilac", "Lilac", "#e4dbff"],
  ];
  const SIZES = [[1, "100%"], [1.15, "115%"], [1.3, "130%"], [1.5, "150%"]];
  const POINTERS = [[1, "Normal"], [1.5, "Large"], [2, "Extra large"]];
  const TOASTS = [[4800, "5 seconds"], [10000, "10 seconds"], [20000, "20 seconds"], [0, "Until I close them"]];

  // ---------- applying ----------
  let zoomed = 1;
  function zoom() {
    const want = +a.size || 1;
    if (want === zoomed) return;
    const wv = tauri() && tauri().webview && tauri().webview.getCurrentWebview && tauri().webview.getCurrentWebview();
    if (!wv || !wv.setZoom) return;
    wv.setZoom(want).then(() => { zoomed = want; }).catch(() => {});
  }
  function cursor() {
    const s = +a.pointer || 1;
    let st = document.getElementById("a11yCursor");
    root.classList.toggle("a-ptr", s > 1);
    if (s <= 1) { if (st) st.remove(); return; }
    let svg, hx, hy;
    if (cursorKind === "dot") {
      const w = Math.round(24 * s);
      svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${w}' viewBox='0 0 24 24'><circle cx='12' cy='12' r='6' fill='#0141FD' stroke='white' stroke-width='2.5'/></svg>`;
      hx = hy = Math.round(w / 2);
    } else {
      const w = Math.round(28 * s), fill = cursorKind === "windmill" ? "#0141FD" : "#141413";
      svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${w}' viewBox='0 0 28 28'><path d='M5 3.5l16.5 8.2-7 1.9-3.3 6.9z' fill='${fill}' stroke='white' stroke-width='1.8' stroke-linejoin='round'/></svg>`;
      hx = Math.round(5 * s); hy = Math.round(3.5 * s);
    }
    if (!st) { st = document.createElement("style"); st.id = "a11yCursor"; document.head.appendChild(st); }
    st.textContent = `:root.a-ptr, :root.a-ptr * { cursor: url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, auto !important; }
:root.a-ptr input:not([type="range"]):not([type="checkbox"]), :root.a-ptr textarea { cursor: text !important; }`;
  }
  let lastReduce = null;
  function apply() {
    const c = root.classList;
    c.toggle("a-font-dys", a.font === "dyslexic");
    c.toggle("a-font-atk", a.font === "atkinson");
    c.toggle("a-space", !!a.space);
    c.toggle("a-bold", !!a.bold);
    c.toggle("a-contrast", !!a.contrast);
    c.toggle("a-solid", !!a.solid);
    c.toggle("a-gray", !!a.gray);
    c.toggle("a-focus", !!a.focus);
    c.toggle("a-labels", !!a.labels);
    c.toggle("a-guide", !!a.guide);
    const tint = TINTS.find(t => t[0] === a.tint);
    c.toggle("a-tint", !!(tint && tint[2]));
    root.style.setProperty("--a-tint", tint && tint[2] ? tint[2] : "transparent");
    const rm = reduced();
    c.toggle("a-rm", rm);
    if (rm !== lastReduce) {
      lastReduce = rm;
      const W = window.Windmill;
      if (W && W.setReduce) {
        W.setReduce(rm);
        // live wallpapers and video wallpapers stop or start again
        window.dispatchEvent(new CustomEvent("windmill:wall", { detail: W.prefs.wall }));
      }
    }
    cursor();
    zoom();
  }
  function save() {
    const W = window.Windmill;
    if (W && W.prefs) { W.prefs.a11y = a; W.savePrefs(); return; }
    try { const p = stored(); p.a11y = a; localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
  }
  function set(patch) { a = Object.assign({}, a, patch); apply(); save(); paint(); }
  apply();
  mq.addEventListener("change", apply);

  window.WindmillA11y = { get: () => Object.assign({}, a), set, reduced, FONTS, open: () => openPage() };

  // ---------- once the page is ready ----------
  function ready(fn) { document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn(); }
  ready(() => {
    const W = window.Windmill;
    if (W && W.prefs) { W.prefs.a11y = a; if (W.setReduce) W.setReduce(reduced()); }
    lastReduce = reduced();

    // the tint and the reading guide sit above everything and never take a click
    const tintL = document.createElement("div"); tintL.className = "a-layer a-tint"; tintL.setAttribute("aria-hidden", "true");
    const guideL = document.createElement("div"); guideL.className = "a-layer a-guide"; guideL.setAttribute("aria-hidden", "true");
    document.body.append(tintL, guideL);
    let gy = 0, gRaf = 0;
    addEventListener("pointermove", e => {
      if (!a.guide) return;
      gy = e.clientY; guideL.classList.add("on");
      if (!gRaf) gRaf = requestAnimationFrame(() => { gRaf = 0; guideL.style.setProperty("--gy", gy + "px"); });
    }, { passive: true });
    document.addEventListener("pointerleave", () => guideL.classList.remove("on"));

    addEventListener("windmill:cursor", e => { cursorKind = e.detail || "system"; cursor(); });
    zoom();
    if (W) build(W);
  });

  // ---------- Settings -> Accessibility ----------
  const ICON = '<svg class="ic" viewBox="0 0 24 24"><circle class="fill" cx="12" cy="4.6" r="1.9"/><path d="M4.8 8.4c2.5.9 4.9 1.3 7.2 1.3s4.7-.4 7.2-1.3"/><path class="soft" d="M12 9.8v4.4M12 14.2l-3.1 6.1M12 14.2l3.1 6.1"/></svg>';
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const sw = (key, label) => `<button class="sw" type="button" role="switch" aria-checked="false" aria-label="${esc(label)}" data-a="${key}"><i></i></button>`;
  const row = (title, sub, ctl, stack) => `<div class="srow tall${stack ? " a-stack" : ""}"><span>${title}<span class="sub2">${sub}</span></span>${ctl}</div>`;
  const chips = (key, list, label) => `<span class="chips" role="radiogroup" aria-label="${esc(label)}" data-a="${key}">${list.map(([v, l]) => `<button class="chip" type="button" role="radio" data-v="${v}">${esc(l)}</button>`).join("")}</span>`;
  let page = null;

  function build(W) {
    const side = document.querySelector("#win-settings .side"), pane = document.querySelector("#win-settings .pane");
    if (!side || !pane) return;
    const before = side.querySelector('[data-sec="windmill"]') || side.querySelector('[data-sec="about"]');
    before.insertAdjacentHTML("beforebegin", `<button class="sec" type="button" data-sec="access">${ICON}Accessibility</button>`);
    side.querySelector('[data-sec="access"]').addEventListener("click", () => { W.showSection("access"); paint(); });
    const motionSys = isApp ? "Like Windows" : "Like my device";
    pane.insertAdjacentHTML("beforeend", `
      <div class="panel" data-panel="access">
        <h3>Accessibility</h3>
        <p class="lead">Make Windmill easier to read, see and use. Everything changes right away, and you can come back here with Ctrl + Shift + U.</p>

        <div class="a-h">Reading</div>
        <div class="a-fonts" role="radiogroup" aria-label="Font">
          ${FONTS.map(f => `<button class="a-fcard" type="button" role="radio" data-font="${f.v}"><span class="a-fprev" style='font-family:${f.css}'><b>Aa</b><small>${esc(f.note)}</small></span><span style='font-family:${f.css}'>${esc(f.l)}</span></button>`).join("")}
        </div>
        <div class="rows">
          ${row("Size", isApp ? "Makes text, and everything around it, bigger." : "In a browser, use Ctrl and + to zoom instead. This works in the Windows app.", chips("size", SIZES, "Size"))}
          ${row("Wider spacing", "More room between letters, words and lines.", sw("space", "Wider spacing"))}
          ${row("Bold text", "Thicker letters everywhere.", sw("bold", "Bold text"))}
          ${row("Reading guide", "A clear band follows your pointer and softly dims the rest, so you don't lose your place.", sw("guide", "Reading guide"))}
          ${row("Screen tint", "A soft color over everything. Some people find text calmer to read this way.", `<span class="a-tints" role="radiogroup" aria-label="Screen tint">${TINTS.map(([v, l, c]) => `<button type="button" role="radio" data-tint="${v}" aria-label="${l}" data-label="${l}" style="--c:${c || "transparent"}"></button>`).join("")}</span>`, true)}
        </div>

        <div class="a-h">Seeing</div>
        <div class="rows">
          ${row("Increase contrast", "Darker text and clear outlines around everything.", sw("contrast", "Increase contrast"))}
          ${row("Solid surfaces", "Glass becomes solid, so text never sits over a busy wallpaper.", sw("solid", "Solid surfaces"))}
          ${row("Grayscale", "Shows everything in shades of gray.", sw("gray", "Grayscale"))}
          ${row("Pointer size", "A bigger pointer that's easier to find.", chips("pointer", POINTERS, "Pointer size"))}
          ${row("Clear focus ring", "A thick blue ring shows where you are when you use the keyboard.", sw("focus", "Clear focus ring"))}
        </div>

        <div class="a-h">Motion</div>
        <div class="rows">
          ${row("Reduce motion", "No spinning, sliding or bouncing, and live wallpapers stand still.", chips("motion", [["system", motionSys], ["reduce", "On"], ["full", "Off"]], "Reduce motion"), true)}
        </div>

        <div class="a-h">Focus</div>
        <div class="rows">
          ${row("App names in the dock", "Shows each app's name under its icon, without hovering.", sw("labels", "App names in the dock"))}
          ${row("Keep notifications on screen", "Gives you more time to read them.", chips("toast", TOASTS, "Keep notifications on screen"), true)}
        </div>

        <p class="a-note">OpenDyslexic (by Abbie Gonzalez) and Atkinson Hyperlegible Next (by the Braille Institute) are free fonts under the SIL Open Font License, and come with Windmill, so they work offline.</p>
        <div class="a-foot"><button class="os-btn" type="button" id="a11yReset">Reset accessibility</button></div>
      </div>`);
    page = pane.querySelector('[data-panel="access"]');
    if (!isApp) page.querySelectorAll('[data-a="size"] .chip').forEach(c => { c.disabled = true; });

    page.addEventListener("click", e => {
      const f = e.target.closest(".a-fcard");
      if (f) return set({ font: f.dataset.font });
      const s = e.target.closest(".sw[data-a]");
      if (s) return set({ [s.dataset.a]: !a[s.dataset.a] });
      const t = e.target.closest("[data-tint]");
      if (t) return set({ tint: t.dataset.tint });
      const c = e.target.closest(".chip");
      if (c && !c.disabled) {
        const key = c.closest("[data-a]").dataset.a, raw = c.dataset.v;
        return set({ [key]: isNaN(+raw) ? raw : +raw });
      }
      if (e.target.closest("#a11yReset")) set(Object.assign({}, DEF));
    });
    // arrow keys move between the choices in a group
    page.addEventListener("keydown", e => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const group = e.target.closest('[role="radiogroup"]'); if (!group) return;
      const opts = [...group.querySelectorAll('[role="radio"]:not([disabled])')], i = opts.indexOf(e.target);
      if (i < 0) return;
      e.preventDefault();
      const n = opts[(i + (e.key === "ArrowRight" ? 1 : -1) + opts.length) % opts.length];
      n.focus(); n.click();
    });
    if (W.wireTip) page.querySelectorAll(".a-tints [data-label]").forEach(b => W.wireTip(b));

    // Windmill Search
    const gear = (W.INDEX.find(x => x.label === "Settings") || {}).icon || "";
    const go = () => openPage();
    W.INDEX.push(
      { group: "Settings", label: "Accessibility", hint: `Ctrl Shift U`, keys: "dyslexia dyslexic reading font text size bigger zoom contrast motion animation tint color vision", icon: gear, run: go },
      { group: "Settings", label: "Font: OpenDyslexic", keys: "dyslexia dyslexic reading accessibility", icon: gear, run: () => set({ font: "dyslexic" }) },
      { group: "Settings", label: "Font: Atkinson Hyperlegible", keys: "low vision reading accessibility", icon: gear, run: () => set({ font: "atkinson" }) },
      { group: "Settings", label: "Font: Windmill (Inter)", keys: "default reading accessibility", icon: gear, run: () => set({ font: "default" }) },
      { group: "Settings", label: "Reduce motion", hint: "Turn on or off", keys: "animation movement accessibility vestibular", icon: gear, run: () => set({ motion: reduced() ? "full" : "reduce" }) },
      { group: "Settings", label: "Reading guide", hint: "Turn on or off", keys: "ruler mask line dyslexia accessibility", icon: gear, run: () => set({ guide: !a.guide }) },
      { group: "Settings", label: "Increase contrast", hint: "Turn on or off", keys: "vision accessibility", icon: gear, run: () => set({ contrast: !a.contrast }) },
    );

    // Ctrl + Shift + U, like Windows' own Win + U
    addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "U" || e.key === "u")) { e.preventDefault(); openPage(); }
    });
    paint();
  }
  function openPage() {
    const W = window.Windmill; if (!W) return;
    W.openWin("settings", document.getElementById("searchBtn"), "access");
    paint();
  }
  function paint() {
    if (!page) return;
    page.querySelectorAll(".a-fcard").forEach(b => { const on = b.dataset.font === a.font; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
    page.querySelectorAll(".sw[data-a]").forEach(s => s.setAttribute("aria-checked", String(!!a[s.dataset.a])));
    page.querySelectorAll("[data-tint]").forEach(b => { const on = b.dataset.tint === a.tint; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
    page.querySelectorAll(".chips[data-a]").forEach(g => {
      const v = a[g.dataset.a];
      g.querySelectorAll(".chip").forEach(c => { const on = String(c.dataset.v) === String(v); c.classList.toggle("on", on); c.setAttribute("aria-checked", String(on)); });
    });
  }
})();
