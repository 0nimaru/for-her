(() => {
  "use strict";

  // 📲 "add to home" button:
  //  - Android Chrome / Edge / Samsung Internet: the real one-tap install prompt (beforeinstallprompt)
  //  - iPhone / iPad and other browsers: a step-by-step guide (websites can't add themselves there)
  //  - hidden once the site runs from the Home Screen
  const $ = (s) => document.querySelector(s);
  const btn = $("#installBtn"), guide = $("#a2hs"), steps = $("#a2hsSteps");
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIPad = /ipad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const iosOtherBrowser = isIOS && /crios|fxios|edgios/i.test(ua);
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const say = (mood, text) => window.dispatchEvent(new CustomEvent("hyena:say", { detail: { mood, say: text } }));

  let deferred = null;   // Android's saved install prompt
  let herName = "";

  const SHARE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2"/></svg>`;
  const PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`;
  const DOTS = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;
  const APP = `<img src="/icons/icon-192.png" alt="" />`;

  function paint() {
    btn.hidden = !herName || isStandalone();
  }

  function openGuide() {
    let list, where;
    if (isIOS) {
      list = [
        [SHARE, iosOtherBrowser ? "Tap the <b>Share</b> button next to the address bar" : "Tap <b>Share</b> in Safari's toolbar <span style=\"opacity:.75\">(on newer iPhones: tap <b>•••</b> first)</span>"],
        [PLUS, "Scroll down and tap <b>Add to Home Screen</b>"],
        ["Add", "Tap <b>Add</b> in the top corner"],
        [APP, "Open <b>For You</b> from your Home Screen ♡"],
      ];
      where = iosOtherBrowser || isIPad ? "top" : "bottom";
    } else {
      list = [
        [DOTS, "Tap the <b>⋮</b> menu in your browser"],
        [PLUS, "Tap <b>Add to Home screen</b> or <b>Install app</b>"],
        ["Add", "Tap <b>Install</b> or <b>Add</b>"],
        [APP, "Open <b>For You</b> from your Home Screen ♡"],
      ];
      where = "top";
    }
    steps.innerHTML = list.map(([ic, t]) => `<li><span class="ic">${ic}</span><span>${t}</span></li>`).join("");
    guide.classList.toggle("top", where === "top");
    guide.hidden = false;
    requestAnimationFrame(() => guide.classList.add("show"));
    say("shy", "it's easy, i promise");
  }
  function closeGuide() {
    guide.classList.remove("show");
    setTimeout(() => (guide.hidden = true), 300);
  }
  window.openA2HSGuide = openGuide;   // used by the notification center on iPhone
  $("#a2hsClose").addEventListener("click", closeGuide);
  $("#a2hsDone").addEventListener("click", closeGuide);
  guide.addEventListener("click", (e) => { if (e.target === guide) closeGuide(); });

  // Android: keep the browser's install prompt for our own button.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    paint();
  });

  btn.addEventListener("click", async () => {
    if (deferred) {
      const prompt = deferred;
      deferred = null;
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === "accepted") { celebrate(); return; }
        say("sad", "maybe later then…");
      } catch (e) { openGuide(); }
      return;
    }
    openGuide();
  });

  function celebrate() {
    btn.hidden = true;
    say("love", "yay, i live on your phone now!");
  }
  window.addEventListener("appinstalled", celebrate);

  function setHer(n) { herName = n || ""; paint(); }
  window.addEventListener("postcards:name", (e) => setHer(e.detail));
  try { setHer((JSON.parse(localStorage.getItem("postcards-v1") || "null") || {}).name); } catch (e) {}
})();
