"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayKeyOf = dayKeyOf;
exports.dayKeyOfDate = dayKeyOfDate;
exports.sameLocalDay = sameLocalDay;
exports.instantForDay = instantForDay;
exports.readFoodEdit = readFoodEdit;
exports.foodChanged = foodChanged;
exports.readWorkoutEdit = readWorkoutEdit;
// Correcting something that is already logged — TF-02, "can't edit an entry".
//
// Two records a client keeps could be added to and deleted from but never
// fixed: a meal in the food log and a lift or cardio session in the training
// log. The only remedy on offer was delete-and-log-again, and on the training
// side that is not an equivalent remedy at all — it discards the heart-rate
// zones recorded against the session, which are a measurement nobody can
// reproduce by typing. So people left the wrong number in rather than lose the
// right ones, and the wrong number went on feeding the day's macros, the
// streak, the monthly bars in History and the coach's adherence figures.
//
// What a person typed is read and checked here, away from React, for three
// reasons. It is where "blank" can be kept distinct from "zero" once instead of
// at five keyboards. It is where the day-preserving rule below can be TESTED
// rather than asserted in a comment. And it is where an unparseable field can
// be refused instead of quietly becoming 0 — `parseInt('abc', 10) || 0` was the
// shape the edit sheet shipped with, and a fat-fingered calorie box turning
// into a confident zero is exactly the kind of invented figure this app exists
// not to print.
//
// ── The day an entry belongs to is not the day you correct it on ────────────
//
// This is the trap in src/lib/localDate.ts, arriving from a new direction. A
// correction typed on Thursday to Tuesday's squats has to leave the entry on
// Tuesday: the calendar dots, the streak, the History bars and the coach's
// week all key off the day, and moving it would silently create a session that
// never happened alongside a Tuesday that suddenly went untrained.
//
// So `workoutPatch` cannot express a change of timestamp at all — `t` is
// excluded from its return type, which makes the rule a compile error rather
// than a habit. And where a day genuinely does have to become an instant —
// saving Tuesday's session on Thursday from Train's day picker — `instantForDay`
// builds it from the calendar numbers through `dateParts`, because `Date.parse`
// resolves a bare `YYYY-MM-DD` to UTC midnight and hands everybody west of
// Greenwich the day before.
const localDate_1 = require("./localDate");
const pad2 = (n) => String(n).padStart(2, '0');
/** The local calendar day an instant falls on, as `YYYY-MM-DD`. */
function dayKeyOf(iso) {
    const p = (0, localDate_1.dateParts)(iso);
    return p ? `${p[0]}-${pad2(p[1] + 1)}-${pad2(p[2])}` : null;
}
/** The local calendar day of a Date, in the same `YYYY-MM-DD` shape. */
function dayKeyOfDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** Whether two instants land on the same day in the reader's own timezone. */
function sameLocalDay(a, b) {
    const x = dayKeyOf(a);
    return x != null && x === dayKeyOf(b);
}
/**
 * An instant that reads back as `dayKey` for whoever logged it.
 *
 * Train's day picker lets somebody select Tuesday and save the session they did
 * on Tuesday. The save wrote `new Date().toISOString()` regardless, so the
 * session landed on whatever day they happened to be typing — the calendar dot,
 * the streak and the coach's week all recorded a Thursday that never happened
 * and a Tuesday that did.
 *
 * Today keeps the real clock time, because for today the instant IS known and
 * throwing it away would flatten every session of the day onto the same moment.
 * Any other day gets local midday. Not midnight: DST transitions happen in the
 * small hours, and in the zones that shift AT midnight a local midnight can
 * resolve to 23:00 the day before — which is the whole bug again, arriving
 * twice a year.
 *
 * Null for a string that is not a real calendar day, rather than a nearby one:
 * the regex in `dateParts` will happily read '2026-13-45', and rolling that
 * forward to February would file a session under a month nobody chose.
 */
function instantForDay(dayKey, now = new Date()) {
    const p = (0, localDate_1.dateParts)(dayKey);
    if (!p)
        return null;
    const [y, m, d] = p;
    const noon = new Date(y, m, d, 12, 0, 0, 0);
    // Round-trip check: a rolled-over date is not the day that was asked for.
    if (noon.getFullYear() !== y || noon.getMonth() !== m || noon.getDate() !== d)
        return null;
    return dayKeyOfDate(now) === dayKeyOfDate(noon) ? now.toISOString() : noon.toISOString();
}
/** A number, or null when the text is not one. Accepts a decimal comma, which
 *  is what a Gulf or European keyboard offers first. */
function num(s) {
    const v = Number(String(s).trim().replace(',', '.'));
    return Number.isFinite(v) ? v : null;
}
/**
 * Read a corrected meal.
 *
 * Calories are required. `food_logs.kcal` is NOT NULL, so there is nowhere to
 * put "I don't know" — and a meal with no figure cannot be counted against the
 * day anyway, which is the only thing the food log is for. The same sentence
 * the photo sheet already uses is reused here on purpose.
 *
 * An emptied macro field is 0 and not a refusal: broccoli genuinely has no fat,
 * and somebody clearing the box is stating that rather than declining to say.
 * Text that is not a number at all is refused outright — that is a typo, and
 * turning a typo into a zero is how a fabricated figure gets into a record.
 */
function readFoodEdit(draft) {
    const name = draft.name.trim();
    if (!name)
        return { ok: false, reason: 'Give the meal a name so you can recognise it later.' };
    const kcal = num(draft.kcal);
    if (draft.kcal.trim() === '' || kcal == null) {
        return { ok: false, reason: 'Enter the calories. A meal with no figure cannot be counted against your day.' };
    }
    if (kcal < 0)
        return { ok: false, reason: 'Calories cannot be negative.' };
    const macros = { protein: 0, carbs: 0, fat: 0 };
    const labels = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
    for (const k of ['protein', 'carbs', 'fat']) {
        const raw = draft[k];
        if (raw.trim() === '') {
            macros[k] = 0;
            continue;
        }
        const v = num(raw);
        if (v == null)
            return { ok: false, reason: `${labels[k]} is not a number. Leave it empty if there is none.` };
        if (v < 0)
            return { ok: false, reason: `${labels[k]} cannot be negative.` };
        macros[k] = Math.round(v);
    }
    return { ok: true, value: { name, kcal: Math.round(kcal), ...macros } };
}
/** Whether a correction actually corrects anything, so an untouched sheet can
 *  close without claiming a save it never attempted. */
function foodChanged(before, after) {
    return before.name !== after.name || before.kcal !== after.kcal
        || before.protein !== after.protein || before.carbs !== after.carbs || before.fat !== after.fat;
}
/**
 * Read a corrected workout entry.
 *
 * Cardio and strength are different records and are checked differently: a
 * cardio session without minutes is not a session, and a strength entry with
 * every set removed is not an entry. Both are refused with the delete button
 * named, because deleting is what the person actually means and it is one tap
 * away — where writing an empty row would leave a ghost in the calendar that
 * cannot be corrected either.
 *
 * Calories may be blank, and blank means null rather than 0. `kcal` is the one
 * figure here the app sometimes derives and sometimes cannot: a sauna has no
 * MET value, so its burn is genuinely unknown, and the log renders that as a
 * dash. Typing 0 into that dash would be a measurement claim.
 */
function readWorkoutEdit(entry, draft) {
    const name = draft.name.trim();
    if (!name)
        return { ok: false, reason: 'An entry needs an exercise name.' };
    const patch = { exercise: name };
    if (entry.cardio) {
        const mins = num(draft.mins);
        if (mins == null || mins <= 0) {
            return { ok: false, reason: 'How long was it? A session with no minutes is not a session — delete it instead if it did not happen.' };
        }
        const dist = draft.dist.trim() === '' ? 0 : num(draft.dist);
        if (dist == null || dist < 0)
            return { ok: false, reason: 'Distance is not a number. Leave it empty if you did not measure one.' };
        const watts = draft.watts.trim() === '' ? 0 : num(draft.watts);
        if (watts == null || watts < 0)
            return { ok: false, reason: 'Watts is not a number. Leave it empty if your machine did not show one.' };
        // Spread the original first so hrAvg and hrHigh — measured by a watch and
        // not editable here — survive a correction to the minutes beside them.
        // The unit is applied EXPLICITLY, after the spread. It used to be carried
        // through by `...entry.cardio` with nothing able to change it.
        const unit = typeof draft.distUnit === 'string' && draft.distUnit.trim()
            ? draft.distUnit.trim() : entry.cardio.unit;
        const cardio = { ...entry.cardio, mins: Math.round(mins), dist, unit };
        if (watts > 0)
            cardio.watts = Math.round(watts);
        else
            delete cardio.watts;
        patch.cardio = cardio;
    }
    else {
        // Which rows survive, BY INDEX, so everything aligned to `sets` can be
        // rebuilt against the same decision. `feel` used to be `slice(0, kept
        // .length)` — a length, not a mapping — so deleting the first of four sets
        // left set 2's effort answer describing set 1, set 3's describing set 2,
        // and set 4's answer dropped. A row removed in the middle shifted every
        // testimony below it onto a different set.
        const keptIdx = draft.sets.map((s, i) => (s.reps > 0 ? i : -1)).filter((i) => i >= 0);
        if (!keptIdx.length) {
            return { ok: false, reason: 'Keep at least one set, or delete the entry instead — an entry with nothing in it still counts as a session.' };
        }
        const kept = keptIdx.map((i) => draft.sets[i]);
        patch.sets = kept.map((s) => [Math.round(s.reps), s.kg]);
        // Written only when there is something to say, and CLEARED when there is
        // not — an entry whose last bodyweight set was corrected away must not keep
        // a stale `bw` array describing sets that are no longer there.
        patch.bw = kept.some((s) => s.bw) ? kept.map((s) => s.bw === true) : undefined;
        patch.timed = kept.some((s) => s.timed) ? kept.map((s) => s.timed === true) : undefined;
        // Perceived effort is recorded per set, so a set that no longer exists must
        // not keep carrying somebody's answer for it — and a surviving set must
        // keep its own.
        if (entry.feel)
            patch.feel = keptIdx.map((i) => entry.feel[i]).filter((f) => f !== undefined);
    }
    if (draft.kcal.trim() === '') {
        patch.kcal = undefined;
    }
    else {
        const k = num(draft.kcal);
        if (k == null)
            return { ok: false, reason: 'Calories is not a number. Leave it empty if the burn is unknown.' };
        if (k < 0)
            return { ok: false, reason: 'Calories cannot be negative.' };
        patch.kcal = Math.round(k);
    }
    return { ok: true, value: patch };
}
