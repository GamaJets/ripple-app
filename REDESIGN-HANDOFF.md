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

## 4d. The implementation doc, the logo, and the scans (19 Sep, night)

`~/Documents/ChatGPT/REPPLE App Redesign/docs/claude-handoff/CLAUDE-CODE-MOCKUP-IMPLEMENTATION.md` is the
most specific instruction set and overrides the brief where they differ. Applied: no tiles above the fold on
Home (avatar top right instead); Client Detail centred with hairline rows, not tiles; Builder = name first,
day circles, Exercises/Supersets/Templates rows, editor folded; Calendar header with the day's agenda under
the grid; Me rows (Goals/Notifications/Privacy/Connected Apps/Help/Settings).

**Logo:** the redesign's homepage carried the new mark as an SVG path (P + two signal bars). It is now
`src/ui/BrandMark.tsx`, the three app icons (near-black plates `#0b0f0e/#0c1210/#0a1311`), favicon, touch
icon and every web header. The ripple rings are gone.

**Accounts on the simulator:** the client build is signed in as the COACH account (washateria.stl), which
has no client row — that is why Meals/Progress are empty. The user's real client account is flyguy2006
(uid 759c8d25…), now holding **14 InBody scans** (5 sheets added, 4 rows given their metrics, 19 Sep). Studio
build is signed out (door, white-labelled Northline Performance). Sign the simulator in as flyguy2006 for
truthful client screenshots; that needs the user's password.

Review page (17-item set less Workout View / Active Tracking, which need a signed-in client):
https://claude.ai/artifact/RCjxmm2weVTsAtQsz8Epvk

## 4e. Home and Me against the board again; the HealthKit import (19 Sep, late)

The user said "screens still don't match the mockups" and "look at the issues on the simulators client app".
Applied and committed (`5230bcb`):

- **Home** now opens the way board page 2 does: "Good Evening," in body ink over the first name in title
  weight, search / bell / avatar circles top right (avatar opens Me), the Weekly Goal card with its ring and
  Start Workout directly under. The "Read N minutes ago · Refresh" stamp and "What This Screen Shows" moved
  below the Today card, so nothing procedural sits in the first viewport. `ScreenHeader` has a `greeting`
  prop for this (eyebrow in `ty.body`, ink2).
- **Me** (board page 19): the stat strip is Workouts / Badges (of 12) / Best Streak from `useWorkoutLog()`,
  gated on `isWhole(logStatus)` — dashes on a partial or failed read, never a 0. The old
  Weight / Body Fat / Daily Target strip is gone (those live on Progress and Meals).
- **Apple Health, root cause:** Metro logged `Failed to get NitroModules` from `appleHealthShim.ts` on every
  Train render. The simulator binary (built 9 Sep) has **zero** Nitro / HealthKit symbols — the
  `@kingstinct/react-native-healthkit` native side is not in it, so "connected" was a stored preference
  with nothing behind it. JS side: `nativePresent()` and `healthKitHere()` now ask the cached
  `healthModule('health')` first, so a missing module fails once, not per render. The native side needs a
  fresh build (`npx expo prebuild` + rebuild, or EAS) — **held until the user approves the screenshots.**
- Metro also logs `ERR_NOTIFICATIONS_KEYCHAIN_ACCESS` from expo-notifications (no keychain entitlement in
  the dev build). Not changed; likely simulator-only, verify on a device build.

Gates (caps, contrast, a11y, rtl, text, whole, dead-exports, reads, prose) and `npm test` clean.

## 4f. Meals against board pages 7 and 18 (19 Sep, later)

"Meals tab looks nothing like the nutrition board." Commit `4863002`, `app/(client)/nutrition.tsx`:

- The ring is the figure now — 156pt, centred, eaten inside it over "of N kcal", what is left under it,
  the three macros against target, then **Log Meal** (page 7). Withholding unchanged: no ring arc, dash
  inside, "Calories not counted" until the day's food log is a whole read.
- The day's meals moved up to sit directly under that card, and are listed **one slot at a time**:
  Breakfast / Lunch / Dinner segments (snacks appear as a segment on a 4- or 5-meal day; the segments come
  from the plan, so a rebuilt plan never points at a slot it lost), a "Search foods…" row that opens the food
  log's search, and rows with a 48pt round thumbnail (the dish's own glyph — no photography is invented),
  name, first three ingredients, `kcal · P · C · F`, allergen mark, chevron (page 18). "This week" is the
  list head's note; Meals per day sits under the list.
- Everything else on the screen (Why This Target, day type, Log What You Ate, diet, quick tiles, snacks,
  grocery) follows below in its old order. `ScreenHelp` moved under the card.
- Second pass (`"because i don't see how they match"`): the list head is the board's — "3 Meals" centred,
  "This week" a word to the right — the segments are one full-width bar, the search row is a real
  `TextInput` over `searchMeals(diet, slot, q)`, and the rows are the slot's **catalogue**, not the one
  planned dish: the plan's meal leads (marked "In your plan"), then eight dishes sampled at a stride
  through `catalogSize` (neighbouring indices differ only in garnish) and thinned to one row per base
  name, each portioned with the planned meal's `servings`. Tapping one opens the recipe sheet, whose
  "Swap This Meal" becomes **Use This Meal** (`choose(pos, idx)` → `override[pos]`) for a row that is not
  the plan's. Still no photography: the thumbnail is `m.ico`.

## 4g. Ten lanes at once (19 Sep, night) — commits `5eda2bf` … `0296e0a`

The user asked for "10 subagents and 10 lanes". Each lane had one pre-cropped board page per screen
(`scratchpad/board/<app>-NN.png`, cut from the high-res board: coach rows y=62/283, client rows y=553/703,
125px pitch), the implementation doc, the kit idioms and the no-fabrication rules, and ran tsc + nine
gates before reporting; the lead ran the full suite, all 41 gates, screenshots and commits. Landed:

| Lane | Board | Files | Notes |
|---|---|---|---|
| 1 | Client 4/5/6 | `app/(client)/exercise.tsx` | ready / demo / set views; "Set n of N" only when the opener passes `sets`/`reps` |
| 11 | Client 4/6 | `app/(client)/workouts.tsx` `SessionRunner` | Train's Start Workout runs THIS, not exercise.tsx; three drawings of one state |
| 2 | Client 11/10 | `calendar.tsx`, `habits.tsx` | month first, agenda under; habit figures from real stores, dashes with reasons |
| 3 | Client 12/13 | `checkin.tsx`, `messages.tsx` | faces + sliders + notes + submit; grey/green bubbles, pill composer |
| 4 | Client 17/18/1 | `devices.tsx`, `settings.tsx`, `app/welcome.tsx` | **Connected only when the provider can be read** — HealthKit-less sim shows Not Readable + Disconnect |
| 5 | Client 14/7 | `challenges.tsx`, `scans.tsx`, `achievements.tsx` | live "Day n of N"; Progress = bar, figure, delta, chart, chips, dated scans |
| 6 | Coach 6/15 | `library.tsx`, `exercise.tsx`, `templates.tsx`, `documents.tsx` | search pill, chips, round RepDB stills; Instructions under the picture |
| 7 | Coach 7/8 | `client-nutrition.tsx`, `client-body.tsx` | four target rings 2×2 (dashes without a body); figure/delta/chart/readings |
| 8 | Coach 9/12/18 | `chat.tsx`, `client.tsx`, `src/ui/notifications.tsx`, `src/ui/coach/CheckInReview.tsx` | check-in reviewed in the form's shapes + Reply; notifications shared by all three apps |
| 9 | Coach 14 | `money.tsx` (+ heads on payments/billing/invoices/statement/receipts/costs) | "Total Taken", per-currency, whole-read delta vs prior statement month |
| 10 | Coach 17/19/20 | `settings.tsx`, `profile.tsx`, `account.tsx`, `credentials.tsx` | Log Out row; Light/Dark/System radios; Clients/Rating/Years strip |

Lead fixes after the lanes: `check:numbers` (habits `stepsDevice` is a name), `check:invented-zero`
(exercise prefill carried a null load as 0), `check:site-claims` (404's `/#why` anchor no longer exists).
Suite 564 ok, all gates ok. Deep links work for screenshots: `xcrun simctl openurl booted
"repple:///(client)/<route>"` and `"repplecoach:///(trainer)/<route>"`.

Kit note from three lanes: a `ScreenHeader centered` variant (back + centred title + 38pt spacer) would
remove the copies now hand-built on ~12 screens.

## 4h. Rounds two and three — every screen on the kit (19 Sep, late night)

"Keep building", then "don't stop until everything is done and ready to commit and push a new build to
android and ios." Commits `327d393` … `bcce4aa`.

**Kit:** `PageHead({ title?, subtitle?, leading?, trailing?, onBack?, backLabel? })` — the board's
pushed-page head (round back, centred title, subtitle, trailing slot or spacer), adopted on every pushed
page in all three apps; `KpiRow` figures at `value(26)` with the label under. `check:caps` lists
`PageHead title`. `Hero` is retired from every screen (kit export kept; nothing imports it now — safe to
delete in a later pass). The inline "figure card" (`Section` + `SectionHead` + `ty.hero` figure + note)
is now copied on ~15 screens; a kit `FigureCard` would fold them.

**Second pass on board pages:** Analytics has 7D/30D/90D/1Y windows, adherence and completions as figure
+ movement + chart (`src/ui/coach/analyticsRange.ts`, `RangeBars.tsx`); Builder has a centred head and
seven weekday circles that add/open a day; Clients has agenda rows, a search pill, a segment bar, roster
rows that say their state in words with a dot, and a round green Add Client.

**Exercise heatmap (user request):** `src/ui/ExerciseMuscles.tsx` draws the body front and back with
primary movers at 1.0 and secondaries at 0.5 through `muscleMap`; on both exercise screens under
"Muscles Worked", and as a 40pt lit silhouette on every library row. Steps and Tips now sit in the
client's ready view too, not only behind the Demo control.

**Family passes (no board pages):** Studio (owner) on `ScreenHeader`/`PageHead`/figure cards; coach
record pages (client-*, my-*, log-session, class-checkin, my-register); coach utility pages (videos,
sessions, classes, devices with `ProviderMark`, leads, referrals, …); client account/coach/schedule
pages (Appearance as Light/Dark/System rows; Your Coach centred with one Message action); client body
and nutrition pages (Food Log with a Photo/Barcode/Search/Describe bar and thumbnail rows; Muscles with
the body first). Website: the redesign shipped no new markup for the audience pages — its restyle is the
stylesheets already linked — so only the mark and download's hero panel moved.

**Verified before the build:** tsc clean, all 41 source gates, 564 suites, the build gates (lockfile,
patches, inlined-env, native, native-tracked, testflight, release-version, version-bump, runtime-reach,
bundle, schema:offline, functions, stripe-fields, studio), dark mode on eight client screens.

## 4i. Round four, the wordmark, recipes, and the builds (19–20 Sep)

**Builds shipped (1.3.0).** First set, from `c824130`: client iOS 53 / Android 19, coach iOS 24 / Android 9,
studio Android 9 — all submitted by build id through `npm run submit`. Studio iOS 16 was refused by Apple
(ITMS-90683 ×3): `app.config.ts` stripped the camera and health purpose strings from the owner variant, but
the modules are autolinked into every binary, so the strings are required. The owner variant now carries
the three keys with sentences that are true of it (`OWNER_REQUIRED_PLIST`); studio iOS 17 went through.
Coach iOS needed ONE interactive `eas build` for the widget target's provisioning profile (the owner's
Apple login); non-interactive builds work for it since. Second set queued 20 Sep from `a5b2a31`: client iOS
54 / Android 21, coach iOS 25 / Android 11, studio iOS 18 / Android 10.
Preflight had two pre-existing blockers, both fixed: a zone-dependent assertion in
`coachLogReview.test.ts`, and repo part 2940 (`ai_coach_health_consents`) never applied to the live DB.

**Logo.** The owner chose the BOARD's wordmark over the logo pack's angular mark: `src/ui/BrandMark.tsx`
constructs R≡PPLE as vectors (`BrandWordmark`, and `BrandMark` = "R≡"); door and launch screen (house
brand only — a tenant keeps its own name), the three icon masters, Android adaptive foreground, favicon,
store icons, and every website header/footer (`svg.brand-word`, the `.mark` plate rules deleted). The pack
itself is in `docs/claude-handoff/logo/` for print and marketing.

**Data-layout review** (`docs/claude-handoff/CLAUDE-CODE-DATA-LAYOUT-AND-FLOW-REVIEW.md`) applied to every
section, each lane reporting done-already / changed / not-applicable per item. Kit gained `FigureCard`,
`AttentionRow`, `ActionBlock`, `SyncBadge`, `Expandable`, `ChartShell`, `Segmented`; `SectionHead` titles
are ink at head weight. Open kit asks: `Expandable` cannot persist its state or draw without its card
(coach home uses an inline `Fold` with AsyncStorage instead); ~12 screens still hand-build a figure card.

**Coach tester's TestFlight notes (build 20), all answered:** clock + rest timer when logging a client's
session; a tick can be taken back before save (AFTER save needs a coach UPDATE policy on `workouts` and a
floor-queue act — not built); roster is names + one status line; Invite/Import at the top of Clients;
Coaching Tools and Roster Actions fold away (remembered per device); stronger section heads; a client's
programme opens as collapsed days; "Your Programmes" shortcuts in the builder and templates; RepDB stills
on builder, picker and log-session rows; "can't see the updated body scan" had four causes (the sheet
picked the newest scan WITH a metrics breakdown, no re-read on focus, same-day order by random id, and
newest-first rows handed to a last-wins picker) — all fixed.

**Recipes (Spoonacular).** `supabase/functions/recipes` (deployed) holds `SPOONACULAR_API_KEY` (set by the
owner); `src/lib/recipeWire.ts`, `recipes.ts`, `recipePlan.ts`, `src/ui/useRecipeSearch.ts`; Meals has a
"Search Real Recipes" entry (no quota spent on mount), photographed rows, allergens re-checked locally,
a recipe can be planned for TODAY only (week/grocery stay on the generated plan), only `RecipeRef`
(id, title, image URL) is ever stored. Free plan = 50 points/day ≈ 25 searches across all members — dev
only. Coach-side recipe planning needs a `recipe_refs jsonb` column (described in
`docs/RECIPES-SPOONACULAR.md`, not written). Not yet seen running: the simulator's account has no body on
record, so Meals shows the measurements prompt there.

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
