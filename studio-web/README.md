# Repple Studio — web

The desk where a gym is run. Phase 0 of the web roadmap: the shell everything
else hangs on.

## Running it

    cd studio-web
    npm install
    npm run dev        # http://localhost:3100

`.env.local` holds `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
They are the same values as the `EXPO_PUBLIC_` pair in the repo root `.env` —
publishable, not secret, already inlined into the shipped phone apps. The file
is gitignored anyway.

Sign in with the same account you use in the Repple Studio app. The console
requires the `owner` role; anything else gets told so rather than shown an empty
dashboard.

## Why it can talk to Supabase directly

There is no bespoke API in front of the database. Every table carries row-level
policies, and those policies — not this app — decide what a signed-in person can
read. The web console authenticates as the same user and inherits exactly the
same limits as the phone app, so there is no second permission model to keep in
step.

## Sharing code with the phone app

`next.config.mjs` sets `experimental.externalDir`, which lets Next compile
TypeScript from outside its own directory. `@lib/*` resolves to `../src/lib/*`,
so the analytics run here from the same source the app uses:

- `gymRollup`, `trainerHealth` — `src/lib/ownerAnalytics.ts`
- `fetchGymTrainers`, `payroll30For` — `src/lib/gymTrainers.ts`

45 of the 50 modules in `src/lib` import neither React nor React Native, which
is what makes this possible. Anything reached from here must stay that way — if
a module starts importing `react-native`, this build breaks.

## The rule about numbers

A figure with no value renders as `—`, never `0`. A gym that has recorded no
sessions and a gym with zero sessions are different facts, and the console is
not allowed to blur them. `payroll30For` returns `null` when no session fee is
set, and the KPI says *no session fee set* rather than showing a confident zero.

## What is here

    app/page.tsx          overview: KPIs + roster, or sign-in
    components/Shell.tsx  role-filtered navigation, gym name, sign out
    components/DataTable  the sortable table primitive the console is built on
    lib/supabase.ts       client + `loadMe()` (who you are, per the database)

## What is next

Phase 1 of the roadmap — recording what happens. Every operational and financial
table is still empty in production, so there is nothing yet for a money screen
to draw. Capture comes before charts.
