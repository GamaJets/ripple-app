"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_WEEKDAYS = exports.PLAN_DAYS = exports.PLAN_VERSION = void 0;
exports.planDayIndex = planDayIndex;
exports.capturePlanMeal = capturePlanMeal;
exports.seedPlan = seedPlan;
exports.parsePlan = parsePlan;
exports.planDayOverride = planDayOverride;
exports.setPlanMeal = setPlanMeal;
exports.copyPlanDay = copyPlanDay;
exports.planDayBaseKcal = planDayBaseKcal;
exports.planStale = planStale;
exports.planStaleLine = planStaleLine;
exports.guardPlan = guardPlan;
exports.planServingNote = planServingNote;
const meals_1 = require("./meals");
const dayPlan_1 = require("./dayPlan");
const weekStart_1 = require("./weekStart");
/** Bumped only when a stored plan's shape changes in a way a reader must know
 *  about. `parsePlan` refuses anything it does not recognise rather than
 *  guessing, because a half-understood plan reaching a client is worse than
 *  none.
 *
 *  2 — `days` is ordered from the day src/lib/weekStart.ts opens a week on.
 *  1 — `days` was Monday-first, always and only. Migrated on read; see
 *      `parsePlan`. */
exports.PLAN_VERSION = 2;
/** The version before the week moved. `days[0]` in a plan stamped with this is
 *  Monday, whatever the product draws first today. */
const PLAN_VERSION_MONDAY_FIRST = 1;
/** A plan is a week. Not a month, and not a single day. */
exports.PLAN_DAYS = 7;
/** The week strip the client's Meals tab draws, in the order it draws it.
 *  Which day comes first is src/lib/weekStart.ts's decision — see planDayIndex,
 *  which is the other half of the same answer and must never disagree. */
exports.PLAN_WEEKDAYS = weekStart_1.WEEK_DAYS;
/**
 * Which slot of the stored week a calendar day is, or null when the date is
 * unreadable.
 *
 * `weekdayOfIso` answers 0 Sun … 6 Sat because that is what `Date.getDay()`
 * gives and what `scheduledFocus` wants. A plan is stored in the order the week
 * is DRAWN, so the two have to be converted between — a plan read in getDay()
 * order when the week does not open on Sunday would hand a client the wrong
 * day's dinners, every week, in the direction nobody checks.
 */
function planDayIndex(dateISO) {
    const w = (0, dayPlan_1.weekdayOfIso)(dateISO);
    return w == null ? null : (0, weekStart_1.dayIndexInWeek)(w);
}
/** Decode an index and snapshot what it resolved to. */
function capturePlanMeal(diet, slot, idx, avoid) {
    const size = (0, meals_1.catalogSize)(diet, slot, avoid);
    const safe = size > 0 ? ((idx % size) + size) % size : 0;
    const m = (0, meals_1.mealAt)(diet, slot, safe, avoid);
    return { slot, idx: safe, n: m.n, k: m.k, p: m.p, c: m.c, f: m.f };
}
/**
 * A week to start editing from: the day the client is already being shown,
 * then six variations of it.
 *
 * Stepping each index by the day number is exactly what the client's Meals tab
 * does for its own week preview, so a coach who opens this screen and saves
 * without touching anything has committed the week the client could already
 * see. A seed that invented a different week would make "send" a change the
 * coach did not make.
 */
function seedPlan(input, writtenAtISO) {
    const avoid = [...(input.avoid ?? [])];
    const slots = (0, meals_1.slotsFor)(input.mealsPerDay);
    const day0 = (0, meals_1.buildPlan)(input).plan;
    const days = [];
    for (let d = 0; d < exports.PLAN_DAYS; d++) {
        days.push({
            meals: slots.map((slot, i) => capturePlanMeal(input.diet, slot, (day0[i]?.idx ?? 0) + d, avoid)),
        });
    }
    return { v: exports.PLAN_VERSION, diet: input.diet, avoid, mealsPerDay: input.mealsPerDay, days, writtenAt: writtenAtISO };
}
const SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const DIETS = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const ALLERGEN_IDS = ['dairy', 'gluten', 'nuts', 'shellfish', 'egg', 'soy'];
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
/**
 * A stored plan, or null.
 *
 * Null means "there is no plan here", and it is the ONLY thing that may be
 * rendered as one. A read that failed is a LoadStatus, not a null — see
 * guardPlan, which refuses to let the two be confused.
 *
 * Everything is checked rather than cast. jsonb is whatever was written to it,
 * including by an older build of this app, and a plan half-understood is a
 * client eating meals nobody chose.
 */
function parsePlan(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const o = raw;
    const mondayFirst = o.v === PLAN_VERSION_MONDAY_FIRST;
    if (o.v !== exports.PLAN_VERSION && !mondayFirst)
        return null;
    if (typeof o.diet !== 'string' || !DIETS.includes(o.diet))
        return null;
    const mpd = o.mealsPerDay;
    if (mpd !== 3 && mpd !== 4 && mpd !== 5)
        return null;
    if (!Array.isArray(o.days) || o.days.length !== exports.PLAN_DAYS)
        return null;
    const avoid = Array.isArray(o.avoid)
        ? (o.avoid.filter((a) => typeof a === 'string' && ALLERGEN_IDS.includes(a)))
        : [];
    const want = (0, meals_1.slotsFor)(mpd);
    const days = [];
    for (const d of o.days) {
        if (!d || typeof d !== 'object')
            return null;
        const list = d.meals;
        if (!Array.isArray(list) || list.length !== want.length)
            return null;
        const meals = [];
        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            if (!m || typeof m !== 'object')
                return null;
            const r = m;
            // The slot is not taken on trust: a plan whose position 2 says
            // 'Breakfast' where the client's meals-per-day puts a Snack would resolve
            // its index through the wrong catalogue entirely.
            if (typeof r.slot !== 'string' || !SLOTS.includes(r.slot) || r.slot !== want[i])
                return null;
            if (!isFiniteNum(r.idx) || r.idx < 0)
                return null;
            if (typeof r.n !== 'string' || !r.n)
                return null;
            if (!isFiniteNum(r.k) || !isFiniteNum(r.p) || !isFiniteNum(r.c) || !isFiniteNum(r.f))
                return null;
            meals.push({ slot: r.slot, idx: Math.floor(r.idx), n: r.n, k: r.k, p: r.p, c: r.c, f: r.f });
        }
        days.push({ meals });
    }
    const writtenAt = typeof o.writtenAt === 'string' ? o.writtenAt : '';
    return {
        v: exports.PLAN_VERSION,
        diet: o.diet,
        avoid,
        mealsPerDay: mpd,
        days: mondayFirst ? mondayFirstToWeekOrder(days) : days,
        writtenAt,
    };
}
/**
 * A v1 plan's seven days, re-ordered into the week this build draws.
 *
 * THE DAYS THEMSELVES DO NOT MOVE. A coach wrote a Thursday and their client
 * eats it on a Thursday; only the position in the array changes, because the
 * array's meaning changed underneath it. Rotating is the whole migration —
 * there is no other difference between v1 and v2 — and it is done on READ so
 * that a plan written before the week moved needs nothing done to it in the
 * database.
 *
 * Refusing v1 outright was the alternative, and it is worse: every client whose
 * coach wrote them a week would silently have no plan, on a screen whose null
 * means "your coach has not written one".
 *
 * `(js + 6) % 7` is v1's own arithmetic, kept here and ONLY here — it is the
 * definition of the old format rather than a live convention, so it does not go
 * through weekStart.ts and must not be "tidied" into it.
 */
function mondayFirstToWeekOrder(days) {
    return Array.from({ length: exports.PLAN_DAYS }, (_, i) => days[((0, weekStart_1.jsDayForIndex)(i) + 6) % 7]);
}
/**
 * One day of the plan in the shape `buildPlan` already takes.
 *
 * This is the whole bridge to the client. Their Meals tab passes
 * `mealOverride` straight into `buildPlan`; a coach's day is that map, so the
 * plan reaches them through the path that already exists rather than a second
 * one drawn alongside it.
 */
function planDayOverride(plan, dayIdx) {
    const day = plan.days[dayIdx];
    const out = {};
    if (!day)
        return out;
    day.meals.forEach((m, i) => { out[i] = m.idx; });
    return out;
}
/** Replace one slot on one day. Immutable, so a screen's undo is a reference. */
function setPlanMeal(plan, dayIdx, pos, idx) {
    const day = plan.days[dayIdx];
    if (!day || !day.meals[pos])
        return plan;
    const meals = day.meals.map((m, i) => (i === pos ? capturePlanMeal(plan.diet, m.slot, idx, plan.avoid) : m));
    const days = plan.days.map((d, i) => (i === dayIdx ? { meals } : d));
    return { ...plan, days };
}
/** Copy one authored day over another — "Thursday is Monday again". */
function copyPlanDay(plan, fromDay, toDay) {
    const src = plan.days[fromDay];
    if (!src || !plan.days[toDay] || fromDay === toDay)
        return plan;
    const days = plan.days.map((d, i) => (i === toDay ? { meals: src.meals.map((m) => ({ ...m })) } : d));
    return { ...plan, days };
}
/** Base calories of a day at one serving each — what the coach composed, before
 *  the client's app scales it to their target. Never presented as a target. */
function planDayBaseKcal(plan, dayIdx) {
    const day = plan.days[dayIdx];
    return day ? day.meals.reduce((a, m) => a + m.k, 0) : 0;
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
/**
 * Has the client moved out from under the plan their coach wrote?
 *
 * Compared against the client's CURRENT diet, allergens and meals per day —
 * the three inputs `mealAt` resolves an index through. Any of them changing
 * renumbers the catalogue, so the meals a client is served stop being the ones
 * the coach picked without a single row changing anywhere.
 *
 * `addedAvoid` is the case with a person on the other end of it. A plan written
 * on Monday, a nut allergy disclosed on Wednesday, and a plan that still says
 * trail mix — the divergence list below will usually catch it as a side effect
 * of the renumbering, but "usually" is not a thing to build an allergen check
 * on, so the disclosure is compared directly and named in its own right.
 */
function planStale(plan, diet, avoid, mealsPerDay) {
    const now = [...avoid];
    const addedAvoid = now.filter((a) => !plan.avoid.includes(a));
    const droppedAvoid = plan.avoid.filter((a) => !now.includes(a));
    const dietChanged = plan.diet !== diet;
    const mealsPerDayChanged = plan.mealsPerDay !== mealsPerDay;
    const diverged = [];
    // Only worth walking when the plan's slots still line up with the client's;
    // under a changed meals-per-day every position is a different slot and the
    // comparison would be noise on top of a fact already established above.
    if (!mealsPerDayChanged && (dietChanged || !sameSet(plan.avoid, now))) {
        plan.days.forEach((day, dayIdx) => {
            day.meals.forEach((m, pos) => {
                const size = (0, meals_1.catalogSize)(diet, m.slot, now);
                if (!size)
                    return;
                const resolved = (0, meals_1.mealAt)(diet, m.slot, m.idx % size, now);
                if (resolved.n !== m.n)
                    diverged.push({ dayIdx, pos, slot: m.slot, was: m.n, now: resolved.n });
            });
        });
    }
    return {
        stale: addedAvoid.length > 0 || droppedAvoid.length > 0 || dietChanged || mealsPerDayChanged || diverged.length > 0,
        addedAvoid, droppedAvoid, dietChanged, mealsPerDayChanged, diverged,
    };
}
/**
 * The sentence a coach reads about a stale plan, or null when it is current.
 *
 * Addressed to the coach, names the client, and says what to do. It does not
 * say the plan is unsafe — nobody here knows that — it says the plan no longer
 * describes what this client is being served, which is a fact.
 */
function planStaleLine(s, who) {
    if (!s.stale)
        return null;
    const parts = [];
    if (s.addedAvoid.length) {
        parts.push(`${who} has disclosed ${listOf(s.addedAvoid)} since you wrote this. Every meal below was chosen from a catalogue that did not exclude ${s.addedAvoid.length === 1 ? 'it' : 'them'}.`);
    }
    if (s.dietChanged)
        parts.push(`Their diet has changed, so these meals were picked from a different catalogue altogether.`);
    if (s.mealsPerDayChanged)
        parts.push(`They eat a different number of meals a day now, so the slots this plan was written for are not the slots they have.`);
    if (s.droppedAvoid.length && !s.addedAvoid.length && !s.dietChanged) {
        parts.push(`They no longer avoid ${listOf(s.droppedAvoid)}, which renumbers the catalogue these meals were chosen from.`);
    }
    if (s.diverged.length) {
        parts.push(s.diverged.length === 1
            ? `One meal now resolves to something else on their phone: "${s.diverged[0].was}" is showing as "${s.diverged[0].now}".`
            : `${s.diverged.length} of these meals now resolve to something else on their phone.`);
    }
    parts.push('Rebuild the week and send it again — nothing here is being shown to them as your plan while it says this.');
    return parts.join(' ');
}
function listOf(a) {
    const l = a.map((x) => x);
    if (l.length === 1)
        return l[0];
    return `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
}
const SEND_OK = { allowed: true, reason: null, label: null };
/**
 * May this coach send a meal plan to this client?
 *
 * Two reads have to have landed before the answer is yes, and each is refused
 * for its own reason:
 *
 *  · the client's profile, which carries the allergens and the diet the whole
 *    index space is defined by. Composing a plan over a profile that did not
 *    load means choosing meals from a catalogue filtered by an allergen list
 *    nobody read — which is how a disclosed allergen ends up in a plan.
 *  · the existing plan, so that "no plan yet" is never printed over a read that
 *    failed, and a coach is never shown an empty week for somebody who has one.
 *
 * Same shape and same reasoning as guardInjuries in ./injuryGate.ts: a control
 * withheld, with a sentence saying why and what to do.
 */
function guardPlan(profileStatus, planStatus, stale, clientName) {
    if (profileStatus === 'loading') {
        return { allowed: false, label: 'Checking What They Avoid…', reason: `Still reading ${clientName}'s allergens and diet. Every meal in this plan is chosen from a catalogue those two filter, so there is nothing to compose against yet.` };
    }
    if (profileStatus === 'error' || profileStatus === 'partial') {
        return { allowed: false, label: 'Their Allergens Could Not Be Read', reason: `${clientName}'s allergens and diet did not come back, so this screen cannot tell whether they have disclosed anything. Writing a plan on the assumption that they have not is exactly what this check exists to stop.` };
    }
    if (planStatus === 'loading') {
        return { allowed: false, label: 'Reading Their Plan…', reason: `Still reading whether ${clientName} already has a plan. Sending now could overwrite one you have not seen.` };
    }
    if (planStatus === 'error' || planStatus === 'partial') {
        return { allowed: false, label: 'Their Plan Could Not Be Read', reason: `Whether ${clientName} already has a plan is unknown rather than no. Sending would overwrite a week you have not been shown.` };
    }
    if (stale && stale.stale) {
        return { allowed: false, label: 'Rebuild This Week First', reason: planStaleLine(stale, clientName) };
    }
    return SEND_OK;
}
/**
 * What the client's app will do with the servings, in words.
 *
 * `buildPlan` scales every meal in a day by one shared multiplier so the day
 * lands on the client's target, so a coach who composes 1,400 kcal of food
 * against a 2,500 kcal target has not written a 1,400 kcal day — they have
 * written one where every plate is served at 1.75×. That is a consequence of
 * the choice worth reading before it is sent, and it is arithmetic rather than
 * advice: no judgement is offered about either figure.
 */
function planServingNote(servings, baseKcal, targetKcal) {
    const mult = servings.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
    if (servings === 1) {
        return `These meals come to ${baseKcal.toLocaleString()} kcal at one serving each, which is what their target asks for. Their app serves them as written.`;
    }
    const dir = servings > 1 ? 'up' : 'down';
    return `These meals come to ${baseKcal.toLocaleString()} kcal at one serving each, against a target of ${targetKcal.toLocaleString()} kcal. Their app scales every plate ${dir} to ${mult}× to close the gap — pick differently if that is not the portion you mean.`;
}
