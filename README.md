# For her 💌

Static site, no build step: postcards (`index.html`, `styles.css`, `app.js`) plus love notes (`love.css`, `love.js`, `sw.js`).
The diary lives on the `diary` branch.

## Deploy to Vercel
Import the GitHub repo at vercel.com/new, Framework preset: "Other". Every push to `main` redeploys.

## Love notes (push notifications)
- **Her phone:** after the name check, a **🔔 love notes** button appears. On iPhone she first adds the
  site to her Home Screen (Share → Add to Home Screen), opens it from there and taps the bell.
  On Android, tapping the bell in Chrome is enough (installing to the Home Screen is optional).
- **You:** type the name **onimaru** on the first card. Pick a note or write your own, then **Notify ♡**.
  The first time, you create a sender passcode (6+ characters); it's remembered on your phone.
- Every phone that turned on love notes gets the notification.
- Backend: Supabase Edge Function `love-notes` (`supabase/functions/love-notes`), tables in `supabase/migrations/`.

## Testing tips
- Add `?reset` to the URL to wipe saved postcard progress.
- Accepted names: ada, adela, adelka, adys, adysa (any case, accents, emoji or symbols ignored).
