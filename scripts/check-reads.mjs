#!/usr/bin/env node
// Every read must look at `error`.
//
// This is the bug this codebase keeps producing. supabase-js does not reject on
// a database error — it RESOLVES, with `error` set and `data` null. So
//
//     const { data } = await supabase.from('x').select('*');
//     return data ?? [];
//
// turns every failure into a confident empty answer, and the screen above it
// then says something specific and false: "No purchases yet" to somebody who
// has paid, "No feedback yet" to an owner whose testers are talking, "0
// sessions left" to a client holding ten.
//
// It has been found and fixed by hand at least nine times in this repo, each
// time by someone noticing a wrong sentence on a screen. Hand-searching does
// not hold a line; this does.
//
// A read that genuinely does not care about failure is allowed — say so on the
// line above and say why:
//
//     // eslint-disable-next-line -- no-error-ok: a tie-break; absent is the same as none
//     const { data } = await supabase.from('clients').select('trainer_id')…
//
// The marker is `no-error-ok:` followed by a reason. The reason is the point:
// it is the sentence a reviewer reads when deciding whether a fabricated empty
// answer is honestly indistinguishable from a true one.
//
// A SECOND rule lives at the bottom of this file, over `supabase.auth.*` — the
// same discard, on the call that decides whether there is anybody signed in.
// Its own header starts at "RULE TWO" below, and it has its own marker,
// `auth-error-ok:`, and its own ratchet.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

// The web console reads the same tables through the same client, so it has the
// same failure mode and gets the same rule.
//
// ── and `supabase/functions`, added 14 Sep 2026, which had never been read ──
//
// The four roots above are the phone app and the web console. The edge
// functions are neither, and they were on NO root of this gate — so in a file
// whose whole subject is a discarded `error` from supabase-js, twenty-five
// server modules that call supabase-js had never had a line of them scanned.
// They are not a quiet corner: they hold the Stripe webhook, the Connect money
// path, the OAuth token exchanges and the owner dashboard, and they call
// `auth.getUser()` twenty-two times to decide who is asking.
//
// ── WHAT THIS RULE CANNOT SEE OVER THAT DIRECTORY, said plainly ───────────
//
// These two rules are TEXT rules everywhere, but everywhere else there is a
// type checker standing behind them. Over `supabase/functions` there is not,
// and the reason is worth stating because it bounds what a pass here means:
//
//   · Deno is not installed on this machine, and these functions are in no
//     tsconfig. `npm run check:functions` is the nearest thing to a compiler
//     they get, and its own header says what it is: it PARSES them, resolves
//     their relative imports, and type checks their calls into `src/lib`.
//     Everything behind `npm:`, `jsr:` and `https:` — which is where
//     `createClient` and therefore every `.from()` and `.auth.*` result type
//     comes from — is declared `any` in an ambient shim. So the supabase-js
//     result shape is unverified in this directory. Nothing can tell us that
//     the `data` in a destructure came off a `PostgrestResponse` at all.
//   · Which means this scanner's regex is the ONLY thing that knows the shape
//     here, and it inherits every limit rule two lists for itself: it is
//     line-local, it cannot see a destructure split across lines, it cannot
//     see a result that is never destructured, and it cannot tell whether an
//     `error` it saw is ever read.
//
// A pass over this root therefore means: no line in these functions takes
// `data` off an `await` without also naming `error` or saying why. It does not
// mean the functions are type checked, and it does not mean they are correct.
const ROOTS = ['src', 'app', 'studio-web/app', 'studio-web/lib', 'supabase/functions'];
const files = [];

// ── a scan that was cut short must not read as a clean one ────────────────
//
// Lanes write this tree while gates run over it, so a file listed by readdir
// and gone by the time it is stat'd or read is an ordinary event here, not a
// defect. What was NOT ordinary is what used to happen next: the throw went up
// to `try { walk(root) } catch {}` at the bottom of this file, whose comment
// says it is there for "a root that is not there yet" — so it swallowed the
// vanished file AND every file after it in that root, and the run then printed
// ok over a tree it had partly not opened.
//
// A gate whose final line names a file count is making a claim about coverage.
// So: a disappearance is survived per entry, counted, and said out loud. The
// root-level catch now tolerates only the root itself being absent; anything
// else is a real fault and is allowed to be one.
//
// ── two things that were not true when I checked it, 14 Sep ───────────────
//
// (1) `readFileSync` was outside the tolerance. The walk survives an entry
//     that disappears between `readdir` and `stat`, but BOTH offender loops
//     below then did a bare `readFileSync(f)` on the list it produced, and a
//     file that survives the stat and is deleted before the read throws ENOENT
//     out of the top of the script. The window is the whole scan — seconds,
//     over a tree three lanes are writing. `readSource` below closes it, on
//     the same terms: survived per file, counted, and a file that is gone
//     contributes no lines rather than crashing the run.
// (2) `vanished` was counted and then never read by anything. The paragraph
//     above says a disappearance is "counted, and said out loud"; it was only
//     the first. It is now printed with the success line — a gate whose last
//     line names a file count has to say when that count is short.
//
// (A `walk` that took an `out` parameter its ENOENT arm did not have is the
// failure that prompted the check. This file's `walk` takes only `dir` and its
// two arms touch only `vanished`, which is module-level, so there was no
// ReferenceError here — the copied fix landed correctly in this one. Verified
// by deleting a file out from under a running scan and by walking a dangling
// symlink, not by reading it.)
//
// A Set of PATHS rather than a counter, because the file list is walked twice
// below — once per rule — so one file that disappears is read at twice and a
// counter would report it as two disappearances.
const vanished = new Set();
const gone = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
const readSource = (f) => {
  try { return readFileSync(f, 'utf8'); }
  catch (e) { if (gone(e)) { vanished.add(f); return null; } throw e; }
};

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); }
  catch (e) { if (gone(e)) { vanished.add(dir); return; } throw e; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); }
    catch (e) { if (gone(e)) { vanished.add(p); continue; } throw e; }
    if (st.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
}
// Counted per ROOT. `walk` swallows a missing directory — the `catch` right here
// is what swallows it — so a renamed root contributed zero silently and only a
// single total stood behind it. See scripts/gate-floor.mjs for why a total is
// not a guard.
const perRoot = new Map();
for (const r of ROOTS) {
  const before = files.length;
  try { walk(r); }
  catch (e) { if (!gone(e)) throw e; /* only the root itself may be absent */ }
  perRoot.set(r, files.length - before);
}
assertRootFloors('check:reads', perRoot);
// A check that inspects no files passes every time. The first version of this
// walked from '.' and filtered for paths starting './src/', which join()
// normalises away — it reported success having read nothing.
if (!files.length) {
  console.error('found no source files to check, which is not a pass.');
  process.exit(1);
}

/**
 * The lines a marker for the read at `i` is allowed to sit on.
 *
 * It was `lines.slice(i - 3, i)` — a fixed three. That is enough for a
 * two-line reason and no more, and `supabase/functions` is full of four- and
 * five-line ones: `instagram-publish/index.ts:405` carries a marker with a
 * reason that runs to four lines, correctly written, sitting one line further
 * up than the window could see. The gate would have called an ANNOTATED read
 * an unannotated one, and the honest repair for that is not to ratchet the
 * file — it is to look where the annotation actually is.
 *
 * So: the three lines above, PLUS the contiguous `//` comment block
 * immediately above the read. Contiguous is the whole of it — the walk stops
 * at the first line that is not a `//` comment, so a blank line, a brace or a
 * statement between a marker and a read ends the block and the marker does not
 * reach. That is deliberately TIGHTER than a bigger fixed number would be: a
 * marker can only ever silence the read its own comment is attached to.
 */
function markerWindow(lines, i) {
  const window = lines.slice(Math.max(0, i - 3), i);
  for (let j = i - 1; j >= 0 && /^\s*\/\//.test(lines[j]); j--) window.push(lines[j]);
  return window;
}

/**
 * Rule one's backlog, and it holds `supabase/functions` paths ONLY.
 *
 * Rule one has been strict since it was written: every offending read fails,
 * everywhere. It stays strict. This Map exists because widening ROOTS onto a
 * directory no gate had ever read turned up eight reads at once, and the
 * choice was between fixing eight server files in one lane and leaving the
 * directory unscanned for another day. Neither. They are counted here, the
 * count cannot grow, and the twenty-five functions are on the rule from today.
 *
 * A file not on this Map fails on a single offending read — which is the whole
 * of `src`, `app` and `studio-web/`, all of which are at zero and stay there.
 *
 * What is on it, and why each one was not simply fixed tonight:
 *
 *   · `owner-metrics/index.ts` (6) — the dashboard aggregates. Each sits in
 *     its own swallowing `try`/`catch` feeding a `series.*` key, and
 *     a failed read drops the section, which the portal then fills with SAMPLE
 *     DATA (that fallback is described in this function's own header). So the
 *     defect is real and it is the house one — an owner shown invented numbers
 *     for a gym whose database hiccuped — but repairing it means changing how
 *     a missing series is signalled to the portal, which is a caller change in
 *     another lane's tree, not an `error:` on a line.
 *     The SEVENTH read in that file, the `profiles` lookup at :168 that
 *     decides whether the caller is an owner at all, is NOT here: it was
 *     fixed, because a failed read there answered a real owner with a 403
 *     saying "Owner access only." It now answers 503 and says come back.
 *
 * Every other read in the directory already names `error` or already carries a
 * `no-error-ok:` marker with a real reason — the ads, Instagram and Connect
 * functions were written to this rule by hand before any gate asked them to.
 */
const READ_KNOWN = new Map([
  ['supabase/functions/owner-metrics/index.ts', 6],
]);

const offenders = [];
const readPerFile = new Map();
for (const f of files) {
  const src = readSource(f);
  if (src === null) continue;
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // A destructure that takes `data` (possibly renamed) and never `error`.
    if (!/const\s*\{[^}]*\bdata\b[^}]*\}\s*=\s*await\b/.test(line)) return;
    if (/\berror\b/.test(line)) return;
    // Auth calls carry their own error shape, and RULE TWO at the bottom of
    // this file is where they are read. Until it was written this line was the
    // whole of "separately" and nothing read them at all.
    if (/\.auth\s*\.\s*[A-Za-z_]/.test(line)) return;
    // Not a real read — a comment describing one.
    if (/^\s*(\/\/|\*)/.test(line)) return;
    // One line at a time, not a joined block: `\s*\S` steps over a newline, so
    // a bare `no-error-ok:` would read the next line of code as its reason and
    // silence the site with nothing said.
    if (markerWindow(lines, i).some((l) => /no-error-ok:[ \t]*\S/.test(l))) return;
    readPerFile.set(f, (readPerFile.get(f) ?? 0) + 1);
    offenders.push({ file: f, line: i + 1, text: line.trim().slice(0, 96) });
  });
}

// Same two arms as rule two's ratchet at the bottom of this file, for the same
// stated reason — a count that GROWS is fatal, a count that DROPS prints the
// exact edit and passes, and an entry that reaches zero is DELETED rather than
// written `0`, so that the next fresh discard in that file is a new one and
// fails outright. A cleared file must not become a tolerated backlog line.
const readFresh = [];
for (const [f, n] of readPerFile) {
  const allowed = READ_KNOWN.get(f) ?? 0;
  if (n > allowed) readFresh.push({ file: f, now: n, allowed });
}
const readDropped = [];
for (const [f, was] of READ_KNOWN) {
  const now = readPerFile.get(f) ?? 0;
  if (now < was) readDropped.push({ file: f, was, now });
}

if (readFresh.length) {
  const shown = offenders.filter((o) => readFresh.some((r) => r.file === o.file));
  console.error(`${shown.length} read${shown.length === 1 ? '' : 's'} that cannot tell failure from emptiness:\n`);
  for (const r of readFresh) {
    for (const o of offenders.filter((x) => x.file === r.file)) console.error(`  ${o.file}:${o.line}  ${o.text}`);
    console.error(r.allowed
      ? `    (this file is on the ratchet at ${r.allowed}; it now has ${r.now})`
      : '    (this file is not on the ratchet — it is a new discard)');
  }
  console.error('\nRead `error`, and return null rather than an empty answer — or mark the line');
  console.error('`no-error-ok: <why an empty answer is honest here>` if failure genuinely does not matter.');
  process.exit(1);
}

if (readDropped.length) {
  for (const d of readDropped) {
    console.error(`check:reads — ${d.file} is ratcheted at ${d.was} discarded read${d.was === 1 ? '' : 's'} and now has ${d.now}. `
      + (d.now === 0 ? 'Delete the entry from READ_KNOWN in scripts/check-reads.mjs.' : `Lower it to ${d.now} in READ_KNOWN in scripts/check-reads.mjs.`));
  }
  console.error('');
}

/* ══════════════════════════════════════════════════════════════════════════
 *
 * ── RULE TWO — the same discard, on `supabase.auth.*` ─────────────────────
 *
 * ── the hole, and what came through it ────────────────────────────────────
 *
 * Everything above matches a `.from()` chain, and the line that skips auth
 * calls — "Auth calls carry their own error shape and are read separately" —
 * was true about the shape and false about the "separately": nothing read them.
 *
 * Lane 114 found `studio-web/lib/supabase.ts` taking the user out of
 * `supabase.auth.getUser()` and dropping the error beside it, and `check:reads`
 * PASSED with the defect in the file. The consequence is not a wrong sentence
 * in a list, it is the whole console: `getUser()` is a network call, an outage
 * or a hung socket answers with `error` set and `data.user` null, and a null
 * user is indistinguishable from a signed-OUT user to everything downstream.
 * A signed-in owner was shown the sign-in form.
 *
 * The shape is identical to rule one's and so is the repair — read `error`,
 * and let a failed read be its own state rather than an empty one:
 *
 *     const { data: auth, error: authErr } = await supabase.auth.getUser();
 *     if (authErr) throw authErr;          // or return a 'refused' Read<T>
 *
 * `getSession()` is on the same rule. It answers from storage more often than
 * not, which is the argument for leaving it out — but it refreshes over the
 * network when the token has expired, which is the case that matters, and it
 * is the call a lock screen and a queue flush ask before deciding whether
 * there is anybody there.
 *
 * ── what this rule does NOT see, said plainly ─────────────────────────────
 *
 *   · a call whose result is not destructured at all — `await
 *     supabase.auth.signOut()`, `await supabase.auth.updateUser(…)`. The error
 *     is discarded there too, and matching it is a different rule about a
 *     different expression shape.
 *   · a destructure split across lines. Both rules here are line-local, which
 *     is the price of a scanner that is a regex; every site in this tree today
 *     is written on one line.
 *   · whether the `error` it saw is USED. `const { data, error } = …` followed
 *     by nothing that reads `error` passes both rules. That is the limit
 *     rule one has always had, and this rule inherits it rather than claiming
 *     more than its sibling.
 *
 * ── the ratchet, and which way it fails ───────────────────────────────────
 *
 * 116 auth reads across 91 files discard their error today, in files that
 * belong to other lanes — the count moved by five while this rule was being
 * written, because several of those files are being edited tonight, and it has
 * moved twice since: this rule opened at 130 across 93 files, and the money
 * path came off it when src/lib/connect.ts (10) and src/lib/subscriptions.ts
 * (4) were centralised onto src/lib/signedInUid.ts. Read AUTH_KNOWN, not this
 * paragraph, where the two disagree. So:
 *
 *   · a file NOT in AUTH_KNOWN that discards an auth error FAILS. That is the
 *     whole tree outside the backlog, `studio-web/` included: Lane 114's site
 *     is repaired (studio-web/lib/supabase.ts:210 now reads `error: authErr`),
 *     it is therefore NOT listed below, and a regression there is fatal.
 *   · a file in AUTH_KNOWN that GROWS past its number fails.
 *   · a file in AUTH_KNOWN that has DROPPED prints the new number and passes.
 *     This is check-remount.mjs's and check-frozen-hook.mjs's variation, taken
 *     deliberately and for their stated reason: every entry is in somebody
 *     else's file, tonight, and a gate that fails a lane's build for doing the
 *     work is a gate that gets `--force` written next to it. Lower the number
 *     when you see the line — the message prints the exact edit — and once an
 *     entry is deleted the regression it was holding becomes fatal.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Auth reads that discard their error today: `<path>` → count.
 *
 * Every one of them is the same shape — `const { data } = await
 * supabase.auth.getUser()` or `.getSession()`, with no `error` on the line —
 * so there is one assessment for the list rather than ninety-one: none of
 * these can tell "no session" from "could not ask", and each one decides
 * whether a person is signed in. The heaviest are named so the shape of the
 * backlog is visible without opening it: src/ui/sessions.tsx (6), and four
 * files at 3 — src/ui/challenges.tsx, src/ui/foodLog.tsx, src/ui/injuryAcks.tsx
 * and app/(client)/trainers.tsx. Seventy of the 116 are `getSession()` rather
 * than `getUser()`, which is the larger half and the same defect: a null
 * session during an outage reads as signed-out everywhere it is asked.
 *
 * TWO ENTRIES HAVE BEEN DELETED RATHER THAN LOWERED, and that is the ratchet
 * tightening rather than a backlog line going quiet. src/lib/connect.ts stood
 * at 10 (the Stripe Connect onboarding hops) and src/lib/subscriptions.ts at 4;
 * both now route every auth read through `signedInUid()` in
 * src/lib/signedInUid.ts, which names `error` and passes the fate on, so both
 * scan at 0. A cleared file is not a tolerated zero: neither path is on this
 * Map any more, so a single fresh discard in either one is a NEW discard and
 * fails the build outright — which is the point of deleting rather than
 * writing `0`. The money path is the half of this backlog that must never come
 * back, and it is now held by the strict arm of the rule.
 */
const AUTH_KNOWN = new Map([
  ['src/lib/supabase.ts', 1],
  ['src/ui/assignedPrograms.tsx', 1],
  ['src/ui/attendance.ts', 1],
  ['src/ui/auth.tsx', 2],
  ['src/ui/availability.ts', 2],
  ['src/ui/checkins.tsx', 1],
  ['src/ui/classes.tsx', 1],
  ['src/ui/clientData.tsx', 1],
  ['src/ui/clientTags.tsx', 1],
  ['src/ui/exerciseDetail.ts', 1],
  ['src/ui/feedback.tsx', 1],
  ['src/ui/groupProgram.ts', 1],
  ['src/ui/habits.tsx', 1],
  ['src/ui/intake.ts', 1],
  ['src/ui/invites.tsx', 1],
  ['src/ui/joinCode.ts', 1],
  ['src/ui/leads.ts', 1],
  ['src/ui/measurements.tsx', 1],
  ['src/ui/messaging.ts', 1],
  ['src/ui/myCoachRequests.ts', 1],
  ['src/ui/nightlyPasses.ts', 1],
  ['src/ui/notifications.tsx', 1],
  ['src/ui/nudges.ts', 1],
  ['src/ui/outbox.tsx', 1],
  ['src/ui/ownerCosts.ts', 1],
  ['src/ui/pushNotifications.ts', 1],
  ['src/ui/recordOutbox.ts', 1],
  ['src/ui/reviewAsks.ts', 1],
  ['src/ui/stretchCatalogue.ts', 1],
  ['src/ui/trainerInvites.tsx', 1],
  ['src/ui/trialAccount.ts', 1],
  ['src/ui/waiver.tsx', 1],
  ['src/ui/wearables.tsx', 1],
  ['src/ui/wellness.tsx', 1],
  ['src/ui/wellnessShare.ts', 1],
  ['src/ui/workoutLog.tsx', 1],
  ['src/ui/workoutTemplates.ts', 1],

  // ── and the edge functions, from 14 Sep 2026 ─────────────────────────────
  //
  // These arrived with the root, not with a regression: this gate had never
  // read `supabase/functions` at all, so none of them had ever been counted.
  // Twenty-two sites in the directory call `auth.getUser()`; twenty-one threw
  // the error away. Two came off that number tonight and neither is listed
  // below, which is the ratchet closing rather than a backlog going quiet:
  //
  //   · `owner-metrics/index.ts` already read it — `const { data: ures, error:
  //     uerr }` at :157 — and was the only one that did.
  //   · `wearable-oauth/index.ts` was fixed. It is NOT on this Map, so a fresh
  //     discard there is fatal.
  //
  // The twenty below are one site each and all the same shape, so there is one
  // assessment for the list: a service-role client calls `getUser(jwt)`, the
  // error is dropped, `data?.user?.id || ''` collapses "GoTrue did not answer"
  // into "" — the same empty string a request with no token produces — and the
  // next line refuses with a sentence about signing in. During a GoTrue blip
  // every one of these tells a signed-in member or coach that they are signed
  // out, and offers them the one remedy that cannot help. `wearable-oauth` is
  // the worked example: its repair is four lines and `src/lib/authReadFate.ts`
  // does the classifying, so each of these is a small, separate, deployable
  // change rather than a rewrite.
  //
  // Eight of them sit in front of money — `stripe-checkout`, `stripe-portal`,
  // `connect-checkout`, `connect-onboard`, `connect-promo`, `connect-refund`,
  // `gym-checkout`, `gym-onboard` — and that half should come off this list
  // first, the way `src/lib/connect.ts` and `src/lib/subscriptions.ts` did.
  ['supabase/functions/ads-google/index.ts', 1],
  ['supabase/functions/ads-oauth/index.ts', 1],
  ['supabase/functions/ads-sync/index.ts', 1],
  ['supabase/functions/ads-tiktok/index.ts', 1],
  ['supabase/functions/calendar-sync/index.ts', 1],
  ['supabase/functions/coach-chat/index.ts', 1],
  ['supabase/functions/connect-checkout/index.ts', 1],
  ['supabase/functions/connect-onboard/index.ts', 1],
  ['supabase/functions/connect-promo/index.ts', 1],
  ['supabase/functions/connect-refund/index.ts', 1],
  ['supabase/functions/gym-checkout/index.ts', 1],
  ['supabase/functions/gym-onboard/index.ts', 1],
  ['supabase/functions/instagram-publish/index.ts', 1],
  ['supabase/functions/nutrition-parse/index.ts', 1],
  ['supabase/functions/ocr-scan/index.ts', 1],
  ['supabase/functions/send-push/index.ts', 1],
  ['supabase/functions/stripe-checkout/index.ts', 1],
  ['supabase/functions/stripe-portal/index.ts', 1],
  ['supabase/functions/vision-analyze/index.ts', 1],
  ['supabase/functions/wearable-day/index.ts', 1],
]);

const authOffenders = [];
const authPerFile = new Map();
let authReadsSeen = 0;
const authReadsPerRoot = new Map();
for (const f of files) {
  const src = readSource(f);
  if (src === null) continue;
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (!/const\s*\{[^}]*\bdata\b[^}]*\}\s*=\s*await\b/.test(line)) return;
    // An auth call, not a table read. `.auth.` rather than `supabase.auth.`
    // because the client is renamed on import in a dozen files here.
    if (!/\.auth\s*\.\s*[A-Za-z_]/.test(line)) return;
    if (/^\s*(\/\/|\*)/.test(line)) return;
    authReadsSeen++;
    const root = ROOTS.find((r) => f === r || f.startsWith(r + '/'));
    if (root) authReadsPerRoot.set(root, (authReadsPerRoot.get(root) ?? 0) + 1);
    if (/\berror\b/.test(line)) return;
    // The reason must be on the marker's OWN line. Tested one line at a time
    // rather than over a joined block, because `\s*\S` steps across a newline
    // and would read the next line of code as the reason — which is how a bare
    // `auth-error-ok:` passes for a marker that says why.
    const window = [line, ...markerWindow(lines, i)];
    if (window.some((l) => /auth-error-ok:[ \t]*\S/.test(l))) return;
    authPerFile.set(f, (authPerFile.get(f) ?? 0) + 1);
    authOffenders.push({ file: f, line: i + 1, text: line.trim().slice(0, 96) });
  });
}

/**
 * The empty-set guard for this rule, at the invariant rather than at today's
 * count. The invariant: this product signs people in through Supabase auth
 * from both halves of the phone app — `src` holds the hooks that ask who the
 * caller is, `app` holds the screens that ask it directly. A scan that finds
 * none in either is not reading this tree, and its "ok" would be a claim about
 * nothing. `studio-web/*` is deliberately not floored: it has one such read
 * in total, and a floor at one would fail the day somebody centralises it.
 *
 * `supabase/functions` is floored for the same reason and at the same number.
 * Its invariant is the strongest of the three: these functions run with the
 * SERVICE ROLE key, which bypasses every row-level policy in the database, so
 * the only thing standing between a caller and somebody else's rows is the
 * function asking who the caller is. Twenty-two sites do that today. A scan of
 * this root that finds NONE has stopped recognising the shape, and its "ok"
 * would be an all-clear over the most dangerous code in the repo. One, not
 * twenty-two, so that centralising them onto a shared helper is allowed.
 */
for (const r of ['src', 'app', 'supabase/functions']) {
  const n = authReadsPerRoot.get(r) ?? 0;
  if (n < 1) {
    console.error(`check:reads — found no \`supabase.auth.*\` reads under ${r}/, which cannot be right: `
      + 'this app signs people in from both halves of that tree. The auth rule below would be '
      + 'checking nothing. Refusing to pass.');
    process.exit(1);
  }
}
if (authReadsSeen < 20) {
  console.error(`check:reads — only ${authReadsSeen} auth reads found across the roots. Every screen that `
    + 'asks who the caller is makes one; a number this low means the scanner no longer recognises the '
    + 'shape. Refusing to pass.');
  process.exit(1);
}

const authFresh = [];
for (const [f, n] of authPerFile) {
  const allowed = AUTH_KNOWN.get(f) ?? 0;
  if (n > allowed) authFresh.push({ file: f, now: n, allowed });
}
const authDropped = [];
for (const [f, was] of AUTH_KNOWN) {
  const now = authPerFile.get(f) ?? 0;
  if (now < was) authDropped.push({ file: f, was, now });
}

if (authFresh.length) {
  console.error(`\n${authFresh.length} file${authFresh.length === 1 ? '' : 's'} discard the error from a `
    + '`supabase.auth.*` call, so a failed read is indistinguishable from nobody being signed in:\n');
  for (const a of authFresh) {
    for (const o of authOffenders.filter((x) => x.file === a.file)) {
      console.error(`  ${o.file}:${o.line}  ${o.text}`);
    }
    console.error(a.allowed
      ? `    (this file is on the ratchet at ${a.allowed}; it now has ${a.now})`
      : '    (this file is not on the ratchet — it is a new discard)');
  }
  console.error('\nA null user from a failed `getUser()` is not a signed-out user. Lane 114 found exactly');
  console.error('this in studio-web/lib/supabase.ts and check:reads passed with it in the file: an auth');
  console.error('outage put the sign-in form in front of a signed-in owner. Read `error` and let the');
  console.error('failure be its own state — or mark the line `auth-error-ok: <why a failed auth read and');
  console.error('an absent session are honestly the same answer here>`.');
  process.exit(1);
}

if (authDropped.length) {
  for (const d of authDropped) {
    console.error(`check:reads — ${d.file} is ratcheted at ${d.was} auth discard${d.was === 1 ? '' : 's'} and now has ${d.now}. `
      + (d.now === 0 ? 'Delete the entry from AUTH_KNOWN in scripts/check-reads.mjs.' : `Lower it to ${d.now} in AUTH_KNOWN in scripts/check-reads.mjs.`));
  }
  console.error('');
}

const authBacklog = [...AUTH_KNOWN.values()].reduce((n, c) => n + c, 0);
console.log(`reads ok — ${files.length} files across the apps, the console and the edge functions; every read either checks error or says why it need not.`);
if (vanished.size) {
  console.log(`  ${vanished.size} path${vanished.size === 1 ? '' : 's'} disappeared mid-scan and ${vanished.size === 1 ? 'was' : 'were'} skipped — `
    + 'another lane is writing this tree. The count above is that many files short of what was listed.');
}
console.log(`  and ${authReadsSeen} \`supabase.auth.*\` reads: no new discarded auth error, ${authBacklog} known and ratcheted across ${AUTH_KNOWN.size} files.`);
