# BCIL Live: Setup Guide

This guide takes BCIL Live from code to a working app on students' phones. Part A is for anyone at BCIL; part B is for the developer or volunteer who puts it online.

## What's in this folder

| Folder | What it is |
| --- | --- |
| `app/` | The app people use on their phones and laptops (React, installable from the browser) |
| `supabase/schema.sql` | The database: accounts, chat, live sessions, forms, gifts, quotes, with security rules |
| `supabase/functions/live-token` | Gives each person a pass to join a live session as a listener or speaker |
| `supabase/functions/give` | Starts a Mobile Money payment with Paystack |
| `supabase/functions/paystack-webhook` | Marks a gift as paid when Paystack confirms it |

## Part A: Accounts BCIL creates (no coding)

Use the BCIL email (bcilfound@gmail.com) for all of these so the accounts belong to the Foundation, not to one person.

1. **GitHub** (stores the code). Go to github.com, sign up and choose the free plan. Name it something like `bcilfoundation`. Then connect it to Claude: claude.ai, then Settings, then Connectors, then GitHub.
2. **Supabase** (accounts, database, chat). Go to supabase.com and sign up with the BCIL email. Create a project called `bcil-live`, choose the region closest to Ghana (Europe West is usually fastest), and save the database password somewhere safe. Start on the free plan; move to Pro (US$25 a month) before launch, because free projects pause after a week without use.
3. **Agora** (live audio). Go to agora.io and sign up. Create a project called `bcil-live` with "Secured mode: App ID + Token". Note the **App ID** and **App Certificate**. The first 10,000 minutes each month are free.
4. **Paystack** (Mobile Money). Go to paystack.com and sign up as a business in Ghana. To go live, upload the BCIL Foundation LBG registration documents (Certificate of Incorporation, Form 3B) and a GHS bank account. You can test in "Test mode" while you wait for approval.
5. **SMS sign-in codes.** In Supabase, go to Authentication, then Providers, then Phone, and connect an SMS provider (Twilio, MessageBird or Vonage are built in). Or turn on Google sign-in first, which needs no SMS.

**Keep these private:** the Supabase *service role* key, the Agora *App Certificate* and the Paystack *secret key*. Give them only to your developer, in a private message. Never post them in a group chat or put them in the app's code.

## Part B: Putting it online (for the developer)

You need Node.js 20+ and the Supabase CLI (`npm i -g supabase`).

### 1. Database

In the Supabase dashboard, open SQL Editor, paste the whole of `supabase/schema.sql` and click Run. Then make the first admin. Sign up in the app once, then run:

```sql
update profiles set role = 'admin' where phone = '+233XXXXXXXXX';
```

### 2. Server functions

```bash
cd supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase secrets set AGORA_APP_ID=... AGORA_APP_CERTIFICATE=... PAYSTACK_SECRET_KEY=sk_test_...
supabase functions deploy live-token
supabase functions deploy give
supabase functions deploy paystack-webhook --no-verify-jwt
```

In Paystack, go to Settings, then API Keys & Webhooks, and set the webhook URL to `https://YOUR-PROJECT-REF.supabase.co/functions/v1/paystack-webhook`.

### 3. The app

```bash
cd app
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # try it at http://localhost:5173
npm run build             # makes the dist/ folder to publish
```

Publish `app/dist` on Cloudflare Pages or Netlify (both have free plans). Connect the GitHub repo, set the build command to `npm run build`, the folder to `app/dist`, and add the two `VITE_` values as environment variables. Then point `live.bcilfoundation.org` at it.

In Supabase, go to Authentication, then URL Configuration, and add the site address so Google sign-in returns to the app.

### 4. Test before launch

- [ ] Sign up with a phone number and with Google
- [ ] Post in BCIL Community; check that a normal member cannot post in Announcements
- [ ] Join "FCB 2027 Cohort" with the code `FCB-2027`
- [ ] Admin: create a live session in the database (`live_sessions`, status `live`); two phones join; one requests to call in; the admin brings them on air
- [ ] Submit each FCB form; check the responses in Supabase
- [ ] Give GH₵ 1 in Paystack test mode and see it turn "paid"

## What's built and what's next

**Built in this first version:** sign-in, Home (FCB banner, next live session, today's quote), the live room (listen, request to call in, host queue, bring on air, live chat, lock chat, end session), the chat room with real-time messages, invite codes and reporting, forms with "My responses", and Mobile Money giving with history.

**Next:** Library from YouTube, the Daily Quotes page, the admin screens (today admins use the Supabase dashboard), live session recording to the Library, notifications, and then phase 2 (notes, booking, needs, photos, Play Store and App Store).
