// The release of liability a client agrees to before they train, and the one
// rule that decides whether they have. Compile with tsc, run with node.
//
// The assertion that matters most here is the one about an unreadable record.
// A failed read of `liability_waivers` is not evidence that somebody signed,
// and it is not evidence that they didn't — and this gate is on the wrong side
// of a legal record if it ever treats it as either.
import { waiverState, bothGiven, WAIVER_VERSION, WAIVER_CLAUSES } from './waiver';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// Still reading is its own answer, distinct from both outcomes.
eq(waiverState(null), 'loading', 'a read in flight says so');

// A failed read must not pass for a signed release — nor for an unsigned one.
eq(waiverState({ ok: false, versions: [] }), 'unknown', 'an unreadable record is not an unsigned one');
eq(waiverState({ ok: false, versions: [WAIVER_VERSION] }), 'unknown',
  'rows returned alongside an error are not a signed release either');

// A read that completed and came back empty is a real "they have not signed".
eq(waiverState({ ok: true, versions: [] }), 'needed', 'a completed empty read is an unsigned release');
eq(waiverState({ ok: true, versions: [WAIVER_VERSION] }), 'accepted', 'the current wording, agreed');

// Agreeing to older wording is not agreeing to this wording.
eq(waiverState({ ok: true, versions: ['1999-01-01'] }), 'needed', 'superseded wording does not carry over');
eq(waiverState({ ok: true, versions: ['1999-01-01', WAIVER_VERSION] }), 'accepted',
  'an older acceptance alongside the current one still counts');

// Both boxes, or it is not a release.
eq(bothGiven({}), false, 'nothing ticked is not agreement');
eq(bothGiven({ physician: true, release: true }), true, 'both ticked is agreement');

// Every clause is genuinely required. Adding a third clause without extending
// the gate fails here rather than shipping a waiver with an optional term.
for (const c of WAIVER_CLAUSES) {
  const all: Record<string, boolean> = {};
  for (const o of WAIVER_CLAUSES) all[o.key] = true;
  all[c.key] = false;
  eq(bothGiven(all), false, `"${c.key}" is required`);
}

// The two things the client asked for are actually in the wording, on the
// record the client signs — not merely in a heading above it.
ok(WAIVER_CLAUSES.some((c) => /physician|doctor/i.test(c.label + c.detail)),
  'the release tells them to consult a physician first');
ok(WAIVER_CLAUSES.some((c) => /release|liabilit/i.test(c.label + c.detail)),
  'the release actually releases liability');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`waiver: ok (${WAIVER_CLAUSES.length} clauses, version ${WAIVER_VERSION})`);
