# For her 💌

Static site, no build step: postcards (`index.html`, `styles.css`, `app.js`) and a diary (`diary.css`, `diary.js`).

## Deploy to Vercel
Import the GitHub repo at vercel.com/new, Framework preset: "Other". Every push to `main` redeploys.

## Diary
- Opens from the **diary** button in the top bar (appears after the name check), or at `/#diary`.
- Pages are stored in Supabase (project `qjlnulbynqmhhoehbwrw`), schema in `supabase/migrations/`.
  Each phone gets its own random diary secret; only that phone can read its pages.
- **Share** (tap twice) sends that day to Andi's mailbox and fires a push notification.

## Andi's mailbox (notifications)
1. Open your private mailbox link (`/andi.html?k=…`) in Safari on your iPhone.
2. Share → **Add to Home Screen**, then open **Mailbox** from the Home Screen.
3. Tap **Turn on notifications**, then **Send a test**.

Only pages she taps Share on are ever sent. The push sender is the Supabase Edge Function
in `supabase/functions/diary` (deployed as `diary`).

## Testing tips
- Add `?reset` to the URL to wipe saved postcard progress.
- Accepted names: ada, adela, adelka, adys, adysa (any case, accents, emoji or symbols ignored).
