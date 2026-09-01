// Tests for the front-desk lane's pure rules.
//
// Five subjects, all of them logic that could not be asserted before because it
// either did not exist or lived inside a function that makes a Supabase call:
//
//   · consoleSearch — the console had no search box anywhere, and the one thing
//     a search box must never do is make a filtered list read like an empty gym;
//   · gymSchedule.weeklyOccurrences — skip dates were compared against the UTC
//     date in a product that sells in AED, so a gym closing for Christmas could
//     watch the occurrence survive;
//   · gymVisits.busiestSlots — the staffing question. `peakHour` flattens the
//     week, so a gym whose Saturdays are heaving reads as "busy at 09:00" and
//     gets somebody rostered on a Tuesday;
//   · gymRota.rotaCost — a total that silently adds two currencies together, or
//     counts an unpriced shift as free, is worse than no total;
//   · gymReach.buildSegments — the one that could do real damage: a gym with no
//     door log must not have its entire roster sorted into "not seen in 60 days"
//     and sent a winback message.
//
// Compile with tsc then run with node, like gymClassFill.test.ts.
import { normalise, terms, matches, searchRows, searchNote } from './consoleSearch';
import { weeklyOccurrences, isCancelled, classesThatRan, placesLeft, splitRoster, type GymClass, type NewClass, type RosterEntry } from './gymSchedule';
import { busiestSlots, visitsByWeekday, wasSwept, SWEEP_NOTE, type Visit } from './gymVisits';
import { rotaCost, shiftBlocker, type Shift } from './gymRota';
import { buildSegments, reachBlocker, willTruncateInbox, deliveryNote, segmentCsv, LAPSING_DAYS, UNSEEN_DAYS, type SegmentMember } from './gymReach';
import { parseTags, tagsText, isReachable, contactLine, isEmptyPatch, type GymMemberRecord } from './gymMembers';
import { inviteMessage, inviteSubject, inviteMailto, bulkInviteMailto } from './memberInvites';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── consoleSearch ────────────────────────────────────────────────────────── */

{
  eq(normalise('  Sara   OKAFOR '), 'sara okafor', 'case folds and whitespace collapses');
  eq(normalise('Zoë Gonçalves'), 'zoe goncalves',
    'accents are stripped, because an owner on an English keyboard types "zoe"');
  eq(normalise(null), '', 'a null field is the empty string, not "null"');

  eq(terms('').length, 0, 'an empty query has no terms');
  eq(terms('  a   b ').join('|'), 'a|b', 'terms split on whitespace');

  ok(matches(['Sara Okafor'], 'sara ok'),
    'every term must appear somewhere — "sara ok" finds "Sara Okafor", which a substring match cannot');
  ok(matches(['Sara Okafor', 'Gold'], 'gold sara'), 'terms may be in any order and across fields');
  ok(!matches(['Sara Okafor'], 'sara gold'), 'a term that appears nowhere fails the row');
  ok(matches(['anything'], '   '), 'a blank query matches everything, so callers can filter unconditionally');

  // The failure this guards: `String(null)` is "null", and half the columns in
  // this console are deliberately nullable so a gap can render as a dash.
  ok(!matches([null, undefined, 'Sara'], 'null'),
    'a null field is dropped rather than stringified, so "nul" does not match every unset plan');

  const rows = [{ n: 'Sara' }, { n: 'Tom' }];
  ok(searchRows(rows, '', (r) => [r.n]) === rows,
    'an empty query returns the SAME array, so a memoising caller does no work');
  eq(searchRows(rows, 'tom', (r) => [r.n]).length, 1, 'and a real query filters');
}

{
  // The rule the whole module exists for: a filtered list that comes back empty
  // must not read like a gym with no members.
  eq(searchNote('', 0, 40), null, 'nothing is said when nothing is being filtered');
  const none = searchNote('zzz', 0, 40) ?? '';
  ok(none.includes('40'), 'a search that hides everything says how many it is hiding');
  ok(none.toLowerCase().includes('not an empty gym'),
    'and says explicitly that this is the search box, not the record');
  ok((searchNote('a', 12, 40) ?? '').startsWith('12 of 40'), 'a partial filter reports both figures');
  eq(searchNote('a', 3, 3), 'All 3 match “a”.', 'and says so when the filter changes nothing');
  eq(searchNote('a', 0, 0), null, 'an empty list gets no note — its own empty state is the honest one');
}

/* ── weekly series: the skip date, and the shape ──────────────────────────── */

const spin: NewClass = {
  title: 'Spin', startsAt: '2026-09-01T18:00:00.000Z', durationMin: 45, capacity: 20,
};

{
  const four = weeklyOccurrences(spin, 4);
  eq(four.length, 4, 'four weeks is four occurrences');
  eq(four[0].startsAt, spin.startsAt, 'the first occurrence is the one given');

  // The bug: skip dates were compared against `iso.slice(0, 10)` — the UTC date
  // — and this product sells in AED. Asserted here in local terms, which is
  // what the gym types into the box.
  const localDayOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const third = localDayOf(four[2].startsAt);
  const skipped = weeklyOccurrences(spin, 4, [third]);
  eq(skipped.length, 3, `skipping the third occurrence's LOCAL date drops exactly one (${third})`);
  ok(!skipped.some((c) => localDayOf(c.startsAt) === third),
    'and the skipped local date is the one that is gone');

  eq(weeklyOccurrences(spin, 4, ['  ', '']).length, 4, 'blank skip entries are ignored, not treated as a date');
}

{
  const fortnightly = weeklyOccurrences(spin, 3, [], { everyWeeks: 2 });
  const gap = Date.parse(fortnightly[1].startsAt) - Date.parse(fortnightly[0].startsAt);
  eq(gap, 14 * 86400000, 'every 2 weeks means a fortnight between occurrences');

  eq(weeklyOccurrences(spin, 3, [], { everyWeeks: 0 })[1].startsAt !== spin.startsAt, true,
    'a step of 0 is floored to 1 rather than writing the same instant three times');

  const capped = weeklyOccurrences(spin, 52, [], { untilDate: '2026-09-15' });
  ok(capped.length <= 3, `an end date stops the series (got ${capped.length})`);
  eq(weeklyOccurrences(spin, 4, [], { untilDate: '  ' }).length, 4, 'a blank end date is no end date');

  const withId = weeklyOccurrences(spin, 2, [], { seriesId: 'series-1' });
  ok(withId.every((c) => c.seriesId === 'series-1'), 'every occurrence carries the series id');
  eq(weeklyOccurrences({ ...spin, startsAt: 'nonsense' }, 4).length, 0,
    'an unparseable start yields no occurrences rather than 4 invalid dates');
}

/* ── a cancelled class is not a class with empty places ───────────────────── */

const cls = (over: Partial<GymClass> = {}): GymClass => ({
  id: 'c1', title: 'Spin', room: null, instructor: null, trainerId: null,
  startsAt: spin.startsAt, durationMin: 45, capacity: 20,
  booked: 5, attended: 4, waitlisted: 0, waitlistAttended: 0, ...over,
});

{
  ok(!isCancelled(cls()), 'a class with no status is ON — that is what every row was before part 195');
  ok(isCancelled(cls({ status: 'cancelled' })), 'and a cancelled one is not');
  eq(classesThatRan([cls(), cls({ id: 'c2', status: 'cancelled' })]).length, 1,
    'only the classes that were actually on');

  eq(placesLeft(cls({ capacity: 20, booked: 5 })), 15, 'places left is capacity minus booked');
  eq(placesLeft(cls({ capacity: 0, booked: 5 })), null,
    'a class nobody sized has an UNKNOWN number of free places — 0 would be read as sold out at the desk');
  eq(placesLeft(cls({ capacity: 5, booked: 9 })), 0, 'an over-sold class has none left, never a negative');
}

/* ── the waiting list ─────────────────────────────────────────────────────── */

{
  const r = (id: string, status: string): RosterEntry =>
    ({ bookingId: id, userId: 'u' + id, name: null, status, attendedAt: null });
  const split = splitRoster([r('1', 'booked'), r('2', 'waitlist'), r('3', 'nonsense')]);
  eq(split.booked.length, 1, 'a booked row holds a place');
  eq(split.waiting.length, 1, 'a waitlist row is waiting for one');
  ok(!split.booked.some((x) => x.bookingId === '3') && !split.waiting.some((x) => x.bookingId === '3'),
    'an unrecognised status is neither — widening the constraint later must not silently promote anybody');
}

/* ── when is the gym busy ─────────────────────────────────────────────────── */

const visit = (iso: string, over: Partial<Visit> = {}): Visit => ({
  id: iso + (over.id ?? ''), memberId: 'm1', memberName: null, passId: null, classId: null,
  enteredAt: iso, exitedAt: null, source: 'desk', note: null, ...over,
});

{
  // Built in LOCAL time, because that is what the functions read and what a
  // rota is written in. 2026-09-05 is a Saturday, 2026-09-01 a Tuesday.
  const sat = (h: number, n: number) =>
    Array.from({ length: n }, (_, i) => visit(new Date(2026, 8, 5, h, 5 + i).toISOString(), { id: `s${h}${i}` }));
  const tue = (h: number, n: number) =>
    Array.from({ length: n }, (_, i) => visit(new Date(2026, 8, 1, h, 5 + i).toISOString(), { id: `t${h}${i}` }));

  const week = visitsByWeekday([...sat(9, 8), ...tue(9, 2)]);
  eq(week.length, 7, 'every weekday is present, including the quiet ones');
  eq(week[0].day, 'Mon', 'the week opens on Monday, like the rota');
  eq(week[5].visits, 8, 'Saturday carries its eight');
  eq(week[1].visits, 2, 'and Tuesday its two');
  eq(week[3].visits, 0, 'a day with nothing is present at zero rather than missing');

  const slots = busiestSlots([...sat(9, 8), ...tue(9, 2)], 5);
  eq(slots[0].weekday, 5, 'the busiest slot is Saturday, not "09:00" — which is the staffing answer');
  eq(slots[0].hour, 9, 'at nine');
  eq(slots[0].visits, 8, 'with eight through it');
  eq(slots[0].days, 1, 'across one calendar day, so an average can be stated honestly');
  eq(busiestSlots([], 5).length, 0, 'no visits means no slots, not a slot of zero');
  eq(busiestSlots([visit('nonsense')], 5).length, 0, 'an unparseable timestamp is skipped, not bucketed');

  // Ties break toward the earlier slot in the week.
  const tie = busiestSlots([...sat(7, 3), ...tue(7, 3)], 5);
  eq(tie[0].weekday, 1, 'an exact tie points at the slot you reach first in the week');
}

{
  ok(wasSwept({ note: SWEEP_NOTE }), 'a swept visit is recognisable by its exact note');
  ok(!wasSwept({ note: 'left their bag' }), 'and a desk note is not a sweep');
  ok(!wasSwept({ note: null }), 'nor is no note at all');
}

/* ── what the floor costs ─────────────────────────────────────────────────── */

const shift = (over: Partial<Shift> = {}): Shift => ({
  id: 's1', trainerId: 't1', trainerName: 'Sam',
  startsAt: '2026-09-01T06:00:00.000Z', endsAt: '2026-09-01T10:00:00.000Z',
  role: 'floor', status: 'scheduled', note: null, rateCents: null, currency: null, ...over,
});

{
  const none = rotaCost([shift(), shift({ id: 's2' })]);
  eq(none.cents, null, 'a rota nobody has costed has NO cost — not a cost of nil');
  eq(none.unpriced, 2, 'and says how many shifts are unpriced');

  const some = rotaCost([
    shift({ id: 'a', rateCents: 8000, currency: 'GBP' }),
    shift({ id: 'b', rateCents: 6000, currency: 'gbp' }),
    shift({ id: 'c' }),
  ]);
  eq(some.cents, 14000, 'rated shifts sum');
  eq(some.currency, 'GBP', 'and agree on one currency, whatever case it was typed in');
  eq(some.priced, 2, 'two are priced');
  eq(some.unpriced, 1, 'and one is not, which is what makes the total legible');

  const mixed = rotaCost([
    shift({ id: 'a', rateCents: 4000, currency: 'GBP' }),
    shift({ id: 'b', rateCents: 4000, currency: 'AED' }),
  ]);
  eq(mixed.cents, null, 'two currencies cannot be added — 40 GBP plus 40 AED is 80 of nothing');
  eq(mixed.mixedCurrency, true, 'and the reason is reported rather than hidden');
  eq(mixed.priced, 2, 'the count of costed shifts survives, because that is the useful half');

  const pulled = rotaCost([
    shift({ id: 'a', rateCents: 5000, currency: 'GBP' }),
    shift({ id: 'b', rateCents: 5000, currency: 'GBP', status: 'cancelled' }),
  ]);
  eq(pulled.cents, 5000, 'a pulled shift is not a cost — it is kept on the rota so the hole stays visible');
  eq(pulled.unpriced, 0, 'and it is not counted as an unpriced live shift either');
}

{
  eq(shiftBlocker({ trainerId: null }), 'Say who is on.', 'a shift needs somebody on it');
  ok((shiftBlocker({ trainerId: 't', startsAt: 'x', endsAt: 'y' }) ?? '').includes('start and an end'),
    'and two readable times');
  ok((shiftBlocker({ trainerId: 't', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T06:00:00Z' }) ?? '')
    .includes('end after it starts'), 'a reversed span is refused before the database refuses it');
  ok((shiftBlocker({ trainerId: 't', startsAt: '2026-09-01T06:00:00Z', endsAt: '2026-09-01T10:00:00Z', rateCents: 5000 }) ?? '')
    .includes('what money'), 'an amount with no currency is refused — this product has no default currency');
  ok((shiftBlocker({ trainerId: 't', startsAt: '2026-09-01T06:00:00Z', endsAt: '2026-09-01T10:00:00Z', currency: 'GBP' }) ?? '')
    .includes('pretending to be a cost'), 'and a currency with no amount is refused too');
  eq(shiftBlocker({ trainerId: 't', startsAt: '2026-09-01T06:00:00Z', endsAt: '2026-09-01T10:00:00Z', rateCents: 5000, currency: 'GBP' }),
    null, 'a complete shift has nothing blocking it');
}

/* ── who a message goes to ────────────────────────────────────────────────── */

const mem = (id: string, status: string, lastSeenDays: number | null): SegmentMember =>
  ({ memberId: id, name: id, status, lastSeenDays });

{
  const roster = [
    mem('fresh', 'active', 2),
    mem('slipping', 'active', LAPSING_DAYS + 3),
    mem('gone', 'active', UNSEEN_DAYS + 10),
    mem('never', 'active', null),
    mem('onhold', 'frozen', 4),
    mem('left', 'cancelled', 200),
  ];

  const live = buildSegments(roster, { doorLogLive: true });
  const by = (id: string) => live.find((s) => s.id === id)!;
  eq(by('active').members.length, 4, 'every active member, frozen and cancelled excluded');
  eq(by('lapsing').members.map((m) => m.memberId).join(), 'slipping', 'the slipping band is bounded at both ends');
  eq(by('unseen').members.map((m) => m.memberId).join(), 'gone', 'and the absent band is the tail');
  eq(by('never-seen').members.map((m) => m.memberId).join(), 'never', 'a member with no visit at all is its own group');
  eq(by('frozen').members.length, 1, 'frozen is a separate group, and never a winback target');
  eq(by('cancelled').members.length, 1, 'so is cancelled');

  // The one that would do real damage.
  const dark = buildSegments(roster, { doorLogLive: false });
  const darkBy = (id: string) => dark.find((s) => s.id === id)!;
  eq(darkBy('unseen').members.length, 0,
    'with no door log NOBODY is "not seen in 60 days" — otherwise a gym that never scans sends its whole roster a winback');
  eq(darkBy('lapsing').members.length, 0, 'the same for the slipping band');
  eq(darkBy('never-seen').members.length, 0, 'and for never-seen, which would otherwise be everybody');
  ok(darkBy('unseen').note.includes('not a gym where everyone is still coming in'),
    'and the empty group says WHY it is empty rather than reading as good news');
  eq(darkBy('active').members.length, 4,
    'membership status needs no door log, so that group is unaffected');
}

{
  ok((reachBlocker('   ', 5) ?? '').includes('Write the message'), 'an empty notice is refused');
  ok((reachBlocker('x'.repeat(2100), 5) ?? '').includes('2000'), 'and one past the column limit says the limit');
  ok((reachBlocker('hello', 0) ?? '').includes('Nobody is in this group'), 'and a group with nobody in it');
  eq(reachBlocker('hello', 5), null, 'a real message to a real group is fine');

  ok(!willTruncateInbox('x'.repeat(500)), 'exactly 500 characters reaches the inbox whole');
  ok(willTruncateInbox('x'.repeat(501)), 'and 501 does not — notify_users trims without complaining');
}

{
  const note = deliveryNote({ posted: true, delivered: null, deliveryError: null }, 10);
  ok(note.includes('unknown rather than nil'), 'an unreadable delivery count is unknown, never zero');
  ok(deliveryNote({ posted: true, delivered: 8, deliveryError: null }, 10).includes('8 of 10'),
    'a short delivery reports both numbers');
  ok(deliveryNote({ posted: true, delivered: 10, deliveryError: null }, 10).includes('No push'),
    'and every success says out loud that no push was sent');
  ok(deliveryNote({ posted: true, delivered: null, deliveryError: 'refused' }, 10).includes('nobody has been notified'),
    'a posted notice whose inbox rows failed is a different sentence from a failed post');
}

{
  const seg = buildSegments([mem('a', 'active', null), mem('b', 'active', 30)], { doorLogLive: true })
    .find((s) => s.id === 'active')!;
  const csv = segmentCsv(seg, () => ({ email: 'x@y.z', phone: null }));
  const lines = csv.split('\n');
  eq(lines.length, 3, 'a header and one line per member');
  ok(csv.includes(',"",'), 'a member the door log has never seen has an EMPTY interval, not 0 — 0 reads as "came in today"');
  ok(csv.includes('"30"'), 'and one it has seen carries the real interval');

  const quoted = segmentCsv({
    ...seg, members: [mem('O"Brien', 'active', 1)],
  });
  ok(quoted.includes('O""Brien'), 'an internal quote is doubled rather than splitting the row');
}

/* ── the gym's own record of a person ─────────────────────────────────────── */

{
  eq(parseTags('student, corporate\ndo not call').join('|'), 'student|corporate|do not call',
    'tags split on commas and newlines');
  eq(parseTags('Student, student , STUDENT').join('|'), 'Student',
    'and are deduplicated case-insensitively — one tag to everybody except a database');
  eq(parseTags('  ').length, 0, 'a blank box is no tags');
  eq(tagsText(['a', 'b']), 'a, b', 'and they go back into the box the way they came out');

  const rec = (over: Partial<GymMemberRecord> = {}): GymMemberRecord => ({
    memberId: 'm1', phone: null, email: null, emergencyName: null, emergencyPhone: null,
    medicalNote: null, note: null, tags: [], updatedAt: null, ...over,
  });
  ok(!isReachable(rec()), 'a record with no phone and no email cannot be rung');
  ok(!isReachable(null), 'and neither can a member with no record at all');
  ok(isReachable(rec({ phone: '0700' })), 'a phone number is enough');
  eq(contactLine(rec()), null, 'no contact is null, so the caller writes its own dash');
  eq(contactLine(rec({ phone: '0700', email: 'a@b.c' })), '0700 · a@b.c',
    'the phone comes first — this line is read by somebody holding a telephone');

  ok(isEmptyPatch({}), 'an empty patch writes nothing');
  ok(isEmptyPatch({ note: '   ', tags: [] }), 'and neither does one that is only whitespace');
  ok(!isEmptyPatch({ note: 'x' }), 'one real field is enough to save');
}

/* ── handing an invitation over ───────────────────────────────────────────── */

{
  const inv = { email: 'jane@example.com', fullName: 'Jane', planName: 'Gold', expiresAt: null };

  eq(inviteSubject('Fit Republic'), 'Join Fit Republic on Repple',
    'the subject names the GYM — "Repple" means nothing to somebody who has not joined');
  ok(inviteSubject(null).length > 0, 'and there is a subject even when the gym name did not read');

  const msg = inviteMessage(inv, { gymName: 'Fit Republic' });
  ok(msg.includes('jane@example.com'),
    'the address is repeated back — signing up with a different one is the whole failure mode');
  ok(msg.includes('Gold'), 'the plan is named when the gym chose one');
  ok(!inviteMessage({ ...inv, planName: null }, {}).includes('plan.'),
    'and left out entirely when they did not — "sorted at the desk" is a real answer');
  ok(msg.includes('Fit Republic'), 'and the gym signs it');

  // The white-label rule: never a hardcoded repplefitness.com.
  ok(!inviteMessage(inv, { gymName: 'X' }).includes('repplefitness'),
    'no site is mentioned unless the caller supplies the brand’s own');
  ok(inviteMessage(inv, { gymName: 'X', siteUrl: 'https://example.com' }).includes('https://example.com'),
    'and the one supplied is the one used');

  const soon = inviteMessage({ ...inv, expiresAt: new Date(Date.now() + 3 * 86400000).toISOString() }, {});
  ok(soon.includes('3 days'), 'a live expiry is stated, which is the support call it prevents');
  const lapsed = inviteMessage({ ...inv, expiresAt: new Date(Date.now() - 86400000).toISOString() }, {});
  ok(lapsed.includes('lapsed'), 'and a dead one says so rather than counting down from a negative');

  const link = inviteMailto(inv, { gymName: 'Fit Republic' });
  ok(link.startsWith('mailto:jane%40example.com?'), 'the mailto addresses the invitee');
  ok(link.includes('%0A'), 'and the newlines survive encoding, so the message has paragraphs');

  // The one that is a data-protection question rather than a nicety.
  const bulk = bulkInviteMailto([inv, { ...inv, email: 'sam@example.com' }], { gymName: 'X' }) ?? '';
  ok(bulk.startsWith('mailto:?bcc='),
    'a batch goes out over BCC with an empty To — every address in To discloses the whole membership list');
  ok(bulk.includes('jane%40example.com') && bulk.includes('sam%40example.com'), 'and carries both');
  ok(!bulk.includes('Hi%20Jane'), 'with no name, because one message is read by everybody in the batch');
  eq(bulkInviteMailto([], {}), null, 'an empty batch has no link rather than an empty one');
}

if (errors.length) {
  console.error(`frontDesk.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 30)) console.error('  · ' + e);
  if (errors.length > 30) console.error(`  … and ${errors.length - 30} more`);
  process.exit(1);
}
console.log('frontDesk.test.ts — ok');
