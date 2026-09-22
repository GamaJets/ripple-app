// Which clients are about to turn up with nothing on their session packs.
//
// The coach's Needs Attention reason for it. Per CLIENT, not per pack: a client
// with one spent pack and one bought yesterday has plenty, so every paid pack
// they hold is summed through `packBalance` (src/lib/packDraw.ts) — the same
// figure the client's own screen shows, expired packs excluded.
//
// Null under anything but a whole read: a page of a coach's sales cannot say
// that a client has nothing left, because the pack that says otherwise may be
// on the page that did not come back. A client who never bought a pack is not
// "out of credits"; they are simply not in the result.
//
// ponytail: a client whose last pack ran out long ago and who now pays some
// other way stays flagged; add a recency cut if coaches find that noisy.
//
// Pure — no react, no supabase, no clock.
import { packBalance, type PackPurchase } from './packDraw';

/** At or below this many sessions, the balance is worth a word. */
export const CREDITS_LOW_AT = 1;

export interface CreditsFlag { left: number; out: boolean }

export function creditsLow(
  rows: readonly (PackPurchase & { client_id?: string | null })[],
  whole: boolean,
): Map<string, CreditsFlag> | null {
  if (!whole) return null;
  const byClient = new Map<string, PackPurchase[]>();
  for (const r of rows) {
    if (!r.client_id) continue;
    const had = byClient.get(r.client_id);
    if (had) had.push(r); else byClient.set(r.client_id, [r]);
  }
  const flagged = new Map<string, CreditsFlag>();
  for (const [cid, packs] of byClient) {
    const b = packBalance(packs);
    if (!b.lines.length || b.left == null) continue;
    if (b.left <= CREDITS_LOW_AT) flagged.set(cid, { left: b.left, out: b.left === 0 });
  }
  return flagged;
}

/** The row's words: its state and the line beside it. */
export function creditsLine(f: CreditsFlag): { state: string; line: string } {
  return f.out
    ? { state: 'Out of Credits', line: 'No sessions left on their packs.' }
    : { state: 'Credits Running Low', line: `${f.left} session${f.left === 1 ? '' : 's'} left on their packs.` };
}
