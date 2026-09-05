// What "export my data" says, and what "delete my account" says about the files.
//
// The reads are in src/lib/gdpr.ts, which imports the Supabase client and
// therefore cannot run under `npm test`. Everything here is pure, so every
// sentence a member reads at the two moments that matter most — taking the last
// copy of their own record, and destroying it — is assertable without a device.
//
// ── What was wrong ───────────────────────────────────────────────────────
//
// The export listed fourteen tables and none of them was money, a booking, or a
// file. No payments, no invoices, no memberships, no packs, no subscriptions,
// no promo redemptions, no waitlists, no late-cancellation charges, no visits,
// no signed waiver, no coach documents accepted. And the output is JSON, so no
// binaries at all: not the progress photographs, not the message attachments,
// and not the member's own physiotherapy reports.
//
// The injury documents are the sharpest of those. They are private to the
// client by design (supabase/parts/91) — nobody else may see them, not even the
// coach — and a document only the member may see was the one thing missing from
// the member's own subject access request. Privacy that excludes the subject is
// not privacy.
//
// ── Why the bytes are not in the JSON ────────────────────────────────────
//
// A message attachment may be a 30-second video at up to 64 MB
// (supabase/parts/124), and base64 inside a JSON string is a third larger
// again. A phone assembling that in memory does not produce a large file, it
// produces a crash — at the exact moment somebody is taking the last copy of
// their records before deleting their account.
//
// So the bundle carries a MANIFEST of every file, which is itself something a
// member could not previously get, and the files are saved one at a time
// alongside it. The JSON says so in its own text rather than leaving somebody
// to notice.
//
// ── What is STILL missing from the export, checked live 3 Sep 2026 ───────
//
// `TABLES` in src/lib/gdpr.ts admits a table only if a member can read their
// own rows out of it under RLS. Two tables pass that test and are not in the
// list, and neither is disclosed anywhere in the bundle:
//
//   push_tokens    `pt_self` is ALL, `user_id = auth.uid()`.
//   notifications  `notif_self` is ALL, `user_id = auth.uid()`.
//
// One table that a previous sweep said was missing must NOT be added:
//
//   app_errors     the only SELECT policy is `app_errors_owner`, which is
//                  `is_owner_of(tenant_of_user(user_id))`. A member cannot
//                  read their own crash reports; their gym's owner can. Adding
//                  it would refuse on every member export and mark every one
//                  incomplete, which trains people to ignore the warning that
//                  says the file is short. Its absence is a real gap in what a
//                  member can get — it is a gap in the POLICY, not in this list.
//
// And `coach_lead_notes` is genuinely readable (`coach_lead_notes_owner_read`
// joins through `coach_leads.trainer_id`) but has no column meaning "mine", so
// gdpr.ts leaves it out and names it in `COACH_OMISSION_NOTE`. That one is
// already honest. The two above are not, and web/delete-account.html no longer
// says the export omits only two things.

/** Bytes as a person reads them. Null in, "size unknown" out — never "0 B",
 *  which beside a photograph reads as an empty file not worth saving. */
import { num, num1 } from './format';

export function fileSizeLabel(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return 'size unknown';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? num1(kb) : num(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? num1(mb) : num(mb)} MB`;
}

/**
 * The row under "Save My Files".
 *
 * `count` is only a count when the read that produced it finished. Under a
 * failed read the manifest may be short by an unknown amount, and a screen
 * saying "3 files" over that is the same defect as the export saying
 * `"workouts": []` — a confident number standing on a read that did not answer.
 */
export function filesRowNote(count: number, complete: boolean): string {
  if (!complete) {
    return 'Part of your record could not be read, so this list of files may be short. Export again before you rely on it.';
  }
  if (count === 0) return 'You have no photos, videos or documents stored.';
  return count === 1
    ? '1 file. Photos, videos and documents are saved one at a time.'
    : `${count} files. Photos, videos and documents are saved one at a time.`;
}

/** After a file was handed to the share sheet, or was not. `blocker` is
 *  `fileShareBlocker()` — the sentence for a build that cannot attach a file at
 *  all — and it is preferred when there is one, because "that file could not be
 *  saved" sends somebody to try the next one and get the same nothing. */
export function saveFileFailure(blocker: string | null): string {
  return blocker
    ?? 'That file could not be saved. It is still stored on your account and nothing has been lost. Try again in a moment.';
}

/**
 * What the export screen says before anybody taps anything.
 *
 * Names the three things it now includes that it did not, because the whole
 * complaint was that a member could not tell what was missing.
 */
export const EXPORT_ROW_NOTE = 'Your records, your money, your bookings and a list of your files';

/**
 * What the COACH's export file is called.
 *
 * The same argument `MY_DATA_FILENAME` in src/lib/gdpr.ts makes, applied to the
 * other half of the account: app/(trainer)/settings.tsx wrote
 * 'repple-coach-my-data.json' as a literal, so a coach at a white-labelled
 * chain saved a file named after a company they do not deal with — and the name
 * is what they will search their downloads for in two years.
 *
 * `brandId` is the registry key, which is lowercase and hyphenated and is
 * therefore already a safe filename on every platform. Taken as an argument
 * rather than read here so this module stays pure and the sentence is
 * assertable without a build's brand loaded.
 */
export function coachDataFilename(brandId: string): string {
  const id = (brandId || '').trim();
  // Never an empty prefix. A file called '-coach-my-data.json' looks broken and
  // sorts to the top of a downloads folder under no name at all.
  return `${id || 'my'}-coach-my-data.json`;
}

/**
 * What happens to the FILES when an account is deleted.
 *
 * Every clause is a fact about this implementation, and the awkward ones are
 * stated rather than smoothed over. Deleting the account cascades the ROWS
 * (supabase/parts/41). The objects in storage are chased separately, on a
 * queue, and a queue is not the same promise as an instant.
 *
 * ── Counted live on the project, 3 September 2026 ────────────────────────
 *
 *     select c.relname, t.tgname from pg_trigger t
 *       join pg_class c on c.oid = t.tgrelid where not t.tgisinternal;
 *
 * now returns three triggers that chase bytes out of object storage:
 * `on_progress_photo_delete` on `progress_photos` (part 45, drained by the
 * `purge-progress-photo-files` cron job at every fifth minute),
 * `trg_profiles_queue_file_purge` BEFORE DELETE on `profiles` (part 1120), and
 * `trg_exercise_video_deleted` AFTER DELETE on `exercise_videos` (part 1152).
 * The last two write `public.object_purge`, which exists, has RLS on and no
 * policies, and is drained by `purge-account-files` at `2-59/5 * * * *`. Its
 * check constraint reads, verbatim from `pg_constraint`:
 *
 *     bucket_id in ('injury-docs', 'message-media', 'avatars',
 *                   'coach-logos', 'coach-docs', 'exercise-videos')
 *
 * So the profile photo, the message attachments and the injury documents are
 * on a mechanism, and so are the three coach stores. Parts 1120 and 1152 both
 * stamp `purged_at` ONLY from a Storage reply that says the object is absent —
 * 200/204, or a 404 / NoSuchKey. That distinction is the reason this sentence
 * says "asked to be deleted and deleted are not the same claim" rather than
 * "your files are deleted": a queued row is a request that has been sent.
 *
 * `storage-purge-backlog-alarm` (part 1153, `4 9 * * *`) raises if anything in
 * EITHER queue has been outstanding for more than a day. What that produces is
 * a `status = 'failed'` row in `cron.job_run_details` — a red run in the
 * Supabase dashboard's cron view. It emails nobody and pages nobody, so the
 * sentence says "somewhere we look", which is true, and not "we are alerted",
 * which is not.
 *
 * `gym-docs` is deliberately NOT in that constraint. Part 1152 § 6 gives two
 * reasons: a gym document's key is `<tenant uid>/…` so a member's erasure
 * cannot enumerate it, and `gym_documents.member_id` is `on delete set null`
 * so the one link is severed by the same statement that would have to use it.
 * Whether a gym's copy of somebody's contract outlives them is a per-country
 * retention decision nobody has made; `public.gym_documents_about_erased_members`
 * is the list it will be made against. That is why the note below names it
 * rather than quietly leaving it out of a sentence about "your files".
 *
 * Saying so is not an admission that costs anything. Saying nothing — which is
 * what this screen did — leaves somebody believing their physiotherapy report
 * went with their account, and that belief is the thing that would actually
 * harm them.
 */
export const DELETION_FILES_NOTE =
  'Your records are deleted with your account. The files behind them go separately, on a queue: your progress '
  + 'photographs, your profile photo, anything you sent or received in messages and any injury documents you '
  + 'uploaded are all queued for deletion the moment the account goes, and a scheduled job sends each one within '
  + 'minutes. None of them is marked done until the file store confirms the file has gone — asked to be deleted '
  + 'and deleted are not the same claim, and only the second one is recorded. If anything sticks in that queue '
  + 'for more than a day, a daily check fails loudly in our own logs, which is somewhere we look rather than an '
  + 'alert that reaches anybody. One thing is not on that queue: a document your gym filed about you, such as a '
  + 'signed contract or an incident report, stays with the gym, because how long a gym must keep those differs by '
  + 'country and we have not settled it. Export and save your files first if you want a copy.';

/**
 * The same thing for a COACH, which is a different set of files and one extra
 * fact that is not a file at all.
 *
 * `DELETION_FILES_NOTE` above is a member's stores. A coach holds four more —
 * `coach-logos` (part 330), `coach-docs` (part 135), `exercise-videos` (part
 * 49) and their half of `message-media`. All four are now on the same queue.
 * Part 1152 is applied: the first three are named in `object_purge`'s check
 * constraint (read live, 3 Sep 2026), and `message-media` was already there
 * from part 1120 — `queue_account_object_purges()` matches the SECOND path
 * segment as well as the first, which is what makes a coach's own uploads
 * under somebody else's thread folder theirs to take with them.
 *
 * `exercise-videos` is hooked differently from the rest and it matters: the
 * row carries the path, so part 1152 hangs `trg_exercise_video_deleted` AFTER
 * DELETE on `exercise_videos` rather than reading the bucket. That covers the
 * account cascade AND the single-clip delete in src/ui/exerciseVideos.ts,
 * whose `remove()` failure was previously swallowed.
 *
 * The extra fact is part 1151, and it is verified against the live catalogue
 * rather than read off a SQL file, because no single file contains it:
 *
 *     coach_documents.coach_id               → trainers(id)        cascade
 *     coach_document_acceptances.document_id → coach_documents(id) RESTRICT
 *     coach_document_recipients.document_id  → coach_documents(id) RESTRICT
 *     trainers.id                            → profiles(id)        cascade
 *     profiles.id                            → auth.users(id)      cascade
 *
 * `action_account_deletion()` ends in `delete from auth.users`, which cascades
 * down to `coach_documents` and WAS refused there by the RESTRICT. The whole
 * transaction rolled back — including the `deletion_log` insert two statements
 * earlier, so there was not even a record that the attempt was made.
 *
 * Part 1151 is now applied and `trg_profiles_release_coach_documents` is live
 * (BEFORE DELETE on `profiles`, confirmed in `pg_trigger` on 3 Sep 2026). The
 * two RESTRICT keys are UNCHANGED — that was the whole design. They still
 * refuse every other caller, so an accepted document is still undeletable; what
 * exists now is exactly one route past them, and it is the coach's own erasure.
 *
 * That has a cost and the note states it rather than burying it: when a coach
 * is erased, the record that their clients accepted their waiver goes too.
 * Part 1151's own header argues why that is the correct end of the trade —
 * keeping the document would mean keeping the coach's uid in an object key
 * indefinitely, "which is not retention, it is a refusal to erase wearing
 * retention's clothes".
 *
 * Nobody is in that position on this project today (0 rows in
 * `coach_documents`, 0 acceptances, 0 recipients, read 3 Sep 2026), but the
 * feature is shipped and the first coach to publish a waiver is.
 *
 * What the note must NOT now say is "deleted". Every one of those six buckets
 * is queued and sent; `purged_at` comes only from a Storage reply confirming
 * absence. See the block above `DELETION_FILES_NOTE` for the queue, the alarm
 * and what the alarm does not do.
 */
export const COACH_DELETION_FILES_NOTE =
  'Your records are deleted with your account. The files behind them go separately, on a queue: your logo, any '
  + 'document you published, any exercise clip you recorded, your profile photo and anything you sent or received '
  + 'in messages are all queued for deletion the moment the account goes, and a scheduled job sends each one '
  + 'within minutes. Progress photographs you took for yourself go through their own scheduled job. Nothing is '
  + 'marked done until the file store confirms the file has gone — asked to be deleted and deleted are not the '
  + 'same claim, and only the second one is recorded. And if a client has ever accepted or been sent one of your '
  + 'documents, the deletion now completes on its own: erasing your account is the only thing that can release '
  + 'those acceptances, nothing else can, and it takes the record that your clients accepted your document with '
  + 'it. Export and save your files first if you want a copy.';

/** The line the export screen shows when the bundle came back short. `parts` is
 *  what could not be read — tables and file stores together — and it is named
 *  rather than counted, because "3 parts" tells nobody whether their payments
 *  are in the file. */
export function incompleteExportLine(parts: string[], supportEmail: string): string {
  const named = parts.slice(0, 6).join(', ');
  const more = parts.length > 6 ? `, and ${parts.length - 6} more` : '';
  return `${parts.length} part${parts.length === 1 ? '' : 's'} of your record could not be read (${named}${more}). `
    + 'The file has been saved and says so inside, but do not treat it as a full copy, and do not delete your '
    + `account on the strength of it. Try again in a moment, or email ${supportEmail}.`;
}

/* ── which buckets the export actually walks ──────────────────────────────
 *
 * This list used to live inside src/lib/gdpr.ts, where nothing under `npm test`
 * could reach it — gdpr.ts imports the Supabase client — and it held FOUR
 * buckets: `photos`, `injury-docs`, `message-media`, `avatars`.
 *
 * `COACH_DELETION_FILES_NOTE` above names five kinds of file and ends "Export
 * and save your files first if you want a copy." Three of the five were in
 * buckets the export did not look in. A coach who did exactly what that
 * sentence told them to got a manifest with no logo, no published document and
 * no exercise clip in it, marked `complete: true` — and then erased the account,
 * at which point `trg_profiles_queue_file_purge` and `trg_exercise_video_deleted`
 * (supabase/parts/1120 and 1152) destroyed all three. The one screen in the app
 * that exists to hand somebody the last copy of their own record was silently
 * short by the three stores that are only ever a coach's.
 *
 * So the list lives here, where dataExport.test.ts asserts it against the very
 * sentence that promises it, and gdpr.ts imports it.
 *
 * `coachOnly` rather than one flat list: `coach-logos`, `coach-docs` and
 * `exercise-videos` can only ever hold objects for somebody who has used the
 * coach app (app/(trainer)/brand.tsx, documents.tsx and videos.tsx are the only
 * writers, and every key in all three is `<coach uid>/…`). Walking them for a
 * member would be three more round trips, on the screen where a slow export is
 * least welcome, to list three folders that cannot exist — and a bucket that
 * refuses the listing lands in `failed` and marks the whole export INCOMPLETE,
 * which is a false alarm nobody could act on. `gym-docs` is deliberately absent
 * from BOTH lists for the reason supabase/parts/1152 § 6 gives at length: it is
 * the gym's filing cabinet and not any one person's file.
 */
export interface ExportFileStore {
  bucket: string;
  /** What to call it in the member's own words. "photo_1724.jpg" tells nobody
   *  which of these is their physiotherapy report. */
  what: string;
  /** How deep the objects sit under the person's own uid. */
  depth: 1 | 2;
  /** Only walked for an export the caller opted into as a coach's. */
  coachOnly?: true;
}

export const EXPORT_FILE_STORES: readonly ExportFileStore[] = [
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
  // separate read (`ocr_consents`), the walk is over storage objects, and
  // matching them up there would make an export fail for a reason that has
  // nothing to do with the export. So it says the part that is unconditionally
  // true of every one of these files and points at where the per-document
  // answer lives, which the member can open and read for themselves.
  { bucket: 'injury-docs', what: 'An injury document you uploaded. It is stored where only you can open it, and your coach never sees the file. If you agreed to have one read, a copy of that document also went to OCR.space — the Injuries screen in the app says, against each document, which of yours those were.', depth: 1 },
  { bucket: 'message-media', what: 'A photo or video in your conversation with your coach', depth: 2 },
  // Added with supabase/parts/961, which is where a profile photo started
  // being a file at all. Before that the column held a path inside the
  // member's own handset and there was nothing in any bucket to export.
  { bucket: 'avatars', what: 'Your profile photo, as your coach and your gym see it', depth: 1 },
  // ── the three the coach note promises and the walk did not visit ────────
  { bucket: 'coach-logos', what: 'Your logo, as it appears on your invoices and on your clients’ app', depth: 1, coachOnly: true },
  { bucket: 'coach-docs', what: 'A document you published to your clients — a waiver, a par-form, your terms', depth: 1, coachOnly: true },
  { bucket: 'exercise-videos', what: 'An exercise clip you recorded', depth: 1, coachOnly: true },
];

/** The stores an export of this kind walks. A coach's account holds everything
 *  a member's does and three stores besides; a member's holds none of the
 *  three, so asking after them would be three refusals to explain. */
export function exportFileStores(coach: boolean): ExportFileStore[] {
  return EXPORT_FILE_STORES.filter((s) => coach || !s.coachOnly);
}
