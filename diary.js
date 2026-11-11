(() => {
  "use strict";

  const CFG = window.DIARY_CONFIG || {};
  const LS = "diary-v1";
  const LINES = 13, LINE_H = 28, MAX_H = LINES * LINE_H;
  const MAX_PAGES = 40;
  const TAB_COLORS = ["#f6d3cb", "#fbe3c8", "#e6d6ef", "#d9e6cf", "#fde7e1", "#f3cbd3"];

  const $ = (s) => document.querySelector(s);
  const stage = $("#diary"), scaler = $("#dScaler"), book = $("#dBook"), cover = $("#dCover");
  const pageEl = $("#dPage"), ink = $("#ink"), meas = $("#inkMeasure");
  const tabsEl = $("#dTabs"), statusEl = $("#dStatus"), btn = $("#diaryBtn");
  const pDate = $("#pDate"), pYear = $("#pYear"), pNum = $("#pNum"), pPrev = $("#pPrev"), pNext = $("#pNext");
  const pShare = $("#pShare"), pSent = $("#pSent"), scent = $("#dScent");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- local store ---------------- */
  function randHex(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function loadStore() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) {}
    if (!s || typeof s.secret !== "string" || s.secret.length < 32) s = { secret: randHex(32), entries: {} };
    s.entries = s.entries || {};
    return s;
  }
  const store = loadStore();
  function persist() { try { localStorage.setItem(LS, JSON.stringify(store)); } catch (e) {} }
  persist();

  let name = "";
  let curDate = null, text = "", bounds = [{ s: 0, e: 0 }], curPage = 0;
  let isOpen = false, busy = false;

  /* ---------------- dates ---------------- */
  const pad = (n) => String(n).padStart(2, "0");
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const toDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const longDate = (s) => toDate(s).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ---------------- pagination (continuous flow) ---------------- */
  function fitsRaw(str) {
    meas.value = str;
    return meas.scrollHeight <= MAX_H + 1;
  }
  // A page may end with a newline that "belongs" to it without needing an extra line.
  const fits = (str) => fitsRaw(str.endsWith("\n") ? str.slice(0, -1) : str);

  function pageEnd(t, s) {
    const rest = t.slice(s);
    if (fits(rest)) return t.length;
    let lo = 0, hi = rest.length;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (fits(rest.slice(0, m))) lo = m; else hi = m;
    }
    let k = lo;
    const c = rest[k];
    if (c === " " || c === "\n") k += 1;              // swallow the break char
    else {
      const w = Math.max(rest.lastIndexOf(" ", k - 1), rest.lastIndexOf("\n", k - 1));
      if (w >= 0 && w + 1 > k * 0.5) k = w + 1;          // don't split words
    }
    return s + Math.max(1, k);
  }

  function paginate(t, from) {
    from = Math.max(0, Math.min(from || 0, bounds.length - 1));
    const out = bounds.slice(0, from);
    let s = from > 0 ? out[from - 1].e : 0;
    if (s > t.length) { out.length = 0; s = 0; }
    while (s < t.length && out.length < MAX_PAGES) {
      const e = pageEnd(t, s);
      out.push({ s, e });
      s = e;
    }
    if (!out.length) out.push({ s: 0, e: 0 });
    const last = out[out.length - 1];
    const sl = t.slice(last.s, last.e);
    // Enter pressed on the very last line → caret lives on a fresh page.
    if (last.e === t.length && sl.endsWith("\n") && !fitsRaw(sl + "x") && out.length < MAX_PAGES) out.push({ s: t.length, e: t.length });
    return out;
  }
  const visEnd = (i) => { const b = bounds[i]; return b.e - (text.slice(b.s, b.e).endsWith("\n") && i < bounds.length - 1 ? 1 : 0); };
  function locate(g) {
    for (let i = 0; i < bounds.length; i++) if (g >= bounds[i].s && g < bounds[i].e) return i;
    return bounds.length - 1;
  }

  /* ---------------- rendering a page ---------------- */
  function entry(d = curDate) { return store.entries[d] || (store.entries[d] = { body: "" }); }

  function paintHeader() {
    const dt = toDate(curDate);
    pDate.textContent = dt.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    const wd = dt.toLocaleDateString("en-GB", { weekday: "long" });
    pYear.textContent = curDate === todayStr() ? `${wd} · today ♡` : `${wd} · ${dt.getFullYear()}`;
  }

  function showPage(p, g) {
    curPage = Math.max(0, Math.min(p, bounds.length - 1));
    const b = bounds[curPage];
    const sl = text.slice(b.s, b.e);
    if (ink.value !== sl) ink.value = sl;
    ink.placeholder = curPage === 0 ? "Dear diary, today…" : "";
    if (g != null && document.activeElement === ink) {
      const c = Math.max(0, Math.min(sl.length, g - b.s));
      ink.setSelectionRange(c, c);
    }
    ink.scrollTop = 0;
    pNum.textContent = `${curPage + 1} / ${bounds.length}`;
    pPrev.disabled = curPage === 0;
    pNext.disabled = curPage >= bounds.length - 1;
    paintShare();
  }

  function makeFlipper(dir) {
    const face = pageEl.cloneNode(true);
    face.removeAttribute("id");
    face.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    face.querySelector(".measure")?.remove();
    const ta = face.querySelector("textarea.ink");
    const div = document.createElement("div");
    div.className = "ink";
    div.textContent = ink.value;
    ta.replaceWith(div);
    face.classList.add("face");
    const back = document.createElement("div");
    back.className = "face back";
    const f = document.createElement("div");
    f.className = "flipper";
    f.append(face, back);
    if (dir < 0) f.style.transform = "rotateY(-180deg)";
    book.appendChild(f);
    return f;
  }

  function animateFlip(f, dir) {
    const shade = document.createElement("div");
    shade.className = "flip-shade";
    book.appendChild(shade);
    const frames = dir > 0
      ? [{ transform: "rotateY(0deg)" }, { transform: "rotateY(-180deg)", opacity: 0.2 }]
      : [{ transform: "rotateY(-180deg)", opacity: 0.2 }, { transform: "rotateY(0deg)", opacity: 1 }];
    const a = f.animate(frames, { duration: 620, easing: "cubic-bezier(.45,.05,.3,1)", fill: "forwards" });
    shade.animate([{ opacity: dir > 0 ? 1 : 0 }, { opacity: dir > 0 ? 0 : 1 }], { duration: 620, fill: "forwards" });
    a.onfinish = () => { f.remove(); shade.remove(); };
  }

  // Turn to page p of the current day.
  function turnTo(p, dir, g) {
    if (p === curPage || reduced || !isOpen) return showPage(p, g);
    if (dir > 0) {
      showPage(curPage, null);            // old page with its final content
      const f = makeFlipper(1);
      showPage(p, g);
      animateFlip(f, 1);
    } else {
      showPage(p, g);
      animateFlip(makeFlipper(-1), -1);
    }
  }

  /* ---------------- editing ---------------- */
  function setText(newText, from, g) {
    text = newText;
    const before = curPage;
    bounds = paginate(text, from);
    let p = Math.min(curPage, bounds.length - 1);
    const b = bounds[p];
    if (!(g >= b.s && g <= visEnd(p))) p = locate(g);
    if (p !== before) turnTo(p, p > before ? 1 : -1, g);
    else showPage(p, g);
    saveSoon();
  }

  ink.addEventListener("input", () => {
    const b = bounds[curPage];
    const newText = text.slice(0, b.s) + ink.value + text.slice(b.e);
    setText(newText, curPage - 1, b.s + ink.selectionStart);
  });

  // Backspace at the top of a page reaches back into the previous page.
  // (keydown for hardware/iOS keyboards; beforeinput for Android, whose keydown is "Unidentified")
  function backIntoPrevious(e) {
    if (curPage > 0 && ink.selectionStart === 0 && ink.selectionEnd === 0) {
      e.preventDefault();
      const g = bounds[curPage].s;
      if (g > 0) setText(text.slice(0, g - 1) + text.slice(g), curPage - 1, g - 1);
    }
  }
  ink.addEventListener("keydown", (e) => { if (e.key === "Backspace") backIntoPrevious(e); });
  ink.addEventListener("beforeinput", (e) => { if (e.inputType === "deleteContentBackward") backIntoPrevious(e); });

  const caretEnd = () => (document.activeElement === ink ? Infinity : null);
  pPrev.addEventListener("click", () => curPage > 0 && turnTo(curPage - 1, -1, caretEnd()));
  pNext.addEventListener("click", () => curPage < bounds.length - 1 && turnTo(curPage + 1, 1, caretEnd()));

  let touch = null;
  pageEl.addEventListener("touchstart", (e) => { const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY, t: Date.now() }; }, { passive: true });
  pageEl.addEventListener("touchend", (e) => {
    if (!touch) return;
    const t = e.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 45 && Date.now() - touch.t < 600) {
      if (dx < 0 && curPage < bounds.length - 1) turnTo(curPage + 1, 1, null);
      if (dx > 0 && curPage > 0) turnTo(curPage - 1, -1, null);
    }
    touch = null;
  });

  /* ---------------- saving / syncing ---------------- */
  function setStatus(s) {
    statusEl.textContent = { saving: "saving…", saved: "saved ♡", offline: "saved on this phone ♡", "": "" }[s] ?? s;
  }

  async function rpc(fn, args) {
    const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`${fn} ${r.status}`);
    return r.json();
  }

  let saveTimer;
  function saveSoon() {
    const e = entry();
    e.body = text;
    e.dirty = true;
    e.v = (e.v || 0) + 1;
    persist();
    setStatus("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 900);
    if (text.trim() && !tabsEl.querySelector(`[data-date="${curDate}"]`)) buildTabs();
  }

  let flushing = null;
  async function flush() {
    if (flushing) { await flushing; }
    flushing = (async () => {
      clearTimeout(saveTimer);
      let ok = true;
      for (const [d, e] of Object.entries(store.entries)) {
        if (!e.dirty) continue;
        const v = e.v;
        try {
          const at = await rpc("diary_save", { p_secret: store.secret, p_date: d, p_body: e.body, p_author: name || null });
          e.updatedAt = at;
          if (e.v === v) e.dirty = false;
        } catch (err) { ok = false; }
      }
      persist();
      setStatus(ok ? "saved" : "offline");
      return ok;
    })();
    const ok = await flushing;
    flushing = null;
    return ok;
  }
  window.addEventListener("online", () => flush());
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

  async function sync() {
    try {
      const rows = await rpc("diary_list", { p_secret: store.secret });
      let touchedCurrent = false;
      for (const r of rows) {
        const local = store.entries[r.entry_date];
        if (local && local.dirty) continue;
        const sharedBody = r.shared_at && r.updated_at <= r.shared_at ? r.body : local?.sharedBody;
        if (!local || local.body !== r.body) touchedCurrent ||= r.entry_date === curDate;
        store.entries[r.entry_date] = { body: r.body, updatedAt: r.updated_at, sharedAt: r.shared_at, sharedBody, v: local?.v || 0 };
      }
      persist();
      if (isOpen) buildTabs();
      if (touchedCurrent && document.activeElement !== ink) loadDate(curDate, curDate === todayStr() ? "last" : 0);
      flush();
    } catch (e) { /* offline: local copy is fine */ }
  }

  /* ---------------- sharing ---------------- */
  let confirmTimer;
  function paintShare(state) {
    const e = entry();
    const lbl = pShare.querySelector(".lbl");
    pShare.className = "p-share";
    const sentNow = e.sharedBody != null && e.sharedBody === text && text.trim();
    pSent.classList.toggle("show", !!sentNow);
    if (state === "confirm") { pShare.classList.add("confirm"); lbl.textContent = "send to Andi?"; return; }
    if (state === "busy") { pShare.classList.add("busy"); lbl.textContent = "sending…"; return; }
    if (state === "fail") { lbl.textContent = "try again"; return; }
    if (state === "empty") { pShare.classList.add("empty"); lbl.textContent = "write first ♡"; return; }
    if (!text.trim()) { pShare.classList.add("empty"); lbl.textContent = "share"; return; }
    if (sentNow) { pShare.classList.add("sent"); lbl.textContent = "sent ♡"; return; }
    lbl.textContent = e.sharedAt ? "share again" : "share";
  }

  pShare.addEventListener("click", async () => {
    if (busy) return;
    if (!text.trim()) { paintShare("empty"); setTimeout(() => paintShare(), 1600); return; }
    if (!pShare.classList.contains("confirm")) {
      paintShare("confirm");
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => paintShare(), 4000);
      return;
    }
    clearTimeout(confirmTimer);
    paintShare("busy");
    const date = curDate, body = text;
    try {
      if (!(await flush())) throw new Error("save failed");
      const r = await fetch(CFG.functionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "share", secret: store.secret, date, name }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || r.status);
      const e = entry(date);
      e.sharedAt = j.shared_at;
      e.sharedBody = body;
      persist();
      paintShare();
      const rect = pShare.getBoundingClientRect();
      hearts(rect.left + rect.width / 2, rect.top);
    } catch (err) {
      paintShare("fail");
      setTimeout(() => paintShare(), 2500);
    }
  });

  function hearts(x, y) {
    const colors = ["#e0566b", "#f29a95", "#cc887c", "#f6c1b6", "#d47a8a"];
    for (let k = 0; k < 14; k++) {
      const h = document.createElement("span");
      h.className = "heart";
      h.textContent = "♥";
      const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 90;
      h.style.cssText = `z-index:200;left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 50}px;--hs:${12 + Math.random() * 14}px;--hc:${colors[k % 5]};--hr:${Math.random() * 90 - 45}deg`;
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 1300);
    }
  }

  /* ---------------- days & tabs ---------------- */
  function loadDate(d, page) {
    curDate = d;
    text = entry(d).body || "";
    bounds = [{ s: 0, e: 0 }];
    bounds = paginate(text, 0);
    paintHeader();
    showPage(page === "last" ? bounds.length - 1 : page || 0, page === "last" ? Infinity : null);
    tabsEl.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.date === d));
  }

  function switchDate(d) {
    if (d === curDate || busy) return;
    flush();
    const dir = d > curDate ? 1 : -1;
    if (reduced) return loadDate(d, d === todayStr() ? "last" : 0);
    if (dir > 0) {
      const f = makeFlipper(1);
      loadDate(d, d === todayStr() ? "last" : 0);
      animateFlip(f, 1);
    } else {
      loadDate(d, d === todayStr() ? "last" : 0);
      animateFlip(makeFlipper(-1), -1);
    }
  }

  function buildTabs() {
    const today = todayStr();
    const dates = new Set(Object.keys(store.entries).filter((d) => (store.entries[d].body || "").trim()));
    dates.add(today);
    const sorted = [...dates].sort().reverse();
    tabsEl.innerHTML = "";
    sorted.forEach((d, i) => {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "tab" + (d === curDate ? " active" : "");
      t.dataset.date = d;
      t.style.setProperty("--tc", TAB_COLORS[i % TAB_COLORS.length]);
      t.style.setProperty("--i", Math.min(i, 8));
      const dt = toDate(d);
      t.innerHTML = d === today ? "<b>♡</b><small>today</small>" : `<b>${dt.getDate()}</b><small>${MONTHS[dt.getMonth()]}${dt.getFullYear() !== new Date().getFullYear() ? " ’" + String(dt.getFullYear()).slice(2) : ""}</small>`;
      t.setAttribute("aria-label", longDate(d));
      t.addEventListener("click", () => isOpen && switchDate(d));
      tabsEl.appendChild(t);
    });
  }

  /* ---------------- cover decoration ---------------- */
  function decorateCover() {
    const w = $("#cWreath");
    if (w.childElementCount) return;
    const cx = 152, cy = 222, rx = 108, ry = 84, n = 18;
    const kinds = ["bloom", "leaf", "blossom", "leaf", "rose", "leaf"];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const kind = kinds[i % kinds.length];
      const size = kind === "rose" ? 38 : kind === "leaf" ? 24 : 30;
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      const rot = kind === "leaf" ? (a * 180) / Math.PI + 90 : (i * 47) % 360;
      w.insertAdjacentHTML("beforeend",
        `<svg viewBox="-50 -50 100 100" style="left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;transform:rotate(${rot}deg)"><use href="#${kind}" x="-50" y="-50" width="100" height="100"/></svg>`);
    }
    $("#cYear").textContent = `♡ ${new Date().getFullYear()} ♡`;
  }

  function petals() {
    const box = $("#dPetals");
    if (box.childElementCount) return;
    for (let k = 0; k < 12; k++) {
      const p = document.createElement("span");
      p.className = "petal";
      p.style.cssText = `left:${Math.random() * 100}%;--s:${9 + Math.random() * 10}px;--d:${10 + Math.random() * 9}s;--delay:${-Math.random() * 18}s`;
      box.appendChild(p);
    }
  }

  /* ---------------- the scent of flowers ---------------- */
  function scentBurst() {
    if (reduced) return;
    scent.querySelectorAll(".wisp").forEach((n) => n.remove());
    for (let i = 0; i < 7; i++) {
      const x = 50 + i * 32 + (Math.random() * 16 - 8), y = 150 + Math.random() * 40, a = 12 + Math.random() * 14, flip = i % 2 ? 1 : -1;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${x},${y} c${a * flip},-40 ${-a * flip},-80 0,-115 s${a * flip},-75 0,-110 s${-a * flip},-60 ${a * 0.5 * flip},-90`);
      path.setAttribute("class", "wisp");
      path.style.animationDelay = `${i * 0.12 + Math.random() * 0.2}s`;
      path.style.strokeWidth = String(5 + Math.random() * 4);
      scent.appendChild(path);
    }
    const glow = document.createElement("div");
    glow.className = "d-glow";
    book.appendChild(glow);
    setTimeout(() => glow.remove(), 2600);
    for (let k = 0; k < 26; k++) {
      const f = document.createElement("span");
      const spark = k % 3 === 0;
      f.className = "d-fly " + (spark ? "spark" : "petal-f");
      if (spark) f.textContent = "✦";
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, dist = 120 + Math.random() * 200;
      f.style.cssText = `--s:${spark ? 10 + Math.random() * 10 : 8 + Math.random() * 9}px;--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist}px;--r:${Math.random() * 540 - 270}deg;--t:${1.6 + Math.random() * 1.4}s;--dl:${0.1 + Math.random() * 0.6}s`;
      book.appendChild(f);
      setTimeout(() => f.remove(), 3800);
    }
    setTimeout(() => scent.querySelectorAll(".wisp").forEach((n) => n.remove()), 4200);
  }

  /* ---------------- open / close ---------------- */
  function fit() {
    if (document.activeElement === ink) return;
    const s = Math.min(window.innerWidth / 360, window.innerHeight / 640, 1.3);
    scaler.style.setProperty("--ds", s.toFixed(3));
  }
  window.addEventListener("resize", () => { if (!stage.hidden) fit(); });

  async function fontsReady() {
    try { await Promise.race([document.fonts.load('22px "Gaegu"'), wait(2500)]); await document.fonts.ready; } catch (e) {}
  }

  function showStage(push = true) {
    if (!name || !stage.hidden) return;
    decorateCover();
    petals();
    $("#cName").textContent = `${name}'s`;
    stage.hidden = false;
    fit();
    requestAnimationFrame(() => stage.classList.add("show"));
    if (push && history.state?.diary !== 1) history.pushState({ diary: 1 }, "", "#diary");
    loadDate(todayStr(), "last");     // the first page under the cover is always today
    sync();
  }

  async function openBook() {
    if (isOpen || busy) return;
    busy = true;
    await fontsReady();
    loadDate(todayStr(), "last");
    buildTabs();
    book.classList.add("unclasp");
    await wait(reduced ? 0 : 380);
    scentBurst();
    book.classList.add("open");
    stage.classList.add("open");
    isOpen = true;
    await wait(reduced ? 0 : 1300);
    cover.classList.add("gone");
    busy = false;
  }

  async function closeBook() {
    if (!isOpen) return;
    busy = true;
    ink.blur();
    cover.classList.remove("gone");
    void cover.offsetWidth;
    book.classList.remove("open");
    stage.classList.remove("open");
    isOpen = false;
    await wait(reduced ? 0 : 1250);
    book.classList.remove("unclasp");
    busy = false;
  }

  async function hideStage() {
    if (stage.hidden) return;
    flush();
    await closeBook();
    stage.classList.remove("show");
    await wait(450);
    stage.hidden = true;
  }

  cover.addEventListener("click", openBook);
  cover.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBook(); } });
  $("#dBack").addEventListener("click", () => {
    if (history.state?.diary === 1) history.back(); else hideStage();
  });
  window.addEventListener("popstate", () => { if (!stage.hidden) hideStage(); else if (location.hash === "#diary") showStage(false); });
  btn.addEventListener("click", () => showStage());

  /* ---------------- who is she ---------------- */
  function setName(n) {
    name = n || "";
    btn.hidden = !name;
    if (name && location.hash === "#diary" && stage.hidden) {
      history.replaceState({ diary: 1 }, "", "#diary");
      showStage(false);
    }
  }
  window.addEventListener("postcards:name", (e) => setName(e.detail));
  try { setName((JSON.parse(localStorage.getItem("postcards-v1") || "null") || {}).name); } catch (e) {}
})();
