// The classes a coach teaches, on their own day sheet. Compile with tsc, run
// with node.
//
// Run under six timezones by `test:zones`, and that is the point of half of it:
// a 6pm class is filed under the day the coach is standing in, never under its
// UTC date, which is tomorrow for everybody west of Greenwich.
import {
  classDayCaveat, classDayHeading, classDayNote, classesOnDay, type CalendarClass,
} from './dayClasses';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ME = 'coach-1';

/** A class at a LOCAL wall-clock time, which is how a coach reads a timetable. */
const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h, 0, 0, 0).toISOString();

const cls = (over: Partial<CalendarClass> & { id: string }): CalendarClass => ({
  title: 'Reformer', startsAt: at(2026, 9, 3, 18), durationMin: 45, room: 'Studio 2',
  trainerId: ME, ...over,
});

const THURSDAY = new Date(2026, 8, 3, 9, 0, 0, 0);   // 3 Sep 2026, local

/* ── the coach's own class appears on the coach's own day ───────────────── */

const mine = cls({ id: 'a' });
eq(classesOnDay([mine], THURSDAY, ME).length, 1, 'a coach sees the class they are teaching');
eq(classesOnDay([mine], THURSDAY, ME)[0].mine, true, 'and it is marked as theirs');

/* ── the local-day rule ─────────────────────────────────────────────────── */

// A 6pm class on the 3rd is on the 3rd wherever the coach is standing. Under
// the UTC date it is the 4th in Los Angeles and the 3rd in Dubai, and half the
// world's coaches would open their evening and find it empty.
const evening = cls({ id: 'evening', startsAt: at(2026, 9, 3, 18) });
eq(classesOnDay([evening], THURSDAY, ME).length, 1, 'an evening class is on the evening it is taught');
// And the day before does not swallow it.
eq(classesOnDay([evening], new Date(2026, 8, 2, 9), ME).length, 0, 'and not on the day before');
eq(classesOnDay([evening], new Date(2026, 8, 4, 9), ME).length, 0, 'nor the day after');

// The early one is the mirror image: 6am on the 3rd is the 2nd in UTC terms
// east of Greenwich.
const early = cls({ id: 'early', startsAt: at(2026, 9, 3, 6) });
eq(classesOnDay([early], THURSDAY, ME).length, 1, 'and a morning class is on its own morning');

/* ── whose classes are drawn ────────────────────────────────────────────── */

const theirs = cls({ id: 'theirs', trainerId: 'coach-2' });
const nobodys = cls({ id: 'nobodys', trainerId: null });

const sheet = classesOnDay([mine, theirs, nobodys], THURSDAY, ME);
eq(sheet.length, 2, "a colleague's class is their business and is not drawn");
ok(!sheet.some((c) => c.id === 'theirs'), 'specifically that one');
// Not "everything that is not mine". A class with nobody against it cannot be
// ruled in or out, and hiding it would assert an hour is free that nothing
// knows is free.
ok(sheet.some((c) => c.id === 'nobodys'), 'an unattributed class is drawn');
eq(sheet.find((c) => c.id === 'nobodys')!.mine, false, 'and is not claimed as the coach’s');

// A coach whose own id has not been restored yet cannot be attributed anything.
const noUid = classesOnDay([mine, theirs, nobodys], THURSDAY, null);
eq(noUid.length, 1, 'with no signed-in id, only the unattributed classes can be shown');
eq(noUid[0].id, 'nobodys', 'and that is which one');

/* ── a class that was called off is not a busy hour ─────────────────────── */

const off = cls({ id: 'off', status: 'cancelled' });
eq(classesOnDay([off], THURSDAY, ME).length, 0, 'a cancelled class frees the hour and is not drawn');
// Absent means scheduled — a row from a database that predates the column is a
// class that is ON, and the only reading that cannot drop a real class.
eq(classesOnDay([cls({ id: 'old', status: undefined })], THURSDAY, ME).length, 1,
  'a class with no status is a class that is on');

/* ── order ──────────────────────────────────────────────────────────────── */

const three = classesOnDay([
  cls({ id: 'six', startsAt: at(2026, 9, 3, 18) }),
  cls({ id: 'seven', startsAt: at(2026, 9, 3, 7) }),
  cls({ id: 'twelve', startsAt: at(2026, 9, 3, 12) }),
], THURSDAY, ME);
eq(three.map((c) => c.id).join(','), 'seven,twelve,six', 'the day reads in the order it is lived');

// A date that will not parse is not on any day. It cannot be placed, and
// guessing would put it on today's sheet for every coach.
eq(classesOnDay([cls({ id: 'broken', startsAt: 'not a date' })], THURSDAY, ME).length, 0,
  'an unreadable date lands on no day at all');

/* ── what the rows and the sheet say ────────────────────────────────────── */

ok(/Your class/.test(classDayNote({ ...mine, mine: true })), 'the coach’s own class says so');
ok(/no coach recorded/.test(classDayNote({ ...nobodys, mine: false })),
  'and an unattributed one says what is actually unknown about it');

/* ── the caveat, which is the whole empty-list rule ─────────────────────── */

eq(classDayCaveat('ready'), null, 'a whole read needs no caveat');
for (const status of ['loading', 'partial', 'error'] as const) {
  const note = classDayCaveat(status) ?? '';
  ok(note.length > 0, `'${status}' says something`);
  ok(!/no classes that day|nothing scheduled/i.test(note),
    `and '${status}' never states the day is clear`);
}
ok(/not a free evening/.test(classDayCaveat('error') ?? ''),
  'a failed read is named as a failed read and not as an empty day');
ok(/row limit/.test(classDayCaveat('partial') ?? ''), 'and a truncated one as truncated');

/* ── the heading ────────────────────────────────────────────────────────── */

eq(classDayHeading(0), null, 'nothing to head means no heading');
eq(classDayHeading(1), 'Class that day', 'one is counted in the singular');
ok(/2/.test(classDayHeading(2) ?? ''), 'and more than one carries the count');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('dayClasses: ok');
