"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zoneState = zoneState;
exports.zonelessNote = zonelessNote;
exports.selfHealLabel = selfHealLabel;
exports.noZoneToOfferNote = noZoneToOfferNote;
exports.selfHealConfirm = selfHealConfirm;
exports.selfHealResult = selfHealResult;
const loadStatus_1 = require("../ui/loadStatus");
/**
 * The state, from the count and the read that produced it.
 *
 * `total` is deliberately a parameter rather than inferred from `zoneless`: a
 * coach with no availability at all has nothing being skipped, and telling them
 * their slots have stopped generating would send them looking for a fault that
 * is really an empty week.
 */
function zoneState(zoneless, total, status) {
    if (!(0, loadStatus_1.isWhole)(status) || zoneless == null)
        return 'unknown';
    if (total === 0)
        return 'all-zoned';
    return zoneless > 0 ? 'some-zoneless' : 'all-zoned';
}
/**
 * What to say above the availability grid, or null when there is nothing to
 * report.
 *
 * 'all-zoned' returns null on purpose. A banner that appears when everything is
 * working is a banner nobody reads by the third week, and the one time it
 * matters it will be skimmed past with the rest.
 */
function zonelessNote(state, zoneless) {
    if (state === 'unknown') {
        return 'Your weekly hours could not be read in full, so Repple cannot say whether your open slots are being generated. This is not an all-clear — pull down to refresh.';
    }
    if (state !== 'some-zoneless' || !zoneless)
        return null;
    const n = zoneless === 1 ? 'One of your weekly hours has' : `${zoneless} of your weekly hours have`;
    const they = zoneless === 1 ? 'it' : 'them';
    return `${n} no timezone recorded, so Repple is not opening ${they} for booking. `
        + `07:00 is not a moment until something says which clock it is on, and guessing would put your slot at the wrong hour — `
        + `a client would book it and arrive to an empty gym.\n\n`
        + `Until this is set, your clients see nothing to book at ${zoneless === 1 ? 'that time' : 'those times'}.`;
}
/**
 * The button, or null when there is no honest one to offer.
 *
 * A zone this device cannot name is not a zone to write. `deviceZone()` already
 * refuses a runtime that answers `UTC` for want of full ICU, and this refuses
 * the rest: with no zone in hand there is nothing to press, and the coach is
 * told to set the gym's instead.
 */
function selfHealLabel(state, zone) {
    if (state !== 'some-zoneless')
        return null;
    return zone ? `Use this phone’s timezone (${zone})` : null;
}
/** Why the button is missing, when it is missing and the problem is not. */
function noZoneToOfferNote(state, zone) {
    if (state !== 'some-zoneless' || zone)
        return null;
    return 'This phone cannot say which timezone it is in, so there is nothing here to apply. '
        + 'Setting your gym’s timezone in the console fills this in for every coach at that gym.';
}
/**
 * What the coach is agreeing to. Named in full, because it is a statement about
 * hours their clients will be able to book, and the coach is the only one who
 * knows whether they set those hours where they are standing now.
 */
function selfHealConfirm(zoneless, zone) {
    const n = zoneless === 1 ? 'your one unzoned hour' : `all ${zoneless} of your unzoned hours`;
    return `This records ${zone} against ${n}, and Repple will start opening ${zoneless === 1 ? 'it' : 'them'} for booking from tonight.\n\n`
        + `Only do this if those hours are ${zone} hours. If you set your week while you were somewhere else, `
        + `the slots would open at the wrong time of day and your clients would book them.`;
}
/** What happened, said as what it means rather than as a row count. */
function selfHealResult(saved, asked, zone) {
    if (saved === 0) {
        return `Nothing was changed — the timezone could not be saved, so your hours are still not being opened. Try again when you have a connection.`;
    }
    const head = saved === 1
        ? `One hour is now recorded as ${zone} and will be opened for booking tonight.`
        : `${saved} hours are now recorded as ${zone} and will be opened for booking tonight.`;
    if (saved === asked) {
        return `${head}\n\nTo open them right now instead of waiting, use Generate Open Slots.`;
    }
    const left = asked - saved;
    return `${head}\n\n${left === 1 ? 'One hour was' : `${left} hours were`} not saved and ${left === 1 ? 'is' : 'are'} still not being opened. Try again.`;
}
