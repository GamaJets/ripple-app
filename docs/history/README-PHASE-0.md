# Repple — Phase 0 Setup Checklist

This is the production scaffold for the real iOS + Android apps. Everything here
maps directly from the working prototype. Phase 0 is the accounts + first-run
setup — the parts only you (Timothy) can do because they need your identity and a
card. Each item is ~5–15 minutes. Do them in order.

## What's already in this repo
- `src/lib/` — the **real business logic**, ported and unit-tested (nutrition
  engine, 24-hour cancellation rules, age-from-DOB). Run `npm run test:logic`.
- `supabase/schema.sql` — the full database (tenants, clients, scans, sessions,
  waitlist, charges, notifications…) with row-level-security starters.
- `app/` — Expo Router app shell + a wired client dashboard showing the pattern.
- `src/theme/tokens.ts` — the dark/light design tokens from the prototype.

## Your Phase 0 checklist

### 1. Install the toolchain (on your Mac)
- [ ] Install Node LTS and `npm i -g expo` (or use `npx`).
- [ ] In this folder: `npm install`, then `npm run test:logic` (should print
      "ALL PRODUCTION-LOGIC TESTS PASSED"), then `npx expo start` to boot it in
      the Expo Go app on your phone.

### 2. Supabase (database + auth + storage) — ~10 min
- [ ] Create a free account at supabase.com and a new project (region: closest
      to your users; UAE → Frankfurt or Mumbai).
- [ ] Open the SQL editor, paste `supabase/schema.sql`, run it.
- [ ] Project Settings → API: copy the Project URL and the `anon` public key.
- [ ] Create `.env` from `.env.example` and paste them in.
- [ ] Create two Storage buckets: `scans` and `photos` (private).

### 3. Apple Developer — ~15 min + Apple's approval wait
- [ ] Enrol at developer.apple.com ($99/year). A UAE individual/company account
      works. This is required to put an app on iPhones and in the App Store.
- [ ] Once approved, in App Store Connect create an app record with bundle id
      `com.repple.app` (matches `app.json`).

### 4. Google Play — ~10 min
- [ ] Create a Play Console account at play.google.com/console ($25 one-time).

### 5. Stripe (trainer subscriptions + session fees) — ~10 min
- [ ] Create a Stripe account. Add three subscription Products: Starter $49,
      Pro $99, Studio $249 (monthly).
- [ ] Copy the publishable + secret keys into `.env` (secret key server-side only).

### 6. Tell Claude "start Phase 1"
Once the above exist, we build the client MVP on TestFlight together: I write the
screens (they port from the prototype), you install from TestFlight and test on
your own phone. Recruit 3–5 trainers for the beta in parallel (the pitch deck is
ready).

## What Claude does vs what you do
- **Claude:** all code, schema changes, screen builds, store-listing text,
  screenshots, debugging.
- **You:** create the accounts above, pay the fees, install test builds on your
  phone, and click "Submit for review". Every submission comes with a checklist.

## Cost so far (Phase 0)
Apple $99/yr · Google $25 once · Supabase free→$25/mo · Stripe pay-per-use ·
domain ~$12/yr. **≈ $140 to start.** Full year-one budget is in
`Repple-Production-Build-Plan.docx`.
