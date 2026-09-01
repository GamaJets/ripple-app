// An enquiry: somebody who opened a coach's join link and left their details
// without making an account.
//
// ── What this is for ──────────────────────────────────────────────────────
//
// A join code measures CONVERSIONS. src/lib/joinCodes.ts counts who spent one,
// src/lib/codeReturn.ts says what each one cost and returned, src/lib/adMatch.ts
// reads the code out of an ad's destination so none of it has to be mapped by
// hand. Every one of those numbers is about a person who already installed the
// app, already made an account and already decided.
//
// The person who clicked and did not join is in none of them, and there are
// more of those than there are clients. `supabase/parts/157` adds the one
// unauthenticated write that records them; this file is the part of the feature
// that can be reasoned about without a database.
//
// ── The rule this file exists to hold ─────────────────────────────────────
//
// Attribution here is the SAME attribution as ad spend, and deliberately not a
// second one. `attributeLeads` matches an enquiry's `via_code` against the
// coach's own codes exactly as `matchAds` matches an ad's destination: uppercase
// on both sides, an exact string match, and a code that is not one of theirs is
// reported as unknown rather than guessed at. Two attribution rules for the same
// six characters would let a screen say an ad cost £400 for a campaign whose
// enquiries it filed somewhere else.
//
// ── And the rule src/lib/joinCodes.ts already wrote down ──────────────────
//
// A count is the one part of this answer that can be silently wrong, and under
// a failed read the honest output is a dash. A coach shown "0 enquiries" for
// their flyer will conclude the flyer failed and stop printing it, and nothing
// on screen would say the read did not complete. See src/ui/loadStatus.ts — an
// empty list under 'error' means UNKNOWN.
//
// ── What is deliberately absent ───────────────────────────────────────────
//
// There is no send here, no schedule, no template and no sequence. Repple has
// no email channel at all — "Email as a channel" is a separate unbuilt item —
// so a follow-up sequence would be a promise the app cannot keep, and a coach
// would watch a lead sit at "Day 2 of 5" while nothing was ever sent. Following
// one of these up is manual today, and FOLLOW_UP_IS_MANUAL is the sentence the
// screen says so with.
import { num } from './format';
import type { KnownCode } from './adMatch';
import type { LoadStatus } from '../ui/loadStatus';

/** Longest name the server stores — leave_my_details truncates past this. */
export const MAX_LEAD_NAME = 80;
/** Longest contact string the server stores. */
export const MAX_LEAD_CONTACT = 120;
/** Longest message the server stores. */
export const MAX_LEAD_NOTE = 500;
/** Longest follow-up note the coach may record against one enquiry. */
export const MAX_FOLLOW_UP = 1000;

/** Where an enquiry stands. Mirrors the CHECK on `coach_leads.state`. */
export type LeadState = 'new' | 'contacted' | 'closed';

/**
 * The three states, in the order a coach works through them.
 *
 * There is no 'joined', and there cannot be. An enquiry carries no account, so
 * nothing can ever link it to the `coach_requests` row that person may later
 * create — a fourth state would be the app guessing, and a coach would divide
 * by it. Part 157 says the same thing on the column.
 */
export const LEAD_STATES: LeadState[] = ['new', 'contacted', 'closed'];

/** Title Case, because these render as the labels on buttons and filters. */
export const LEAD_STATE_LABEL: Record<LeadState, string> = {
  new: 'New',
  contacted: 'Contacted',
  closed: 'Closed',
};

/** Sentence case: this is the line under the state, not the state. */
export const LEAD_STATE_NOTE: Record<LeadState, string> = {
  new: 'Nobody has reached out yet.',
  contacted: 'You have reached out. What you did is below.',
  closed: 'Finished — whether they joined or not.',
};

/** A row of `coach_leads`, as PostgREST hands it back. */
export type RawLead = {
  id: string | null;
  name: string | null;
  contact: string | null;
  note: string | null;
  via_code: string | null;
  at: string | null;
  state: string | null;
};

/** What kind of thing somebody typed to be reached on. */
export type ContactKind = 'email' | 'phone' | 'unknown';

/** The same row, once it is safe to render. */
export type LeadRow = {
  id: string;
  name: string;
  contact: string;
  contactKind: ContactKind;
  note: string | null;
  /** The code as it resolved, uppercased. The attribution. */
  viaCode: string;
  /**
   * The coach's own name for that code — 'Gym flyer', 'Instagram bio'.
   *
   * Null when the code is not one the coach holds now. That is not impossible
   * and it is not a fault: a coach can rotate their default code, and the old
   * string stops existing anywhere while the enquiries it brought in remain
   * true. A screen must say "not one of your current codes" rather than
   * inventing a campaign name or dropping the row.
   */
  campaign: string | null;
  at: string | null;
  state: LeadState;
};

/** One line of what the coach did about an enquiry. Append-only server side. */
export type RawFollowUp = { id: string | null; body: string | null; at: string | null };
export type FollowUp = { id: string; body: string; at: string | null };

/**
 * Said on the screen, above the list, and not softened.
 *
 * This app cannot send an email or a text. A coach who is not told that will
 * assume an enquiry has been acknowledged by something, and the person who
 * left their number will hear nothing at all.
 */
export const FOLLOW_UP_IS_MANUAL =
  'Repple does not contact these people. Nothing has been sent to them and nothing will be — following one of these up is you, in your own phone, today. What you record here is a note to yourself.';

/**
 * Said on the form, and repeated here so the app and the web page agree.
 *
 * The server drops an enquiry whose code resolves to nobody, because a row with
 * no coach is a row nobody can read, act on or erase. That is the right trade
 * against an unauthenticated write path, and it has a cost a coach should know
 * about: a mistyped code is an enquiry neither of you will ever see.
 */
export const MISTYPED_CODE_NOTE =
  'An enquiry only reaches you if the link carried one of your codes. Somebody who retyped it wrong is not held anywhere — there is no coach to give them to.';

const clean = (v: string | null | undefined, max: number): string =>
  String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * What somebody typed to be reached on: an email, a phone number, or neither.
 *
 * ONE field on the form and one column in the database, because this product
 * cannot send an email — a column called `email` would be the first half of a
 * promise — and because half the people who fill in a coach's form would rather
 * be texted anyway. So the kind is read back out of the string here, where it
 * can be asserted on, instead of being asked for on the form.
 *
 * 'unknown' is a real answer and is never guessed away. An Instagram handle, a
 * WhatsApp name and a typo all land there, and the screen shows the string as
 * typed with no tel: or mailto: on it — offering to dial something that is not
 * a number is worse than offering nothing, because the coach finds out after
 * they have tapped it.
 *
 * Email is tested first: '+44 7700 900123' contains no '@', and
 * 'joe+ads@x.com' contains digits and a '+' and would read as a phone number
 * under a looser order.
 */
export function contactKind(v: string | null | undefined): ContactKind {
  const s = String(v ?? '').trim();
  if (!s) return 'unknown';
  // Deliberately not RFC 5322. The question is "can this be handed to a mail
  // app", and the shape that answers it is: something, one @, something with a
  // dot in it, no spaces.
  if (/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s)) return 'email';
  // A phone number as people write them: an optional leading +, then digits
  // with spaces, dashes, dots or brackets between them. Seven digits is the
  // shortest real subscriber number; more than fifteen is not a number under
  // E.164 and is usually somebody's account id.
  const digits = s.replace(/\D/g, '');
  if (/^\+?[\d\s().-]+$/.test(s) && digits.length >= 7 && digits.length <= 15) return 'phone';
  return 'unknown';
}

/** Rank for sorting: what still needs doing, first. */
const stateRank = (s: LeadState): number => (s === 'new' ? 0 : s === 'contacted' ? 1 : 2);

const asState = (v: string | null | undefined): LeadState =>
  v === 'contacted' || v === 'closed' ? v : 'new';

/**
 * Raw rows → rows worth rendering, in the order they should be worked through.
 *
 * New first, then contacted, then closed; newest first inside each. A coach
 * opens this screen to find out who is waiting on them, and burying a person
 * who enquired this morning under three months of closed enquiries is the same
 * failure as burying the drift figure on the Clients tab — the list is only
 * worth having if the thing to do next is at the top of it.
 *
 * A row with no id, no name or no contact is DROPPED rather than drawn blank.
 * The database constrains all three to be non-empty, so this cannot happen off
 * a healthy read; a blank line under the word "enquiries" is a coach ringing
 * nobody, and a row with no id cannot be marked, noted or erased afterwards.
 *
 * `codes` is the coach's own list, in `matchAds`'s shape, so the same
 * uppercase-exact rule attributes an enquiry and an ad. Passing an empty list
 * because the codes read FAILED would name every campaign null; that is why
 * the caller gates on the codes' status and not only on the leads'.
 */
export function shapeLeads(rows: RawLead[] | null | undefined, codes: KnownCode[] | null | undefined): LeadRow[] {
  const byCode = new Map<string, string>();
  for (const c of codes || []) {
    const code = String(c?.code ?? '').trim().toUpperCase();
    if (code) byCode.set(code, c.label || code);
  }

  const out: LeadRow[] = [];
  for (const r of rows || []) {
    const id = String(r?.id ?? '').trim();
    const name = clean(r?.name, MAX_LEAD_NAME);
    const contact = clean(r?.contact, MAX_LEAD_CONTACT);
    if (!id || !name || !contact) continue;
    const viaCode = String(r?.via_code ?? '').trim().toUpperCase();
    out.push({
      id,
      name,
      contact,
      contactKind: contactKind(contact),
      note: clean(r?.note, MAX_LEAD_NOTE) || null,
      viaCode,
      campaign: byCode.get(viaCode) ?? null,
      at: r?.at ?? null,
      state: asState(r?.state),
    });
  }

  return out.sort((a, b) => {
    const rs = stateRank(a.state) - stateRank(b.state);
    if (rs !== 0) return rs;
    const at = a.at ? Date.parse(a.at) : NaN;
    const bt = b.at ? Date.parse(b.at) : NaN;
    const av = Number.isFinite(at);
    const bv = Number.isFinite(bt);
    // A row with no readable timestamp sorts last within its state rather than
    // to the top: Date.parse gives NaN, every comparison against NaN is false,
    // and a sort that leaves those wherever they landed reorders the list
    // between two reads of the same data.
    if (av !== bv) return av ? -1 : 1;
    if (av && bv && at !== bt) return bt - at;
    return a.id.localeCompare(b.id);
  });
}

/** Follow-up rows → what is safe to render, newest first. */
export function shapeFollowUps(rows: RawFollowUp[] | null | undefined): FollowUp[] {
  const out: FollowUp[] = [];
  for (const r of rows || []) {
    const id = String(r?.id ?? '').trim();
    const body = String(r?.body ?? '').trim().slice(0, MAX_FOLLOW_UP);
    if (!id || !body) continue;
    out.push({ id, body, at: r?.at ?? null });
  }
  return out.sort((a, b) => {
    const at = a.at ? Date.parse(a.at) : NaN;
    const bt = b.at ? Date.parse(b.at) : NaN;
    const av = Number.isFinite(at);
    const bv = Number.isFinite(bt);
    if (av !== bv) return av ? -1 : 1;
    if (av && bv && at !== bt) return bt - at;
    return a.id.localeCompare(b.id);
  });
}

/**
 * The line under the heading. Sentence case, and it states no figure it cannot
 * stand behind.
 *
 * 'partial' is possible here in a way it is not for `my_join_codes()`: this is
 * an ordinary table read through PostgREST, which stops at 1,000 rows and says
 * nothing (see src/lib/rowCap.ts). A coach with a busy campaign really can pass
 * that, and a count taken off a truncated page would be a subtotal printed as a
 * total. So 'partial' states the shown figure as a floor and never as the
 * answer.
 */
export function leadCountLine(status: LoadStatus, rows: LeadRow[]): string {
  if (status === 'loading') return 'Counting who has been in touch…';
  if (status === 'error') {
    return 'Your enquiries could not be read, so nothing here is a count. This is not an empty inbox.';
  }
  const waiting = rows.filter((r) => r.state === 'new').length;
  if (status === 'partial') {
    return `More enquiries came back than could be read in one go. ${num(rows.length)} of them are below and there are more — this is not the whole list, and no figure on this screen is a total.`;
  }
  if (rows.length === 0) {
    return 'Nobody has left their details yet. Your join link carries the form — share it and enquiries land here.';
  }
  const total = `${num(rows.length)} ${rows.length === 1 ? 'enquiry' : 'enquiries'}`;
  return waiting ? `${total} · ${num(waiting)} waiting on you.` : `${total}, all of them dealt with.`;
}

/**
 * Why this enquiry cannot be submitted, or null if it can.
 *
 * The web form at web/join.html enforces the same two rules and states the same
 * two limits, and it has to: `leave_my_details` returns void for every input it
 * is ever given — a blank name and a good one are indistinguishable outcomes on
 * purpose, because a function that answers differently for different inputs is
 * an oracle over join codes. See supabase/parts/157. That makes the client the
 * ONLY place a person can be told they left the name blank, which is why the
 * rules live in a pure module rather than inline in a page.
 */
export function leadProblem(name: string | null | undefined, contact: string | null | undefined): string | null {
  const nm = String(name ?? '').trim();
  const ct = String(contact ?? '').trim();
  if (!nm) return 'Put in a name, so the coach knows who is asking.';
  if (nm.length > MAX_LEAD_NAME) return `Keep the name to ${MAX_LEAD_NAME} characters or fewer.`;
  if (!ct) return 'Put in an email address or a phone number, or the coach has no way to answer.';
  if (ct.length > MAX_LEAD_CONTACT) return `Keep that to ${MAX_LEAD_CONTACT} characters or fewer.`;
  if (contactKind(ct) === 'unknown') {
    return 'That does not look like an email address or a phone number. The coach will reply to whatever you put here, so it has to be something they can reach you on.';
  }
  return null;
}

/**
 * Why this follow-up note cannot be saved, or null if it can.
 *
 * Blank is refused rather than saved as an empty row: the record is the point,
 * and an empty record of a phone call is worse than no record, because it looks
 * from the list like the call was written up.
 */
export function followUpProblem(body: string | null | undefined): string | null {
  const b = String(body ?? '').trim();
  if (!b) return 'Write what you did, so the next time you open this you know where it got to.';
  if (b.length > MAX_FOLLOW_UP) return `Keep it to ${MAX_FOLLOW_UP} characters or fewer.`;
  return null;
}
