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
  TRIAL_DAYS,
  TRIAL_NOT_YET_ENFORCED,
} from './trialGate';

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

eq(trialFrom('2026-09-01T10:00:00.000Z', START)!.startedOn, '2026-09-01', 'the start day is reported as a day');

/* ── 2. an unread trial is not an expired one ───────────────────────────── */

// THE assertion. Three non-ready statuses, and not one of them may produce a
// state, an expiry, or a sentence that reads as one.
for (const bad of ['error', 'partial', 'loading'] as const) {
  const r = readTrial('2020-01-01T00:00:00.000Z', bad, START);
  eq(r.state, null, `no trial state under '${bad}'`);
  eq(r.source, 'unread', `and the source says it was not read under '${bad}'`);
  ok(!/ended|used up|expired|up\b/i.test(r.note.split('.')[0]), `and the first sentence does not say it ended under '${bad}'`);
  ok(/not a statement that it has ended/i.test(r.note), `and it says outright that this is not an ending under '${bad}'`);
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

const account = trialFrom('2026-01-01T10:00:00.000Z', START)!; // 0 days left

// The shape that proves the leak: a phone that thinks there are eleven days of
// a trial the account says ended in January. Shown rather than swallowed.
{
  const line = trialDisagreement(account, 11);
  ok(!!line, 'a phone that disagrees with the account is reported');
  ok(/Your account is the one that counts/i.test(line!), 'and the account is named as the authority');
}
eq(trialDisagreement(account, 0), null, 'agreement says nothing');
eq(trialDisagreement(null, 11), null, 'and nothing is claimed when the account could not be read');
eq(trialDisagreement(account, null), null, 'or when the phone has no figure');

/* ── 5. honest about not being a gate ───────────────────────────────────── */

// A coach reading "your trial has ended" beside a fully working app would
// reasonably conclude the app was lying about one or the other.
ok(/Nothing is switched off/i.test(TRIAL_NOT_YET_ENFORCED), 'the screen says nothing is gated on this yet');
ok(/survives a reinstall/i.test(TRIAL_NOT_YET_ENFORCED), 'and says what it IS for');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'TRIAL GATE FAILURES:\n' + errors.join('\n') : 'ALL TRIAL GATE TESTS PASSED');
if (errors.length) process.exit(1);
