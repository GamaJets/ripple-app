// The member's own session reminder. Compile with tsc, run with node.
//
// The defect this suite is the guard on: `bookSession` armed one banner at the
// moment of booking and nothing ever took it back, so a member who cancelled or
// moved their Tuesday 6:30 was still told at 5:30 to go to it — and a member
// whose session arrived any other way (a standing appointment, a waitlist
// promotion, the coach booking them in) was never told anything at all.
//
// The assertions that matter here are about the WINDOW. `staleReminders`
// refuses to cancel an arming outside the span the caller says it read, so
// `readWindow` is the one thing standing between "a cancelled session keeps its
// banner" and "one failed query silently disarms a member's whole diary".
import { CLIENT_ARM_AHEAD_DAYS, clientReminderBody, myRemindable, readWindow } from './clientReminders';
import { staleReminders, toArm, type ArmedMap, type RemindableSession } from './coachReminders';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse('2026-09-01T09:00:00.000Z');
const ME = 'client-1';

/* ── the words ──────────────────────────────────────────────────────────── */

const soon = new Date(NOW + 3 * HOUR).toISOString();
const withCoach = clientReminderBody(soon, 'Ana Duarte');
ok(withCoach.includes('Ana Duarte'), 'the coach is named — a member at a gym with two coaches needs to know whose hour it is');
ok(withCoach.includes('in an hour'), 'and when it is');
ok(!clientReminderBody(soon, null).includes('with '), 'no coach name drops the clause rather than leaving "with "');
ok(!clientReminderBody(soon, null).includes('—'), 'and never puts a dash where a name should be');
ok(clientReminderBody('not a date', 'Ana Duarte').includes('in an hour'),
  'an unreadable start still says the thing that is true, with no dash in it');
ok(!clientReminderBody('not a date', null).includes('Invalid'),
  'and never leaks a Date failure into a sentence somebody reads');

/* ── whose sessions ─────────────────────────────────────────────────────── */

const diary = [
  { id: 'mine', clientId: ME, startsAt: soon, status: 'booked', outcome: null },
  // An open slot the coach published. Visible to this member through RLS, and
  // an offer rather than an appointment — a banner about one would send
  // somebody to a gym where nobody is expecting them.
  { id: 'open', clientId: null, startsAt: soon, status: 'available', outcome: null },
  // Somebody else's booking is not readable in practice, but the filter is what
  // makes that a guarantee rather than a hope.
  { id: 'theirs', clientId: 'client-2', startsAt: soon, status: 'booked', outcome: null },
];
const mine = myRemindable(diary, ME);
eq(mine.length, 1, 'only the member’s own rows');
eq(mine[0].id, 'mine', 'and it is theirs');
eq(myRemindable(diary, null).length, 0, 'nobody signed in means nothing to arm');
// `toArm` is the second gate on the same question and must agree.
eq(toArm(myRemindable([{ id: 'open', clientId: ME, startsAt: soon, status: 'available', outcome: null }], ME), {}, NOW).length,
  0, 'a slot that is not booked arms nothing even when it is filed under this member');

/* ── the window, which is the whole of it ───────────────────────────────── */

eq(readWindow('loading', [soon]), null, 'a read still in flight may not cancel anything');
eq(readWindow('error', [soon]), null, 'and a failed read certainly may not — one bad query must not disarm a diary');

const whole = readWindow('ready', []);
ok(whole != null && whole.from === -Infinity && whole.to === Infinity,
  'a whole read speaks about every instant, so a session that is NOT in it is genuinely gone');

const oldest = new Date(NOW + 2 * DAY).toISOString();
const cut = readWindow('partial', [new Date(NOW + 9 * DAY).toISOString(), oldest]);
eq(cut?.from, Date.parse(oldest), 'a truncated read speaks from its oldest row forward');
eq(cut?.to, Infinity, 'and to the end of it');
eq(readWindow('partial', ['not a date']), null, 'a truncated read with nothing readable in it speaks about nothing');

/* ── what the window buys: a cancelled session loses its banner ─────────── */

const armed: ArmedMap = { mine: { notifId: 'n1', startsAt: soon } };
const gone: RemindableSession[] = [];   // the member cancelled it; the row is theirs no longer

const w = readWindow('ready', []);
ok(w != null, 'the whole read has a window');
eq(staleReminders(armed, gone, w!.from, w!.to).length, 1,
  'a session that has left a WHOLE read is stale, and this is the case a window built from the returned rows can never see');
eq(staleReminders(armed, gone, w!.from, w!.to)[0].notifId, 'n1', 'with the id to cancel');

// The same arming, under a read that did not look that far back, is left alone.
const late = readWindow('partial', [new Date(NOW + 30 * DAY).toISOString()]);
eq(staleReminders(armed, gone, late!.from, late!.to).length, 0,
  'and an arming for a time the read never reached is not cancelled on the strength of a query that did not ask');

/* ── a moved session: both halves, or the member is told the old hour ───── */

const moved = new Date(NOW + 5 * HOUR).toISOString();
const after: RemindableSession[] = [{ id: 'mine', startsAt: moved, status: 'booked', outcome: null, clientName: null }];
eq(staleReminders(armed, after, w!.from, w!.to).length, 1, 'the banner for the old hour is taken back');
eq(toArm(after, armed, NOW).length, 1, 'and a new one is armed for the new hour');

/* ── how far ahead, which is the case the old arming got RIGHT ─────────── */

// The reminder this replaced fired at the moment of the tap, so a session
// booked three weeks out was armed three weeks out. A pass driven by the diary
// only arms what is inside its horizon, so a horizon shorter than the booking
// window would have handed that case back as a regression.
const threeWeeks: RemindableSession[] = [
  { id: 'far', startsAt: new Date(NOW + 21 * DAY).toISOString(), status: 'booked', outcome: null, clientName: null },
];
eq(toArm(threeWeeks, {}, NOW, CLIENT_ARM_AHEAD_DAYS).length, 1,
  'a session booked three weeks out is armed now, because the member may not open the app again before it');
eq(toArm(threeWeeks, {}, NOW).length, 0,
  'and the coach’s default window would NOT have armed it — which is why the horizon is a parameter');
// `generateSlots` opens four weeks at a time, so twenty-eight days is the
// furthest ahead an ordinary open slot can be taken. The window has to cover at
// least that or the member who books the last slot in the run is the one who
// gets no banner.
ok(CLIENT_ARM_AHEAD_DAYS >= 28, 'the window covers the whole of what a coach opens in one press');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('clientReminders.test.ts — ok');
