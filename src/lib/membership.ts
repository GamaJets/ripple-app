// Membership helpers — the member number the app shows on the membership card
// and encodes into the entry barcode. Derived from the signed-in user so it is
// stable for that user; no gym billing system issues it.
//
// `defaultMembership()` used to sit here too, returning a plan of "Member" and a
// validity of exactly one year from today. Both were printed on the membership
// card as though a gym had issued them. Nothing ever set them, so they are gone
// rather than replaced.

/** Stable member number derived from the user (e.g. RPL-4821). */
export function memberNoFrom(name: string, id: string): string {
  const seed = id || name || 'repple';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 'RPL-' + (1000 + (h % 9000));
}
