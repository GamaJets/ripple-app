// Two-way calendar sync. Compile with tsc, run with node.
//
// Five failures are worth the file, and the first two are the ones that cannot
// be fixed after they have happened.
//
// THE FIRST is what comes IN. A remote calendar API hands back the title, the
// notes, the location, the organiser's e-mail address and every attendee's, all
// in one body. This app takes a start and an end. That is asserted on the SHAPE
// of what `remoteBusySpan` returns — two keys, both numbers — rather than on a
// promise in a comment, exactly as deviceBusy.test.ts asserts it, so a third
// field cannot be added by accident or arrive through a spread.
//
// THE SECOND is what goes OUT, which is new and is worse, because it is a
// client's appointment leaving the product. `SyncWireEvent` is asserted to have
// three keys — an id and two instants — so there is no field on the wire that
// could carry somebody's name even if a future screen tried to put one there.
//
// THE THIRD is the empty list, again. Two sources make one new way to say "you
// are free": the phone answers, Google fails, the merged list is short, and a
// sheet built on `count === 0` calls a fortnight clear. `combineBusy` is what
// keeps that from being sayable.
//
// THE FOURTH is timezones. Google returns RFC3339 with real offsets and
// floating all-day dates, and `npm run test:zones` runs this under six zones
// including Kiritimati (UTC+14) and Midway (UTC-11). An offset-bearing instant
// must land on the same epoch millisecond in all six; a bare date must land on
// LOCAL midnight in each.
//
// THE FIFTH is Google's own id grammar. An event id must be base32hex — `a`-`v`
// and `0`-`9` — and a prefix containing `w`, `x`, `y` or `z` is refused at
// insert time, on a call nothing in this repo can exercise. It is checked here
// because the alternative is finding out from a coach.
import {
  remoteBusySpan, remoteBusySpans, combineBusy, missingSourceNote,
  linkState, LINK_NOTES, syncEventId, isSyncEventId, SYNC_ID_PREFIX,
  plannedSyncEvents, pushSummaryLine, pushLabel, reversedClientRedirect,
  WRITE_PRIVACY_NOTE, REMOTE_SCOPE_NOTE, GOOGLE_READ_SCOPE, GOOGLE_WRITE_SCOPE,
  NO_CALENDAR_LINK, syncClassEventId, syncClassesNote,
  type BusySourceState, type SyncSessionInput, type SyncClassInput,
} from './calendarSync';
import { busyCandidates, type BusySpan } from './deviceBusy';
import { setAppLocale } from './locale';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// Stated for the same reason deviceBusy.test.ts states it: anything that goes
// through a formatter asks the reader's locale, and a test that reads whatever
// the runner is set to is a test of the machine.
setAppLocale('en-GB');

/** A local instant in epoch ms, built from local parts on purpose. */
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime();

/* ════════════════════════════════════════════════════════════════════════
   1. WHAT COMES IN — two numbers, and nothing else, ever
   ════════════════════════════════════════════════════════════════════════ */

{
  // The shape a real free/busy period arrives in, with every field a fuller
  // calendar API would have attached to it. If any of them survives the
  // boundary, this fails.
  const loaded = {
    start: '2026-09-08T09:00:00Z',
    end: '2026-09-08T10:00:00Z',
    summary: 'Dr Okafor — oncology follow up',
    description: 'Bring the referral letter',
    location: '14 Harley Street, London',
    organizer: { email: 'reception@clinic.example' },
    attendees: [{ email: 'partner@example.com', responseStatus: 'accepted' }],
    hangoutLink: 'https://meet.example/abc-defg-hij',
    recurringEventId: 'abc123',
    visibility: 'private',
  };
  const span = remoteBusySpan(loaded);
  ok(span != null, 'a readable period is read');
  const keys = Object.keys(span as object).sort();
  same(keys, ['endMs', 'startMs'], 'a busy span has exactly two keys');
  ok(typeof (span as BusySpan).startMs === 'number' && typeof (span as BusySpan).endMs === 'number',
    'both of them are numbers');
  // Belt and braces: not one of the private strings above appears anywhere in
  // what came back, including inside a nested value.
  const dump = JSON.stringify(span);
  for (const secret of ['Okafor', 'Harley', 'clinic.example', 'partner@example.com', 'meet.example', 'referral']) {
    ok(!dump.includes(secret), `nothing about "${secret}" survives the boundary`);
  }

  eq((span as BusySpan).startMs, Date.UTC(2026, 8, 8, 9, 0, 0),
    'an offset-bearing instant is the same epoch millisecond in every zone');
  eq((span as BusySpan).endMs, Date.UTC(2026, 8, 8, 10, 0, 0), 'and so is its end');
}

{
  // The same instant, written three ways. All three are the same moment, and a
  // reader in Kiritimati and a reader in Midway must agree about that.
  const z = remoteBusySpan({ start: '2026-09-08T09:00:00Z', end: '2026-09-08T10:00:00Z' });
  const plus = remoteBusySpan({ start: '2026-09-08T11:00:00+02:00', end: '2026-09-08T12:00:00+02:00' });
  const minus = remoteBusySpan({ start: '2026-09-08T04:00:00-05:00', end: '2026-09-08T05:00:00-05:00' });
  eq(plus?.startMs, z?.startMs, 'a +02:00 instant equals the same UTC instant');
  eq(minus?.startMs, z?.startMs, 'a -05:00 instant equals the same UTC instant');
}

{
  // A floating all-day value is a DAY in the coach's own life, not an instant.
  // `Date.parse` would make it UTC midnight, which is the previous afternoon in
  // Kiritimati and the following morning in Midway — the bug src/lib/localDate.ts
  // exists for, shipped twice in this repo already.
  const span = remoteBusySpan({ start: '2026-09-08', end: '2026-09-09' });
  eq(span?.startMs, at(2026, 9, 8), 'a bare date is local midnight');
  eq(span?.endMs, at(2026, 9, 9), 'and so is its end');
  eq(new Date(span!.startMs).getDate(), 8, 'and reads back as the day that was written');
}

{
  eq(remoteBusySpan(null), null, 'null is not a period');
  eq(remoteBusySpan('2026-09-08'), null, 'a bare string is not a period');
  eq(remoteBusySpan({ start: '2026-09-08T09:00:00Z' }), null, 'a period with no end is dropped');
  eq(remoteBusySpan({ end: '2026-09-08T09:00:00Z' }), null, 'a period with no start is dropped');
  eq(remoteBusySpan({ start: '2026-09-08T10:00:00Z', end: '2026-09-08T09:00:00Z' }), null,
    'a period that ends before it starts is dropped');
  eq(remoteBusySpan({ start: '2026-09-08T09:00:00Z', end: '2026-09-08T09:00:00Z' }), null,
    'a period of no length is dropped');
  eq(remoteBusySpan({ start: 'not a time', end: 'nor this' }), null, 'unreadable values are dropped');

  // The server narrows to epoch milliseconds before anything leaves it, so the
  // normal path is numbers.
  const n = remoteBusySpan({ start: at(2026, 9, 8, 9), end: at(2026, 9, 8, 10) });
  eq(n?.startMs, at(2026, 9, 8, 9), 'epoch milliseconds are taken as they are');

  same(remoteBusySpans(null), [], 'a missing list is an empty list');
  eq(remoteBusySpans([
    { start: '2026-09-08T09:00:00Z', end: '2026-09-08T10:00:00Z' },
    { start: 'rubbish', end: 'rubbish' },
    { start: '2026-09-08T14:00:00Z', end: '2026-09-08T15:00:00Z' },
  ]).length, 2, 'unreadable periods are dropped and the rest are kept');
}

/* ════════════════════════════════════════════════════════════════════════
   2. TWO SOURCES, ONE LIST — and never the sentence "you are free"
   ════════════════════════════════════════════════════════════════════════ */

const device = (status: BusySourceState['status'], permission?: BusySourceState['permission']): BusySourceState =>
  ({ kind: 'device', active: true, status, permission });
const google = (status: BusySourceState['status']): BusySourceState =>
  ({ kind: 'google', active: true, status });

{
  eq(combineBusy([], true, 0).view, 'unavailable', 'no source in play is "unavailable"');
  eq(combineBusy([{ kind: 'device', active: false, status: 'ready' }], true, 0).view, 'unavailable',
    'an inactive source is not a source');
  eq(combineBusy([device('ready', 'granted')], false, 0).view, 'ask', 'nothing is read before the coach asks');
  eq(combineBusy([device('loading'), google('ready')], true, 0).view, 'loading',
    'one source still in flight holds the whole sheet');
}

{
  // THE ONE THAT MATTERS. The phone answered and found nothing; Google failed.
  // An empty list here is UNKNOWN, and calling it 'empty' would put "nothing in
  // your calendar falls in this window" in front of a coach whose Google diary
  // was never read.
  const r = combineBusy([device('ready', 'granted'), google('error')], true, 0);
  eq(r.view, 'failed', 'nothing found while a source failed is never "empty"');
  same(r.missing, ['google'], 'and the failed source is named');
}

{
  const r = combineBusy([device('ready', 'granted'), google('ready')], true, 0);
  eq(r.view, 'empty', 'nothing found while every source answered is genuinely empty');
  same(r.missing, [], 'and nothing is missing');
}

{
  // Something WAS found, and a source still failed. The periods on screen are
  // real and blockable, so they are shown — and `missing` is what makes the
  // caller say the list is not the whole account of the coach's time.
  const r = combineBusy([device('ready', 'granted'), google('error')], true, 3);
  eq(r.view, 'list', 'real periods are still offered when the other source failed');
  same(r.missing, ['google'], 'and the caller is told to warn about it');
}

{
  eq(combineBusy([device('ready', 'denied')], true, 0).view, 'denied',
    'the phone alone, refused, is a refusal and not a failure');
  eq(combineBusy([device('ready', 'denied'), google('error')], true, 0).view, 'failed',
    'a refusal plus a failure is reported as a failure');
  same(combineBusy([device('ready', 'denied'), google('error')], true, 0).missing, ['device', 'google'],
    'and both are named');
  eq(combineBusy([device('ready', 'denied'), google('ready')], true, 5).view, 'list',
    'a refused phone does not hide what Google found');
  same(combineBusy([device('ready', 'denied'), google('ready')], true, 5).missing, ['device'],
    'and the refusal is still named');
  // A refusal arrives as `status: 'ready'` — the operating system answered.
  // Counting it as an answer is the whole trap.
  eq(combineBusy([device('ready', 'denied'), google('ready')], true, 0).view, 'failed',
    'a refusal is not an answer, so an empty list beside one is not "empty"');
}

{
  eq(missingSourceNote([]), null, 'nothing missing says nothing');
  const one = missingSourceNote(['google']) ?? '';
  ok(one.includes('Google'), 'the Google note names Google');
  ok(one.includes('not a statement that you are free'),
    'and every missing-source note refuses to imply the coach is free');
  const both = missingSourceNote(['device', 'google']) ?? '';
  ok(both.includes('Neither'), 'both missing reads as neither');
  ok(both.includes('not a statement that you are free'), 'and says the same thing');
  ok((missingSourceNote(['device']) ?? '').includes('phone'), 'the phone note names the phone');
}

{
  // The merge itself. A dentist appointment that is on BOTH calendars must be
  // one row, not two — two rows would be two `block_time` calls and the server
  // would answer 'already-blocked' for the second, which a coach reads as a
  // failure. `busyCandidates` merges overlapping periods, so the two sources
  // are simply concatenated and it does the rest.
  const fromDevice: BusySpan[] = [{ startMs: at(2026, 9, 8, 9), endMs: at(2026, 9, 8, 10) }];
  const fromGoogle: BusySpan[] = [{ startMs: at(2026, 9, 8, 9, 30), endMs: at(2026, 9, 8, 11) }];
  const rows = busyCandidates([...fromDevice, ...fromGoogle], '2026-09-08', 1);
  eq(rows.length, 1, 'the same period on two calendars is one row');
  eq(rows[0].startMin, 9 * 60, 'starting at the earlier of the two');
  eq(rows[0].endMin, 11 * 60, 'and ending at the later');
  eq(rows[0].entries, 2, 'and saying how many entries went into it');

  const apart = busyCandidates(
    [{ startMs: at(2026, 9, 8, 9), endMs: at(2026, 9, 8, 10) },
     { startMs: at(2026, 9, 8, 18), endMs: at(2026, 9, 8, 19) }],
    '2026-09-08', 1);
  eq(apart.length, 2, 'periods with a gap between them stay two absences');
}

/* ════════════════════════════════════════════════════════════════════════
   3. THE LINK — six states, and two of them are not "the coach said no"
   ════════════════════════════════════════════════════════════════════════ */

{
  const link = { ...NO_CALENDAR_LINK };
  eq(linkState({ configured: false, connecting: false, link }), 'unconfigured',
    'a build with no client id cannot be connected and says so');
  eq(linkState({ configured: true, connecting: true, link }), 'connecting', 'a flow in progress is its own state');
  eq(linkState({ configured: true, connecting: false, link }), 'disconnected', 'nothing linked is disconnected');
  eq(linkState({ configured: true, connecting: false, link: { ...link, connected: true } }), 'needs-reconnect',
    'a grant with no refresh token is not a working connection');
  eq(linkState({ configured: true, connecting: false, link: { ...link, connected: true, hasRefresh: true } }), 'connected',
    'connected and reading only');
  eq(linkState({
    configured: true, connecting: false,
    link: { ...link, connected: true, hasRefresh: true, writeEnabled: true, hasWriteCalendar: true },
  }), 'two-way', 'connected and writing');
  // The toggle is a decision and the calendar is a round trip. One without the
  // other is not two-way and must not claim to be.
  eq(linkState({
    configured: true, connecting: false,
    link: { ...link, connected: true, hasRefresh: true, writeEnabled: true, hasWriteCalendar: false },
  }), 'connected', 'writing turned on with no calendar made is not two-way yet');

  for (const [state, note] of Object.entries(LINK_NOTES)) {
    ok(note.length > 20, `${state} has a sentence a coach can read`);
  }
  // The owner's setup instructions are for the owner. src/lib/wearables/
  // oauthConfig.ts has a whole field that exists because a gym member was told
  // to register an app at dev.fitbit.com and set two Supabase secrets.
  for (const [state, note] of Object.entries(LINK_NOTES)) {
    ok(!/EXPO_PUBLIC|Supabase|client id|Cloud Console/i.test(note),
      `${state} does not print the owner's setup instructions to a coach`);
  }
}

/* ════════════════════════════════════════════════════════════════════════
   4. WHAT GOES OUT — three strings, none of which can be a name
   ════════════════════════════════════════════════════════════════════════ */

{
  // Google's event id grammar is base32hex: `a`-`v` and `0`-`9`. A prefix with
  // a `w`, `x`, `y` or `z` in it is refused at insert time.
  ok(/^[a-v0-9]+$/.test(SYNC_ID_PREFIX), 'the marker is spelled in characters Google accepts');
  ok(SYNC_ID_PREFIX.length >= 3, 'and is long enough to be recognisable');

  const uuid = '7f3a1b2c-4d5e-4f60-8a91-0b2c3d4e5f60';
  const id = syncEventId(uuid);
  eq(id, SYNC_ID_PREFIX + '7f3a1b2c4d5e4f608a910b2c3d4e5f60', 'an id is the marker plus the session uuid');
  ok(/^[a-v0-9]{5,1024}$/.test(id!), 'and the whole id is a legal Google event id');
  ok(isSyncEventId(id), 'and is recognised as ours');
  eq(syncEventId(uuid), syncEventId(uuid.toUpperCase()), 'case in the uuid does not change the id');

  // Never a guess. An id we invented could collide with an event we did not
  // write, and the delete path is keyed on this.
  eq(syncEventId('not-a-uuid'), null, 'anything that is not a uuid gets no id');
  eq(syncEventId(''), null, 'and neither does nothing');
  ok(!isSyncEventId('someoneelsesevent'), 'somebody else’s event is not ours');
  ok(!isSyncEventId(SYNC_ID_PREFIX), 'the bare marker is not an id');
  ok(!isSyncEventId(null), 'and nor is null');
  ok(!isSyncEventId(SYNC_ID_PREFIX + '7f3a1b2c4d5e4f608a910b2c3d4e5f6'), 'a short id is not ours');
}

{
  const from = at(2026, 9, 7);
  const to = at(2026, 9, 14);
  const sessions: SyncSessionInput[] = [
    // booked, inside the window
    { id: '11111111-1111-4111-8111-111111111111', startsAt: new Date(at(2026, 9, 8, 9)).toISOString(), durationMin: 45, status: 'booked' },
    // an OPEN slot. An offer is not a commitment, and writing every offered
    // hour into somebody's personal calendar buries the appointments they have.
    { id: '22222222-2222-4222-8222-222222222222', startsAt: new Date(at(2026, 9, 9, 9)).toISOString(), durationMin: 60, status: 'available' },
    // a block. Repple would be telling the coach's calendar what the coach's
    // calendar told Repple.
    { id: '33333333-3333-4333-8333-333333333333', startsAt: new Date(at(2026, 9, 9, 14)).toISOString(), durationMin: 60, status: 'blocked' },
    // booked, but outside the window
    { id: '44444444-4444-4444-8444-444444444444', startsAt: new Date(at(2026, 9, 20, 9)).toISOString(), durationMin: 60, status: 'booked' },
    // booked, no readable duration
    { id: '55555555-5555-4555-8555-555555555555', startsAt: new Date(at(2026, 9, 10, 9)).toISOString(), durationMin: 0, status: 'booked' },
    // the same session twice
    { id: '11111111-1111-4111-8111-111111111111', startsAt: new Date(at(2026, 9, 8, 9)).toISOString(), durationMin: 45, status: 'booked' },
  ];
  const plan = plannedSyncEvents(sessions, from, to);
  eq(plan.length, 2, 'only booked sessions inside the window are written, once each');

  const first = plan.find((p) => p.id === syncEventId('11111111-1111-4111-8111-111111111111'))!;
  ok(first != null, 'the booked session is in the plan');
  same(Object.keys(first).sort(), ['endIso', 'id', 'startIso'],
    'the wire carries exactly three fields, and none of them could be a name');
  ok(typeof first.id === 'string' && typeof first.startIso === 'string' && typeof first.endIso === 'string',
    'all three are strings');
  eq(Date.parse(first.endIso) - Date.parse(first.startIso), 45 * 60000, 'the length is the session’s own');
  eq(Date.parse(first.startIso), at(2026, 9, 8, 9), 'and the instant survives the round trip in every zone');

  const noDuration = plan.find((p) => p.id === syncEventId('55555555-5555-4555-8555-555555555555'))!;
  eq(Date.parse(noDuration.endIso) - Date.parse(noDuration.startIso), 60 * 60000,
    'a session with no readable length gets the same hour the database defaults to');

  same(plannedSyncEvents(sessions, to, from), [], 'a backwards window plans nothing');
  same(plannedSyncEvents([], from, to), [], 'no sessions plan nothing');
  // Stable order, so two runs over the same week produce the same list and a
  // diff against Google has nothing spurious in it.
  same(plannedSyncEvents(sessions, from, to), plannedSyncEvents([...sessions].reverse(), from, to),
    'the plan does not depend on the order the sessions arrived in');

  /* ── the classes a coach teaches ────────────────────────────────────────
   *
   * The export half of the defect booking.ts holds the guard half of. A coach
   * who publishes this diary was published as FREE for every hour they spend
   * teaching, and the person reading it cannot tell that the timetable was
   * never in there.
   */
  const ME = 'coach-1';
  const classes: SyncClassInput[] = [
    // mine, scheduled, inside the window
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', startsAt: new Date(at(2026, 9, 8, 18)).toISOString(), durationMin: 45, status: 'scheduled', trainerId: ME },
    // mine, but cancelled: the room gave the hour back and I am free in it
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', startsAt: new Date(at(2026, 9, 9, 18)).toISOString(), durationMin: 45, status: 'cancelled', trainerId: ME },
    // a colleague's class — their business, their room
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', startsAt: new Date(at(2026, 9, 9, 19)).toISOString(), durationMin: 45, status: 'scheduled', trainerId: 'coach-2' },
    // recorded against nobody. Part 165: every class studio-web wrote is one of
    // these, so claiming them would fill one coach's private calendar with the
    // whole gym's timetable.
    { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', startsAt: new Date(at(2026, 9, 10, 19)).toISOString(), durationMin: 45, status: 'scheduled', trainerId: null },
    // mine, outside the window
    { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', startsAt: new Date(at(2026, 9, 21, 18)).toISOString(), durationMin: 45, status: 'scheduled', trainerId: ME },
  ];

  const withClasses = plannedSyncEvents(sessions, from, to, { classes, uid: ME });
  eq(withClasses.length, 3, 'the two booked sessions plus the one class I actually teach this week');
  ok(withClasses.some((e) => e.id === syncClassEventId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
    'the class I teach is in the plan');
  ok(!withClasses.some((e) => e.id === syncClassEventId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
    'a cancelled class is not an hour I am busy in');
  ok(!withClasses.some((e) => e.id === syncClassEventId('cccccccc-cccc-4ccc-8ccc-cccccccccccc')),
    'a colleague’s class is not written into my calendar');
  ok(!withClasses.some((e) => e.id === syncClassEventId('dddddddd-dddd-4ddd-8ddd-dddddddddddd')),
    'nor is one nobody is recorded against');
  ok(!withClasses.some((e) => e.id === syncClassEventId('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')),
    'and the window still bounds it');

  const cls = withClasses.find((e) => e.id === syncClassEventId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))!;
  same(Object.keys(cls).sort(), ['endIso', 'id', 'startIso'],
    'a class goes over the same three-field wire, with nowhere to put its title');
  eq(Date.parse(cls.endIso) - Date.parse(cls.startIso), 45 * 60000, 'and runs for as long as the class does');

  // Omitting the argument is what every caller did before classes existed, and
  // it must keep meaning "no classes were asked about" rather than "there are
  // none" — the server deletes what the plan does not name.
  same(plannedSyncEvents(sessions, from, to), plan, 'a caller that says nothing about classes plans exactly what it used to');
  same(plannedSyncEvents(sessions, from, to, { classes, uid: null }), plan,
    'and without a uid there is no way to tell whose classes they are, so none are claimed');

  same(withClasses, plannedSyncEvents(sessions, from, to, { classes: [...classes].reverse(), uid: ME }),
    'the plan does not depend on the order the classes arrived in either');

  /* ── a class id and a session id are different id spaces ───────────────── */

  // coverage.test.ts already asserts these two can collide on the floor board.
  // Here a collision would mint one Google event id for both, and writing the
  // class would overwrite the appointment with a person in it.
  const SHARED = '11111111-1111-4111-8111-111111111111';
  ok(syncClassEventId(SHARED) !== syncEventId(SHARED),
    'a class and a session with the same uuid do not mint the same event id');
  ok(/^repple[0-9a-f]{32}$/.test(syncClassEventId(SHARED) || ''),
    'and the class id still passes the gate the edge function applies to every write');
  eq(syncClassEventId('not-a-uuid'), null, 'anything that is not a uuid gets no class id');
  // A non-v4 uuid cannot be shown to sit outside the session space, so it gets
  // no id at all rather than one that might collide.
  eq(syncClassEventId('11111111-1111-1111-8111-111111111111'), null, 'and neither does a uuid that is not version 4');
  eq(syncClassEventId('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'), syncClassEventId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'case does not change which event a class is');

  // Two locks on the same door. The version digit is the first: a session whose
  // uuid IS version 4 can never share an id with any class. The second is the
  // ordering, and this is what exercises it — a session id that is not a v4
  // uuid, carrying the very digit a class is moved onto. Sessions are planned
  // first, so the appointment with a person in it is the one that survives.
  const NOT_V4 = '11111111-1111-c111-8111-111111111111';
  eq(syncEventId(NOT_V4), syncClassEventId(SHARED), 'the one shape that could collide, constructed');
  const collide = plannedSyncEvents(
    [{ id: NOT_V4, startsAt: new Date(at(2026, 9, 8, 9)).toISOString(), durationMin: 45, status: 'booked' }],
    from, to,
    { classes: [{ id: SHARED, startsAt: new Date(at(2026, 9, 8, 18)).toISOString(), durationMin: 90, status: 'scheduled', trainerId: ME }], uid: ME },
  );
  eq(collide.length, 1, 'a collision produces one event, not two');
  eq(Date.parse(collide[0].endIso) - Date.parse(collide[0].startIso), 45 * 60000,
    'and it is the session — no class ever overwrites the appointment that already holds its id');
}

{
  // A timetable that was not read is not an empty timetable, and the difference
  // is somebody booking over an hour the coach is teaching in.
  eq(syncClassesNote(true), null, 'nothing to add when the classes were read');
  ok(/could not be read/i.test(syncClassesNote(false) || ''), 'an unread timetable says so');
  ok(/free/i.test(syncClassesNote(false) || ''), 'and says what the reader of the calendar will wrongly conclude');
}

{
  eq(pushLabel(0), null, 'nothing to send disables the button');
  eq(pushLabel(1), 'Send 1 Session', 'one session is singular');
  eq(pushLabel(4), 'Send 4 Sessions', 'more than one is plural');
  eq(pushLabel(-1), null, 'a nonsense count disables it too');
  eq(pushLabel(4, 0), 'Send 4 Sessions', 'a plan with no classes in it is still all sessions');
  // A plan that is half timetable must not be called all sessions: the count
  // was always right, and one word was telling the coach the wrong thing.
  ok(!/Session/.test(pushLabel(6, 4) || ''), 'a plan carrying classes does not call itself sessions');
  ok(/6/.test(pushLabel(6, 4) || ''), 'and still says how many it will send');
  eq(pushLabel(0, 3), null, 'nothing to send is still nothing to send');

  // "Nothing happened" and "nothing worked" have opposite next steps, and this
  // repo keeps confusing them.
  ok(pushSummaryLine({ created: 0, updated: 0, removed: 0 }).includes('already matches'),
    'an unchanged week reads as already matching, not as a failure');
  ok(pushSummaryLine({ created: 3, updated: 0, removed: 0 }).includes('3 added'), 'additions are counted');
  ok(pushSummaryLine({ created: 0, updated: 1, removed: 2 }).includes('1 updated'), 'changes are counted');
  ok(pushSummaryLine({ created: 0, updated: 1, removed: 2 }).includes('2 removed'), 'removals are counted');
  // The promise is about PROVENANCE — nothing Repple did not create is touched
  // — and it is said in those words now that classes go in the same calendar.
  ok(pushSummaryLine({ created: 1, updated: 0, removed: 0 }).includes('Only events Repple put there'),
    'and every summary repeats what is never touched');
}

/* ════════════════════════════════════════════════════════════════════════
   5. THE PROMISES, kept beside the code that keeps them
   ════════════════════════════════════════════════════════════════════════ */

{
  ok(GOOGLE_READ_SCOPE.endsWith('/calendar.freebusy'),
    'the read scope is free/busy, which cannot see a title at all');
  ok(!GOOGLE_READ_SCOPE.includes('readonly'), 'and is not the readonly scope, which can');
  ok(GOOGLE_WRITE_SCOPE.endsWith('/calendar.app.created'),
    'the write scope reaches only calendars this app made');

  ok(REMOTE_SCOPE_NOTE.includes('second calendar'),
    'the coach is told which of their calendars is not covered');
  ok(/no title/i.test(REMOTE_SCOPE_NOTE), 'and that no title is read');

  ok(WRITE_PRIVACY_NOTE.includes('no client name'), 'the write promise says no client name goes to Google');
  ok(WRITE_PRIVACY_NOTE.includes('ever changed or deleted'),
    'and that nothing the coach made is touched');
  ok(WRITE_PRIVACY_NOTE.includes('Coaching session'), 'and names the title that is written');
  // A class goes in under the same fixed title, so a coach is not left thinking
  // their timetable will arrive in Google with its names on it.
  ok(WRITE_PRIVACY_NOTE.includes('no class name'), 'and says a class arrives without its name too');
  ok(/colleagues teach/.test(WRITE_PRIVACY_NOTE), 'and that somebody else’s class is never written');
}

{
  // One value for the owner to set. An iOS or Android Google client requires
  // the redirect to be its own client id reversed, and a redirect that does not
  // match what is registered closes the browser on an unhandled scheme with no
  // error anywhere — the failure src/lib/wearables/oauthConfig.ts documents.
  eq(reversedClientRedirect('123456789012-abcdefg.apps.googleusercontent.com'),
    'com.googleusercontent.apps.123456789012-abcdefg:/oauthredirect',
    'the redirect is the client id reversed');
  eq(reversedClientRedirect(''), null, 'no client id derives no redirect');
  eq(reversedClientRedirect('not-a-google-client'), null, 'nor does anything that is not one');
  eq(reversedClientRedirect('https://example.com/callback'), null,
    'a web client’s https redirect cannot be derived and must be given outright');
}

if (errors.length) {
  console.error(`calendarSync: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('calendarSync: ok');
