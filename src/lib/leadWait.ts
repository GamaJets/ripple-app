// Coach · Enquiries, ordered by how long nothing has been done about them.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// `shapeLeads` in src/lib/leads.ts sorts by state first — New, then Contacted,
// then Closed — and on `at` DESCENDING inside each of the three, and
// app/(trainer)/leads.tsx draws that order straight down the screen. Newest
// first is the right order for "who has just come in", which is the question a
// coach asks when the phone buzzes.
//
// It is the wrong order for the only question that costs them anything. An
// enquiry is a stranger who left their phone number with somebody they have
// never met, and the one that loses a client is never at the top: it is the one
// that arrived eleven days ago, was scrolled past on the morning it landed, and
// has sunk one position for every enquiry since. Newest-first is the order that
// buries it — and the better the coach's marketing works, the faster it buries
// it. Nothing on that screen surfaced it, and the filter chips cannot: 'New' is
// a stage, not an age, and a coach with fourteen New enquiries still reads them
// top-down and still meets the oldest last.
//
// ── What "nothing has been done" is allowed to mean ───────────────────────
//
// Two columns, and both of them are marks the COACH made by hand:
//
//   `state === 'new'`   they have not pressed Mark Contacted or Mark Closed.
//   no follow-up note   `coach_lead_notes` holds nothing against this enquiry.
//
// BOTH, never either. A coach who rang somebody and wrote it up but never
// touched the chips has done the thing this list is about, and so has one who
// pressed Mark Contacted and wrote nothing. Either test alone puts a person who
// has already been dealt with at the top of a queue headed by how long they
// have been ignored, and the first time a coach sees that they stop opening it —
// the same failure src/lib/awaitingReply.ts describes for a list that files a
// thank-you as an outstanding task.
//
// ── The sentence never accuses ─────────────────────────────────────────────
//
// `FOLLOW_UP_IS_MANUAL` is printed at the top of that screen in those words:
// this app sends nothing, and recording what you did is a thing you type. So a
// coach who phoned an enquiry from the gym floor on Tuesday and never came back
// to write it down has a row here that is, as a claim about them, false.
//
// `leadWaitLine` therefore states the RECORD and not the person — "nothing has
// been recorded against it" — which stays true in that case, and is the same
// discipline as `AGEING_IS_YOUR_OWN_RECORD` in src/lib/chaseList.ts: nobody
// tells this app when a client pays either, so the note says what the coach's
// own records show rather than what the coach did.
//
// ── A separate section, not a re-sort ─────────────────────────────────────
//
// The list below it keeps its own order. Re-sorting a list a coach is scanning
// makes the next tap land on somebody else, and the chips already move the
// ground under them once. This is a different object: a short queue, worked
// from the top, where the longest wait is at the top BY DEFINITION. Two orders
// that each stay right beats one order that has to be both.
//
// Ties break on `id` so the order is total — two enquiries left in the same
// second must not swap places between renders.
//
// Pure and framework-free: no clock, no storage, no network. `now` is the
// caller's, which is the same device clock the rows are stamped against.
import type { LoadStatus } from '../ui/loadStatus';
import { isWhole } from '../ui/loadStatus';
import type { LeadRow } from './leads';
// Whole units only, and the same words the Messages queue uses. Two coach-facing
// queues that describe a three-day wait differently are two queues a coach has
// to learn separately; the argument for whole units is in that file's header and
// is not worth having twice.
import { waitedLabel } from './awaitingReply';

/** One enquiry nobody has marked or written against, and how long that has been
 *  true. `waitedMs` is always finite and never negative — a row whose age could
 *  not be measured is counted in `undated`, not placed in the order. */
export interface LeadWait {
  lead: LeadRow;
  waitedMs: number;
}

export interface LeadWaitBook {
  /** Longest wait first. */
  rows: LeadWait[];
  /**
   * Untouched enquiries whose `at` could not be read as an instant.
   *
   * Counted rather than dropped and said out loud by `leadWaitNote`. A queue
   * that quietly loses a row reads as "that is everybody", which is a claim —
   * and the row it loses is a real person who left a real phone number.
   */
  undated: number;
  /** Why this may not be the whole answer, or null when it is. */
  withheld: string | null;
}

/**
 * Milliseconds since an ISO INSTANT, or null when the string is not one.
 *
 * A bare `YYYY-MM-DD` is refused rather than parsed. `Date.parse` reads one as
 * UTC midnight, so west of Greenwich an enquiry left this morning comes back
 * having already waited most of a day, and far enough east one left last night
 * has not arrived yet. `coach_leads.at` is a timestamptz and should never be
 * bare — but this list exists to be believed, and the one thing worse than not
 * showing an age is showing one that is a time zone wide of the truth. An
 * unmeasurable row goes to `undated`, which the screen says out loud.
 */
function stood(iso: string | null, now: number): number | null {
  if (!iso) return null;
  if (!iso.includes('T')) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return null;
  const ms = now - t;
  // A clock skew that puts the enquiry in the future is not a wait. Same
  // handling as `waitedOn` in src/lib/awaitingReply.ts, which refuses to print
  // a negative age rather than dressing one up.
  if (ms < 0) return 0;
  return ms;
}

/**
 * The queue.
 *
 * `status` never changes WHICH rows are listed: the enquiries that came back
 * are real people whatever else did not, and hiding them would hide exactly the
 * ones this section exists to surface. It decides only what may be SAID — see
 * `withheld`, and `leadWaitCountNote`, which withholds the count rather than
 * stating a total over part of a book.
 *
 * `recorded` answers "has the coach written anything against this enquiry".
 * `notesRead` is whether that answer can be trusted at all: src/ui/leads.ts
 * sets `followUpsUnread` when the follow-up read failed or came back short, and
 * under that a `false` from `recorded` means "we did not see a note", which is
 * not "there is no note". The rows still list — an enquiry marked New is still
 * an enquiry marked New — and the doubt goes into `withheld`.
 */
export function waitingLeads(
  rows: readonly LeadRow[],
  recorded: (leadId: string) => boolean,
  notesRead: boolean,
  now: number,
  status: LoadStatus,
): LeadWaitBook {
  const out: LeadWait[] = [];
  let undated = 0;

  for (const lead of rows) {
    // Their own mark, read back. 'contacted' and 'closed' are the coach saying
    // they have dealt with it, and this list does not second-guess either.
    if (lead.state !== 'new') continue;
    if (recorded(lead.id)) continue;
    const waited = stood(lead.at, now);
    if (waited === null) { undated += 1; continue; }
    out.push({ lead, waitedMs: waited });
  }

  out.sort((a, b) =>
    (b.waitedMs - a.waitedMs)
    || (a.lead.id < b.lead.id ? -1 : a.lead.id > b.lead.id ? 1 : 0));

  return { rows: out, undated, withheld: withheldFor(status, notesRead) };
}

/** Why the queue below may not be all of it. Null only when both reads landed
 *  whole — the enquiry read decides who is listed, the follow-up read decides
 *  whether "nothing has been recorded" can be said about any of them. */
function withheldFor(status: LoadStatus, notesRead: boolean): string | null {
  switch (status) {
    case 'loading':
      return 'Still reading your enquiries, so this covers only the ones that have arrived so far.';
    case 'partial':
      return 'More enquiries exist than came back, so this is drawn from the ones that arrived. Somebody may have been waiting longer than anybody here.';
    case 'error':
      return 'Your enquiries could not be read, so this is not a list of who has been waiting. It is what was on the screen before the read failed.';
    case 'ready':
      return notesRead
        ? null
        : 'What you recorded about following people up could not be read, so some of these may already have been dealt with. This is which enquiries are still marked New, and nothing more.';
  }
}

/** The section's title. Title Case, like its siblings on that screen, and it
 *  describes the ORDER rather than passing a verdict — "Ignored" and "Neglected"
 *  are both sentences about the coach, and this list cannot see a phone call. */
export const LEAD_WAIT_TITLE = 'Waiting Longest';

/** Whether the section is drawn at all. False when there is nothing waiting and
 *  nothing uncertain: a coach who has worked their enquiries to zero should not
 *  be shown an empty queue congratulating them every morning — the absence is
 *  the message, same rule as `hasWaiting` in src/lib/awaitingReply.ts. */
export function hasLeadWait(book: LeadWaitBook): boolean {
  return book.rows.length > 0 || book.undated > 0;
}

/**
 * The count beside the title, or null when no count may be stated.
 *
 * A number only under a whole read, because under 'partial' this is a subtotal
 * and "6 enquiries" printed over four fifths of a book is exactly the confident
 * figure src/ui/loadStatus.ts exists to refuse. The head loses its note and
 * `leadWaitNote` carries the doubt in words instead.
 */
export function leadWaitCountNote(book: LeadWaitBook, status: LoadStatus): string | null {
  if (!isWhole(status)) return null;
  const n = book.rows.length;
  if (n === 0) return null;
  return n === 1 ? '1 enquiry' : `${n} enquiries`;
}

/**
 * The line under one row: how long it has stood, and what the record shows.
 *
 * The subject is the enquiry, never the coach. "You have not replied" is a
 * claim this list cannot support — the coach may have rung them from the gym
 * floor and never come back to type it — and the first row where that is wrong
 * is the row that teaches them to stop reading the section.
 */
export function leadWaitLine(w: LeadWait): string {
  const ago = waitedLabel(w.waitedMs);
  return `Left ${ago} ago. Still marked New, with nothing recorded against it.`;
}

/**
 * The one at the top, named — the whole point of the section.
 *
 * Null when the queue is empty, so the caller renders nothing rather than a
 * sentence with a hole where a name goes. Stated only under a whole read: under
 * 'partial' the oldest enquiry the app HAS is not the oldest enquiry the coach
 * has, and "longest of all" is the one word that would be wrong.
 */
export function longestWaitingLine(book: LeadWaitBook, status: LoadStatus): string | null {
  const top = book.rows[0];
  if (!top) return null;
  const ago = waitedLabel(top.waitedMs);
  return isWhole(status)
    ? `${top.lead.name} has been waiting the longest: ${ago}.`
    : `${top.lead.name} has waited ${ago}, which is the longest of the enquiries that came back.`;
}

/** The half-sentence `leadWaitNote` finishes with. Its own constant because it
 *  is the caveat that keeps the section honest and it must not be edited out of
 *  the sentence it lives in by somebody shortening a line. */
export const LEAD_WAIT_TITLE_NOTE =
  'if you rang somebody and did not write it down, this app never saw it and they are still on this list.';

/**
 * The sentence under the heading, or null when there is nothing to add.
 *
 * `withheld` first, because a doubt about the whole list comes before a detail
 * about part of it, then the rows whose age could not be measured.
 */
export function leadWaitNote(book: LeadWaitBook): string | null {
  const parts: string[] = [];
  if (book.withheld) parts.push(book.withheld);
  if (book.undated > 0) {
    parts.push(book.undated === 1
      ? 'One more enquiry has no readable date on it, so it cannot be placed in this order and is not counted here either way.'
      : `${book.undated} more enquiries have no readable date on them, so they cannot be placed in this order and are not counted here either way.`);
  }
  if (parts.length === 0 && book.rows.length > 0) {
    parts.push(`Oldest first. These are the enquiries still marked New with no follow-up written against them. ${LEAD_WAIT_TITLE_NOTE}`);
  }
  return parts.length ? parts.join(' ') : null;
}
