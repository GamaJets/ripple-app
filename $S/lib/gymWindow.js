"use strict";
// A reporting window cut on the gym's clock, and the sentence that says whose
// clock it was.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// Two console screens printed the same caption:
//
//   "{firstDay} to {lastDay}, in the gym’s own timezone."
//
// /tax over `taxPeriod`, /accounting over `monthWindow`. Both of those build
// their instants with `new Date(y, mo - 1, 1)` — the clock of whichever laptop
// is open — and both then use those instants as the filter on the takings.
//
// So the payments taken in the first hours of 1 October at a Gulf gym fall into
// Q3 read from London and into Q4 read at the desk. Two people export two
// different quarters out of one database, on the two screens whose entire
// purpose is a filing deadline, under a caption asserting the opposite of what
// is happening.
//
// ── Why the note comes out of the same function as the bounds ──────────────
//
// Because the bounds alone cannot be fixed. A gym that has not set a timezone
// still has to be able to look at its own quarter, and refusing the whole
// screen over an unset setting would be a worse answer than the one it
// replaces. What must not survive is the CAPTION: the device's bounds are
// perfectly usable as long as nothing tells an accountant they are the gym's.
//
// So the basis and the words travel together, out of one call, and a screen
// cannot render the confident wording over the fallback without going out of
// its way to do it. That is the whole design: the sentence is not a thing a
// screen decides.
//
// ── What this does NOT know ────────────────────────────────────────────────
//
// Whether the timezone was read. `zone: null` here means the gym has not set
// one, or set one this runtime cannot resolve — it does not mean the tenant
// read failed. That is a third state, `fetchGymZone` in src/lib/gymZone.ts
// exists to keep it apart, and the caller renders it separately: an owner sent
// to go and set a timezone over a refused read is an owner changing a setting
// that was already correct.
Object.defineProperty(exports, "__esModule", { value: true });
exports.cutAtGym = cutAtGym;
const gymZone_1 = require("./gymZone");
/**
 * Re-cut a window onto the gym's own clock, or say plainly that it was not.
 *
 * Both ends go through `gymDayBounds`, which computes the far end from the NEXT
 * day's midnight rather than by adding twenty-four hours — so a period
 * containing a clock change is the right length rather than an hour short or
 * long. `toIso` stays EXCLUSIVE, matching what both callers already mean by it:
 * a payment stamped at the first instant of the following day belongs to the
 * period that is starting.
 */
function cutAtGym(w, zone) {
    const first = (0, gymZone_1.gymDayBounds)(w.firstDay, zone);
    const last = (0, gymZone_1.gymDayBounds)(w.lastDay, zone);
    if (!first || !last) {
        return {
            window: w,
            basis: 'device',
            note: `${w.label}, ${w.firstDay} to ${w.lastDay}. ${gymZone_1.NO_ZONE_NOTE}, so this period is cut on your own device’s clock — money taken in the first hours of it may fall on the other side of the boundary for somebody reading in another country.`,
        };
    }
    return {
        window: { ...w, fromIso: first.fromISO, toIso: last.toISO },
        basis: 'gym',
        note: `${w.label}, ${w.firstDay} to ${w.lastDay}, cut on the gym’s own clock (${zone}).`,
    };
}
