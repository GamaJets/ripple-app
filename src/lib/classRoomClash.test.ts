// Two classes in one room at one time. Run under node: see package.json's
// `test` script — this file's name has to be added to it by hand.
import { roomClashesFor, roomClashNote, type RoomSpan } from './classRoomClash';

let failures = 0;
function check(what: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.error(`  FAIL ${what}\n    got  ${g}\n    want ${w}`); }
}

const cls = (o: Partial<RoomSpan> & { id: string; startsAt: string }): RoomSpan => ({
  title: 'Spin', durationMin: 60, branch: 'Al Quoz', room: 'Studio 2', status: 'scheduled', ...o,
});

// A fixed timetable. 2026-03-10 is a Tuesday.
const SPIN = cls({ id: 'spin', title: 'Spin', startsAt: '2026-03-10T18:00:00.000Z' });
const YOGA = cls({ id: 'yoga', title: 'Yoga', startsAt: '2026-03-10T19:00:00.000Z' });
const OTHER_ROOM = cls({ id: 'other', title: 'Boxing', startsAt: '2026-03-10T18:00:00.000Z', room: 'Studio 1' });
const OTHER_BRANCH = cls({ id: 'branch', title: 'Barre', startsAt: '2026-03-10T18:00:00.000Z', branch: 'Marina' });
const OFF = cls({ id: 'off', title: 'Pilates', startsAt: '2026-03-10T18:00:00.000Z', status: 'cancelled' });
const ALL = [SPIN, YOGA, OTHER_ROOM, OTHER_BRANCH, OFF];

const ids = (r: { clashes: RoomSpan[] }) => r.clashes.map((c) => c.id);

// ── the collision itself ──────────────────────────────────────────────────
check('same room, same hour clashes',
  ids(roomClashesFor(['2026-03-10T18:30:00.000Z'], 60, 'Al Quoz', 'Studio 2', ALL, true)), ['spin', 'yoga']);

check('back-to-back does not clash — 19:00 starts as 18:00–19:00 ends',
  ids(roomClashesFor(['2026-03-10T19:00:00.000Z'], 60, 'Al Quoz', 'Studio 2', [SPIN], true)), []);

check('a different room is not a clash',
  ids(roomClashesFor(['2026-03-10T18:00:00.000Z'], 60, 'Al Quoz', 'Studio 1', [SPIN], true)), []);

check('a different branch is not a clash',
  ids(roomClashesFor(['2026-03-10T18:00:00.000Z'], 60, 'Marina', 'Studio 2', [SPIN], true)), []);

check('a called-off class has vacated the room',
  ids(roomClashesFor(['2026-03-10T18:00:00.000Z'], 60, 'Al Quoz', 'Studio 2', [OFF], true)), []);

// `GymClass.status` is optional. A row that arrived without one is a class that
// is ON — the room is occupied — and must not be read as cancelled.
const NO_STATUS: RoomSpan = { id: 'nostat', title: 'Barre', startsAt: '2026-03-10T18:00:00.000Z', durationMin: 60, branch: 'Al Quoz', room: 'Studio 2' };
check('a row with no status recorded still occupies the room',
  ids(roomClashesFor(['2026-03-10T18:00:00.000Z'], 60, 'Al Quoz', 'Studio 2', [NO_STATUS], true)), ['nostat']);

check('free text is folded — "studio 2 " is the same room as "Studio 2"',
  ids(roomClashesFor(['2026-03-10T18:00:00.000Z'], 60, ' al quoz', 'studio 2 ', [SPIN], true)), ['spin']);

// ── Repeat writes a term, so every occurrence is checked ──────────────────
const WEEK_9 = cls({ id: 'w9', title: 'Reformer', startsAt: '2026-05-05T18:00:00.000Z' });
check('a clash on week nine is found, not just week one',
  ids(roomClashesFor(
    Array.from({ length: 12 }, (_, w) => new Date(Date.parse('2026-03-10T18:00:00.000Z') + w * 7 * 86_400_000).toISOString()),
    60, 'Al Quoz', 'Studio 2', [WEEK_9], true)), ['w9']);

// ── and the rule that matters most: never "clear" from an unread list ─────
const notWhole = roomClashesFor(['2026-03-10T18:00:00.000Z'], 60, 'Al Quoz', 'Studio 2', [], false);
check('a partial timetable is UNCHECKABLE, not clear', [notWhole.checkable, notWhole.reason], [false, 'not-whole']);
check('and it says so out loud',
  roomClashNote(notWhole, 'Studio 2', (s) => s)?.includes('NOT checked'), true);

const noRoom = roomClashesFor(['2026-03-10T18:00:00.000Z'], 60, 'Al Quoz', '  ', ALL, true);
check('a class with no room recorded cannot be checked', [noRoom.checkable, noRoom.reason], [false, 'no-room']);
check('but a gym with one unnamed floor is not nagged about it',
  roomClashNote(noRoom, '  ', (s) => s), null);

const badStart = roomClashesFor(['not-a-date'], 60, 'Al Quoz', 'Studio 2', ALL, true);
check('an unreadable start is unchecked, never clear', [badStart.checkable, badStart.clashes.length], [false, 0]);

const badDur = roomClashesFor(['2026-03-10T18:00:00.000Z'], 0, 'Al Quoz', 'Studio 2', ALL, true);
check('a zero duration is unchecked, never clear', [badDur.checkable, badDur.clashes.length], [false, 0]);

const theirsBad = roomClashesFor(['2026-03-10T18:00:00.000Z'], 60, 'Al Quoz', 'Studio 2',
  [cls({ id: 'bad', startsAt: 'nonsense' })], true);
check('an existing row with an unreadable date is skipped, not matched at epoch',
  ids(theirsBad), []);

// ── the sentence ──────────────────────────────────────────────────────────
const clean = roomClashesFor(['2026-03-11T18:00:00.000Z'], 60, 'Al Quoz', 'Studio 2', ALL, true);
check('a checked, clean room says nothing', roomClashNote(clean, 'Studio 2', (s) => s), null);

const two = roomClashesFor(['2026-03-10T18:30:00.000Z'], 60, 'Al Quoz', 'Studio 2', ALL, true);
const note = roomClashNote(two, 'Studio 2', (s) => s.slice(11, 16)) ?? '';
check('the note names the room, the count and the classes',
  [note.includes('Studio 2'), note.includes('2 classes'), note.includes('Spin at 18:00'), note.includes('Yoga at 19:00')],
  [true, true, true, true]);

if (failures) { console.error(`classRoomClash.test.ts — ${failures} FAILED`); process.exit(1); }
console.log('classRoomClash.test.ts — ok');
