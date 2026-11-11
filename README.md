# For her 💌

Static site, no build step: postcards (`index.html`, `styles.css`, `app.js`) plus love notes (`love.css`, `love.js`, `sw.js`).
The diary lives on the `diary` branch.

## Deploy to Vercel
Import the GitHub repo at vercel.com/new, Framework preset: "Other". Every push to `main` redeploys.

## Her side
- **🔔 notification center**: every note Andi sent, newest first, unread badge, "show all". Also where she turns on pop-up notifications (iPhone: after adding the site to the Home Screen).
- **🫙 feelings jar**: optional mood check-in, text and/or a voice memo (up to 3 min, recorded by the browser).
  "Share with Andi" is ticked by default: it's sent to Andi and nothing stays on her phone.
  Unticked: "Let it go" — nothing is sent or saved anywhere.
- **📲 add to home**: native install on Android, step-by-step guide on iPhone.
- A phone must be approved by Andi before it can read his notes or send feelings.

## Andi's panel
Type the name **onimaru** on the first card (or tap one of his notifications). Passcode on first use, remembered after.
- **💌 Send**: pick a note or write one, Notify ♡. Notes go to her approved phones and into her inbox.
- **💭 From her**: everything she shared (mood, text, voice memos), with "notify me" for this phone.
- **📱 Phones**: approve or remove her phones.

Backend: Supabase Edge Function `love-notes` (`supabase/functions/love-notes`), tables and the private
`feelings` storage bucket in `supabase/migrations/`.

## Testing tips
- Add `?reset` to the URL to wipe saved postcard progress.
- Accepted names: ada, adela, adelka, adys, adysa (any case, accents, emoji or symbols ignored).
