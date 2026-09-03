"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.intakeDraftKey = exports.INTAKE_DRAFT_PREFIX = void 0;
exports.parseIntakeDraft = parseIntakeDraft;
exports.serialiseIntakeDraft = serialiseIntakeDraft;
exports.draftDecision = draftDecision;
exports.draftHasContent = draftHasContent;
// The intake form, kept on the phone until it can be sent.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// `app/(client)/intake.tsx` held the whole seven-section form in
// `useState<Intake | null>` and `src/ui/intake.ts` touched no storage at all.
// Two consequences, and the second is worse than the first:
//
//   · Typed and backed out is gone. A medical and training history is the
//     longest thing anybody types into this app, and nothing kept a word of it
//     between one visit to the screen and the next.
//   · Offline it could not be started. The read fails, `status` is 'error',
//     `canSave` is false, and the screen shows a Flag instead of a form. The
//     copy told them to "Check your connection and press Save again", which
//     `src/lib/reachability.ts` exists to replace — and the screen promises, a
//     few hundred lines further down, "You can save a half-finished form and
//     come back."
//
// A gym reception with no signal is exactly where somebody fills this in.
//
// ── What this does NOT change ──────────────────────────────────────────────
//
// The screen's own header states the rule that governs everything here:
//
//     "It must not save over a document it could not read. If the read failed,
//      what is on screen is an empty form standing in for one that may be full,
//      and saving it would replace a real disclosure with a blank."
//
// That stands, and nothing below softens it. Keeping a draft on the device is a
// different act from writing one to the server: a draft is never sent by
// itself, the Save control is still withheld until the read lands, and when it
// does land `draftDecision` refuses to let a draft silently replace answers it
// was not built from. What changes is only that the words survive.
//
// Pure and in src/lib because the decision is the delicate part. The
// AsyncStorage half is in src/ui/intake.ts.
const intake_1 = require("./intake");
/** Per account: two people sharing a phone must not inherit each other's
 *  half-finished medical history. Versioned, so a shape change cannot read old
 *  bytes as new ones. */
exports.INTAKE_DRAFT_PREFIX = 'intake:draft:v1:';
const intakeDraftKey = (uid) => `${exports.INTAKE_DRAFT_PREFIX}${uid ?? 'anon'}`;
exports.intakeDraftKey = intakeDraftKey;
/** Read one back. Null when the bytes are missing or unreadable — a draft that
 *  cannot be parsed is not a draft, and there is nothing here to preserve by
 *  distinguishing the two: the form is still on the server. */
function parseIntakeDraft(raw) {
    if (!raw)
        return null;
    try {
        const o = JSON.parse(raw);
        if (!o || typeof o !== 'object')
            return null;
        const at = typeof o.at === 'string' ? o.at : '';
        if (!at)
            return null;
        const intake = (0, intake_1.parseIntake)(o.intake ?? null);
        if (!intake)
            return null;
        return { at, basedOn: typeof o.basedOn === 'string' ? o.basedOn : null, intake };
    }
    catch {
        return null;
    }
}
/** What goes to the disk. */
function serialiseIntakeDraft(d) {
    return JSON.stringify({ at: d.at, basedOn: d.basedOn, intake: { ...d.intake, version: intake_1.INTAKE_VERSION } });
}
function draftDecision(draft, server) {
    if (!draft)
        return 'none';
    if (!server)
        return 'restore';
    if (draft.basedOn && draft.basedOn === server.updatedAt)
        return 'restore';
    return 'ask';
}
/**
 * Whether a draft still has anything in it worth keeping.
 *
 * Used to avoid writing an empty document to the disk on every keystroke that
 * clears the last field, and to avoid offering to "restore" a blank over a real
 * one. Deliberately shallow: any answered readiness question, any non-empty
 * string, any number. An intake with one sentence in it is worth keeping.
 */
function draftHasContent(intake) {
    if (!intake)
        return false;
    if (Object.keys(intake.readiness ?? {}).length > 0)
        return true;
    const h = intake.history, w = intake.want, tr = intake.tried;
    const a = intake.availability, p = intake.practical, e = intake.emergency;
    const strs = [
        h?.doingNow, w?.headline, w?.by, w?.why, tr?.worked, tr?.didnt, tr?.wont,
        a?.equipment, p?.anythingElse, e?.name, e?.phone, e?.relation,
    ];
    if (strs.some((s) => typeof s === 'string' && s.trim().length > 0))
        return true;
    const nums = [h?.years, a?.daysPerWeek, a?.sessionMins, p?.sleepHours];
    if (nums.some((n) => typeof n === 'number'))
        return true;
    if ((h?.kinds?.length ?? 0) > 0 || (a?.times?.length ?? 0) > 0)
        return true;
    if (h?.coachedBefore != null || a?.place != null || p?.work != null)
        return true;
    return false;
}
