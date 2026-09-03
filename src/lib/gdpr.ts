// GDPR — data access (export) + right-to-erasure (deletion request). The export
// pulls the signed-in user's own rows into a JSON bundle. Deletion flags the
// profile; an operator/edge-function purges the auth user. Both are best-effort
// and OTA-safe.
//
// The member half of that read leans on RLS: every policy behind `TABLES`
// narrows to `= auth.uid()`, so a bare select returns the person's own rows and
// nothing else. The COACH half cannot — `trainers` is readable for the whole
// public directory and `trainer_packages` for whatever anybody bought — so
// `COACH_TABLES` names the column that means "mine" and this file applies it.
// A coach's export is opted into by the caller (`{ coach: true }`), which is
// app/(trainer)/settings.tsx alone.
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
// PostgREST stops at a thousand rows and says nothing. This file's whole
// subject is a record that is short without saying so.
import { capLimit, capped } from './rowCap';

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
 * Every table the signed-in person can read their own rows out of AS A MEMBER.
 *
 * The coach's half of the account is `COACH_TABLES` below and is asked for
 * separately, for a reason that is about RLS rather than about tidiness.
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
  // The gym's own paperwork, and the signatures the member put on it: the
  // waiver, the PAR-Q, the photo consent and the membership contract that
  // app/(client)/agreements.tsx writes. These were missing, and they are the
  // STRONGEST legal record a member creates in this app — supabase/parts/185
  // makes a signature irreversible, and web/delete-account.html tells the
  // member to export before requesting erasure, so this file is the last copy
  // they will ever have of it. The gym's own console already pulls them
  // (studio-web/app/export/page.tsx), so the member's own export was the one
  // place they did not appear.
  //
  // The signatures narrow to the member (gym_agreement_sig_own_r, part 520).
  // The agreements themselves are the tenant's documents, opened to the whole
  // tenant by part 185 on the grounds that a document somebody has to sign and
  // cannot read before signing is not consent — so this exports the WORDING
  // beside the signature, which is the half that makes the signature mean
  // anything a year later.
  'gym_agreement_signatures',                // part 520 · gym_agreement_sig_own_r
  'gym_agreements',                          // part 185 · gym_agreements_tenant_r
];

/**
 * The other half of a coach's account: their own coaching business.
 *
 * ── What the export contained, and whose it was ──────────────────────────
 *
 * `TABLES` above is the MEMBER's record — what they logged, what they booked,
 * what they paid. app/(trainer)/settings.tsx offers "Export My Data" on the
 * same function, so a coach who asked for their data got somebody else's shape
 * entirely: no `trainers` row, none of their price list, not one invoice they
 * issued, no receipt they wrote up, no payout that reached their bank, no cost
 * they recorded and no enquiry that came in through their code. Their books
 * are the part of this app that is legally theirs and commercially theirs, and
 * it was the part the export had none of.
 *
 * ── WHY THIS IS A SECOND LIST AND NOT MORE ENTRIES IN THE FIRST ──────────
 *
 * Every table above is read with a bare `select('*')` and that is safe there
 * because a member's policies all narrow to `= auth.uid()`: RLS is the filter,
 * and it is the whole filter.
 *
 * The coach-side tables do not behave that way and two of them are outright
 * dangerous read that way. `trainers_public_directory_r` (part 23) grants
 * SELECT on every LISTED coach on the platform, `trainers_peer_r` grants it on
 * everyone in the same gym, and `pkg_read` (part 147) grants a coach the price
 * list of the coach who trains THEM plus every package anybody ever bought
 * from anyone. A bare `select('*')` on those two would write several hundred
 * other people's rows into a file called "my data" and hand it to somebody as
 * their own record — the mirror image of the empty-array bug below, and the
 * worse half of it, because this one leaves the building.
 *
 * So every row here names the column that means "mine" and is filtered on it
 * by this file. RLS still refuses anything it should; the filter is what makes
 * the ANSWER the coach's own rather than everything they are allowed to see.
 *
 * A table goes in on the same rule as above — only if the signed-in coach can
 * read their own rows out of it — and each is named beside the part that
 * grants it.
 *
 * Two things it deliberately does not carry. `coach_lead_notes` (part 157) is
 * keyed on the lead rather than on the coach, so it has no column that means
 * "mine" and would need a join this file does not do; the enquiries themselves
 * are here and the notes are named in the file's own warning as the one thing
 * left out. And no client's record is here under any name: a coach's export is
 * their business, and their clients' training belongs to their clients.
 */
const COACH_TABLES: { table: string; column: string; what: string }[] = [
  // Who they are as a coach, as opposed to who they are as a person —
  // `profiles` is already in TABLES above.        (part 23 · trainers_self_rw)
  { table: 'trainers',              column: 'id',         what: 'your coach profile' },
  { table: 'coach_prefs',           column: 'user_id',    what: 'your coaching preferences' },      // part 129 · coach_prefs_self
  { table: 'notify_channel_prefs',  column: 'user_id',    what: 'which notifications you muted' },  // part 251 · ncp_self
  // What they sell, and who they sold it to.
  { table: 'trainer_packages',      column: 'trainer_id', what: 'your price list' },                // part 147 · pkg_read / pkg_write
  { table: 'coach_join_codes',      column: 'trainer_id', what: 'your join codes' },                // part 81  · coach_join_codes_owner_read
  { table: 'coach_leads',           column: 'trainer_id', what: 'enquiries that came through your codes' }, // part 157 · coach_leads_owner_read
  // The books. The half of the export a coach would come here for.
  { table: 'coach_invoices',        column: 'coach_id',   what: 'invoices you issued' },            // part 138 · coach_invoices_owner_read (tax columns: part 451)
  { table: 'coach_receipts',        column: 'coach_id',   what: 'money you recorded taking' },      // part 190 · coach_receipts_owner_read
  { table: 'coach_payouts',         column: 'coach_id',   what: 'payouts that reached your bank' }, // part 194 · coach_payouts_owner_read
  { table: 'coach_costs',           column: 'coach_id',   what: 'costs you recorded' },             // part 450 · coach_costs_owner_read
  // The work itself.
  { table: 'coach_clients',         column: 'trainer_id', what: 'clients you added by hand' },      // part 23  · coach_clients_trainer_rw
  { table: 'coach_checklist_items', column: 'coach_id',   what: 'checklist lines you set' },        // part 58  · coach_checklist_coach_write
  { table: 'coach_documents',       column: 'coach_id',   what: 'documents you published' },        // part 135 · coach_documents_coach_r
];

/** What the file says about the one coach-side table that could not be given a
 *  column meaning "mine". Said in the bundle rather than left as a silent
 *  omission, because "everything held about you" is what an export claims. */
const COACH_OMISSION_NOTE =
  'Notes you wrote against an enquiry (coach_lead_notes) are not in this file. They are stored against the '
  + 'enquiry rather than against you, so there is no field on them that says they are yours to pull out on '
  + 'their own. The enquiries themselves are above. Ask support if you need the notes as well.';

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
  // ── The removed sentence, still standing in the one document that is ABOUT
  //    where a person's data has been ────────────────────────────────────────
  //
  // This said "An injury document you uploaded. Only you can see this one."
  //
  // That is the exact sentence app/(client)/injury-doc.tsx was rewritten to
  // remove, and src/lib/injuryDocConsent.ts spends its header explaining why:
  // the bucket really is private to its owner (supabase/parts/91, own-folder
  // policies with no trainer branch), and READING a document means sending a
  // copy of it to OCR.space. A member who says yes to that has a document that
  // more than one party has seen, and "only you can see this one" is then a
  // false statement about it.
  //
  // It matters more here than it did on the screen, not less. This line is the
  // label in a SUBJECT ACCESS EXPORT — the file a person asks for precisely
  // because they want to know who holds what about them, and the one they keep
  // after deleting the account. A manifest that answers that question wrongly
  // is worse than one that does not answer it.
  //
  // The manifest cannot state the per-document answer: the consent rows are a
  // separate read (`ocr_consents`), this walk is over storage objects, and
  // matching them up here would make an export fail for a reason that has
  // nothing to do with the export. So it says the part that is unconditionally
  // true of every one of these files and points at where the per-document
  // answer lives, which the member can open and read for themselves.
  { bucket: 'injury-docs', what: 'An injury document you uploaded. It is stored where only you can open it, and your coach never sees the file. If you agreed to have one read, a copy of that document also went to OCR.space — the Injuries screen in the app says, against each document, which of yours those were.', depth: 1 },
  { bucket: 'message-media', what: 'A photo or video in your conversation with your coach', depth: 2 },
  // Added with supabase/parts/961, which is where a profile photo started
  // being a file at all. Before that the column held a path inside the
  // member's own handset and there was nothing in any bucket to export.
  { bucket: 'avatars', what: 'Your profile photo, as your coach and your gym see it', depth: 1 },
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

export interface ExportOptions {
  /**
   * Also export the coach's own business — `COACH_TABLES`.
   *
   * Off by default, and it is a caller's decision rather than something this
   * file sniffs out of the profile role. A member who is not a coach has no
   * rows in any of those tables, so asking would return thirteen empty arrays
   * and thirteen chances for a refusal to be reported as a part of their
   * record that could not be read — which is the sentence that tells somebody
   * their export is short. app/(trainer)/settings.tsx passes true; the client
   * and owner screens do not, and their file is byte-identical to before.
   */
  coach?: boolean;
}

export async function exportMyDataDetailed(opts: ExportOptions = {}): Promise<ExportResult> {
  const out: Record<string, unknown> = { app: BRAND.label, exportedAt: new Date().toISOString() };
  if (!USE_SUPABASE) {
    out.note = `Not connected to ${BRAND.label} — nothing of yours is stored on a server to export.`;
    out.complete = true;
    return { json: JSON.stringify(out, null, 2), complete: true, failed: [], files: [] };
  }

  const failed: { table: string; reason: string }[] = [];

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) failed.push({ table: 'account', reason: authErr.message });
  const myId = auth?.user?.id ?? null;
  out.userId = myId;
  out.email = auth?.user?.email ?? null;

  for (const tbl of TABLES) {
    try {
      // `capLimit()`, and then `capped()`. This was a bare `select('*')` with
      // no limit and no truncation check, on a loop over every table a member
      // has rows in — so PostgREST's configured maximum cut `workouts` and
      // `messages` for anybody with a real history, and nothing on the way out
      // noticed. `complete` below is computed from `failed` alone, so the file
      // that reached the member was missing years of their own record with a
      // field in it asserting that it was not. `listMyFiles` a few lines down
      // already says why that is the worst shape this file can take: "a
      // manifest that is short without saying so is the exact failure this
      // whole file is about" — and web/delete-account.html has already told
      // them to rely on this before they erase the original.
      const { data, error } = await supabase.from(tbl).select('*').limit(capLimit());
      // The check that was missing. Without it a refusal becomes [].
      if (error) throw error;
      const page = capped(data ?? []);
      if (page.truncated) {
        // An OBJECT, not an array, for the same reason a failed table is one:
        // an array of a thousand rows cannot be told from the whole set by
        // anybody opening this file in a year. The rows that did come back are
        // kept inside it — nothing is thrown away — but they cannot be read as
        // "this is all of them".
        const reason = `only the first ${page.rows.length} rows could be read; there are more`;
        failed.push({ table: tbl, reason });
        out[tbl] = { error: 'INCOMPLETE — this table has more rows than could be read in one go', reason, rows: page.rows };
      } else {
        out[tbl] = page.rows;
      }
    } catch (e: any) {
      const reason = e?.message ? String(e.message) : 'could not be read';
      failed.push({ table: tbl, reason });
      // Never `[]`. An object cannot be mistaken for "you had none of these",
      // and it survives into the file somebody opens in a year.
      out[tbl] = { error: 'NOT EXPORTED — this table could not be read', reason };
    }
  }

  // ── the coach's own business ─────────────────────────────────────────
  //
  // Filtered by this file rather than left to RLS. See COACH_TABLES for why
  // the two halves of this function read so differently: a bare select on
  // `trainers` returns the public directory and every peer in the gym, and a
  // bare select on `trainer_packages` returns whatever the coach's own coach
  // sells — several hundred other people's rows, in a file called "my data".
  const coachTables = opts.coach ? COACH_TABLES : [];
  for (const c of coachTables) {
    try {
      // Not "unfiltered because RLS will narrow it". Without an id there is no
      // filter to apply, and a read that cannot be scoped to this coach must
      // not go out at all — an unscoped one would succeed and return other
      // people's rows.
      if (!myId) throw new Error('nobody is signed in, so this could not be narrowed to your own rows');
      const { data, error } = await supabase.from(c.table).select('*').eq(c.column, myId).limit(capLimit());
      if (error) throw error;
      // Same rule as the member's half. A coach's invoices and sessions are the
      // two tables in this app most likely to pass a thousand rows.
      const page = capped(data ?? []);
      if (page.truncated) {
        const reason = `only the first ${page.rows.length} rows could be read; there are more`;
        failed.push({ table: c.table, reason });
        out[c.table] = { error: `INCOMPLETE — ${c.what} has more rows than could be read in one go`, reason, rows: page.rows };
      } else {
        out[c.table] = page.rows;
      }
    } catch (e: any) {
      const reason = e?.message ? String(e.message) : 'could not be read';
      failed.push({ table: c.table, reason });
      out[c.table] = { error: `NOT EXPORTED — ${c.what} could not be read`, reason };
    }
  }
  if (opts.coach) out.coachingNote = COACH_OMISSION_NOTE;

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
      'THIS EXPORT IS INCOMPLETE. ' + failed.length + ' of ' + (TABLES.length + coachTables.length + FILE_STORES.length) +
      ' parts of your record could not be read. Tables are marked with an "error" object rather than data; ' +
      'a file store that could not be listed means the list of your files above is short and you cannot ' +
      'tell by how much. ' +
      'Do not treat this file as a full copy of your account, and do not delete your ' +
      'account on the strength of it. Try again, or email ' + BRAND.supportEmail + '.';
    out.notExported = failed;
  }
  return { json: JSON.stringify(out, null, 2), complete, failed, files: fileRead.files };
}

/* `exportMyData()` — the back-compatible wrapper that returned the JSON alone —
 * used to sit here and is gone. Its own doc told callers to prefer
 * `exportMyDataDetailed`, because a wrapper that drops `complete` and `failed`
 * hands somebody an incomplete record and calls it their data; all three
 * Settings screens took that advice, so it had no callers at all.
 * scripts/check-dead-exports.mjs is what noticed. */

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
