// GDPR — data access (export) + right-to-erasure (deletion request). The export
// pulls the signed-in user's own rows (RLS scopes each table to them) into a JSON
// bundle. Deletion flags the profile; an operator/edge-function purges the auth
// user. Both are best-effort and OTA-safe.
//
// The flag is also readable and reversible: web/delete-account.html promises a
// request can be withdrawn until it is actioned, so this file exposes the read
// (fetchDeletionRequestedAt) and the undo (withdrawAccountDeletion) alongside
// the request. The read is the one call here that throws instead of swallowing
// — a screen that cannot tell "no request" from "could not check" would show
// somebody awaiting erasure the ordinary state.
//
// ── Whose name is on a member's own data ──────────────────────────────────
//
// Everything a person can read out of this file used to say "Repple": the
// `app` field at the top of the bundle, the note when there is no server, the
// address to write to when the export came back short. For a member of a
// white-labelled chain that is their gym's SUPPLIER's name, written onto a copy
// of their own training records, in a file they keep after they have deleted
// the account. It is also the only place some of them would ever learn there is
// a supplier.
//
// So all three now come from `src/lib/brands.ts`, which is the same table
// app.config.ts builds the native identity from — one place, no drift. For any
// build that exists today `EXPO_PUBLIC_BRAND` is unset, `BRAND` resolves to
// Repple, and every string below is byte-identical to what it was.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';
import { BRAND } from './brands';

/**
 * What the export is called on the member's phone.
 *
 * Here rather than at the share call, because the file NAME is part of the same
 * promise the file CONTENTS make: a member of Example Fitness saving
 * `repple-my-data.json` has been handed a file named after a company they do
 * not deal with, and it is the name they will search for in two years. Derived
 * from `BRAND.id`, which is a lowercase registry key and is therefore already a
 * safe filename on every platform — resolving to exactly `repple-my-data.json`
 * for every build that exists today.
 */
export const MY_DATA_FILENAME = `${BRAND.id}-my-data.json`;

/**
 * Every table the signed-in person can read their own rows out of.
 *
 * ── What was missing, and why it mattered ────────────────────────────────
 *
 * This list held fourteen tables and none of them was money, a booking, or a
 * file. Absent: what the gym charged and what was paid, the memberships behind
 * it, every session pack and subscription bought, promo redemptions, the
 * waitlists joined, late-cancellation charges, the visits and the register, the
 * coach documents accepted, the signed waiver, the sessions themselves, and the
 * answers given about them.
 *
 * A subject access request is for everything held about the person. An export
 * that returns their training log and silently omits every payment is not a
 * short answer, it is a wrong one — and web/delete-account.html tells people to
 * take a copy FIRST, so it is the last record they will ever have.
 *
 * ── The rule for adding to this list ─────────────────────────────────────
 *
 * A table goes in ONLY IF a member can read their own rows out of it under
 * RLS. Every one below was checked against the part that grants it, named
 * beside it. A table nobody can read would come back refused on every export
 * and mark every export incomplete, which trains people to ignore the warning
 * that says the file is short.
 *
 * And nothing here may return another person's rows. `sessions` is the one
 * worth stating: `sessions_client_read` (part 22) narrowed it to the member's
 * OWN sessions plus their coach's OPEN slots, and an open slot carries no
 * client_id. That was already the fix for one client reading another's
 * bookings, and it is why this table is safe to export.
 */
const TABLES = [
  // Who they are, and what they have logged.
  'profiles', 'clients', 'workouts', 'food_logs', 'measurements', 'check_ins',
  'habit_logs', 'scans', 'messages', 'coach_nutrition', 'assigned_programs',
  'referrals', 'feedback',
  // The photographs themselves are files and are listed under `files` below;
  // this is the record of them.               (part 45)
  'progress_photos',
  // Bookings, and everything that decided one.
  'class_bookings',                          // part 02  · class_bookings_self
  'sessions',                                // part 22  · sessions_client_read
  'session_approvals',                       // part 22  · session_approvals_read
  'session_waitlist',                        // part 126 · session_waitlist_client_r
  'gym_visits',                              // part 32  · gym_visits_own_r
  // Money. The half this export had none of.
  'gym_payments',                            // part 125 · gym_payments_own_r
  'gym_invoices',                            // part 125 · gym_invoices_own_r
  'memberships',                             // part 125 · memberships_own_r
  'charges',                                 // part 142 · charges_client_r
  'client_purchases',                        // part 21  · cp_self
  'client_subscriptions',                    // part 97  · client_subs_read
  'client_subscription_payments',            // part 132 · client_sub_pay_read
  'promo_redemptions',                       // part 104 · promo_red_member_read
  // Paperwork they signed or accepted.
  'liability_waivers',                       // part 84  · liability_waivers_own_r
  'coach_document_acceptances',              // part 135 · coach_doc_accept_own_r
];

/**
 * Everything this account holds, as JSON — and an honest statement of whether
 * that is actually everything.
 *
 * THE BUG THIS REPLACES was the worst instance of a family that has bitten this
 * codebase six times. It read each table with
 *
 *     const { data } = await supabase.from(tbl).select('*');
 *     out[tbl] = data ?? [];
 *
 * and no `.error` check. supabase-js RESOLVES on a database error, so an RLS
 * denial or a 500 arrived as `data: null`, fell through `?? []`, and was
 * written into the file as an EMPTY ARRAY. The `catch` beside it only fired if
 * the network died outright.
 *
 * So a member exported their data, opened a file that said `"workouts": []`,
 * and reasonably concluded they had none. That is not a cosmetic failure here:
 * web/delete-account.html tells people to take a copy FIRST and says plainly
 * that afterwards there is nothing left to export. The export is the last
 * record they will ever have of their own training, and it was capable of
 * quietly claiming they had never trained.
 *
 * Now every table is checked, and a table that could not be read says so in
 * the file itself rather than looking empty. The bundle carries a `complete`
 * flag and a `failed` list so the caller — and the person reading the JSON
 * years later — can tell a full record from a partial one.
 */
export interface ExportResult {
  json: string;
  /** True only when every table AND every file store was read. */
  complete: boolean;
  /** Tables and file stores that could not be read, with the reason. Empty when
   *  complete. A bucket appears here under its own name. */
  failed: { table: string; reason: string }[];
  /** Every file this account holds, so the member can save them one at a time.
   *  Empty is a real answer only when `complete` is true. */
  files: ExportFile[];
}

/* ── the files, which a JSON bundle cannot contain ────────────────────────── */

/**
 * One object this member holds in storage.
 *
 * The bytes are NOT in the export. That is a decision and not an omission: a
 * member's message attachments include 30-second video at up to 64 MB each
 * (supabase/parts/124), and base64 in a JSON string is a third larger again —
 * a phone assembling that in memory does not produce a large file, it produces
 * a crash, and a crash at the moment somebody is taking the last copy of their
 * records before deleting their account is the worst possible place for one.
 *
 * So the JSON carries this MANIFEST, which is itself the thing the export was
 * missing: a member could not previously find out what files were held about
 * them at all. `saveMyFile` below hands over any one of them as a real file.
 */
export interface ExportFile {
  /** The storage bucket. */
  bucket: string;
  /** The object key. Stable, and what `saveMyFile` takes. */
  path: string;
  /** What it is, in the member's words. */
  what: string;
  /** Bytes, when storage reported a size. Null when it did not — never 0,
   *  which would read as an empty file. */
  sizeBytes: number | null;
  /** When it was stored, ISO, or null when storage did not say. */
  at: string | null;
}

/**
 * Where a member's own files live, and what to call each kind.
 *
 * INJURY DOCUMENTS ARE THE ONE THAT MATTERS MOST HERE. They are private to the
 * client by design — own-folder policies with no trainer branch
 * (supabase/parts/91), a note kept out of the model (src/lib/coachShare.ts), a
 * viewer that never hands the file to another app (src/lib/injuryDocView.ts) —
 * and their absence from the MEMBER'S OWN export was on the wrong side of that
 * rule. A file nobody else may see is still theirs, and a subject access
 * request is the one place it must appear.
 *
 * Every prefix below is the member's own uid. For `message-media` that is the
 * THREAD key, which for a client is their own id (part 124), and the objects
 * sit one level deeper under the uid of whoever sent them — so both halves of
 * the conversation's files are theirs to have, and neither is anybody else's
 * folder.
 */
const FILE_STORES: { bucket: string; what: string; depth: 1 | 2 }[] = [
  { bucket: 'photos', what: 'A progress photograph you took', depth: 1 },
  { bucket: 'injury-docs', what: 'An injury document you uploaded. Only you can see this one.', depth: 1 },
  { bucket: 'message-media', what: 'A photo or video in your conversation with your coach', depth: 2 },
];

/** How many objects to ask for per folder. Storage's own default is 100, which
 *  would silently truncate a year of progress photographs — and a manifest that
 *  is short without saying so is the exact failure this whole file is about. */
const FILE_PAGE = 1000;

/**
 * Every file this account holds.
 *
 * A bucket that could not be listed is REPORTED, not skipped. An empty manifest
 * from a failed read looks identical to a member who has never uploaded
 * anything, and this is the file they will use to decide whether it is safe to
 * delete their account.
 */
export async function listMyFiles(uid: string): Promise<{ files: ExportFile[]; failed: { table: string; reason: string }[] }> {
  const files: ExportFile[] = [];
  const failed: { table: string; reason: string }[] = [];
  if (!USE_SUPABASE || !uid) return { files, failed };

  for (const store of FILE_STORES) {
    try {
      const { data: top, error: topErr } = await supabase.storage.from(store.bucket)
        .list(uid, { limit: FILE_PAGE });
      // Checked. supabase-js resolves on a storage error too, so `data: null`
      // would fall through as "no files" for a bucket that refused the list.
      if (topErr) throw topErr;
      const entries = (top ?? []) as any[];

      if (store.depth === 1) {
        for (const e of entries) {
          // A folder has no id. Skipped rather than listed as a zero-byte file.
          if (!e?.id) continue;
          files.push(toExportFile(store, `${uid}/${e.name}`, e));
        }
        continue;
      }

      // Two levels: the thread folder holds one folder per sender.
      for (const folder of entries) {
        if (folder?.id) { files.push(toExportFile(store, `${uid}/${folder.name}`, folder)); continue; }
        const prefix = `${uid}/${folder.name}`;
        const { data: inner, error: innerErr } = await supabase.storage.from(store.bucket)
          .list(prefix, { limit: FILE_PAGE });
        if (innerErr) throw innerErr;
        for (const e of ((inner ?? []) as any[])) {
          if (!e?.id) continue;
          files.push(toExportFile(store, `${prefix}/${e.name}`, e));
        }
      }
    } catch (e: any) {
      failed.push({ table: store.bucket, reason: e?.message ? String(e.message) : 'could not be listed' });
    }
  }
  return { files, failed };
}

function toExportFile(store: { bucket: string; what: string }, path: string, entry: any): ExportFile {
  const size = entry?.metadata?.size;
  return {
    bucket: store.bucket,
    path,
    what: store.what,
    // Null rather than 0 for a size storage did not report: a 0 beside a
    // photograph reads as an empty file the member should not bother saving.
    sizeBytes: typeof size === 'number' && Number.isFinite(size) ? size : null,
    at: typeof entry?.created_at === 'string' ? entry.created_at : null,
  };
}

/**
 * The bytes of one file, base64, ready for the share sheet.
 *
 * Null when it could not be downloaded, and the caller must say so rather than
 * showing a share sheet with nothing in it. Storage is asked through the same
 * policies the app reads these files with everywhere else, so a path that is
 * not this member's comes back refused here exactly as it would anywhere.
 */
export async function readMyFile(bucket: string, path: string): Promise<string | null> {
  if (!USE_SUPABASE) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) return null;
    const buf = await (data as Blob).arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Chunked. `String.fromCharCode(...bytes)` on a multi-megabyte photograph
    // spreads a million arguments onto the stack and throws RangeError, which
    // would arrive at the member as "your file could not be saved" for a file
    // that downloaded perfectly.
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
    }
    // `btoa` is in Hermes and in every browser this console runs in.
    return typeof btoa === 'function' ? btoa(binary) : null;
  } catch {
    return null;
  }
}

export async function exportMyDataDetailed(): Promise<ExportResult> {
  const out: Record<string, unknown> = { app: BRAND.label, exportedAt: new Date().toISOString() };
  if (!USE_SUPABASE) {
    out.note = `Not connected to ${BRAND.label} — nothing of yours is stored on a server to export.`;
    out.complete = true;
    return { json: JSON.stringify(out, null, 2), complete: true, failed: [], files: [] };
  }

  const failed: { table: string; reason: string }[] = [];

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) failed.push({ table: 'account', reason: authErr.message });
  out.userId = auth?.user?.id ?? null;
  out.email = auth?.user?.email ?? null;

  for (const tbl of TABLES) {
    try {
      const { data, error } = await supabase.from(tbl).select('*');
      // The check that was missing. Without it a refusal becomes [].
      if (error) throw error;
      out[tbl] = data ?? [];
    } catch (e: any) {
      const reason = e?.message ? String(e.message) : 'could not be read';
      failed.push({ table: tbl, reason });
      // Never `[]`. An object cannot be mistaken for "you had none of these",
      // and it survives into the file somebody opens in a year.
      out[tbl] = { error: 'NOT EXPORTED — this table could not be read', reason };
    }
  }

  // ── the files ────────────────────────────────────────────────────────
  //
  // The manifest, not the bytes. See `ExportFile` for why a JSON bundle must
  // not try to carry a member's 64 MB video, and `saveMyFile` for how they get
  // any one of them as a real file.
  //
  // A bucket that could not be listed lands in `failed` beside the tables, so
  // it marks the whole export incomplete. That is deliberate: an empty manifest
  // from a refused read is indistinguishable from a member who has uploaded
  // nothing, and this is the file somebody uses to decide whether it is safe to
  // delete their account.
  const uid = auth?.user?.id ?? '';
  const fileRead = await listMyFiles(uid);
  failed.push(...fileRead.failed);
  out.files = fileRead.files;
  out.filesNote =
    'This file is a record of your files, not the files themselves. Photographs, videos and documents are '
    + 'not text and cannot be put inside a JSON file without breaking it, so each one is listed above with '
    + 'what it is and when it was stored. Save them from the same screen you exported this from, under '
    + '"Save My Files". Anything listed here is yours and can be saved.';

  const complete = failed.length === 0;
  out.complete = complete;
  if (!complete) {
    out.warning =
      'THIS EXPORT IS INCOMPLETE. ' + failed.length + ' of ' + (TABLES.length + FILE_STORES.length) +
      ' parts of your record could not be read. Tables are marked with an "error" object rather than data; ' +
      'a file store that could not be listed means the list of your files above is short and you cannot ' +
      'tell by how much. ' +
      'Do not treat this file as a full copy of your account, and do not delete your ' +
      'account on the strength of it. Try again, or email ' + BRAND.supportEmail + '.';
    out.notExported = failed;
  }
  return { json: JSON.stringify(out, null, 2), complete, failed, files: fileRead.files };
}

/** Back-compatible wrapper: the JSON only. Prefer exportMyDataDetailed, which
 *  can tell the caller the file is partial — a screen that cannot say so will
 *  hand somebody an incomplete record and call it their data. */
export async function exportMyData(): Promise<string> {
  return (await exportMyDataDetailed()).json;
}

/** Flag the account for erasure. Returns true if the request was recorded. */
export async function requestAccountDeletion(): Promise<boolean> {
  if (!USE_SUPABASE) return true;
  try { const { error } = await supabase.rpc('request_account_deletion'); return !error; } catch { return false; }
}

/**
 * When the signed-in person asked to be erased, or null if they have not.
 *
 * Throws if the read fails — deliberately unlike the two calls around it, which
 * swallow. A swallowed failure here would come back as "no pending request" and
 * show someone who has already asked to be deleted the ordinary state, which is
 * the one wrong answer this file must never give. supabase-js RESOLVES on a
 * database error rather than rejecting, so `.error` is what does the work; a
 * try/catch alone would only cover the network dying. The caller keeps its own
 * "not loaded" state and says so on screen.
 */
export async function fetchDeletionRequestedAt(): Promise<string | null> {
  if (!USE_SUPABASE) return null;
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not signed in.');
  const { data, error } = await supabase.from('profiles').select('deletion_requested_at').eq('id', uid).maybeSingle();
  if (error) throw error;
  return (data as { deletion_requested_at?: string | null } | null)?.deletion_requested_at ?? null;
}

/** Take back a pending erasure request. Returns true if the flag was cleared. */
export async function withdrawAccountDeletion(): Promise<boolean> {
  if (!USE_SUPABASE) return true;
  try { const { error } = await supabase.rpc('withdraw_account_deletion'); return !error; } catch { return false; }
}
