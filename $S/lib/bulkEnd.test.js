"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Ending the coaching for many people at once. Compile with tsc, run with node.
//
// This is the most destructive control in the coach app: forty irreversible
// acts behind one tap, and the two halves of the set lose different things. A
// hand-added client's row is DELETED, with the name and goal the coach typed;
// a linked client keeps their account and everything in it, is told the
// coaching ended, and permanently loses every progress photo they shared —
// supabase/parts/47 deletes the grants rather than flagging them, and re-joining
// does not hand them back.
//
// Three things these hold shut:
//
//   1. THE COUNT IS IN FRONT OF THE COACH before anything happens — in the
//      heading and on the button, which is the sentence they remember
//      afterwards. "Remove" on its own beside a segment chip is how somebody
//      removes a book they thought was a filter;
//   2. the two costs are described SEPARATELY, because they fall on two
//      different populations and a dialog that describes one describes the
//      wrong thing for half the set;
//   3. nothing anywhere says "Done" over a partial failure. `bulkReport` has no
//      such sentence and the failures come back named and still selected.
const bulkActions_1 = require("./bulkActions");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const linked = (name) => ({ clientId: `id-${name}`, name, handAdded: false });
const hand = (name) => ({ clientId: `id-${name}`, name, handAdded: true });
/* ── the count is in front of them ─────────────────────────────────────── */
const forty = Array.from({ length: 40 }, (_, i) => linked(`Client${i}`));
const big = (0, bulkActions_1.endCoachingBrief)(forty);
ok(big.title.includes('40'), 'the count is in the heading');
ok(big.confirmLabel.includes('40'), 'and on the destructive button');
ok(big.body.includes('40'), 'and in the body');
// Named, capped, and the remainder COUNTED — never a bare truncation. A coach
// reading "Ana, Ben, Cara" for a set of forty relaxes.
ok(/34 more/.test(big.body), 'past the naming limit the remainder is counted rather than elided');
eq(big.replacing.length, 40, 'every one of them is marked, so the caller styles the button destructive');
/* ── the two costs, described separately ───────────────────────────────── */
const mixed = (0, bulkActions_1.endCoachingBrief)([linked('Ana'), linked('Ben'), hand('Cara')]);
ok(/photo/i.test(mixed.body), 'the linked half is told about the progress photos, which is the part re-joining does not undo');
ok(/cannot be undone/i.test(mixed.body), 'and that it cannot be undone');
ok(/added by hand/i.test(mixed.body), 'the hand-added half is told their row is deleted');
ok(/Cara/.test(mixed.body), 'and named, so the coach can see which one it is');
ok(/account/i.test(mixed.body), 'and the linked half is told they keep their account, which is the fear');
// A set with no hand-added clients says nothing about deleted rows, and a set
// with no linked clients says nothing about photographs. Raising an alarm that
// does not apply is how a coach learns to tap through the dialog that mattered.
const allLinked = (0, bulkActions_1.endCoachingBrief)([linked('Ana'), linked('Ben')]);
ok(!/added by hand/i.test(allLinked.body), 'no hand-added clients, no sentence about deleted rows');
const allHand = (0, bulkActions_1.endCoachingBrief)([hand('Ana'), hand('Ben')]);
ok(!/photo/i.test(allHand.body), 'no linked clients, no sentence about photographs');
ok(!/keeps? their account/i.test(allHand.body), 'nor about keeping an account nobody has');
ok(/no account behind them/i.test(allHand.body), 'it says the opposite, which is why the row is a delete');
/* ── one person is still a sentence ────────────────────────────────────── */
const one = (0, bulkActions_1.endCoachingBrief)([linked('Ana')]);
ok(/Ana/.test(one.body), 'a single removal names them');
ok(!/All 1|all 1/.test(one.title + one.confirmLabel), 'and never reads "All 1"');
ok(!/\b1 clients\b/.test(one.title + one.body + one.confirmLabel), 'nor "1 clients"');
/* ── nobody ticked ─────────────────────────────────────────────────────── */
const empty = (0, bulkActions_1.endCoachingBrief)([]);
eq(empty.confirmLabel, 'OK', 'an empty selection offers no destructive confirm');
eq(empty.replacing.length, 0, 'and nothing to style destructive');
ok(/nobody|nothing/i.test(empty.body), 'and says why');
/* ── what happened, per client ─────────────────────────────────────────── */
const okRow = (name) => ({ clientId: `id-${name}`, name, ok: true, why: null });
const badRow = (name, why) => ({ clientId: `id-${name}`, name, ok: false, why });
const all = (0, bulkActions_1.bulkReport)('end', [okRow('Ana'), okRow('Ben')]);
eq(all.retry.length, 0, 'everything landed, nothing to retry');
ok(/Ana/.test(all.body) && /Ben/.test(all.body), 'and both are named so the coach knows not to redo them');
ok(/told/i.test(all.body), 'the report says the clients were told, which is the half the coach cannot see afterwards');
ok(!/^Done$/.test(all.title), 'and "Done" is never the whole of it');
const nothing = (0, bulkActions_1.bulkReport)('end', [badRow('Ana', 'the server refused it.'), badRow('Ben', 'the server refused it.')]);
eq(nothing.title, 'Nobody Was Removed', 'nothing landing is said plainly');
eq(nothing.retry.length, 2, 'and both stay selected, so trying again is the same gesture');
ok(/nothing has changed/i.test(nothing.body), 'a coach who thinks a failed removal half-landed has to check everybody by hand');
const part = (0, bulkActions_1.bulkReport)('end', [okRow('Ana'), badRow('Ben', 'the server refused it.')]);
eq(part.title, 'Partly Removed', 'a partial run is neither of the other two');
eq(part.retry.join(','), 'id-Ben', 'exactly the failure is left selected');
ok(/Ana/.test(part.body), 'the one that landed is named');
ok(/Ben/.test(part.body), 'and so is the one that did not');
ok(!/^Removed$/.test(part.title), 'and the title does not claim the whole set');
/* ── a wall of forty identical reasons becomes one ─────────────────────── */
const many = (0, bulkActions_1.bulkReport)('end', Array.from({ length: 12 }, (_, i) => badRow(`C${i}`, 'the server refused it.')));
eq(many.retry.length, 12, 'all twelve stay selected');
ok(/C0/.test(many.body) && /C11/.test(many.body), 'every name is listed, because the names are what a coach acts on');
eq((many.body.match(/the server refused it\./g) ?? []).length, 1, 'and the reason is stated once, because forty identical sentences is a wall nobody reads');
/* ── the naming helper ─────────────────────────────────────────────────── */
eq((0, bulkActions_1.namesWithRest)(['Ana']), 'Ana', 'one name is a name');
ok(/and/.test((0, bulkActions_1.namesWithRest)(['Ana', 'Ben'])), 'two are joined');
ok(/and 1 more/.test((0, bulkActions_1.namesWithRest)(['A', 'B', 'C', 'D', 'E', 'F', 'G'])), 'past the limit the remainder is counted — a truncation that just stops is false in the direction that makes a coach relax');
if (errors.length) {
    for (const e of errors)
        console.error('  ✗ ' + e);
    console.error(`bulkEnd: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    process.exit(1);
}
console.log('bulkEnd: ok (the count is on the button, the two costs are separate, and nothing says "done" over a partial failure)');
