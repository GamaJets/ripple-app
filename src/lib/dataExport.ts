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

/** Bytes as a person reads them. Null in, "size unknown" out — never "0 B",
 *  which beside a photograph reads as an empty file not worth saving. */
export function fileSizeLabel(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return 'size unknown';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
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
 * What happens to the FILES when an account is deleted.
 *
 * Every clause is a fact about this implementation, and the awkward one is
 * stated rather than smoothed over. Deleting the account cascades the ROWS
 * (supabase/parts/41). The objects in storage are chased separately: progress
 * photographs go through the purge queue that part 48 actually schedules, and
 * the operator notes in parts 91 and 124 say plainly that the equivalent for
 * injury documents and message attachments does not exist yet and is done by
 * hand.
 *
 * Saying so is not an admission that costs anything. Saying nothing — which is
 * what this screen did — leaves somebody believing their physiotherapy report
 * went with their account, and that belief is the thing that would actually
 * harm them.
 */
export const DELETION_FILES_NOTE =
  'Your records are deleted with your account. The files behind them — your progress photographs, anything you '
  + 'sent or received in messages, and any injury documents you uploaded — are removed separately, and not all of '
  + 'that is automatic yet: photographs are cleared by a scheduled job, and message attachments and injury '
  + 'documents are cleared by us on request. Export and save your files first if you want a copy, and email us '
  + 'if you want them destroyed straight away.';

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
