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
// ── THE ORDER: STORE, THEN READ ───────────────────────────────────────────
//
// The upload happens before the OCR call, and it is reported separately.
//
// A document that uploaded but could not be read is NOT a failure of the
// upload: the client has a copy of their report in the app, which is worth
// having on its own, and telling them "that did not work" would be false. So
// `readInjuryDocument` returns the path either way, and the screen offers to
// delete it if the read was useless to them.
//
// ── supabase-js RESOLVES ON AN ERROR ──────────────────────────────────────
// `await supabase.from(...)` / `.storage...` give back { data, error } instead
// of throwing, so a try/catch alone only catches the network dying. Every call
// below reads `.error`.
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/reportError';
import { extractFromDocument, type Extraction } from '../lib/injuryExtract';
import type { LoadStatus } from './loadStatus';

/** Private. Reads are signed, never getPublicUrl(). */
export const INJURY_DOC_BUCKET = 'injury-docs';

/** Long enough to look at the page you just uploaded and think about it. */
export const INJURY_DOC_TTL_S = 60 * 60;

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

export function injuryDocObjectPath(uid: string, atMs: number, token: string, slug: string): string {
  return `${uid}/${atMs}-${token}-${slug}.jpg`;
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
  read: 'ready' | 'error';
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

/**
 * Store a document and read it.
 *
 * Downscaled and re-encoded as JPEG first: it is what the bucket accepts, what
 * OCR.space is given, and it strips a HEIC the picker would otherwise hand us
 * under an image/jpeg content type that would then be a lie.
 */
export async function readInjuryDocument(
  input: { uri: string; name?: string | null },
): Promise<InjuryDocRead> {
  const fail = (error: string): InjuryDocRead =>
    ({ stored: 'error', path: null, read: 'error', extraction: null, error });

  const uid = await requireUid();
  if (!uid) return fail('Sign in to add a document.');

  let uri = input.uri;
  let b64 = '';
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

  // ── store ──────────────────────────────────────────────────────────────
  const path = injuryDocObjectPath(uid, Date.now(), newToken(), docSlug(input.name));
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
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (upErr) {
    reportError('injuryDocs.upload', upErr, { path });
    return fail('That document could not be saved, so nothing was read from it.');
  }

  // ── read ───────────────────────────────────────────────────────────────
  // Stored, and said so, whatever happens from here.
  const storedOnly = (error: string): InjuryDocRead =>
    ({ stored: 'ready', path, read: 'error', extraction: null, error });

  if (!b64) return storedOnly('Your document is saved, but there was no image data to read from it.');

  try {
    const { data, error } = await supabase.functions.invoke('ocr-scan', { body: { imageBase64: b64 } });
    if (error) {
      reportError('injuryDocs.ocr', error, { path });
      return storedOnly('Your document is saved. We could not reach the reader, so nothing has been read from it yet.');
    }
    if (!data?.ok) {
      // The function reports its own failure in the body — a missing key, an
      // image it could not parse. Pass its sentence through when it has one;
      // it is written for a person and says what to do.
      const detail = typeof data?.error === 'string' && data.error ? data.error : null;
      return storedOnly(detail ?? 'Your document is saved. The reader could not get any text out of it.');
    }
    return {
      stored: 'ready',
      path,
      read: 'ready',
      extraction: extractFromDocument(String(data.text ?? '')),
      error: null,
    };
  } catch (e) {
    reportError('injuryDocs.ocr', e, { path });
    return storedOnly('Your document is saved. We could not reach the reader, so nothing has been read from it yet.');
  }
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
    .list(uid, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { reportError('injuryDocs.list', error); return { status: 'error', docs: [] }; }

  // Supabase inserts a zero-byte placeholder for an empty folder; it is not a
  // document and must not be counted as one.
  const files = (data ?? []).filter((f) => f.name && f.name !== '.emptyFolderPlaceholder');
  if (!files.length) return { status: 'ready', docs: [] };

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
    status: 'ready',
    docs: files.map((f) => ({
      path: `${uid}/${f.name}`,
      name: f.name,
      createdAt: (f as { created_at?: string }).created_at ?? null,
      url: urlByPath.get(`${uid}/${f.name}`) ?? null,
    })),
  };
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
