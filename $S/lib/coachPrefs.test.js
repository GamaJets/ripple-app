"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The coach's own numbers, and the three sentences that go with them.
// Compile with tsc, run with node.
//
// What is defended here is a set of figures that would all look perfectly
// ordinary on a coach's phone while being false about their pay:
//
// 1. A half-typed rate is not a rate of zero. The box saves as the coach types,
//    so "12." exists on its way to "12.50", and a parser that answered 0 for it
//    would replace a stored rate with nothing, silently, mid-keystroke.
//
// 2. An empty box IS an instruction — unset it — and has to be told apart from
//    the half-typed case, because one is saved and the other must not be.
//
// 3. A pay estimate with no check-in count is null, not 0. The screen used to
//    print "25 × 0 checked in = 0" when the roster could not be read: a payout
//    figure for a class it never managed to look at.
//
// 4. An empty goals section says something different when the read FAILED than
//    when there are genuinely no targets. The first version said "No targets
//    set" either way, which invites a coach to type their targets in again over
//    the top of the ones already stored.
//
// Nothing here formats a currency, and nothing here should ever start to. The
// rate is a bare number the coach types about a payment Repple does not make.
const coachPrefs_1 = require("./coachPrefs");
const interventions_1 = require("./interventions");
const nudge_1 = require("./nudge");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** The parsed rate, or null for the two answers that are not a number. Written
 *  once rather than inline, because TypeScript will not narrow a union across
 *  two separate calls to the same function. */
const rateValue = (text) => {
    const r = (0, coachPrefs_1.parseRate)(text);
    return r.kind === 'value' ? r.value : null;
};
/* ── reading a typed rate ─────────────────────────────────────────────────── */
eq((0, coachPrefs_1.parseRate)('25').kind, 'value', 'a whole number is a rate');
eq(rateValue('25'), 25, 'and it is that number');
eq(rateValue('37.5'), 37.5, 'a decimal rate is kept');
eq(rateValue('  40  '), 40, 'surrounding space is trimmed');
eq(rateValue('0'), 0, 'zero is a rate somebody may deliberately set — an unpaid class');
// The comma keyboard. Number('12,5') is NaN, so without this a coach on a
// German keyboard has a rate the app calls invalid every time they type it.
eq(rateValue('12,5'), 12.5, 'one comma is a decimal point');
eq((0, coachPrefs_1.parseRate)('1,234,5').kind, 'invalid', 'two commas are a thousands separator or a slip, and guessing which would invent a figure');
// The empty box is an instruction and is saved as NULL.
eq((0, coachPrefs_1.parseRate)('').kind, 'empty', 'an empty box means unset my rate');
eq((0, coachPrefs_1.parseRate)('   ').kind, 'empty', 'so does a box of spaces');
// The half-typed and the mistyped are NOT instructions. Every one of these is
// something parseFloat would have turned into a number.
eq((0, coachPrefs_1.parseRate)('12.').kind, 'invalid', 'a rate mid-keystroke is not yet a rate — parseFloat says 12');
eq((0, coachPrefs_1.parseRate)('.').kind, 'invalid', 'a lone decimal point is not a number');
eq((0, coachPrefs_1.parseRate)('12abc').kind, 'invalid', 'a typo is not a rate — parseFloat says 12');
eq((0, coachPrefs_1.parseRate)('abc').kind, 'invalid', 'nor is a word');
eq((0, coachPrefs_1.parseRate)('-5').kind, 'invalid', 'a negative rate is not a rate');
eq((0, coachPrefs_1.parseRate)('1e3').kind, 'invalid', 'exponent notation is a slip on a numeric keypad, not 1000');
eq((0, coachPrefs_1.parseRate)('Infinity').kind, 'invalid', 'Infinity is not a rate');
// All digits, so it passes the shape check — and Number() makes it Infinity.
eq((0, coachPrefs_1.parseRate)('9'.repeat(400)).kind, 'invalid', 'a rate too large to be a number is not a rate');
eq((0, coachPrefs_1.parseRate)('NaN').kind, 'invalid', 'nor is NaN');
/* ── a stored rate back into the box ──────────────────────────────────────── */
eq((0, coachPrefs_1.rateText)(37.5), '37.5', 'a stored rate fills the box');
eq((0, coachPrefs_1.rateText)(37.50), '37.5', 'the trailing zero numeric(12,2) adds back is dropped');
eq((0, coachPrefs_1.rateText)(0), '0', 'a deliberate zero rate is shown as zero');
eq((0, coachPrefs_1.rateText)(null), '', 'no rate set is an EMPTY box — not "0", which would read as a rate of nothing');
eq((0, coachPrefs_1.rateText)(undefined), '', 'and neither is it the word undefined');
eq((0, coachPrefs_1.rateText)(Number.NaN), '', 'a corrupt value shows as empty rather than as "NaN"');
// The round trip a coach performs every time they open the screen.
eq(rateValue((0, coachPrefs_1.rateText)(37.5)), 37.5, 'store → box → store does not drift');
/* ── the pay estimate ─────────────────────────────────────────────────────── */
eq((0, coachPrefs_1.payEstimate)(25, 8), 200, 'rate times heads through the door');
eq((0, coachPrefs_1.payEstimate)(37.5, 3), 113, 'the estimate is rounded to a whole unit');
eq((0, coachPrefs_1.payEstimate)(25, 0), 0, 'a class nobody came to really is zero, and may be said');
// The line the screen used to print over an unread roster.
eq((0, coachPrefs_1.payEstimate)(25, null), null, 'no check-in count means NO estimate — "25 × 0 = 0" is a payout for a class nobody looked at');
eq((0, coachPrefs_1.payEstimate)(null, 8), null, 'no rate means no estimate either');
eq((0, coachPrefs_1.payEstimate)(null, null), null, 'neither half known is certainly no estimate');
eq((0, coachPrefs_1.payEstimate)(Number.NaN, 8), null, 'a NaN rate produces nothing rather than "NaN"');
/* ── goals ────────────────────────────────────────────────────────────────── */
eq((0, coachPrefs_1.parseGoal)('4000'), 4000, 'a typed target is that number');
eq((0, coachPrefs_1.parseGoal)(''), 0, 'an empty target box is no target');
eq((0, coachPrefs_1.parseGoal)('abc'), 0, 'so is a word');
eq((0, coachPrefs_1.parseGoal)('40.5'), 0, 'a fractional client target is not a target');
eq((0, coachPrefs_1.parseGoal)('-12'), 0, 'a negative target is not a target — parseInt would have said -12');
eq((0, coachPrefs_1.parseGoal)('12abc'), 0, 'a typo is not a target — parseInt would have said 12');
eq((0, coachPrefs_1.parseGoal)('0'), 0, 'zero is how "no target" is stored');
eq((0, coachPrefs_1.parseGoal)('1'), 1, 'a target of one client is a target');
// Twenty digits is past Number.MAX_SAFE_INTEGER: the last digits are gone by
// the time it is a float, so it is not the number that was typed.
eq((0, coachPrefs_1.parseGoal)('99999999999999999999'), 0, 'a target too large to represent exactly is refused, not rounded');
eq((0, coachPrefs_1.goalText)(4000), '4000', 'a set target fills its box');
eq((0, coachPrefs_1.goalText)(1), '1', 'a target of one is set, and shows');
eq((0, coachPrefs_1.goalText)(0), '', 'an unset target is an EMPTY box — String(0) would read as a target of nothing');
eq((0, coachPrefs_1.goalPct)(2000, 4000), 0.5, 'halfway is a half');
eq((0, coachPrefs_1.goalPct)(4000, 4000), 1, 'reaching it is one');
eq((0, coachPrefs_1.goalPct)(9000, 4000), 1, 'beating it is clamped to one — the bar cannot overflow its track');
eq((0, coachPrefs_1.goalPct)(-5, 4000), 0, 'a negative figure is clamped to zero rather than drawn backwards');
eq((0, coachPrefs_1.goalPct)(2000, 0), 0, 'no target is no progress — never a division by zero');
eq((0, coachPrefs_1.goalPct)(1, 1), 1, 'a target of one is a real target and is divided by');
/* ── the two sentences that must not be the same ──────────────────────────── */
// A read that failed and a coach with no targets both arrive as {0, 0}.
const errLine = (0, coachPrefs_1.goalsEmptyLine)('error', 0, 0);
const readyLine = (0, coachPrefs_1.goalsEmptyLine)('ready', 0, 0);
const loadingLine = (0, coachPrefs_1.goalsEmptyLine)('loading', 0, 0);
ok(typeof errLine === 'string' && typeof readyLine === 'string', 'both states say something');
ok(errLine !== readyLine, 'a failed read must NOT say "No targets set" — that is the app telling a coach something false about themselves');
ok(loadingLine !== readyLine, 'and a read still in flight is a third thing again');
ok(!/no targets set/i.test(String(errLine)), 'the error sentence does not claim there are no targets');
ok(/could not be read/i.test(String(errLine)), 'it says the read failed, which is the only thing that is known');
ok(/no targets set/i.test(String(readyLine)), 'and a genuine empty under ready does say so plainly');
// With a target set there is nothing to explain — the bars speak.
eq((0, coachPrefs_1.goalsEmptyLine)('ready', 4000, 0), null, 'a revenue target set means no empty-state line');
eq((0, coachPrefs_1.goalsEmptyLine)('ready', 0, 12), null, 'a client target set means the same');
eq((0, coachPrefs_1.goalsEmptyLine)('ready', 1, 0), null, 'a revenue target of one is still a target set');
eq((0, coachPrefs_1.goalsEmptyLine)('ready', 0, 1), null, 'and so is a single-client target');
eq((0, coachPrefs_1.goalsEmptyLine)('error', 4000, 0), null, 'a target that DID come back is drawn, and the empty-state line stays out of its way');
// Same rule for the rate box.
const rateErr = (0, coachPrefs_1.rateFieldNote)('error');
eq((0, coachPrefs_1.rateFieldNote)('ready'), null, 'a clean read needs no explanation under the box');
ok(typeof rateErr === 'string' && /could not be read/i.test(rateErr), 'an empty box after a failed read says why it is empty');
ok((0, coachPrefs_1.rateFieldNote)('loading') !== rateErr, 'still reading is not the same as could not read');
for (const s of ['loading', 'error']) {
    ok((0, coachPrefs_1.rateFieldNote)(s) !== null, `${s} gets a sentence rather than a bare empty box`);
}
/* ── the coach's own nudge cooldown ─────────────────────────────────────── */
// The same three-way answer the rate box gives, and for the same reason: a
// half-typed "1" on its way to "14" must not be saved as one day, which would
// turn the whole quiet list into a daily prompt for every client the coach has.
eq((0, coachPrefs_1.parseCooldown)('').kind, 'empty', 'an empty box asks for the app’s own pacing back');
eq((0, coachPrefs_1.parseCooldown)('   ').kind, 'empty', 'and so does whitespace');
const fourteen = (0, coachPrefs_1.parseCooldown)('14');
eq(fourteen.kind, 'value', 'a whole number of days is a value');
eq(fourteen.kind === 'value' ? fourteen.value : null, 14, 'and it is the number typed');
eq((0, coachPrefs_1.parseCooldown)('0').kind, 'invalid', 'zero days is refused — that is a prompt every morning');
eq((0, coachPrefs_1.parseCooldown)('-3').kind, 'invalid', 'and so is a negative');
eq((0, coachPrefs_1.parseCooldown)('7.5').kind, 'invalid', 'there is no half a day between two phone calls');
eq((0, coachPrefs_1.parseCooldown)('14abc').kind, 'invalid', 'parseInt would have taken the 14 out of this');
eq((0, coachPrefs_1.parseCooldown)('1e3').kind, 'invalid', 'and Number would have made a thousand of this');
eq((0, coachPrefs_1.parseCooldown)(String(coachPrefs_1.MAX_NUDGE_COOLDOWN)).kind, 'value', 'a year is allowed');
eq((0, coachPrefs_1.parseCooldown)(String(coachPrefs_1.MAX_NUDGE_COOLDOWN + 1)).kind, 'invalid', 'more than a year is not');
eq((0, coachPrefs_1.parseCooldown)(String(coachPrefs_1.MIN_NUDGE_COOLDOWN)).kind, 'value', 'and one day is the floor');
eq((0, coachPrefs_1.cooldownText)(null), '', 'no preference is an empty box, never the digit zero');
eq((0, coachPrefs_1.cooldownText)(undefined), '', 'and so is nothing at all');
eq((0, coachPrefs_1.cooldownText)(21), '21', 'a stored window round-trips');
const round = (0, coachPrefs_1.parseCooldown)((0, coachPrefs_1.cooldownText)(30));
eq(round.kind === 'value' ? round.value : null, 30, 'and survives the round trip through the box');
// Two different states with the same behaviour, and a coach who cannot tell
// them apart cannot decide whether to change anything.
ok((0, coachPrefs_1.cooldownNote)(null) !== (0, coachPrefs_1.cooldownNote)(7), 'unset and set-to-seven read differently');
ok(/never closer than a week/i.test((0, coachPrefs_1.cooldownNote)(null)), 'unset says what the app does instead');
ok(/14 days/.test((0, coachPrefs_1.cooldownNote)(14)), 'and a set one states the number');
ok(/1 day\b/.test((0, coachPrefs_1.cooldownNote)(1)) && !/1 days/.test((0, coachPrefs_1.cooldownNote)(1)), 'one day is singular');
/* ── and what the number actually does ──────────────────────────────────── */
// The refusal. Anything outside the range falls back to the module's own floor
// rather than being clamped — clamping would invent a number the coach never
// chose and then pace their whole book off it.
eq((0, interventions_1.cooldownFloor)(null), interventions_1.MIN_COOLDOWN_DAYS, 'no preference is the module’s own floor');
eq((0, interventions_1.cooldownFloor)({ minCooldownDays: null }), interventions_1.MIN_COOLDOWN_DAYS, 'and so is an explicit null');
eq((0, interventions_1.cooldownFloor)({ minCooldownDays: 0 }), interventions_1.MIN_COOLDOWN_DAYS, 'a zero is refused, not honoured');
eq((0, interventions_1.cooldownFloor)({ minCooldownDays: 100000 }), interventions_1.MIN_COOLDOWN_DAYS, 'and so is three centuries');
eq((0, interventions_1.cooldownFloor)({ minCooldownDays: 21 }), 21, 'a sane number is used as typed');
// THE property worth the whole setting: the per-client pacing survives it. A
// client who trained four times a week and one who trained fortnightly still
// get different windows under the same coach preference — a floor composes with
// the pacing, an override would have deleted it.
const keen = (0, interventions_1.paceFor)(4, { minCooldownDays: 10 });
const rare = (0, interventions_1.paceFor)(0.5, { minCooldownDays: 10 });
ok(keen.cooldownDays >= 10, 'the keen client is never raised inside the coach’s floor');
ok(rare.cooldownDays > keen.cooldownDays, 'and the fortnightly one is still left longer than the daily one');
// A floor above the module's ceiling raises the ceiling rather than being
// pushed back down to it. A coach who typed 45 means 45.
const strict = (0, interventions_1.paceFor)(4, { minCooldownDays: 45 });
eq(strict.cooldownDays, 45, 'a floor past the cap wins — the cap is the app’s opinion, not the coach’s');
ok(45 > interventions_1.MAX_COOLDOWN_DAYS, 'and it really is past it');
// With no pattern to pace against, the coach's convention beats the app's.
eq((0, interventions_1.paceFor)(null).cooldownDays, interventions_1.DEFAULT_COOLDOWN_DAYS, 'no pattern and no preference is the app’s fortnight');
eq((0, interventions_1.paceFor)(null, { minCooldownDays: 30 }).cooldownDays, 30, 'no pattern with a preference is the coach’s number');
eq((0, interventions_1.paceFor)(null, { minCooldownDays: 0 }).cooldownDays, interventions_1.DEFAULT_COOLDOWN_DAYS, 'and a refused preference falls back rather than being honoured');
// The dismissal floor moves with it. A coach who will not be prompted inside
// forty-five days must not have a set-aside expire in thirty.
const drift = { baselinePerWeek: 4 };
ok((0, nudge_1.mutedDaysFor)('dismissed', drift) >= nudge_1.DISMISS_FLOOR_DAYS, 'a dismissal is at least a month by default');
eq((0, nudge_1.mutedDaysFor)('dismissed', drift, { minCooldownDays: 45 }), 45, 'and at least the coach’s own floor when that is longer');
eq((0, nudge_1.mutedDaysFor)('sent', drift, { minCooldownDays: 45 }), 45, 'sending honours it too');
// No preference must behave exactly as it did before this existed.
eq((0, nudge_1.mutedDaysFor)('sent', drift), (0, nudge_1.mutedDaysFor)('sent', drift, null), 'an absent preference changes nothing at all');
/* ── a target that never left the phone ─────────────────────────────────── */
//
// Setting a goal was a void call behind a sheet that closed itself, and two
// silent ways of keeping the target on one handset for good sat behind it: the
// account write is skipped for the rest of a session whose prefs read failed,
// and the write itself was un-awaited and unchecked.
eq((0, coachPrefs_1.goalSaveLine)('saved'), null, 'a target that reached the account says nothing — the bars speak for themselves');
{
    const dev = (0, coachPrefs_1.goalSaveLine)('device-only') ?? '';
    ok(dev.length > 0, 'a target that was never sent says so');
    ok(/this phone/i.test(dev), 'and names where it actually is');
    ok(!/saved to your account|stored on your account/i.test(dev), 'and never claims the account has it');
}
{
    const bad = (0, coachPrefs_1.goalSaveLine)('failed') ?? '';
    ok(/did NOT reach your account|not reach your account/i.test(bad), 'a refused write says the account does not have it');
    ok(/reinstall|another phone/i.test(bad), 'and what that costs the coach');
}
for (const o of ['saved', 'device-only', 'failed']) {
    const line = (0, coachPrefs_1.goalSaveLine)(o);
    ok(line === null || (!line.includes('undefined') && !line.includes('null')), `${o} is either silent or a real sentence`);
}
if (errors.length) {
    console.error(`coachPrefs.test.ts — ${errors.length} failure(s):`);
    for (const e of errors)
        console.error('  · ' + e);
    process.exit(1);
}
console.log('coachPrefs.test.ts — all assertions passed.');
