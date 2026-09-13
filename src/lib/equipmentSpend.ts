// What a machine has cost — the register and the books, joined without being
// added together.
//
// ── The defect ─────────────────────────────────────────────────────────────
//
// Part 186 gave a machine a history: `gym_equipment_log` holds every service,
// repair, inspection, clean and incident, with the engineer, the findings, the
// day, and — in `cost_cents` — what it cost. Part 700 gave a gym a P&L:
// `gym_costs`, one of whose categories is literally 'maintenance'.
//
// The two could not point at each other, so a gym servicing a rack recorded the
// service on one screen and the money on another and got to keep one answer or
// the other:
//
//   · in the log, the figure is invisible to every money screen in the product
//     — /accounting's Money out, /close's month-end, /tax's period figures and
//     /costs' budget comparison all read `gym_costs` and none reads that table.
//     The gym's own P&L is short by the whole of its maintenance spend;
//   · in /costs, the money is in the books and nothing on the row says which
//     machine, so "what has this rack cost us" — the question that decides
//     repair or replace — has no answer.
//
// supabase/parts/2850 is the link. This is the rule over it.
//
// ── THE FIGURE THIS MODULE EXISTS TO NOT PRODUCE ──────────────────────────
//
// `gym_equipment_log.cost_cents` and the linked `gym_costs.amount_cents` are
// TWO CLAIMS ABOUT THE SAME MONEY. Adding them gives exactly twice what the gym
// spent, and the arithmetic is invisible at the call site: both are integers in
// minor units, both are about the same repair, and both are sitting in scope.
//
// So `machineSpend` answers out of the BOOKS and only the books. The linked
// `gym_costs` rows, deduplicated by cost id — because one engineer's invoice
// covering three machines is one cost and three log entries, which is the whole
// reason part 2850 put the column on the log side — and nothing else. Log
// figures that reached no cost are NAMED, separately, as money the register
// knows about and the accounts do not, which is a finding rather than a
// subtotal.
//
// Nor are the two reconciled. They will often disagree for entirely ordinary
// reasons — one invoice over three machines, a call-out fee in the books and
// the parts on the log, a quote typed here and the final bill typed there — and
// `disagrees` reports the disagreement rather than picking a side. A screen
// showing a gym's maintenance spend must be able to say "these two records do
// not agree about this repair", because that sentence is true and useful and
// the alternative is a number that is quietly one of them.
//
// ── Currencies are never summed, and the gap is never zero ────────────────
//
// `gymCostsTaken`'s shape, reused rather than re-derived: one `Pot` per
// currency, and rows with an amount but no currency counted as `unlabelled`
// instead of being folded into whichever neighbour looked likeliest. A gym that
// paid a British engineer in pounds and a German one in euros has two amounts
// of money and not a sum, and `sumTaken` is the one place in this codebase that
// arithmetic lives.
//
// ── An unread link is not an unlinked entry ───────────────────────────────
//
// Every answer here is gated on `isWhole`. A refused read of the links has no
// rows, and no rows reads as "none of this is in the books" — which would send
// an owner to type a fortnight of costs that are already in their accounts, and
// then their P&L really would be wrong. 'partial' is refused with the failures:
// a truncated link read drops rows, and a spend figure short by an unknown
// number of invoices is the figure somebody replaces a rack on.
//
// ── Why this reads the log itself instead of using `fetchLog` ─────────────
//
// src/lib/gymEquipment.ts already pages this table and maps it, and its
// `LogEntry` does not carry `cost_id` — the column did not exist until today.
// That file belongs to another lane in this wave and is left alone; this module
// reads the four columns the link needs and nothing else, which is also a
// narrower read than the log screen's and is the read every caller here wants.
// When somebody is next in `gymEquipment.ts`, `LogEntry` should grow `costId`
// and `fetchSpendLinks` should go — the duplication is written down here rather
// than left for a reader to discover.
//
// Pure apart from the reads and the two writes at the bottom, which take the
// Supabase client as an argument the way src/lib/gymCosts.ts does.
import { readAll } from './rowCap';
import { readByIds } from './idLookup';
import { assertWrote } from './wroteRows';
import { sumTaken, type Taken, type TakenRow } from './coachMoney';
import { isWhole, type LoadStatus } from '../ui/loadStatus';
import type { GymCost } from './gymCosts';

type Queryable = { from: (table: string) => any };

/* ── the half of a log entry the money question needs ─────────────────────── */

/**
 * One maintenance record, as far as spend is concerned.
 *
 * Deliberately NOT `LogEntry` from src/lib/gymEquipment.ts. That type is what a
 * history screen renders — findings, engineer, who reported it onward — and
 * none of it bears on what the machine cost. See the header for why this is
 * read separately rather than by widening that one.
 */
export interface SpendEntry {
  id: string;
  equipmentId: string | null;
  /** What the machine was called at the time. Part 186 keeps it because the
   *  reference is `on delete set null`, and a spend line reading "somebody
   *  serviced something" is not a spend line. */
  equipmentLabel: string | null;
  kind: string;
  /** `YYYY-MM-DD`, the day the work happened. */
  happenedOn: string;
  /**
   * The figure typed on the LOG, in minor units. This is not money in the
   * books — see the header — and nothing in this module adds it to a cost.
   */
  costCents: number | null;
  currency: string | null;
  /** The `gym_costs` row this entry's money is recorded in, or null. */
  costId: string | null;
}

export const SPEND_COMES_FROM_THE_BOOKS_NOTE =
  'What a machine has cost is read from the gym’s costs — the rows in the books — and never from the '
  + 'figures typed on the maintenance log. The two are separate records of the same money, they are '
  + 'never added together, and a repair that was written on the log and never entered as a cost is '
  + 'listed below rather than counted.';

export const SPEND_IS_NOT_RECONCILED_NOTE =
  'Nothing here checks that the log and the books agree about a repair, and they often will not: one '
  + 'engineer’s invoice can cover three machines, a call-out fee and the parts can be entered '
  + 'separately, and a quote is not a bill. Where they disagree it is said so, and neither figure is '
  + 'corrected from the other.';

/* ── what a machine has cost ──────────────────────────────────────────────── */

/** A log entry whose own figure does not match the cost it points at. Reported,
 *  never reconciled. */
export interface SpendDisagreement {
  entry: SpendEntry;
  cost: GymCost;
  /** Which kind of disagreement, so a screen can say the right sentence.
   *  'currency' is the serious one: two currencies about one repair is the
   *  house rule's refusal case, not a rounding difference. */
  kind: 'amount' | 'currency';
}

export type MachineSpend =
  /** The links or the costs were not read, or not read whole. Nothing may be
   *  stated — see the header: "none of this is in the books" out of a failed
   *  read sends an owner to re-type costs they already have. */
  | { state: 'unread'; why: string }
  | {
    state: 'known';
    /** One pot per currency, OUT OF THE BOOKS, deduplicated by cost id. */
    taken: Taken;
    /** How many distinct `gym_costs` rows that is. Not how many log entries:
     *  three machines on one invoice is one cost. */
    costs: number;
    /**
     * Entries carrying a figure on the log that reaches no cost row at all.
     * NAMED rather than counted, for `periodMovingNote`'s reason in
     * src/lib/gymTax.ts, and never summed into `taken` — that is the double
     * count this module exists to refuse.
     */
    offBooks: readonly SpendEntry[];
    /** Entries linked to a cost that disagrees with them. */
    disagrees: readonly SpendDisagreement[];
    /**
     * Entries naming a cost id that was not among the costs handed over.
     * Usually a cost the owner deleted — part 700 makes deletion the ordinary
     * way to correct one and part 2850 sets the link null on it, so this is
     * mostly a read that did not fetch far enough, and it is reported rather
     * than silently dropped from the count.
     */
    dangling: number;
  };

/**
 * What this set of log entries has cost the gym, out of the books.
 *
 * `costsById` is the linked costs, however the caller got them —
 * `fetchCostsByIds` below, or a month's costs already on the screen. Null means
 * they were not read, which is not the same as there being none.
 */
export function machineSpend(
  entries: readonly SpendEntry[],
  costsById: Map<string, GymCost> | null,
  status: LoadStatus,
): MachineSpend {
  // `isWhole`, not `!== 'error'`. A prefix of the links is a spend figure short
  // by an unknown number of invoices, printed beside a decision to replace a
  // machine.
  if (!isWhole(status) || !costsById) {
    return {
      state: 'unread',
      why: status === 'loading'
        ? 'Still reading what this has cost.'
        : status === 'partial'
          ? 'More maintenance records are on file than could be read in one request, so what this has cost cannot be stated. What is listed is real; it is not all of it.'
          : 'What this has cost could not be read. That is not the same as it having cost nothing, and nothing recorded in the books has changed.',
    };
  }

  // Deduplicated by COST id, which is the whole reason part 2850 put the column
  // on the log side: one engineer's invoice covering three machines is one cost
  // and three entries, and counting it once per entry would treble it.
  const seen = new Map<string, GymCost>();
  const offBooks: SpendEntry[] = [];
  const disagrees: SpendDisagreement[] = [];
  let dangling = 0;

  for (const e of entries) {
    if (!e.costId) {
      // A figure on the log that never reached the books. An entry with NO
      // figure is not here: a warranty service or a clean that cost nothing is
      // not missing from the accounts, and listing it would bury the ones that
      // are under the ones that are not.
      if (e.costCents != null && Number.isFinite(e.costCents)) offBooks.push(e);
      continue;
    }
    const cost = costsById.get(e.costId);
    if (!cost) { dangling += 1; continue; }
    seen.set(e.costId, cost);
    if (e.costCents == null || !Number.isFinite(e.costCents)) continue;
    // Currency first, and it is its own kind. Two currencies about one repair
    // is not a rounding difference — it is the case the house rule refuses to
    // resolve, and a screen must name both rather than compare the numbers.
    const a = (e.currency || '').trim().toUpperCase();
    const b = (cost.currency || '').trim().toUpperCase();
    if (a && b && a !== b) { disagrees.push({ entry: e, cost, kind: 'currency' }); continue; }
    if (cost.amountCents != null && cost.amountCents !== e.costCents) {
      disagrees.push({ entry: e, cost, kind: 'amount' });
    }
  }

  const taken = sumTaken([...seen.values()].map((c): TakenRow => ({
    amount_cents: c.amountCents,
    currency: c.currency,
    // The day the money went out, never the day the row was written — a
    // quarter of receipts entered in one evening must not all land in that
    // evening's month. `gymCostsTaken` passes the same thing for the same
    // reason.
    created_at: c.paidOn,
  })));

  return { state: 'known', taken, costs: seen.size, offBooks, disagrees, dangling };
}

/**
 * What to say about the entries whose money never reached the books.
 *
 * NO FIGURE IN IT, on purpose. The amounts are on the log in whatever currency
 * somebody typed and this is a sentence about a gap in the accounts; a total
 * here would be a maintenance spend figure computed from the record that is not
 * the money record, which is the confusion the whole module is built to avoid.
 * The screen lists the entries underneath with their own amounts beside them.
 */
export function offBooksNote(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? 'One maintenance record carries a figure that is in no cost row, so it is not in the books and is not counted above. Enter it as a cost and link it, or leave it — but it is not in this gym’s P&L as things stand.'
    : `${n} maintenance records carry figures that are in no cost row, so they are not in the books and are not counted above. Each is money this gym’s P&L does not know about.`;
}

/** The entries a machine's spend cannot see, newest first — the working list
 *  for getting a fortnight of repairs into the accounts. */
export function offBooksFirst(entries: readonly SpendEntry[]): SpendEntry[] {
  return [...entries].sort((a, b) =>
    (a.happenedOn < b.happenedOn ? 1 : a.happenedOn > b.happenedOn ? -1 : b.id.localeCompare(a.id)));
}

/* ── linking one to the other ─────────────────────────────────────────────── */

/**
 * Why this log entry cannot be linked to this cost, or null when it can.
 *
 * Deliberately permissive about the AMOUNTS and strict about the currency. A
 * cost that is larger than the log's figure is the ordinary case — one invoice
 * over three machines — and refusing it would refuse the very shape part 2850
 * was built for. Two different currencies about one repair is the one case that
 * cannot be a legitimate difference of scope, and it is the house rule's
 * refusal: name both and do not resolve it.
 */
export function linkBlocker(entry: SpendEntry, cost: GymCost | null): string | null {
  if (!cost) {
    return 'Choose a cost to link this to. If the money is not in the books yet, record it on the costs screen first — linking cannot create a cost, and a cost nobody typed is not one.';
  }
  if (entry.costId && entry.costId !== cost.id) {
    return 'This entry is already linked to a cost. Unlink it first — an entry pointing at two costs would count the same repair twice, which is the one thing this must not do.';
  }
  const a = (entry.currency || '').trim().toUpperCase();
  const b = (cost.currency || '').trim().toUpperCase();
  if (a && b && a !== b) {
    return `This entry says ${a} and that cost says ${b}. Two currencies about one repair is not a difference this can absorb — check which is right, and correct the one that is wrong, before linking them.`;
  }
  return null;
}

/**
 * The costs behind a set of log entries, by id.
 *
 * Chunked through `readByIds`, because a machine with ten years of servicing
 * carries more ids than one `.in()` may safely hold — and a bare `.in()` past
 * the chunk size truncates silently, which here is a maintenance total short by
 * whichever invoices fell off the end.
 */
export async function fetchCostsByIds(
  sb: Queryable, tenantId: string, ids: Iterable<string | null | undefined>,
): Promise<Map<string, GymCost>> {
  const rows = await readByIds<any>(
    ids,
    (chunk, from, to) => sb
      .from('gym_costs')
      .select('id, description, supplier, category, amount_cents, currency, paid_on, note, created_at')
      .eq('tenant_id', tenantId)
      .in('id', chunk)
      .order('paid_on', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    'the costs behind this gym’s maintenance records',
  );
  const out = new Map<string, GymCost>();
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      description: r.description ?? '',
      supplier: r.supplier ?? null,
      category: r.category ?? 'other',
      // Not `?? 0`. A cost with no amount is money of unknown size, and
      // `sumTaken` counts it as unpriced rather than shrinking the total by it.
      amountCents: r.amount_cents ?? null,
      // Not `?? 'AED'`. Part 700 makes this NOT NULL, so this branch does not
      // fire against a healthy database — and "in practice" is what every
      // currency bug in this repo was made of, so it is written anyway.
      currency: r.currency ?? null,
      paidOn: r.paid_on,
      note: r.note ?? null,
      createdAt: r.created_at ?? null,
    });
  }
  return out;
}

/**
 * Every maintenance record this gym holds, as far as spend is concerned.
 *
 * Paged rather than capped, which is part 186's own argument for `fetchLog`:
 * nothing here is ever deleted — it is the accident book — so a gym that has
 * been open a while crosses any ceiling, and what a truncated read drops is the
 * OLDEST entries, which are exactly the ones a ten-year maintenance total is
 * made of. `readAll`'s `PAGE_CEILING` still refuses past fifty thousand, which
 * is a sentence about the size of the read rather than about the gym.
 *
 * `happened_on` is a DATE and a gym that bulk-imported its history has hundreds
 * tied on one, so `id` closes the total order `readAll` requires — without it,
 * pages of a tied ordering drop and repeat rows silently, and a repeated row
 * here is one invoice counted twice.
 */
export async function fetchSpendLinks(
  sb: Queryable, tenantId: string, equipmentId?: string,
): Promise<SpendEntry[]> {
  const rows = await readAll<any>(
    (from, to) => {
      let q = sb
        .from('gym_equipment_log')
        .select('id, equipment_id, equipment_label, kind, happened_on, cost_cents, currency, cost_id')
        .eq('tenant_id', tenantId);
      if (equipmentId) q = q.eq('equipment_id', equipmentId);
      return q
        .order('happened_on', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
    },
    "this gym's maintenance records and what they cost",
  );
  return rows.map((r: any) => ({
    id: r.id,
    equipmentId: r.equipment_id ?? null,
    equipmentLabel: r.equipment_label ?? null,
    kind: r.kind ?? 'service',
    happenedOn: r.happened_on,
    costCents: Number.isFinite(r.cost_cents) ? r.cost_cents : null,
    currency: r.currency ?? null,
    costId: r.cost_id ?? null,
  }));
}

/* ── the writes ───────────────────────────────────────────────────────────── */

/**
 * Say that this maintenance record's money is this cost.
 *
 * It writes ONE column on ONE row and nothing else. In particular it does not
 * copy the amount either way: `cost_cents` stays whatever the log said and
 * `amount_cents` stays whatever the books said, because they are two claims and
 * overwriting one from the other would destroy the disagreement `machineSpend`
 * is built to report. Part 2850's header refuses the same thing at the schema
 * level, and for the same reason.
 *
 * It also creates no cost. `recordGymCost` in src/lib/gymCosts.ts is the only
 * writer of that table and stays so — a link that could mint a cost row would
 * put money in a gym's accounts that nobody typed.
 *
 * THE COUNT IS CHECKED, not `error` alone. Part 186 gives a trainer SELECT and
 * INSERT on this table and no UPDATE at all, and part 2850 narrows their insert
 * away from `cost_id` entirely — so this update run by anybody but the owner
 * matches ZERO ROWS and returns `error: null`, and the screen would report the
 * repair as being in the books while the gym's P&L still does not know about
 * it. See src/lib/wroteRows.ts.
 */
export async function linkLogToCost(
  sb: Queryable, logId: string, costId: string,
): Promise<void> {
  const r = await sb
    .from('gym_equipment_log')
    .update({ cost_id: costId }, { count: 'exact' })
    .eq('id', logId)
    .select('id, cost_id');
  if (r.error) throw r.error;
  assertWrote('That maintenance record', r);
  const row = (r.data as any[] | null)?.[0];
  if (!row || row.cost_id !== costId) {
    throw new Error(
      'That maintenance record may not have been linked: the row came back without the cost on it. '
      + 'Reload this page and check before linking it again — nothing about the cost itself has been '
      + 'changed either way.',
    );
  }
}

/**
 * Take the link off again.
 *
 * The entry stays and the cost stays; only the sentence joining them goes. This
 * is the correction for a link made to the wrong invoice, and it is a separate
 * act from deleting either record because neither record is wrong — part 2850
 * puts `on delete set null` on the reference for the same reason, so that
 * correcting a cost cannot take a machine's service history with it.
 */
export async function unlinkLogFromCost(sb: Queryable, logId: string): Promise<void> {
  const r = await sb
    .from('gym_equipment_log')
    .update({ cost_id: null }, { count: 'exact' })
    .eq('id', logId);
  if (r.error) throw r.error;
  assertWrote('That link', r);
}
