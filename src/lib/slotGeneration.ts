// Why a coach's open slots stopped appearing, said out loud.
//
// ── The failure this exists to make visible ────────────────────────────────
//
// Part 650 turns a coach's weekly availability into bookable slots every night,
// and skips any row whose `tz` is null rather than guessing which clock the
// coach meant. Skipping is the right call — a slot generated in the wrong zone
// is worse than no slot, because a client books it and turns up to an empty
// gym. But part 650 filled nothing in for the rows that already existed, and
// `deviceZone()` in src/ui/availability.ts stamps the zone on INSERT only.
//
// So a coach who set their week before that part landed is in a state with no
// error in it anywhere. The nightly job runs, reports a count, and the count
// silently excludes them. Their availability screen looks exactly as it always
// did. Their clients open the app and find nothing to book, and are told
// nothing, because from the client's side there is nothing to tell: an empty
// day is what an empty day looks like.
//
// That is the shape of bug this codebase exists to refuse. Everything here is
// one sentence: the coach is told their slots are not being generated, which of
// their hours are affected, and what it will cost them until it is fixed.
//
// ── Why the count is nullable ─────────────────────────────────────────────
//
// `null` means the availability read did not come back whole, and it is not
// folded into zero. "None of your hours have this problem" and "we could not
// check your hours" are different sentences and only one of them is an
// all-clear. A coach told the first when the second was true stops looking.
import type { LoadStatus } from '../ui/loadStatus';
import { isWhole } from '../ui/loadStatus';

/** What is known about the zones on a coach's weekly availability. */
export type ZoneState =
  /** Every slot carries a zone; the nightly job will generate all of them. */
  | 'all-zoned'
  /** At least one slot has no zone and is being skipped every night. */
  | 'some-zoneless'
  /** The availability read did not come back whole, so neither is known. */
  | 'unknown';

/**
 * The state, from the count and the read that produced it.
 *
 * `total` is deliberately a parameter rather than inferred from `zoneless`: a
 * coach with no availability at all has nothing being skipped, and telling them
 * their slots have stopped generating would send them looking for a fault that
 * is really an empty week.
 */
export function zoneState(zoneless: number | null, total: number, status: LoadStatus): ZoneState {
  if (!isWhole(status) || zoneless == null) return 'unknown';
  if (total === 0) return 'all-zoned';
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
export function zonelessNote(state: ZoneState, zoneless: number | null): string | null {
  if (state === 'unknown') {
    return 'Your weekly hours could not be read in full, so Repple cannot say whether your open slots are being generated. This is not an all-clear — pull down to refresh.';
  }
  if (state !== 'some-zoneless' || !zoneless) return null;
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
export function selfHealLabel(state: ZoneState, zone: string | null): string | null {
  if (state !== 'some-zoneless') return null;
  return zone ? `Use this phone’s timezone (${zone})` : null;
}

/** Why the button is missing, when it is missing and the problem is not. */
export function noZoneToOfferNote(state: ZoneState, zone: string | null): string | null {
  if (state !== 'some-zoneless' || zone) return null;
  return 'This phone cannot say which timezone it is in, so there is nothing here to apply. '
    + 'Setting your gym’s timezone in the console fills this in for every coach at that gym.';
}

/**
 * What the coach is agreeing to. Named in full, because it is a statement about
 * hours their clients will be able to book, and the coach is the only one who
 * knows whether they set those hours where they are standing now.
 */
export function selfHealConfirm(zoneless: number, zone: string): string {
  const n = zoneless === 1 ? 'your one unzoned hour' : `all ${zoneless} of your unzoned hours`;
  return `This records ${zone} against ${n}, and Repple will start opening ${zoneless === 1 ? 'it' : 'them'} for booking from tonight.\n\n`
    + `Only do this if those hours are ${zone} hours. If you set your week while you were somewhere else, `
    + `the slots would open at the wrong time of day and your clients would book them.`;
}

/** What happened, said as what it means rather than as a row count. */
export function selfHealResult(saved: number, asked: number, zone: string): string {
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
