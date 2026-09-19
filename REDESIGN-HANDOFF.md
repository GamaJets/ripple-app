# Repple redesign — session handoff

**Written:** 19 Sep 2026 · **Branch:** `redesign` · **HEAD:** see `git log` (was `473e737` at first writing; the second session is recorded in §4b) · **Tree:** clean, `tsc` 0
**For:** a fresh session with no prior context.

---

## 1. Read this first — what the last session got wrong

Two mistakes, both mine, both worth not repeating:

**I redrew the mockups instead of porting the code.** Commits `40bf9ee` ("rebuild client surfaces
from approved mockups") and `a0f77db` ("rebuild coach priority workflows from approved mockups")
on branch `repple-redesign` **already implement the redesign** — 849 lines across 13 screens. I spent
several turns hand-drawing HTML approximations of the mockup board instead of reading and porting that
code. **Don't mock up. Port.**

**I never opened the high-res board.** `docs/claude-handoff/repple-approved-mockups-high-res.png`
was in the handoff the whole time. I ran `file` on it, saw the dimensions, assumed it matched the
low-res chat attachment, and worked from the attachment. Open it.

---

## 2. Where everything is

| | |
|---|---|
| **Working branch** | `redesign` — created from `overnight-wave`, HEAD `473e737` |
| **ChatGPT's branch** | `repple-redesign` — checked out at `~/Documents/ChatGPT/REPPLE App Redesign`. **User has stopped using ChatGPT; that session is no longer active.** |
| **Audit trunk** | `overnight-wave` — 293 commits of correctness work |
| **`main`** | Untouched. The brief forbids modifying, merging into, rebasing or resetting it. |
| **The brief** | `docs/claude-handoff/CLAUDE-CODE-REDESIGN-BRIEF.md` |
| **The roadmap** | `docs/REDESIGN-20-LANES.md` |
| **The approved board** | `docs/claude-handoff/repple-approved-mockups-high-res.png` (1536×1024) |

---

## 3. The reconciliation decision — the single most important thing

`repple-redesign` branched from `f01a129` on **2 September**. Since then:

- **293 commits** on the audit trunk it does not have
- **29 commits** on it the trunk does not have
- **34 files touched by both**

**The audit is the trunk; the redesign gets ported onto it. Not the reverse.** Two reasons:

**Size.** The redesign is 42 files / 2,590 lines. On almost every collision file the audit did far
more work — `workouts.tsx` is 85 lines redesigned against 2,941 audited, `calendar.tsx` 192 against
2,686, `builder.tsx` 79 against 1,693.

**Schema.** Parts **3150, 3180 and 3190 are applied to the live database** and are missing from
`repple-redesign`. Part 3180 turned `cancel_class` from a `DELETE` into an `UPDATE`, so a cancelled
class booking now **survives as a row** with `status = 'cancelled'`. Code written before it asks
"is there a row?" and gets *yes* for a class the member cancelled — which renders as
*"Booked — still to come."* Merging the redesign over the audit would ship that back.

### The 34 collision files
```
app/(client)/   classes dashboard nutrition profile scans workouts
app/(trainer)/  _layout analytics builder calendar classes client dashboard
                messages profile sessions
app/            welcome
src/ui/         kit
web/            client delete-account download forgot-password how-it-works index
                pricing privacy reset-password security signup studio styles
                support terms trainer
```
Only five where the redesign did more than the audit: `_layout.tsx` (179 v 54), `welcome.tsx`
(93 v 14), `web/index.html` (940 v 254), `web/styles.css` (55 v 210 — audit still larger), and
`app/(trainer)/dashboard.tsx` is close (266 v 1924 — audit much larger).

---

## 4. What has been done on `redesign` so far

**`cacd805` — coach six-tab navigation ported.** Clients · Programs · Schedule · Videos · Analytics ·
Profile, everything else `href: null`. Three audit fixes re-applied that the redesign branch lacked:

- **The auth gate.** `authed` is checked in `app/index.tsx` and nowhere else, and a deep link or
  tapped notification lands on the portal layout directly. Without it, person B taps Sign Out on
  person A's locked phone and is left inside A's portal.
- **Hook order** — hooks now run before the variant early-return.
- **Four unregistered routes** — `client-cancellations`, `account`, `join-code`, `devices`.

**`473e737` — eight conflict-free files ported** (roadmap, `scripts/preview-web.mjs`,
`src/ui/coach/ProgramBuilderFlow.tsx`, `src/ui/coach/ScheduleOperations.tsx`, four website
stylesheets) plus `docs/claude-handoff/`.

---

## 4b. What the second session did (19 Sep, evening)

Ported, file by file, re-applying audit fixes on every collision — never a wholesale checkout:

- **Kit:** `ScreenHeader`; `SectionHead` stacks at large text; **`Section` is now a card** (the single
  largest visible gap to the board), 324 between-section `<Rule />`s removed, gutter/section 16, title 22,
  `Card` carries a hairline so a card inside a section stays a box, `QuickRow` tiles are white cards.
- **Client:** Home (goal card + tiles, snapshot), Train (programme card off the RepDB demo, Current/Past,
  mode pills), Progress (metric tabs, range chart, grouped grids), Meals (calorie card, Plan/Targets/Recipes),
  Me (card header, stats, rows), Classes, the welcome door.
- **Coach:** Clients (strip, Today, Needs Attention, compact roster), Client Detail, Builder (strip, day pills,
  `ProgramBuilderFlow`, persistent assign bar), Schedule (`ScheduleOperations` with the audit's withdrawn
  Google row), Analytics, Messages, Profile, Classes, Sessions.
- **Website:** homepage = redesign markup + audit head; other pages link their redesign stylesheet;
  `stamp-css` hashes every sheet.
- **Apple Health:** connect() fails when iOS never presented the sheet (`getRequestStatusForAuthorization`);
  the restore loop no longer marks a failing request connected. Unverified on a phone — the simulator has no
  Health data. If a device still says connected with nothing arriving, check the HealthKit capability on the
  client App ID in EAS.
- **Accent:** the board's one-green was applied and **reverted** — `coverage.test.ts` forbids two apps
  sharing an accent and requires each accent to match its icon's hue. Going green needs three new icons and
  the logo SVG. **User's decision.**

Screenshots of the result, beside the board: https://claude.ai/artifact/RCjxmm2weVTsAtQsz8Epvk

Validation at HEAD: `tsc` 0 · `npm test` green · every source gate green (`check:css-stamp` now covers all
five stylesheets; `check:deltas` KNOWN for scans.tsx lowered to 2).

**Next:** the user's verdict on the screenshots and the accent; then Studio/Owner (no board), the new
features the board implies (Community, Rewards, Assessments, Marketplace — each costed separately), and
only after explicit approval the three interactive iOS builds at 1.3.0.

## 4c. The look itself (19 Sep, late evening)

The user said three times that the graphics did not match the board. The layouts did; the LOOK did not,
and the look is kit-level:

- `src/theme/tokens.ts`: **`repple` (light) and `repple-dark`, now the DEFAULT** — white ground, neutral greys,
  near-black ink, one green (#15803d light / #22c55e dark). Green-700 because the Cta label is white and the
  a11y walk holds it to 4.5:1. `Section` is a bordered white card; hand-built cards got the same hairline.
- **One accent for all three apps** — `coverage.test.ts` now asserts the accents are EQUAL; icon plates are
  three green steps; the three icon SVGs recoloured and rasterised (`qlmanage`) into assets/ and web/play/;
  website `--client/--coach/--studio` moved to greens per scheme (measured).
- `ty.micro` is a **bold 13pt title-case label** (was 11pt tracked uppercase — the one habit the board has none
  of); `head` is 700; row icons are circles; tab labels pinned to 11pt so six coach tabs fit.
- Train opens the board's way: Current/Past above the card, name over the picture on a scrim, Start under it.

Screenshots at HEAD: https://claude.ai/artifact/RCjxmm2weVTsAtQsz8Epvk

## 5. What to do next

**Port the implemented screens from `repple-redesign`, file by file, re-applying audit fixes on
collision.** The brief's own order:

1. Client Home (`app/(client)/dashboard.tsx` — redesign 327 lines, audit 656)
2. Coach Clients / attention dashboard (`app/(trainer)/dashboard.tsx` — 266 v 1,924)
3. Client Training (`app/(client)/workouts.tsx` — 85 v 2,941)
4. Coach Client Detail (`app/(trainer)/client.tsx` — 210 v 1,147)
5. Coach Program Builder (`app/(trainer)/builder.tsx` — 79 v 1,693)
6. Client Progress (`app/(client)/scans.tsx` — 151 v 1,284)
7. Coach Schedule (`app/(trainer)/calendar.tsx` — 192 v 2,686)
8. Website homepage (`web/index.html` — 940 v 254; take the redesign's wholesale)

**Method for each:** `git diff <merge-base> repple-redesign -- <file>` to see the redesign's intent,
then apply that *visual* change to the trunk's version by hand. Do **not** `git checkout` a collision
file wholesale — it drops audit fixes silently.

```bash
B=$(git merge-base repple-redesign HEAD)
git diff $B repple-redesign -- 'app/(client)/dashboard.tsx'   # redesign intent
git diff $B HEAD             -- 'app/(client)/dashboard.tsx'  # audit fixes to preserve
```

---

## 6. Navigation (from the brief, confirmed against the code)

- **Client — 5 tabs:** Home · Train · Meals · Progress · Me
- **Coach — 6 tabs:** Clients · Programs · Schedule · Videos · Analytics · Profile ✅ *ported*
- **Studio/Owner — 5 tabs:** Overview · Trainers · Brand · Growth · Ops

**The board has no Studio screens at all** — the brief puts Studio/Owner in scope (lane 20, Phase 4)
but the 60 mockups are Coach, Client and website only. Studio needs its own design decision.

---

## 7. Non-negotiable constraints (from the brief)

Preserve: backend logic and Supabase contracts · existing routes and deep links · auth, roles,
permissions · real data contracts, never fabricate · truthful loading/empty/partial/error/offline
states · offline queue and retry semantics · white-label brands, variants, domains, icons, accents ·
light and dark · accessibility roles, labels, focus order, contrast, reduced motion · Dynamic Type ·
locale, date, unit and currency behaviour.

Also: version stays **1.3.0** for all three apps. No TestFlight build, upload or submission until the
user **explicitly approves screenshots**. A cancelled premature build exists
(`97765325-2551-4013-b97b-9c2c43e081b9`) — not evidence of approval.

---

## 8. The seven rules the audit enforces

Almost every real bug in this codebase was one of these being broken. 65 gates enforce them.

1. **Null is not zero.**
2. **A failed read is not an empty list.**
3. **A partial read is never counted, summed, or called empty.**
4. **Never sum two currencies.** White-labelled — there is no default currency anywhere.
5. **Never claim success from the absence of an error.** (But check it applies: an RLS-violating
   `INSERT` raises `42501` rather than matching zero rows.)
6. **An absence is never a clearance.**
7. **A correction is a second recorded fact, never an erasure.**

Two more, learned the hard way:
- **Commit only when no file in it belongs to a lane still writing it.** Green means *compiles and
  passes*, not *finished*.
- **Mutation fixtures go in a scratchpad, never in `src/`.** One lane broke that and crashed two
  gates for every other lane.

---

## 9. Validation

```bash
npx tsc --noEmit -p tsconfig.json     # must be 0
npm test                               # 564 suites
npm run check:tabs                     # routes declared
npm run check:reads                    # discarded errors
npm run check:prose
```
`check:all` runs 62 gates. `check:schema` is **not** among them — it is a separate live-database
comparison and currently fails only on part 2940, which is held.

---

## 10. Needs the user — unchanged

| # | Item |
|---|---|
| 1 | **Stripe Connect ON in LIVE.** Blocks all coach payouts in production. |
| 2 | **iOS build**, interactively. ⚠️ *"Synced capabilities: No updates"* last time means the HealthKit removal did **not** register — that config comment is unverified. |
| 3 | **Part 2940** — AI-coach health consent. The only schema drift left. |
| 4 | **Four decisions on recording a member's sex** — `clients.sex` is read by the calorie estimate and written by nothing. Name · whether a third option exists · canonical vocabulary (`'f'\|'m'` vs `'male'\|'female'`) · what the field says about itself. |
| 5 | **Group programme visibility** — needs a column *and* reverses part 134's recorded access decision. |
| 6 | **The logo.** The board's wordmark has a geometric green mark standing in for the double P. It cannot be resolved from a raster board. **Ask for the SVG.** |
| 7 | **Four stale git worktrees** under `.claude/worktrees/` — 1.5 GB, all checked, safe to delete. |

---

## 11. Brand

- **Master slogan: "Real People. Real Progress."**
- Coach-facing: Better Coaches. Brighter Futures.
- Coach app: Train. Engage. Grow. · Client app: Track. Train. Transform. · Site: Inspire. Educate. Convert.
- Accent `#22C55E`. **As text it must darken to `#15803D`** (4.6:1) — `#22C55E` on white is 2.3:1,
  fine for a bar, unreadable as a sentence. Warning `#B45309`, destructive `#B91C1C`.
- Status is a *separate scale* from the accent: "On track" green, "Needs check-in" amber, Log Out red.

---

## 12. Known defects in the board itself

- Coach numbering has **two 8s, two 18s and two screens both called "Nutrition Plan"**; the client
  app's first screen is numbered 11.
- The Payments screen shows **`$4,280`** — the product is multi-currency and white-labelled. Must be
  currency-shaped, not dollar-shaped.
- **Community, Rewards, Assessments and Marketplace are new features**, not restyling. Each needs a
  schema, moderation or a points ledger. Cost them separately. (Marketplace is a *route inside
  Resources*, not a tab.)

---

## 13. Prompt for the next session

```text
Continue the Repple redesign on branch `redesign` (HEAD 473e737). Read REDESIGN-HANDOFF.md,
docs/claude-handoff/CLAUDE-CODE-REDESIGN-BRIEF.md and docs/REDESIGN-20-LANES.md, then OPEN
docs/claude-handoff/repple-approved-mockups-high-res.png.

Do not draw mockups. The redesign is already implemented in commits 40bf9ee and a0f77db on branch
repple-redesign — port that code onto this trunk, file by file, re-applying audit fixes wherever the
two branches touched the same file. Never `git checkout` a collision file wholesale.

The audit branch is the trunk because parts 3150/3180/3190 are applied to the live database and
repple-redesign predates them. Never modify main. Keep version 1.3.0. Run tsc and targeted checks
continuously. Commit path-scoped batches. No TestFlight until the user approves screenshots.
```
