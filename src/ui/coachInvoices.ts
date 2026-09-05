// The reads and writes behind a coach's invoices. The document itself is
// src/lib/coachInvoice.ts, which is pure and tested; nothing here decides what
// an invoice says.
//
// ── Everything goes through part 138's two functions ───────────────────────
//
// `coach_invoices` grants SELECT and nothing else: no INSERT, no UPDATE, no
// DELETE, and no policy for any of them. The number has to be allocated under
// a lock to stay gapless per coach, and an issued document cannot be edited
// once somebody is holding a copy of it — neither of which a client-side write
// could promise. So every write in this file is an `rpc` — issue, void, the
// chase since part 188, and since part 660 the settlement and the chase date —
// and the read below is the only place the table is touched directly.
//
// Each of those moves columns that are NOT on the issued document: when the
// coach last chased and how many times, whether they say it was paid and when,
// and their own note of the day to start chasing from. Every one still goes
// through a function rather than an UPDATE grant, because a grant on this table
// is a grant on the ROW: RLS narrows a grant rather than creating one, and the
// immutable trigger would then be the only thing between an issued amount and
// anybody who wanted to edit it.
//
// The line none of them crosses is the same line. Nothing about a document
// already issued is rewritten: a settlement is a NEW FACT recorded beside
// `kind` rather than an edit of it, and `chase_from` appears on no artefact
// anybody else ever sees. `due_on`, `kind` and `amount_cents` are exactly as
// immutable as they were.
//
// ── supabase-js RESOLVES ON AN ERROR ───────────────────────────────────────
//
// `await supabase.from(...)` gives back `{ data, error }` rather than throwing,
// so a try/catch alone catches only the network dying. Every call here reads
// `.error`, and every one of them matters more than usual: an invoice list that
// silently comes back empty tells a self-employed trainer they have issued
// nothing, which is a statement about their own business records.
//
// ── Zero rows is not an error, and not a success either ────────────────────
//
// PostgREST reports no error for a WHERE that matched nothing. Both writes are
// therefore functions that RAISE rather than updates that return a count — see
// void_coach_invoice() in part 138, which raises when it updates no row. What
// reaches this file is an error message a coach can read.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import { isMissingColumn } from '../lib/coachCurrency';
import type { MyCurrencyGap } from '../lib/currencySource';
import { draftMinorUnits, readTaxRate, type CoachInvoice, type InvoiceDraft, type InvoiceKind } from '../lib/coachInvoice';
import { invoiceNotification, invoiceReminderNotification } from '../lib/notifyCopy';
import { recordInbox } from './pushNotifications';

/** Every column the document needs and nothing else. */
const INVOICE_COLS =
  'id, seq, client_id, bill_to, description, amount_cents, currency, kind, issued_on, due_on, settled_on, settled_at, settle_note, chase_from, reminded_at, reminder_count, note, tax_rate_pct, tax_registration, voided_at, void_reason, created_at';

interface InvoiceRow {
  id: string;
  seq: number;
  client_id: string | null;
  bill_to: string;
  description: string;
  amount_cents: number | string | null;
  currency: string | null;
  kind: string;
  issued_on: string;
  due_on: string | null;
  settled_on: string | null;
  settled_at: string | null;
  settle_note: string | null;
  chase_from: string | null;
  reminded_at: string | null;
  reminder_count: number | string | null;
  note: string | null;
  tax_rate_pct: number | string | null;
  tax_registration: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string | null;
}

/**
 * A row as the document builder wants it.
 *
 * `amount_cents` is a bigint, and PostgREST hands bigints back as STRINGS
 * rather than numbers — a value above 2^53 could not survive JSON otherwise.
 * Left alone, `"48000"` would flow into `minorMoney`, fail `Number.isFinite`,
 * and print a dash on an invoice that has an amount. It is converted here, once
 * — and a value that will not convert becomes null rather than NaN, so the
 * document takes its "no amount could be stated" branch and says so out loud.
 */
function toInvoice(r: InvoiceRow): CoachInvoice {
  const raw = r.amount_cents;
  const amount = raw == null ? null : Number(raw);
  return {
    id: r.id,
    seq: Number(r.seq),
    billTo: r.bill_to ?? '',
    description: r.description ?? '',
    amountCents: amount != null && Number.isFinite(amount) ? amount : null,
    currency: (r.currency || '').trim() || null,
    // Anything that is not one of the two stored values is treated as
    // 'requested', which is the claim that asserts less. The column has a CHECK
    // on it so this is unreachable; if a later migration widens it, the safe
    // reading is the one that does not tell a client they have already paid.
    kind: (r.kind === 'received' ? 'received' : 'requested') as InvoiceKind,
    issuedOn: String(r.issued_on ?? '').slice(0, 10),
    // A `date` column comes back as a bare `YYYY-MM-DD` and is kept as one. It
    // means a DAY, not an instant, and turning it into a Date here would put a
    // due date of the 1st on the 31st for every coach west of Greenwich — the
    // same trap `splitByDay` in coachStatement.ts exists to document.
    dueOn: (r.due_on || '').slice(0, 10) || null,
    // Both `date` columns, and both kept as bare `YYYY-MM-DD` for the reason
    // `due_on` is: they mean a DAY. `settled_at` is a real instant — when the
    // coach wrote it down, as opposed to the day they say the money arrived —
    // and is the one of the three that is left alone.
    settledOn: (r.settled_on || '').slice(0, 10) || null,
    settledAt: r.settled_at ?? null,
    settleNote: (r.settle_note || '').trim() || null,
    chaseFrom: (r.chase_from || '').slice(0, 10) || null,
    remindedAt: r.reminded_at ?? null,
    // `integer` arrives as a number, but the same PostgREST bigint-as-string
    // rule that bit `amount_cents` is one migration away from applying here.
    // A value that will not convert reads as "not yet chased", which is the
    // reading that does not claim an act the coach may not have performed.
    reminderCount: Number.isFinite(Number(r.reminder_count)) ? Number(r.reminder_count) : 0,
    note: r.note ?? null,
    // `numeric` arrives from PostgREST as a STRING, for the same reason a
    // bigint does. Left alone, `"20.000"` fails `Number.isFinite` downstream
    // and a rate the coach stated prints as no rate at all — and NULL stays
    // NULL, because a coach who stated nothing has not stated zero.
    taxRatePct: r.tax_rate_pct == null || !Number.isFinite(Number(r.tax_rate_pct)) ? null : Number(r.tax_rate_pct),
    taxRegistration: (r.tax_registration || '').trim() || null,
    voidedAt: r.voided_at ?? null,
    voidReason: r.void_reason ?? null,
    clientId: r.client_id ?? null,
    createdAt: r.created_at ?? null,
  };
}

/* ── the book ─────────────────────────────────────────────────────────────── */

/**
 * Every invoice this coach has issued, newest number first.
 *
 * `status` is what stops an empty list being read two ways. Under 'error' the
 * list is UNKNOWN, and the screen says so rather than "you have not issued any
 * invoices" to somebody who has issued forty.
 */
export async function fetchMyInvoices(): Promise<{ rows: CoachInvoice[]; status: LoadStatus }> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready' };
  try {
    const { data, error } = await supabase
      .from('coach_invoices')
      .select(INVOICE_COLS)
      // The sequence, not the date. Two invoices issued on the same day have
      // the same `issued_on`, and a coach looking for "the one after 0031"
      // needs them in the order they were numbered.
      .order('seq', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('coachInvoices.list', error); return { rows: [], status: 'error' }; }
    const page = capped((data ?? []) as unknown as InvoiceRow[]);
    return { rows: page.rows.map(toInvoice), status: page.truncated ? 'partial' : 'ready' };
  } catch (e) {
    reportError('coachInvoices.list', e);
    return { rows: [], status: 'error' };
  }
}

/* ── who is issuing ───────────────────────────────────────────────────────── */

/**
 * The coach's own name, for the From line.
 *
 * Its own read and its own status because it fails independently of the
 * invoices, and because printing the platform's name where a business name
 * should be would put the wrong entity on a financial document. The document
 * builder takes this status and prints the failure.
 */
export async function fetchInvoiceIssuer(): Promise<{ name: string | null; status: LoadStatus }> {
  if (!USE_SUPABASE) return { name: null, status: 'ready' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { name: null, status: 'error' };
    const { data, error } = await supabase.from('profiles').select('full_name').eq('id', uid).limit(1);
    if (error) { reportError('coachInvoices.issuer', error); return { name: null, status: 'error' }; }
    const rows = (data ?? []) as { full_name: string | null }[];
    // No row is a real answer — an account with no profile has no name — and it
    // is 'ready', not 'error'. The document then says "has not recorded a name"
    // rather than "could not be read", which are different sentences.
    return { name: (rows[0]?.full_name || '').trim() || null, status: 'ready' };
  } catch (e) {
    reportError('coachInvoices.issuer', e);
    return { name: null, status: 'error' };
  }
}

/* ── the currency, which is never assumed ─────────────────────────────────── */

/** Where a currency came from, so the screen can say. 'own' is
 *  `trainers.currency` (part 940) — a coach with no gym, priced by themselves. */
export type CurrencySource = 'packages' | 'gym' | 'own';

export interface InvoiceCurrency {
  /** ISO 4217 uppercase, or null when nobody has stated one. Null is NOT a
   *  reason to fall back — it is the reason the Issue button is disabled and
   *  the coach is asked. */
  currency: string | null;
  source: CurrencySource | null;
  status: LoadStatus;
  /**
   * WHY there is no code, when there is none. Null whenever a code was found.
   *
   * `status` alone cannot say it any more. It separates "still reading", "a
   * read failed" and "everything answered", and that was the whole story while
   * a gym was the only place a currency could live — "everything answered and
   * there is none" meant one thing and one sentence. It now means four:
   * the gym has set none, the coach has no gym and has chosen none, there is
   * no `trainers` row to keep one on, or part 940 is not applied. The first
   * sends the coach to an owner and the second sends them to their own
   * Settings, and telling an independent coach to go and find a gym owner is
   * the dead end this whole change exists to end.
   */
  gap: MyCurrencyGap | null;
}

/**
 * The currency this coach's invoices are denominated in.
 *
 * Resolved in the same order `issue_coach_invoice()` resolves it — part 138 as
 * amended by part 941 — so the screen shows the coach exactly what the server
 * will use rather than a second opinion that could differ from it:
 *
 *   1 · the coach's own packages, when they unanimously agree on one.
 *   2 · the gym on `profiles.tenant_id`.
 *   3 · `trainers.currency` (part 940), and ONLY when there is no gym.
 *
 * Packages first, deliberately. A coach who sells in sterling inside a gym
 * denominated in dirhams is selling in sterling; the two links below are the
 * fallback for a coach who has priced nothing yet.
 *
 * ── The column this used to join on, and the year it was wrong for ────────
 *
 * The gym half was `from trainers tr join tenants t on t.id = tr.tenant_id`.
 * That is the wrong column. `revoke_staff_role()` (part 711) takes a coach off
 * a gym's staff by clearing `profiles.tenant_id` and deliberately KEEPS the
 * `trainers` row — deleting it would strand every per-coach figure that joins
 * on it — so `trainers.tenant_id` goes on naming the gym they have left, for
 * ever. Every other screen in the coach app reads `profiles.tenant_id` and
 * showed such a coach a dash; this one denominated their invoices in their old
 * gym's currency. One coach, two answers, and the one that reached a client
 * was the wrong one.
 *
 * ── Link 3 is guarded on "no gym", not on "nothing answered yet" ──────────
 *
 * That is part 940's precedence rule, and src/lib/currencySource.ts is where
 * it is stated and tested. A coach INSIDE a gym whose owner has not chosen is
 * waiting on that owner: answering them from their own dormant column would
 * put a different currency on their invoice from the one their packages charge
 * in, and from the one the coach at the next desk issues in.
 *
 * There is NO literal fallback anywhere in this function. Every code is one
 * somebody chose, and an invoice with the wrong three letters on it is worse
 * than no invoice, because it reads as a considered figure and it is a
 * different amount of money.
 *
 * ── A link that did not answer stops the chain; it does not hand over ─────
 *
 * At every step, the FAILURE is checked before the emptiness — the rule
 * `resolveMyCurrency` in src/lib/currencySource.ts states in those words. A
 * link that could not be read has not said "nothing", it has said nothing, and
 * the link beneath it answers a different question. So a packages read that
 * errored or truncated returns no currency at all rather than the gym's, in the
 * same way a failed profile read has always stopped rather than reaching
 * `trainers.currency`. See the long note at the packages read for what the
 * missing half of that rule cost.
 *
 * That means an invoice cannot be issued while a link is unreadable, and that
 * is the intended outcome: the number comes out of a gapless per-coach
 * sequence and the document is immutable once issued, so "try again in a
 * moment" is recoverable and a wrong three letters is not.
 */
export async function fetchInvoiceCurrency(): Promise<InvoiceCurrency> {
  if (!USE_SUPABASE) return { currency: null, source: null, status: 'ready', gap: null };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { currency: null, source: null, status: 'error', gap: 'unreadable' };

    const [pkgRes, profRes] = await Promise.all([
      supabase.from('trainer_packages').select('currency').eq('trainer_id', uid).limit(capLimit()),
      supabase.from('profiles').select('tenant_id').eq('id', uid).maybeSingle(),
    ]);

    if (pkgRes.error) reportError('coachInvoices.currency.packages', pkgRes.error);
    if (profRes.error) reportError('coachInvoices.currency.profile', profRes.error);

    // `capped()` rather than the raw rows, because unanimity is a claim about
    // the WHOLE set. `.limit(capLimit())` hands back a prefix, and a prefix that
    // happens to be all one currency says "unanimous" about a coach whose next
    // package is priced in another — which puts the wrong three letters on an
    // invoice and makes it a different amount of money.
    //
    // ── A packages read that did not come back whole STOPS the chain ──────
    //
    // It used to fall through to the gym on both a truncated read and a FAILED
    // one, and return `status: 'ready'` with the gym's code. Only the
    // truncation half was ever argued, in a comment that ended "a truncated
    // read here knows less than an empty one, so it falls through to the gym" —
    // and that is the opposite of the rule this function applies twenty lines
    // below, where a failed PROFILE read stops rather than consulting the link
    // beneath it, and the opposite of `resolveMyCurrency` in
    // src/lib/currencySource.ts, whose whole statement of the precedence rule
    // is "the failure is checked before the emptiness, at every step".
    //
    // What it costs is not a wrong sentence, it is a wrong document. Link 1 is
    // the coach's own packages and it BEATS the gym: a coach pricing in GBP
    // inside an AED gym is pricing in GBP. When that read fails, whether link 1
    // would have answered is unknown — so the gym's code is not the fallback,
    // it is a different link's answer standing in for one nobody read.
    // `currencyGapOfStatus` cannot catch it either: it short-circuits on
    // `input.currency` and a code was found, so no gap is reported, no blocker
    // is raised, and `issueInvoice` sends that code as `p_currency`. Part 941's
    // chain takes what the caller states in preference to everything below it,
    // so the server does not re-resolve and does not disagree. The coach issues
    // AED 480 where they meant GBP 480 — on a document that is immutable and
    // numbered out of a gapless per-coach sequence, so it cannot be edited and
    // cannot be deleted, only voided in the coach's own record while the client
    // holds the copy.
    //
    // Refusing is therefore the cheap outcome and it is the one taken. The
    // screen already has the words: 'error' reads as "your currency could not
    // be read … try again in a moment" and 'partial' as "could not be
    // established, because part of the read did not come back", neither of
    // which sends anybody to a gym owner over a setting that is already
    // correct. Nothing is invented, and no currency is stated that nobody chose.
    const pkgPage = capped((pkgRes.data ?? []) as { currency: string | null }[]);
    if (pkgRes.error) return { currency: null, source: null, status: 'error', gap: 'unreadable' };
    // 'unreadable' of the six, because what this is is UNKNOWN rather than
    // "none is set" — which is the only distinction `MyCurrencyGap` has to
    // carry here. The 'partial' status is what the screen actually prints from,
    // and it says truncation in its own words.
    if (pkgPage.truncated) return { currency: null, source: null, status: 'partial', gap: 'unreadable' };
    const codes = new Set(
      pkgPage.rows
        .map((p) => (p.currency || '').trim().toUpperCase())
        .filter((c) => c.length >= 3),
    );
    // Unanimous or nothing. A coach with packages in two currencies has not
    // told us which one this invoice is in, and picking the commoner of the
    // two would be a guess wearing a statistic.
    if (codes.size === 1) return { currency: [...codes][0], source: 'packages', status: 'ready', gap: null };

    // The profile read is what says whether there is a gym at all, so a failure
    // of it is UNKNOWN and stops here. Falling through to `trainers.currency`
    // on it would consult the coach's own column for a coach who may well be in
    // a gym — the exact second answer this function has just stopped giving.
    if (profRes.error) return { currency: null, source: null, status: 'error', gap: 'unreadable' };

    const tid = (profRes.data as { tenant_id: string | null } | null)?.tenant_id ?? null;
    // Everything from here down is reached only with the packages read WHOLE —
    // it answered, and it either had nothing to say or did not agree with
    // itself. So the links below are a genuine fallback and 'ready' is the
    // truth about them. The old `partial` here covered a packages read that had
    // failed or truncated, and it covered only the branches that end with NO
    // code; the branches that found one returned 'ready' regardless, which is
    // where the wrong currency got out.

    if (tid) {
      const { data: ten, error: tenErr } = await supabase.from('tenants').select('currency').eq('id', tid).maybeSingle();
      if (tenErr) {
        reportError('coachInvoices.currency.gym', tenErr);
        return { currency: null, source: null, status: 'error', gap: 'unreadable' };
      }
      // A tenant_id that resolves to no readable row is still a gym — the
      // profile names one. It is a gym whose currency we do not have, which is
      // unknown rather than unset: RLS hiding the row and an owner never
      // choosing look identical from here, and only one of them is fixed by an
      // owner.
      if (!ten) return { currency: null, source: null, status: 'error', gap: 'unreadable' };
      const code = ((ten as { currency: string | null }).currency || '').trim().toUpperCase();
      if (code.length >= 3) return { currency: code, source: 'gym', status: 'ready', gap: null };
      // A gym with no currency is the owner's to fix, and it stays that way.
      // `trainers.currency` is deliberately not reached from here.
      return { currency: null, source: null, status: 'ready', gap: 'gym-unset' };
    }

    // No gym. Only now is the coach's own column consulted.
    const { data: tr, error: trErr } = await supabase.from('trainers').select('currency').eq('id', uid).maybeSingle();
    if (trErr) {
      // An unapplied part 940 is a deploy step, not a failed read. Reported as
      // 'error' it becomes "try again in a moment" about a thing that will
      // never come true until somebody runs the part.
      if (isMissingColumn(trErr)) return { currency: null, source: null, status: 'ready', gap: 'unavailable' };
      reportError('coachInvoices.currency.own', trErr);
      return { currency: null, source: null, status: 'error', gap: 'unreadable' };
    }
    // `trainers_self_rw` is `for all using (auth.uid() = id)`, so a coach can
    // always see their own row. No row here is genuinely no row, not RLS — and
    // it is a real state: there is nowhere for a currency to be kept.
    if (!tr) return { currency: null, source: null, status: 'ready', gap: 'nowhere' };
    const own = ((tr as { currency: string | null }).currency || '').trim().toUpperCase();
    if (own.length >= 3) return { currency: own, source: 'own', status: 'ready', gap: null };

    // Read fine, no gym, and they have not chosen. THEY fix this, in Settings,
    // and there is no owner anywhere in the sentence.
    return { currency: null, source: null, status: 'ready', gap: 'own-unset' };
  } catch (e) {
    reportError('coachInvoices.currency', e);
    return { currency: null, source: null, status: 'error', gap: 'unreadable' };
  }
}

/* ── telling the person it is about ───────────────────────────────────────── */

/**
 * Write the client an inbox row about an invoice that has just been issued.
 *
 * ── Why there was nothing here, and why there is now ──────────────────────
 *
 * Invoices had no notification producer of any kind. A coach issued a document
 * with somebody's name and an amount on it, and the person it was about was
 * told by nothing at all: not a push, not an inbox row, not a screen. The only
 * path to them was the coach remembering to open the share sheet.
 *
 * That is worse for `kind = 'received'` than for 'requested'. A "received"
 * invoice is the coach RECORDING THAT THIS PERSON HAS PAID THEM — a claim
 * about the client, made in the client's absence, that the client would want
 * to know exists whether or not they agree with it.
 *
 * ── On issue, and only on issue ───────────────────────────────────────────
 *
 * Voiding does not notify. A void is the coach withdrawing a document that
 * they, not this app, put in front of somebody: it may never have been sent at
 * all (the share sheet is a separate act), so a "your invoice was cancelled"
 * for a document the client has never seen is a notification about nothing.
 * The coach voids and tells them the same way they sent it.
 *
 * ── Inbox only. No push ───────────────────────────────────────────────────
 *
 * recordInbox() rather than sendPush(): an invoice is not urgent, and the row
 * is the durable half anyway — a push is gone when it is dismissed, and on the
 * current binary expo-notifications is not in the build at all. Nothing is
 * lost by not ringing a phone about paperwork.
 *
 * ── No route ─────────────────────────────────────────────────────────────
 *
 * Deliberately none. `coach_invoices` is readable by the ISSUING COACH ALONE
 * (part 138) and there is no client screen for it, by design — the coach hands
 * the document over, and that act is what decides the client should have it. A
 * route would send them looking for a screen that does not exist, so the row is
 * inert and its copy says to ask the coach instead.
 *
 * Returns three states; see IssueResult.notified.
 */
async function tellTheClient(invoice: CoachInvoice): Promise<boolean | null> {
  // No account, nobody to tell. A coach bills people who have never installed
  // this app and that is an ordinary invoice, not a failure.
  if (!invoice.clientId) return null;
  const note = invoiceNotification(invoice);
  try {
    // notify_users() re-checks on the server that this client is one of the
    // coach's own, so a stale id cannot address a stranger's inbox. It returns
    // the number of rows it wrote, which is the only honest answer to whether
    // this landed — an undeployed function and a refused write both come back
    // as zero, and both mean the client was not told.
    // One recipient, so `atCap` cannot be true here and is not read. The count
    // is still the only honest answer to whether this landed.
    const { recorded } = await recordInbox([invoice.clientId], note.title, note.body);
    return recorded > 0;
  } catch (e) {
    reportError('coachInvoices.notify', e);
    return false;
  }
}

/* ── issuing ──────────────────────────────────────────────────────────────── */

export interface IssueResult {
  ok: boolean;
  invoice?: CoachInvoice;
  error?: string;
  /**
   * Whether the client was told, and it is a THREE-STATE answer.
   *
   * `true`  — an inbox row was written for them.
   * `false` — the attempt was made and wrote nothing (the client is not on the
   *           coach's roster any more, or notify_users() was refused).
   * `null`  — nobody was addressed at all, because this invoice is not tied to
   *           an account. A coach bills people who have never installed this
   *           app, and there is nowhere to send those.
   *
   * Kept separate from `ok` so that no existing meaning changes: `ok` is
   * whether the DOCUMENT was issued, and it stays true when the notification
   * fails. An invoice that exists and a client who was not told is a real
   * state, and the screen has to be able to say both halves.
   */
  notified?: boolean | null;
}

/**
 * Issue one, through the function that allocates the number.
 *
 * The amount is converted to minor units HERE, once, by the same tested
 * function the screen uses to decide whether the Issue button is live — so the
 * figure that is checked and the figure that is sent cannot differ.
 *
 * `clientId` is passed only for a client with a real account. A person the
 * coach typed into their book by hand has no `clients` row, and part 138
 * refuses an id that is not one of the coach's own — so sending one would turn
 * a perfectly ordinary invoice into a refusal.
 */
export async function issueInvoice(draft: InvoiceDraft, clientId?: string | null): Promise<IssueResult> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build is not connected to a server, so nothing can be issued.' };
  const minor = draftMinorUnits(draft.amountText, draft.currency);
  if (minor == null) return { ok: false, error: 'That amount could not be read as money.' };
  const currency = (draft.currency || '').trim().toUpperCase();
  if (!currency) {
    return { ok: false, error: 'No currency has been set, so there is nothing to price this in. An owner sets it in the gym settings.' };
  }
  // Refused here as well as on the screen, so a rate that was validated and a
  // rate that is sent cannot differ, and so a caller added later cannot get a
  // figure onto a tax-bearing document without it passing the same reader.
  const rate = readTaxRate(draft.taxRateText);
  if (!rate.ok) return { ok: false, error: rate.reason };
  try {
    const { data, error } = await supabase.rpc('issue_coach_invoice', {
      p_bill_to: draft.billTo.trim(),
      p_description: draft.description.trim(),
      p_amount_cents: minor,
      p_issued_on: draft.issuedOn,
      p_kind: draft.kind,
      p_client_id: clientId ?? null,
      p_currency: currency,
      p_note: (draft.note || '').trim() || null,
      // Null rather than a computed default. Part 168's whole argument is that
      // a payment term this app invented would be printed on a document under
      // somebody else's name, so an empty field stays empty all the way down.
      p_due_on: (draft.dueOn || '').trim() || null,
      // What the coach stated about tax, and nothing this app worked out.
      // `readTaxRate` answers `pct: null` for an empty box — which is the
      // ordinary case and is a different document from one stating zero — and
      // refuses anything that is not a percentage rather than clamping it.
      p_tax_rate_pct: rate.ok ? rate.pct : null,
      p_tax_registration: (draft.taxRegistration || '').trim() || null,
    });
    if (error) {
      reportError('coachInvoices.issue', error);
      return { ok: false, error: error.message || 'That invoice was not issued.' };
    }
    // The function returns the row it inserted. Nothing came back means nothing
    // was written, whatever the absence of an error suggests.
    const row = (Array.isArray(data) ? data[0] : data) as InvoiceRow | null;
    if (!row?.id) return { ok: false, error: 'That invoice was not issued — nothing came back from the server.' };
    const invoice = toInvoice(row);
    return { ok: true, invoice, notified: await tellTheClient(invoice) };
  } catch (e) {
    reportError('coachInvoices.issue', e);
    return { ok: false, error: 'That invoice was not issued.' };
  }
}

/**
 * Chase one, and tell the person it is about.
 *
 * ── Two writes, and the second one is allowed to fail ─────────────────────
 *
 * `remind_coach_invoice` records the chase against the coach's own row. Then,
 * separately, an inbox row is written for the client. They are not one
 * transaction and they must not be reported as one: the coach's count of "I
 * have chased this four times" is a fact about what THEY did, and it stands
 * whether or not the notification landed. `notified` carries the second answer
 * in the same three states `issueInvoice` uses, so the screen can say both
 * halves rather than implying one from the other.
 *
 * The order matters. The record is written FIRST, so a chase the client was
 * told about is never one the coach's own list has forgotten. The reverse order
 * would let a failed record leave the client holding a reminder about an
 * invoice the coach believes they have never chased.
 *
 * ── Inbox only, no push ──────────────────────────────────────────────────
 *
 * The same reasoning as the issue notification: paperwork is not urgent, a push
 * is gone when it is dismissed, and on the current binary expo-notifications is
 * not in the build at all. Nothing is lost by not ringing somebody's phone
 * about money they may have already sent.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * It does not send the document. `coach_invoices` is readable by the issuing
 * coach alone (part 138), so the copy the client holds came from the share
 * sheet and a second copy comes the same way. The inbox row is a heads-up that
 * names the number, so the client can match it to the document they already
 * have — it is deliberately not a second invoice.
 */
export async function remindInvoice(id: string): Promise<IssueResult> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build is not connected to a server.' };
  try {
    const { data, error } = await supabase.rpc('remind_coach_invoice', { p_id: id });
    if (error) {
      reportError('coachInvoices.remind', error);
      return { ok: false, error: error.message || 'That reminder was not recorded.' };
    }
    // The function returns the row it updated. Nothing back means nothing was
    // written, whatever the absence of an error suggests — and a chase the
    // coach is told went out, that did not, is a client who hears nothing and a
    // coach who stops asking.
    const row = (Array.isArray(data) ? data[0] : data) as InvoiceRow | null;
    if (!row?.id) return { ok: false, error: 'That reminder was not recorded — nothing came back from the server.' };
    const invoice = toInvoice(row);
    return { ok: true, invoice, notified: await tellTheClientAgain(invoice) };
  } catch (e) {
    reportError('coachInvoices.remind', e);
    return { ok: false, error: 'That reminder was not recorded.' };
  }
}

/** The reminder's own inbox row. A separate function from `tellTheClient` and a
 *  separate copy function, because re-sending the issue notification would read
 *  as a SECOND invoice — which is exactly what the number on it exists to stop
 *  somebody believing. See `invoiceReminderNotification` in notifyCopy.ts. */
async function tellTheClientAgain(invoice: CoachInvoice): Promise<boolean | null> {
  if (!invoice.clientId) return null;
  const note = invoiceReminderNotification(invoice);
  try {
    // One recipient, so `atCap` cannot be true here and is not read. The count
    // is still the only honest answer to whether this landed.
    const { recorded } = await recordInbox([invoice.clientId], note.title, note.body);
    return recorded > 0;
  } catch (e) {
    reportError('coachInvoices.remind.notify', e);
    return false;
  }
}

/**
 * Record that one was paid, on a day the coach names (part 660).
 *
 * ── The write that had nowhere to go ──────────────────────────────────────
 *
 * This file's header says every write here is an `rpc` because "an issued
 * document cannot be edited once somebody is holding a copy of it". That is
 * right, and it is why a settlement is not an edit: `settle_coach_invoice`
 * writes three columns that did not exist on the document when it was issued
 * and leaves `kind` exactly as it was. The immutable guard still refuses to
 * move `kind`, `amount_cents`, `due_on` or anything else on the page.
 *
 * ── The client is not told ────────────────────────────────────────────────
 *
 * Deliberately no notification, and it is the opposite decision from `issue`.
 * An issue notification exists because the coach has made a claim ABOUT the
 * client — most sharply a 'received' one, which records that this person has
 * paid — in the client's absence. A settlement is the coach agreeing with
 * something the client already knows they did: they paid it. A push saying "your
 * coach noticed you paid" is a notification about nothing, and where the money
 * did NOT arrive the client hearing that it did is far worse than silence.
 *
 * Raises rather than updating nothing on the server, so "that is not yours",
 * "it is already settled" and "it is voided" arrive here as messages rather
 * than as a silent success over zero rows.
 */
export async function settleInvoice(id: string, settledOn: string, note?: string | null): Promise<IssueResult> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build is not connected to a server.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(settledOn ?? '').trim())) {
    return { ok: false, error: 'Say which day the money arrived.' };
  }
  try {
    const { data, error } = await supabase.rpc('settle_coach_invoice', {
      p_id: id,
      p_settled_on: settledOn.trim(),
      p_note: (note || '').trim() || null,
    });
    if (error) {
      reportError('coachInvoices.settle', error);
      return { ok: false, error: error.message || 'That settlement was not recorded.' };
    }
    const row = (Array.isArray(data) ? data[0] : data) as InvoiceRow | null;
    // Nothing back means nothing was written, whatever the absence of an error
    // suggests — and an invoice the coach believes came off their chase list
    // and did not is one part 613's nightly pass keeps telling them about.
    if (!row?.id) return { ok: false, error: 'That settlement was not recorded — nothing came back from the server.' };
    return { ok: true, invoice: toInvoice(row) };
  } catch (e) {
    reportError('coachInvoices.settle', e);
    return { ok: false, error: 'That settlement was not recorded.' };
  }
}

/**
 * Set, move, or clear the day the coach means to start chasing one (part 660).
 *
 * `from` null CLEARS it, and that is a real request rather than a no-op: it
 * puts the invoice back on the undated list, which is where it was before
 * anybody made a plan for it.
 *
 * This does not write `due_on` and cannot — that column is on the document and
 * on the immutable list, and part 660's function refuses this call outright on
 * an invoice that carries one, so no invoice ever has two answers to when it is
 * late.
 */
export async function setInvoiceChaseFrom(id: string, from: string | null): Promise<IssueResult> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build is not connected to a server.' };
  const day = (from || '').trim();
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, error: 'Write the day to start chasing from as a date.' };
  }
  try {
    const { data, error } = await supabase.rpc('set_coach_invoice_chase_from', { p_id: id, p_from: day || null });
    if (error) {
      reportError('coachInvoices.chaseFrom', error);
      return { ok: false, error: error.message || 'That was not changed.' };
    }
    const row = (Array.isArray(data) ? data[0] : data) as InvoiceRow | null;
    if (!row?.id) return { ok: false, error: 'That was not changed — nothing came back from the server.' };
    return { ok: true, invoice: toInvoice(row) };
  } catch (e) {
    reportError('coachInvoices.chaseFrom', e);
    return { ok: false, error: 'That was not changed.' };
  }
}

/**
 * Void one, once, with a reason.
 *
 * The row stays and the number stays spent — a deleted invoice leaves a hole in
 * a sequence the coach will one day have to explain, and a voided one explains
 * itself. Part 138 raises rather than updating nothing, so "that is not yours"
 * and "it was already voided" arrive here as messages rather than as a silent
 * success over zero rows.
 */
export async function voidInvoice(id: string, reason: string): Promise<IssueResult> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build is not connected to a server.' };
  if (!reason.trim()) return { ok: false, error: 'Say why it is being voided.' };
  try {
    const { data, error } = await supabase.rpc('void_coach_invoice', { p_id: id, p_reason: reason.trim() });
    if (error) {
      reportError('coachInvoices.void', error);
      return { ok: false, error: error.message || 'That invoice was not voided.' };
    }
    const row = (Array.isArray(data) ? data[0] : data) as InvoiceRow | null;
    if (!row?.id) return { ok: false, error: 'That invoice was not voided — nothing came back from the server.' };
    return { ok: true, invoice: toInvoice(row) };
  } catch (e) {
    reportError('coachInvoices.void', e);
    return { ok: false, error: 'That invoice was not voided.' };
  }
}
