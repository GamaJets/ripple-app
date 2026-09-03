// Tests for gymLink — the account with no gym, drawn as itself.
//
// The assertion that matters is the last one in each block: there is no shape
// this module can return that a screen could render as an empty month. It has
// no `rows` member and no state that means "read, found nothing", because the
// bug it exists to close was exactly that shape written by hand at three call
// sites.
//
// Compile with tsc, run with node.
import { gymLink, noGymNote, NOT_A_QUIET_GYM } from './gymLink';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

{
  const l = gymLink('11111111-1111-4111-8111-111111111111', 'payments');
  eq(l.linked, true, 'a profile carrying a gym is linked');
  ok(l.linked && l.tenantId === '11111111-1111-4111-8111-111111111111', 'and hands the id back unchanged');
}

{
  for (const absent of [null, undefined, '', '   ']) {
    const l = gymLink(absent, 'payments');
    eq(l.linked, false, `an id of ${JSON.stringify(absent)} is not a gym`);
    ok(!l.linked && l.note.length > 0, 'and comes back with a sentence to print instead of a figure');
    ok(!(l as unknown as { rows?: unknown }).rows,
      'and never with rows — an empty array here is the whole defect, read downstream as a month in which the gym did nothing');
  }
}

{
  // A blank id is refused rather than passed through. `tenant_id=eq.` matches
  // nothing and answers 200 with [], which is a successful empty read by
  // another route.
  const l = gymLink('  ', 'invoices');
  ok(!l.linked, 'whitespace is not an id');
}

{
  const note = noGymNote('payments');
  ok(note.includes('payments'), 'the sentence names what was not read, because it stands where a figure was');
  ok(note.includes(NOT_A_QUIET_GYM),
    'and carries the clause that separates the reader from the gym — without it the reader goes looking for their money');
  eq(noGymNote(''), noGymNote('records'), 'an unnamed subject still produces a whole sentence rather than a gap');
  eq(noGymNote('   '), noGymNote('records'), 'and so does a blank one');
}

if (errors.length) {
  console.error(`gymLink: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymLink ok');
