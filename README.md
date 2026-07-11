# Repple (production scaffold)

White-label fitness platform — Expo (iOS + Android) + Supabase + Stripe.
Ported from the validated prototype. See **README-PHASE-0.md** to set up accounts.

## Runs standalone right now (no accounts needed)
The app boots on **mock data**, so you can see it in Expo Go before any backend:
```
npm install
npx expo start   # scan the QR with Expo Go on your phone
```
It opens a home menu → tap into Dashboard, Workouts, Meal Plan, InBody Scans,
Book Sessions, My Profile, and the Coach Overview. Every screen is driven by the
real ported logic (nutrition engine, booking rules, age-from-DOB).

Verify the logic with no accounts:
```
npm run test:logic     # ALL PRODUCTION-LOGIC TESTS PASSED
```

## Layout
- `src/lib/` — tested pure logic: nutrition (+ meal-plan generator), booking, age, format
- `src/lib/mockData.ts` — demo dataset (swap for Supabase queries)
- `src/ui/components.tsx` — shared Screen/Card/Tile/Btn primitives
- `src/theme/tokens.ts` — dark/light design tokens
- `app/` — Expo Router screens: home + client (dashboard, workouts, nutrition,
  scans, calendar, profile) + trainer (dashboard)
- `supabase/schema.sql` — full database schema + RLS starters

## Going live (Phase 1)
Fill `.env` from `.env.example` after creating the Supabase/Stripe accounts, then
replace the `MOCK_*` imports with Supabase queries. Checklist in README-PHASE-0.md.
