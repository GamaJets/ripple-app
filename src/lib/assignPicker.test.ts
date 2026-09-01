// Tests for assignPicker — the two silent replacements that stand between a
// coach and the programme they just built.
//
// The defects these exist for:
//
//   · the builder replaced its own contents whenever the selected client
//     changed. The screen opens with nobody selected, so the coach's actual
//     sequence is build-then-pick, and that pick wiped the week they had just
//     laid out. The report was "when a coach builds a program they can not
//     assign it to their client", and this is why.
//   · a `clientId` left selected for somebody no longer on the roster made
//     `roster.find()` return undefined, which the builder mapped onto a FAILED
//     read of that person's injuries — so the screen said "No clients yet" and
//     "Injuries Could Not Be Read" at the same time, about nobody.
//
// The assertions are about CONTENT and about which BRANCH was taken — is the
// draft kept, is the disagreement said out loud, is the count there — rather
// than about exact wording, so a rewording is not a red test.
//
// Compile with tsc then run with node, like bulkActions.test.ts.
import { seedDecision, stillListed, pruneSelection, assignCtaLabel } from './assignPicker';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ALL: LoadStatus[] = ['loading', 'ready', 'partial', 'error'];

/* ── seedDecision: the coach's work is never replaced without being asked ──── */

// THE REPORTED BUG. A week laid out with nobody selected, then the client
// picked. Every status, because the old effect destroyed the draft under all
// four of them — 'ready' by loading their programme over it, and the other
// three by clearing it outright.
for (const status of ALL) {
  const d = seedDecision({
    programStatus: status, hasDraft: true, seededFor: null, clientId: 'c1', firstName: 'Priya',
  });
  eq(d.action, 'hold',
    `A DRAFT IS NEVER REPLACED BY PICKING A CLIENT (${status}) — this is the twenty minutes of work that disappeared at the exact gesture meant to send it`);
  ok(!!d.note && d.note.length > 20,
    `and the disagreement is SAID (${status}) — a builder showing one thing while another client's name is selected is the trap the screen's own header describes`);
  ok((d.note ?? '').includes('Priya'),
    `and the sentence names the client (${status}), because "this client" is not who the coach is looking at`);
}

// Under a whole read the replacement is offered as a control the coach taps.
{
  const d = seedDecision({
    programStatus: 'ready', hasDraft: true, seededFor: null, clientId: 'c1', firstName: 'Priya',
  });
  ok(!!d.replaceLabel, 'the coach is OFFERED the load rather than having it done to them');
  ok((d.replaceLabel ?? '').includes('Priya'), 'and the control names whose programme it would load');
  eq(/^[A-Z]/.test(d.replaceLabel ?? ''), true, 'buttons are Title Case, so it opens on a capital');
}

// And withheld when their programme could not be read: there is nothing to
// load, so offering to load it would be a control that cannot work.
for (const status of ['loading', 'partial', 'error'] as LoadStatus[]) {
  const d = seedDecision({
    programStatus: status, hasDraft: true, seededFor: null, clientId: 'c1', firstName: 'Priya',
  });
  eq(d.replaceLabel, null,
    `NO REPLACE CONTROL WHEN THERE IS NOTHING TO REPLACE IT WITH (${status}) — a button that loads an unread programme would load silence over real work`);
}

// Contents that came from this same client are not a disagreement, so there is
// nothing to say — and they are still not replaced, because the coach may have
// spent the last ten minutes editing them.
{
  const d = seedDecision({
    programStatus: 'ready', hasDraft: true, seededFor: 'c1', clientId: 'c1', firstName: 'Priya',
  });
  eq(d.action, 'hold', 'contents loaded from this client are left alone, edits and all');
  eq(d.note, null, 'and no disagreement is announced, because there is none');
  eq(d.replaceLabel, null, 'and nothing is offered to replace them with');
}

// An empty builder has nothing to lose, so the old behaviour is kept exactly:
// fill it from what they are on, or leave it empty when that is unknown.
{
  const ready = seedDecision({
    programStatus: 'ready', hasDraft: false, seededFor: null, clientId: 'c1', firstName: 'Priya',
  });
  eq(ready.action, 'seed', 'an empty builder still opens on what the client is currently on');
  eq(ready.note, null, 'silently, because nothing has been taken from anybody');
}
for (const status of ['loading', 'partial', 'error'] as LoadStatus[]) {
  eq(seedDecision({
    programStatus: status, hasDraft: false, seededFor: null, clientId: 'c1', firstName: 'Priya',
  }).action, 'clear',
    `AN UNREAD PROGRAMME LEAVES THE BUILDER EMPTY (${status}) — filling it with a generated plan and calling it theirs is what the overwrite guard exists to stop`);
}

// Nobody selected is not a state that says anything about anybody.
for (const status of ALL) {
  const d = seedDecision({
    programStatus: status, hasDraft: true, seededFor: null, clientId: '', firstName: 'This client',
  });
  eq(d.action, 'hold', `with no client picked the builder is untouched (${status})`);
  eq(d.note, null, `and says nothing about a client who is not selected (${status})`);
}

/* ── stillListed / pruneSelection: absent is not departed ──────────────────── */

eq(stillListed('ready', ['a', 'b'], 'a'), true, 'a client on a whole read is on the book');
eq(stillListed('ready', ['a', 'b'], 'z'), false,
  'and one who is NOT on a whole read has left it — which is what stops the screen reporting a departed client’s injuries as unreadable');
eq(stillListed('ready', [], ''), false, 'nobody is not somebody');

for (const status of ['loading', 'partial', 'error'] as LoadStatus[]) {
  eq(stillListed(status, [], 'z'), true,
    `ABSENT UNDER ${status.toUpperCase()} IS UNKNOWN, NOT GONE — the read did not finish or stopped at the row cap, and dropping the tick would silently unselect somebody the coach chose`);
}

eq(pruneSelection('ready', ['a', 'b', 'c'], ['a', 'z', 'c']).join(','), 'a,c',
  'a whole read drops the ticks that name nobody, in the order they were given');
eq(pruneSelection('error', ['a'], ['a', 'z']).join(','), 'a,z',
  'a failed read changes nothing — an empty roster under error means the read failed');
eq(pruneSelection('partial', [], ['a', 'z']).join(','), 'a,z',
  'and neither does a truncated one');
{
  const src = ['a'];
  const out = pruneSelection('error', [], src);
  ok(out !== src, 'the selection is copied rather than handed back, so a caller cannot mutate the argument');
}

/* ── assignCtaLabel: the button says what the tap does ─────────────────────── */

eq(assignCtaLabel({ busy: true, picked: 3, exercises: 9, planLabel: null, soleName: null }), 'Assigning…',
  'a write in flight says so before anything else');
{
  const l = assignCtaLabel({ busy: false, picked: 3, exercises: 0, planLabel: null, soleName: null });
  ok(/exercise/i.test(l),
    'AN EMPTY PROGRAMME IS SAID FIRST — there is nothing to assign to anybody, so that is the coach’s next move whoever is ticked');
}
{
  // Both true on a fresh screen, and the order is the order the coach hits
  // them: there is nothing to assign to anybody, so the programme is asked for
  // before the recipients are.
  const l = assignCtaLabel({ busy: false, picked: 0, exercises: 0, planLabel: null, soleName: null });
  ok(/exercise/i.test(l) && !/Pick Who/i.test(l),
    'THE EMPTY PROGRAMME OUTRANKS THE EMPTY SELECTION — asking who should receive nothing sends the coach to the wrong end of the screen');
}
eq(assignCtaLabel({ busy: false, picked: 0, exercises: 9, planLabel: null, soleName: null }), 'Pick Who Gets This',
  'with a programme built and nobody ticked, the button asks for the recipients');
eq(assignCtaLabel({ busy: false, picked: 0, exercises: 9, planLabel: 'Nobody In This Group Yet', soleName: null }),
  'Pick Who Gets This',
  'AND ASKS BEFORE THE FAN-OUT DOES — planFanOut answers an empty list in the Groups screen’s vocabulary, and this screen has no groups in it');
eq(assignCtaLabel({ busy: false, picked: 2, exercises: 9, planLabel: 'Read Their Injuries First', soleName: null }),
  'Read Their Injuries First',
  'a refusal from the fan-out is what the button carries, so the control names its own reason');
{
  const l = assignCtaLabel({ busy: false, picked: 1, exercises: 1, planLabel: null, soleName: 'Priya' });
  ok(l.includes('Priya'), 'one recipient is named, because that is who the tap writes over');
  ok(l.includes('1 exercise') && !l.includes('1 exercises'),
    'and the count is written in English — four counts on this screen once read "1 exercises"');
}
{
  const l = assignCtaLabel({ busy: false, picked: 4, exercises: 1200, planLabel: null, soleName: null });
  ok(l.includes('4'), 'several recipients are counted');
  ok(l.includes('1,200'), 'and figures over three digits carry a thousands separator');
}

if (errors.length) {
  console.error(`assignPicker.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('assignPicker.test.ts — ok');
