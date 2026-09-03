// A client's injury document — the storage half of "read my physio report".
//
// The client photographs a physiotherapy report, a scan result or a doctor's
// note. This file puts that image in a PRIVATE bucket only they can read, sends
// it through the `ocr-scan` edge function, and hands the text to
// src/lib/injuryExtract.ts, which proposes candidate injuries. Nothing here
// writes an injury. The confirmation screen does that, after a person has read
// each proposal — see app/(client)/injury-doc.tsx.
//
// ── WHAT THE COACH SEES, WHICH IS NOT THIS ────────────────────────────────
//
// The coach sees the injuries the client confirms, in `clients.injuries`, like
// every other disclosure. They never see the document. That is enforced in
// supabase/parts/91-injury-documents.sql — own-folder policies on every verb,
// with no trainer branch — and there is deliberately no database row here for
// anything else to join to. A client may choose to share a report with their
// coach one day; that is a grant they make per document, not something that is
// already true because of who coaches them.
//
// ── STORAGE LAYOUT ────────────────────────────────────────────────────────
//   bucket `injury-docs` (PRIVATE)
//   key    `<auth.uid()>/<millis>-<token>-<slug>.jpg`
//
// The first path segment is the owner's uid because that is the only thing the
// storage policies read. The pattern, the private bucket and the signed-URL
// read are all lifted from src/lib/progressPhotos.ts, which argues them at
// length; the one difference is that there is no row and therefore no
// half-written-record problem to solve. An upload that fails is a file that
// does not exist, and there is nothing left dangling behind it.
//
// ── THE DOCUMENT LEAVES THE ACCOUNT, AND THAT IS ASKED ABOUT ──────────────
//
// Reading a document means SENDING it. `ocr-scan` POSTs the whole page, base64,
// to https://api.ocr.space/parse/image. For most of this file's life that
// happened unconditionally, with no consent question anywhere on the path,
// under a screen that promised the member "the document stays in your account
// and only you can open it". The argument, the wording and the four states the
// screen may now describe a document in are in src/lib/injuryDocConsent.ts.
//
// The shape of the fix HERE is the required parameter. `readInjuryDocument`
// takes an `OcrAnswer` with no default, and `OcrAnswer` has no 'unasked'
// member, so a call site that has not asked does not compile. Everything else
// about a consent — a flag, a setting, a comment — can be forgotten by the next
// person; a required argument of a two-member union cannot.
//
// ── THE ORDER: STORE, RECORD, THEN READ ───────────────────────────────────
//
// The upload happens before the OCR call, and it is reported separately.
//
// A document that uploaded but could not be read is NOT a failure of the
// upload: the client has a copy of their report in the app, which is worth
// having on its own, and telling them "that did not work" would be false. So
// `readInjuryDocument` returns the path either way, and the screen offers to
// delete it if the read was useless to them.
//
// Between those two sits the consent row, and the send WAITS FOR IT. If the row
// does not land, nothing is posted to the vendor — the document is stored, the
// member is told exactly that, and the manual route is offered. The alternative
// is a state where the bytes have gone and the agreement is not on file, which
// is the app being able to say somebody consented while unable to show it. That
// is the shape this codebase refuses; see the long argument under decision 4 in
// src/lib/injuryDocConsent.ts and the table in supabase/parts/1000-*.sql.
//
// A refusal is written too, and if THAT write fails nothing is sent either —
// the refusal is honoured by not acting, not by the row. The document then
// carries no record, which reads as "no record either way" and not as "never
// sent", because those are different facts and one of them is a claim.
//
// ── supabase-js RESOLVES ON AN ERROR ──────────────────────────────────────
// `await supabase.from(...)` / `.storage...` give back { data, error } instead
// of throwing, so a try/catch alone only catches the network dying. Every call
// below reads `.error`.
import * as ImageManipulator from 'expo-image-manipulator';
import { readFileBase64, FILE_READ_UNAVAILABLE_NOTE } from './nativeModules';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/reportError';
import { extractFromDocument, type Extraction } from '../lib/injuryExtract';
import {
  maySendToOcr, OCR_ENDPOINT, OCR_VENDOR, RECORD_FAILED_NOTE,
  type OcrAnswer,
} from '../lib/injuryDocConsent';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';

/** Private. Reads are signed, never getPublicUrl(). */
export const INJURY_DOC_BUCKET = 'injury-docs';

/** Long enough to look at the page you just uploaded and think about it.
 *
 *  It is also long enough to RUN OUT while the screen is open, which is what
 *  people do with a document viewer. The list is signed once when it is read,
 *  so a member who left this screen an hour ago and then tapped a report used
 *  to get a black rectangle with their own filename over it and no sentence
 *  anywhere — which reads as the app having lost their medical records. Every
 *  open now re-signs first; see `signInjuryDoc`. */
export const INJURY_DOC_TTL_S = 60 * 60;

/**
 * How many documents the list reads.
 *
 * A hundred, as before. What changed is that it asks for one more than that
 * and uses it as a probe, so a member with more than a hundred is told rather
 * than quietly shown the newest hundred under a confident count. Somebody with
 * a long clinical history is exactly the person whose oldest report is the one
 * they go looking for. See src/lib/rowCap.ts.
 */
export const INJURY_DOC_LIST_CAP = 100;

/** The key shape, mirrored from the policies in 91-injury-documents.sql. */
export const INJURY_DOC_PATH_RE = /^[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]{1,120}$/;

/** Wide enough to read small print off a photographed sheet of A4, small
 *  enough to stay under the edge function's base64 cap. Same width the body
 *  scan reader uses, for the same reason. */
const READ_WIDTH = 1512;

/* ── pure ─────────────────────────────────────────────────────────────────── */

/** A filename fragment that cannot change what object a path addresses.
 *  Everything outside [a-z0-9-] goes, because this ends up in a URL. */
export function docSlug(name?: string | null): string {
  const s = String(name ?? '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'document';
}

export function injuryDocObjectPath(uid: string, atMs: number, token: string, slug: string, ext = 'jpg'): string {
  // The extension is part of what the client gets back when they open their own
  // report later: a PDF stored under .jpg is a file their phone refuses to
  // render. Defaulted so every existing caller keeps the behaviour it had.
  const safe = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'jpg';
  return `${uid}/${atMs}-${token}-${slug}.${safe}`;
}

/** The same test the storage policies apply, asked here so a mismatch fails
 *  somewhere with a readable message rather than as a bare 403. */
export function isOwnInjuryDocPath(path: string, uid: string): boolean {
  if (!INJURY_DOC_PATH_RE.test(path)) return false;
  return path.slice(0, path.indexOf('/')) === uid;
}

/** A document as the screen lists it. `url === null` means the file is there
 *  and could not be signed — it renders as a gap, never as absent. */
export interface InjuryDocFile {
  path: string;
  name: string;
  createdAt: string | null;
  url: string | null;
}

/**
 * The result of uploading and reading one document.
 *
 * `stored` and `read` are separate because they fail separately and mean
 * different things to the client. `extraction` is null whenever `read` is not
 * 'ready' — an empty candidate list under a failed read would say "your report
 * mentions no injuries", which is the one sentence we must not produce from a
 * failure. See the ExtractOutcome comment in src/lib/injuryExtract.ts.
 */
export interface InjuryDocRead {
  stored: 'ready' | 'error';
  path: string | null;
  /** The answer this call was made under, echoed back. The screen words the
   *  outcome from what the member DECIDED, not from what happened afterwards:
   *  "nothing was sent" is a different sentence when it is the member's choice
   *  than when it is a failure, and they must not be shown each other's. */
  consent: OcrAnswer;
  /** Whether that answer reached the server. False with `consent: 'granted'`
   *  is the one case where the member agreed and the document still did not go
   *  — see the ordering argument in the header. */
  recorded: boolean;
  /** Whether the bytes were actually posted to the vendor. The only field that
   *  says what left, and the one an audit would read. */
  sent: boolean;
  read: 'ready' | 'error' | 'not-asked';
  extraction: Extraction | null;
  /** Something to show the client. Never a raw vendor string. */
  error: string | null;
}

/* ── I/O ──────────────────────────────────────────────────────────────────── */

function newToken(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

async function requireUid(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) { reportError('injuryDocs.uid', error); return null; }
  return data?.user?.id ?? null;
}

/** The table in supabase/parts/1000-*.sql. Insert-and-select only, own rows
 *  only, no update or delete policy anywhere. */
export const INJURY_DOC_CONSENT_TABLE = 'injury_doc_ocr_consents';

/**
 * Write down what the member answered about ONE document.
 *
 * Returns whether the row actually landed, and the caller acts on that rather
 * than on the absence of an error: PostgREST does not error when a policy
 * filters a row out of the returned set, so a write that inserted nothing comes
 * back looking exactly like a write that inserted something. `injuryAcks.tsx`
 * counts the returned row for the same reason and says so at length; this is
 * the same trap on a table where the consequence is a medical document.
 *
 * A duplicate is a success. The unique key is (client_id, object_path) and a
 * path carries its own millisecond and random token, so the only way to hit it
 * is to write the same decision about the same document twice — a retry. The
 * row that is already there says what this one would have said.
 */
async function recordInjuryDocConsent(
  uid: string, path: string, answer: OcrAnswer,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from(INJURY_DOC_CONSENT_TABLE)
      .insert({
        client_id: uid,
        object_path: path,
        decision: answer,
        vendor: OCR_VENDOR,
        endpoint: OCR_ENDPOINT,
        decided_at: new Date().toISOString(),
      })
      .select('id');
    if (error) {
      // 23505 is the unique key: the decision is already on file, which is what
      // this call was for. Anything else is a consent we cannot show.
      if ((error as { code?: string }).code === '23505') return true;
      reportError('injuryDocs.consent.write', error, { path });
      return false;
    }
    if (!data || !data.length) {
      reportError('injuryDocs.consent.write', new Error('consent insert returned no row'), { path });
      return false;
    }
    return true;
  } catch (e) {
    reportError('injuryDocs.consent.write', e, { path });
    return false;
  }
}

/**
 * Store a document and, if the member said so, read it.
 *
 * Downscaled and re-encoded as JPEG first: it is what the bucket accepts, what
 * OCR.space is given, and it strips a HEIC the picker would otherwise hand us
 * under an image/jpeg content type that would then be a lie.
 *
 * `consent` is required and has no default. It is the member's answer to the
 * question in src/lib/injuryDocConsent.ts, asked against THIS document, before
 * this call. 'refused' still stores the file — that is the member keeping a
 * private copy, which is the thing the screen has always promised and which is
 * true on this branch — and posts nothing anywhere.
 */
export async function readInjuryDocument(
  input: { uri: string; name?: string | null; mimeType?: string | null },
  consent: OcrAnswer,
): Promise<InjuryDocRead> {
  const fail = (error: string): InjuryDocRead =>
    ({ stored: 'error', path: null, consent, recorded: false, sent: false, read: 'error', extraction: null, error });

  const uid = await requireUid();
  if (!uid) return fail('Sign in to add a document.');

  // A report is far more often a PDF somebody was emailed than a photograph of
  // one, so both come through here. They are prepared differently and cannot
  // share a path: ImageManipulator decodes images, and handing it a PDF fails.
  const pdf = String(input.mimeType || '').toLowerCase() === 'application/pdf'
    || /\.pdf$/i.test(input.name || '');
  const contentType = pdf ? 'application/pdf' : 'image/jpeg';

  let uri = input.uri;
  let b64 = '';
  if (pdf) {
    // Sent whole. There is no downscaling a PDF, so an over-large one is
    // refused by the reader with a sentence saying to photograph the page
    // instead — which is a better outcome than quietly reading half of it.
    try {
      // readFileBase64, not a direct expo-file-system call: the module throws
      // when imported on a binary that predates it, and this file is reached by
      // app/(client)/injury-doc.tsx, so the throw would be the screen rather
      // than the upload. Null is "this build cannot read files at all", which
      // is a different sentence from a read that failed — choosing another file
      // does not help.
      const read = await readFileBase64(input.uri);
      if (read == null) return fail(FILE_READ_UNAVAILABLE_NOTE);
      b64 = read;
    } catch (e) {
      reportError('injuryDocs.prepare-pdf', e);
      return fail('That document could not be opened. Try another file, or photograph the page.');
    }
  } else {
    try {
      const out = await ImageManipulator.manipulateAsync(
        input.uri,
        [{ resize: { width: READ_WIDTH } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      uri = out.uri;
      b64 = out.base64 ?? '';
    } catch (e) {
      reportError('injuryDocs.prepare', e);
      return fail('That image could not be prepared for reading. Try another photo.');
    }
  }

  // ── store ──────────────────────────────────────────────────────────────
  const path = injuryDocObjectPath(uid, Date.now(), newToken(), docSlug(input.name), pdf ? 'pdf' : 'jpg');
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(uri);
    if (!res.ok) return fail('Could not read that file from your device.');
    bytes = await res.arrayBuffer();
  } catch (e) {
    reportError('injuryDocs.read-file', e);
    return fail('Could not read that file from your device.');
  }
  if (bytes.byteLength === 0) return fail('That file came back empty.');

  const { error: upErr } = await supabase.storage
    .from(INJURY_DOC_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (upErr) {
    reportError('injuryDocs.upload', upErr, { path });
    return fail('That document could not be saved, so nothing was read from it.');
  }

  // ── record the answer ──────────────────────────────────────────────────
  // Stored, and said so, whatever happens from here.
  const storedOnly = (error: string, recorded: boolean, sent = false): InjuryDocRead =>
    ({ stored: 'ready', path, consent, recorded, sent, read: 'error', extraction: null, error });

  const recorded = await recordInjuryDocConsent(uid, path, consent);

  // The member said no. Nothing is posted, and the outcome is not an error:
  // `read: 'not-asked'` is its own state precisely so the screen cannot render
  // this as a failure. Their document is in their account and went nowhere,
  // which is what they chose.
  if (!maySendToOcr(consent)) {
    // `error: null`, deliberately. This is not a failure and a sentence in the
    // error slot is how it would end up rendered as one; the screen words this
    // outcome from `REFUSED_TITLE` / `REFUSED_NOTE` in the consent module.
    return { stored: 'ready', path, consent, recorded, sent: false, read: 'not-asked', extraction: null, error: null };
  }

  // They said yes and we could not write it down. The document is NOT sent —
  // the ordering in the header is the whole point, and this is the branch it
  // exists for. An agreement the app cannot produce afterwards is not one it
  // may act on.
  if (!recorded) return storedOnly(RECORD_FAILED_NOTE, false);

  if (!b64) return storedOnly('Your document is saved, but there was nothing in it to read.', recorded);

  try {
    // The reader defaults to JPEG when nothing is said, which is every other
    // caller, so saying it here is what makes a PDF read as a PDF rather than
    // as a corrupt image.
    const { data, error } = await supabase.functions.invoke('ocr-scan', { body: { imageBase64: b64, mime: contentType } });
    // `sent: true` from here down, on every branch including the failures. The
    // request was made and the bytes left this device; whether the vendor could
    // read them is a different question from whether they had them, and the
    // member is entitled to the first answer rather than the second.
    if (error) {
      reportError('injuryDocs.ocr', error, { path });
      return storedOnly('Your document is saved. We could not reach the reader, so nothing has been read from it yet.', recorded, true);
    }
    if (!data?.ok) {
      // The function reports its own failure in the body — a missing key, an
      // image it could not parse. Pass its sentence through when it has one;
      // it is written for a person and says what to do.
      const detail = typeof data?.error === 'string' && data.error ? data.error : null;
      return storedOnly(detail ?? 'Your document is saved. The reader could not get any text out of it.', recorded, true);
    }
    return {
      stored: 'ready',
      path,
      consent,
      recorded,
      sent: true,
      read: 'ready',
      extraction: extractFromDocument(String(data.text ?? '')),
      error: null,
    };
  } catch (e) {
    reportError('injuryDocs.ocr', e, { path });
    // A throw here is the invoke itself failing — a dead network, a DNS
    // failure. It is not knowable from this side whether anything reached the
    // wire, so `sent` stays true: over-reporting a send is the safe direction
    // when the alternative is telling somebody their record never left.
    return storedOnly('Your document is saved. We could not reach the reader, so nothing has been read from it yet.', recorded, true);
  }
}

/**
 * What this member answered about each of their own documents.
 *
 * Keyed by object path, which is what `listInjuryDocs` returns, so the screen
 * can put a sentence under each document saying where it has been.
 *
 * The status matters more here than on most reads. An empty map means "this
 * member has answered nothing we can find", and for a document that predates
 * the consent question that is TRUE and important — it was sent unasked, and
 * the app must say it has no record rather than invent one in either direction.
 * A FAILED read means we could not look, which is a third thing again. Both are
 * handled by `docSendState` in src/lib/injuryDocConsent.ts, which takes this
 * status as its first argument for exactly that reason.
 */
export async function listInjuryDocConsents(): Promise<{ status: LoadStatus; byPath: Record<string, OcrAnswer> }> {
  const uid = await requireUid();
  if (!uid) return { status: 'error', byPath: {} };

  const { data, error } = await supabase
    .from(INJURY_DOC_CONSENT_TABLE)
    .select('object_path, decision')
    .eq('client_id', uid)
    .order('decided_at', { ascending: false })
    .limit(capLimit());
  if (error) { reportError('injuryDocs.consent.read', error); return { status: 'error', byPath: {} }; }

  // A truncated page cannot tell you a row is absent, only that it was not on
  // this page. 'partial' carries that to `docSendState`, which then answers
  // 'unknown' for any document it did not see a row for.
  const rows = capped(data ?? []);
  const byPath: Record<string, OcrAnswer> = {};
  for (const r of rows.rows as { object_path?: unknown; decision?: unknown }[]) {
    const p = typeof r.object_path === 'string' ? r.object_path : '';
    const d = r.decision;
    if (p && (d === 'granted' || d === 'refused')) byPath[p] = d;
  }
  return { status: rows.truncated ? 'partial' : 'ready', byPath };
}

/**
 * This person's own documents, newest first, each with a signed URL.
 *
 * 'error' with an empty list means we could not find out, NOT that there are
 * none — the screen has to be able to tell those apart before it says
 * "nothing here". A single failed signature does not sink the list: that
 * document comes back with `url: null` and renders as a gap.
 */
export async function listInjuryDocs(): Promise<{ status: LoadStatus; docs: InjuryDocFile[] }> {
  const uid = await requireUid();
  if (!uid) return { status: 'error', docs: [] };

  const { data, error } = await supabase.storage
    .from(INJURY_DOC_BUCKET)
    .list(uid, { limit: capLimit(INJURY_DOC_LIST_CAP), sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { reportError('injuryDocs.list', error); return { status: 'error', docs: [] }; }

  // Capped BEFORE the placeholder is filtered out, and that order matters: the
  // probe row is what says the set was bigger, and dropping a placeholder out
  // of a full page first would turn 101 rows into 100 and hide it.
  const page = capped(data ?? [], INJURY_DOC_LIST_CAP);
  const whole: LoadStatus = page.truncated ? 'partial' : 'ready';

  // Supabase inserts a zero-byte placeholder for an empty folder; it is not a
  // document and must not be counted as one.
  const files = page.rows.filter((f) => f.name && f.name !== '.emptyFolderPlaceholder');
  if (!files.length) return { status: whole, docs: [] };

  const paths = files.map((f) => `${uid}/${f.name}`);
  const { data: signed, error: signErr } = await supabase.storage
    .from(INJURY_DOC_BUCKET)
    .createSignedUrls(paths, INJURY_DOC_TTL_S);
  if (signErr) reportError('injuryDocs.sign', signErr);

  const urlByPath = new Map<string, string>();
  for (const s of signed ?? []) {
    if (!s.error && s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  return {
    status: whole,
    docs: files.map((f) => ({
      path: `${uid}/${f.name}`,
      name: f.name,
      createdAt: (f as { created_at?: string }).created_at ?? null,
      url: urlByPath.get(`${uid}/${f.name}`) ?? null,
    })),
  };
}

/**
 * A fresh signed URL for one document the member owns.
 *
 * The list signs every document once, when it is read, and those links last
 * `INJURY_DOC_TTL_S`. A viewer is a screen people leave open, so the link a
 * member taps is routinely older than the link they were handed — and an
 * expired one renders as a blank rectangle rather than as an error, which is
 * the worst possible way to be told anything about a medical record.
 *
 * Null means we could not sign it now, which is not the same as the document
 * being gone: the path is still there and the caller says so in those words.
 */
export async function signInjuryDoc(path: string): Promise<string | null> {
  const uid = await requireUid();
  // The same ownership check `deleteInjuryDoc` makes. A signature is a grant,
  // and this one is never minted for a path outside the member's own folder.
  if (!uid || !isOwnInjuryDocPath(path, uid)) return null;

  const { data, error } = await supabase.storage
    .from(INJURY_DOC_BUCKET)
    .createSignedUrl(path, INJURY_DOC_TTL_S);
  if (error || !data?.signedUrl) {
    reportError('injuryDocs.sign.one', error ?? new Error('no signed url'), { path });
    return null;
  }
  return data.signedUrl;
}

/**
 * Delete one document. Returns whether it actually went — the caller must not
 * tell anybody their medical record is gone on the strength of having asked.
 *
 * A DELETE through the Storage API is the only thing that removes the bytes;
 * see the account of `protect_objects_delete` in 45-progress-photos.sql.
 */
export async function deleteInjuryDoc(path: string): Promise<boolean> {
  const uid = await requireUid();
  if (!uid || !isOwnInjuryDocPath(path, uid)) return false;

  const { error } = await supabase.storage.from(INJURY_DOC_BUCKET).remove([path]);
  if (error) { reportError('injuryDocs.delete', error, { path }); return false; }
  return true;
}
