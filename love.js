(() => {
  "use strict";

  const FN = "https://qjlnulbynqmhhoehbwrw.supabase.co/functions/v1/love-notes";
  const KEY_STORE = "love-sender-key";
  const NOTES = [
    "Good morning, beautiful ☀️ I hope your day is as lovely as you",
    "I'm thinking about you right now 💭",
    "I miss you so much 🥺",
    "You're my favorite person in the whole world 💗",
    "Sorry for being distant. I'm here, and I'm not going anywhere ♡",
    "Check the website, I left you a little surprise 🎁",
    "You looked so pretty today (like always) 🌸",
    "Can't wait to see you 😍",
    "Good night, my love 🌙 sweet dreams",
    "I love you ❤️",
  ];

  const $ = (s) => document.querySelector(s);
  const bell = $("#bellBtn"), tip = $("#loveTip");
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const say = (mood, text) => window.dispatchEvent(new CustomEvent("hyena:say", { detail: { mood, say: text } }));
  const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  async function api(action, extra = {}) {
    const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "HTTP " + r.status), { status: r.status });
    return j;
  }

  const swOk = pushSupported && (location.protocol === "https:" || location.hostname === "localhost");
  const reg = swOk ? navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready) : null;

  const b64ToBytes = (s) => {
    const raw = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };

  function hearts(x, y) {
    const colors = ["#e0566b", "#f29a95", "#cc887c", "#f6c1b6", "#d47a8a"];
    for (let k = 0; k < 16; k++) {
      const h = document.createElement("span");
      h.className = "heart";
      h.textContent = "♥";
      const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 100;
      h.style.cssText = `z-index:120;left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--hs:${14 + Math.random() * 14}px;--hc:${colors[k % 5]};--hr:${Math.random() * 90 - 45}deg`;
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 1300);
    }
  }

  /* ================= her side: turn on love notes ================= */
  let herName = "";
  let tipTimer;
  function showTip(html, ms = 9000) {
    tip.innerHTML = html;
    tip.hidden = false;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => (tip.hidden = true), ms);
  }
  tip.addEventListener("click", () => (tip.hidden = true));

  async function refreshBell() {
    if (!herName) { bell.hidden = true; return; }
    if (!pushSupported || !swOk) { bell.hidden = false; return; }   // will explain "Add to Home Screen"
    try {
      const r = await reg;
      const sub = await r.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") {
        bell.hidden = true;
        api("subscribe", { subscription: sub.toJSON(), label: herName }).catch(() => {}); // keep server copy fresh
      } else {
        bell.hidden = false;
      }
    } catch (e) { bell.hidden = false; }
  }

  bell.addEventListener("click", async () => {
    if (!pushSupported || !swOk) {
      if (isIOS && !standalone) {
        showTip(`<b>Get love notes from him 💌</b><ol><li>Tap <b>Share</b> ⬆︎ in Safari</li><li>Choose <b>Add to Home Screen</b></li><li>Open it from your Home Screen and tap <b>🔔 love notes</b> there</li></ol>`, 14000);
        say("shy", "home screen first ♡");
      } else {
        showTip("This browser can't receive notifications 😢 Try Chrome on Android or Safari on iPhone.");
      }
      return;
    }
    if (Notification.permission === "denied") {
      showTip("Notifications are turned off for this app. Turn them on in your phone's <b>Settings → Notifications</b>, then tap 🔔 again.");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { say("sad", "aww, okay…"); return; }
      const r = await reg;
      const { publicKey } = await api("vapid");
      let sub = await r.pushManager.getSubscription();
      if (sub) {
        const cur = sub.options && sub.options.applicationServerKey;
        const want = b64ToBytes(publicKey);
        const same = cur && new Uint8Array(cur).every((b, i) => b === want[i]);
        if (!same) { await sub.unsubscribe(); sub = null; }
      }
      if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api("subscribe", { subscription: sub.toJSON(), label: herName });
      const rect = bell.getBoundingClientRect();
      hearts(rect.left + rect.width / 2, rect.bottom);
      say("love", "now he can send you love notes!");
      bell.hidden = true;
    } catch (e) {
      showTip("Couldn't turn on love notes, try again in a moment ♡");
    }
  });

  function setHer(n) {
    herName = n || "";
    refreshBell();
  }
  window.addEventListener("postcards:name", (e) => setHer(e.detail));
  try { setHer((JSON.parse(localStorage.getItem("postcards-v1") || "null") || {}).name); } catch (e) {}

  /* ================= his side: the sender panel ================= */
  const sender = $("#sender"), notesEl = $("#notes"), own = $("#ownNote"), btn = $("#notifyBtn");
  const statusEl = $("#senderStatus"), keyBox = $("#senderKey"), keyInput = $("#senderKeyInput");
  const keyLabel = $("#senderKeyLabel"), keyHint = $("#senderKeyHint"), sub = $("#senderSub");
  let chosen = null, claimed = true, keyOk = false;

  NOTES.forEach((t, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "note";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    b.innerHTML = `<span class="dot">✓</span><span></span>`;
    b.lastChild.textContent = t;
    b.addEventListener("click", () => {
      chosen = chosen === i ? null : i;
      if (chosen !== null) { own.value = ""; ownCount(); }
      paintNotes();
    });
    notesEl.appendChild(b);
  });
  function paintNotes() {
    [...notesEl.children].forEach((b, i) => b.setAttribute("aria-checked", String(i === chosen)));
  }
  function ownCount() { $("#ownCount").textContent = own.value ? `${own.value.length} / 300` : ""; }
  own.addEventListener("input", () => {
    if (own.value.trim() && chosen !== null) { chosen = null; paintNotes(); }
    ownCount();
  });

  function status(text, kind = "") { statusEl.textContent = text; statusEl.className = "sender-status " + kind; }
  const devicesText = (n) => n === 0 ? "no phones have love notes on yet" : `${n} phone${n > 1 ? "s" : ""} will get it ♡`;

  async function openSender() {
    sender.hidden = false;
    requestAnimationFrame(() => sender.classList.add("show"));
    status("");
    sub.textContent = "pick a love note, or write your own";
    try {
      const saved = read(KEY_STORE);
      const s = await api("status", saved ? { key: saved } : {});
      claimed = s.claimed;
      keyOk = !!s.keyOk;
      if (!keyOk && saved) write(KEY_STORE, null);
      keyBox.hidden = keyOk;
      if (!claimed) {
        keyLabel.textContent = "Create your sender passcode";
        keyHint.textContent = "First time only. Pick 6+ characters you'll remember. It's the only way to send love notes, so nobody else can send them from this site.";
        keyInput.autocomplete = "new-password";
      } else if (!keyOk) {
        keyLabel.textContent = "Your sender passcode";
        keyHint.textContent = "Enter it once on this phone and it'll be remembered.";
        keyInput.autocomplete = "current-password";
      } else {
        sub.textContent = devicesText(s.devices);
      }
    } catch (e) {
      status("Couldn't reach the love-note server, check your internet.", "err");
    }
  }
  function closeSender() {
    sender.classList.remove("show");
    setTimeout(() => (sender.hidden = true), 300);
  }
  $("#senderClose").addEventListener("click", closeSender);
  sender.addEventListener("click", (e) => { if (e.target === sender) closeSender(); });
  window.addEventListener("love:sender", openSender);

  btn.addEventListener("click", async () => {
    const text = own.value.trim() || (chosen !== null ? NOTES[chosen] : "");
    if (!text) { status("Pick a note or write one first ♡", "err"); return; }
    let key = keyOk ? read(KEY_STORE) : keyInput.value;
    if (!key || key.length < 6) { status("Your passcode needs 6+ characters.", "err"); keyInput.focus(); return; }
    btn.disabled = true;
    status("sending…");
    try {
      if (!claimed) {
        await api("claim", { key });
        claimed = true;
      }
      const r = await api("notify", { key, body: text });
      write(KEY_STORE, key);
      keyOk = true;
      keyBox.hidden = true;
      keyInput.value = "";
      sub.textContent = devicesText(r.devices);
      if (r.sent > 0) {
        status(`Sent to ${r.sent} phone${r.sent > 1 ? "s" : ""} 💌`, "ok");
        const rect = btn.getBoundingClientRect();
        hearts(rect.left + rect.width / 2, rect.top);
        own.value = ""; ownCount(); chosen = null; paintNotes();
      } else if (r.devices === 0) {
        status("Nobody has love notes turned on yet. She needs to tap 🔔 love notes in the app first.", "err");
      } else {
        status("Couldn't deliver it right now, try again in a bit.", "err");
      }
    } catch (e) {
      if (e.status === 403) { write(KEY_STORE, null); keyOk = false; keyBox.hidden = false; status("Wrong passcode 🙈", "err"); }
      else if (e.status === 409) { claimed = true; status("A passcode is already set. Enter that one.", "err"); keyLabel.textContent = "Your sender passcode"; }
      else status("Couldn't send: " + e.message, "err");
    } finally {
      btn.disabled = false;
    }
  });
})();
