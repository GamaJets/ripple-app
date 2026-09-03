"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RATE_EPSILON_KG_PER_WEEK = exports.MIN_PLAN_KCAL = exports.MAX_DEFICIT_FRACTION_OF_TDEE = exports.MAX_GAIN_FRACTION_PER_WEEK = exports.MAX_GAIN_KG_PER_WEEK = exports.MAX_LOSS_FRACTION_PER_WEEK = exports.MAX_LOSS_KG_PER_WEEK = exports.KCAL_PER_KG = void 0;
exports.safeWeeklyRate = safeWeeklyRate;
exports.planKcal = planKcal;
exports.energyPlanFor = energyPlanFor;
exports.observedRateKg = observedRateKg;
// The bridge between what a client says they are working toward and the
// calories on their plate.
//
// ── The complaint ──────────────────────────────────────────────────────────
//
// TF-29: the client's stated goal should drive their calories, macros and
// plan. It did not. `macrosFor` in ./nutrition.ts moved maintenance by a
// three-way enum off `clients.goal` — fatloss −20%, tone −8%, muscle +12% — so
// a client aiming to lose 6 kg in twelve weeks and one aiming to lose the same
// 6 kg in forty were handed the same calorie target. At most one of those two
// plans can be right, and the app had no way of telling which: the enum has no
// date in it, and a rate is a distance over a time.
//
// A real target has both. `goal_targets` (supabase/parts/59) holds a weight
// and a target date, so this module turns that pair into an energy budget.
//
// ── What it refuses to do, which is the point ──────────────────────────────
//
//  · It never invents a rate. No goal, no date, no weight readings, or a goal
//    that is not about weight at all, and it returns kind 'enum' WITH the
//    reason — ./nutrition.ts then behaves exactly as it did before, and the
//    screen can say which of those it was rather than showing a number that
//    looks derived and is not.
//  · It never silently misses the client's date. A date demanding 1.9 kg a
//    week is not a plan, it is a crash diet, so the rate is clamped — and the
//    clamp comes back as fact: what the date required, what the plan is built
//    on, and when the plan actually arrives. Delivering the clamped number
//    while still labelling it "your 24 December target" would be the app
//    lying about arithmetic it did itself.
//  · It never re-derives the client's observed pace. That lives in
//    ./goalTargets (`projectionOf`), which already knows that two weigh-ins a
//    day apart differing by 400 g are water and not a trend.
const goalTargets_1 = require("./goalTargets");
/**
 * Energy in a kilogram of body mass. The Wishnofsky constant — 3,500 kcal per
 * pound — which is a linear approximation and known to overstate how much a
 * long diet delivers, because maintenance falls as the client does (Hall et
 * al., "Quantification of the effect of energy imbalance on bodyweight",
 * Lancet 2011). It is kept anyway because it is the figure every coach and
 * every calculator in this space plans with, and because nothing here rests on
 * it holding for a year: the client's ACTUAL pace is measured from their
 * readings by `projectionOf`, and that is what the screen shows them next to
 * the plan. This number sets a starting point, not a promise.
 */
exports.KCAL_PER_KG = 7700;
// ── The safe range ─────────────────────────────────────────────────────────
//
// Two sources, and they agree closely enough to take the stricter of the two.
//
//  · NHS / NICE public health guidance (PH53) puts safe, sustainable weight
//    loss at 0.5–1 kg per week, on a deficit of roughly 600 kcal a day. One
//    kilogram a week is the ceiling of clinical advice for an unsupervised
//    adult, so it is the ceiling here.
//  · Garthe et al., "Effect of two different weight-loss rates on body
//    composition and strength and power-related performance in elite
//    athletes", IJSNEM 21(2) 2011. Athletes losing 0.7% of bodyweight a week
//    (a 19% energy restriction) GAINED lean mass and improved on every
//    strength test; those losing 1.4% a week (a 30% restriction) did not, and
//    their testosterone fell. The lesson is that the safe rate scales with the
//    person: 1 kg a week is a mild week for a 130 kg client and a brutal one
//    for a 55 kg client.
//
// So the loss ceiling is the smaller of 1 kg/week and 1% of bodyweight/week,
// and a 25% cap on the deficit as a fraction of maintenance sits underneath
// both — that is the line Garthe's fast group crossed. The 1,200 kcal absolute
// floor is the usual clinical minimum for a diet nobody is supervising; this
// app does not know the client's sex, so it takes the lower of the two figures
// normally quoted (1,200 / 1,500) rather than assuming.
//
// Gaining is capped harder, and deliberately: a surplus above roughly 0.5% of
// bodyweight a week is mostly fat, so the muscle-focused client asking for
// 6 kg in six weeks is asking for something the plan cannot honestly give.
exports.MAX_LOSS_KG_PER_WEEK = 1.0;
exports.MAX_LOSS_FRACTION_PER_WEEK = 0.01;
exports.MAX_GAIN_KG_PER_WEEK = 0.5;
exports.MAX_GAIN_FRACTION_PER_WEEK = 0.005;
exports.MAX_DEFICIT_FRACTION_OF_TDEE = 0.25;
exports.MIN_PLAN_KCAL = 1200;
/**
 * Rates closer together than this are the same rate. Twenty grams a week is
 * 22 kcal a day — finer than the 10 kcal rounding on the target, and far
 * finer than anything a bathroom scale can confirm. Without this a target
 * 200 g away would be reported as a plan that misses its own date.
 */
exports.RATE_EPSILON_KG_PER_WEEK = 0.02;
/** The fastest this app will plan to change a body of `bodyKg`, applied to a
 *  signed weekly rate. See the safe-range note above for the sources. */
function safeWeeklyRate(requiredKgPerWeek, bodyKg) {
    const loss = Math.min(exports.MAX_LOSS_KG_PER_WEEK, bodyKg * exports.MAX_LOSS_FRACTION_PER_WEEK);
    const gain = Math.min(exports.MAX_GAIN_KG_PER_WEEK, bodyKg * exports.MAX_GAIN_FRACTION_PER_WEEK);
    return Math.max(-loss, Math.min(gain, requiredKgPerWeek));
}
/**
 * The daily target a weekly rate of change implies, and whether the intake
 * floor had to catch it.
 *
 * One function so that the number the plan reports and the number `macrosFor`
 * eats are produced by the same arithmetic. They were briefly two, and two
 * screens computing "calories left" two ways is exactly the bug documented at
 * the foot of ./nutrition.ts.
 */
function planKcal(tdeeKcal, weeklyRateKg) {
    const round10 = (n) => Math.round(n / 10) * 10;
    const floor = round10(Math.max(exports.MIN_PLAN_KCAL, tdeeKcal * (1 - exports.MAX_DEFICIT_FRACTION_OF_TDEE)));
    const raw = round10(tdeeKcal + (weeklyRateKg * exports.KCAL_PER_KG) / 7);
    return raw < floor ? { kcal: floor, floored: true } : { kcal: raw, floored: false };
}
/**
 * What the client's target and date say their calories should be — or, when
 * the record cannot support that, why not.
 *
 * Only a weight goal drives energy. A body-fat or muscle target moves with
 * training and protein at least as much as with calories, and turning "22%
 * body fat by March" into a deficit would mean inventing a body-composition
 * model the app has no readings to fit. Those goals fall back, by name.
 */
function energyPlanFor(input) {
    const { goal, weightSeries, tdeeKcal, nowMs } = input;
    // Computed once, up front, so that the observed pace is reported even in the
    // cases where no plan can be derived — "we cannot build your plan from this
    // goal, but you are losing 0.4 kg/wk" is a more useful screen than silence.
    const observed = goal ? (0, goalTargets_1.projectionOf)(goal, weightSeries, nowMs) : null;
    const fall = (reason) => ({ kind: 'enum', reason, observed });
    if (!goal || goal.achievedAtISO)
        return fall('no-goal');
    if (goal.kind !== 'weight' || !(0, goalTargets_1.isMeasured)(goal))
        return fall('not-weight');
    // Where the goal began, which is a different question to where the client's
    // history began: somebody who set this target on Monday started it at
    // Monday's weight, however long the app has been watching them. It is also
    // the honest "no readings at all" test — `progressOf` folds that case in
    // with the unmeasurable-goal case and returns the same null for both.
    const from = (0, goalTargets_1.startPoint)(weightSeries, goal.createdAtISO);
    if (!from)
        return fall('no-readings');
    if (!Number.isFinite(tdeeKcal) || tdeeKcal <= 0)
        return fall('no-maintenance');
    if (!goal.targetDateISO)
        return fall('no-target-date');
    const targetDateMs = Date.parse(goal.targetDateISO);
    if (!Number.isFinite(targetDateMs))
        return fall('no-target-date');
    const prog = (0, goalTargets_1.progressOf)(goal, weightSeries);
    if (!prog)
        return fall('no-readings');
    if (prog.reached)
        return fall('reached');
    const days = (targetDateMs - nowMs) / 86400000;
    // Two different things to tell somebody, so they are two reasons. A date
    // that has gone by needs moving, and until it is there is no future to
    // divide the remaining kilos over. A date that is merely close cannot be
    // planned for honestly either: the app could not tell the client whether it
    // was working before the date arrived, and dividing a 6 kg gap by four days
    // produces a rate that exists only as a number. Both fall back to the
    // enum's steady deficit, which is the truthful answer in each case.
    if (days < 0)
        return fall('date-passed');
    if (!(days >= goalTargets_1.MIN_TREND_DAYS))
        return fall('date-too-soon');
    const requiredRateKg = prog.remaining / (days / 7);
    const safeRate = safeWeeklyRate(requiredRateKg, prog.current);
    const { kcal, floored } = planKcal(tdeeKcal, safeRate);
    // Read back off the calories rather than carried down from `safeRate`: the
    // intake floor and the rounding both move the plan, and the rate the client
    // is shown has to be the rate the plan on their plate delivers.
    const plannedRateKg = ((kcal - tdeeKcal) * 7) / exports.KCAL_PER_KG;
    const shortfall = Math.abs(requiredRateKg) - Math.abs(plannedRateKg);
    const onTime = shortfall <= exports.RATE_EPSILON_KG_PER_WEEK;
    const arrives = Math.abs(plannedRateKg) > 0 && Math.sign(plannedRateKg) === Math.sign(prog.remaining)
        ? nowMs + Math.abs(prog.remaining / plannedRateKg) * 7 * 86400000
        : null;
    return {
        kind: 'derived',
        kcal,
        kcalDelta: kcal - Math.round(tdeeKcal),
        requiredRateKg,
        plannedRateKg,
        limitedBy: floored ? 'floor' : Math.abs(safeRate - requiredRateKg) > exports.RATE_EPSILON_KG_PER_WEEK ? 'rate' : null,
        onTime,
        // When the plan arrives on time the honest finish is the client's own
        // date; the projection only differs from it by the 10 kcal rounding.
        etaMs: onTime ? targetDateMs : arrives,
        targetDateMs,
        startKg: from.v,
        currentKg: prog.current,
        targetKg: prog.target,
        observed,
    };
}
/**
 * The client's own measured pace in kg/week, or null when their readings
 * cannot yet support one — fewer than two of them, or less than
 * MIN_TREND_DAYS between the first and the last.
 *
 * A flat trend is 0 and not null: "you have not moved" is a measurement.
 */
function observedRateKg(plan) {
    const p = plan.observed;
    if (!p)
        return null;
    switch (p.kind) {
        case 'eta':
        case 'wrongway': return p.weeklyRate;
        case 'flat': return 0;
        // 'tooshort' carries a day count and no rate, on purpose; 'reached' has
        // nowhere left to go.
        case 'tooshort':
        case 'reached': return null;
    }
}
