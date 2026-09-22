// "They have logged nothing" is a sentence about a person. It may only be said
// when the read finished, came back whole, and the member had said yes.
// Compile with tsc, run with node.
import {
  wellnessPanel, nightsOf, sortedWater, averageHours, averageGlasses, qualityMarks,
  notSharedLine, unreadableLine, notAskedLine, nothingLoggedLine, truncatedLine,
  type PanelInput, type SleepLogRow, type WaterLogRow, type Voice,
} from './coachWellness';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const base: PanelInput = {
  askable: true,
  shared: true,
  flagStatus: 'ready',
  sleepStatus: 'ready',
  waterStatus: 'ready',
  sleep: [],
  water: [],
};
const panel = (over: Partial<PanelInput>) => wellnessPanel({ ...base, ...over });

/* ── the three states that are not one state ────────────────────────────── */

eq(panel({ shared: false }).kind, 'not-shared',
  'a member who has not turned it on is not a member with nothing logged');
eq(panel({ shared: true }).kind, 'shared',
  'and one who has, with a clean read, is shown what came back');
eq(panel({ flagStatus: 'error', shared: null }).kind, 'unreadable',
  'a failed flag read is unknown, never "off"');
eq(panel({ shared: null }).kind, 'unreadable',
  'and a null flag under a status that claims success is still unknown — the value decides, not the status alone');
eq(panel({ askable: false, shared: null, flagStatus: 'error' }).kind, 'not-asked',
  'a hand-added client with no account was never asked, so nothing failed');

// The precedence that matters most, asserted on its own: a refused read must
// never be reported as the member's decision.
eq(panel({ flagStatus: 'error', shared: false }).kind, 'unreadable',
  'a stale false under a failed read is not evidence they said no');

/* ── nothing is drawn from a read still in flight ───────────────────────── */

eq(panel({ flagStatus: 'loading', shared: null }).kind, 'loading', 'the flag is still being read');
eq(panel({ sleepStatus: 'loading' }).kind, 'loading', 'the nights are still being read');
eq(panel({ waterStatus: 'loading' }).kind, 'loading', 'the water is still being read');

/* ── a failed half is not an empty half ─────────────────────────────────── */

eq(panel({ sleepStatus: 'error', waterStatus: 'error' }).kind, 'unreadable',
  'both halves refused is not a shared record with nothing in it');
eq(panel({ sleepStatus: 'error' }).kind, 'shared',
  'one half refused still shows the other — each prints its own sentence');

/* ── not-shared carries no rows at all ──────────────────────────────────── */

const withRows: SleepLogRow[] = [{ at: '2026-09-10T07:00:00.000Z', hours: 7, quality: 4 }];
const refused = panel({ shared: false, sleep: withRows });
eq(refused.kind, 'not-shared', 'the verdict stands whatever happens to be in memory');
ok(!('nights' in refused), 'and the verdict carries no list a screen could print "nothing logged" from');

/* ── partial is not ready, and an average over a prefix is not an average ─ */

const truncated = panel({ sleepStatus: 'partial', waterStatus: 'partial', sleep: withRows });
eq(truncated.kind, 'shared', 'a truncated read FINISHED, so it is not loading and not an error');
ok(truncated.kind === 'shared' && !truncated.nightsWhole, 'but it is not whole');
ok(truncated.kind === 'shared' && !truncated.waterWhole, 'and neither is the water');
ok(truncated.kind === 'shared' && truncated.nights.length === 1, 'the rows are real and may be listed');

eq(averageHours(nightsOf(withRows), false), null, 'no average over a prefix');
eq(averageGlasses([{ loggedOn: '2026-09-10', glasses: 6 }], false), null, 'and none over a truncated water read');

/* ── null is not zero ───────────────────────────────────────────────────── */

eq(averageHours([], true), null, 'no nights averages to null, never to 0 hours slept');
eq(averageGlasses([], true), null, 'no days averages to null, never to 0 glasses drunk');
eq(averageGlasses([{ loggedOn: '2026-09-10', glasses: 0 }], true), 0,
  'but a STORED zero is a real answer and is counted — the member pressed minus back down to nothing');

// The divisor is days recorded, not days elapsed. A member who drank on Monday
// and never opened the app again has one day on record, not a week of zeroes.
eq(averageGlasses([{ loggedOn: '2026-09-10', glasses: 8 }, { loggedOn: '2026-09-08', glasses: 4 }], true), 6,
  'the average is over the days that have a row');

/* ── a night belongs to a date, and two entries are two entries ─────────── */

const twice: SleepLogRow[] = [
  { at: '2026-09-10T07:00:00.000Z', hours: 7, quality: 4 },
  { at: '2026-09-10T09:30:00.000Z', hours: 1.5, quality: 2 },
  { at: '2026-09-09T06:15:00.000Z', hours: 8, quality: 5 },
];
const grouped = nightsOf(twice);
eq(grouped.length, 2, 'three entries over two nights');
eq(grouped[0].entries.length, 2, 'a night with two entries keeps both');
ok(grouped[0].night > grouped[1].night, 'newest night first, by string compare on YYYY-MM-DD');
// Not 4.25. Averaging a night produces a figure the member never typed, which
// is the move readiness.ts refuses and this must not make on the coach's side.
ok(!grouped[0].entries.some((e) => e.hours === 4.25), 'a night with two entries is never collapsed into their mean');
eq(averageHours(grouped, true), (7 + 1.5 + 8) / 3, 'the average is over what was reported, entry by entry');

eq(nightsOf([{ at: 'not a date', hours: 7, quality: 4 }]).length, 0,
  'a row whose moment cannot be read is dropped, not filed under a guess');
eq(nightsOf([{ at: '2026-09-10T07:00:00.000Z', hours: Number.NaN, quality: 4 }]).length, 0,
  'and neither is a non-number rendered as a night');

/* ── the bare date is never parsed ──────────────────────────────────────── */

const days: WaterLogRow[] = [
  { loggedOn: '2026-09-08', glasses: 4 },
  { loggedOn: '2026-09-10', glasses: 8 },
  { loggedOn: '2026-09-09', glasses: 6 },
];
eq(sortedWater(days).map((d) => d.loggedOn).join(','), '2026-09-10,2026-09-09,2026-09-08',
  'newest first, by string order — no Date is constructed and no timezone gets a vote');
eq(sortedWater([{ loggedOn: '10/09/2026', glasses: 4 }]).length, 0,
  'anything that is not a bare YYYY-MM-DD is not a day this screen will draw');

/* ── the marks ──────────────────────────────────────────────────────────── */

eq(qualityMarks(1), '●○○○○', 'the worst night on the picker still shows a mark');
eq(qualityMarks(5), '●●●●●', 'and the best shows five');
eq(qualityMarks(0), '●○○○○',
  'a zero cannot come from the screen and must never render as five empty marks, which look identical to "worst possible night"');

/* ── the sentences say the right things and withhold the right things ──── */

const named: Voice = { they: 'Sam', their: "Sam's", have: 'has' };
const unnamed: Voice = { they: 'They', their: 'their', have: 'have' };

ok(notSharedLine(named).includes('Sam'), 'the not-shared line names the person');
ok(/theirs to change/i.test(notSharedLine(named)), 'and says whose decision it is');
ok(/not something this screen can tell you/i.test(notSharedLine(named)),
  'and declines to say whether they have any — which is the half a coach is not entitled to infer');
ok(!/nothing|none|no sleep|empty/i.test(notSharedLine(named)),
  'a withheld record is never described as an empty one');

ok(/not a statement that there is nothing/i.test(unreadableLine(named)),
  'a failed read says out loud that it is not an absence');
ok(/could not be read/i.test(unreadableLine(named)), 'and says what actually happened');

ok(/no account/i.test(notAskedLine(named)), 'a hand-added client is described as having no account');
ok(!/could not be read|failed/i.test(notAskedLine(named)),
  'and never as a read that failed — no such read was ever entitled to run');

ok(nothingLoggedLine(named).includes('shared these'),
  'the empty case says the sharing is on, so the emptiness is about the logging');

// The verb travels with the subject. A client whose name has not arrived is
// "They have", never "They has" — the sentence this screen printed before the
// voice existed.
for (const line of [notSharedLine, unreadableLine, notAskedLine, nothingLoggedLine]) {
  ok(!/\bThey has\b/.test(line(unnamed)), 'no sentence says "They has"');
  ok(!/\bSam have\b/.test(line(named)), 'and none says "Sam have"');
}
ok(/most recent/i.test(truncatedLine('nights')), 'the truncated line says which end of the set is shown');
ok(/no average over it would be their average/i.test(truncatedLine('nights')),
  'and refuses the figure rather than printing one over a prefix');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachWellness: ok');
