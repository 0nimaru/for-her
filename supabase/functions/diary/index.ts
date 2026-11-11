// Diary sharing + Web Push for Andi's "mailbox".
//
// Actions (POST JSON { action, ... }):
//   share      { secret, date, name }    - she shares one day; Andi's devices get a push
//   vapid      {}                        - public VAPID key for subscribing
//   subscribe  { token, subscription }   - Andi registers a device (needs mailbox token)
//   inbox      { token }                 - Andi reads the pages she chose to share
//   test       { token }                 - send a test notification to Andi's devices
//
// Only pages she explicitly shares are ever sent or readable here.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getConfig(key: string) {
  const { data } = await db.from("diary_config").select("value").eq("key", key).maybeSingle();
  return data?.value as string | undefined;
}

let vapidCache: { publicKey: string; privateKey: string } | null = null;
async function vapid() {
  if (vapidCache) return vapidCache;
  let pub = await getConfig("vapid_public");
  let priv = await getConfig("vapid_private");
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    // insert-only so two cold starts can't overwrite each other
    await db.from("diary_config").upsert(
      [{ key: "vapid_public", value: keys.publicKey }, { key: "vapid_private", value: keys.privateKey }],
      { onConflict: "key", ignoreDuplicates: true },
    );
    pub = await getConfig("vapid_public");
    priv = await getConfig("vapid_private");
  }
  vapidCache = { publicKey: pub!, privateKey: priv! };
  webpush.setVapidDetails("https://github.com/0nimaru/for-her", pub!, priv!);
  return vapidCache;
}

async function checkToken(token: unknown) {
  if (typeof token !== "string" || token.length < 16) return false;
  const expected = await getConfig("mailbox_token_hash");
  return !!expected && (await sha256(token)) === expected;
}

async function pushAll(payload: Record<string, unknown>) {
  await vapid();
  const { data: subs } = await db.from("diary_push_subs").select("endpoint, subscription");
  let sent = 0;
  const failures: string[] = [];
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 60 * 60 * 24 * 7, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("diary_push_subs").delete().eq("endpoint", s.endpoint);
      failures.push(String(code ?? (e as Error).message).slice(0, 120));
    }
  }
  return { sent, devices: subs?.length ?? 0, failures };
}

const prettyDate = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  try {
    switch (body.action) {
      case "vapid":
        return json({ publicKey: (await vapid()).publicKey });

      case "share": {
        const { secret, date } = body as { secret?: string; date?: string };
        if (typeof secret !== "string" || secret.length < 32) return json({ error: "bad secret" }, 400);
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad date" }, 400);
        const owner = await sha256(secret);
        const { data: entry } = await db.from("diary_entries")
          .select("body, author").eq("owner_hash", owner).eq("entry_date", date).maybeSingle();
        if (!entry || !entry.body.trim()) return json({ error: "nothing to share" }, 404);
        const sharedAt = new Date().toISOString();
        await db.from("diary_entries").update({ shared_body: entry.body, shared_at: sharedAt })
          .eq("owner_hash", owner).eq("entry_date", date);
        const who = (typeof body.name === "string" && body.name.trim()) || entry.author || "She";
        const excerpt = entry.body.replace(/\s+/g, " ").trim().slice(0, 110);
        const result = await pushAll({
          title: `💌 ${who} shared a diary page`,
          body: `${prettyDate(date)} — “${excerpt}${entry.body.length > 110 ? "…" : ""}”`,
          url: "/andi.html",
          tag: "diary-" + date,
        });
        return json({ ok: true, shared_at: sharedAt, ...result });
      }

      case "subscribe": {
        if (!(await checkToken(body.token))) return json({ error: "wrong mailbox link" }, 403);
        const sub = body.subscription as { endpoint?: string; keys?: unknown };
        if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys) return json({ error: "bad subscription" }, 400);
        await db.from("diary_push_subs").upsert({ endpoint: sub.endpoint, subscription: sub }, { onConflict: "endpoint" });
        return json({ ok: true });
      }

      case "inbox": {
        if (!(await checkToken(body.token))) return json({ error: "wrong mailbox link" }, 403);
        const { data } = await db.from("diary_entries")
          .select("entry_date, author, shared_body, shared_at")
          .not("shared_at", "is", null).order("shared_at", { ascending: false }).limit(200);
        return json({ pages: data ?? [] });
      }

      case "test": {
        if (!(await checkToken(body.token))) return json({ error: "wrong mailbox link" }, 403);
        return json(await pushAll({ title: "💌 Mailbox is working", body: "You'll get a note like this whenever she shares a diary page.", url: "/andi.html", tag: "test" }));
      }

      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});
