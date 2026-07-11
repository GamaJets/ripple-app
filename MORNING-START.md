# ☀️ Morning Start Guide — Repple

This is the exact sequence for our first working session on the real app. It gets
you from "accounts" to "the app talking to a real database on your phone." Follow
it top to bottom; every step says whether **you** do it or **I** (Claude) do it.
Nothing here is risky or irreversible, and I'll be with you the whole time — just
tell me where you are and paste back anything the screen shows you.

Total hands-on time: about **45–60 minutes**, most of it waiting on installs.

---

## Before you start — 2 things to have ready
1. Your Mac (for building), and your iPhone with the **Expo Go** app installed
   (free, from the App Store) so you can run the app instantly without waiting on
   Apple review.
2. A card for the accounts (Supabase is free to start; Apple $99/yr you already
   have; Google $25 one-time can wait until we're ready to ship Android).

> **Brand is locked: Repple.** The whole scaffold is branded — app name **Repple**,
> bundle ID **`com.repple.app`**, the ripple-rings icon, and teal `#2dd4bf`. Use
> `com.repple.app` exactly as written when you create the App Store record so it
> matches `app.json`. (The store *display name* can still be tweaked later; the
> bundle ID is the one thing that's painful to change after the record exists.)

---

## Step 1 — Boot the app on your phone (mock data) · ~10 min · YOU
This proves the whole thing runs before we add a backend.

1. Install Node LTS from nodejs.org if you don't have it.
2. In the project folder, run:
   ```
   npm install
   npm run test:logic      # should print: ALL PRODUCTION-LOGIC TESTS PASSED
   npx expo start
   ```
3. Scan the QR code with your iPhone camera → it opens in Expo Go.
4. You'll see the role chooser (Client / Trainer / Owner) running on the built-in
   demo data. **This is running the exact nutrition + booking + meal logic from
   the prototype**, now as a real native app.

✅ **Checkpoint:** app opens on your phone. If anything errors, paste it to me.

---

## Step 2 — Create the Supabase backend · ~10 min · YOU (I'll guide each field)
1. Go to **supabase.com** → sign up (free) → **New project**.
   - Name: `repple`
   - Database password: let it generate one, save it in your password manager.
   - Region: **Frankfurt** (eu-central) or **Mumbai** — both are close to the UAE.
2. Wait ~2 min for it to provision.
3. Left sidebar → **SQL Editor** → **New query**. Open `supabase/schema.sql` from
   this repo, copy **all** of it, paste, and click **Run**. You should see
   "Success. No rows returned." That just built every table (clients, scans,
   sessions, meal plans, messages, food logs, notifications…) with the multi-tenant
   security rules.
4. Left sidebar → **Storage** → create two **private** buckets: `scans` and
   `photos`. (These hold InBody uploads and progress photos.)
5. Left sidebar → **Project Settings → API**. Copy two values:
   - **Project URL**
   - **anon public** key (the long one labelled `anon` / `public` — *not* the
     service_role key; never share that one).

✅ **Checkpoint:** schema ran clean, you have the URL + anon key copied.

---

## Step 3 — Connect the app to Supabase · ~5 min · YOU
1. In the project folder, copy `.env.example` to a new file named `.env`.
2. Paste your two values in:
   ```
   EXPO_PUBLIC_USE_SUPABASE=1
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...your anon key...
   ```
   (Leave the Stripe lines as-is for now — we wire billing in a later session.)
3. Stop Expo (Ctrl-C) and re-run `npx expo start`.

That `EXPO_PUBLIC_USE_SUPABASE=1` flag is the single switch that flips the app
from mock data to your real database (it's read in `src/data/repo.ts`). Flip it
back to `0` any time to demo offline.

✅ **Checkpoint:** app still boots. It'll show empty/real data now instead of the
demo seed — that's expected, because your database is brand new. Our first
Phase-1 job together is the sign-up screen + seeding your own trainer account.

---

## Step 4 — Create the App Store Connect record · ~10 min · YOU
You already have the Apple Developer account, so:

1. Go to **appstoreconnect.apple.com** → **My Apps** → **＋ → New App**.
2. Fill in:
   - Platform: **iOS**
   - Name: your public app name (this is the store display name — can differ from
     the bundle ID; e.g. "Repple" or your chosen brand).
   - Primary language: English.
   - Bundle ID: choose **`com.repple.app`** from the dropdown. If it's not there
     yet, open **developer.apple.com → Certificates, IDs & Profiles → Identifiers
     → ＋** and register `com.repple.app` first, then come back.
   - SKU: `repple-001` (any unique string, internal only).
   - User Access: Full Access.
3. Click **Create**. You don't need screenshots or descriptions yet — I'll
   generate all of those store-listing assets when we're ready to submit.

✅ **Checkpoint:** the app record exists in App Store Connect, "Prepare for
Submission" state. That's all we need this morning.

---

## Step 5 — Hand back to me: "start Phase 1"
Once Steps 1–4 are done, message me **"Phase 1"** and I'll immediately start
building, in this order:
1. **Auth screens** — sign up / sign in (the helpers are already written in
   `src/lib/supabase.ts`), and creating your own trainer + tenant row so you can
   log in as the real platform owner.
2. **Wire the client dashboard, nutrition, meal plan, grocery list, food log and
   messaging screens** to the live repo — the logic is already ported and tested,
   so this is mostly rendering.
3. **A TestFlight build** you install on your own phone from the TestFlight app.

Everything I build comes with a one-line "here's what to tap to test it."

---

## Quick reference — who does what
| Thing | You | Me (Claude) |
|---|---|---|
| Create accounts, paste keys, run `npm`/`expo` commands | ✅ | |
| Click "Create", "Run", "Submit for review" | ✅ | |
| All code, schema, screens, debugging | | ✅ |
| Store listing text + screenshots | | ✅ |
| Deciding the brand name & pricing | ✅ | (I advise) |

## If something breaks
Paste me the exact error text or a screenshot. The most common first-morning
snags and their fixes:
- **`npm install` fails** → make sure you're on Node 18+ (`node -v`).
- **Expo Go shows a red screen** → copy the top line of the error to me.
- **Supabase "permission denied for table…"** → that's Row-Level Security doing
  its job; it means we need a policy or a signed-in user. Tell me which table and
  I'll adjust `schema.sql`.
- **Schema "relation already exists"** → you ran it twice; harmless, or I'll give
  you a reset snippet.
