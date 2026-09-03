"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for gymLink — the account with no gym, drawn as itself.
//
// The assertion that matters is the last one in each block: there is no shape
// this module can return that a screen could render as an empty month. It has
// no `rows` member and no state that means "read, found nothing", because the
// bug it exists to close was exactly that shape written by hand at three call
// sites.
//
// Compile with tsc, run with node.
const gymLink_1 = require("./gymLink");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
{
    const l = (0, gymLink_1.gymLink)('11111111-1111-4111-8111-111111111111', 'payments');
    eq(l.linked, true, 'a profile carrying a gym is linked');
    ok(l.linked && l.tenantId === '11111111-1111-4111-8111-111111111111', 'and hands the id back unchanged');
}
{
    for (const absent of [null, undefined, '', '   ']) {
        const l = (0, gymLink_1.gymLink)(absent, 'payments');
        eq(l.linked, false, `an id of ${JSON.stringify(absent)} is not a gym`);
        ok(!l.linked && l.note.length > 0, 'and comes back with a sentence to print instead of a figure');
        ok(!l.rows, 'and never with rows — an empty array here is the whole defect, read downstream as a month in which the gym did nothing');
    }
}
{
    // A blank id is refused rather than passed through. `tenant_id=eq.` matches
    // nothing and answers 200 with [], which is a successful empty read by
    // another route.
    const l = (0, gymLink_1.gymLink)('  ', 'invoices');
    ok(!l.linked, 'whitespace is not an id');
}
{
    const note = (0, gymLink_1.noGymNote)('payments');
    ok(note.includes('payments'), 'the sentence names what was not read, because it stands where a figure was');
    ok(note.includes(gymLink_1.NOT_A_QUIET_GYM), 'and carries the clause that separates the reader from the gym — without it the reader goes looking for their money');
    eq((0, gymLink_1.noGymNote)(''), (0, gymLink_1.noGymNote)('records'), 'an unnamed subject still produces a whole sentence rather than a gap');
    eq((0, gymLink_1.noGymNote)('   '), (0, gymLink_1.noGymNote)('records'), 'and so does a blank one');
}
if (errors.length) {
    console.error(`gymLink: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
    process.exit(1);
}
console.log('gymLink ok');
