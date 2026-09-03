"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hydrationHero_1 = require("./hydrationHero");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const ALL = ['loading', 'ready', 'partial', 'error'];
/* ── the first frame ─────────────────────────────────────────────────────── */
{
    // Both providers start at their empty value: water 0, goal null.
    const n = (0, hydrationHero_1.hydrationNote)('loading', 'loading', 0, null);
    eq(n.kind, 'loading', 'A READ IN FLIGHT IS NOT "YOU HAVE DRUNK NOTHING AND SET NO GOAL"');
    eq(n.showCount, false, 'so no figure is printed');
    eq(n.showRing, false, 'and no ring is filled');
    eq(n.offerGoal, false, 'AND THE HERO IS NOT A LINK TO GO AND SET THE GOAL THEY ALREADY HAVE');
    ok(!/No daily goal set/.test(n.text), 'and it does not say they have no goal');
    // Either half still in flight is enough.
    for (const s of ALL) {
        eq((0, hydrationHero_1.hydrationNote)('loading', s, 6, 8).kind, 'loading', `the count still landing is loading (${s})`);
        eq((0, hydrationHero_1.hydrationNote)(s, 'loading', 6, 8).kind, 'loading', `and so is the goal still landing (${s})`);
    }
}
/* ── the two failures are two sentences, and neither is "empty" ──────────── */
{
    for (const s of ['error', 'partial']) {
        const c = (0, hydrationHero_1.hydrationNote)(s, 'ready', 6, 8);
        eq(c.kind, 'countUnread', `a failed count read says the count could not be checked (${s})`);
        eq(c.showCount, true, 'the tally on this phone is real and stays on screen');
        eq(c.showRing, false, 'but it is not filled against a goal it may be short of');
        eq(c.offerGoal, false, 'and nothing invites them anywhere');
        const g = (0, hydrationHero_1.hydrationNote)('ready', s, 6, null);
        eq(g.kind, 'goalUnread', `A FAILED GOAL READ IS NEVER DRAWN AS "NO GOAL SET" (${s})`);
        eq(g.offerGoal, false, 'and never offers the shortcut to set one');
        eq(g.showRing, false, 'and a percentage of an unread goal is not a percentage');
        ok(/not the same as not having set one/.test(g.text), 'and it says which of the two it is');
    }
    // A goal that DID come back is still not usable if the count did not.
    eq((0, hydrationHero_1.hydrationNote)('error', 'ready', 6, 8).showRing, false, 'the ring needs both halves');
}
/* ── and when both landed ────────────────────────────────────────────────── */
{
    const none = (0, hydrationHero_1.hydrationNote)('ready', 'ready', 3, null);
    eq(none.kind, 'noGoal', 'both read, and there really is no goal');
    eq(none.offerGoal, true, 'THE ONE STATE THAT MAY OFFER THE SHORTCUT');
    const met = (0, hydrationHero_1.hydrationNote)('ready', 'ready', 8, 8);
    eq(met.kind, 'met', 'eight of eight is met');
    eq(met.showRing, true, 'and the ring may fill');
    eq((0, hydrationHero_1.hydrationNote)('ready', 'ready', 9, 8).kind, 'met', 'and so is nine of eight');
    const to = (0, hydrationHero_1.hydrationNote)('ready', 'ready', 6, 8);
    eq(to.kind, 'toGo', 'six of eight is two to go');
    eq(to.text, '2 more to hit today’s goal.', 'and it says two');
    eq((0, hydrationHero_1.hydrationNote)('ready', 'ready', 0, 8).text, '8 more to hit today’s goal.', 'a genuinely empty day is a true zero, and may be said');
}
/* ── no two sentences are the same ───────────────────────────────────────── */
{
    const said = new Set([
        (0, hydrationHero_1.hydrationNote)('loading', 'loading', 0, null).text,
        (0, hydrationHero_1.hydrationNote)('error', 'ready', 0, null).text,
        (0, hydrationHero_1.hydrationNote)('ready', 'error', 0, null).text,
        (0, hydrationHero_1.hydrationNote)('ready', 'ready', 0, null).text,
    ]);
    eq(said.size, 4, 'loading, count-failed, goal-failed and empty are four different sentences');
}
if (errors.length) {
    console.error(`hydrationHero: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  ✗ ${e}`);
    process.exit(1);
}
console.log('hydrationHero: ok — the first frame no longer says you have drunk nothing');
