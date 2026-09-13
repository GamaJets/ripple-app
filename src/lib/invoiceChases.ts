// Chasing an overdue invoice from the console — as a RECORD OF AN ACT, never
// as something this product sent.
//
// ── The defect ─────────────────────────────────────────────────────────────
//
// `gym_invoices` records what is owed and when it fell due, `isOverdue` in
// src/lib/monthEnd.ts computes lateness from the DUE DATE, and the Ageing
// section of studio-web/app/accounting/page.tsx bands every unpaid invoice by
// how far past it is. So the console answers "who is late" precisely, and
// answers nothing else.
//
// An owner who works down that list on a Monday — three emails, a phone call, a
// word at the desk — opens it on Thursday to the same list in the same order.
// Nothing distinguishes the member who was rung yesterday from the one nobody
// has spoken to since April. The only place that difference lived was in
// whoever did the ringing, which means the same member gets chased twice by two
// people or not at all because each assumed the other had — and, at the year
// end, `WRITE_OFF_PROMPT` asks "Why is this money not going to be collected?"
// about a debt whose honest answer is "we chased it four times", which the gym
// cannot evidence.
//
// supabase/parts/2820 is the table. This is the rule over it.
//
// ── THE ONE THING THIS MUST NOT BECOME ────────────────────────────────────
//
// A chase is a record, not a send. Nothing in this module, in that part, or on
// any screen that uses either, emails, messages or telephones anybody. A row
// says SOMEBODY AT THIS GYM SAYS THEY CHASED THIS INVOICE — on this day, by
// this means, in their own words. Repple did not witness the phone call and
// does not claim to.
//
// That is not a theoretical worry on this table. `gym_invoice_notify()`
// (supabase/parts/146) is an AFTER INSERT OR UPDATE OF status trigger on
// `gym_invoices` that writes the member a notification, so the invoice row
// itself is one careless `update of` list away from mailing every late member
// in the building. A chase modelled as a column there would have inherited
// that; a separate table cannot.
//
// Which leaves the WORDS as the remaining way to mislead, and they are the part
// this module owns. `CHASE_IS_A_RECORD_NOT_A_SEND` is printed above the form,
// `CHASE_VIA_LABEL` says "By email" and not "Emailed by Repple", and every
// sentence `lastChaseLine` builds attributes the act to the gym. A screen that
// let "Chased by email" be read as "Repple emailed them" would be claiming
// delivery of something that may never have been sent — to an owner who is
// deciding whether to write four figures off.
//
// ── Absence is UNKNOWN until a whole read says otherwise ──────────────────
//
// "Which invoices have not been chased" is the question this feature exists to
// answer, and it is answerable from the ABSENCE of rows — which is exactly the
// shape src/ui/loadStatus.ts exists to stop a screen getting wrong. A refused
// read has no rows either, and "nobody has chased this" printed over a debt
// somebody chased last week is worse than printing nothing: it is the sentence
// that gets the member rung twice, or written off as unpursued.
//
// So `chaseState` takes the read's status and refuses on anything but 'ready'.
// 'partial' is refused with the others and for its own reason: a truncated
// chase log drops the OLDEST rows, and the count beside an invoice would then
// be short by an unknown number of chases the gym actually made.
//
// ── Dates are bare days, compared as strings ──────────────────────────────
//
// `chased_on`, `due_on` and `issued_on` are all `date` columns holding
// `YYYY-MM-DD`, and bare days in that form sort lexicographically exactly as
// they sort chronologically. Nothing here parses one. `new Date('2026-09-01')`
// is midnight UTC, which is 31 August for every reader west of Greenwich, and
// the comparisons in this file decide whether a chase happened before an
// invoice existed or after today — the two places a day out is a wrong answer
// rather than a cosmetic one.
//
// Pure apart from the three calls at the bottom, which take the Supabase client
// as an argument the way src/lib/gymInvoices.ts does.
import { assertWrote } from './wroteRows';
import { capLimit, assertWhole } from './rowCap';
// The same day-shape check the invoice writer uses. Not a fourth copy: a
// `2026-02-31` passes a regex, is not a date, and `new Date` rolls it silently
// into March — and this file is where somebody types the day a phone call
// happened.
import { isoDay } from './gymInvoices';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

type Queryable = { from: (table: string) => any };

/* ── what a chase is ──────────────────────────────────────────────────────── */

/** How the gym says it asked. Exactly the six the CHECK in
 *  supabase/parts/2820 permits — a value in one and not the other renders as
 *  its own raw code beside a debt somebody is deciding about. */
export type ChaseVia = 'email' | 'phone' | 'message' | 'in_person' | 'post' | 'other';

export const CHASE_VIA: readonly ChaseVia[] =
  ['email', 'phone', 'message', 'in_person', 'post', 'other'] as const;

export const isChaseVia = (v: string | null | undefined): v is ChaseVia =>
  CHASE_VIA.includes(v as ChaseVia);

/**
 * The words each one is shown under.
 *
 * Every label is in the PASSIVE of an act the gym performed, and none of them
 * names Repple. "By email" is a thing the gym did through its own mail; "Email
 * sent" would be this product reporting a delivery it did not make and cannot
 * confirm. The distinction is the whole constraint on this feature and it is
 * cheapest to hold here, in the six strings a screen actually renders.
 */
export const CHASE_VIA_LABEL: Record<ChaseVia, string> = {
  email: 'By email',
  phone: 'By telephone',
  message: 'By message',
  in_person: 'In person',
  post: 'By post',
  other: 'Some other way',
};

/** Printed above the form, every time, rather than once in a help page nobody
 *  opens. An owner recording "by email" has to know, at the moment they record
 *  it, that this product did not send one. */
export const CHASE_IS_A_RECORD_NOT_A_SEND =
  'Recording a chase sends nothing. Repple does not email, message or telephone anybody here — '
  + 'this is the gym’s own note that it asked for the money, by whatever means it used. Nobody is '
  + 'contacted by writing it down, and the member is not shown it.';

/** One recorded act. */
export interface InvoiceChase {
  id: string;
  invoiceId: string;
  /** `YYYY-MM-DD`, the day it HAPPENED as stated — not the day it was typed,
   *  which is `createdAt`. */
  chasedOn: string;
  via: ChaseVia | null;
  note: string | null;
  /** A `timestamptz` as stored. Deliberately NOT formatted in this module: a
   *  screen draws it on the GYM's clock through `gymDateText`, and a date
   *  formatted here would be formatted on whoever's machine is asking. */
  createdAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
}

export interface ChaseDraft {
  invoiceId: string;
  chasedOn: string;
  via: ChaseVia;
  note?: string | null;
}

/** The form's ceiling, matching the CHECK in supabase/parts/2820 so the refusal
 *  arrives beside the box rather than as a 23514 after it has closed. */
export const MAX_CHASE_NOTE_CHARS = 1000;

/**
 * Why this chase cannot be recorded, or null when it can.
 *
 * `today` is the GYM's day and `issuedOn` the invoice's, both bare. Two of
 * these rules cannot live in the database at all and the header of
 * supabase/parts/2820 says so: `current_date` is STABLE, so Postgres rejects it
 * in a CHECK outright, and `issued_on` is on another table, which a CHECK may
 * not reach across. This is where they live instead.
 */
export function chaseBlocker(
  d: ChaseDraft,
  today: string,
  issuedOn: string | null,
): string | null {
  if (!d.invoiceId) {
    return 'A chase has to be against an invoice. There is nothing here to record it on.';
  }
  if (!isChaseVia(d.via)) {
    return 'Say how the gym asked. “Some other way” is on the list for anything that is not one of the five, and is a real answer.';
  }
  if (!isoDay(d.chasedOn)) {
    return 'The day this happened has to be a real date — YYYY-MM-DD.';
  }
  // Bare-day string compares throughout. See the header: parsing either side
  // here would move the boundary by a day for most of the world's readers.
  if (isoDay(today) && d.chasedOn > today) {
    return 'That day has not happened yet. A chase is a record of something somebody did, so it cannot be dated into the future — record it when it has been done.';
  }
  if (issuedOn && isoDay(issuedOn) && d.chasedOn < issuedOn) {
    return `This invoice was not issued until ${issuedOn}, so nobody can have chased it on ${d.chasedOn}. Check the date — it is easy to type last month by accident.`;
  }
  const note = (d.note ?? '').trim();
  if (note.length > MAX_CHASE_NOTE_CHARS) {
    return `That note is longer than this holds. Keep it to what was said and what came back; the correspondence itself belongs wherever the gym keeps correspondence.`;
  }
  return null;
}

/* ── what has been chased, and what has not ───────────────────────────────── */

/**
 * The chases against each invoice, most recent first, keyed by invoice.
 *
 * Returns a MAP and never a lookup with holes in it, so a caller cannot
 * accidentally read "no entry" as "no chases" — that distinction is made once,
 * by `chaseState`, against the read's status.
 */
export function byInvoice(rows: readonly InvoiceChase[]): Map<string, InvoiceChase[]> {
  const out = new Map<string, InvoiceChase[]>();
  for (const c of rows) {
    const list = out.get(c.invoiceId);
    if (list) list.push(c); else out.set(c.invoiceId, [c]);
  }
  for (const list of out.values()) {
    // Most recent first. Ties break on the id so the order cannot flap between
    // renders — two chases on one day is ordinary (emailed, then rang).
    list.sort((a, b) => (a.chasedOn < b.chasedOn ? 1 : a.chasedOn > b.chasedOn ? -1 : b.id.localeCompare(a.id)));
  }
  return out;
}

export type ChaseState =
  /**
   * The chase log was not read, or not read whole.
   *
   * Its own arm, and the most important one in this file. An unread log has no
   * rows, and no rows reads as "nobody has chased this" — which is the sentence
   * that gets a member rung twice by two people, or a debt written off as
   * unpursued when it was pursued four times. It is also the state of every gym
   * whose database has not had supabase/parts/2820 applied yet.
   */
  | { state: 'unread'; line: string }
  /** Read whole, and nobody has recorded chasing this one. */
  | { state: 'never' }
  /** Read whole, and here is what the gym says it did. */
  | { state: 'chased'; count: number; last: InvoiceChase; line: string };

/**
 * What to say beside an invoice about the chasing of it.
 *
 * `chases` is that invoice's own list, newest first, out of `byInvoice`.
 * `status` is the status of the read that produced it — NOT of the invoice
 * read, which can succeed while this one fails, and does exactly that on a
 * database missing the part.
 *
 * `today` is the gym's bare day, used only to say how long ago. Optional
 * because a caller with no zone answer yet has no honest "days ago" to give,
 * and a wrong one on this line is an owner deciding not to ring somebody.
 */
export function chaseState(
  chases: readonly InvoiceChase[] | null | undefined,
  status: LoadStatus,
  today?: string | null,
): ChaseState {
  // `isWhole`, not `!== 'error'`. 'partial' here is a chase log cut off at the
  // row cap, which drops the OLDEST rows — so the count would be short by an
  // unknown number of chases the gym actually made, beside a figure somebody is
  // about to write off.
  if (!isWhole(status)) {
    return {
      state: 'unread',
      line: status === 'loading'
        ? 'Still reading what has been done about this one.'
        : status === 'partial'
          ? 'More chases are on record than could be read in one request, so what has been done about this one is not known. What is listed is real; it is not all of it.'
          : 'What has been done about this one could not be read. That is not the same as nobody having chased it, and anything already recorded still stands.',
    };
  }
  const list = chases ?? [];
  if (!list.length) return { state: 'never' };
  const last = list[0];
  return { state: 'chased', count: list.length, last, line: lastChaseLine(last, list.length, today) };
}

/**
 * The sentence beside an invoice: what the gym says it last did, and when.
 *
 * Every clause attributes the act to the gym rather than to this product. The
 * day is printed as the bare day it is — it is not an instant and there is no
 * zone question to get wrong — and "N days ago" is added only where a today was
 * supplied and the arithmetic is exact.
 */
export function lastChaseLine(
  last: InvoiceChase,
  count: number,
  today?: string | null,
): string {
  const how = last.via && isChaseVia(last.via) ? CHASE_VIA_LABEL[last.via].toLowerCase() : 'by some means not recorded';
  const ago = daysSince(last.chasedOn, today);
  const when = ago == null
    ? `on ${last.chasedOn}`
    : ago === 0
      ? `today (${last.chasedOn})`
      : `on ${last.chasedOn}, ${ago} ${ago === 1 ? 'day' : 'days'} ago`;
  const times = count === 1 ? 'Chased once' : `Chased ${count} times`;
  // "the gym says" and not "Repple sent". The whole feature turns on this
  // clause being in every sentence a screen can show.
  return `${times}, by the gym’s own record. Last ${when}, ${how}.`;
}

/**
 * Whole days between two bare days, or null when either is unusable.
 *
 * Both are anchored at UTC midnight before subtracting, which is the only way
 * the difference is exact: a local parse puts a daylight-saving hour between
 * two days in March and rounds "1 day ago" into 0.
 */
export function daysSince(day: string, today: string | null | undefined): number | null {
  if (!isoDay(day) || !today || !isoDay(today)) return null;
  // utc-day-ok: this states no day to anybody. Two bare days already in the
  // same calendar go in, a COUNT comes out, and the anchoring cancels — which
  // is exactly `dueAfter`'s argument in src/lib/gymInvoices.ts, in reverse.
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * The overdue invoices nobody has recorded chasing — the working list.
 *
 * NAMED rather than counted, for `periodMovingNote`'s reason in
 * src/lib/gymTax.ts: "One month is open" sends somebody to look at three;
 * "September is open" sends them to one.
 *
 * Returns null — not an empty array — on anything but a whole read of the chase
 * log. An empty array here means "every overdue invoice has been chased", which
 * is a claim, and a failed read is not entitled to make it. This is the same
 * refusal `owedSum` makes about a total it cannot stand behind.
 */
export function unchased<T extends { id: string }>(
  overdue: readonly T[],
  chases: Map<string, InvoiceChase[]> | null,
  status: LoadStatus,
): T[] | null {
  if (!isWhole(status) || !chases) return null;
  return overdue.filter((i) => !(chases.get(i.id)?.length));
}

/**
 * The longest any of these has gone unchased, or null when that cannot be said.
 *
 * "Chased, but in June" is a different problem from "never chased" and this
 * does not fold them together: an invoice with no chase at all is not given an
 * enormous number here, it is excluded, because it belongs on `unchased`'s list
 * instead and counting it as "chased 200 days ago" would say the gym did
 * something it did not do.
 */
export function stalestChase(
  chases: readonly InvoiceChase[],
  today: string | null | undefined,
): number | null {
  let worst: number | null = null;
  for (const c of chases) {
    const n = daysSince(c.chasedOn, today);
    if (n == null) continue;
    if (worst == null || n > worst) worst = n;
  }
  return worst;
}

/* ── reads ────────────────────────────────────────────────────────────────── */

/**
 * Every chase this gym has recorded, newest first.
 *
 * Unbounded in time on purpose, exactly like `fetchDrops` beside it on
 * /accounting: the Ageing section reaches back over every invoice ever issued,
 * so an invoice chased in June has to be explainable in September.
 *
 * Capped and REFUSING rather than paging. A truncated read would drop the
 * OLDEST chases, and `chaseState` would then report a long-pursued debt as
 * having been chased fewer times than it was — the exact false sentence this
 * read exists to make impossible. A gym with more than a thousand recorded
 * chases has a receivables problem this screen cannot help with, and saying so
 * is better than quietly explaining nine hundred of them.
 */
export async function fetchInvoiceChases(
  sb: Queryable, tenantId: string,
): Promise<InvoiceChase[]> {
  const { data, error } = await sb
    .from('gym_invoice_chases')
    .select('id, invoice_id, chased_on, via, note, created_at, created_by')
    .eq('tenant_id', tenantId)
    .order('chased_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  const rows = assertWhole(data as any[] | null, 'what this gym has done about its unpaid invoices');
  return rows.map((r: any) => ({
    id: r.id,
    invoiceId: r.invoice_id,
    chasedOn: r.chased_on,
    // Not coerced to 'other'. A stored value this build does not recognise is
    // reported as unrecorded rather than relabelled as something the gym never
    // said — the mistake part 2640 refused a seventh document kind to avoid.
    via: isChaseVia(r.via) ? r.via : null,
    note: r.note ?? null,
    createdAt: r.created_at ?? null,
    createdBy: r.created_by ?? null,
    createdByName: null,
  }));
}

/* ── writes ───────────────────────────────────────────────────────────────── */

/**
 * Record that the gym chased this invoice. SENDS NOTHING.
 *
 * One insert into one table that carries no trigger. `gym_invoices` is not
 * touched — not its status, not a stamp on it, nothing — because recording a
 * chase changes nothing about what is owed or when it fell due, and `isOverdue`
 * computes lateness from the due date and is not consulted here. An invoice
 * must not be able to leave a band it genuinely sits in because somebody rang
 * about it.
 *
 * The row is READ BACK and the day compared with the one that was sent. A
 * successful insert says a row landed; it does not say the six-value CHECK on
 * `via` accepted this build's spelling, or that the date arrived as the day
 * somebody typed. What the comparison catches is an insert that succeeded into
 * a shape this code did not expect — after which the screen would show a chase
 * dated somewhere nobody put it.
 */
export async function recordChase(
  sb: Queryable,
  tenantId: string,
  d: ChaseDraft & { createdBy?: string | null },
): Promise<InvoiceChase> {
  const { data, error } = await sb.from('gym_invoice_chases').insert({
    tenant_id: tenantId,
    invoice_id: d.invoiceId,
    chased_on: d.chasedOn,
    via: d.via,
    // Empty is null, never an empty string: the CHECK in supabase/parts/2820
    // refuses a blank, and "nothing was written down about it" is what an empty
    // box means.
    note: (d.note ?? '').trim() || null,
    created_by: d.createdBy ?? null,
  }).select('id, invoice_id, chased_on, via, note, created_at, created_by').single();
  if (error) throw error;
  const row = data as any;
  if (!row?.id || row.chased_on !== d.chasedOn || row.via !== d.via) {
    throw new Error(
      'That chase was NOT recorded the way it was meant to be — the row did not come back matching '
      + 'what was sent. Reload this page and read the invoice’s history before entering it again; '
      + 'nothing was sent to anybody either way.',
    );
  }
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    chasedOn: row.chased_on,
    via: isChaseVia(row.via) ? row.via : null,
    note: row.note ?? null,
    createdAt: row.created_at ?? null,
    createdBy: row.created_by ?? null,
    createdByName: null,
  };
}

/**
 * Remove a chase recorded in error.
 *
 * A deletion and not an edit, which is supabase/parts/2820's policy and part
 * 700's argument: a chase is an event that happened once, so correcting it is
 * removing the row describing an act nobody performed and writing the one
 * describing the act they did. An UPDATE would leave a row whose date came from
 * one chase and whose note came from another, with nothing on it saying so.
 *
 * THE COUNT IS CHECKED, not `error` alone. `gym_invoice_chases_owner_delete` is
 * `is_owner_of(tenant_id)` and is the only policy granting DELETE, so a delete
 * run by anybody else matches ZERO ROWS and returns `error: null` — and the
 * screen would report the chase as removed while it is still on the invoice,
 * still counted, and still being read as evidence at a write-off. See
 * src/lib/wroteRows.ts.
 */
export async function deleteChase(sb: Queryable, chaseId: string): Promise<void> {
  const r = await sb.from('gym_invoice_chases').delete({ count: 'exact' }).eq('id', chaseId);
  if (r.error) throw r.error;
  assertWrote('That chase', r);
}
