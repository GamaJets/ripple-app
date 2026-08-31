// A coach's own paperwork, and the record that somebody accepted it.
//
// ── What this is, and what it is emphatically not ─────────────────────────
//
// `liability_waivers` (supabase/parts/84) is REPPLE's release. It is the
// client's legal record, it has no coach read policy, and nothing in this file
// touches it or ever should. If you are here because a coach wants to see a
// Repple waiver, this is the wrong file and there is no right one.
//
// This is the other thing: the studio waiver, the par-form, the photography
// consent, the house rules for the unit a trainer rents. A working PT has their
// own paperwork, and until part 135 the app that held the bookings and the
// injuries and the money held no record that a client had agreed to any of it.
//
// ── The shape of the object key, and why it is checked here too ──────────
//
//   <coach_uid>/<millis>-<token>-<slug>.<ext>
//
// The first segment is the owning coach and it is the only thing the storage
// policies read (`can_read_coach_doc`). Building and validating the same shape
// on the device is what turns a mismatch into a sentence somebody can act on
// rather than a bare 403 the app renders as "uploaded".
//
// ── Accepting is not editable, and the app must not imply otherwise ──────
//
// `coach_document_acceptances` has no UPDATE and no DELETE policy and no grant
// behind one, exactly as part 84's does. There is no un-accept. Every sentence
// below is written to be true of that: nothing offers to withdraw an
// acceptance, and the coach-side wording never suggests they can edit a
// document people have already signed — a re-issue is a new document and a
// retirement of the old one, which the immutability trigger in part 135
// enforces whatever a screen believes.
import { fmtDay } from './format';

/** Matches the bucket's `file_size_limit` and `coach_documents_bytes_chk`. The
 *  device checks it BEFORE uploading, because a 413 from storage arrives as an
 *  opaque failure and "that file is too large" is a sentence somebody can act
 *  on. */
export const MAX_DOC_BYTES = 10485760;

/** Matches the bucket's `allowed_mime_types` and `coach_documents_mime_chk`.
 *  PDF because that is what a waiver is; JPEG and PNG because a coach with a
 *  paper form photographs it. */
export const DOC_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** The extension for a type we accept, or null for one we do not. */
export function extForMime(mime: string | null | undefined): string | null {
  return (mime && EXT[mime]) || null;
}

/** A filename reduced to something safe to put in an object key. Never empty:
 *  a document whose name was entirely punctuation would otherwise produce a key
 *  with a double dash where the slug should be. */
export function slugify(name: string | null | undefined): string {
  const base = (name ?? '').replace(/\.[^./\\]+$/, '');
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || 'document';
}

/**
 * The object key for a new upload.
 *
 * `token` is passed in rather than generated here so the caller supplies the
 * randomness it already has and this stays pure and testable. `millis` likewise:
 * two documents uploaded in the same second must not collide, which is what the
 * token is for, and the timestamp is what makes a folder listing read in order.
 */
export function coachDocPath(o: {
  coachId: string;
  filename: string;
  mime: string;
  millis: number;
  token: string;
}): string | null {
  const ext = extForMime(o.mime);
  if (!ext) return null;
  if (!isUuid(o.coachId)) return null;
  const token = (o.token || '').replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'x';
  return `${o.coachId}/${Math.trunc(o.millis)}-${token}-${slugify(o.filename)}.${ext}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string | null | undefined): boolean {
  return typeof v === 'string' && UUID.test(v);
}

/** Whether a key really is this coach's, in the shape the policies read. The
 *  same question `(storage.foldername(name))[1] = auth.uid()::text` asks, on
 *  this side of the wire. */
export function isCoachDocPath(path: string | null | undefined, coachId: string): boolean {
  if (typeof path !== 'string' || !isUuid(coachId)) return false;
  const parts = path.split('/');
  if (parts.length !== 2) return false;
  return parts[0].toLowerCase() === coachId.toLowerCase() && parts[1].length > 0;
}

/** The coach who owns a key, or null when the key is not one of ours. */
export function ownerOfPath(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null;
  const first = path.split('/')[0];
  return isUuid(first) ? first : null;
}

export type UploadRefusal = 'type' | 'size' | 'empty' | 'name';

/**
 * Whether this file may be uploaded at all, decided before any bytes move.
 *
 * A refusal is a reason, not a boolean, because each of the four gets a
 * different sentence and "that didn't work" is the one this repo keeps having
 * to replace.
 */
export function checkUpload(o: {
  filename: string | null | undefined;
  mime: string | null | undefined;
  bytes: number | null | undefined;
}): { ok: true } | { ok: false; reason: UploadRefusal } {
  if (!o.filename || !o.filename.trim()) return { ok: false, reason: 'name' };
  if (!extForMime(o.mime)) return { ok: false, reason: 'type' };
  const b = typeof o.bytes === 'number' && Number.isFinite(o.bytes) ? o.bytes : 0;
  if (b <= 0) return { ok: false, reason: 'empty' };
  if (b > MAX_DOC_BYTES) return { ok: false, reason: 'size' };
  return { ok: true };
}

export function uploadRefusalLine(reason: UploadRefusal): string {
  switch (reason) {
    case 'type':
      return 'That kind of file can’t be used as paperwork. A PDF, or a photograph of the page, is what a client can read and accept on their phone.';
    case 'size':
      return `That file is larger than ${sizeLabel(MAX_DOC_BYTES)}, which is the most this can hold. A scan saved at a lower quality usually gets well under it.`;
    case 'empty':
      return 'That file is empty, so there is nothing to ask anybody to accept.';
    case 'name':
      return 'That file has no name, so there is nothing to file it under.';
  }
}

/** "84 KB", "2.1 MB". Never a raw byte count on a screen. */
export function sizeLabel(bytes: number | null | undefined): string {
  const b = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── The documents themselves ─────────────────────────────────────────────── */

/** A row of `my_coach_documents()`, as PostgREST hands it over. */
export interface RawCoachDoc {
  id: string;
  coach_id: string;
  title: string;
  path: string;
  mime: string;
  bytes: number;
  required: boolean;
  retired: boolean;
  created_at: string;
  accepted_at: string | null;
}

export interface CoachDoc {
  id: string;
  coachId: string;
  title: string;
  path: string;
  mime: string;
  bytes: number;
  required: boolean;
  retired: boolean;
  createdAt: string;
  /** When this reader accepted it, or null. On the coach's own list this is
   *  always null — a coach does not accept their own paperwork. */
  acceptedAt: string | null;
}

export function shapeDocs(rows: RawCoachDoc[] | null | undefined): CoachDoc[] {
  if (!rows || !rows.length) return [];
  return rows
    .map((r) => ({
      id: String(r.id),
      coachId: String(r.coach_id),
      title: typeof r.title === 'string' ? r.title.trim() : '',
      path: String(r.path),
      mime: String(r.mime),
      bytes: typeof r.bytes === 'number' ? r.bytes : Number(r.bytes) || 0,
      required: !!r.required,
      retired: !!r.retired,
      createdAt: String(r.created_at),
      acceptedAt: r.accepted_at ? String(r.accepted_at) : null,
    }))
    // Outstanding paperwork first, then what is merely on file. Within each,
    // newest first, because the thing a coach just issued is the thing being
    // asked about.
    .sort((a, b) =>
      Number(outstanding(b)) - Number(outstanding(a))
      || Number(b.required) - Number(a.required)
      || b.createdAt.localeCompare(a.createdAt));
}

/** Required, still in circulation, and this reader has not accepted it. The one
 *  question the client portal asks. */
export function outstanding(d: CoachDoc): boolean {
  return d.required && !d.retired && d.acceptedAt == null;
}

/** How many pieces of paperwork are still waiting on this client.
 *
 *  The caller must gate this on a 'ready' read. Under 'error' the list is
 *  whatever survived a failure, and a zero counted from it is the "you have
 *  nothing outstanding" sentence said to somebody who has three. */
export function outstandingCount(docs: CoachDoc[]): number {
  return docs.filter(outstanding).length;
}

export type DocState = 'must-accept' | 'accepted' | 'optional' | 'withdrawn';

export function docState(d: CoachDoc): DocState {
  if (d.acceptedAt != null) return 'accepted';
  if (d.retired) return 'withdrawn';
  return d.required ? 'must-accept' : 'optional';
}

/** The line under a document's title, on the client's list. */
export function docLine(d: CoachDoc): string {
  switch (docState(d)) {
    case 'accepted':
      return `Accepted ${fmtDay(d.acceptedAt as string)}`;
    case 'must-accept':
      return 'Your coach asks you to read and accept this';
    case 'optional':
      return 'For you to read — no acceptance needed';
    case 'withdrawn':
      return 'Withdrawn by your coach';
  }
}

/**
 * What a client is told before they accept, and it has to be true afterwards.
 *
 * There is no un-accept, so it says there is no un-accept. An app that lets
 * somebody agree to a legal document under the impression they can take it back
 * has misrepresented the thing they were agreeing to.
 */
export const COACH_DOC_ACCEPT_RULE =
  'Accepting records the date against your name for your coach to see. It can’t be edited or withdrawn '
  + 'afterwards, by you or by them — that permanence is what makes it worth anything.';

/** The distinction that must never blur. */
export const COACH_DOC_NOT_REPPLE =
  'This is your coach’s own paperwork, not Repple’s. Repple doesn’t write it, check it, or advise on it, '
  + 'and the liability release you signed when you joined is a separate thing that your coach cannot read.';

/** What a coach is told about editing. */
export const COACH_DOC_IMMUTABLE_NOTE =
  'A document can’t be edited once it’s here, because people may already have accepted it. Changed the '
  + 'wording? Upload the new version and retire the old one — everyone who accepted the old one keeps that '
  + 'record, and can still read what they agreed to.';

/** Who can open the file. Said plainly, because a coach uploading a document is
 *  entitled to know who it reaches. */
export const COACH_DOC_REACH_NOTE =
  'Only you and the clients you currently coach can open these. Nobody else at the gym can, and a client '
  + 'who moves to another coach loses access to everything except what they accepted.';

/** "4 of 9 have accepted" — the coach's summary for one document.
 *
 *  Null when the roster could not be counted, rather than "0 of 0", which reads
 *  as a fact about a coach with clients. */
export function standingLine(accepted: number, roster: number): string | null {
  if (!Number.isFinite(accepted) || !Number.isFinite(roster) || roster <= 0) return null;
  if (accepted >= roster) return `All ${roster} of your clients have accepted this`;
  return `${accepted} of ${roster} of your clients have accepted this`;
}
