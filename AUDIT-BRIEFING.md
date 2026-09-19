# Repple audit — briefing

**Branch:** `overnight-wave` · **HEAD:** `1f59713` · **Version:** 1.3.0
**Written:** 19 Sep 2026. Work described ran 13–14 Sep; the weekly usage limit stopped it on 14 Sep.

---

## 1. Read this first — the tree is RED

Eighteen lanes were killed mid-edit by the usage limit. **69 files are uncommitted and `tsc` has 3 errors.**
Nothing committed is broken — `1f59713` is green. The damage is all in the working tree.

```
src/lib/draftSetRow.ts(167,37)  TS2339  Property 'empty' does not exist on type 'DraftLoad'
src/ui/feedback.tsx(72,27)      TS2304  Cannot find name 'sessionUid'        — missing import
src/ui/outbox.tsx(243,38)       TS2304  Cannot find name 'supabase'          — missing import
src/ui/outbox.tsx(365,11)       TS2739  OutboxValue missing refused, refusedStatus, forgetRefusal
```

**Two ways forward. Pick one before anything else.**

**(a) Salvage — ~30–60 min.** The four errors are all half-finished edits with obvious shapes: two missing
imports, one type that grew a field its consumers do not have yet, one context value missing three
properties the type now requires. The partial work is substantial and mostly sound.

**(b) Discard — 2 min.** `git checkout . && git clean -fd` returns you to `1f59713`, which is fully green
(62/62 gates, 564 suites). You lose ~69 files of partial lane work. Nothing in production is affected.

If in doubt, **(b)**. Everything in this briefing that reached production is already committed or applied.

---

## 2. What is live in production

| Thing | State |
|---|---|
| Part 3190 — promo code uniqueness | **Applied.** Unique index on `(tenant_id, upper(btrim(code)))` — the same expression `redeem_promo` compares by, so constraint and read cannot drift. Pre-flight found zero colliding rows. |
| Part 3180 — cancelling stops being a delete | **Applied.** `cancel_class` records `cancelled`/`late_cancelled` with an append-only `class_booking_cancellations` log. Verified after: RLS on, 2 policies, both triggers live, no `DELETE` left in the function. |
| Part 3150 — coach exercise cues | **Applied.** `coach_exercise_cues` table, RLS on, 2 policies, anon locked out. |
| Edge functions deployed | `nutrition-parse`, `vision-analyze`, `wearable-oauth`, `owner-metrics`, `instagram-publish`. None is a webhook; all keep `verify_jwt`; all answer 401 unauthenticated. |
| Advisors | Re-run after every apply. Still exactly **two** anon-callable `SECURITY DEFINER` functions — `leave_my_details`, `public_coach_page` — both deliberate, both with `search_path` pinned. |

**Remaining schema drift: part 2940 only** (`ai_coach_health_consents` + 2 functions). Held on your decision.

---

## 3. Commits on `overnight-wave` (14 Sep)

```
1f59713  A directory no gate had ever opened, and a 403 to the owner of the gym
cbf56fc  An absence read as a clearance, and a gate that crashed on my own fix
02d2f6c  Cancelling a class becomes a fact, and a wrapper that could only be used wrongly
ffdd87b  One coach's revenue filed under another, and a portal with no gate at all
```
292 commits total vs `main`. 350 SQL parts. 65 gates registered, 62 in `check:all`. 564 test suites.

---

## 4. The defect classes found

### 4.1 Cross-account data — the dominant finding

Eleven device-global `AsyncStorage` keys; **nine reached the SERVER under whoever signed in next.**

- **`useMrrHistory`** — the storage key *was* the server's `metric_key`. One string doing two jobs, so coach A's revenue months upserted permanently under coach B's `user_id`.
- **`repple.trainer.availability`** — a cached week inserted as the signed-in coach's. The nightly generator then walks `trainer_availability` and opens *real bookable sessions* on those hours.
- **`repple.liveSession.v1` / `guidedSession` / `workoutDraft.<date>`** — member A's sets inserted as B's training history. RLS satisfied, write returns `stored`, no error anywhere.
- **`clientData.tsx`** — an account change with no signed-out tick left the previous member's **disclosed injuries** in place; the read succeeded, so the sync armed and *wrote them onto the new member's row*. `sex` had the same shape, and selects a different published calorie equation.

Six lanes independently refused to migrate the legacy unqualified blob — it names no account, so a
migration is a guess whose wrong answer is one person's record under another's name.

### 4.2 An outage read as a sign-out

`supabase.auth.getUser()` and `getSession()` **do not reject on a dropped connection.** They resolve with
`{ data: { user: null }, error }` for any `AuthError`, and the library brands offline, DNS, CORS and every
5xx as one. A discarded error therefore reads an outage as a sign-out.

Found: the sign-in form in front of a signed-in owner; a coach told their payout setup did not exist; an
offline member told they were not signed in on the waiver screen; **`setWaived` stamping `waived_by: null`**
— the outage did not stop a coach forgiving a fee, it recorded the forgiveness with nobody's name on the
one row whose purpose is to say who decided.

Backlog went **116 discards across 91 files → 77 across 75** (the rise at the end is 20 newly-visible
edge-function sites). Tools built and tested: `src/lib/authReadFate.ts`, `authedUid.ts`,
`signedInUid.ts` (for `getUser`), `sessionUid.ts` / `sessionUidRead.ts` (for `getSession`).

> **Two things later lanes established that matter:** 70 of those sites are `getSession()`, and converting
> them to `getUser()` is a regression (`src/ui/glucoseData.ts` records why). And `UidRead`'s members are
> told apart by `fate`, **not** `!uid` — `string` includes `''`, so `!who.uid` does not narrow inside the
> failure branch, which is exactly where `authGateMessage(fate)` goes.

### 4.3 An absence read as a clearance

A hand-added client lives in `coach_clients`, has no Repple account, and has **never been asked** about
injuries — so the roster leaves that list `undefined` deliberately. Three screens flattened it with `?? []`
and `guardInjuries` returned `ALLOWED`. A person nobody had asked opened the programme gate as though they
had disclosed none. Fixed via `src/lib/disclosureFact.ts` (4 states, including a row that *arrived* with no
injury list — distinct from a failed read).

### 4.4 No auth gate on any portal

`authed` was checked in `app/index.tsx` and nowhere else; a deep link or tapped notification lands on the
portal layout directly. Combined with the lock screen's Sign Out being the only one of ten that navigates
nowhere: person B taps it on person A's locked phone and is left inside A's portal.

### 4.5 Money

- Accounting, close and tax CSV exports stated amounts **in minor units alone** — a Tokyo gym's `50000`
  reads as ¥500; a Kuwaiti gym's as KD 500.00.
- A coach's pay page **added two currencies and labelled the total with one**.
- `amountCents: rowOwed(r) ?? 0` written into `payroll_settlements` — a run that could not be priced
  recorded as a payment of nothing, while stamping everything paid.
- `n ?? 0` under a form saying *"leave a field blank if you don't track it"* → **Health Score 100/100,
  Grade A**, 100% margin, churn over member counts nobody entered.

### 4.6 Frozen clocks

`expo-router` keeps tab screens **mounted**; `href: null` screens mount once and are never torn down. So a
bare `Date.now()` in a render body stays at the day the screen was first opened. Found: Home naming
yesterday's session under "Today"; a member who trained Monday waking to "Session Done" with no Start
button all Tuesday; the owner rota calling last week "this week" *with the one escape control hidden*.

### 4.7 Gates that were watching the wrong thing

A green gate is read as evidence, so these are the expensive ones.

| Gate | What it missed |
|---|---|
| `check:reads` | **Explicitly exempted `supabase.auth.*`** on a false premise. And its roots stopped short of `supabase/functions` — a whole directory of server code no gate had ever opened. Widening it found 21 discarded auth errors and two Instagram writes with nothing destructured, one recording a *published* post. |
| `check:translations` | Captured the exercise id as `[a-z0-9-]*` — which looks stricter and is looser: an id failing it is not flagged, the whole tuple fails to match and is **dropped silently**. A typo'd id made it print "ok, 1166 rows" over a file holding 1165. |
| `check:currency` | Hunted invented default ISO codes, not a currency symbol typed into a sentence. |
| `check:frozen-day` | Caught only the `useState`/`useMemo` form, not a clock standing in a render body. |
| 4 gates at once | Each walked inside a catch written for *"a root that is not there yet"*, which swallowed anything vanishing mid-walk **and every file after it**, then printed ok over a tree it had partly never opened. |

**My own bug, for the record:** my fix for that last one shipped a `ReferenceError` — one replacement text
across four gates, but two of those `walk` functions take no `out` parameter. A lane hit it against a tree
with no `studio-web` and told me. A second lane then found the fix was still half a fix: it covered the walk
and not the `readFileSync` over the list the walk produced. Both now fixed and committed.

---

## 5. What needs you

| # | Item | Notes |
|---|---|---|
| 1 | **Stripe Connect ON in LIVE** | Blocks the entire coach money surface in production. Minutes, in the Stripe dashboard. |
| 2 | **iOS build** | `eas build --platform ios --profile production-owner`. Needs a real terminal for the Apple prompts. The lockfile desync that killed the last one is fixed and gated. ⚠️ *"Synced capabilities: No updates"* appeared for both targets last time — removing HealthKit from Studio was the whole reason that build had to be interactive, and Apple reported no capability change. Treat that config comment as **unverified**. |
| 3 | **Part 2940** — AI-coach health consent | The only schema drift left. Written and reviewed; needs your call on what the consent covers. ~2 h after. |
| 4 | **Four decisions about recording a member's sex** | `clients.sex` is read by the heart-rate calorie estimate and **written by nothing, anywhere**. Needed: what to call it · whether a third option exists (the column is nullable, so "prefer not to say" is expressible — but the member must then be told the figure stays blank) · which vocabulary is canonical (`'f'\|'m'` in the DB vs `'male'\|'female'` in the estimate) · what the field says about itself. A wrong set of options is worse than a missing field, which is why nothing was invented. |
| 5 | **Group programme visibility** | Needs a column **and** reverses an access decision recorded in part 134. Product call. |
| 6 | **Four stale git worktrees** | 1.5 GB. All four checked — one held a finished contrast fix that had already reached main by another route. Deleting was blocked by a permission prompt. |

```bash
git worktree remove --force .claude/worktrees/distracted-pare-52985d && git worktree remove --force .claude/worktrees/magical-mendeleev-e99c8b && git worktree remove --force .claude/worktrees/mystifying-goodall-19fcec && git worktree remove --force .claude/worktrees/sweet-panini-03560f
```

---

## 6. What is left (engineering)

| Item | Size |
|---|---|
| 77 discarded auth errors across 75 files | ~5 h |
| `check:writes`, `check:invented-zero`, `check:whole`, `check:currency`, `check:prose` roots stop at the apps — `supabase/functions` uncovered | ~2 h |
| `check:invented-zero` ratchet: 56 across 23 files | ~4 h |
| RTL last root: `src/lib` (23 glyphs, all checked and legitimate; needs markers + gate change together) | ~4 h |
| `check:remount` ratchet: 5 remaining | ~1 h |
| Cut 1.4.0 — `publish.sh` refuses any tree that is not exactly a commit | ~1 h |

---

## 7. The seven rules

Almost every real bug in this audit was one of these being quietly broken.

1. **Null is not zero.**
2. **A failed read is not an empty list.**
3. **A partial read is never counted, summed, or called empty.**
4. **Never sum two currencies.** (White-labelled — there is no default currency anywhere.)
5. **Never claim success from the absence of an error.** (But check it applies: an RLS-violating `INSERT`
   raises `42501` rather than matching zero rows.)
6. **An absence is never a clearance.**
7. **A correction is a second recorded fact, never an erasure.**

---

## 8. How to resume cheaply

- Decide **salvage or discard** (§1) before anything else.
- Lane briefs are expensive. One lane at a time, on a named file list, is far cheaper than eighteen — the
  18-lane batch is what exhausted the weekly limit.
- Commit rule learned the hard way: the test is **not** "is the tree green" but **"does any file in this
  commit belong to a lane still writing it"**. Green means *compiles and passes*, not *finished*.
- Mutation fixtures go in a scratchpad, never in `src/` — one lane broke that and crashed two gates for
  every other lane.

**Roadmap artifact:** https://claude.ai/code/artifact/a49c7466-7401-4c2d-932e-1fef6ddd5be3
**Overnight report:** https://claude.ai/code/artifact/6fb2ee9b-ed12-4939-af52-06847b11d162
