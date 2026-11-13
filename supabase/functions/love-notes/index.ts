// Love notes, feelings jar and devices.
//
// Her phone (identified by a random device secret; must be approved by Andi):
//   register   { secret, label, endpoint? }      -> { approved }
//   subscribe  { secret, subscription }          her phone gets love-note pushes
//   inbox      { secret, before?, limit? }       -> { notes } (approved phones only)
//   feel       { secret, mood?, text?, audio?, mime?, seconds? }  share a feeling with Andi
//   countdown  { secret }                        -> { countdown: { at, label } | null }
//   cards      { secret }                        -> { cards: string[] | null } (Andi's card texts)
//
// Andi (sender passcode, PBKDF2-hashed, set on first use):
//   status, claim, notify                        (as before)
//   andi_subscribe  { key, subscription }        his phone gets "she shared a feeling" pushes
//   feelings        { key, before? }             -> { feelings }
//   feeling_audio   { key, id }                  -> { url } short-lived link to a voice memo
//   feelings_seen   { key }
//   feeling_delete  { key, id }
//   devices         { key }                      -> { devices }
//   device_approve  { key, id } / device_remove { key, id }
//   countdown_set   { key, at, label? }          starts a countdown for both of them
//   countdown_clear { key }
//   cards_get       { key }                      -> { cards }
//   cards_set       { key, cards: string[], notify? }  replace the cards she taps through
//
// Feelings she does NOT share never reach this server.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

const MOODS: Record<string, string> = {
  happy: "😊 happy", loved: "🥰 loved", calm: "😌 calm", tired: "😴 tired", sad: "😔 sad",
  upset: "😤 upset", anxious: "😰 anxious", hug: "🫂 needs a hug", missing: "🥺 missing you",
};
const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/mpeg": "mp3",
  "audio/aac": "aac", "audio/x-m4a": "m4a", "audio/wav": "wav",
};

async function getConfig(key: string) {
  const { data } = await db.from("love_config").select("value").eq("key", key).maybeSingle();
  return data?.value as string | undefined;
}

let vapidReady: string | null = null;
async function vapid() {
  if (vapidReady) return vapidReady;
  let pub = await getConfig("vapid_public");
  let priv = await getConfig("vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    await db.from("love_config").upsert(
      [{ key: "vapid_public", value: k.publicKey }, { key: "vapid_private", value: k.privateKey }],
      { onConflict: "key", ignoreDuplicates: true },
    );
    pub = await getConfig("vapid_public");
    priv = await getConfig("vapid_private");
  }
  webpush.setVapidDetails("https://github.com/0nimaru/for-her", pub!, priv!);
  vapidReady = pub!;
  return pub!;
}

// Sender passcode: PBKDF2-SHA256, 150k iterations, random salt. Stored as "salt:hash".
async function pbkdf2(pass: string, saltHex: string) {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 150_000 }, key, 256));
}
async function keyOk(pass: unknown) {
  if (typeof pass !== "string" || pass.length < 6) return false;
  const stored = await getConfig("sender_key");
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const ok = (await pbkdf2(pass, salt)) === hash;
  if (!ok) await new Promise((r) => setTimeout(r, 800)); // slow down guessing
  return ok;
}

function uaSummary(ua: string) {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : "Unknown device";
  const br = /SamsungBrowser/.test(ua) ? "Samsung Internet" : /EdgA?\//.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "browser";
  return `${os} · ${br}`;
}

type Device = { id: string; label: string | null; approved: boolean };
async function deviceBySecret(secret: unknown): Promise<Device | null> {
  if (typeof secret !== "string" || secret.length < 32) return null;
  const { data } = await db.from("love_devices").select("id, label, approved").eq("secret_hash", await sha256(secret)).maybeSingle();
  if (data) db.from("love_devices").update({ last_seen: new Date().toISOString() }).eq("id", data.id).then(() => {});
  return data;
}

// deno-lint-ignore no-explicit-any
type Sub = { endpoint: string; subscription: any };
async function pushTo(subs: Sub[], payload: Record<string, unknown>) {
  await vapid();
  let sent = 0;
  const failures: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 60 * 60 * 24 * 3, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("love_push_subs").delete().eq("endpoint", s.endpoint);
      failures.push(String(code ?? (e as Error).message).slice(0, 120));
    }
  }));
  return { sent, devices: subs.length, failures };
}
// Her phones that may receive love notes: approved devices, plus subscriptions from before devices existed.
async function herSubs(): Promise<Sub[]> {
  const { data } = await db.from("love_push_subs").select("endpoint, subscription, device_id, love_devices(approved)").eq("role", "her");
  // deno-lint-ignore no-explicit-any
  return (data ?? []).filter((r: any) => !r.device_id || r.love_devices?.approved);
}
async function andiSubs(): Promise<Sub[]> {
  const { data } = await db.from("love_push_subs").select("endpoint, subscription").eq("role", "andi");
  return data ?? [];
}
const validSub = (sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined) =>
  !!sub?.endpoint && /^https:\/\//.test(sub.endpoint) && !!sub.keys?.p256dh && !!sub.keys?.auth;

async function getCountdown() {
  const { data } = await db.from("love_config").select("key, value").in("key", ["countdown_at", "countdown_label"]);
  const m = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return m.countdown_at ? { at: m.countdown_at, label: m.countdown_label || "" } : null;
}

async function getCards(): Promise<string[] | null> {
  const raw = await getConfig("cards");
  try { const v = raw ? JSON.parse(raw) : null; return Array.isArray(v) ? v : null; } catch { return null; }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // deno-lint-ignore no-explicit-any
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  try {
    switch (body.action) {
      case "vapid":
        return json({ publicKey: await vapid() });

      /* ---------------- her phone ---------------- */
      case "register": {
        if (typeof body.secret !== "string" || body.secret.length < 32) return json({ error: "bad secret" }, 400);
        const label = typeof body.label === "string" ? body.label.slice(0, 40) : null;
        const existing = await deviceBySecret(body.secret);
        if (existing) {
          if (label && label !== existing.label) await db.from("love_devices").update({ label }).eq("id", existing.id);
          return json({ approved: existing.approved });
        }
        const { count } = await db.from("love_devices").select("id", { count: "exact", head: true }).eq("approved", false);
        if ((count ?? 0) >= 20) return json({ error: "too many waiting phones" }, 429);
        // A phone that already had a love-notes subscription before approvals existed is hers: approve it.
        let legacy = false;
        if (typeof body.endpoint === "string") {
          const { data } = await db.from("love_push_subs").select("endpoint").eq("endpoint", body.endpoint).is("device_id", null).eq("role", "her").maybeSingle();
          legacy = !!data;
        }
        const ua = uaSummary(req.headers.get("user-agent") ?? "");
        const { data: dev, error } = await db.from("love_devices")
          .insert({ secret_hash: await sha256(body.secret), label, ua, approved: legacy }).select("id").single();
        if (error) throw error;
        if (legacy) await db.from("love_push_subs").update({ device_id: dev.id }).eq("endpoint", body.endpoint);
        else await pushTo(await andiSubs(), { title: "📱 A phone wants to connect", body: `“${label ?? "?"}” on ${ua}. Open your panel to approve it.`, url: "/?panel=devices", tag: "device" });
        return json({ approved: legacy });
      }

      case "subscribe": {
        const dev = await deviceBySecret(body.secret);
        if (!dev) return json({ error: "unknown phone" }, 403);
        if (!validSub(body.subscription)) return json({ error: "bad subscription" }, 400);
        await db.from("love_push_subs").upsert(
          { endpoint: body.subscription.endpoint, subscription: body.subscription, label: dev.label, role: "her", device_id: dev.id },
          { onConflict: "endpoint" },
        );
        return json({ ok: true, approved: dev.approved });
      }

      case "unsubscribe": {
        if (typeof body.endpoint === "string") await db.from("love_push_subs").delete().eq("endpoint", body.endpoint);
        return json({ ok: true });
      }

      case "inbox": {
        const dev = await deviceBySecret(body.secret);
        if (!dev) return json({ error: "unknown phone" }, 403);
        if (!dev.approved) return json({ pending: true, notes: [] });
        const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 50);
        let q = db.from("love_notes").select("id, body, sent_at").order("sent_at", { ascending: false }).limit(limit);
        if (typeof body.before === "string") q = q.lt("sent_at", body.before);
        const { data } = await q;
        return json({ notes: data ?? [] });
      }

      case "feel": {
        const dev = await deviceBySecret(body.secret);
        if (!dev) return json({ error: "unknown phone" }, 403);
        if (!dev.approved) return json({ error: "waiting for Andi to approve this phone", pending: true }, 403);
        const mood = typeof body.mood === "string" && MOODS[body.mood] ? body.mood : null;
        const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
        const hasAudio = typeof body.audio === "string" && body.audio.length > 0;
        if (!text && !hasAudio && !mood) return json({ error: "nothing to share" }, 400);

        const hourAgo = new Date(Date.now() - 3600_000).toISOString();
        const { count } = await db.from("love_feelings").select("id", { count: "exact", head: true }).eq("device_id", dev.id).gt("created_at", hourAgo);
        if ((count ?? 0) >= 30) return json({ error: "that's a lot of feelings for one hour, try again soon ♡" }, 429);

        let audio_path: string | null = null, audio_mime: string | null = null, audio_seconds: number | null = null;
        if (hasAudio) {
          const mime = String(body.mime || "").split(";")[0].trim();
          const ext = AUDIO_TYPES[mime];
          if (!ext) return json({ error: "unsupported audio format" }, 400);
          const bytes = Uint8Array.from(atob(body.audio), (c) => c.charCodeAt(0));
          if (bytes.length > 6 * 1024 * 1024) return json({ error: "voice memo too long" }, 413);
          audio_path = `${dev.id}/${crypto.randomUUID()}.${ext}`;
          const { error } = await db.storage.from("feelings").upload(audio_path, bytes, { contentType: mime });
          if (error) throw error;
          audio_mime = mime;
          audio_seconds = Math.max(0, Math.min(600, Math.round(Number(body.seconds) || 0)));
        }
        await db.from("love_feelings").insert({ device_id: dev.id, author: dev.label, mood, body: text || null, audio_path, audio_mime, audio_seconds });

        const who = dev.label || "She";
        const parts = [mood ? MOODS[mood] : null, text ? `“${text.replace(/\s+/g, " ").slice(0, 90)}${text.length > 90 ? "…" : ""}”` : null,
          audio_path ? `🎙️ voice memo${audio_seconds ? ` (${mmss(audio_seconds)})` : ""}` : null].filter(Boolean);
        await pushTo(await andiSubs(), { title: `💭 ${who} shared a feeling`, body: parts.join(" · "), url: "/?panel=her", tag: "feeling" });
        return json({ ok: true });
      }

      case "countdown": {
        const dev = await deviceBySecret(body.secret);
        if (!dev || !dev.approved) return json({ countdown: null, pending: !!dev });
        return json({ countdown: await getCountdown() });
      }

      case "cards": {
        const dev = await deviceBySecret(body.secret);
        if (!dev || !dev.approved) return json({ cards: null, pending: !!dev });
        return json({ cards: await getCards() });
      }

      /* ---------------- Andi ---------------- */
      case "status": {
        const claimed = !!(await getConfig("sender_key"));
        const ok = body.key ? await keyOk(body.key) : false;
        if (!ok) return json({ claimed, keyOk: false });
        const [subs, unseen, pending] = await Promise.all([
          herSubs(),
          db.from("love_feelings").select("id", { count: "exact", head: true }).is("seen_at", null),
          db.from("love_devices").select("id", { count: "exact", head: true }).eq("approved", false),
        ]);
        return json({ claimed, keyOk: true, devices: subs.length, unseen: unseen.count ?? 0, pending: pending.count ?? 0, countdown: await getCountdown() });
      }

      case "claim": {
        const pass = body.key;
        if (typeof pass !== "string" || pass.length < 6) return json({ error: "passcode must be at least 6 characters" }, 400);
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        const value = `${salt}:${await pbkdf2(pass, salt)}`;
        const { data } = await db.from("love_config").upsert({ key: "sender_key", value }, { onConflict: "key", ignoreDuplicates: true }).select();
        if (!data?.length) return json({ error: "already set" }, 409);
        return json({ ok: true, devices: (await herSubs()).length });
      }

      case "notify": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        const text = typeof body.body === "string" ? body.body.trim() : "";
        if (!text || text.length > 300) return json({ error: "write 1–300 characters" }, 400);
        const result = await pushTo(await herSubs(), { title: "💌 Andi", body: text, url: "/?inbox", tag: "love-" + Date.now() });
        await db.from("love_notes").insert({ body: text, devices: result.sent });
        return json({ ok: true, ...result });
      }

      case "andi_subscribe": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        if (!validSub(body.subscription)) return json({ error: "bad subscription" }, 400);
        await db.from("love_push_subs").upsert(
          { endpoint: body.subscription.endpoint, subscription: body.subscription, label: "Andi", role: "andi", device_id: null },
          { onConflict: "endpoint" },
        );
        return json({ ok: true });
      }

      case "feelings": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        let q = db.from("love_feelings").select("id, author, mood, body, audio_path, audio_seconds, created_at, seen_at")
          .order("created_at", { ascending: false }).limit(30);
        if (typeof body.before === "string") q = q.lt("created_at", body.before);
        const { data } = await q;
        return json({
          feelings: (data ?? []).map((f) => ({
            id: f.id, author: f.author, mood: f.mood, moodLabel: f.mood ? MOODS[f.mood] : null, body: f.body,
            audio: !!f.audio_path, seconds: f.audio_seconds, created_at: f.created_at, seen: !!f.seen_at,
          })),
        });
      }

      case "feeling_audio": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        const { data: f } = await db.from("love_feelings").select("audio_path").eq("id", body.id).maybeSingle();
        if (!f?.audio_path) return json({ error: "not found" }, 404);
        const { data, error } = await db.storage.from("feelings").createSignedUrl(f.audio_path, 60 * 30);
        if (error) throw error;
        return json({ url: data.signedUrl });
      }

      case "feelings_seen": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        await db.from("love_feelings").update({ seen_at: new Date().toISOString() }).is("seen_at", null);
        return json({ ok: true });
      }

      case "feeling_delete": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        const { data: f } = await db.from("love_feelings").select("audio_path").eq("id", body.id).maybeSingle();
        if (f?.audio_path) await db.storage.from("feelings").remove([f.audio_path]);
        await db.from("love_feelings").delete().eq("id", body.id);
        return json({ ok: true });
      }

      case "devices": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        const { data } = await db.from("love_devices").select("id, label, ua, approved, created_at, last_seen, love_push_subs(endpoint)")
          .order("created_at", { ascending: false });
        return json({
          // deno-lint-ignore no-explicit-any
          devices: (data ?? []).map((d: any) => ({
            id: d.id, label: d.label, ua: d.ua, approved: d.approved, created_at: d.created_at, last_seen: d.last_seen,
            notifications: (d.love_push_subs ?? []).length > 0,
          })),
        });
      }

      case "device_approve": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        await db.from("love_devices").update({ approved: true }).eq("id", body.id);
        return json({ ok: true });
      }

      case "device_remove": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        await db.from("love_devices").delete().eq("id", body.id);
        return json({ ok: true });
      }

      case "countdown_set": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        const at = new Date(String(body.at || ""));
        if (isNaN(at.getTime())) return json({ error: "pick a date and time" }, 400);
        if (at.getTime() <= Date.now()) return json({ error: "pick a time in the future" }, 400);
        if (at.getTime() > Date.now() + 5 * 365 * 86400_000) return json({ error: "that's too far away ♡" }, 400);
        const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
        await db.from("love_config").upsert(
          [{ key: "countdown_at", value: at.toISOString() }, { key: "countdown_label", value: label }],
          { onConflict: "key" },
        );
        const days = Math.ceil((at.getTime() - Date.now()) / 86400_000);
        const when = days <= 1 ? "less than a day to go" : `${days} days to go`;
        const result = await pushTo(await herSubs(), {
          title: "⏳ Andi started a countdown", body: `${label || "Something special is coming"} · ${when} ♡`, url: "/", tag: "countdown",
        });
        return json({ ok: true, countdown: { at: at.toISOString(), label }, notified: result.sent });
      }

      case "countdown_clear": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        await db.from("love_config").delete().in("key", ["countdown_at", "countdown_label"]);
        return json({ ok: true });
      }

      case "cards_get": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        return json({ cards: await getCards() });
      }

      case "cards_set": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        if (!Array.isArray(body.cards)) return json({ error: "bad cards" }, 400);
        const cards = body.cards.map((t: unknown) => (typeof t === "string" ? t.trim() : "")).filter(Boolean);
        if (!cards.length) return json({ error: "keep at least one card ♡" }, 400);
        if (cards.length > 30) return json({ error: "30 cards at most" }, 400);
        if (cards.some((t: string) => t.length > 500)) return json({ error: "each card can have up to 500 characters" }, 400);
        await db.from("love_config").upsert({ key: "cards", value: JSON.stringify(cards) }, { onConflict: "key" });
        let notified = 0;
        if (body.notify) {
          notified = (await pushTo(await herSubs(), { title: "💌 Andi", body: "He left you something new on your cards ♡", url: "/", tag: "cards" })).sent;
        }
        return json({ ok: true, cards, notified });
      }

      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});
