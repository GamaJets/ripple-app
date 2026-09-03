"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.injuryKey = injuryKey;
exports.ackState = ackState;
exports.programmeChoiceState = programmeChoiceState;
exports.guardInjuries = guardInjuries;
const ALLOWED = { allowed: true, reason: null, label: null, outstanding: [] };
/** The identity of a disclosure for acknowledgement purposes.
 *
 *  Area and severity, not the note and not the id: a client rewording a note
 *  has not told the coach anything new, and a client whose mild knee became
 *  severe has. Ids are not used because the client app mints a fresh one when
 *  a disclosure is edited, which would invalidate the acknowledgement over a
 *  typo. */
function injuryKey(i) {
    return `${i.area}:${i.severity}`;
}
function ackState(status, active, acknowledged) {
    // 'partial' is not 'ready' here for the same reason it is not anywhere else:
    // a list that is some of the acknowledged keys cannot tell a disclosure that
    // was never acknowledged from one whose key did not come back.
    if (status !== 'ready')
        return 'unknown';
    if (!acknowledged || !acknowledged.length)
        return 'none';
    const seen = new Set(acknowledged);
    return active.every((i) => seen.has(injuryKey(i))) ? 'covered' : 'stale';
}
function programmeChoiceState(status, count) {
    if (status === 'error' || status === 'loading')
        return 'unknown';
    if (status === 'partial')
        return count > 0 ? 'partial' : 'unknown';
    return count > 0 ? 'some' : 'none';
}
/**
 * May this coach assign a programme to this client?
 *
 * `disclosures` is how the read of the client's OWN injury list went, and
 * `status` is how the read of the acknowledgement went. Both unknowns are
 * refused for the same reason the overwrite guard refuses one: a programme
 * built without seeing an injury is not undone by finding out later.
 */
function guardInjuries(disclosures, status, active, acknowledged, clientName) {
    // Asked before the empty-list shortcut below, and that order is the whole
    // point. An empty `active` means "they have disclosed nothing" only when the
    // read that produced it finished; under a failed one it means we did not find
    // out. The builder read its client out of the roster, and a roster read that
    // failed left no client, no injuries, and a gate that opened on the silence —
    // the coach was free to assign around disclosures nobody had shown them. It
    // is the same mistake as printing "no injuries disclosed" over a read that
    // never landed, made where it costs somebody their training.
    if (disclosures === 'loading') {
        return {
            allowed: false,
            label: 'Checking Injuries…',
            reason: `Still reading whether ${clientName} has disclosed any injuries. This takes a moment.`,
            outstanding: [],
        };
    }
    if (disclosures === 'error' || disclosures === 'partial') {
        return {
            allowed: false,
            label: 'Injuries Could Not Be Read',
            reason: `${clientName}'s injuries could not be read, so this screen cannot tell whether they have disclosed any. Assigning on the assumption that they have not is exactly what this check exists to stop, so it is held until they load.`,
            outstanding: [],
        };
    }
    if (!active.length)
        return ALLOWED;
    if (status === 'loading') {
        return {
            allowed: false,
            label: 'Checking Injuries…',
            reason: `Still reading whether ${clientName}'s injuries have been acknowledged. This takes a moment.`,
            outstanding: [],
        };
    }
    if (status === 'error' || status === 'partial') {
        return {
            allowed: false,
            label: 'Injuries Could Not Be Read',
            reason: `${clientName} has disclosed injuries and this screen could not confirm they have been acknowledged. Building a programme around an injury nobody has read is the thing this check exists to stop, so it is held until the list loads.`,
            outstanding: [],
        };
    }
    const seen = new Set(acknowledged ?? []);
    const unseen = active.filter((i) => !seen.has(injuryKey(i)));
    if (!unseen.length)
        return ALLOWED;
    const isFirst = !acknowledged || acknowledged.length === 0;
    return {
        allowed: false,
        label: `Read ${clientName}'s Injuries First`,
        reason: isFirst
            ? `${clientName} has disclosed ${countPhrase(active.length)}. Read them and confirm before building a programme around them.`
            : `${clientName} has disclosed ${countPhrase(unseen.length)} since you last confirmed. Read the change before assigning.`,
        // The whole current list, not just the new part: an acknowledgement stands
        // for everything it was made against, and writing only the delta would
        // drop the ones acknowledged earlier out of the record.
        outstanding: active,
    };
}
function countPhrase(n) {
    return n === 1 ? 'an injury' : `${n} injuries`;
}
