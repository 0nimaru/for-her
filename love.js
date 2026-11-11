(() => {
  "use strict";

  const FN = "https://qjlnulbynqmhhoehbwrw.supabase.co/functions/v1/love-notes";
  const KEY_STORE = "love-sender-key";     // Andi's passcode (his phone only)
  const ANDI_SUB = "love-andi-sub";        // his phone gets "she shared" notifications
  const DEV_STORE = "love-device";         // her phone's random device secret
  const SEEN_STORE = "love-inbox-seen";    // newest note she has seen
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
  const MOODS = [
    ["happy", "😊", "happy"], ["loved", "🥰", "loved"], ["calm", "😌", "calm"], ["tired", "😴", "tired"],
    ["sad", "😔", "sad"], ["upset", "😤", "upset"], ["anxious", "😰", "anxious"], ["hug", "🫂", "need a hug"],
    ["missing", "🥺", "missing you"],
  ];
  const MOOD_EMOJI = Object.fromEntries(MOODS.map(([k, e]) => [k, e]));

  const $ = (s) => document.querySelector(s);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const swOk = pushSupported && (location.protocol === "https:" || location.hostname === "localhost");
  const reg = swOk ? navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready) : null;
  const say = (mood, text) => window.dispatchEvent(new CustomEvent("hyena:say", { detail: { mood, say: text } }));
  const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  async function api(action, extra = {}) {
    const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "HTTP " + r.status), { status: r.status, data: j });
    return j;
  }
  const b64ToBytes = (s) => {
    const raw = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 172800) return "yesterday";
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " +
      new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function hearts(x, y) {
    const colors = ["#e0566b", "#f29a95", "#cc887c", "#f6c1b6", "#d47a8a"];
    for (let k = 0; k < 16; k++) {
      const h = el("span", "heart", "♥");
      const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 100;
      h.style.cssText = `z-index:220;left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--hs:${14 + Math.random() * 14}px;--hc:${colors[k % 5]};--hr:${Math.random() * 90 - 45}deg`;
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 1300);
    }
  }
  const centerOf = (n) => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

  /* ---------- bottom sheets ---------- */
  function openSheet(sheet) {
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add("show"));
  }
  function closeSheet(sheet) {
    sheet.classList.remove("show");
    setTimeout(() => (sheet.hidden = true), 300);
  }
  document.querySelectorAll(".sender").forEach((sheet) => {
    sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.closest("[data-close]")) closeSheet(sheet); });
  });

  /* ---------- push subscription helper ---------- */
  let subscribing = false;
  async function pushSubscription() {
    if (subscribing) return null;
    subscribing = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return null;
      const r = await reg;
      const { publicKey } = await api("vapid");
      const want = b64ToBytes(publicKey);
      let sub = await r.pushManager.getSubscription();
      if (sub) {
        const cur = sub.options && sub.options.applicationServerKey;
        const same = cur && new Uint8Array(cur).every((b, i) => b === want[i]);
        if (!same) { await sub.unsubscribe(); sub = null; }
      }
      return sub || (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want }));
    } finally {
      subscribing = false;
    }
  }
  async function currentSub() {
    if (!swOk) return null;
    try { return await (await reg).pushManager.getSubscription(); } catch (e) { return null; }
  }

  /* =====================================================================
     HER SIDE: notification center + feelings jar
     ===================================================================== */
  const jarBtn = $("#jarBtn"), inboxBtn = $("#inboxBtn"), badge = $("#inboxBadge");
  let herName = "";
  let approved = null;              // null = unknown, false = waiting for Andi, true = ok
  let secret = read(DEV_STORE);
  if (!secret) {
    const a = new Uint8Array(32);
    crypto.getRandomValues(a);
    secret = [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
    write(DEV_STORE, secret);
  }

  let registering = null;
  function register() {
    if (!herName) return Promise.resolve();
    if (registering) return registering;
    registering = (async () => {
      try {
        const sub = await currentSub();
        const r = await api("register", { secret, label: herName, endpoint: sub ? sub.endpoint : undefined });
        approved = !!r.approved;
        if (sub && Notification.permission === "granted") api("subscribe", { secret, subscription: sub.toJSON() }).catch(() => {});
        if (approved) await loadInbox(true);
      } catch (e) { /* offline: try again next time */ }
      registering = null;
    })();
    return registering;
  }

  /* ----- inbox (notes from Andi) ----- */
  const inbox = $("#inbox"), inboxList = $("#inboxList"), inboxMore = $("#inboxMore");
  let notes = [], notesDone = false, showAll = false, seenAtOpen = "";

  async function loadInbox(reset) {
    const before = reset || !notes.length ? undefined : notes[notes.length - 1].sent_at;
    const r = await api("inbox", { secret, limit: 20, before });
    if (r.pending) { approved = false; notes = []; renderInbox(); return; }
    approved = true;
    notes = reset ? r.notes : notes.concat(r.notes);
    notesDone = r.notes.length < 20;
    paintBadge();
    if (!inbox.hidden) renderInbox();
  }
  function paintBadge() {
    const seen = read(SEEN_STORE) || "";
    const unread = notes.filter((n) => n.sent_at > seen).length;
    badge.hidden = !unread;
    badge.textContent = unread > 9 ? "9+" : String(unread);
    inboxBtn.classList.toggle("ring", !!unread);
  }
  function renderInbox() {
    inboxList.innerHTML = "";
    inboxMore.hidden = true;
    if (approved === false) {
      inboxList.appendChild(el("div", "empty-note", "Waiting for Andi to confirm this phone is yours ♡ He just got a little request."));
      return;
    }
    if (approved === null) { inboxList.appendChild(el("div", "empty-note", "loading…")); return; }
    if (!notes.length) { inboxList.appendChild(el("div", "empty-note", "No notes yet… he'll write soon ♡")); return; }
    const list = showAll ? notes : notes.slice(0, 5);
    for (const n of list) {
      const card = el("article", "note-card" + (n.sent_at > seenAtOpen ? " unread" : ""));
      card.append(el("p", "", n.body), el("small", "", ago(n.sent_at)));
      inboxList.appendChild(card);
    }
    if (!showAll && notes.length > 5) { inboxMore.hidden = false; inboxMore.textContent = `show all (${notesDone ? notes.length : notes.length + "+"})`; }
    else if (showAll && !notesDone) { inboxMore.hidden = false; inboxMore.textContent = "show older"; }
  }
  inboxMore.addEventListener("click", async () => {
    if (!showAll) { showAll = true; renderInbox(); return; }
    inboxMore.disabled = true;
    try { await loadInbox(false); } finally { inboxMore.disabled = false; }
  });

  async function paintPushBanner() {
    const box = $("#inboxPush"), text = $("#inboxPushText"), b = $("#inboxPushBtn");
    b.hidden = true;
    b.onclick = null;
    const show = (msg, label, fn) => { box.hidden = false; text.textContent = msg; if (label) { b.hidden = false; b.textContent = label; b.onclick = fn; } };
    if (isIOS && !standalone) {
      return show("Add me to your Home Screen so his notes pop up on your phone 📲", "show me how", () => { closeSheet(inbox); window.openA2HSGuide && window.openA2HSGuide(); });
    }
    if (!swOk) return show("This browser can't show pop-up notifications, but his notes will always be here ♡");
    if (Notification.permission === "denied") return show("Pop-ups are blocked. Allow notifications for this app in your phone's Settings, then come back ♡");
    const sub = await currentSub();
    if (sub && Notification.permission === "granted") { box.hidden = true; return; }
    show("Turn on notifications so his notes pop up on your phone ♡", "turn on", enablePush);
  }
  async function enablePush() {
    try {
      const sub = await pushSubscription();
      if (!sub) { say("sad", "aww, okay…"); return; }
      await api("subscribe", { secret, subscription: sub.toJSON() });
      hearts(...centerOf($("#inboxPushBtn")));
      say("love", "now his notes will pop up!");
    } catch (e) {
      $("#inboxPushText").textContent = "Couldn't turn them on, try again in a moment ♡";
    }
    paintPushBanner();
  }

  async function openInbox() {
    seenAtOpen = read(SEEN_STORE) || "";
    showAll = false;
    renderInbox();
    paintPushBanner();
    openSheet(inbox);
    if (approved === null) await register(); else loadInbox(true).catch(() => {});
    renderInbox();
    if (notes.length) write(SEEN_STORE, notes[0].sent_at);
    paintBadge();
  }
  inboxBtn.addEventListener("click", openInbox);

  /* ----- feelings jar ----- */
  const jar = $("#jar"), moodsEl = $("#moods"), jarText = $("#jarText"), share = $("#jarShare");
  const sendBtn = $("#jarSend"), jarStatus = $("#jarStatus");
  let mood = null;
  MOODS.forEach(([key, emoji, label]) => {
    const b = el("button", "mood");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    b.dataset.mood = key;
    b.append(el("span", "", emoji), document.createTextNode(label));
    b.addEventListener("click", () => {
      mood = mood === key ? null : key;
      moodsEl.querySelectorAll(".mood").forEach((m) => m.setAttribute("aria-checked", String(m.dataset.mood === mood)));
    });
    moodsEl.appendChild(b);
  });
  function paintShare() {
    $("#jarShareHint").textContent = share.checked
      ? "he gets it with your mood. Nothing stays on your phone."
      : "just for you: it's released, not saved or sent anywhere.";
    sendBtn.textContent = share.checked ? "Send to Andi ♡" : "Let it go 🫧";
  }
  share.addEventListener("change", paintShare);
  paintShare();

  // voice memo (browser's own recorder, free)
  const voice = $("#voice"), recBtn = $("#recBtn"), recLive = $("#recLive"), recPreview = $("#recPreview"), recAudio = $("#recAudio");
  const MAX_SECONDS = 180;
  let recorder = null, chunks = [], recStart = 0, recTimer = null, audioBlob = null, audioSecs = 0, audioUrl = null;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) voice.hidden = true;

  function pickMime() {
    const options = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    return options.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || "";
  }
  recBtn.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recTimer);
        audioSecs = Math.round((Date.now() - recStart) / 1000);
        audioBlob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = URL.createObjectURL(audioBlob);
        recAudio.src = audioUrl;
        recLive.hidden = true;
        recPreview.hidden = false;
      };
      recorder.start(250);
      recStart = Date.now();
      $("#recTime").textContent = "0:00";
      recTimer = setInterval(() => {
        const s = (Date.now() - recStart) / 1000;
        $("#recTime").textContent = mmss(s);
        if (s >= MAX_SECONDS && recorder.state === "recording") recorder.stop();
      }, 250);
      recBtn.hidden = true;
      recLive.hidden = false;
      say("shy", "i'm listening ♡");
    } catch (e) {
      jarStatus.className = "sender-status err";
      jarStatus.textContent = "Couldn't use the microphone. Allow it for this site and try again.";
    }
  });
  $("#recStop").addEventListener("click", () => { if (recorder && recorder.state === "recording") recorder.stop(); });
  function clearAudio() {
    if (recorder && recorder.state === "recording") { recorder.onstop = null; recorder.stop(); recorder.stream.getTracks().forEach((t) => t.stop()); clearInterval(recTimer); }
    audioBlob = null;
    audioSecs = 0;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    recAudio.removeAttribute("src");
    recPreview.hidden = true;
    recLive.hidden = true;
    recBtn.hidden = false;
  }
  $("#recDelete").addEventListener("click", clearAudio);

  function resetJar() {
    mood = null;
    moodsEl.querySelectorAll(".mood").forEach((m) => m.setAttribute("aria-checked", "false"));
    jarText.value = "";
    clearAudio();
    share.checked = true;
    paintShare();
  }

  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1] || "");
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }

  // a little paper note flies into the jar
  function flyIntoJar(bubbles) {
    const art = $("#jarArt");
    const [tx, ty] = centerOf(art);
    const [sx, sy] = centerOf(jarText);
    const n = el("div", bubbles ? "bubble-pop" : "fly-note");
    const size = bubbles ? 40 : 60;
    n.style.left = sx - size / 2 + "px";
    n.style.top = sy - 22 + "px";
    if (bubbles) { n.style.width = n.style.height = size + "px"; }
    document.body.appendChild(n);
    const anim = bubbles
      ? [{ transform: "translate(0,0) scale(.6)", opacity: 1 }, { transform: `translate(${(Math.random() - 0.5) * 80}px, ${-sy + 40}px) scale(1.4)`, opacity: 0 }]
      : [{ transform: "translate(0,0) rotate(0) scale(1)", opacity: 1 }, { transform: `translate(${tx - sx}px, ${ty - sy - 30}px) rotate(-200deg) scale(.6)`, opacity: 1, offset: 0.7 }, { transform: `translate(${tx - sx}px, ${ty - sy + 10}px) rotate(-260deg) scale(.2)`, opacity: 0 }];
    n.animate(anim, { duration: bubbles ? 1400 : 900, easing: "cubic-bezier(.4,.1,.3,1)" }).onfinish = () => {
      n.remove();
      if (!bubbles) { art.classList.remove("gulp"); void art.getBBox(); art.classList.add("gulp"); }
    };
  }

  let sending = false;
  sendBtn.addEventListener("click", async () => {
    if (sending) return;
    if (recorder && recorder.state === "recording") { recorder.stop(); await new Promise((r) => setTimeout(r, 300)); }
    const text = jarText.value.trim();
    const status = (msg, kind = "") => { jarStatus.textContent = msg; jarStatus.className = "sender-status " + kind; };
    if (!text && !audioBlob && !mood) { status("Pick a mood, write or record something first ♡", "err"); return; }

    if (!share.checked) {
      // Not shared: nothing leaves this phone and nothing is kept.
      for (let i = 0; i < 6; i++) setTimeout(() => flyIntoJar(true), i * 120);
      resetJar();
      status("Released ♡ It wasn't saved or sent anywhere.", "ok");
      say("happy", "feels lighter, right?");
      return;
    }

    if (approved !== true) await register();
    if (approved === false) { status("Andi needs to approve this phone first ♡ He just got a request.", "err"); return; }

    sending = true;
    sendBtn.disabled = true;
    status("sending…");
    try {
      const payload = { secret, mood, text };
      if (audioBlob) {
        if (audioBlob.size > 6 * 1024 * 1024) throw new Error("That voice memo is too long, try a shorter one ♡");
        payload.audio = await blobToBase64(audioBlob);
        payload.mime = audioBlob.type;
        payload.seconds = audioSecs;
      }
      await api("feel", payload);
      flyIntoJar(false);
      resetJar();
      status("Sent to Andi ♡ Nothing was kept on your phone.", "ok");
      hearts(...centerOf(sendBtn));
      say("love", "he'll get it ♡");
    } catch (e) {
      if (e.data && e.data.pending) { approved = false; status("Andi needs to approve this phone first ♡", "err"); }
      else status(e.message && !/^HTTP/.test(e.message) ? e.message : "Couldn't send it right now, try again in a bit ♡", "err");
    } finally {
      sending = false;
      sendBtn.disabled = false;
    }
  });

  jarBtn.addEventListener("click", () => {
    jarStatus.textContent = "";
    openSheet(jar);
    if (approved === null) register();
  });

  function setHer(n) {
    herName = n || "";
    jarBtn.hidden = inboxBtn.hidden = !herName;
    if (herName) register();
  }
  window.addEventListener("postcards:name", (e) => { if ((e.detail || "") !== herName) setHer(e.detail); });
  try { setHer((JSON.parse(localStorage.getItem("postcards-v1") || "null") || {}).name); } catch (e) {}

  /* =====================================================================
     ANDI'S PANEL: send / from her / phones
     ===================================================================== */
  const sender = $("#sender"), notesEl = $("#notes"), own = $("#ownNote"), notifyBtn = $("#notifyBtn");
  const statusEl = $("#senderStatus"), keyBox = $("#senderKey"), keyInput = $("#senderKeyInput");
  const keyLabel = $("#senderKeyLabel"), keyHint = $("#senderKeyHint"), sub = $("#senderSub");
  let chosen = null, claimed = true, keyOk = false, tab = "send";
  let feelings = [], feelDone = false;
  const myKey = () => read(KEY_STORE);

  NOTES.forEach((t, i) => {
    const b = el("button", "note");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    b.append(el("span", "dot", "✓"), el("span", "", t));
    b.addEventListener("click", () => {
      chosen = chosen === i ? null : i;
      if (chosen !== null) { own.value = ""; ownCount(); }
      [...notesEl.children].forEach((x, j) => x.setAttribute("aria-checked", String(j === chosen)));
    });
    notesEl.appendChild(b);
  });
  function ownCount() { $("#ownCount").textContent = own.value ? `${own.value.length} / 300` : ""; }
  own.addEventListener("input", () => {
    if (own.value.trim() && chosen !== null) { chosen = null; [...notesEl.children].forEach((x) => x.setAttribute("aria-checked", "false")); }
    ownCount();
  });

  function status(text, kind = "") { statusEl.textContent = text; statusEl.className = "sender-status " + kind; }
  const devicesText = (n) => n === 0 ? "no phones have love notes on yet" : `${n} phone${n > 1 ? "s" : ""} will get your note ♡`;
  function counts(s) {
    const hc = $("#herCount"), dc = $("#devCount");
    hc.hidden = !s.unseen; hc.textContent = s.unseen;
    dc.hidden = !s.pending; dc.textContent = s.pending;
  }

  function paintKeyBox() {
    keyBox.hidden = keyOk;
    if (!claimed) {
      keyLabel.textContent = "Create your passcode";
      keyHint.textContent = "First time only. Pick 6+ characters you'll remember. Nobody else can send notes or see her feelings without it.";
      keyInput.autocomplete = "new-password";
    } else {
      keyLabel.textContent = "Your passcode";
      keyHint.textContent = "Enter it once on this phone and it'll be remembered.";
      keyInput.autocomplete = "current-password";
    }
  }
  async function refreshStatus() {
    const s = await api("status", myKey() ? { key: myKey() } : {});
    claimed = s.claimed;
    keyOk = !!s.keyOk;
    if (!keyOk && myKey()) write(KEY_STORE, null);
    paintKeyBox();
    if (keyOk) { sub.textContent = devicesText(s.devices); counts(s); }
    return s;
  }

  async function unlock(key) {
    if (!key || key.length < 6) { status("Your passcode needs 6+ characters.", "err"); keyInput.focus(); return false; }
    if (!claimed) { await api("claim", { key }); claimed = true; }
    const s = await api("status", { key });
    if (!s.keyOk) { status("Wrong passcode 🙈", "err"); return false; }
    write(KEY_STORE, key);
    keyInput.value = "";
    status("");
    await refreshStatus();
    return true;
  }
  $("#keyUnlock").addEventListener("click", async () => {
    try { if (await unlock(keyInput.value)) selectTab(tab); }
    catch (e) { status(e.status === 409 ? "A passcode is already set, enter that one." : "Couldn't check it: " + e.message, "err"); claimed = true; paintKeyBox(); }
  });

  function selectTab(t) {
    tab = t;
    document.querySelectorAll(".ptab").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    document.querySelectorAll(".pane").forEach((p) => (p.hidden = p.dataset.pane !== t));
    status("");
    if (t !== "send" && !keyOk) { status("Enter your passcode above to see this ♡"); return; }
    if (t === "her") loadFeelings(true);
    if (t === "devices") loadDevices();
  }
  document.querySelectorAll(".ptab").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));

  async function openSender(t = "send") {
    openSheet(sender);
    status("");
    sub.textContent = "pick a love note, or write your own";
    selectTabUI(t);
    try { await refreshStatus(); } catch (e) { status("Couldn't reach the server, check your internet.", "err"); return; }
    selectTab(t);
  }
  function selectTabUI(t) {
    tab = t;
    document.querySelectorAll(".ptab").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    document.querySelectorAll(".pane").forEach((p) => (p.hidden = p.dataset.pane !== t));
  }
  window.addEventListener("love:sender", () => openSender("send"));

  // send a love note
  notifyBtn.addEventListener("click", async () => {
    const text = own.value.trim() || (chosen !== null ? NOTES[chosen] : "");
    if (!text) { status("Pick a note or write one first ♡", "err"); return; }
    if (!keyOk) {
      try { if (!(await unlock(keyInput.value))) return; }
      catch (e) { status(e.status === 409 ? "A passcode is already set, enter that one." : "Couldn't check it: " + e.message, "err"); return; }
    }
    notifyBtn.disabled = true;
    status("sending…");
    try {
      const r = await api("notify", { key: myKey(), body: text });
      sub.textContent = devicesText(r.sent);
      if (r.sent > 0) {
        status(`Sent to ${r.sent} phone${r.sent > 1 ? "s" : ""} 💌`, "ok");
        hearts(...centerOf(notifyBtn));
        own.value = ""; ownCount(); chosen = null;
        [...notesEl.children].forEach((x) => x.setAttribute("aria-checked", "false"));
      } else if (r.devices === 0) {
        status("Her phone hasn't turned on notifications yet. It's saved in her 🔔 inbox though ♡", "err");
      } else {
        status("Couldn't deliver the pop-up right now. It's saved in her 🔔 inbox ♡", "err");
      }
    } catch (e) {
      if (e.status === 403) { write(KEY_STORE, null); keyOk = false; paintKeyBox(); status("Wrong passcode 🙈", "err"); }
      else status("Couldn't send: " + e.message, "err");
    } finally {
      notifyBtn.disabled = false;
    }
  });

  // ----- from her -----
  const feelList = $("#feelList"), feelMore = $("#feelMore");
  async function paintAndiPush() {
    const box = $("#andiPush"), text = $("#andiPushText"), b = $("#andiPushBtn");
    b.hidden = true;
    box.hidden = false;
    if (!swOk) { text.textContent = isIOS && !standalone ? "Add this site to your Home Screen to get a notification when she shares." : "This browser can't show notifications."; return; }
    const s = await currentSub();
    if (s && Notification.permission === "granted" && read(ANDI_SUB) === s.endpoint) { text.textContent = "🔔 You'll get a notification when she shares something."; return; }
    if (Notification.permission === "denied") { text.textContent = "Notifications are blocked for this site on your phone."; return; }
    text.textContent = "Get a notification when she shares a feeling?";
    b.hidden = false;
    b.textContent = "notify me";
    b.onclick = async () => {
      try {
        const sb = await pushSubscription();
        if (!sb) return;
        await api("andi_subscribe", { key: myKey(), subscription: sb.toJSON() });
        write(ANDI_SUB, sb.endpoint);
        hearts(...centerOf(b));
      } catch (e) { text.textContent = "Couldn't turn them on: " + e.message; }
      paintAndiPush();
    };
  }

  async function loadFeelings(reset) {
    paintAndiPush();
    if (reset) { feelings = []; feelList.innerHTML = ""; feelList.appendChild(el("div", "empty-note", "loading…")); }
    try {
      const before = reset || !feelings.length ? undefined : feelings[feelings.length - 1].created_at;
      const r = await api("feelings", { key: myKey(), before });
      feelings = reset ? r.feelings : feelings.concat(r.feelings);
      feelDone = r.feelings.length < 30;
      renderFeelings();
      if (feelings.some((f) => !f.seen)) {
        api("feelings_seen", { key: myKey() }).then(() => { $("#herCount").hidden = true; }).catch(() => {});
      }
    } catch (e) { feelList.innerHTML = ""; feelList.appendChild(el("div", "empty-note", "Couldn't load right now.")); }
  }
  function renderFeelings() {
    feelList.innerHTML = "";
    feelMore.hidden = feelDone;
    if (!feelings.length) { feelList.appendChild(el("div", "empty-note", "Nothing yet. When she shares from her feelings jar, it shows up here ♡")); return; }
    for (const f of feelings) {
      const card = el("article", "feel" + (f.seen ? "" : " new"));
      const head = el("div", "feel-head");
      head.append(el("span", "feel-mood", f.mood ? MOOD_EMOJI[f.mood] || "💭" : "💭"));
      const who = el("div", "feel-who");
      who.append(el("b", "", f.moodLabel ? f.moodLabel.replace(/^\S+\s/, "") : "a feeling"), el("small", "", `${f.author || "her"} · ${ago(f.created_at)}`));
      head.appendChild(who);
      if (!f.seen) head.appendChild(el("span", "feel-new", "new"));
      card.appendChild(head);
      const del = el("button", "feel-del", "🗑");
      if (f.body) card.appendChild(el("p", "feel-body", f.body));
      if (f.audio) {
        const box = el("div", "feel-audio");
        const play = el("button", "play-btn", `▶ play voice memo${f.seconds ? ` (${mmss(f.seconds)})` : ""}`);
        play.type = "button";
        play.addEventListener("click", async () => {
          play.disabled = true;
          play.textContent = "loading…";
          try {
            const { url } = await api("feeling_audio", { key: myKey(), id: f.id });
            const a = document.createElement("audio");
            a.controls = true;
            a.src = url;
            box.replaceChildren(a);
            a.play().catch(() => {});
          } catch (e) { play.disabled = false; play.textContent = "couldn't load, tap to retry"; }
        });
        box.appendChild(play);
        card.appendChild(box);
      }
      del.type = "button";
      del.setAttribute("aria-label", "Delete");
      del.addEventListener("click", async () => {
        if (!confirm("Delete this for good?")) return;
        try { await api("feeling_delete", { key: myKey(), id: f.id }); feelings = feelings.filter((x) => x.id !== f.id); renderFeelings(); }
        catch (e) { status("Couldn't delete: " + e.message, "err"); }
      });
      head.appendChild(del);
      feelList.appendChild(card);
    }
  }
  feelMore.addEventListener("click", () => loadFeelings(false));

  // ----- phones -----
  async function loadDevices() {
    const list = $("#devList");
    list.innerHTML = "";
    list.appendChild(el("div", "empty-note", "loading…"));
    try {
      const { devices } = await api("devices", { key: myKey() });
      list.innerHTML = "";
      if (!devices.length) { list.appendChild(el("div", "empty-note", "No phones yet. Hers shows up after she opens the site ♡")); return; }
      let pending = 0;
      for (const d of devices) {
        if (!d.approved) pending++;
        const row = el("div", "dev" + (d.approved ? "" : " waiting"));
        const info = el("div", "dev-info");
        const name = el("b", "", d.label || "unknown");
        name.appendChild(el("span", "pill " + (d.approved ? "ok" : "wait"), d.approved ? "approved" : "waiting"));
        info.append(name, el("small", "", d.ua || ""), el("small", "", `added ${ago(d.created_at)} · seen ${ago(d.last_seen)} · ${d.notifications ? "🔔 on" : "🔕 off"}`));
        const actions = el("div", "dev-actions");
        if (!d.approved) {
          const ok = el("button", "btn small", "approve ✓");
          ok.type = "button";
          ok.addEventListener("click", async () => { await api("device_approve", { key: myKey(), id: d.id }).catch(() => {}); loadDevices(); refreshStatus().catch(() => {}); });
          actions.appendChild(ok);
        }
        const rm = el("button", "btn ghost small", "remove");
        rm.type = "button";
        rm.addEventListener("click", async () => {
          if (!confirm(`Remove “${d.label || "this phone"}”? It won't get your notes anymore.`)) return;
          await api("device_remove", { key: myKey(), id: d.id }).catch(() => {});
          loadDevices();
          refreshStatus().catch(() => {});
        });
        actions.appendChild(rm);
        row.append(info, actions);
        list.appendChild(row);
      }
      const dc = $("#devCount");
      dc.hidden = !pending;
      dc.textContent = pending;
    } catch (e) { list.innerHTML = ""; list.appendChild(el("div", "empty-note", "Couldn't load right now.")); }
  }

  /* =====================================================================
     deep links from notifications (?inbox, ?panel=her|devices)
     ===================================================================== */
  function handleLink(href) {
    const u = new URL(href, location.href);
    if (u.searchParams.has("inbox") && herName) openInbox();
    const p = u.searchParams.get("panel");
    if (p && myKey()) openSender(["send", "her", "devices"].includes(p) ? p : "send");
    if (u.searchParams.has("inbox") || p) history.replaceState(null, "", location.pathname);
  }
  handleLink(location.href);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "open" && e.data.url) handleLink(e.data.url);
    });
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && herName && approved) loadInbox(true).catch(() => {}); });
})();
