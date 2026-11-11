// Love notes: Andi sends a push notification to every phone that turned on
// "love notes" from the home-screen app.
//
// POST JSON { action, ... }:
//   vapid        {}                         - public VAPID key for subscribing
//   subscribe    { subscription, label }    - her phone opts in
//   unsubscribe  { endpoint }
//   status       { key? }                   - { claimed, keyOk, devices }
//   claim        { key }                    - first use only: sets Andi's sender passcode
//   notify       { key, body }              - send a love note to all subscribed phones
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

async function deviceCount() {
  const { count } = await db.from("love_push_subs").select("endpoint", { count: "exact", head: true });
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  try {
    switch (body.action) {
      case "vapid":
        return json({ publicKey: await vapid() });

      case "subscribe": {
        const sub = body.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
          return json({ error: "bad subscription" }, 400);
        }
        const label = typeof body.label === "string" ? body.label.slice(0, 40) : null;
        await db.from("love_push_subs").upsert({ endpoint: sub.endpoint, subscription: sub, label }, { onConflict: "endpoint" });
        return json({ ok: true });
      }

      case "unsubscribe": {
        if (typeof body.endpoint === "string") await db.from("love_push_subs").delete().eq("endpoint", body.endpoint);
        return json({ ok: true });
      }

      case "status": {
        const claimed = !!(await getConfig("sender_key"));
        const ok = body.key ? await keyOk(body.key) : false;
        return json({ claimed, keyOk: ok, devices: ok ? await deviceCount() : undefined });
      }

      case "claim": {
        const pass = body.key;
        if (typeof pass !== "string" || pass.length < 6) return json({ error: "passcode must be at least 6 characters" }, 400);
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        const value = `${salt}:${await pbkdf2(pass, salt)}`;
        // insert-only: once claimed, it can't be overwritten from the website
        const { data } = await db.from("love_config").upsert({ key: "sender_key", value }, { onConflict: "key", ignoreDuplicates: true }).select();
        if (!data?.length) return json({ error: "already set" }, 409);
        return json({ ok: true, devices: await deviceCount() });
      }

      case "notify": {
        if (!(await keyOk(body.key))) return json({ error: "wrong passcode" }, 403);
        const text = typeof body.body === "string" ? body.body.trim() : "";
        if (!text || text.length > 300) return json({ error: "write 1–300 characters" }, 400);
        await vapid();
        const { data: subs } = await db.from("love_push_subs").select("endpoint, subscription");
        const payload = JSON.stringify({ title: "💌 Andi", body: text, url: "/", tag: "love-" + Date.now() });
        let sent = 0;
        const failures: string[] = [];
        await Promise.all((subs ?? []).map(async (s) => {
          try {
            await webpush.sendNotification(s.subscription, payload, { TTL: 60 * 60 * 24 * 3, urgency: "high" });
            sent++;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) await db.from("love_push_subs").delete().eq("endpoint", s.endpoint);
            failures.push(String(code ?? (e as Error).message).slice(0, 120));
          }
        }));
        await db.from("love_notes").insert({ body: text, devices: sent });
        return json({ ok: true, sent, devices: subs?.length ?? 0, failures });
      }

      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});
