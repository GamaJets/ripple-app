// Pairing a tape entry with the scan taken beside it — and the several
// occasions on which no pairing may be claimed.
//
// Compile with tsc, then run under plain node.
import { pairScan, gapNote, PAIR_WINDOW_DAYS, type ScanPoint } from './tapeVsScan';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/** A full scan, so a test that is about dates does not accidentally be about
 *  missing figures. */
const scan = (at: string, bf = 22.4, kg = 81.2): ScanPoint => ({ at, bodyFatPct: bf, weightKg: kg, skeletalMuscleKg: 34.1 });

/* ── 1. the pairing itself ────────────────────────────────────────────────── */

{
  const p = pairScan('2026-08-12', [scan('2026-08-10')]);
  eq(p?.at, '2026-08-10', 'the scan two days before is the one paired');
  eq(p?.gapDays, -2, 'and the gap is signed: the scan came first');
  eq(p?.bodyFatPct, 22.4, 'the body fat is carried through');
  eq(p?.weightKg, 81.2, 'and so is the weight');
}

eq(pairScan('2026-08-12', [scan('2026-08-12')])?.gapDays, 0, 'a scan on the tape day is a zero gap');
eq(pairScan('2026-08-12', [scan('2026-08-15')])?.gapDays, 3, 'a scan after the tape is a positive gap');

/* ── 2. the window ────────────────────────────────────────────────────────── */

// The whole point of the rule: a figure from six weeks away is not a reading
// of the same body, however tempting it is to print it.
eq(pairScan('2026-08-12', [scan('2026-06-30')]), null, 'a scan six weeks away is not paired');

eq(pairScan('2026-08-12', [scan('2026-08-02')])?.at, '2026-08-02',
  `exactly ${PAIR_WINDOW_DAYS} days before is inside the window`);
eq(pairScan('2026-08-12', [scan('2026-08-22')])?.at, '2026-08-22',
  `exactly ${PAIR_WINDOW_DAYS} days after is inside the window`);
eq(pairScan('2026-08-12', [scan('2026-08-01')]), null, 'one day beyond it is not');
eq(pairScan('2026-08-12', [scan('2026-08-23')]), null, 'in either direction');

/* ── 3. nearest wins, and the tie is stable ───────────────────────────────── */

{
  const far = scan('2026-08-04', 25.0);
  const near = scan('2026-08-11', 22.4);
  eq(pairScan('2026-08-12', [far, near])?.at, '2026-08-11', 'the nearest scan is chosen');
  eq(pairScan('2026-08-12', [near, far])?.at, '2026-08-11', 'whatever order they arrive in');
}

{
  // Four days either side. Neither describes the body better; what matters is
  // that a refresh which merely re-sorts the list cannot change the figure
  // printed under an unchanged tape entry.
  const before = scan('2026-08-08', 23.1);
  const after = scan('2026-08-16', 21.9);
  eq(pairScan('2026-08-12', [before, after])?.at, '2026-08-08', 'a tie resolves to the earlier scan');
  eq(pairScan('2026-08-12', [after, before])?.at, '2026-08-08', 'and does so regardless of input order');
}

/* ── 4. null is not zero ──────────────────────────────────────────────────── */

// `Number(r.body_fat_pct)` over a null column is NaN, and a 0% body fat is not
// a reading anybody has ever taken. Both are absences and both must print as
// absences rather than as figures.
{
  const p = pairScan('2026-08-12', [{ at: '2026-08-11', bodyFatPct: NaN, weightKg: 81.2, skeletalMuscleKg: null }]);
  eq(p?.bodyFatPct, null, 'a NaN body fat is null, not a number');
  eq(p?.weightKg, 81.2, 'and the weight beside it still comes through');
  eq(p?.skeletalMuscleKg, null, 'an absent muscle mass stays absent');
}

eq(pairScan('2026-08-12', [{ at: '2026-08-11', bodyFatPct: 0, weightKg: 0, skeletalMuscleKg: 0 }]), null,
  'a scan whose every figure is zero is no pairing at all');

// A scan row that carries nothing must not displace a real one that is further
// away — otherwise the nearest-wins rule hands back an empty card.
eq(pairScan('2026-08-12', [{ at: '2026-08-12', bodyFatPct: null, weightKg: null }, scan('2026-08-08')])?.at,
  '2026-08-08', 'an empty scan on the day does not beat a real one four days off');

/* ── 5. the absences ──────────────────────────────────────────────────────── */

eq(pairScan('2026-08-12', []), null, 'no scans, no pairing');
eq(pairScan('2026-08-12', null), null, 'and an unread list is not a pairing either');
eq(pairScan(null, [scan('2026-08-11')]), null, 'a tape entry with no date pairs with nothing');
eq(pairScan('2026-08-12', [{ at: '', bodyFatPct: 22.4 }]), null, 'nor does a scan with no date');
eq(pairScan('2026-08-12', [{ at: 'not a date', bodyFatPct: 22.4 }]), null, 'nor one we cannot read');

/* ── 6. the wording ───────────────────────────────────────────────────────── */

eq(gapNote(0), 'scanned the same day', 'zero days is said in words, not as a number');
eq(gapNote(-1), 'scanned the day before', 'one day before is singular');
eq(gapNote(1), 'scanned the day after', 'and so is one day after');
eq(gapNote(-4), 'scanned 4 days before', 'four days before');
eq(gapNote(6), 'scanned 6 days after', 'six days after');
ok(!/-/.test(gapNote(-6)), 'the sign never reaches the sentence as a minus');

if (errors.length) {
  console.error(`tapeVsScan: ${errors.length} failed`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('tapeVsScan: ok');
