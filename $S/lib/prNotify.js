"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PR_ROUTE_BASE = exports.PR_TITLE = void 0;
exports.prRoute = prRoute;
exports.movementKey = movementKey;
exports.prDayKey = prDayKey;
exports.prDecision = prDecision;
exports.announcedRecord = announcedRecord;
exports.bothUnits = bothUnits;
exports.prNotification = prNotification;
// Telling a coach that their client set a personal best, without writing a
// second definition of what one is.
//
// ── Why there is no SQL in this feature ────────────────────────────────────
//
// supabase/parts/202 shipped three coach notifications and deliberately left
// this one out. Its own header says why, and the reason has not changed: a
// personal record is defined by `personalRecords` in src/lib/exerciseHistory.ts
// over `workouts.sets`, which is untyped jsonb. A bodyweight set carries a `bw`
// flag and is priced at the member's recorded weight; a held set carries
// `timed` and contributes no estimated one-rep max at all. Re-stating any of
// that in plpgsql produces a second definition of a personal record, free to
// disagree with the first, and the disagreement surfaces as a coach being
// congratulated about a record the client's own Records screen does not show.
//
// So the notification is fired from the ONE place that already establishes a
// personal best at the moment it happens: the `prMsg` branch in `SessionRunner`
// (app/(client)/workouts.tsx). That branch carries four refusals, each of which
// this notification inherits for free by being inside it rather than beside it:
//
//   · the whole history was read (`logStatus === 'ready'`). Under 'partial' the
//     record being compared against may be in the half that did not arrive, and
//     `priorBest1RM` over an unread log returns 0 — so every set beats it.
//   · a bodyweight set is not compared, or every calisthenics set is a record.
//   · a held set is not compared, or Epley over seconds tells a coach their
//     client set a strength record by holding a plank three seconds longer.
//   · sets logged in this session are compared but cannot, on their own,
//     establish a lifetime best.
//
// This file adds NO part of that rule. It answers two questions the branch
// cannot: how often a coach should hear about it, and what the message says.
//
// ── A beginner sets a personal best almost every session ───────────────────
//
// That is not a defect in the rule, it is what novice linear progression IS:
// somebody adding 2.5 kg a week to five movements genuinely takes five lifetime
// records per session. Sent as they happen that is five pushes in forty
// minutes, from one client, and a coach with twenty clients mutes the channel
// inside a week. Muting is account-wide by category (src/lib/coachNotify.ts),
// so the cost of the noise is not the noise: it is that the coach also stops
// hearing the useful ones.
//
// Two rules, and the second is the one that matters.
//
//   1. ONCE PER MOVEMENT PER LOCAL DAY. Within a single exercise a member works
//      up: 90 × 5, then 95 × 5, then 100 × 3. Each of those beats the last, so
//      the branch fires three times in ten minutes about one lift. Nobody wants
//      to be told three times.
//
//   2. ONCE PER LOCAL DAY, FULL STOP. Rule 1 alone still yields one push per
//      movement, which is the five-pushes-in-forty-minutes case above. The
//      coach's unit of interest is not a set, it is "this person had a good
//      session" — and one message per client per day is a ceiling a coach can
//      hold twenty of. It is also the same shape a daily digest would take,
//      without needing a scheduler or a server-side table to build one.
//
// Rule 2 subsumes rule 1, and rule 1 is stated anyway because it is the one a
// future change would be tempted to relax first, and because `PrAnnounced`
// records the movement so `prDecision` can say WHICH record already spoke for
// today rather than only that something did.
//
// ── The first record of the day wins, and that is deliberate ───────────────
//
// The alternative is to hold the announcement until the session ends and send
// the best one. That is worse twice over. It needs the session to end, and a
// session that is abandoned, backgrounded or closed never does — so the
// cheapest retention act in this business would be the one that depends on the
// member tapping Done. And "best" across movements has no definition here: a
// 100 kg bench record and a 200 kg deadlift record cannot be ranked, and
// inventing a ranking would be exactly the second definition this whole feature
// exists to avoid. So: the first one, at the moment it happened, and the coach
// opens their client's training screen for the rest of the session.
//
// ── Where the "already told them" state lives ──────────────────────────────
//
// On the device, in AsyncStorage, written by src/lib/prNotifyStore.ts. NOT in a
// server table. A server table would be a third place that knows something
// about personal records, it would need a write path a client is allowed to
// take, and the only thing it buys is that a reinstall does not re-announce one
// record. Re-announcing one record after a reinstall is an annoyance; a
// `coach_pr_notices` table is a schema commitment. The device is the right
// place, and this note is here so the choice reads as a decision.
//
// ── What the message may say ───────────────────────────────────────────────
//
// A fact the client's own app computed, and nothing derived from it. No
// percentage, no "up 12% this month", no comparison with the previous best,
// because every one of those is a second figure that some screen also renders
// and that the two would then be free to disagree about. Part 202's rule,
// applied here: no figure the app would restate differently.
//
// The load is stated in BOTH units. This is the one notification in the product
// composed on one person's handset and read on another's: the member typed the
// load in their unit, the app stored kilograms, and the COACH's preference
// decides display everywhere else (src/lib/unitPreference.ts). A client's
// device cannot read `profiles.weight_unit` for their coach, and guessing gives
// a coach in pounds a bare "100" that is really 220. Both units need no
// preference at all and are wrong for nobody.
const notifyCopy_1 = require("./notifyCopy");
const clientDrift_1 = require("./clientDrift");
const units_1 = require("./units");
/** The heading. Fixed, and it names no figure: a lock screen shows the title of
 *  a stack of collapsed notifications, and a title carrying a load would read as
 *  a different record each time the same one was redrawn. */
exports.PR_TITLE = 'A client set a personal best';
/** The screen a coach lands on. `client-training.tsx` opens with a roster
 *  picker and no client selected, so the parameter is not decoration: without
 *  it this is a notification about a named person that opens a list of
 *  everybody. Same reasoning as the coach's chat thread and their client's
 *  intake in supabase/parts/159. */
exports.PR_ROUTE_BASE = '/(trainer)/client-training';
/**
 * The route for one client, or null when there is no id to put in it.
 *
 * Null rather than the bare screen: a row with nowhere to go renders as
 * "Nothing to open", which is honest, and a row that opens the wrong client's
 * training is not.
 */
function prRoute(clientId) {
    const id = (clientId ?? '').trim();
    if (!id)
        return null;
    return `${exports.PR_ROUTE_BASE}?clientId=${encodeURIComponent(id)}`;
}
/**
 * The movement's name reduced to the thing two spellings of it have in common.
 *
 * Case and spacing only. NOT `exerciseSlug` from src/lib/exerciseId.ts, which
 * is a matching rule for the video library and folds far more together than
 * this should — two movements a member considers different must be allowed to
 * take a record each. Empty when the name is blank, which is what `prDecision`
 * refuses on.
 */
function movementKey(name) {
    return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
/** The local calendar day an instant falls in. The same boundary
 *  `src/lib/clientDrift.ts` files activity under, and deliberately local: the
 *  member and their coach are usually in one time zone, and a UTC day would cut
 *  an evening session in half for everybody east of Greenwich. */
function prDayKey(atMs) {
    return (0, clientDrift_1.localDayKey)(atMs);
}
/**
 * Whether this record is the one the coach hears about.
 *
 * `last` is what this device sent before, or null if it has never sent one (a
 * fresh install, or an unread store — see `prNotifyStore.ts`, where a failed
 * read is null and therefore ANNOUNCES). That is the deliberate direction to
 * fail in: the cost of a storage read failing is one extra notification, and
 * the cost of failing the other way is a coach silently never hearing about a
 * record again.
 */
function prDecision(last, set, atMs) {
    const movement = movementKey(set.movement);
    if (!movement) {
        return { announce: false, why: 'no movement name — the message would name no lift' };
    }
    if (!Number.isFinite(set.kg) || set.kg <= 0) {
        return { announce: false, why: 'no load — a bodyweight set is not compared upstream and cannot reach here' };
    }
    if (!Number.isFinite(set.reps) || set.reps <= 0) {
        return { announce: false, why: 'no reps — there is no set to describe' };
    }
    if (!Number.isFinite(atMs)) {
        return { announce: false, why: 'no readable clock — the once-a-day rule has no day to work in' };
    }
    const day = prDayKey(atMs);
    if (last && last.day === day) {
        return {
            announce: false,
            why: last.movement === movement
                ? `already told them about ${movement} today`
                : `already told them about ${last.movement} today, and it is one message a day`,
        };
    }
    return { announce: true, why: 'the first personal best this device has passed on today' };
}
/** The record to store once a message has gone. Written only after the send is
 *  attempted, so a refusal at the door does not silently spend the day's one
 *  message. */
function announcedRecord(set, atMs) {
    return { day: prDayKey(atMs), movement: movementKey(set.movement) };
}
/**
 * The load in both units: `100 kg (220.5 lb)`.
 *
 * Through `liftLabel` in both directions rather than formatted here, so the
 * figure a coach reads is the figure their own screens would print for the same
 * stored kilograms, to the same grain.
 */
function bothUnits(kg) {
    const metric = (0, units_1.liftLabel)(kg, 'kg');
    const imperial = (0, units_1.liftLabel)(kg, 'lb');
    if (!metric)
        return '';
    return imperial ? `${metric} (${imperial})` : metric;
}
/**
 * What the coach is told.
 *
 * `clientName` is the member's name ONLY when their profile read succeeded —
 * see the call site. Under a failed read the cached name on the handset can
 * belong to whoever used the device last, and a coach congratulating the wrong
 * person by name is worse than one told "a client". Part 202's plpgsql makes
 * the same substitution with `coalesce(v_name, 'A client')`.
 *
 * Returns null when there is nothing true to say, which is what the caller
 * sends instead of a sentence with a hole in it.
 */
function prNotification(set, clientName) {
    const movement = (set.movement ?? '').trim();
    const load = Number.isFinite(set.kg) && set.kg > 0 ? bothUnits(set.kg) : '';
    const reps = Number.isFinite(set.reps) && set.reps > 0 ? Math.round(set.reps) : 0;
    if (!movement || !load || !reps)
        return null;
    const who = (clientName ?? '').trim() || 'A client';
    const repWord = reps === 1 ? 'rep' : 'reps';
    const body = `${who} just logged ${movement} at ${load} for ${reps} ${repWord}, `
        + 'and their app makes that their best set of that movement on record. '
        + 'Best means estimated one-rep max, so a lighter set for more reps can take it. '
        + 'Their training screen has the session it came from.';
    return { title: (0, notifyCopy_1.clip)(exports.PR_TITLE, notifyCopy_1.NOTICE_TITLE_MAX), body: (0, notifyCopy_1.clip)(body, notifyCopy_1.NOTICE_BODY_MAX) };
}
