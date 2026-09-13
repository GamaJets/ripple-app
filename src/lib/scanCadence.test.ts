// How often a body is actually being measured, and the several occasions on
// which that must not be answered.
//
// Compile with tsc, then run under plain node.
import {
  scanRhythm, sinceLastScan, unreadableScanDays, gapPhrase, rhythmLine, stoppedNote,
  MONTH_WINDOW,
} from './scanCadence';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const TODAY = '2026-09-13';

// The record the item is written about: three scans in January, two in
// February, one in March, and nothing since.
const STOPPED = [
  '2026-01-05', '2026-01-19', '2026-01-30',
  '2026-02-16', '2026-02-27',
  '2026-03-16',
];

/* ── 1. the whole-read gate ───────────────────────────────────────────────── */

// Every figure on a ScanRhythm is computed over the whole set, and a truncated
// scans read is missing the OLD end — exactly the rows that would change the
// count, the median, the span and the first date. A smaller answer here would
// be a wrong one, not a partial one.
eq(scanRhythm(STOPPED, false, TODAY), null, 'a truncated record describes no rhythm at all');
ok(scanRhythm(STOPPED, true, TODAY) != null, 'and a whole one does');

/* ── 2. counting days, not rows ───────────────────────────────────────────── */

{
  const r = scanRhythm(STOPPED, true, TODAY);
  eq(r?.count, 6, 'six scan days');
  eq(r?.firstISO, '2026-01-05', 'from the first');
  eq(r?.lastISO, '2026-03-16', 'to the last');
  eq(r?.spanDays, 70, 'ten weeks apart');
  // Gaps: 14, 11, 17, 11, 17 → sorted 11,11,14,17,17 → median 14.
  eq(r?.typicalGapDays, 14, 'the typical gap is the median, not the mean');
  eq(r?.longestGapDays, 17, 'and the longest is the longest');
}

// Two scans on one morning are one measurement of one body.
{
  const r = scanRhythm(['2026-03-01', '2026-03-01', '2026-03-15'], true, TODAY);
  eq(r?.count, 2, 'a day recorded twice is one day');
  // And the duplicate must not enter the gap list as a zero, which would drag a
  // median toward "more than once a day".
  eq(r?.longestGapDays, 14, 'and contributes no gap of zero');
}

// Order is not trusted from the caller: `clientData` reverses a newest-first
// page, an offline queue appends, and a merge of the two is in no order at all.
{
  const r = scanRhythm(['2026-03-16', '2026-01-05', '2026-02-16'], true, TODAY);
  eq(r?.firstISO, '2026-01-05', 'the answer does not depend on the order they arrive in');
  eq(r?.lastISO, '2026-03-16', 'at either end');
}

/* ── 3. the refusals ──────────────────────────────────────────────────────── */

eq(scanRhythm([], true, TODAY), null, 'no scans is not a cadence of zero');
eq(scanRhythm(['2026-03-16'], true, TODAY), null, 'and one scan is a reading, not a rhythm');

// Below four days there are fewer than three gaps, and a median over two is
// their mean — one holiday moves it by half.
{
  const three = scanRhythm(['2026-01-05', '2026-01-19', '2026-01-30'], true, TODAY);
  eq(three?.count, 3, 'three days is a describable record');
  eq(three?.typicalGapDays, null, 'but not enough of them for a typical gap');
  ok(three?.longestGapDays === 14, 'the longest gap needs only two days and is still given');
}

eq(unreadableScanDays(['2026-01-05', 'not-a-day', '', null, undefined]), 4,
  'dates that will not read are counted rather than silently dropped');
eq(unreadableScanDays(STOPPED), 0, 'and a clean record reports none');

{
  // An unreadable row leaves every figure below it. The count reflects what was
  // actually readable, and the caller has `unreadableScanDays` to say so.
  const r = scanRhythm(['2026-01-05', 'not-a-day', '2026-01-19', '2026-02-02'], true, TODAY);
  eq(r?.count, 3, 'an unreadable date is not counted as a scan day');
}

/* ── 4. how long since — the figure a cut record can still answer ─────────── */

{
  const s = sinceLastScan(STOPPED, TODAY);
  eq(s?.days, 181, 'the days since the newest scan are counted to today');
  eq(s?.sinceISO, '2026-03-16', 'from the newest day on record');
}

// Deliberately NOT gated on a whole read: a newest-first cap takes the old end.
ok(sinceLastScan(STOPPED, TODAY) != null,
  'a truncated record still answers how long it has been — the newest day survives the cut');

eq(sinceLastScan([], TODAY), null, 'nothing on record is not "scanned today"');
eq(sinceLastScan(['not-a-day'], TODAY), null, 'and neither is a date that will not read');
// Zero days is a real answer and must survive being rendered: it is "scanned
// today", not "never scanned", and the two are told apart by the object being
// present rather than by the number being truthy.
ok(sinceLastScan(['2026-09-13'], TODAY) != null, 'a scan taken today still produces an answer');
eq(sinceLastScan(['2026-09-13'], TODAY)?.days, 0, 'and that answer is a gap of zero days');
// The scan sheet lets a date be chosen by hand, so a future date is reachable.
eq(sinceLastScan(['2026-09-20'], TODAY), null, 'a scan dated in the future produces no figure');

/* ── 5. the month strip, whose empty months are the point ─────────────────── */

{
  const r = scanRhythm(STOPPED, true, TODAY);
  const m = r?.months ?? [];
  eq(m.length, MONTH_WINDOW, 'the strip is a fixed window');
  // It runs to the month the coach is standing in, NOT to the last scan — a
  // strip ending at the last scan draws a full bar on its right-hand edge for
  // somebody who has not been measured in six months.
  eq(m[m.length - 1].key, '2026-09', 'ending in the current month');
  eq(m[m.length - 1].n, 0, 'which is empty, and says so');
  eq(m.find((x) => x.key === '2026-01')?.n, 3, 'three in January');
  eq(m.find((x) => x.key === '2026-02')?.n, 2, 'two in February');
  eq(m.find((x) => x.key === '2026-03')?.n, 1, 'one in March');
  eq(m.find((x) => x.key === '2026-04')?.n, 0, 'and nothing in April — a month with no rows is still drawn');
  eq(r?.beforeStrip, 0, 'nothing falls before the window here');
}

// The window walks backwards across a year boundary without the caller doing
// modulo by hand.
{
  const r = scanRhythm(['2025-10-04', '2025-12-20', '2026-01-08'], true, '2026-01-15');
  const keys = (r?.months ?? []).map((x) => x.key);
  eq(keys[keys.length - 1], '2026-01', 'the strip ends in January');
  eq(keys[keys.length - 2], '2025-12', 'and December is the month before it');
  eq((r?.months ?? []).find((x) => x.key === '2025-11')?.n, 0, 'with November empty between them');
}

// Scans older than the window are counted, so the strip is never read as the
// whole record.
{
  const r = scanRhythm(['2024-02-01', '2024-03-01', '2026-09-01'], true, TODAY);
  eq(r?.beforeStrip, 2, 'the two older scans are reported rather than vanishing');
  eq(r?.count, 3, 'and are still counted in the record itself');
}

/* ── 6. the words ─────────────────────────────────────────────────────────── */

eq(gapPhrase(1), 'about every day', 'a daily gap');
eq(gapPhrase(3), 'about every 3 days', 'a few days is said in days');
eq(gapPhrase(14), 'about every 2 weeks', 'a fortnight is said in weeks');
eq(gapPhrase(34), 'about every 5 weeks', 'and so is a month-ish gap, rounded');
eq(gapPhrase(90), 'about every 3 months', 'a quarter is said in months');
// "about" is load-bearing: the median of five gaps is not precise to the day.
ok(gapPhrase(34).startsWith('about'), 'and every one of them hedges');

eq(rhythmLine(null), null, 'no rhythm, no sentence');
{
  const line = rhythmLine(scanRhythm(STOPPED, true, TODAY)) ?? '';
  ok(line.includes('6 days'), 'the sentence counts the days measured on');
  ok(line.includes('10 weeks'), 'and the span they cover');
  ok(line.includes('about every 2 weeks'), 'and the usual gap');
}

/* ── 7. "and not since", which must stay a statement about the record ─────── */

{
  const r = scanRhythm(STOPPED, true, TODAY);
  const note = stoppedNote(r, sinceLastScan(STOPPED, TODAY)) ?? '';
  ok(note.length > 0, 'a record that stopped six months into a fortnightly habit says so');
  ok(note.includes('181 days'), 'with the number of days in it');
  ok(note.includes('usual 14'), 'held against their own usual gap');
  // It reports the record. It does not report the person, and it does not
  // claim they have not been measured elsewhere.
  ok(note.includes('does not say where they have or have not been measured'),
    'and says out loud what it cannot see');
  ok(!/lapsed|given up|stopped training|neglect/i.test(note), 'and diagnoses nothing');
}

// Within the rhythm there is nothing to report, and silence is the correct
// output — a note that fires every time is one nobody reads.
{
  const recent = ['2026-08-16', '2026-08-30', '2026-09-06', '2026-09-12'];
  eq(stoppedNote(scanRhythm(recent, true, TODAY), sinceLastScan(recent, TODAY)), null,
    'a client scanned last week is not flagged');
}

// Without a usual gap there is nothing to be outside of.
eq(stoppedNote(scanRhythm(['2026-01-05', '2026-01-19'], true, TODAY),
  sinceLastScan(['2026-01-05', '2026-01-19'], TODAY)), null,
  'two scans give no usual gap, so no claim is made about the silence after them');

eq(stoppedNote(null, sinceLastScan(STOPPED, TODAY)), null, 'and no rhythm makes no claim either');

if (errors.length) {
  console.error(`scanCadence: ${errors.length} failed`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('scanCadence: ok');
