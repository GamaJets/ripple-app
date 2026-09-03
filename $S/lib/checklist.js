"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COACH_ID_PREFIX = void 0;
exports.coachHabitId = coachHabitId;
exports.scheduledFocus = scheduledFocus;
exports.scheduledDay = scheduledDay;
exports.buildChecklist = buildChecklist;
exports.donePercent = donePercent;
/** Coach items live in the same id space as the derived ones, so they are
 *  namespaced. Nothing else may start with this. */
exports.COACH_ID_PREFIX = 'coach:';
function coachHabitId(rowId) { return exports.COACH_ID_PREFIX + rowId; }
// Thousands separators without toLocaleString. The label is compared in tests
// and rendered on devices in every locale the app ships to; a separator that
// changes underneath both is a difference nobody asked for.
function thousands(n) {
    const s = String(Math.round(Math.abs(n)));
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (i > 0 && (s.length - i) % 3 === 0)
            out += ',';
        out += s[i];
    }
    return (n < 0 ? '-' : '') + out;
}
// A number that came out of a division, a null column or a half-finished form
// is not a target. Anything non-finite or non-positive means "not set", which
// is the same answer as absent.
function target(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
const DAY_TO_WEEKDAY = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
/**
 * The focus of the plan day that falls on `weekday` (0 Sun … 6 Sat), or null.
 *
 * Deliberately an exact match. The home screen picks today's session with
 * `days[todayIdx % days.length]` — the day's column in the week, whichever day
 * opens it — and programs.todayIndex picks the NEAREST
 * day, both of which always return something — so a three-day Mon/Wed/Fri plan
 * yields a "session for today" on all seven days of the week. That is tolerable
 * on a screen that is showing you what is coming up; it is not tolerable on a
 * checklist, where it becomes a line telling somebody they owe a leg session on
 * a Sunday their plan gives them off. No scheduled day means no row, which is
 * the truth about a rest day.
 */
function scheduledFocus(days, weekday) {
    const d = scheduledDay(days, weekday);
    if (!d)
        return null;
    const focus = String(d.focus || '').trim();
    return focus || null;
}
/**
 * The whole plan day that falls on `weekday` (0 Sun … 6 Sat), or null for a day
 * the program does not schedule.
 *
 * The same exact match as `scheduledFocus`, returning the day rather than one
 * field of it, for the screen that has to draw the exercise count and the
 * cardio line too. It exists because `app/(client)/week.tsx` — the screen whose
 * entire job is showing the week — painted `days[i % days.length]` across all
 * seven weekdays. A three-day Mon/Wed/Fri plan therefore rendered a session on
 * every day, Wednesday's session on Tuesday, and no rest day anywhere, under a
 * heading that read "3 training days a week". The count and the list were both
 * on screen at once and they disagreed.
 *
 * Generic over the day shape so a caller keeps its own fields: this returns the
 * caller's object, not a copy narrowed to what this module happens to name.
 */
function scheduledDay(days, weekday) {
    for (const d of days) {
        const key = String(d.day || '').trim().slice(0, 3).toLowerCase();
        if (DAY_TO_WEEKDAY[key] === weekday)
            return d;
    }
    return null;
}
/**
 * Today's checklist for one client.
 *
 * Order is deliberate: the plan first (it is the reason they opened the app),
 * then the day's targets, then anything the coach added. Coach items go last
 * because they are additions to a plan, not replacements for it — and because a
 * coach with five items should not push the client's own macro target off the
 * fold.
 */
function buildChecklist(input) {
    const items = [];
    const gaps = [];
    const focus = (input.todaysTrainingFocus || '').trim();
    if (focus)
        items.push({ id: 'train', label: `Train — ${focus}`, icon: '🏋️', source: 'plan' });
    const kcal = target(input.kcalTarget);
    if (kcal != null)
        items.push({ id: 'kcal', label: `Eat to your ${thousands(kcal)} kcal target`, icon: '🔥', source: 'targets' });
    const protein = target(input.proteinTargetG);
    if (protein != null)
        items.push({ id: 'protein', label: `Hit ${thousands(protein)} g protein`, icon: '🍗', source: 'targets' });
    // Both come out of the same calculation, so they are missing together and one
    // note covers them. Worth saying because the client CAN fix it: weight and
    // body fat are on their profile, and a scan fills both in.
    if (kcal == null && protein == null) {
        gaps.push({ id: 'macros', note: 'Add your weight and body fat — your calorie and protein targets are worked out from them.' });
    }
    const water = target(input.waterGoalGlasses);
    if (water != null)
        items.push({ id: 'water', label: `Drink ${thousands(water)} glasses of water`, icon: '💧', source: 'targets' });
    // Its own note, for the same reason steps and sleep have separate ones: the
    // three are set independently, and the client can set this one on the screen
    // that shows the note.
    else
        gaps.push({ id: 'water', note: 'Set a water goal below and your glasses count towards it.' });
    const steps = target(input.stepGoal);
    if (steps != null)
        items.push({ id: 'steps', label: `Walk ${thousands(steps)} steps`, icon: '👟', source: 'targets' });
    // Separate notes, not one covering both, because they are set independently:
    // telling somebody who has a step goal that they need a step goal is the sort
    // of thing that teaches people to stop reading these.
    else
        gaps.push({ id: 'steps', note: 'Set a step goal below and it joins your list.' });
    const sleep = target(input.sleepGoalHours);
    // One decimal at most, and no trailing '.0' — "Sleep 7.5h+" and "Sleep 8h+".
    if (sleep != null)
        items.push({ id: 'sleep', label: `Sleep ${(Math.round(sleep * 10) / 10)}h+`, icon: '😴', source: 'targets' });
    else
        gaps.push({ id: 'sleep', note: 'Set a sleep goal below to track it here.' });
    const seen = new Set(items.map((i) => i.id));
    for (const c of input.coachItems) {
        const label = String(c.label || '').trim();
        const id = coachHabitId(String(c.id || '').trim());
        // A blank label is a row a coach started and abandoned; rendering it gives
        // the client an unlabelled circle to tick. A duplicate id would give two
        // rows that tick each other, because both write the same habit_logs key.
        if (!label || id === exports.COACH_ID_PREFIX || seen.has(id))
            continue;
        seen.add(id);
        const icon = String(c.icon || '').trim();
        items.push({ id, label, icon: icon || '📌', source: 'coach' });
    }
    return { items, gaps };
}
/**
 * The percentage for the hero figure, or null when there is nothing to show.
 *
 * `doneCount / items.length` divided by zero the moment the list stopped being
 * a constant of five, and the screen rendered the result straight into the one
 * big number: "NaN%", over an arc drawn from NaN. Null is the honest answer for
 * an empty list and the caller shows a dash for it.
 */
function donePercent(doneCount, total) {
    if (!Number.isFinite(total) || total <= 0)
        return null;
    const pct = (doneCount / total) * 100;
    if (!Number.isFinite(pct))
        return null;
    const rounded = Math.round(Math.max(0, Math.min(100, pct)));
    // ── The endpoints, held to the same rule as src/lib/sharePercent.ts ──────
    //
    // A rounded percentage may print 0 ONLY when nothing is ticked, and 100 ONLY
    // when everything is. `Math.round` does not know that: at 201 items one tick
    // rounds to 0, and at 200 items one item outstanding rounds to 100 — so the
    // hero would read "0%" over a day the client had started, or "100%" over a
    // list with a box still open, in the same breath as the count beside it
    // saying otherwise. That is the sentence sharePercent.ts was written for,
    // seen on the coach's Schedule screen: "Booked · 1 session … 0% of your slots
    // are filled".
    //
    // It is not currently reachable here — it needs about two hundred habits in
    // one day, and a real list is three targets and a handful of coach items —
    // which is exactly why it is worth closing now rather than after somebody
    // ships a habit library. The clamp is to 1 and 99 rather than to a string
    // because the caller draws an ARC from this number as well as printing it
    // (app/(client)/habits.tsx), and one percentage point of arc is invisible
    // where a wrong endpoint is not.
    if (rounded === 0 && doneCount > 0)
        return 1;
    if (rounded === 100 && doneCount < total)
        return 99;
    return rounded;
}
