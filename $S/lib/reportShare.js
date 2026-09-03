"use strict";
// What the Weekly Report's consent question is a question ABOUT.
//
// ── Why this is not SENT_WITH_PERMISSION ──────────────────────────────────
//
// src/lib/coachShare.ts owns the AI Coach's list, and the two screens do not
// send the same things. The Coach sends sleep hours, a readiness score, the
// member's injuries and the focus areas read off their progress photos. The
// Weekly Report sends none of those and sends things the Coach does not: the
// waist and tape measurements, and the body-composition scan — visceral fat,
// BMR, lean and fat mass, body water, and a left/right limb finding of the
// form "Legs: left 12% behind". Pointing the report's bullets at the Coach's
// list would swap one wrong list for another.
//
// ── Why the list is a Record and not an array ─────────────────────────────
//
// The screen used to carry three bullets as a literal, directly under a
// comment saying they were rendered from a module "so the list cannot drift
// from what is actually sent". They had already drifted: the scan and the limb
// imbalance went too, and neither was named. A second array beside the code
// would have drifted again the next time somebody added a line.
//
// So the health half of the report is TAGGED. Every fact line the screen sends
// carries the kind of thing it is, `REPORT_SHARE_BULLETS` is derived from the
// same Record of kinds, and the type makes adding a sixth kind without a sixth
// bullet a compile error rather than a paragraph somebody reads and believes.
// The list and the payload are one thing with two renderings.
//
// A list somebody has read and agreed to that no longer describes the code is
// worse than no list: they have now been told something false and shown a
// button under it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPORT_SHARE_BULLETS = exports.REPORT_SENT_WITH_PERMISSION = exports.REPORT_HEALTH_KINDS = void 0;
exports.reportHealthLines = reportHealthLines;
exports.kindsPresent = kindsPresent;
/**
 * The order the bullets are read in. Declared explicitly rather than taken
 * from `Object.keys`, because key order is not something a member's consent
 * screen should inherit from an object literal.
 */
exports.REPORT_HEALTH_KINDS = ['body', 'waist', 'checkin', 'composition', 'balance'];
/**
 * One bullet per kind, in the member's words. Sentence fragments, because they
 * are read after "Only sent if you say yes".
 *
 * A `Record` over the union: a kind added to `ReportHealthKind` without a line
 * here does not compile.
 */
exports.REPORT_SENT_WITH_PERMISSION = {
    body: 'your weight, body fat and skeletal muscle',
    waist: 'your waist and other tape measurements',
    checkin: 'your check-in scores, including how you slept',
    composition: 'what your body-composition scan says is improving and what to watch — visceral fat, BMR, lean and fat mass, body water',
    balance: 'any left/right difference in that scan, such as “legs: left 12% behind”',
};
/** The bullets, in reading order. What the screen renders. */
exports.REPORT_SHARE_BULLETS = exports.REPORT_HEALTH_KINDS.map((k) => exports.REPORT_SENT_WITH_PERMISSION[k]);
/**
 * The health half as plain lines, ready for `weeklyFacts`.
 *
 * Blank and whitespace-only lines are dropped. The screen builds its list with
 * `cond ? line : ''` throughout and an empty string reaching the model as a
 * fact line is a blank fact.
 */
function reportHealthLines(facts) {
    return facts.map((f) => String(f.line ?? '').trim()).filter(Boolean);
}
/**
 * Which kinds this member's report would actually send right now.
 *
 * Not currently rendered, and here for one reason: it is the check that the
 * bullet list is a superset of the payload. See the test — a kind that can
 * appear in the payload and has no bullet is the whole defect this module is
 * about.
 */
function kindsPresent(facts) {
    const seen = new Set();
    for (const f of facts)
        if (String(f.line ?? '').trim())
            seen.add(f.kind);
    return exports.REPORT_HEALTH_KINDS.filter((k) => seen.has(k));
}
