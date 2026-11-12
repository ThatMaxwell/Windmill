/* Windmill shell, second pass: the behaviour behind shell.css. */
(() => {
  const W = window.Windmill;
  const home = document.getElementById("home"), wall = document.getElementById("wall");
  if (!W || !home || !wall) return;
  const reduce = () => !!W.reduce;

  // ---------- light on the wallpaper, following the pointer slowly ----------
  const amb = document.createElement("div"); amb.className = "ambient"; amb.setAttribute("aria-hidden", "true");
  wall.appendChild(amb);
  let ax = 30, ay = 30, tx = 30, ty = 30, raf = 0;
  const glide = () => {
    ax += (tx - ax) * .03; ay += (ty - ay) * .03;
    amb.style.setProperty("--ax", ax.toFixed(2) + "%"); amb.style.setProperty("--ay", ay.toFixed(2) + "%");
    raf = Math.abs(tx - ax) + Math.abs(ty - ay) > .05 ? requestAnimationFrame(glide) : 0;
  };
  addEventListener("pointermove", e => {
    if (reduce() || home.hidden) return;
    tx = 10 + e.clientX / innerWidth * 80; ty = 10 + e.clientY / innerHeight * 80;
    if (!raf) raf = requestAnimationFrame(glide);
  }, { passive: true });

  // ---------- arriving: the desktop comes into focus ----------
  let arrived = false;
  const arrive = () => {
    if (arrived || home.hidden) return; arrived = true;
    if (reduce()) { home.classList.add("lit"); return; }
    home.classList.add("arrive");
    requestAnimationFrame(() => requestAnimationFrame(() => { home.classList.remove("arrive"); setTimeout(() => home.classList.add("lit"), 600); }));
  };
  new MutationObserver(arrive).observe(home, { attributes: true, attributeFilter: ["hidden"] });
  arrive();

  // ---------- the desktop steps back when something opens ----------
  const OPEN = ".win.open, .search.on, .os-pop.on, .launcher.on";
  let focusT = 0;
  const check = () => { clearTimeout(focusT); focusT = setTimeout(() => home.classList.toggle("focus", !!document.querySelector(OPEN)), 16); };
  new MutationObserver(check).observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true });

  // ---------- the island leans in when you come near ----------
  const bar = document.getElementById("bar");
  if (bar) addEventListener("pointermove", e => bar.classList.toggle("near", e.clientY < 90 && Math.abs(e.clientX - innerWidth / 2) < innerWidth * .32), { passive: true });

  // ---------- the dock: grows out of its button; push against the bottom edge to call it ----------
  const dock = document.getElementById("dock"), wrap = dock && dock.closest(".dockwrap"), chev = document.getElementById("chev");
  if (dock && wrap) {
    new MutationObserver(() => wrap.classList.toggle("dock-open", dock.classList.contains("open"))).observe(dock, { attributes: true, attributeFilter: ["class"] });
    const edge = document.createElement("div"); edge.className = "dock-edge"; edge.setAttribute("aria-hidden", "true");
    document.body.appendChild(edge);
    let hold = 0, auto = false;
    edge.addEventListener("pointerenter", () => {
      if (home.hidden || dock.classList.contains("open") || home.classList.contains("focus")) return;
      hold = setTimeout(() => { auto = true; W.openDock(); }, 220);
    });
    edge.addEventListener("pointerleave", () => clearTimeout(hold));
    // a dock that came by itself leaves by itself, once you move away from it
    let away = 0;
    addEventListener("pointermove", e => {
      if (!auto || !dock.classList.contains("open")) { auto = auto && dock.classList.contains("open"); return; }
      const r = dock.getBoundingClientRect();
      if (e.clientY < r.top - 120) { if (!away) away = setTimeout(() => { if (auto) { auto = false; W.closeDock(); } away = 0; }, 500); }
      else { clearTimeout(away); away = 0; }
    }, { passive: true });
    if (chev) chev.addEventListener("click", () => { auto = false; });
  }
})();
