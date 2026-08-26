// Progress photos — the persistence layer that app/(client)/scans.tsx was
// missing. Until now that screen kept photos in useState: no upload, no
// bucket, no row, gone at unmount. It said so out loud ("N on screen") because
// saying "saved" would have been a lie. This file is what makes "saved" true.
//
// STORAGE LAYOUT
//   bucket `photos` (PRIVATE) · object key `<auth.uid()>/<millis>-<token>.jpg`
//   row    `progress_photos`  · image_path holds that exact key
//
// The first path segment is the owner's uid because that is what the storage
// policies in supabase/parts/45-progress-photos.sql key on:
// `(storage.foldername(name))[1] = auth.uid()::text`, the same shape as the
// exercise-videos policies. Get the layout wrong and every upload is refused.
//
// The bucket is private, so a photo is read through a SIGNED URL minted by its
// owner — never getPublicUrl(), which returns a working-looking string for a
// private object that then 400s.
//
// ── THE TWO FAILURES THAT LOSE DATA, AND WHAT WE DO ABOUT THEM ────────────
//
// An upload and a row insert are two calls and cannot be one transaction.
//
//   Upload ok, insert fails  → a file nobody has the name of. `discardOrphan`
//     deletes it immediately; if that delete fails too it is handed to the
//     server queue (`queue_photo_file_purge`), which owns it from then on; if
//     BOTH fail the path is reported to app_errors so it is at least nameable.
//     Three chances, and the upload is still reported as failed to the caller.
//     We never say saved.
//
//   Delete: file first, then row. Not the other way round. A failed row delete
//     leaves a row pointing at a missing file — visible, retryable, and it
//     renders as a gap rather than a photo. A failed FILE delete after the row
//     is gone leaves a file nobody can name, which is the unrecoverable one.
//     If the file delete fails we hand the path to the server queue before
//     removing the row, and refuse the whole thing if even that fails.
//
// ── supabase-js RESOLVES ON A DATABASE ERROR ──────────────────────────────
// `await supabase.from(...)` gives back { data: null, error } instead of
// throwing, so a try/catch alone only ever catches the network dying. Every
// call below checks `.error` explicitly, storage calls included.
//
// ── WHY THE CLIENT IS REQUIRED LAZILY ─────────────────────────────────────
// The pure half of this file (paths, ordering, labels, the compare pair) is
// covered by src/lib/coverage.test.ts, which runs under plain `node`. A
// top-level `import { supabase }` would drag in AsyncStorage, which throws
// "window is not defined" the moment the auth client touches storage — the
// test process would die on an import, not on a bad assertion. `import type`
// is erased, and the require() below only runs inside an I/O call, which the
// tests never make.

/** The private bucket. Not public — reads are signed, never getPublicUrl(). */
export const PHOTO_BUCKET = 'photos';

/** How long a minted URL stays good. Long enough to scroll a progress view. */
export const SIGNED_URL_TTL_S = 60 * 60;

/**
 * The object-key shape, mirrored from the guard in 45-progress-photos.sql. The
 * server refuses to send a purge for a path that does not match this, because
 * the path goes into a URL unescaped; keeping the two in step is the point.
 */
export const PHOTO_PATH_RE = /^[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]{1,120}$/;

/** A row of `progress_photos`, exactly as the database spells it. */
export interface ProgressPhotoRow {
  id: string;
  client_id: string;
  taken_at: string;
  image_path: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
}

/** A photo as a screen wants it. `url === null` means the file could not be
 *  signed — the row is there, the image is not. It must render as a gap, never
 *  as a photo and never as nothing. */
export interface ProgressPhoto {
  id: string;
  path: string;
  takenAt: string;
  url: string | null;
  weightKg: number | null;
  bodyFatPct: number | null;
}

/* ── pure ─────────────────────────────────────────────────────────────────
   No I/O, no client, no React. Everything here is covered in coverage.test.ts. */

/** The object key for a new photo. `uid` first because the storage policies
 *  read that segment and nothing else. */
export function photoObjectPath(uid: string, atMs: number, token: string): string {
  return `${uid}/${atMs}-${token}.jpg`;
}

/** Does this key sit in this person's own folder? The same test the storage
 *  policies and `queue_photo_file_purge` apply, so a mismatch fails here — in
 *  a place with a readable message — rather than as a bare 403. */
export function isOwnPhotoPath(path: string, uid: string): boolean {
  if (!PHOTO_PATH_RE.test(path)) return false;
  return path.slice(0, path.indexOf('/')) === uid;
}

/** Oldest first. A progress view reads left to right as time, and the report
 *  built from it has to start at the beginning. */
export function sortOldestFirst(photos: ProgressPhoto[]): ProgressPhoto[] {
  return [...photos].sort((a, b) => {
    const d = Date.parse(a.takenAt) - Date.parse(b.takenAt);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

export function rowToPhoto(row: ProgressPhotoRow, url: string | null): ProgressPhoto {
  return {
    id: row.id,
    path: row.image_path,
    takenAt: row.taken_at,
    url,
    weightKg: row.weight_kg ?? null,
    bodyFatPct: row.body_fat_pct ?? null,
  };
}

/** Whole days between two photos, however they are ordered. */
export function daysApart(aISO: string, bISO: string): number | null {
  const a = Date.parse(aISO), b = Date.parse(bISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(Math.round((b - a) / 86400000));
}

/**
 * The before/after pair for two selected photos, ordered by when they were
 * taken rather than by the order they were tapped in.
 */
export function comparePair(
  photos: ProgressPhoto[],
  ids: string[],
): { before: ProgressPhoto; after: ProgressPhoto; days: number | null } | null {
  if (ids.length !== 2) return null;
  const a = photos.find((p) => p.id === ids[0]);
  const b = photos.find((p) => p.id === ids[1]);
  if (!a || !b || a.id === b.id) return null;
  const aFirst = Date.parse(a.takenAt) <= Date.parse(b.takenAt);
  const before = aFirst ? a : b;
  const after = aFirst ? b : a;
  return { before, after, days: daysApart(before.takenAt, after.takenAt) };
}

/**
 * The header note. This is the label that used to read "N on screen" because
 * nothing was stored; it can say "saved" now, and only now.
 *
 * `null` for not-loaded-yet AND for loaded-and-empty, because in both of those
 * the BODY of the section carries the difference — a note reading "0 saved"
 * over a "loading" body would be the two states rendering the same.
 */
export function photosNote(photos: ProgressPhoto[] | null): string | null {
  if (photos === null || photos.length === 0) return null;
  return `${photos.length} saved`;
}

/** How many of the loaded photos have no image behind them. Never invented:
 *  `null` when nothing is loaded yet. */
export function missingFileCount(photos: ProgressPhoto[] | null): number | null {
  if (photos === null) return null;
  return photos.filter((p) => p.url === null).length;
}

/* ── I/O ──────────────────────────────────────────────────────────────────── */

type Sb = typeof import('./supabase').supabase;

/** See the header: required, not imported, so the pure half stays testable. */
function db(): Sb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require('./supabase') as { supabase: Sb }).supabase;
}

function report(context: string, err: unknown, extra?: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('./reportError') as {
      reportError: (c: string, e: unknown, x?: Record<string, unknown>) => void;
    };
    m.reportError(context, err, extra);
  } catch {
    /* reporting a failure must never itself fail */
  }
}

async function requireUid(sb: Sb): Promise<string> {
  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  const uid = data?.user?.id;
  if (!uid) throw new Error('Sign in to save progress photos.');
  return uid;
}

function newToken(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

/**
 * A person's photos, oldest first, each with a signed URL.
 *
 * Signing is per-object and a single failure does NOT sink the list: that
 * photo comes back with `url: null` so the screen can show the gap. A row
 * whose file is missing is the recoverable half of a half-finished delete, and
 * hiding it would hide the thing that needs fixing.
 */
export async function listProgressPhotos(): Promise<ProgressPhoto[]> {
  const sb = db();
  const uid = await requireUid(sb);

  const { data, error } = await sb
    .from('progress_photos')
    .select('id, client_id, taken_at, image_path, weight_kg, body_fat_pct')
    .eq('client_id', uid)
    .order('taken_at', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as ProgressPhotoRow[];
  if (rows.length === 0) return [];

  const { data: signed, error: signErr } = await sb.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(rows.map((r) => r.image_path), SIGNED_URL_TTL_S);
  if (signErr) throw signErr;

  const urlByPath = new Map<string, string>();
  for (const s of signed ?? []) {
    if (!s.error && s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  return sortOldestFirst(rows.map((r) => rowToPhoto(r, urlByPath.get(r.image_path) ?? null)));
}

/**
 * Upload the file, then write the row. If the row fails, the file is an orphan
 * and this is where it gets dealt with — see the header. The caller is told the
 * upload failed either way; nothing here reports a half-save as a save.
 */
export async function uploadProgressPhoto(
  uri: string,
  opts?: { takenAt?: string; weightKg?: number | null; bodyFatPct?: number | null },
): Promise<ProgressPhoto> {
  const sb = db();
  const uid = await requireUid(sb);
  const path = photoObjectPath(uid, Date.now(), newToken());

  const res = await fetch(uri);
  if (!res.ok) throw new Error('Could not read that photo from your device.');
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error('That photo came back empty.');

  const { error: upErr } = await sb.storage
    .from(PHOTO_BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (upErr) throw upErr;

  const { data: row, error: insErr } = await sb
    .from('progress_photos')
    .insert({
      client_id: uid,
      taken_at: opts?.takenAt ?? new Date().toISOString(),
      image_path: path,
      weight_kg: opts?.weightKg ?? null,
      body_fat_pct: opts?.bodyFatPct ?? null,
    })
    .select('id, client_id, taken_at, image_path, weight_kg, body_fat_pct')
    .single();

  if (insErr || !row) {
    await discardOrphan(sb, path, insErr);
    throw insErr ?? new Error('The photo uploaded but could not be saved.');
  }

  const { data: signed, error: signErr } = await sb.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_S);
  // The photo IS saved at this point. A URL we could not mint is a display
  // problem, not a save problem, so it is reported and the photo returned with
  // url: null rather than thrown away.
  if (signErr) report('progressPhotos.sign', signErr, { path });

  return rowToPhoto(row as ProgressPhotoRow, signErr ? null : signed?.signedUrl ?? null);
}

/**
 * A file with no row. Delete it now; failing that, hand it to the server queue
 * so it dies with the account even if this device never comes back; failing
 * that, at least put the path somewhere a human can read it.
 */
async function discardOrphan(sb: Sb, path: string, cause: unknown): Promise<void> {
  try {
    const { error: rmErr } = await sb.storage.from(PHOTO_BUCKET).remove([path]);
    if (!rmErr) return;

    const { error: qErr } = await sb.rpc('queue_photo_file_purge', { p_path: path });
    if (!qErr) return;

    report('progressPhotos.orphan', qErr, { path, removeError: String(rmErr.message), cause: String(cause) });
  } catch (e) {
    report('progressPhotos.orphan', e, { path, cause: String(cause) });
  }
}

/**
 * Delete one photo: the FILE first, then the row. Both, or the caller is told
 * it did not happen.
 *
 * Order matters and is not arbitrary — see the header. If the file will not go,
 * the path is handed to the server purge queue before the row is removed, so
 * the bytes are still accounted for; if even that fails we refuse and leave
 * the photo alone rather than orphan it.
 *
 * The AFTER DELETE trigger on `progress_photos` queues the path server-side
 * regardless, so a file this device thought it deleted is checked again by
 * something holding a service credential. That is deliberate belt and braces:
 * the app is not the party we let make the "it is gone" claim.
 */
export async function deleteProgressPhoto(photo: { id: string; path: string }): Promise<void> {
  const sb = db();

  const { error: rmErr } = await sb.storage.from(PHOTO_BUCKET).remove([photo.path]);
  if (rmErr) {
    const { error: qErr } = await sb.rpc('queue_photo_file_purge', { p_path: photo.path });
    if (qErr) {
      report('progressPhotos.delete', rmErr, { path: photo.path, queueError: String(qErr.message) });
      throw rmErr;
    }
  }

  const { error: delErr } = await sb.from('progress_photos').delete().eq('id', photo.id);
  if (delErr) throw delErr;
}
