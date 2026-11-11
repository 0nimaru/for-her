// Public client settings. The publishable key is meant to be public: the diary
// tables are locked (RLS, no policies) and only reachable through functions that
// require her device secret or Andi's mailbox token.
window.DIARY_CONFIG = {
  supabaseUrl: "https://qjlnulbynqmhhoehbwrw.supabase.co",
  supabaseKey: "sb_publishable_Tor-W_bmJS58pHZtKEezcg_uENDNn1a",
  functionUrl: "https://qjlnulbynqmhhoehbwrw.supabase.co/functions/v1/diary",
};

// Service worker: needed for "Add to Home Screen" and push notifications.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
