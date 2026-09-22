// The sentences a coach reads when their open slots have stopped being
// generated. Every assertion here is about a failure with no error in it —
// see the header of slotGeneration.ts.
import {
  zoneState, zonelessNote, selfHealLabel, noZoneToOfferNote,
  selfHealConfirm, selfHealResult, type ZoneState,
} from './slotGeneration';

const errors: string[] = [];
const ok = (c: boolean, msg: string) => { if (!c) errors.push(msg); };
const eq = <T,>(a: T, b: T, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── which state we are in ─────────────────────────────────────────────── */

eq(zoneState(0, 5, 'ready'), 'all-zoned', 'every hour zoned is the working state');
eq(zoneState(3, 5, 'ready'), 'some-zoneless', 'three unzoned hours is the broken one');

// The one that matters most. A read that did not come back whole cannot say
// there is nothing wrong, and folding it to zero is how a coach stops looking.
eq(zoneState(null, 5, 'ready'), 'unknown', 'a null count is never an all-clear');
eq(zoneState(0, 5, 'error'), 'unknown', 'nor is a zero off a failed read');
eq(zoneState(0, 5, 'partial'), 'unknown', 'nor off a truncated one — partial is not whole');
eq(zoneState(0, 5, 'loading'), 'unknown', 'nor before the read has landed');

// A coach who has set no hours has nothing being skipped. Telling them their
// slots have stopped generating sends them hunting a fault that is an empty
// week.
eq(zoneState(0, 0, 'ready'), 'all-zoned', 'an empty week is not a broken one');

/* ── what is said ──────────────────────────────────────────────────────── */

eq(zonelessNote('all-zoned', 0), null, 'nothing is said when nothing is wrong');
ok(zonelessNote('unknown', null)!.includes('not an all-clear'),
  'an unreadable week says so, and says it is not an all-clear');

{
  const one = zonelessNote('some-zoneless', 1)!;
  ok(one.includes('One of your weekly hours has'), 'one hour is singular');
  ok(!one.includes('1 of your'), 'and is not rendered as a digit');
  ok(one.includes('that time'), 'and the consequence is singular too');

  const many = zonelessNote('some-zoneless', 4)!;
  ok(many.includes('4 of your weekly hours have'), 'four hours is plural');
  ok(many.includes('those times'), 'and so is the consequence');

  // The point of the sentence: not "a field is empty" but what it costs.
  for (const s of [one, many]) {
    ok(s.includes('clients see nothing to book'),
      'the note names what the client sees, not what the column holds');
    ok(/empty gym/.test(s), 'and why guessing is not the safer option');
  }
}

// A count of zero can still reach the note through a stale state; it must not
// produce "0 of your weekly hours".
eq(zonelessNote('some-zoneless', 0), null, 'no hours means no sentence');
eq(zonelessNote('some-zoneless', null), null, 'and neither does an unknown count');

/* ── what can be offered ───────────────────────────────────────────────── */

eq(selfHealLabel('all-zoned', 'Europe/Lisbon'), null, 'nothing to press when nothing is wrong');
ok(selfHealLabel('some-zoneless', 'Europe/Lisbon')!.includes('Europe/Lisbon'),
  'the button names the zone it would write, so it can be disagreed with');

// The refusal. A phone that cannot say where it is has nothing honest to
// apply, and offering the button anyway would write a guess.
eq(selfHealLabel('some-zoneless', null), null, 'no zone in hand, no button');
ok(noZoneToOfferNote('some-zoneless', null)!.includes('gym’s timezone'),
  'and the coach is pointed at the one thing that does know');
eq(noZoneToOfferNote('some-zoneless', 'Asia/Dubai'), null,
  'the explanation disappears once there is a button');
eq(noZoneToOfferNote('all-zoned', null), null, 'and never appears when nothing is wrong');

/* ── the confirmation ──────────────────────────────────────────────────── */

{
  const c = selfHealConfirm(3, 'Asia/Dubai');
  ok(c.includes('Asia/Dubai'), 'the confirmation names the zone');
  ok(c.includes('all 3 of your unzoned hours'), 'and how many hours it touches');
  ok(c.includes('somewhere else'),
    'and warns about the one case where this is the wrong answer — a week set while travelling');
  ok(selfHealConfirm(1, 'Asia/Dubai').includes('your one unzoned hour'), 'singular reads as English');
}

/* ── what happened ─────────────────────────────────────────────────────── */

{
  // Nothing saved is never reported as a partial success.
  const none = selfHealResult(0, 3, 'Asia/Dubai');
  ok(none.includes('Nothing was changed'), 'a refused write says nothing changed');
  ok(none.includes('still not being opened'), 'and that the problem is still there');
  ok(!/^3 hours/.test(none), 'and never leads with the number asked for');

  const all = selfHealResult(3, 3, 'Asia/Dubai');
  ok(all.includes('3 hours are now recorded'), 'a whole write says so');
  ok(all.includes('Generate Open Slots'), 'and offers the way to not wait until tonight');

  // The half-write. Reporting `asked` here is the exact mistake `assertWrote`
  // exists to prevent: it would tell a coach four hours are open when one is.
  const some = selfHealResult(2, 3, 'Asia/Dubai');
  ok(some.includes('2 hours are now recorded'), 'a partial write counts what landed');
  ok(some.includes('One hour was not saved'), 'and says what did not, in the singular');

  ok(selfHealResult(1, 1, 'Asia/Dubai').includes('One hour is now'), 'one is spelled, not digited');
}

/* ── every state is handled ────────────────────────────────────────────── */

for (const st of ['all-zoned', 'some-zoneless', 'unknown'] as ZoneState[]) {
  // No arm may throw, and no arm may return the string "undefined" — the two
  // ways a missing branch reaches a screen.
  for (const v of [zonelessNote(st, 2), selfHealLabel(st, 'Europe/Lisbon'), noZoneToOfferNote(st, null)]) {
    ok(v === null || (typeof v === 'string' && v.length > 0 && !v.includes('undefined')),
      `${st} produces either nothing or a real sentence`);
  }
}

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`slotGeneration: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('slotGeneration: ok — a week that could not be read is never reported as a week with nothing wrong');
