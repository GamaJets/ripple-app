// A trial that survives clearing app data. Compile with tsc, run under node.
//
// Two failures, and the second is much worse than the first:
//
//   · a trial that resets when the app is reinstalled, which is the leak the
//     account-wide record closes;
//   · a trial reported as EXPIRED because the read failed, which the day
//     billing is switched on becomes a paywall raised in front of a coach on
//     their second day by a refused query. That is this app's worst defect
//     wearing a billing hat, and most of what follows is aimed at it.
import {
  trialFrom,
  readTrial,
  trialDisagreement,
  trialCard,
  TRIAL_DAYS,
  TRIAL_NOT_YET_ENFORCED,
} from './trialGate';

declare const process: { exit(code: number): void; exitCode: number };
// Start failed and reach success, so a hang, a throw or an early return cannot
// be mistaken for a pass.
process.exitCode = 1;

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

const DAY = 86_400_000;
const START = Date.parse('2026-09-01T10:00:00.000Z');

/* ── 1. the arithmetic ──────────────────────────────────────────────────── */

eq(trialFrom('2026-09-01T10:00:00.000Z', START)!.daysLeft, TRIAL_DAYS, 'a trial that has just started has all of it left');
eq(trialFrom('2026-09-01T10:00:00.000Z', START + DAY)!.daysLeft, TRIAL_DAYS - 1, 'a day in, a day fewer');
eq(trialFrom('2026-09-01T10:00:00.000Z', START + 13 * DAY)!.daysLeft, 1, 'the last day has one left');
eq(trialFrom('2026-09-01T10:00:00.000Z', START + 14 * DAY)!.daysLeft, 0, 'and then none');
eq(trialFrom('2026-09-01T10:00:00.000Z', START + 14 * DAY)!.expired, true, 'which is expired');
eq(trialFrom('2026-09-01T10:00:00.000Z', START + 13 * DAY)!.expired, false, 'and the day before is not');

// Counted from the START INSTANT, not between calendar days. A coach who signs
// up at 11pm gets a full first day rather than an hour of one.
eq(trialFrom('2026-09-01T23:00:00.000Z', Date.parse('2026-09-02T09:00:00.000Z'))!.daysLeft, TRIAL_DAYS,
  'ten hours after an 11pm signup is still day one');

// Never negative, however long ago it was.
eq(trialFrom('2020-01-01T00:00:00.000Z', START)!.daysLeft, 0, 'a trial from six years ago is nought days left, never a negative');

// A start date in the future is a clock disagreement, not sixteen days of
// trial. Clamped rather than refused: a coach whose phone is a day fast should
// not be shown an error about their own account.
eq(trialFrom('2026-09-10T10:00:00.000Z', START)!.daysLeft, TRIAL_DAYS, 'a future start is the whole trial and no more');

eq(trialFrom(null, START), null, 'no start date is no answer');
eq(trialFrom('', START), null, 'and neither is an empty one');
eq(trialFrom('whenever', START), null, 'nor one that will not parse');
eq(trialFrom('2026-09-01T10:00:00.000Z', NaN), null, 'and a clock that will not read produces no figure either');

// ── the start day belongs to the coach, not to UTC ────────────────────────
//
// This used to be pinned to the literal '2026-09-01', and that pin was the
// assertion that `startedOn` is UTC's day — which is nobody's. It is printed at
// the coach: `trialSentence` says "Your free trial started on …" and "counted
// from …", on the billing screen, in front of somebody about to be asked for
// money. A coach in Kiritimati who signed up at midnight on the 2nd read the
// 1st, and had a day of their fortnight they could not account for.
//
// It cannot be pinned to a literal at all, and that is the point rather than a
// weakness of the test: this suite runs in six zones spanning UTC-11 to UTC+14,
// so there is no instant that falls on one calendar day in all of them. What is
// pinned instead is the CONTRACT — the day read off the coach's own calendar —
// built here from the local getters directly rather than from the function this
// file is testing. Under Pacific/Kiritimati and Pacific/Midway that day is not
// UTC's for this instant, so a regression to `toISOString().slice(0, 10)` fails
// two of the six runs.
const startedState = trialFrom('2026-09-01T10:00:00.000Z', START)!;
const startInstant = new Date(Date.parse('2026-09-01T10:00:00.000Z'));
const pad2 = (n: number) => String(n).padStart(2, '0');
eq(startedState.startedOn,
  `${startInstant.getFullYear()}-${pad2(startInstant.getMonth() + 1)}-${pad2(startInstant.getDate())}`,
  'the start day is the coach’s own calendar day, not UTC’s');
ok(/^\d{4}-\d{2}-\d{2}$/.test(startedState.startedOn),
  'and it is still a plain day, because the sentence prints it verbatim');
// `daysLeft` is the half that must NOT move with the zone: it is counted from
// the start INSTANT, so it is the same number for every coach on earth. The
// arithmetic block above asserts it under all six.
eq(startedState.daysLeft, TRIAL_DAYS, 'and the countdown beside it is zone-independent, as it has to be');

/* ── 2. an unread trial is not an expired one ───────────────────────────── */

// THE assertion. No non-ready status may produce a state, an expiry, or a
// sentence that reads as one.
for (const bad of ['error', 'partial', 'loading'] as const) {
  const r = readTrial('2020-01-01T00:00:00.000Z', bad, START);
  eq(r.state, null, `no trial state under '${bad}'`);
  ok(!/ended|used up|expired|up\b/i.test(r.note.split('.')[0]), `and the first sentence does not say it ended under '${bad}'`);
}

// ── and a read in flight is not a read that failed ────────────────────────
//
// Every non-ready status used to collapse onto 'unread', so a screen one frame
// into its first read told the coach that when their trial started COULD NOT
// BE READ. That is this repo's own rule — loading, failed, empty and unknown
// are four different sentences — broken in the file that states it.
for (const bad of ['error', 'partial'] as const) {
  const r = readTrial('2020-01-01T00:00:00.000Z', bad, START);
  eq(r.source, 'unread', `a failed read is 'unread' under '${bad}'`);
  ok(/not a statement that it has ended/i.test(r.note), `and it says outright that this is not an ending under '${bad}'`);
}
{
  const r = readTrial('2020-01-01T00:00:00.000Z', 'loading', START);
  eq(r.source, 'loading', 'a read still in flight is its own state');
  ok(!/could not/i.test(r.note), 'and does not report a failure that has not happened');
}

// A whole read of a row with nothing in the field is its own answer, and it is
// not an expired trial either — it is a record with a hole in it.
{
  const r = readTrial(null, 'ready', START);
  eq(r.state, null, 'a null start date produces no state');
  eq(r.source, 'none', 'and is reported as an absent record');
  ok(/not an expired trial/i.test(r.note), 'and says so');
}

/* ── 3. a whole read says what is left ──────────────────────────────────── */

{
  const r = readTrial('2026-09-01T10:00:00.000Z', 'ready', START + 3 * DAY);
  eq(r.source, 'account', 'a whole read is answered by the account');
  eq(r.state!.daysLeft, 11, 'and the figure is the account’s');
  ok(/on your account rather than on this phone/i.test(r.note), 'and the note says where it is kept, which is the whole point');
}
{
  const r = readTrial('2026-01-01T10:00:00.000Z', 'ready', START);
  eq(r.state!.expired, true, 'a long-finished trial is expired');
  ok(/reinstalling the app does not start it again/i.test(r.note), 'and the note names the leak it closes');
}

/* ── 4. the disagreement, said out loud ─────────────────────────────────── */

// A whole read of an account whose trial ended in January. 0 days left.
const ended = readTrial('2026-01-01T10:00:00.000Z', 'ready', START);

// The shape that proves the leak: a phone that thinks there are eleven days of
// a trial the account says ended in January. Shown rather than swallowed.
{
  const line = trialDisagreement(ended, 11);
  ok(!!line, 'a phone that disagrees with the account is reported');
  ok(/Your account is the one that counts/i.test(line!), 'and the account is named as the authority');
}
eq(trialDisagreement(ended, 0), null, 'agreement says nothing');
eq(trialDisagreement(ended, null), null, 'and nothing is said when the phone has no figure');

// ── the branch that was switched off where it was needed ──────────────────
//
// This function opened with `if (!account) return null`, and TWO unrelated
// readings arrive here with a null state. Only one of them is an unknown, and
// folding them together meant the single mechanism built to reconcile the
// phone with the account was silent in the state where they diverge hardest:
// the phone asserting a countdown and the account holding nothing to count
// from. That is the exact pair of screens this part was filed about.
{
  const none = readTrial(null, 'ready', START);
  eq(none.source, 'none', 'the fixture is an account that answered with no start date');
  const line = trialDisagreement(none, 12);
  ok(!!line, 'a phone counting down against an account that holds no date is a disagreement');
  ok(line!.includes('12'), 'and the phone’s own figure is quoted, so the coach can see which number is which');
  ok(/not about your account/i.test(line!), 'and it says what that figure is not');
  // Said even at zero. The size of the gap is not the point — that the number
  // is about an installation and the account has no opinion is the point.
  ok(trialDisagreement(none, 0) != null, 'and it is said even when the phone has run out too');
}
// The other null. Nothing was established, so nothing can be reported as
// disagreeing with anything, and asserting one would be inventing it.
for (const bad of ['error', 'partial', 'loading'] as const) {
  eq(trialDisagreement(readTrial(null, bad, START), 11), null,
    `nothing is claimed against an account that did not answer under '${bad}'`);
}

// ── the agreement that is not zero ─────────────────────────────────────────
//
// Every assertion above is made against an account with NO days left, and zero
// is the one value at which `localDaysLeft - account.daysLeft` and
// `localDaysLeft + account.daysLeft` cannot be told apart. Both give 0 on
// agreement and both give 11 on the disagreement above, so the subtraction at
// the heart of this function was asserted by nothing at all.
//
// It matters in the ordinary direction, not the exotic one: the common case is
// a coach mid-trial whose phone and account agree, and under an addition every
// one of them is shown a sentence saying the two figures differ and naming the
// same number twice.
{
  const mid = readTrial('2026-09-01T10:00:00.000Z', 'ready', START + 3 * DAY);
  const left = mid.state!.daysLeft;
  eq(left, TRIAL_DAYS - 3, 'the fixture is mid-trial rather than run out');
  eq(trialDisagreement(mid, left), null,
    'a phone that agrees with an account still in its trial says nothing');
  ok(trialDisagreement(mid, left + 4) != null, 'and one that is four days out does');

  // The threshold. Under a day is not a disagreement — the two figures are cut
  // from clocks that tick independently — and a whole day is.
  eq(trialDisagreement(mid, left + 0.5), null, 'half a day apart is not a disagreement worth a sentence');
  ok(trialDisagreement(mid, left + 1) != null, 'a whole day apart is');

  // Said in words, and the words have to agree with themselves.
  const one = trialDisagreement(mid, 1);
  ok(/has 1 day recorded/.test(String(one)), 'one day is a day, not "1 days"');
  const many = trialDisagreement(mid, 3);
  ok(/has 3 days recorded/.test(String(many)), 'and three are days');
  ok(String(many).includes(String(left)),
    'and the account’s own figure is the one quoted back, not the phone’s repeated twice');
}

/* ── 4b. what the Clients tab is allowed to print ───────────────────────── */

// The defect this part was filed about, as a contract: the coach's first
// screen printed "12 days left in your free trial" from an AsyncStorage
// counter, while Billing said the start date could not be read. `trialCard`
// is the one place that decides a countdown is printable, so the two screens
// agree by construction rather than by both happening to read the same thing.
{
  const mid = readTrial('2026-09-01T10:00:00.000Z', 'ready', START + 3 * DAY);
  const card = trialCard(mid, false);
  ok(!!card, 'an account that answered with a start date gets a card');
  ok(card!.title.includes(String(mid.state!.daysLeft)),
    'and the figure on it is the account’s, which is the only figure anybody may print');
  eq(card!.expired, false, 'a running trial is not an expired one');
}
// Nothing established, nothing printed. Not an apology, not a zero, not the
// phone's number — the argument is in the function's header and the short of
// it is that nothing is gated on the trial, so a card that cannot state a
// figure has nothing to warn anybody about.
for (const bad of ['error', 'partial', 'loading'] as const) {
  eq(trialCard(readTrial('2026-09-01T10:00:00.000Z', bad, START), true), null,
    `no card is drawn from an account that did not answer under '${bad}'`);
}
eq(trialCard(readTrial(null, 'ready', START), true), null,
  'and none is drawn for an account that holds no start date');

// An expired trial IS printed, because that one is a fact the account stated.
{
  const card = trialCard(ended, false);
  ok(!!card, 'an expired trial is still the account speaking, so it is still shown');
  eq(card!.expired, true, 'and it is marked as expired');
  ok(!/\d/.test(card!.title), 'with no countdown in the headline, because there is nothing left to count');
}

// ── the card never claims a consequence ───────────────────────────────────
//
// Nothing in this codebase is gated on the trial: no screen refuses anything,
// and the plan features in `PLANS` ("Up to 3 clients") are checked nowhere. So
// neither state may say the roster stops or that anything is locked — a false
// claim about what a subscription buys is what a store reviewer opens the paid
// screen to check.
for (const open of [true, false]) {
  for (const r of [readTrial('2026-09-01T10:00:00.000Z', 'ready', START + 3 * DAY), ended]) {
    const card = trialCard(r, open)!;
    ok(!/lock|unlock|keep coaching your|stop|lose|disabled/i.test(card.note),
      `the card claims no consequence (billingOpen=${open}, expired=${card.expired})`);
  }
}
// And it does not offer a door that opens onto a wall. `billingAvailable()` is
// false on every profile in this repo today, and the card that said
// "Subscribe any time" over a screen with nothing to buy sent a coach whose
// trial had just expired to a price list with no buttons.
{
  const mid = readTrial('2026-09-01T10:00:00.000Z', 'ready', START + 3 * DAY);
  ok(/not open yet/i.test(trialCard(mid, false)!.note), 'with billing off, the card says subscriptions are not open');
  ok(/Subscribe/i.test(trialCard(mid, true)!.note), 'and with billing on it offers the plans');
}

/* ── 5. honest about not being a gate ───────────────────────────────────── */

// A coach reading "your trial has ended" beside a fully working app would
// reasonably conclude the app was lying about one or the other.
ok(/Nothing is switched off/i.test(TRIAL_NOT_YET_ENFORCED), 'the screen says nothing is gated on this yet');
ok(/survives a reinstall/i.test(TRIAL_NOT_YET_ENFORCED), 'and says what it IS for');

console.log(errors.length ? 'TRIAL GATE FAILURES:\n' + errors.join('\n') : 'ALL TRIAL GATE TESTS PASSED');
if (errors.length) process.exit(1);
process.exitCode = 0;
