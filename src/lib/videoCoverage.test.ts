// What a coach is told about the movements they programme.
// Compile with tsc, run with node.
//
// Reported from the coach app: "25 of the 25 movements you programme have no
// clip at all", while every one of those movements had a bought animation the
// client could watch. The claim was true when it was written — there were two
// kinds of cover, a coach's clip and an Academy clip — and it stopped being
// true the day a pack of 483 animations landed on the catalogue.
import { coverageFor, coverageLine, type CoverageVideo } from './videoCoverage';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const COACH = 'coach-1';
const clip = (name: string, trainerId: string | null): CoverageVideo => ({ exerciseId: null, name, trainerId });
const programmed = ['Back Squat', 'Bench Press', 'Deadlift'];
const illustrated = (...names: string[]) => new Set(names.map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-')));

/* ── the reported bug ──────────────────────────────────────────────────── */

// Everything illustrated, nothing filmed. This used to be "3 have no clip at
// all"; the client sees all three performed correctly.
{
  const r = coverageFor(programmed, [], COACH, illustrated(...programmed));
  eq(r.missing.length, 0, 'a movement the catalogue illustrates is not missing');
  eq(r.illustratedOnly.length, 3, 'it is reported as showing the catalogue animation instead');
  const line = coverageLine(r)!;
  ok(!line.includes('nothing to show'), 'and the sentence does not say there is nothing to show');
  ok(line.includes('catalogue animation'), 'it says what the client actually sees');
}

// Genuinely bare movements are still called out — the useful half of the claim
// must survive the fix.
{
  const r = coverageFor(programmed, [], COACH, illustrated('Back Squat'));
  eq(r.illustratedOnly.length, 1, 'the illustrated one is separated');
  eq(r.missing.length, 2, 'and the two with nothing are still named');
  ok(coverageLine(r)!.includes('2 of the 3'), 'counted against the whole programme, not the remainder');
  ok(r.missing.includes('Bench Press') && r.missing.includes('Deadlift'), 'by the name the coach typed');
}

/* ── a coach's own clip still outranks everything ─────────────────────── */

{
  const r = coverageFor(programmed, [clip('Back Squat', COACH)], COACH, illustrated(...programmed));
  eq(r.mine.length, 1, "the coach's own clip is counted as theirs");
  ok(!r.illustratedOnly.includes('Back Squat'), 'and not also as merely illustrated');
  eq(r.illustratedOnly.length, 2, 'the other two show the animation');
}

// An Academy clip is cover, and is still reported apart from the catalogue —
// they are different things and a coach may replace either.
{
  const r = coverageFor(programmed, [clip('Bench Press', null)], COACH, illustrated(...programmed));
  eq(r.academyOnly.length, 1, 'an Academy clip is its own category');
  ok(!r.illustratedOnly.includes('Bench Press'), 'and outranks a catalogue illustration');
}

// Everything filmed by the coach: the one sentence that should read as done.
{
  const r = coverageFor(programmed, programmed.map((n) => clip(n, COACH)), COACH, illustrated());
  eq(r.missing.length, 0, 'nothing missing');
  ok(coverageLine(r)!.startsWith('Every movement you programme has your own clip'), 'and it says so plainly');
}

/* ── an unreadable catalogue is unknown, never "nothing" ──────────────── */
//
// The whole reason the argument is nullable. An empty Set says "nothing is
// illustrated"; null says "we did not find out". Reporting the first when the
// second is true is the bug, one layer down.
{
  const unknown = coverageFor(programmed, [], COACH, null);
  ok(unknown.unknownCover, 'a null catalogue is flagged as unknown');
  eq(unknown.missing.length, 0, 'and nothing is asserted to be bare');
  eq(unknown.illustratedOnly.length, 0, 'nor asserted to be illustrated');
  ok(unknown.all.every((c) => c.illustrated === null), 'each movement carries the unknown, rather than a false');
  const line = coverageLine(unknown)!;
  ok(line.includes('could not be checked'), 'the sentence says the check did not happen');
  ok(!line.includes('nothing to show at all'), 'and never claims there is nothing');

  // An empty set is a real answer and must behave differently from null.
  const none = coverageFor(programmed, [], COACH, illustrated());
  ok(!none.unknownCover, 'an empty set is a read that happened');
  eq(none.missing.length, 3, 'and it does mean nothing is illustrated');
}

// Clips still count under an unknown catalogue — what we saw, we saw.
{
  const r = coverageFor(programmed, [clip('Deadlift', COACH)], COACH, null);
  eq(r.mine.length, 1, 'a clip we read is still a clip');
  ok(coverageLine(r)!.includes('2 have no clip of yours'), 'and the caveat covers only the rest');
}

/* ── one of a thing reads as one of a thing ───────────────────────────── */
//
// Every count in this sentence has a singular form, and mutation testing found
// each boundary unasserted. A coach with one movement left to film reading
// "1 movements have nothing to show" is a small thing that makes the whole
// screen look untended.
{
  const one = ['Back Squat'];
  const bare = coverageLine(coverageFor(one, [], COACH, illustrated()))!;
  ok(bare.includes('1 of the 1 movements you programme has nothing'), `singular bare: ${bare}`);
  ok(!bare.includes('have nothing'), 'not the plural verb');

  const illus = coverageLine(coverageFor(one, [], COACH, illustrated('Back Squat')))!;
  ok(illus.includes('1 shows the catalogue animation'), `singular illustrated: ${illus}`);
  ok(!illus.includes('1 show '), 'not the plural verb');

  const acad = coverageLine(coverageFor(one, [clip('Back Squat', null)], COACH, illustrated()))!;
  ok(acad.includes('1 uses the Academy clip'), `singular academy: ${acad}`);

  const unknown = coverageLine(coverageFor(one, [], COACH, null))!;
  ok(unknown.includes('1 has no clip of yours') && unknown.includes(' it could not be checked'),
    `singular unknown: ${unknown}`);

  // And the plurals, so a fix in one direction cannot break the other.
  const two = ['Back Squat', 'Deadlift'];
  ok(coverageLine(coverageFor(two, [], COACH, illustrated()))!.includes('have nothing'), 'plural bare');
  ok(coverageLine(coverageFor(two, [], COACH, illustrated(...two)))!.includes('2 show the catalogue'), 'plural illustrated');
  ok(coverageLine(coverageFor(two, two.map((n) => clip(n, null)), COACH, illustrated()))!.includes('2 use the Academy'), 'plural academy');
  ok(coverageLine(coverageFor(two, [], COACH, null))!.includes('2 have no clip of yours'), 'plural unknown');
}

/* ── the matching rule ─────────────────────────────────────────────────── */

// Slug equality, so what this reports and what the player finds cannot differ.
{
  const r = coverageFor(['Bent-Over Row'], [clip('bent over row', COACH)], COACH, null);
  eq(r.mine.length, 1, 'spelling and case do not make two movements');
  eq(r.all[0].name, 'Bent-Over Row', "and the coach's own spelling is what reads back");
}
// Never substring: "Squat" must not be covered by a clip of "Front Squat".
{
  const r = coverageFor(['Squat'], [clip('Front Squat', COACH)], COACH, illustrated());
  eq(r.mine.length, 0, 'a different movement is not cover');
  eq(r.missing.length, 1, 'it is still missing');
}
// Repeats across programmes are one movement.
{
  const r = coverageFor(['Back Squat', 'back squat', 'BACK SQUAT'], [], COACH, illustrated());
  eq(r.all.length, 1, 'the same movement written three ways is one row');
}

// Nothing programmed: no claim either way.
eq(coverageLine(coverageFor([], [], COACH, illustrated())), null, 'no programmes means no sentence');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('videoCoverage: ok');
