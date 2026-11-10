(() => {
  "use strict";

  /* ---------------- settings ---------------- */
  const ALLOWED = ["ada", "adela", "adelka", "adys", "adysa"];
  const IG_HANDLE = "and1.sula";
  const IG_BLOCKED = "https://www.instagram.com/accounts/blocked_accounts/";
  const WHATSAPP = "https://wa.me/355697693475";
  const IG_DM = "https://ig.me/m/" + IG_HANDLE;
  const STORE = "postcards-v1";

  /* ---------------- the postcards ---------------- */
  // mood: neutral | happy | laugh | sad | love | shy | smug | surprised | wink
  const CARDS = [
    { type: "name" },
    { html: (s) => `<span class="script">My Dearest ${esc(s.name)},</span>I hope this puts a smile on you`, mood: "happy", say: "hi :)" },
    { text: "The person that made this is stupid sometimes.", mood: "smug", say: "very." },
    { text: "You, on the other hand, are so smart and pretty", mood: "love", say: "facts." },
    { text: "You two have had your ups and downs together", mood: "neutral", say: "true…" },
    { html: () => `<em>(Mostly ups)</em>`, mood: "happy", say: "mostly!!" },
    { text: "And on your downs you are both learning about each other", mood: "shy", say: "growing <3" },
    { text: "He has more to learn of course, but he ain't that bad", mood: "smug", say: "a little bad." },
    { text: "He's been thinking about you a lot since you met and…", mood: "shy", say: "and…?" },
    { text: "He sees something beautiful in you and in your relationship", mood: "love", say: "awww" },
    { text: "To be honest, I also see something beautiful in you two", mood: "love", say: "me too." },
    { text: "The last one was ugly for sure", mood: "laugh", say: "hehehe" },
    { text: "Me personally, I think an apology should be in place.", mood: "neutral", say: "mhm." },
    { text: "Andi told me that he's really trying to make up with you, and…", mood: "neutral", say: "he is." },
    { text: "This is between me and you….", mood: "wink", say: "psst." },
    { text: "He's been an asshole really, we both know it, but…", mood: "smug", say: "a big one." },
    { text: "He really loves to put a smile on that pretty face and really wants this to work…", mood: "love", say: "he does." },
    { text: "And I think you should consider making up with him", mood: "shy", say: "pleaase?" },
    { type: "ask", key: "no1", text: "What do you say? To be honest, you have one choice here hehe", mood: "surprised", say: "…well?" },
    {
      text: (s) => s.no1
        ? "I knew you would agree to it. Don't worry, I won't tell him you said no at first"
        : "I knew you would agree to it.",
      mood: (s) => (s.no1 ? "wink" : "laugh"),
      say: (s) => (s.no1 ? "our secret 🤫" : "told ya."),
    },
    { text: "First things first: in a healthy relationship, no one should ever be blocking another", mood: "neutral", say: "rule #1." },
    { type: "ask", key: "no2", text: "Are you willing to unblock him from your social media?", mood: "surprised", say: "pretty please?" },
    {
      html: () => `Okay, I want you to find the name <span class="handle">@${IG_HANDLE}</span> and unblock it, and after you do, come back to meee`,
      mood: "happy", say: "i'll wait here.", next: "Take me there ›", go: IG_BLOCKED,
    },
    { text: "Amazing! But we're not done yet, don't forget to come back to see", mood: "love", say: "you came back!", next: "Open WhatsApp ›", go: WHATSAPP },
    { text: "Before we continue, make sure to check on me each morning, I might have a surprise for you", mood: "wink", say: "every morning ☀️" },
    {
      text: "Now what's most important: he has been waiting for you to actually text him, so do so. Don't be shy, he's your boyfriend after all <3",
      mood: "love", say: "go go go!", next: "Message him ♥", go: IG_DM,
    },
  ];

  const NO_WORDS = ["No", "are you sure?", "nope", "try again", "hehe", "not this one", "nice try", "🙈", "wrong button", "still no?", "the other one!"];
  const WRONG_SAYS = ["…not you.", "who are you??", "nope.", "hmm, no."];

  /* ---------------- state ---------------- */
  const $ = (s) => document.querySelector(s);
  const card = $("#card"), content = $("#content"), garland = $("#garland");
  const hyena = $("#hyena"), bubble = $("#bubble"), bar = $("#bar"), tilt = $("#tilt");

  let state = { step: 0, name: "", no1: false, no2: false };
  let current = -1;
  let busy = false;

  function load() {
    try {
      if (/[?&]reset\b/.test(location.search)) localStorage.removeItem(STORE);
      const s = JSON.parse(localStorage.getItem(STORE) || "null");
      if (s && typeof s.step === "number" && s.name) state = Object.assign(state, s);
    } catch (e) { /* storage unavailable: start fresh */ }
    if (state.step < 0 || state.step >= CARDS.length) state.step = 0;
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {}
  }

  function esc(t) {
    return String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const val = (v) => (typeof v === "function" ? v(state) : v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- name check ---------------- */
  function normalizeName(raw) {
    return String(raw)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[łŁ]/g, "l").replace(/[đĐ]/g, "d").replace(/[øØ]/g, "o")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  }
  const isHer = (raw) => ALLOWED.includes(normalizeName(raw));
  function prettyName(raw) {
    // keep letters (with accents), drop emoji/symbols for the greeting
    const t = String(raw).replace(/[^\p{L}\p{M}\s'-]/gu, "").trim().replace(/\s+/g, " ") || String(raw).trim();
    // capitalise the first letter, keep her special characters
    return t.replace(/\p{L}/u, (c) => c.toUpperCase());
  }

  /* ---------------- hyena ---------------- */
  let sayTimer;
  function react(mood, say) {
    if (hyena.dataset.mood !== mood) {
      hyena.dataset.mood = mood;
      hyena.classList.remove("hop"); void hyena.getBBox(); hyena.classList.add("hop");
    }
    clearTimeout(sayTimer);
    bubble.classList.remove("show");
    if (!say) return;
    sayTimer = setTimeout(() => {
      bubble.textContent = say;
      void bubble.offsetWidth;
      bubble.classList.add("show");
    }, 380);
  }

  /* ---------------- rendering ---------------- */
  function stampHTML(i) {
    return `<div class="postmark"></div><div class="stamp"><b>♥</b><small>${String(i).padStart(2, "0")}</small></div>`;
  }

  function render(i) {
    current = i;
    document.querySelectorAll(".btn.loose").forEach((b) => b.remove());
    const c = CARDS[i];
    bar.style.width = `${(i / (CARDS.length - 1)) * 100}%`;

    if (c.type === "name") return renderName();

    const body = c.html ? val(c.html) : esc(val(c.text));
    let actions;
    if (c.type === "ask") {
      actions = `<button class="btn yes" type="button">Yes ♥</button><button class="btn ghost no" type="button">No</button>`;
    } else {
      actions = `<button class="btn next" type="button">${esc(c.next || "Next ›")}</button>`;
    }
    content.innerHTML = `${stampHTML(i)}<div class="msg">${body}</div><div class="actions">${actions}</div>`;
    react(val(c.mood), val(c.say));

    if (c.type === "ask") {
      const yes = content.querySelector(".yes"), no = content.querySelector(".no");
      yes.addEventListener("click", (e) => { hearts(e.clientX, e.clientY); advance(); });
      runaway(no, yes, (n) => {
        state[c.key] = true; save();
        react(n % 3 === 0 ? "smug" : "laugh", ["nope :)", "hehe", "try the other one", "nice try", "i said ONE choice"][n % 5]);
      });
    } else {
      content.querySelector(".next").addEventListener("click", (e) => {
        if (c.go) return leaveTo(c.go);
        if (i === CARDS.length - 1) hearts(e.clientX, e.clientY);
        advance();
      });
    }
  }

  function renderName() {
    content.innerHTML = `
      ${stampHTML(0)}
      <p class="ask-name">Hi there!</p>
      <p class="ask-sub">Before we begin… what's your name?</p>
      <form class="name-form" autocomplete="off" novalidate>
        <input class="field" name="n" type="text" placeholder="your name" maxlength="30" autocapitalize="words" spellcheck="false" enterkeyhint="go" />
        <div class="actions"><button class="btn" type="submit">That's me ›</button></div>
      </form>
      <div class="err" role="alert"></div>`;
    react("neutral", "who's there?");
    const form = content.querySelector("form"), input = form.querySelector("input"), err = content.querySelector(".err");
    let wrong = 0;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = input.value;
      if (!raw.trim()) { input.focus(); return; }
      if (isHer(raw)) {
        input.blur();
        state.name = prettyName(raw);
        err.textContent = "";
        react("love", "it's you!!");
        const r = input.getBoundingClientRect();
        hearts(r.left + r.width / 2, r.top + r.height / 2);
        await wait(900);
        advance();
      } else {
        err.textContent = "I'm sorry, this is not the girl I'm looking for 💔";
        react("sad", WRONG_SAYS[wrong++ % WRONG_SAYS.length]);
        card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
      }
    });
  }

  async function flipTo(i) {
    if (busy) return;
    busy = true;
    card.classList.add("out");
    await wait(260);
    render(i);
    card.classList.remove("out");
    card.classList.add("in");
    void card.offsetWidth;
    card.classList.remove("in");
    await wait(300);
    busy = false;
  }

  function advance() {
    if (current >= CARDS.length - 1) return;
    state.step = current + 1;
    save();
    flipTo(state.step);
  }

  function leaveTo(url) {
    // When she comes back, she should land on the next card.
    if (current < CARDS.length - 1) state.step = current + 1;
    save();
    react("happy", "see you soon!");
    setTimeout(() => { location.href = url; }, 350);
  }

  // Coming back from Instagram / WhatsApp
  function syncFromStorage() {
    let s;
    try { s = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { return; }
    if (s && typeof s.step === "number" && s.step !== current && s.step < CARDS.length) {
      state = Object.assign(state, s);
      flipTo(state.step);
    }
  }
  window.addEventListener("pageshow", (e) => { if (e.persisted) syncFromStorage(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncFromStorage(); });

  /* ---------------- the runaway "No" ---------------- */
  function runaway(no, yes, onTry) {
    let n = 0, lastX = -999, lastY = -999;
    const flee = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (!no.classList.contains("loose")) {
        const r = no.getBoundingClientRect();
        no.style.width = "auto";
        document.body.appendChild(no);
        no.classList.add("loose");
        no.style.left = r.left + "px";
        no.style.top = r.top + "px";
        void no.offsetWidth;
      }
      n++;
      no.textContent = NO_WORDS[n % NO_WORDS.length];
      const bw = no.offsetWidth, bh = no.offsetHeight, m = 14;
      const yr = yes.getBoundingClientRect();
      const W = window.innerWidth, H = window.innerHeight;
      let x, y, tries = 0;
      do {
        x = m + Math.random() * Math.max(1, W - bw - 2 * m);
        y = m + 40 + Math.random() * Math.max(1, H - bh - 2 * m - 40);
        tries++;
      } while (tries < 40 && (
        (x < yr.right + 24 && x + bw > yr.left - 24 && y < yr.bottom + 24 && y + bh > yr.top - 24) ||
        Math.hypot(x - lastX, y - lastY) < 110
      ));
      lastX = x; lastY = y;
      no.style.left = x + "px";
      no.style.top = y + "px";
      yes.style.setProperty("--grow", Math.min(1 + n * 0.07, 1.45).toFixed(2));
      onTry(n);
    };
    no.addEventListener("pointerdown", flee);
    no.addEventListener("click", flee);
    no.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") flee(e); });
    if (matchMedia("(hover: hover)").matches) no.addEventListener("mouseenter", flee);
  }

  /* ---------------- flower garland (3D border) ---------------- */
  function rng(seed) {
    return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  }
  function flower(sym, x, y, size, rot, z, rand) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-50 -50 100 100");
    svg.setAttribute("class", "fl");
    svg.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;--r:${rot}deg;--z:${z}px;--sd:${(3 + rand() * 3).toFixed(2)}s;--sdl:${(-rand() * 4).toFixed(2)}s`;
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + sym);
    use.setAttribute("x", "-50"); use.setAttribute("y", "-50");
    use.setAttribute("width", "100"); use.setAttribute("height", "100");
    svg.appendChild(use);
    garland.appendChild(svg);
  }

  function buildGarland() {
    garland.innerHTML = "";
    const w = card.clientWidth, h = card.clientHeight;
    if (!w || !h) return;
    const rand = rng(7);
    const ins = 10;

    // wavy vine along the edge
    const pts = [];
    const per = 2 * (w + h - 4 * ins);
    for (let s = 0; s <= per; s += 5) {
      let x, y, nx, ny, t = s;
      const ew = w - 2 * ins, eh = h - 2 * ins;
      if (t < ew) { x = ins + t; y = ins; nx = 0; ny = -1; }
      else if ((t -= ew) < eh) { x = w - ins; y = ins + t; nx = 1; ny = 0; }
      else if ((t -= eh) < ew) { x = w - ins - t; y = h - ins; nx = 0; ny = 1; }
      else { t -= ew; x = ins; y = h - ins - t; nx = -1; ny = 0; }
      const o = Math.sin(s / 16) * 3.2;
      pts.push(`${(x + nx * o).toFixed(1)},${(y + ny * o).toFixed(1)}`);
    }
    const vine = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    vine.setAttribute("class", "vine");
    vine.setAttribute("viewBox", `0 0 ${w} ${h}`);
    vine.setAttribute("width", w);
    vine.setAttribute("height", h);
    vine.innerHTML = `<path d="M${pts.join(" L")}Z" fill="none" stroke="#9fb393" stroke-width="2.2" stroke-linecap="round" opacity=".8"/>`;
    garland.appendChild(vine);

    // little flowers along each edge
    const edge = (x1, y1, x2, y2, angle) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const count = Math.max(1, Math.round(len / 62));
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
        flower("leaf", x - 9 * Math.cos(angle), y - 9 * Math.sin(angle), 22, angle * 57.3 + 50 + rand() * 30, 8, rand);
        flower("leaf", x + 9 * Math.cos(angle), y + 9 * Math.sin(angle), 20, angle * 57.3 - 50 - rand() * 30, 8, rand);
        const sym = k % 2 ? "blossom" : "bloom";
        flower(sym, x, y, 26 + rand() * 10, rand() * 360, 10 + rand() * 8, rand);
      }
    };
    edge(96, ins, w - 70, ins, 0);
    edge(w - ins, 80, w - ins, h - 100, Math.PI / 2);
    edge(w - 96, h - ins, 70, h - ins, 0);
    edge(ins, h - 80, ins, 100, Math.PI / 2);

    // corner bouquets
    const bouquet = (x, y, dir, big) => {
      const s = big ? 1 : 0.7;
      flower("leaf", x + 30 * dir * s, y + 6 * s, 34 * s, 70 * dir, 10, rand);
      flower("leaf", x + 4 * s, y + 32 * s * (dir > 0 ? 1 : 1), 32 * s, 160, 10, rand);
      flower("leaf", x - 18 * dir * s, y - 12 * s, 28 * s, -30 * dir, 10, rand);
      flower("blossom", x + 26 * dir * s, y + 28 * s, 36 * s, rand() * 360, 16, rand);
      flower("rose", x, y, 60 * s, rand() * 360, 22, rand);
      flower("bloom", x + 42 * dir * s, y - 2 * s, 32 * s, rand() * 360, 18, rand);
    };
    bouquet(16, 16, 1, true);
    const bouquetB = (x, y, big) => {
      const s = big ? 1 : 0.7;
      flower("leaf", x - 30 * s, y - 6 * s, 34 * s, -110, 10, rand);
      flower("leaf", x - 4 * s, y - 32 * s, 32 * s, -20, 10, rand);
      flower("leaf", x + 18 * s, y + 12 * s, 28 * s, 150, 10, rand);
      flower("blossom", x - 26 * s, y - 28 * s, 36 * s, rand() * 360, 16, rand);
      flower("rose", x, y, 60 * s, rand() * 360, 22, rand);
      flower("bloom", x - 42 * s, y + 2 * s, 32 * s, rand() * 360, 18, rand);
    };
    bouquetB(w - 16, h - 16, true);
    // small accents on the other two corners
    flower("leaf", w - 26, 22, 26, 40, 8, rand);
    flower("bloom", w - 14, 16, 30, 20, 24, rand);
    flower("leaf", 26, h - 22, 26, 220, 8, rand);
    flower("bloom", 14, h - 16, 30, 200, 24, rand);
  }

  /* ---------------- hearts ---------------- */
  function hearts(x, y) {
    if (!x && !y) { x = innerWidth / 2; y = innerHeight / 2; }
    const colors = ["#e0566b", "#f29a95", "#cc887c", "#f6c1b6", "#d47a8a"];
    for (let k = 0; k < 16; k++) {
      const h = document.createElement("span");
      h.className = "heart";
      h.textContent = "♥";
      const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 110;
      h.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--hs:${14 + Math.random() * 16}px;--hc:${colors[k % colors.length]};--hr:${Math.random() * 90 - 45}deg`;
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 1300);
    }
  }

  /* ---------------- ambience ---------------- */
  function petals() {
    const box = $("#petals");
    for (let k = 0; k < 14; k++) {
      const p = document.createElement("span");
      p.className = "petal";
      p.style.cssText = `left:${Math.random() * 100}%;--s:${10 + Math.random() * 10}px;--d:${9 + Math.random() * 9}s;--delay:${-Math.random() * 18}s`;
      box.appendChild(p);
    }
  }

  function setupTilt() {
    const set = (x, y) => {
      tilt.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
      tilt.style.setProperty("--ry", `${(x - 0.5) * 14}deg`);
    };
    window.addEventListener("pointermove", (e) => set(e.clientX / innerWidth, e.clientY / innerHeight), { passive: true });
    window.addEventListener("pointerup", () => set(0.5, 0.5), { passive: true });
    // Android gives orientation without asking; iOS just gets the floating effect.
    if ("DeviceOrientationEvent" in window && typeof DeviceOrientationEvent.requestPermission !== "function") {
      window.addEventListener("deviceorientation", (e) => {
        if (e.gamma == null) return;
        const gx = Math.max(-25, Math.min(25, e.gamma)) / 50 + 0.5;
        const gy = Math.max(-25, Math.min(25, (e.beta || 45) - 45)) / 50 + 0.5;
        set(gx, gy);
      }, { passive: true });
    }
  }

  $("#restart").addEventListener("click", () => {
    if (!confirm("Start over from the beginning?")) return;
    try { localStorage.removeItem(STORE); } catch (e) {}
    state = { step: 0, name: "", no1: false, no2: false };
    flipTo(0);
  });

  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(buildGarland, 150); });

  /* ---------------- go ---------------- */
  load();
  petals();
  buildGarland();
  setupTilt();
  render(state.step);
})();
