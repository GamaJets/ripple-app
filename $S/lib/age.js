"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ageFromDob = ageFromDob;
// ── Age from date of birth ───────────────────────────────────────────────────
const localDate_1 = require("./localDate");
/**
 * Whole years from an ISO date of birth. Updates automatically each birthday.
 *
 * `dob` is a Postgres `date` — a bare YYYY-MM-DD with no time and no offset.
 * It used to go through `new Date(dob)`, which resolves to UTC midnight, and
 * the comparison then read it back with local getters: west of Greenwich a
 * birthday on the 1st was read as the 31st of the month before, and the person
 * turned a year older a day early. Invisible in UTC+4, wrong across the
 * Americas. See src/lib/localDate.ts.
 */
function ageFromDob(dob, now = new Date()) {
    const b = (0, localDate_1.dateParts)(dob);
    if (!b)
        return null;
    const [by, bm, bd] = b;
    let age = now.getFullYear() - by;
    const m = now.getMonth() - bm;
    if (m < 0 || (m === 0 && now.getDate() < bd))
        age--;
    return age;
}
