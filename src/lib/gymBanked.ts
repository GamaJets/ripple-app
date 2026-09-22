// What the gym's own records say it took, against what the bank says it got.
//
// ── the hole this fills ───────────────────────────────────────────────────
//
// `gym_month_closes` stores `taken_cents`: the sum of `gym_payments` in the
// month, filed and frozen. It is the right figure to file and it is one side of
// a reconciliation. The other side is the bank statement, and until
// supabase/parts/2700 this platform had nowhere at all to put it — so a
// DISAGREEMENT between the register and the statement had nowhere to live.
//
// Every gym has months where the two differ, for reasons that are all ordinary:
// an acquirer settling Friday's card takings on Tuesday, a fee netted off the
// settlement, cash that sat in the safe for a fortnight, a chargeback reversed
// in a later month. None of those is an error. What WAS an error is that the
// owner did the reconciliation, satisfied themselves, and the work evaporated:
// next month the same question, no memory of the last answer, and nothing an
// accountant reading the close could use to tell that anybody had ever looked.
//
// ── the one rule this module is built around ─────────────────────────────
//
//   A bank line is compared ONLY against the register's takings IN ITS OWN
//   CURRENCY, and never against anything else.
//
// Repple is white-label and has no default currency anywhere. A gym taking
// euros at the door and pounds on the card machine has two accounts and two
// statements; `landed − taken` across those is not a variance, it is a
// subtraction of two different things that happens to produce a number. So the
// currency is the key on both sides, a currency present on one side only is
// reported AS THAT rather than as a variance against zero, and the register
// rows that state no currency at all are counted and named and never matched.
//
// ── and the rule underneath it ────────────────────────────────────────────
//
// Null is not zero, and a failed read is not an empty month. A register read
// that did not come back WHOLE (src/ui/loadStatus.ts: 'partial' is a prefix of
// unknown size and may never be totalled) makes every line 'register_unknown'.
// It does not make them 'differs', and it certainly does not make them
// 'agrees' — a gym told its bank matched its books on the strength of a
// truncated read is the worst single sentence this file could produce.
//
// ── what this never does ──────────────────────────────────────────────────
//
// It does not correct anything. `gym_month_closes.taken_cents` is a snapshot,
// and the doctrine in src/lib/coachSettlements.ts holds without exception: the
// snapshot is the record, it is never recomputed, and a disagreement is
// REPORTED. A banked figure is a second recorded fact beside the first. It is
// not netted into the close, it is not summed into anything, and nothing in
// this module writes to `gym_month_closes`.
//
// It is also not a bank feed. Nothing in this product talks to a bank. Every
// figure here is one a person read off a statement and typed, and every
// sentence this module offers a screen says so.
import { assertWrote } from './wroteRows';
import { assertWhole, capLimit } from './rowCap';
import { readByIds } from './idLookup';
import { normaliseCurrency } from './gymRecord';

type Queryable = { from: (table: string) => any };

/** One recorded statement line: what reached one account, for one month. */
export interface BankedMonth {
  id: string;
  monthKey: string;
  /** NOT NULL in the column and half the row's identity — see part 2700. */
  currency: string;
  /** Minor units of `currency`. Signed: a month can net negative at the bank. */
  landedCents: number;
  statementRef: string | null;
  note: string | null;
  recordedBy: string | null;
  recordedByName: string | null;
  recordedAt: string;
  /** Stamped by the trigger on every edit; null until first edited. */
  updatedAt: string | null;
}

/** One currency's worth of register takings, as /close already has them. */
export interface TakenLine {
  /** Null when the payment rows themselves state none — its own fact. */
  currency: string | null;
  cents: number;
  count: number;
}

export type BankLineState =
  /** Both sides stated, in the same currency, and equal to the minor unit. */
  | 'agrees'
  /** Both sides stated and they are not the same. NOT an error — see
   *  `BANK_DIFFERENCE_IS_ORDINARY`. It is a thing that needs an answer. */
  | 'differs'
  /** The register recorded takings in this currency and nobody has said what
   *  reached the bank. Unanswered, which is not the same as reconciled. */
  | 'not_banked'
  /** Money reached the bank in a currency this month's register recorded
   *  nothing in. Reported as itself: a variance against a zero that was never
   *  a figure would read as the gym having lost the lot. */
  | 'not_taken'
  /** The payments read did not come back whole, so the register side is
   *  unknown. Never 'agrees', and never 'differs' either. */
  | 'register_unknown';

export interface BankLine {
  currency: string;
  /** What the register says, or null when it says nothing readable. */
  registerCents: number | null;
  /** What the owner says reached the bank, or null when nobody has said. */
  landedCents: number | null;
  /**
   * landed − register, in minor units of THIS line's currency.
   *
   * Null unless both sides are stated in this one currency. There is no other
   * denomination it could be in, which is the whole reason the line is keyed on
   * a currency rather than on a month.
   */
  deltaCents: number | null;
  state: BankLineState;
  statementRef: string | null;
  note: string | null;
  /** The stored line's id, for an edit. Null when nothing is recorded. */
  id: string | null;
}

/**
 * One line per currency, register beside bank.
 *
 * Sorted by currency code so the list does not reorder itself under an owner
 * between two reads of the same month — the order of `byMethod` follows
 * whatever the payments happened to be, and a reconciliation that moves is one
 * people lose their place in.
 *
 * `registerWhole` is the caller's answer to `isWhole(status)` over the payments
 * read. It is a parameter rather than something inferred from an empty array
 * because those are opposite facts: no takings and no knowledge of the takings
 * produce the same empty list and may not produce the same line.
 */
export function bankLines(
  taken: readonly TakenLine[],
  banked: readonly BankedMonth[],
  registerWhole: boolean,
): BankLine[] {
  // Register side, folded per currency. Rows stating no currency are skipped
  // here and counted by `unstatedTakings` below: they cannot be matched to a
  // statement, and folding them into any code would put money in an account it
  // was never in.
  const register = new Map<string, number>();
  for (const t of taken) {
    const c = normaliseCurrency(t.currency);
    if (!c) continue;
    register.set(c, (register.get(c) ?? 0) + t.cents);
  }

  const rows = new Map<string, BankedMonth>();
  for (const b of banked) {
    const c = normaliseCurrency(b.currency);
    if (!c) continue;
    rows.set(c, b);
  }

  const codes = [...new Set([...register.keys(), ...rows.keys()])].sort();
  return codes.map((currency) => {
    const b = rows.get(currency) ?? null;
    const landedCents = b ? b.landedCents : null;
    // The register's figure is withheld under a read that is not whole, and the
    // `has` is what keeps that distinct from a genuine nil: a currency that
    // appears on the bank side only has no register figure either, and the two
    // must not produce the same state.
    const has = register.has(currency);
    const registerCents = registerWhole && has ? register.get(currency) ?? null : null;
    return {
      currency,
      registerCents,
      landedCents,
      deltaCents: registerCents != null && landedCents != null ? landedCents - registerCents : null,
      state: stateOf(registerWhole, has, registerCents, landedCents),
      statementRef: b ? b.statementRef : null,
      note: b ? b.note : null,
      id: b ? b.id : null,
    };
  });
}

function stateOf(
  registerWhole: boolean, inRegister: boolean,
  registerCents: number | null, landedCents: number | null,
): BankLineState {
  // The read comes first, before any comparison. A truncated payments read
  // makes every comparison on this month meaningless, including the ones that
  // would have come out equal.
  if (!registerWhole) return 'register_unknown';
  if (!inRegister) return 'not_taken';
  if (landedCents == null) return 'not_banked';
  return landedCents === registerCents ? 'agrees' : 'differs';
}

/**
 * How many register lines state no currency at all.
 *
 * `gym_payments.currency` is NOT NULL but carries no ISO check, so a row
 * holding '' states nothing. Those rows are real money and they are
 * unreconcilable: there is no statement they belong to, because there is no
 * account they can be said to have reached. Counted and named on screen rather
 * than folded into the nearest code — which is the substitution this whole tree
 * is built to refuse — and the COUNT is reported without the amount, because a
 * sum over rows that may each be in a different unknown currency is not an
 * amount either.
 */
export function unstatedTakings(taken: readonly TakenLine[]): number {
  let n = 0;
  for (const t of taken) if (!normaliseCurrency(t.currency)) n += t.count;
  return n;
}

/* ── the sentences ─────────────────────────────────────────────────────────── */

/**
 * What a screen says under every figure on this panel.
 *
 * Repple has never spoken to a bank and must not start looking as though it
 * has. A column called "landed" that an accountant took for a
 * machine-verified figure would be worse than no column: it would carry the
 * authority of a reconciliation while being a number somebody typed.
 */
export const BANK_IS_TYPED_NOTE =
  'These are figures somebody read off a bank statement and typed in. Nothing in '
  + 'this app has spoken to a bank, and no figure here has been verified by anyone '
  + 'but the person who entered it.';

/**
 * Why a difference is not a fault.
 *
 * The same argument `driftSince` makes about a closed month that has moved, and
 * for the same reason: a panel that reports every difference in the language of
 * an error trains an owner to stop opening it, and the month it holds something
 * real is the month nobody looks.
 */
export const BANK_DIFFERENCE_IS_ORDINARY =
  'A difference is usually not a mistake. An acquirer settles the last few days '
  + 'of a month into the next one and nets its fee off what it sends, cash can '
  + 'sit in the safe, and a chargeback reverses in the month it is raised rather '
  + 'than the month of the payment. What the difference needs is an answer '
  + 'written down, not a correction.';

/** Why nothing here touches the filed figure. */
export const BANK_CHANGES_NOTHING_NOTE =
  'Recording this changes no figure on the close. What was filed when the month '
  + 'was closed stays filed. It is the record, and it is never recomputed. This '
  + 'is the other side written down beside it.';

/** What this panel says for one line, in the owner's terms. */
export function bankLineNote(line: BankLine, fmt: (cents: number, currency: string) => string): string {
  switch (line.state) {
    case 'register_unknown':
      return 'The payments for this month did not come back whole, so there is nothing here to check '
        + 'the statement against. This is unknown, not nil.';
    case 'not_taken':
      return `The register recorded nothing in ${line.currency} this month. This is not a shortfall of `
        + 'everything. It is money in an account the register does not know about.';
    case 'not_banked':
      return `Nobody has said what reached the bank in ${line.currency}. Until somebody does, this month `
        + 'is unreconciled rather than reconciled.';
    case 'agrees':
      return `The statement matches the register to the ${line.currency}.`;
    default: {
      const d = line.deltaCents ?? 0;
      // Signed in words rather than by a leading minus, which is read as a
      // negative amount of money rather than as a direction.
      return d > 0
        ? `The bank received ${fmt(d, line.currency)} MORE than the register recorded.`
        : `The bank received ${fmt(Math.abs(d), line.currency)} LESS than the register recorded.`;
    }
  }
}

/* ── writing one ───────────────────────────────────────────────────────────── */

export interface BankedDraft {
  /** 'YYYY-MM'. Never derived from a Date here — see the house rule. */
  monthKey: string;
  currency: string | null;
  /** What the owner typed, unparsed. Read once, by `readMinorAmount`, in the
   *  caller — two readers over one box is how a figure comes to be shown as one
   *  amount and stored as another. */
  amountText: string;
  statementRef: string;
  note: string;
}

/**
 * Why this cannot be recorded yet, in the order an owner would hit them.
 *
 * The currency refusal is the one that matters. With no currency there is no
 * number of decimal places, so a typed "1250" could be twelve pounds fifty or
 * twelve hundred and fifty yen, and the row would be filed against a month
 * permanently either way.
 */
export function bankedBlockers(d: BankedDraft): string[] {
  const out: string[] = [];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.monthKey)) out.push('Pick a month first.');
  if (!normaliseCurrency(d.currency)) {
    out.push(
      'Say which currency this statement is in. There is no default: an amount typed against no '
      + 'currency is not an amount of any money, and how many decimal places it has is a property '
      + 'of the currency and of nothing else.',
    );
  }
  if (!d.amountText.trim()) out.push('Type what reached the bank.');
  return out;
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * Every banked line this gym has recorded.
 *
 * Not scoped to the month on screen, for the same reason `fetchCloses` is not:
 * the run of months is the half a reconciliation is read against, and a gym
 * that has answered this question for six months should not be asked to
 * discover that fact one month at a time.
 *
 * `assertWhole` rather than a bare read: a truncated list here would silently
 * drop a currency, and a dropped currency renders as 'not_banked' — "nobody has
 * said what reached the bank" — about a figure somebody DID enter.
 */
export async function fetchBankedMonths(sb: Queryable, tenantId: string): Promise<BankedMonth[]> {
  const { data, error } = await sb
    .from('gym_banked_months')
    .select('id, month_key, currency, landed_cents, statement_ref, note, recorded_by, recorded_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('month_key', { ascending: false })
    .order('currency', { ascending: true })
    .limit(capLimit());
  if (error) throw error;

  const rows = assertWhole(data, 'the bank figures recorded for this gym');
  const names = await namesFor(sb, rows.map((r: any) => r.recorded_by));
  return rows.map((r: any) => ({
    id: r.id,
    monthKey: r.month_key,
    currency: r.currency,
    // Not `?? 0`. The column is NOT NULL, so this branch does not fire against
    // a healthy database — and a zero standing in for an unread figure would
    // be a claim that the bank received nothing.
    landedCents: r.landed_cents == null ? 0 : Number(r.landed_cents),
    statementRef: r.statement_ref ?? null,
    note: r.note ?? null,
    recordedBy: r.recorded_by ?? null,
    recordedByName: r.recorded_by ? names.get(r.recorded_by) ?? null : null,
    recordedAt: r.recorded_at,
    updatedAt: r.updated_at ?? null,
  }));
}

/**
 * Who recorded each line, by id.
 *
 * Chunked through src/lib/idLookup.ts rather than sent as one `.in()`, for the
 * reason `namesFor` in src/lib/gymClose.ts gives at length: a thousand uuids
 * inside `in.("…","…")` is a ~39KB query string against the 8KB request line
 * most CDNs enforce, the refusal is a 414, and supabase-js does not reject on
 * it — it arrives as `data: null`.
 *
 * no-error-ok: an unreadable name renders as a dash beside the figure, and the
 * figure is the thing being reconciled.
 */
async function namesFor(sb: Queryable, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  let rows: any[] = [];
  try {
    rows = await readByIds<any>(
      ids,
      (chunk, from, to) => sb.from('profiles').select('id, full_name')
        .in('id', chunk).order('id', { ascending: true }).range(from, to),
      'the names of the people who recorded these bank figures',
    );
  } catch {
    // Deliberately swallowed. See the doc comment: a missing name costs a dash.
    return new Map();
  }
  return new Map(rows
    .map((p: any) => [p.id, (p.full_name || '').trim()] as [string, string])
    .filter(([, n]: [string, string]) => !!n));
}

/* ── writes ────────────────────────────────────────────────────────────────── */

/**
 * Record — or correct — what reached the bank for one month in one currency.
 *
 * An UPSERT on the three-column unique index, not an insert. An owner who
 * re-reads the statement and finds they typed 40,580 for 40,850 is correcting a
 * transcription, not making a second statement, and two rows saying different
 * things about the same account would leave a screen to pick between them.
 *
 * `recorded_by` is passed rather than defaulted in the column, so a row can
 * never claim an author the caller did not name. `recorded_at` is held by the
 * trigger in part 2700 across an update: it is when this question was first
 * answered, and a correction is not a new answer to a new question.
 *
 * The COUNT is checked, not `error` alone — see src/lib/wroteRows.ts. RLS is
 * `is_owner_of(tenant_id)`, so a write run by anybody else matches zero rows
 * and returns `error: null`, and the screen would then say the month was
 * reconciled while nothing had been stored.
 */
export async function recordBankedMonth(
  sb: Queryable,
  tenantId: string,
  line: {
    monthKey: string;
    currency: string;
    landedCents: number;
    statementRef?: string | null;
    note?: string | null;
    recordedBy: string | null;
  },
): Promise<void> {
  const r = await sb.from('gym_banked_months').upsert({
    tenant_id: tenantId,
    month_key: line.monthKey,
    currency: line.currency.trim().toUpperCase(),
    landed_cents: line.landedCents,
    // Blank is null, not ''. The constraint in part 2700 refuses a present-but-
    // empty value precisely so a field somebody tabbed through cannot render as
    // an answer, and sending '' would fail the write rather than clear the box.
    statement_ref: (line.statementRef ?? '').trim() || null,
    note: (line.note ?? '').trim() || null,
    recorded_by: line.recordedBy,
  }, { onConflict: 'tenant_id,month_key,currency', count: 'exact' });
  if (r.error) throw r.error;
  assertWrote('That bank figure', r);
}

/**
 * Remove a line.
 *
 * The one case an UPDATE cannot serve: the currency is half the key, so an
 * owner who typed a figure against EUR when they meant GBP needs a different
 * row. Part 2700's header argues why the DELETE grant exists here and not on
 * `gym_month_closes` — a phantom EUR line against a gym that has never banked a
 * euro sits on every future reconciliation and is read, where a removed line is
 * absent and says so.
 */
export async function deleteBankedMonth(sb: Queryable, id: string): Promise<void> {
  const r = await sb.from('gym_banked_months').delete({ count: 'exact' }).eq('id', id);
  if (r.error) throw r.error;
  assertWrote('That bank figure', r);
}
