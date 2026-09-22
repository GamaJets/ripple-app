// Notification preferences: what a switch is allowed to promise.
//
// The failures worth guarding are all the same shape — a control that says one
// thing and does another:
//
//   · a category defaulting to OFF because a JSON parse failed, silencing
//     somebody's session reminders with no indication why;
//   · a switch offered for a category this app cannot reach, so it reads "off"
//     while the banners keep arriving;
//   · quiet hours DROPPING a reminder instead of moving it, which the member
//     cannot tell apart from a reminder that never worked;
//   · a wrapped quiet window pushing a 23:00 nudge to 07:00 the same morning —
//     a time in the past, which `scheduleLocal` refuses, so nothing is
//     scheduled at all and nothing says so.
//
// `ok`/`eq` into an errors array and process.exit(1) — never node:assert.
import {
  CATEGORIES, DEFAULT_NOTIFY_PREFS, allows, categoryDef, categoryForRoute, hourToDeliver,
  timeToDeliver, deliveryMinute, movedNote,
  inQuietHours, prefsFromStored, quietLabel, whenToDeliver, type NotifyPrefs,
} from './notifyPrefs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const prefs = (over: Partial<NotifyPrefs> = {}): NotifyPrefs => ({ ...DEFAULT_NOTIFY_PREFS, ...over });

// ── the catalogue ────────────────────────────────────────────────────────
{
  const keys = CATEGORIES.map((c) => c.key);
  eq(new Set(keys).size, keys.length, 'every category key is unique');
  for (const c of CATEGORIES) {
    ok(/^[A-Z]/.test(c.title), `${c.key}'s title is Title Case — it is a switch label`);
    ok(c.note.endsWith('.'), `${c.key}'s note is prose and ends in a full stop`);
    eq(categoryDef(c.key)!.key, c.key, `${c.key} is findable`);
  }
  eq(categoryDef('nope'), null, 'an unknown key is null');
  // A session or class reminder is a thing the member booked at a time they
  // chose. Silencing its one-hour warning because 6:30am falls inside quiet
  // hours would make them late for the session being warned about.
  eq(categoryDef('sessions')!.quietable, false,
    'A BOOKED SESSION IS NEVER SILENCED BY QUIET HOURS — the member picked that time');
  eq(categoryDef('classes')!.quietable, false, 'and neither is a booked class');
  eq(categoryDef('coach')!.local, false,
    'the coach category is REMOTE, so no switch here could stop it and none is offered');
}

// ── reading the store ────────────────────────────────────────────────────
{
  eq(prefsFromStored(null).quiet, false, 'nothing stored means the defaults');
  eq(Object.keys(prefsFromStored(null).off).length, 0, 'and nothing switched off');
  eq(prefsFromStored('not json').quiet, false, 'a corrupt blob means the defaults, not a throw');
  eq(prefsFromStored('null').quiet, false, 'and so does a blob holding null');
  // The direction that matters. A missing key, an unread store and a fresh
  // install all mean "not answered", and defaulting those to off silences
  // somebody's reminders because a parse failed.
  ok(allows('sessions', prefsFromStored('{}')),
    'AN UNANSWERED CATEGORY IS ON — defaulting to off silences a member who never chose that');
  ok(allows('reminders', prefsFromStored(null)), 'as is one nobody has ever stored');
  // Only a literal true is an answer.
  ok(!allows('reminders', prefsFromStored('{"off":{"reminders":true}}')), 'an explicit true is honoured');
  ok(allows('reminders', prefsFromStored('{"off":{"reminders":"yes"}}')),
    'a string is not an answer and must not silence anything');
  ok(allows('reminders', prefsFromStored('{"off":{"reminders":1}}')), 'nor is a number');
  // One bad field must not discard the rest.
  const mixed = prefsFromStored('{"off":{"motivation":true},"quiet":true,"quietFromHour":99,"quietToHour":7}');
  ok(!allows('motivation', mixed), 'a category choice survives a bad hour beside it');
  eq(mixed.quietFromHour, DEFAULT_NOTIFY_PREFS.quietFromHour, 'and the bad hour falls back rather than poisoning the blob');
  eq(mixed.quietToHour, 7, 'while the good one is kept');
}

// ── a remote category can never be gated here ────────────────────────────
//
// Returning false would create the illusion that a switch had stopped
// something it cannot reach — the exact shape of the bug pushConsent.ts exists
// for, pointing the other way.
{
  ok(allows('coach', prefs({ off: { coach: true } })),
    'A REMOTE CATEGORY IS ALWAYS ALLOWED THROUGH THIS GATE — the server sends it and this function cannot stop it');
}

// ── the quiet window, including the wrap ─────────────────────────────────
{
  const p = prefs({ quiet: true, quietFromHour: 22, quietToHour: 7 });
  for (const h of [22, 23, 0, 3, 6]) ok(inQuietHours(h, p), `${h}:00 is inside a 22 to 7 window`);
  for (const h of [7, 8, 12, 21]) ok(!inQuietHours(h, p), `${h}:00 is outside it`);
  ok(!inQuietHours(3, prefs({ quiet: false, quietFromHour: 22, quietToHour: 7 })),
    'and none of it applies when quiet hours are off');
  // A same-day window, which is the case a wrap-only implementation gets wrong.
  const day = prefs({ quiet: true, quietFromHour: 9, quietToHour: 17 });
  ok(inQuietHours(12, day), 'a same-day window works too');
  ok(!inQuietHours(20, day), 'and does not wrap when it was not asked to');
  // Zero length means zero, not twenty-four.
  const none = prefs({ quiet: true, quietFromHour: 8, quietToHour: 8 });
  for (const h of [0, 8, 15, 23]) ok(!inQuietHours(h, none),
    `A ZERO-LENGTH WINDOW SILENCES NOTHING — reading it as all day deletes every notification with no indication why (${h}:00)`);
}

// ── shifted, never dropped ───────────────────────────────────────────────
{
  const p = prefs({ quiet: true, quietFromHour: 22, quietToHour: 7 });
  // 03:00 on the 14th → 07:00 the same morning.
  const night = new Date(2026, 2, 14, 3, 0, 0, 0);
  const moved = whenToDeliver(night, 'reminders', p);
  eq(moved.getHours(), 7, 'a 3am reminder is moved to the end of the window');
  eq(moved.getDate(), 14, 'on the same morning, because 7am that day is still ahead of it');
  ok(moved.getTime() > night.getTime(), 'AND IT IS NEVER MOVED INTO THE PAST — scheduleLocal refuses a past date, so that is a reminder that silently never happens');

  // 23:00 on the 14th → 07:00 on the 15th. This is the wrap case: setting the
  // hour alone lands on 07:00 of the 14th, sixteen hours earlier.
  const late = new Date(2026, 2, 14, 23, 30, 0, 0);
  const rolled = whenToDeliver(late, 'reminders', p);
  eq(rolled.getHours(), 7, 'a late-evening reminder is moved to 7am');
  eq(rolled.getDate(), 15, 'THE NEXT MORNING, not sixteen hours into the past');
  ok(rolled.getTime() > late.getTime(), 'so it is still in the future');

  const fine = new Date(2026, 2, 14, 18, 0, 0, 0);
  eq(whenToDeliver(fine, 'reminders', p).getTime(), fine.getTime(), 'a reminder outside the window is untouched');
  ok(whenToDeliver(fine, 'reminders', p) !== fine, 'and a new Date is returned, never the caller’s own');

  // Not quietable: a booked session's warning goes when it goes.
  eq(whenToDeliver(night, 'sessions', p).getTime(), night.getTime(),
    'a session reminder at 3am is left alone — the member booked a 4am session and needs the warning');
  eq(whenToDeliver(night, 'reminders', prefs({ quiet: false })).getTime(), night.getTime(),
    'and nothing moves at all when quiet hours are off');
}

// ── the repeating form ───────────────────────────────────────────────────
//
// A daily trigger has an hour and no date, so it cannot be pushed forward — the
// hour itself moves to the end of the window instead.
{
  const p = prefs({ quiet: true, quietFromHour: 22, quietToHour: 7 });
  eq(hourToDeliver(3, 'reminders', p), 7, 'a 3am daily reminder becomes a 7am one');
  eq(hourToDeliver(23, 'reminders', p), 7, 'and so does an 11pm one');
  eq(hourToDeliver(9, 'reminders', p), 9, 'an hour outside the window is untouched');
  eq(hourToDeliver(3, 'sessions', p), 3, 'and a non-quietable category is never moved');
  eq(hourToDeliver(3, 'reminders', prefs()), 3, 'nor is anything when quiet hours are off');
}

// ── the label ────────────────────────────────────────────────────────────
{
  eq(quietLabel(prefs({ quietFromHour: 22, quietToHour: 7 })), '10pm to 7am', 'the window reads in twelve-hour time');
  eq(quietLabel(prefs({ quietFromHour: 0, quietToHour: 12 })), '12am to 12pm', 'midnight and noon are 12, not 0');
  ok(!quietLabel(prefs()).endsWith('.'), 'no trailing full stop — the caller punctuates');
}

/* ── nothing lands on top of anything else ─────────────────────────────────
 *
 * Every quietable notification inside the window used to be set to
 * `quietToHour, 0, 0, 0` — one instant, to the millisecond. reminderPlan emits
 * a hydration nudge on the hour for every step of its window, so 22:00 and
 * 23:00 both became 07:00:00.000; the OS collapses simultaneous banners and the
 * member got one and lost the rest. The shift exists so a nudge is never
 * dropped, and stacking is how it dropped them anyway.
 */
{
  const p = { ...DEFAULT_NOTIFY_PREFS, quiet: true, quietFromHour: 22, quietToHour: 7 };

  const ten = timeToDeliver(22, 0, 'reminders', p);
  const eleven = timeToDeliver(23, 0, 'reminders', p);
  eq(ten.hour, 7, 'a 10pm reminder arrives in the 7am hour');
  eq(eleven.hour, 7, 'and so does an 11pm one');
  ok(ten.minute !== eleven.minute, 'but NOT at the same minute — that is the whole bug');
  ok(ten.minute < eleven.minute, 'and the earlier one arrives first: order is kept');

  // Everything still lands inside the first hour the member is awake.
  for (const h of [22, 23, 0, 1, 2, 3, 4, 5, 6]) {
    const out = timeToDeliver(h, 0, 'reminders', p);
    eq(out.hour, 7, `an ${h}:00 reminder is delivered in the 7am hour`);
    ok(out.minute >= 0 && out.minute <= 59, 'and inside it');
  }

  // Monotonic all the way through the window: a whole night of hourly nudges
  // arrives in the order it was set.
  let last = -1;
  for (const h of [22, 23, 0, 1, 2, 3, 4, 5, 6]) {
    const m = timeToDeliver(h, 0, 'reminders', p).minute;
    ok(m >= last, `minute does not go backwards at ${h}:00`);
    last = m;
  }
  // And an hourly set of nine nudges produces at least eight distinct minutes,
  // where it used to produce one.
  const minutes = new Set([22, 23, 0, 1, 2, 3, 4, 5, 6].map((h) => timeToDeliver(h, 0, 'reminders', p).minute));
  ok(minutes.size >= 8, `an hourly window spreads out, got ${minutes.size} distinct minutes`);

  // Minutes within an hour are kept apart too.
  ok(timeToDeliver(22, 0, 'reminders', p).minute !== timeToDeliver(22, 30, 'reminders', p).minute,
    'two reminders half an hour apart do not collide either');

  // Untouched cases are untouched, to the minute.
  const outside = timeToDeliver(9, 15, 'reminders', p);
  eq(outside.hour, 9, 'an hour outside the window is not moved');
  eq(outside.minute, 15, 'and keeps its minute exactly');
  const notQuietable = timeToDeliver(3, 20, 'sessions', p);
  eq(notQuietable.hour, 3, 'a non-quietable category is never moved');
  eq(notQuietable.minute, 20, 'nor is its minute');
  const off = timeToDeliver(3, 20, 'reminders', { ...p, quiet: false });
  eq(off.hour, 3, 'and nothing is moved when quiet hours are off');

  // The boundaries of the mapping.
  eq(deliveryMinute(22, 0, p), 0, 'the first minute of the window maps to the top of the hour');
  ok(deliveryMinute(6, 59, p) <= 59, 'and the last stays inside it');

  // The member is TOLD. The reminders screen echoed the typed time back beside
  // the box and said nothing at all about it being moved.
  const label = (h: number, m: number) => `${h}:${String(m).padStart(2, '0')}`;
  const note = movedNote(23, 0, 'reminders', p, label);
  ok(note != null && /quiet hours/i.test(note), 'a time inside quiet hours says so');
  ok(note != null && /instead/.test(note), 'and says when it will actually arrive');
  eq(movedNote(9, 0, 'reminders', p, label), null, 'a time outside them says nothing');
  eq(movedNote(3, 0, 'sessions', p, label), null, 'and a non-quietable one is not warned about a move that will not happen');
}

/* ── the category a caller forgot to pass ──────────────────────────────── */
//
// `scheduleLocal` reads `if (category && !allows(...))`, so an omitted category
// is not a gate at all — and src/ui/badgeWatch.tsx omitted it. A member who
// turned OFF 'Streaks And Badges', a switch whose own label reads "when you
// unlock a badge", went on being congratulated; one with quiet hours got the
// congratulation at the hour it happened, because `motivation` is quietable and
// nothing asked. A switch shown, used and ignored is worse than no switch.

eq(categoryForRoute('/(client)/achievements'), 'motivation',
  'a notification that opens Achievements is a badge, whoever wrote it');
eq(categoryForRoute('/(client)/achievements?from=finish'), 'motivation',
  'and a query string is part of the route, not part of the match');
eq(categoryForRoute('/(client)/workouts'), 'motivation', 'the streak nudge’s screen too');

// Whole-route matching, as inboxIcon and notificationChannel both do it.
// Somebody who believed it was prefix matching would "fix" a miss by reordering
// the table and nothing would change.
eq(categoryForRoute('/(client)/achievements-archive'), null,
  'a longer route that starts with a known one is a different screen');
eq(categoryForRoute('/(client)/calendar'), null,
  'a booked session is not motivational — it is a thing the member asked for');
eq(categoryForRoute(''), null, 'nothing to go on is nothing decided');
eq(categoryForRoute(null), null, 'and neither is no route');
eq(categoryForRoute(undefined), null, 'nor a missing one');

// Null is the SAFE answer and it means "nobody has decided". An unclassified
// local notification is still scheduled: the failure of a missed gate is a
// banner somebody did not want, and the failure of a default-deny is a session
// reminder that never arrives.
{
  const offMotivation: NotifyPrefs = { ...DEFAULT_NOTIFY_PREFS, off: { motivation: true } };
  const inferred = categoryForRoute('/(client)/achievements');
  ok(inferred != null && !allows(inferred, offMotivation),
    'with Streaks And Badges off, a badge banner inferred from its route is refused');
  const unknown = categoryForRoute('/(client)/somewhere-new');
  eq(unknown, null, 'and a route nobody has classified is not refused — it is not decided');
}

if (errors.length) {
  console.error(`notifyPrefs.test.ts — ${errors.length} failures:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('notifyPrefs.test.ts — ok');
