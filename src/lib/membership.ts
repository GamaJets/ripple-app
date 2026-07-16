// Membership helpers — a member's card number, plan and validity. In a real gym
// deployment these come from the gym's system; here they're derived/defaulted so
// the card + access barcode render for any signed-in member.

export interface Membership { memberNo: string; plan: string; validUntil: string }

/** Stable member number derived from the user (e.g. RPL-4821). */
export function memberNoFrom(name: string, id: string): string {
  const seed = id || name || 'repple';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 'RPL-' + (1000 + (h % 9000));
}

/** Default plan/validity a year out (until wired to the gym's billing). */
export function defaultMembership(name: string, id: string): Membership {
  const d = new Date(); d.setFullYear(d.getFullYear() + 1);
  const until = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  return { memberNo: memberNoFrom(name, id), plan: 'Member', validUntil: until };
}
