// Giving the same lines to twelve people without giving anybody the same line
// twice.
// Compile with tsc, run with node.
//
// The assertion this file is really about: an empty list of what somebody
// already has, arriving from a read that failed, would make every line look new
// — and a duplicate on a client's daily list has no undo the client can reach.
// So the guard is asserted before anything else.
import {
  planChecklistCopy, guardChecklistCopy, copyBrief, copyPreview, normaliseLabel,
  type CopyLine, type CopyTarget,
} from './checklistCopy';
import { bulkReport } from './bulkActions';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const L = (label: string, icon = ''): CopyLine => ({ label, icon });
const T = (clientId: string, name: string, existing: string[] = [], maxSort = 0): CopyTarget =>
  ({ clientId, name, existing, maxSort });

/* ── THE GUARD ─────────────────────────────────────────────────────────── */

ok(guardChecklistCopy('ready', 'ready').allowed, 'two whole reads allow the copy');
// Every one of these would produce duplicates, silently, on somebody's morning.
for (const bad of ['loading', 'partial', 'error'] as const) {
  const g = guardChecklistCopy('ready', bad);
  ok(!g.allowed, `a '${bad}' read of what they already have holds the copy`);
  ok(!!g.reason, `and says why under '${bad}'`);
  ok(!!g.label, `with something to put on the withheld control under '${bad}'`);
}
ok(!guardChecklistCopy('partial', 'ready').allowed,
  'a truncated roster holds it too — the people past the cap are people');
ok(/twice|second time/i.test(guardChecklistCopy('ready', 'error').reason ?? ''),
  'the refusal names the actual consequence, which is a line arriving twice');
ok(/ticks/i.test(guardChecklistCopy('ready', 'partial').reason ?? ''),
  'and that removing a duplicate takes the client’s ticks with it, which is why this is not a warning');

/* ── matching ──────────────────────────────────────────────────────────── */

eq(normaliseLabel('  Ten  minutes of MOBILITY '), 'ten minutes of mobility',
  'the key is trimmed, collapsed and case-folded');
// Deliberately blunt. Two differently-worded lines are two lines, and an app
// that decided otherwise would drop one the coach meant to send.
ok(normaliseLabel('Water on waking') !== normaliseLabel('Drink water when you wake up'),
  'two wordings are two lines — the matcher does not guess at meaning');

/* ── the plan ──────────────────────────────────────────────────────────── */

const lines = [L('Protein at breakfast', '🥚'), L('Ten minutes of mobility'), L('Water on waking')];

const plain = planChecklistCopy(lines, [T('a', 'Ana'), T('b', 'Ben')]);
eq(plain.writes, 6, 'three lines onto two people is six writes');
eq(plain.changed.length, 2, 'both are changed');
eq(plain.unchanged.length, 0, 'and neither is skipped');
eq(plain.targets[0].add[0].icon, '🥚', 'the icon travels — a line without it is a different line on their screen');

// Appended, never inserted at the top: the order is the coach's and the client
// has been reading the list in the same shape every morning.
const appended = planChecklistCopy(lines, [T('a', 'Ana', [], 7)]);
eq(appended.targets[0].add.map((l) => l.sort).join(','), '8,9,10', 'copied lines append past what is already there');

const dedup = planChecklistCopy(lines, [T('a', 'Ana', ['  protein AT breakfast '])]);
eq(dedup.targets[0].add.length, 2, 'a line they already have is not added again');
eq(dedup.targets[0].alreadyThere.length, 1, 'and is reported as already there rather than silently dropped');

// Everybody stays in `targets`, including the people who get nothing — a plan
// that dropped them would make the button disagree with the number ticked.
const someSkipped = planChecklistCopy(lines, [
  T('a', 'Ana'),
  T('b', 'Ben', ['Protein at breakfast', 'Ten minutes of mobility', 'Water on waking']),
]);
eq(someSkipped.targets.length, 2, 'a client who gets nothing is still in the plan');
eq(someSkipped.changed.length, 1, 'but is not counted among the changed');
eq(someSkipped.unchanged[0].name, 'Ben', 'and is named, because that is the half the coach most needs told');
eq(someSkipped.writes, 3, 'the write count is lines, not people');

// The source list can itself hold the same words twice; that must not become
// two copies on everybody else.
const doubled = planChecklistCopy([L('Water'), L('water ')], [T('a', 'Ana')]);
eq(doubled.writes, 1, 'a line repeated in the source is copied once');

/* ── what the coach reads ──────────────────────────────────────────────── */

const brief = copyBrief(someSkipped, 'Cara');
ok(brief.actionable, 'a plan with writes in it is a question');
ok(/Cara/.test(brief.body), 'the brief names whose list is being copied');
ok(/cannot tick them|stays with you/i.test(brief.body),
  'and that the client cannot remove them, which is what makes this different from a message');
ok(/nobody is told|Nobody is told/.test(brief.body),
  'and that nothing is sent — a coach expecting a notification will follow up on a conversation that never happened');
ok(/Ben/.test(brief.body), 'and names who gets nothing');

const nothing = copyBrief(planChecklistCopy(lines, [T('b', 'Ben', lines.map((l) => l.label))]), 'Cara');
ok(!nothing.actionable, 'a plan with nothing to write is an explanation, not a question');
eq(nothing.confirmLabel, 'OK', 'and offers no destructive-looking button');

const none = copyBrief(planChecklistCopy(lines, []), 'Cara');
ok(!none.actionable, 'nobody ticked is not an action either');

const preview = copyPreview(someSkipped);
ok(preview !== null && /3 lines/.test(preview), 'the preview counts lines');
ok(preview !== null && /1 client/.test(preview), 'and people, because "12" beside a tick list says neither');

/* ── the report ────────────────────────────────────────────────────────── */

const partly = bulkReport('checklist', [
  { clientId: 'a', name: 'Ana', ok: true, why: null },
  { clientId: 'b', name: 'Ben', ok: false, why: 'they are no longer your client.' },
]);
eq(partly.title, 'Partly Copied', 'a half-landed copy is never reported as done');
eq(partly.retry.join(','), 'b', 'and the one that failed is handed back to stay selected');
ok(/tomorrow morning/i.test(partly.body),
  'the success half says when the lines appear, because nothing is sent and nobody is told');
ok(/Nobody was notified/i.test(partly.body), 'in as many words');

const allBad = bulkReport('checklist', [{ clientId: 'a', name: 'Ana', ok: false, why: 'refused.' }]);
eq(allBad.title, 'Nothing Was Copied', 'and a total failure says nothing changed rather than nothing about it');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`checklistCopy: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('checklistCopy: ok (a read that did not answer holds the copy, and nobody gets a line twice)');
