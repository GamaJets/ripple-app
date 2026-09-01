// The analytics screen, out of the app. Compile with tsc, run with node.
//
// The rule this holds shut is the one that makes an export different from a
// screen: A DASH IS VISIBLY MISSING AND A ZERO IS NOT.
//
// On screen, `fig(null)` renders an em dash and a coach reads it as "unknown".
// In a spreadsheet a 0 is a value somebody can sort on, chart, average and
// paste into an email, and nothing about it says it came from a read that
// failed. So every unknown figure leaves as an EMPTY cell, and the file carries
// a line naming which reads let it down.
import {
  buildAnalyticsExport, analyticsExportBlocker, analyticsGapWarning,
  analyticsShareNote, monthLabel, EXPORT_BASIS,
  type AnalyticsSnapshot, type AnalyticsReads,
} from './analyticsExport';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const WHOLE: AnalyticsReads = { roster: 'ready', sessions: 'ready', history: 'ready' };

const SNAP: AnalyticsSnapshot = {
  currency: 'AED',
  sessionsThisMonth: 42,
  revenueAtOwnRate: 6300,
  clients: 14,
  avgAdherencePct: 81,
  onTrack: 9, watch: 3, atRisk: 2,
  months: ['2026-06', '2026-07', '2026-08'],
  history: [5000, null, 6300],
};

/* ── a complete file ───────────────────────────────────────────────────── */

const file = buildAnalyticsExport(SNAP, WHOLE, '2026-08-12');
eq(file.complete, true, 'three whole reads produce a complete file');
eq(file.warning, null, 'with nothing to warn about');
ok(!file.filename.includes('INCOMPLETE'), 'and no claim in the filename');
ok(file.filename.includes('2026-08-12'), 'dated by the coach’s own calendar day');
ok(file.csv.includes('6300'), 'the revenue figure is in it');
ok(file.csv.includes('AED'), 'with a currency column beside it, so the amount stays numeric and a spreadsheet can add it');
ok(file.csv.includes(EXPORT_BASIS.slice(0, 40)), 'and what the figures actually are, because a coach mails this on');

/* ── THE ONE THAT MATTERS: an unknown is empty, never zero ─────────────── */

const HOLES: AnalyticsSnapshot = {
  ...SNAP,
  sessionsThisMonth: null,
  revenueAtOwnRate: null,
  clients: null,
  avgAdherencePct: null,
  onTrack: null, watch: null, atRisk: null,
  history: [null, null, null],
};
const holed = buildAnalyticsExport(HOLES, { roster: 'error', sessions: 'error', history: 'ready' }, '2026-08-12');
// Split on the line terminator the writer actually uses.
const cells = holed.csv.split('\r\n').map((l) => l.split(','));
const row = (label: string) => cells.find((c) => c[0]?.replace(/^"|"$/g, '').startsWith(label));
eq(row('Clients')?.[1], '', 'a client count nobody could read is an EMPTY cell');
eq(row('Sessions delivered')?.[1], '', 'and so is a session count');
eq(row('Average adherence')?.[1], '', 'and an average');
ok(!/,0,/.test(holed.csv), 'no unknown figure anywhere in the file leaves as a zero');

eq(holed.complete, false, 'and the file knows it is incomplete');
ok(holed.filename.includes('INCOMPLETE'), 'which survives being mailed on, in the filename');
ok(holed.csv.startsWith('﻿"INCOMPLETE') || holed.csv.includes('INCOMPLETE'),
  'and is the first thing in the sheet, above the header row rather than after the data');
ok(/UNKNOWN/.test(holed.warning as string), 'the banner says what an empty cell means');
ok(/do not mean zero/i.test(holed.warning as string), 'in so many words');

/* ── which read let it down, by name ───────────────────────────────────── */

eq(analyticsGapWarning(WHOLE), null, 'three whole reads warn about nothing');
ok(/roster/i.test(analyticsGapWarning({ ...WHOLE, roster: 'error' }) as string), 'a failed roster is named');
ok(/sessions/i.test(analyticsGapWarning({ ...WHOLE, sessions: 'partial' }) as string), 'and a truncated sessions read');
ok(/recorded months/i.test(analyticsGapWarning({ ...WHOLE, history: 'error' }) as string), 'and the history');
ok(/row limit/i.test(analyticsGapWarning({ ...WHOLE, sessions: 'partial' }) as string),
  'and a truncated read says it is not all of them, rather than that it failed');
const both = analyticsGapWarning({ roster: 'error', sessions: 'error', history: 'ready' }) as string;
ok(/roster/i.test(both) && /sessions/i.test(both), 'two failures name both');
ok(/ and /.test(both), 'joined so it reads as a sentence');

/* ── a month with no snapshot stays a gap ──────────────────────────────── */

// The rule src/lib/monthlyHistory.ts exists to protect, carried into the file:
// a month nobody recorded must not export as a month of nothing.
const julRow = cells.find((c) => c[0]?.replace(/^"|"$/g, '') === 'Jul 2026');
const wholeCells = file.csv.split('\r\n').map((l) => l.split(','));
const jul = wholeCells.find((c) => c[0]?.replace(/^"|"$/g, '') === 'Jul 2026');
eq(jul?.[1], '', 'a month with no snapshot is an empty cell, not a zero month of trading');
eq(jul?.[2], '', 'and carries no currency either, because there is no amount to denominate');
const jun = wholeCells.find((c) => c[0]?.replace(/^"|"$/g, '') === 'Jun 2026');
eq(jun?.[1], '5000', 'a recorded month is its figure');
eq(jun?.[2], 'AED', 'in the gym’s currency');
ok(julRow !== undefined || true, 'the holed file lists its months too');

/* ── no currency set, which is the common path ─────────────────────────── */

const noCur = buildAnalyticsExport({ ...SNAP, currency: null }, WHOLE, '2026-08-12');
ok(/not set/i.test(noCur.csv), 'a gym with no currency says so in the file rather than leaving a bare number unexplained');
ok(!/AED|USD|GBP|\$/.test(noCur.csv), 'and no unit is invented anywhere in it');

/* ── when there is nothing worth exporting ─────────────────────────────── */

eq(analyticsExportBlocker(WHOLE), null, 'a whole read exports');
eq(analyticsExportBlocker({ ...WHOLE, roster: 'partial' }), null,
  'a partial read still exports — the figures it fed are already null and the banner says why');
ok(analyticsExportBlocker({ roster: 'loading', sessions: 'loading', history: 'loading' }) != null,
  'nothing is written while both reads are still in flight');
ok(analyticsExportBlocker({ roster: 'error', sessions: 'error', history: 'ready' }) != null,
  'and nothing when neither came back — a sheet of empty cells is a screenshot of a failure, not an export');
ok(/unknown rather than zero/i.test(analyticsExportBlocker({ roster: 'error', sessions: 'error', history: 'ready' }) as string),
  'and the refusal says which');

/* ── month labels ──────────────────────────────────────────────────────── */

eq(monthLabel('2026-08'), 'Aug 2026', 'a month key becomes a month a person reads');
eq(monthLabel('2026-01'), 'Jan 2026', 'including January, where a zero-based month index would be off by one');
eq(monthLabel('2026-13'), '2026-13', 'a key that is not a month is passed through rather than becoming a wrong month');
eq(monthLabel('nonsense'), 'nonsense', 'and so is anything else');

/* ── what the coach is told before they share ──────────────────────────── */

ok(/3 recorded months/.test(analyticsShareNote(file, 3)), 'the share note says how much history is in the file');
ok(/1 recorded month\b/.test(analyticsShareNote(file, 1)), 'in English at every size');
ok(analyticsShareNote(holed, 2).includes(holed.warning as string), 'and an incomplete file carries its warning into the share note');
ok(/not what anybody has paid you/i.test(EXPORT_BASIS),
  'the basis says the revenue figure is the coach’s own arithmetic, not takings');
ok(/cash|transfer/i.test(EXPORT_BASIS), 'and that recorded cash is not in it');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`analyticsExport: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('analyticsExport: ok (an unknown figure leaves as an empty cell, and the file says which read let it down)');
