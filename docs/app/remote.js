/* =====================================================================
   Windmill Link: your phone and your PC, on any network.
   The PC and the phone find each other with the pairing code through a public
   matchmaking server (PeerJS), then talk directly over WebRTC, which is always
   encrypted. When a network won't allow a direct link (some offices, some mobile
   carriers), an encrypted relay passes the data along instead.
   The server only sees an anonymous ID made from the code, never the code itself,
   your screen or what you type.
   ===================================================================== */
(() => {
  "use strict";
  // No 0/O, 1/I/L: easy to read out loud and to type, with or without dyslexia.
  const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const CODE_LEN = 8;
  // Frame sizes, from sharp to light: the PC steps down when the network is slow.
  const LEVELS = [{ w: 1280, q: 62 }, { w: 1120, q: 54 }, { w: 960, q: 46 }, { w: 800, q: 40 }];
  const ICE = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
    { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
  ];

  const normCode = s => String(s || "").toUpperCase().split("").filter(c => ALPHABET.includes(c)).join("").slice(0, CODE_LEN);
  const showCode = s => normCode(s).replace(/^(.{4})(.+)$/, "$1 $2");
  function newCode() {
    const out = [], buf = new Uint8Array(32);
    while (out.length < CODE_LEN) {
      crypto.getRandomValues(buf);
      for (const b of buf) if (b < 248 && out.length < CODE_LEN) out.push(ALPHABET[b % 31]);   // 248 = 8*31: no bias
    }
    return out.join("");
  }
  async function idFor(code) {
    const data = new TextEncoder().encode("windmill-link-v1:" + normCode(code));
    let hex;
    if (crypto.subtle) {
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
      hex = [...h].map(b => b.toString(16).padStart(2, "0")).join("");
    } else {   // no secure context: a plain 128-bit mix is enough to make an ID
      let a = 0x6a09e667, b = 0xbb67ae85, c = 0x3c6ef372, d = 0xa54ff53a;
      for (const x of data) { a = Math.imul(a ^ x, 2654435761); b = Math.imul(b ^ a, 1597334677); c = Math.imul(c ^ b, 2246822507); d = Math.imul(d ^ c, 3266489909); }
      hex = [a, b, c, d].map(n => (n >>> 0).toString(16).padStart(8, "0")).join("");
    }
    return "windmill-" + hex.slice(0, 32);
  }

  let loading = null;
  function load() {
    if (window.Peer) return Promise.resolve();
    if (!loading) loading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "vendor/peerjs.min.js?v=1.5.5";
      s.onload = () => res(); s.onerror = () => { loading = null; rej(new Error("Couldn't load the connection library.")); };
      document.head.appendChild(s);
    });
    return loading;
  }
  const options = () => Object.assign({ debug: 0, config: { iceServers: ICE } }, window.WINDMILL_PEER_SERVER || {});
  const isBinary = m => m instanceof ArrayBuffer || ArrayBuffer.isView(m) || (typeof Blob !== "undefined" && m instanceof Blob);

  // ---------- on the PC: wait for your phone ----------
  // call: Tauri invoke. onState({ status, phone, error }) whenever something changes.
  function host({ code, call, onState }) {
    code = normCode(code);
    let peer = null, conn = null, stopped = false, retryTimer = 0, fails = 0;
    let pumping = false, awaiting = false, sentAt = 0, level = 0, ema = 0, fastRun = 0;
    const state = { status: "starting", phone: null, error: "" };
    const set = o => { Object.assign(state, o); onState && onState({ ...state }); };

    async function pump() {
      if (pumping || awaiting || !conn || !conn.open) return;
      pumping = true;
      try {
        const L = LEVELS[level];
        const buf = await call("remote_frame", { width: L.w, quality: L.q });
        if (!conn || !conn.open) return;
        if (buf && buf.byteLength) { conn.send(buf); sentAt = performance.now(); awaiting = true; }
      } catch (e) {
        await new Promise(r => setTimeout(r, 400));
      } finally { pumping = false; }
      if (!awaiting) pump();
    }
    function acked() {
      awaiting = false;
      const rtt = performance.now() - sentAt;
      ema = ema ? ema * 0.7 + rtt * 0.3 : rtt;
      if (ema > 450 && level < LEVELS.length - 1) { level++; ema = 300; fastRun = 0; }
      else if (ema < 160 && level > 0) { if (++fastRun > 24) { level--; fastRun = 0; } }
      else fastRun = 0;
      pump();
    }

    function onConnection(c) {
      let ok = false;
      const drop = why => { try { if (why) c.send({ t: "error", why }); } catch (e) {} setTimeout(() => c.close(), 400); };
      const timer = setTimeout(() => { if (!ok) c.close(); }, 20000);
      c.on("data", async m => {
        if (!ok) {
          if (!m || m.t !== "hello") return drop();
          if (normCode(m.code) !== code) return drop("That code doesn't match. Check the code on your PC.");
          if (conn && conn.open) return drop("Another phone is using this PC right now.");
          ok = true; clearTimeout(timer); conn = c; level = 0; ema = 0; awaiting = false;
          let info = {};
          try { info = await call("remote_hello"); } catch (e) {}
          c.send({ t: "ok", ...info });
          set({ status: "connected", phone: String(m.name || "Your phone").slice(0, 40) });
          pump();
          return;
        }
        if (conn !== c || isBinary(m) || !m) return;
        if (m.t === "ack") acked();
        else if (m.t === "bye") c.close();
        else call("remote_input", { event: m }).catch(() => {});
      });
      const closed = () => {
        clearTimeout(timer);
        if (conn === c) { conn = null; awaiting = false; set({ status: peer && peer.open ? "ready" : "starting", phone: null }); }
      };
      c.on("close", closed); c.on("error", closed);
      c.on("iceStateChanged", s => { if (s === "failed" || s === "closed") { closed(); try { c.close(); } catch (e) {} } });
    }

    function retry(ms) {
      if (stopped) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(start, ms);
    }
    async function start() {
      if (stopped) return;
      try { await load(); } catch (e) { set({ status: "offline", error: e.message }); return retry(8000); }
      if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
      const id = await idFor(code);
      const p = peer = new window.Peer(id, options());
      p.on("open", () => { if (p !== peer) return; fails = 0; set({ status: conn ? "connected" : "ready", error: "" }); });
      p.on("connection", onConnection);
      p.on("disconnected", () => { if (p !== peer || stopped) return; set({ status: conn ? "connected" : "offline" }); setTimeout(() => { if (p === peer && !p.destroyed && p.disconnected) p.reconnect(); }, 2000); });
      p.on("error", e => {
        if (p !== peer || stopped) return;
        const t = e && e.type;
        if (t === "peer-unavailable") return;
        fails++;
        if (t === "browser-incompatible") return set({ status: "offline", error: "This version of Windows can't make the connection. Update Microsoft Edge WebView2." });
        // the server may still remember this PC from a moment ago (after a restart): try again shortly
        set({ status: conn ? "connected" : "offline", error: t === "unavailable-id" ? "" : "No internet right now. Trying again…" });
        retry(Math.min(30000, 2000 * fails));
      });
    }
    // Windows may let Windmill's window doze behind your apps; Windmill wakes it every few seconds
    function tick() {
      if (stopped) return;
      if (!peer || peer.destroyed) return start();
      if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} return; }
      try { peer.socket.send({ type: "HEARTBEAT" }); } catch (e) {}
      if (awaiting && performance.now() - sentAt > 6000) { awaiting = false; pump(); }
    }

    start();
    return {
      get state() { return { ...state }; },
      tick,
      kick() { if (conn) { try { conn.send({ t: "error", why: "Your PC ended the session." }); } catch (e) {} const c = conn; setTimeout(() => c.close(), 300); } },
      stop() {
        stopped = true; clearTimeout(retryTimer);
        if (conn) { try { conn.send({ t: "error", why: "Your PC turned off phone access." }); } catch (e) {} }
        const p = peer, c = conn; conn = null; peer = null;
        setTimeout(() => { try { c && c.close(); } catch (e) {} try { p && p.destroy(); } catch (e) {} }, 300);
        set({ status: "off", phone: null, error: "" });
      },
    };
  }

  // ---------- on the phone: reach your PC ----------
  function join(code, { name, onOk, onFrame, onError, onClose }) {
    code = normCode(code);
    let peer = null, conn = null, done = false, inSession = false;
    const cleanup = () => { try { conn && conn.close(); } catch (e) {} try { peer && peer.destroy(); } catch (e) {} };
    const fail = msg => { if (done) return; done = true; clearTimeout(timer); if (inSession) { inSession = false; onClose && onClose(msg); } else onError && onError(msg); setTimeout(cleanup, 200); };
    const timer = setTimeout(() => fail("Couldn't reach your PC. Check that Windmill is open on it, and that Let my phone connect is on."), 25000);
    (async () => {
      try { await load(); } catch (e) { return fail("Couldn't load the connection. Check your internet."); }
      if (done) return;
      peer = new window.Peer(options());
      peer.on("open", async () => {
        if (done) return;
        conn = peer.connect(await idFor(code), { reliable: true });
        conn.on("open", () => conn.send({ t: "hello", code, name }));
        conn.on("data", m => {
          if (isBinary(m)) { if (inSession) onFrame(m); return; }
          if (!m) return;
          if (m.t === "ok") { clearTimeout(timer); inSession = true; onOk && onOk(m); }
          else if (m.t === "error") fail(m.why || "Your PC said no.");
        });
        conn.on("close", () => fail(inSession ? "Disconnected from your PC." : "Couldn't reach your PC."));
        conn.on("error", () => fail(inSession ? "Disconnected from your PC." : "Couldn't connect to your PC."));
        conn.on("iceStateChanged", s => { if (s === "failed") fail(inSession ? "The connection dropped." : "Your network blocked the connection. Try mobile data or another Wi-Fi."); });
      });
      peer.on("error", e => {
        const t = e && e.type;
        if (t === "peer-unavailable") fail("Couldn't find your PC with that code. Check the code, and that Let my phone connect is on.");
        else if (t === "network" || t === "server-error" || t === "socket-error" || t === "socket-closed") fail(inSession ? "The connection dropped." : "Couldn't reach the internet. Check your connection.");
        else if (t === "browser-incompatible") fail("This phone's browser can't make the connection.");
        else if (!inSession) fail("Couldn't connect to your PC.");
      });
      peer.on("disconnected", () => { if (!done && peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} } });   // the server link only; the PC link keeps going
    })();
    return {
      send(o) { if (conn && conn.open) conn.send(o); },
      close() { if (conn && conn.open) { try { conn.send({ t: "bye" }); } catch (e) {} } done = true; clearTimeout(timer); inSession = false; setTimeout(cleanup, 150); },
    };
  }

  window.WindmillLink = { ALPHABET, CODE_LEN, normCode, showCode, newCode, idFor, load, host, join };
})();
