// What one member has paid, when "one member" has paid in more than one money.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// /members had two of them. The roster's Paid column and the dossier's "Paid,
// all time" tile both rendered `MemberDossier.paidCents`, which is
//
//   pays.reduce((a, p) => a + p.amountCents, 0)
//
// — every payment added together with no regard to `p.currency` — under the
// gym's CURRENT `tenants.currency`. The payments table three inches below
// renders each row with `money(p.amountCents, p.currency)`, honestly.
//
// So a gym that has ever changed currency showed one tile reading AED 4,300
// over a list of GBP and AED rows. That tile is the figure an owner reads down
// the phone when a member queries their account, and it is not a total: it is a
// bigger number with three letters stamped on it that belong to some of its
// parts.
//
// ── Why a verdict rather than a number ─────────────────────────────────────
//
// Because there are seven answers and only one of them is a number, and every
// screen that tried to express this in a ternary picked three of the seven. The
// read may not have finished; it may have failed; it may have come back at the
// row ceiling, whole rows and a partial set; the member may have paid nothing;
// the rows may exist and state no amount or no currency, which is not nothing;
// there may be one currency, which prints; or there may be two, which does not
// and must say why.
//
// The grouping itself is `sumTaken` in src/lib/coachMoney.ts — the same
// function /analytics and /revenue total with — so there is one implementation
// of "never add two currencies" rather than a second one here that can drift
// from it.

import { sumTaken } from './coachMoney';
import type { LoadStatus } from '../ui/loadStatus';

/** One payment, reduced to what a total depends on. */
export interface PaidRow {
  amountCents: number | null;
  currency: string | null;
}

export type PaidTotal =
  /** The payments have not come back yet. Not a figure and not a zero. */
  | { kind: 'loading' }
  /** The read was refused. Emphatically not a zero. */
  | { kind: 'failed' }
  /** The read came back at PostgREST's row ceiling: the rows are real, and
   *  there are more of them than arrived. No total over a prefix is a total,
   *  and — this is the part that has to stay separate from 'failed' — nothing
   *  went wrong with the read. Saying "payments not read" here would be a false
   *  statement about a working query. */
  | { kind: 'partial' }
  /** Read, and there is nothing on record. */
  | { kind: 'none' }
  /** Rows exist and cannot be added: no amount, or no currency on them. */
  | { kind: 'unstated'; count: number }
  /** One currency, which is the only case that prints a figure. `short` counts
   *  rows left out of it, so nobody reads a partial total as the whole. */
  | { kind: 'one'; currency: string; minorUnits: number; short: number }
  /** Two or more currencies. There is no figure — that is the finding. */
  | { kind: 'many'; currencies: string[] };

/**
 * What this member has paid.
 *
 * `state` is the slice state of the payments read, and it is taken separately
 * from the rows for the reason the rest of this codebase keeps them apart: an
 * empty array from a refused read and an empty array from a gym that has never
 * billed this person are the same array.
 *
 * 'partial' is answered from the STATE and never reaches `sumTaken`. It used to
 * fall through to the null-rows line below, which was correct only because
 * `rowsOf` (src/lib/memberView.ts) hands back null for a partial slice, so the
 * rows were always null by the time they got here. Two things were wrong with
 * that. The protection lived in another module and nothing here said so, so a
 * caller that switched to `rowsToShow` — the function whose whole job is to
 * hand over the rows of a partial slice — would have had this function add a
 * prefix up and print it as a lifetime total. And when it did fire, it fired as
 * 'failed', which put "payments not read" under a tile whose payments had been
 * read: a truncated read is not a refused one, and the owner reading that line
 * would go looking for a broken query instead of a longer page.
 */
export function paidTotal(state: LoadStatus | 'ready' | 'loading' | 'failed', rows: readonly PaidRow[] | null): PaidTotal {
  if (state === 'failed' || state === 'error') return { kind: 'failed' };
  if (state === 'partial') return { kind: 'partial' };
  if (state !== 'ready') return { kind: 'loading' };
  if (rows == null) return { kind: 'failed' };

  const t = sumTaken(rows.map((r) => ({ amount_cents: r.amountCents, currency: r.currency, created_at: '' })));
  const unstated = t.unlabelled + t.unpriced;

  if (t.pots.length === 0) {
    return unstated > 0 ? { kind: 'unstated', count: unstated } : { kind: 'none' };
  }
  if (t.pots.length > 1) {
    return { kind: 'many', currencies: t.pots.map((p) => p.currency) };
  }
  return { kind: 'one', currency: t.pots[0].currency, minorUnits: t.pots[0].minorUnits, short: unstated };
}

/**
 * The line under the figure, or the line instead of one.
 *
 * `last` is the caller's already-formatted "last paid" phrase, shown only where
 * there is a whole figure to date — a caption about recency under a tile that
 * is refusing to state a total reads as though the total were fine.
 */
export function paidNote(t: PaidTotal, last?: string): string | undefined {
  switch (t.kind) {
    case 'loading': return undefined;
    case 'failed': return 'payments not read';
    // Deliberately not 'payments not read'. They were read; there are more of
    // them than came back, which is a different thing for the owner to do
    // something about. Worded off `sliceNote`'s 'partial' arm in
    // src/lib/memberView.ts so the tile and the table beside it agree.
    case 'partial': return 'only part of the payments were read, so a total is withheld';
    case 'none': return 'nothing recorded';
    case 'unstated':
      return `${t.count} payment${t.count === 1 ? '' : 's'} on record ${t.count === 1 ? 'states' : 'state'} no amount or no currency, so a total cannot be written`;
    case 'many':
      return `paid in ${t.currencies.join(' and ')} — two currencies are not one total, so the figure is on each payment below instead`;
    case 'one':
      return t.short > 0
        ? `${t.short} further payment${t.short === 1 ? '' : 's'} states no amount or no currency and ${t.short === 1 ? 'is' : 'are'} not in this figure`
        : last;
  }
}
