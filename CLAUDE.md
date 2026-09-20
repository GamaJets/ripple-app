# Repple

White-label fitness platform. Expo (React Native, expo-router) + Supabase, plus a
Next.js operator console. Three app variants off one tree, selected by
`EXPO_PUBLIC_APP_VARIANT`: client, trainer, owner.

## Read this before opening a file

This repository's sessions were measured on 20 Sep 2026 at **500,000-540,000
tokens of context per turn**. Context is re-billed on every turn, so that number
is the cost of working here, and it is dominated by eight files:

| lines | ~cost to open | file |
| ----: | ------------: | ---- |
| 7,357 | ~117k tokens | `app/(client)/workouts.tsx` |
| 5,229 | ~87k | `src/lib/coverage.test.ts` |
| 5,154 | ~78k | `app/(trainer)/calendar.tsx` |
| 5,116 | ~79k | `app/(trainer)/builder.tsx` |
| 4,978 | ~80k | `app/(trainer)/dashboard.tsx` |
| 4,252 | ~56k | `studio-web/app/accounting/page.tsx` |
| 3,347 | ~54k | `app/(trainer)/payments.tsx` |
| 3,297 | ~44k | `studio-web/app/close/page.tsx` |

Opening `workouts.tsx` costs more than half a 200k window, and it stays open —
and charged — for every turn that follows. Four screens is ~350k tokens before
anything has been thought about.

So: **never read one of these whole.** `docs/CODEMAP.md` indexes all 46 files
over 1,500 lines with a line-anchored map of every section, function and banner
comment. Grep it for the file you want, take the range, read the range:

```bash
awk '/^## `app\/\(client\)\/workouts.tsx`/{f=1} f{print} f&&/^```$/&&++c==2{exit}' docs/CODEMAP.md
```

That lookup costs ~1.6k tokens instead of 117k. It is generated — run
`npm run codemap` after any large edit, because line numbers drift.

Do not read `docs/CODEMAP.md` whole either; it is ~30k tokens.

The same applies to the long planning documents: `docs/ROADMAP.md` (80 KB),
`docs/LAUNCH-CHECKLIST.md` (35 KB), `REDESIGN-HANDOFF.md` (32 KB),
`docs/WHITE-LABEL.md` (30 KB). Grep for the section you need.

## Where things are

    app/                 166 files   expo-router screens
      (client)/                      the member-facing app
      (trainer)/                     the coach-facing app
      (owner)/                       the gym-owner app
    src/lib/           1,216 files   all logic and all data access; flat, one
                                     concern per file, each with its .test.ts
    src/ui/              232 files   shared components (kit.tsx is the design system)
    src/theme/                       tokens
    studio-web/           67 files   Next.js operator console, its own package
    supabase/parts/      352 files   numbered SQL parts; setup.sql is BUILT from
                                     them by `npm run db:build` — never edit it
    supabase/functions/              edge functions
    scripts/              80 files   the gates (see below)
    modules/                         local Expo native module (workout-activity)
    web/                             static marketing site
    docs/                            planning documents, and CODEMAP.md

`src/lib` is flat and large on purpose. Find things by name, not by browsing:
`git ls-files 'src/lib/*<thing>*'` beats `ls src/lib`, which is 1,216 lines.

## Commands

    npm test              full logic suite (~600 files). Silent on success.
    npm run test:logic    one file, fast
    npm run typecheck     the app tree's own tsconfig
    npm run check:all     65 gates
    npm run preflight     typecheck + test:zones (suite x6 timezones) + check:all + check:schema
    npm run codemap       regenerate docs/CODEMAP.md
    npm run db:build      rebuild supabase/setup.sql from supabase/parts/

Everything is quiet when it passes, so run the narrow thing first and only
reach for `preflight` before publishing.

## Conventions

Gates carry their incident in a comment at the top of the script and their
reason in a `//<name>` key in `package.json`. Read that comment before working
around a gate — it usually records what shipped broken last time.

Every gate has a marker escape (`path-ok:`, `prose-ok:`, `grant-ok:`,
`provider-value-ok:`) that must carry a reason. A bare marker does not count.

`docs/**/*.md` is gated by `check:doc-paths`: every repo path in an inline code
span must resolve, and `file.ts:123` must name a line the file has.

Work happens on `redesign`. `main` exists; `repple-redesign` is a second
checkout at `~/Documents/ChatGPT/REPPLE App Redesign`.
