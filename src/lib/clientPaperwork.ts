// Has THIS person signed it?
//
// ── The question the app could not answer ──────────────────────────────────
//
// src/lib/coachDocs.ts has had the answer since part 135: `outstanding(d)` —
// "Required, still in circulation, and this reader has not accepted it" — under
// a header that calls it "the one question the client portal asks". It is
// imported by exactly one file, app/(client)/coach-documents.tsx. Nothing under
// app/(trainer)/ except the Documents screen has ever touched a coach document
// at all.
//
// So the coach's version of that question had one route: open Documents, tap
// "Who's accepted" on a document, and read a list of every client on the
// roster. One document at a time. The coach's question is never "who has signed
// the waiver", it is "has this person signed it", and it is asked ninety
// seconds before a first session with a stranger standing in front of them.
// Nobody reads a roster-length list twice; they train the person and hope.
//
// ── Why this is a module and not three lines on a screen ───────────────────
//
// Because being wrong here is not a wrong number, it is a coach believing
// somebody is covered. Three things have to line up and each of them has a way
// of quietly producing "signed" out of nothing:
//
//   · RETIRED documents. A withdrawn waiver is not something to chase, and
//     counting it as outstanding would put a permanent red flag on a client who
//     has done nothing wrong.
//   · ADDRESSED documents (part 156). A document sent to one client is not in
//     front of anybody else, and `coach_document_recipients` is the only thing
//     that says so. Reporting a client as not having signed a document they
//     were never shown is a false accusation about a real person, and it is the
//     mistake a naive join makes first.
//   · A read that FAILED or was TRUNCATED. Nought outstanding computed from
//     part of a set, or from nothing at all, is the sentence "they are covered"
//     — which is the one sentence on this screen that must never be produced by
//     an accident. src/lib/rowCap.ts: a truncated read is strictly worse than a
//     failed one.
//
// Nothing here reads a clock, a database or React, so every rule above is
// asserted under `npm test`.
import type { LoadStatus } from '../ui/loadStatus';

/** A required document of this coach's, narrowed to what the question needs. */
export interface PaperworkDoc {
  id: string;
  title: string;
  required: boolean;
  retired: boolean;
  /** ISO. Used only to order the list — newest first, because the thing a coach
   *  has just issued is the thing being asked about. */
  createdAt: string;
}

/** A row of `coach_document_recipients`: this document was addressed to this
 *  person, and therefore to nobody else who is not also named. */
export interface PaperworkRecipient { documentId: string; clientId: string }

/** A row of `coach_document_acceptances` for one client. */
export interface PaperworkAcceptance { documentId: string; acceptedAt: string }

export interface PaperworkItem {
  id: string;
  title: string;
  /** When they accepted it, or null when they have not. */
  acceptedAt: string | null;
}

/**
 * What this one client still owes the coach, and what they have signed.
 *
 * Ordered outstanding first — that is the half a coach is standing there to
 * find out — then newest first inside each half.
 *
 * A document with NO recipient rows is open to the whole roster, which is what
 * every document uploaded before part 156 means and what a new one means until
 * somebody is named. A document with recipient rows is this client's only when
 * one of them names them; otherwise it is not in front of them and does not
 * appear here at all, in either half.
 */
export function paperworkFor(o: {
  docs: readonly PaperworkDoc[];
  recipients: readonly PaperworkRecipient[];
  acceptances: readonly PaperworkAcceptance[];
  clientId: string;
}): PaperworkItem[] {
  const addressed = new Set(o.recipients.map((r) => r.documentId));
  const toThem = new Set(
    o.recipients.filter((r) => r.clientId === o.clientId).map((r) => r.documentId),
  );
  const acceptedAt = new Map<string, string>();
  for (const a of o.acceptances) {
    // The earliest acceptance is the one that counts. A second row for the same
    // document cannot make an acceptance later than it was.
    const prev = acceptedAt.get(a.documentId);
    if (!prev || a.acceptedAt < prev) acceptedAt.set(a.documentId, a.acceptedAt);
  }

  return o.docs
    .filter((d) => d.required && !d.retired)
    .filter((d) => !addressed.has(d.id) || toThem.has(d.id))
    .map((d) => ({
      id: d.id,
      title: d.title,
      createdAt: d.createdAt,
      acceptedAt: acceptedAt.get(d.id) ?? null,
    }))
    .sort((a, b) =>
      // What is owed, first. Then the newest document, because the one a coach
      // has just issued is the one being asked about. Then the title, so the
      // order is stable rather than whatever the read happened to return.
      Number(a.acceptedAt != null) - Number(b.acceptedAt != null)
      || String(b.createdAt).localeCompare(String(a.createdAt))
      || a.title.localeCompare(b.title))
    .map(({ id, title, acceptedAt: at }) => ({ id, title, acceptedAt: at }));
}

/** How many are still outstanding. The caller must have checked the read first
 *  — see `paperworkLine`, which is where that check is enforced. */
export const unsignedCount = (items: readonly PaperworkItem[]): number =>
  items.filter((i) => i.acceptedAt == null).length;

/**
 * The one sentence a coach reads before deciding whether to train somebody.
 *
 * Five states and they are five different facts. The three that are not about
 * paperwork at all — still reading, could not read, read only part of it — come
 * first, because every one of them would otherwise be rendered by the same
 * count as "nothing outstanding".
 *
 * `who` is the client in the coach's own words. It is never a stand-in for a
 * name that could not be read: the caller passes a description ("this client")
 * rather than somebody else's name, which is the rule TF-32 exists for.
 */
export function paperworkLine(read: LoadStatus, items: readonly PaperworkItem[], who: string): string {
  if (read === 'loading') return `Reading whether ${who} has signed your paperwork.`;
  if (read === 'error') {
    return `Whether ${who} has signed your paperwork could not be read. That is a read that failed, not a record of them having signed nothing — `
      + 'do not take it either way.';
  }
  if (read === 'partial') {
    return `You have more paperwork than this could bring back, so it cannot say whether ${who} has signed all of it. `
      + 'Open Documents and check the ones that matter.';
  }
  if (!items.length) {
    return 'You have no paperwork that has to be signed. Anything you upload and mark as required will be listed here, per client.';
  }
  const owed = unsignedCount(items);
  if (owed === 0) {
    return items.length === 1
      ? `${who} has accepted the one document you require.`
      : `${who} has accepted all ${items.length} documents you require.`;
  }
  return owed === 1
    ? `${who} has NOT accepted 1 of the ${items.length} document${items.length === 1 ? '' : 's'} you require.`
    : `${who} has NOT accepted ${owed} of the ${items.length} documents you require.`;
}

/**
 * Whether this is worth flagging rather than merely stating.
 *
 * True only under a whole read with something genuinely outstanding. A failed
 * read is NOT a warning: a red flag over an unknown is the same lie as a green
 * one, and it teaches a coach to ignore the colour.
 */
export const paperworkOutstanding = (read: LoadStatus, items: readonly PaperworkItem[]): boolean =>
  read === 'ready' && unsignedCount(items) > 0;

/** The line under one document's title, in the coach's list. `fmtDay` is passed
 *  in so this file names no locale and reads no clock. */
export function paperworkItemLine(i: PaperworkItem, fmtDay: (iso: string) => string): string {
  return i.acceptedAt ? `Accepted ${fmtDay(i.acceptedAt)}` : 'Not accepted';
}
