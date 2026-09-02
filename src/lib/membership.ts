// The member number the app shows on the membership card and encodes into the
// entry barcode.
//
// Derived from the signed-in user, so it is the same number every time that
// person opens the screen, on any device, with nothing stored. No gym billing
// system issues it.
//
// `defaultMembership()` used to sit here too, returning a plan of "Member" and a
// validity of exactly one year from today. Both were printed on the membership
// card as though a gym had issued them. Nothing ever set them, so they are gone
// rather than replaced.
//
// ── The defect this file was rewritten to end ────────────────────────────
//
// The whole derivation was:
//
//     let h = 0;
//     for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
//     return 'RPL-' + (1000 + (h % 9000));
//
// Nine thousand buckets. By the birthday bound a collision becomes more likely
// than not at about 112 members — so a mid-sized gym that follows the
// instruction on app/(client)/access.tsx ("Give it to reception once and they
// can link it to your account — after that the entrance scanner will read it")
// eventually links two people to the same number, and the turnstile opens for
// the wrong one. The header here described the number as "stable for that user"
// and never as unique, which it was not.
//
// ── What it is now, and the bound that goes with it ──────────────────────
//
// Forty-six bits, written as nine base-36 characters. Code 39 encodes 0-9 and
// A-Z, so base 36 is exactly the alphabet the barcode can carry and every
// character earns 5.17 bits instead of the 3.32 a digit earns — which is why
// the number is nine characters rather than the fourteen digits the same space
// would need.
//
// 2^46 is 7.04e13 buckets. The birthday bound puts an even chance of ONE
// collision anywhere in the world at about 9.9 million members; inside a single
// gym of ten thousand the probability is about seven in ten million. That is
// not a guarantee of uniqueness and this file does not claim one — the id it
// hashes is unique, the hash of it is not — but it is the difference between
// "will happen to any gym with a few hundred members" and "will not happen".
//
// The number a member has already given to reception CHANGES with this. There
// was no way to widen nine thousand buckets while preserving what came out of
// them, and a number two people can share is not one to preserve. Both screens
// that show it say so; see `MEMBER_NO_CHANGED_NOTE` below.
//
// ── Why the prefix is not the literal 'RPL' ──────────────────────────────
//
// This is a white-label build. `access.tsx` already renders "{BRAND.label} ID
// {memberNo}", so a chain's member was shown "Example Fitness ID RPL-4821" —
// their gym's name and their gym's supplier's initials, on the one screen they
// hold out to a person at a turnstile. The prefix is derived from whatever
// brand the build is.
//
// Pure: no imports. The brand is passed in.

/** Letters that survive into a prefix. Code 39 carries A-Z and nothing else
 *  from the Latin alphabet, so anything outside it cannot be encoded. */
const PREFIX_FALLBACK = 'MEM';

/**
 * A three-letter prefix for a brand's name.
 *
 * "Repple" → "REP", "Example Fitness" → "EXA". A brand whose name has fewer
 * than three usable letters — or none, which a non-Latin brand name would
 * produce — gets `MEM`, because a prefix the barcode cannot encode is worse
 * than a generic one.
 */
export function memberPrefix(brandLabel: string | null | undefined): string {
  const letters = String(brandLabel || '').toUpperCase().replace(/[^A-Z]/g, '');
  return letters.length >= 3 ? letters.slice(0, 3) : PREFIX_FALLBACK;
}

/** 2^23. The two 32-bit lanes below are each folded to 23 bits and packed. */
const LANE = 8388608;

/**
 * Stable member number derived from the user — e.g. "REP-3K7QW1ZP4".
 *
 * Two independent 32-bit lanes, each avalanched, folded to 23 bits and packed
 * into one 46-bit integer. Two lanes rather than one because a single 32-bit
 * hash caps the space at 4.29e9 whatever alphabet it is printed in, and 32 bits
 * collides at about 77,000 members — better than nine thousand buckets and
 * still not enough for a chain.
 *
 * `Math.imul` throughout: `h * 2654435761` in double precision loses the low
 * bits of the product, which is the silent way a 32-bit hash becomes a 20-bit
 * one.
 */
export function memberNoFrom(name: string, id: string, brandLabel?: string | null): string {
  const seed = id || name || 'repple';
  let a = 0x9e3779b9 >>> 0;
  let b = 0x85ebca6b >>> 0;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761) >>> 0;
    b = Math.imul(b + c, 1597334677) >>> 0;
    b = ((b << 13) | (b >>> 19)) >>> 0;
  }
  // Final mixing, so that two seeds differing in one character do not produce
  // two numbers differing in one character.
  // Every step ends `>>> 0`. `^` returns a SIGNED 32-bit int, so dropping the
  // shift on the last line of each lane lets a negative value reach the modulo
  // and produces a number with a minus sign in it — which Code 39 encodes as a
  // hyphen and which is a different length from every other number.
  a = ((a ^ (a >>> 15)) >>> 0); a = Math.imul(a, 2246822519) >>> 0; a = ((a ^ (a >>> 13)) >>> 0);
  b = ((b ^ (b >>> 16)) >>> 0); b = Math.imul(b, 3266489917) >>> 0; b = ((b ^ (b >>> 15)) >>> 0);
  const n = (a % LANE) * LANE + (b % LANE);
  return `${memberPrefix(brandLabel)}-${n.toString(36).toUpperCase().padStart(9, '0')}`;
}

/**
 * What both screens that show the number have to say about it.
 *
 * A member who gave reception the old number and is now shown a different one
 * would otherwise conclude the app had broken, present the old number, and be
 * refused at the door with no idea why. Said plainly, once, on each screen.
 */
export const MEMBER_NO_CHANGED_NOTE =
  'This number changed in a recent update, because the old one was short enough '
  + 'that two members of the same gym could end up sharing it. If you have '
  + 'already given reception the old number, give them this one instead.';
