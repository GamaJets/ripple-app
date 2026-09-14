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
const ROOTS = ['src', 'app', 'studio-web/app', 'studio-web/lib'];
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
let vanished = 0;
const gone = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); }
  catch (e) { if (gone(e)) { vanished++; return; } throw e; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); }
    catch (e) { if (gone(e)) { vanished++; continue; } throw e; }
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

const offenders = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
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
    if (lines.slice(Math.max(0, i - 3), i).some((l) => /no-error-ok:[ \t]*\S/.test(l))) return;
    offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 96)}`);
  });
}

if (offenders.length) {
  console.error(`${offenders.length} read${offenders.length === 1 ? '' : 's'} that cannot tell failure from emptiness:\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error('\nRead `error`, and return null rather than an empty answer — or mark the line');
  console.error('`no-error-ok: <why an empty answer is honest here>` if failure genuinely does not matter.');
  process.exit(1);
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
  ['src/ui/appFeedback.ts', 1],
  ['src/ui/assignedPrograms.tsx', 1],
  ['src/ui/attendance.ts', 1],
  ['src/ui/auth.tsx', 2],
  ['src/ui/availability.ts', 2],
  ['src/ui/checkins.tsx', 1],
  ['src/ui/classes.tsx', 1],
  ['src/ui/clientData.tsx', 1],
  ['src/ui/clientTags.tsx', 1],
  ['src/ui/coachBrand.ts', 1],
  ['src/ui/coachChat.ts', 1],
  ['src/ui/coachClose.ts', 1],
  ['src/ui/coachCohorts.ts', 1],
  ['src/ui/coachCosts.ts', 1],
  ['src/ui/coachDelivery.ts', 1],
  ['src/ui/coachExercises.ts', 1],
  ['src/ui/coachNotes.tsx', 1],
  ['src/ui/coachNutrition.tsx', 1],
  ['src/ui/coachPayTerms.ts', 1],
  ['src/ui/coachReceipts.ts', 1],
  ['src/ui/coachRota.ts', 1],
  ['src/ui/coachSettlements.ts', 1],
  ['src/ui/coachSetup.ts', 1],
  ['src/ui/coachStatement.ts', 1],
  ['src/ui/crashQueue.ts', 1],
  ['src/ui/deviceHrv.ts', 1],
  ['src/ui/deviceSleep.tsx', 1],
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
]);

const authOffenders = [];
const authPerFile = new Map();
let authReadsSeen = 0;
const authReadsPerRoot = new Map();
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
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
    const window = [line, ...lines.slice(Math.max(0, i - 3), i)];
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
 */
for (const r of ['src', 'app']) {
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
console.log(`reads ok — ${files.length} files across the apps and the console; every read either checks error or says why it need not.`);
console.log(`  and ${authReadsSeen} \`supabase.auth.*\` reads: no new discarded auth error, ${authBacklog} known and ratcheted across ${AUTH_KNOWN.size} files.`);
