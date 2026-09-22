// Tests for broadcastOutcome — the three figures a coach may be told about a
// message that went to a segment.
//
// One rule is under test and the rest is scaffolding around it: DELIVERED IS
// NULL AND STAYS NULL. Every other assertion here exists because the ways that
// rule gets broken are all quiet — a helper that fills the field in from the
// figure beside it, a sentence that omits the unknown when everything landed,
// a heading that says "Sent" over a send where nothing was written.
//
// Compile with tsc then run with node, like bulkActions.test.ts.
import {
  sendOutcome, outcomeLines, outcomeTitle, WHERE_THE_RECORD_IS, type SendOutcome,
} from './broadcastOutcome';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const text = (o: SendOutcome) => outcomeLines(o).join(' ');

/* ── the rule ─────────────────────────────────────────────────────────────── */

for (const [addressed, written] of [[0, 0], [1, 1], [12, 12], [12, 8], [12, 0]]) {
  const o = sendOutcome(addressed, written);
  eq(o.delivered, null,
    `DELIVERED IS NULL at ${written}/${addressed} — the app sees the row it wrote and is never told a handset rang`);
}

{
  const o = sendOutcome(12, 12);
  const s = text(o);
  ok(/unknown/i.test(s),
    'EVEN WHEN EVERYTHING LANDED the unknown is stated — that is the moment a coach reads "all 12" and stops reading');
  ok(/not none/i.test(s),
    'and it is stated as unknown rather than as none, which is the distinction the gym-side log was built around');
  ok(!/\bdelivered to\b/i.test(s), 'nothing anywhere says the message was delivered to anybody');
}

/* ── addressed and written are separate claims ────────────────────────────── */

{
  const s = text(sendOutcome(12, 8));
  ok(s.includes('12') && s.includes('8'), 'a partial send names both figures');
  ok(/4/.test(s), 'and the shortfall, because the four with nothing from their coach are the actionable half');
}
{
  const s = text(sendOutcome(12, 0));
  ok(/[Nn]othing was written/.test(s),
    'NOTHING LANDED IS SAID PLAINLY — a coach who believes a failed send half-landed never sends it again');
  ok(!/unknown/i.test(s) || /because nothing was written/i.test(s),
    'and the push sentence does not muse about phones for a message that was never written');
}

/* ── the constructor is the only place `delivered` is decided ─────────────── */

{
  const o = sendOutcome(5, 9);
  eq(o.written, 5,
    'written cannot exceed addressed — a figure larger than the set it is drawn from is an arithmetic error, not a fact about a send');
  eq(sendOutcome(-3, -9).addressed, 0, 'negatives are clamped rather than rendered');
  eq(sendOutcome(4.7, 2.9).written, 2, 'and fractions cannot reach a sentence that counts people');
}

/* ── the heading ──────────────────────────────────────────────────────────── */

eq(outcomeTitle(sendOutcome(0, 0)), 'Nothing was sent', 'an empty send is not titled as a send');
ok(/[Nn]othing was written/.test(outcomeTitle(sendOutcome(9, 0))),
  'a total failure is titled as one, so the shape is readable without the lines under it');
ok(/written/i.test(outcomeTitle(sendOutcome(9, 9))),
  'a complete send is titled on the WRITE — the strongest claim the product can make');
// \b on each, because "thread" contains "read" and a bare /read/ passes this
// assertion for the wrong reason on the one title it matters most for.
ok(!/\bdelivered\b|\breceived\b|\bread\b/i.test(outcomeTitle(sendOutcome(9, 9))),
  'and never on delivery, receipt or reading, none of which this app is told about');
ok(outcomeTitle(sendOutcome(9, 4)).includes('4') && outcomeTitle(sendOutcome(9, 4)).includes('9'),
  'a partial heading carries both figures');

/* ── where the record actually is ─────────────────────────────────────────── */

ok(/thread/i.test(WHERE_THE_RECORD_IS),
  'the durable record is named as the client’s own thread, which is where it genuinely is');
ok(/not kept|is not kept anywhere/i.test(WHERE_THE_RECORD_IS),
  'AND THE GAP IS ADMITTED — nothing groups these messages as one broadcast, and a coach should learn that here rather than while looking for a list that does not exist');
ok(!/\bnineteen\b|\b19\b/.test(WHERE_THE_RECORD_IS),
  'a constant shared by every send names no particular count');

if (errors.length) {
  console.error(`broadcastOutcome.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('broadcastOutcome.test.ts — ok');
