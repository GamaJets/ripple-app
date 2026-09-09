// Turning a coach's spreadsheet into a roster — the plan, and the report.
//
// ── The switching cost this exists to remove ───────────────────────────────
//
// app/(trainer)/dashboard.tsx adds clients one at a time: a name, a goal, a
// delivery mode, an optional email, a modal, a round trip. A coach arriving
// from another product with forty clients does that forty times, and most of
// them do not. src/lib/csvImport.ts could always read a spreadsheet and was
// scoped to the Studio console; src/lib/rosterExport.ts goes the other way and
// is export-only. Nothing brought a book IN.
//
// ── What this file is, and what it is not ──────────────────────────────────
//
// `previewCoachRoster` in csvImport.ts reads the file. `screenInvites` in
// memberInvites.ts already knows how to drop the addresses that cannot be
// invited and say why — including duplicates inside one batch, which is the
// defect that leaves an import half-done with nobody knowing where it stopped.
// Neither is reimplemented here and neither should be.
//
// What is missing between them is the PLAN: what this import will actually do,
// stated before it does any of it, and the report of what it did. Both are
// pure, because both are sentences a coach reads about their own book and a
// wrong one is worse than a failed import.
//
// ── Two things a roster import must never do ───────────────────────────────
//
// 1. CLAIM AN INVITE THAT WAS NOT SENT. A coach's email invite only links a
//    client if they sign up with that address spelled exactly the same way, and
//    the Add Client sheet already says so. An import that reports "40 invited"
//    when eight writes were refused leaves eight people who will never link,
//    and the coach has no list of which eight. Every outcome below is counted
//    per row and named.
//
// 2. REPORT A HALF-DONE IMPORT AS DONE. These are N separate round trips, not
//    one transaction, and a connection that drops at row twelve leaves twelve
//    clients on the roster and twenty-eight nowhere. The report says exactly
//    which rows landed, so the coach re-imports the rest rather than the lot.
import type { CoachClientRow, ImportPreview } from './csvImport';
// The reader's own grouping. Safe here because this module is reachable only
// from the phone app: an edge function has no reader whose locale it could ask,
// and a latched `appLocale()` under Next.js resolves on the server during
// render and again in the browser. See scripts/check-numbers.mjs.
import { num } from './format';

/** What the import is about to do, row by row, before it does any of it. */
export interface RosterPlan {
  /** Rows that will become a client on the roster. */
  create: CoachClientRow[];
  /** Of those, the ones that will also get an email invite. A subset of
   *  `create`, never a separate population: a client is added first and the
   *  invite is an extra, exactly as the Add Client sheet does it. */
  invite: CoachClientRow[];
  /** Rows the file itself refused, with the reason `previewCoachRoster` gave. */
  rejected: { line: number; name: string | null; reason: string }[];
  /** Rows that WILL be added but whose email will not be invited, with why —
   *  an address already invited, or listed twice in this file. The client
   *  still comes across; only the invite is dropped. */
  inviteSkipped: { name: string; email: string; reason: string }[];
}

/**
 * The plan, from a preview and the addresses this coach has already invited.
 *
 * `alreadyInvited` is the set of addresses with an open invite. Pass an EMPTY
 * array only when that is known to be empty — a failed read passed as `[]` here
 * would let the import re-invite everybody, and a second invite to somebody who
 * already has one is refused by the partial unique index in part 37 halfway
 * through the batch. `screenInvites` is what applies it; this is what explains
 * the result.
 *
 * Takes the already-screened result rather than calling `screenInvites` itself,
 * because that function is generic over the row shape and the caller has the
 * types. One screening, one answer.
 */
export function rosterPlan(
  preview: ImportPreview<CoachClientRow>,
  screened: { send: CoachClientRow[]; rejected: { row: CoachClientRow; reason: string }[] },
): RosterPlan {
  return {
    // Every readable row becomes a client, INCLUDING the ones whose email was
    // screened out. That is the important asymmetry: a duplicate address is a
    // reason not to send a second invite and not a reason to leave somebody off
    // a coach's roster.
    create: preview.ready,
    invite: screened.send.filter((r) => !!r.email),
    rejected: preview.rejected.map((r) => ({
      line: r.line,
      name: r.value?.name?.trim() || null,
      reason: r.errors.join('; '),
    })),
    inviteSkipped: screened.rejected
      .filter((r) => !!r.row.email)
      .map((r) => ({ name: r.row.name, email: r.row.email as string, reason: r.reason })),
  };
}

/**
 * Why this file cannot be imported at all, or null when it can.
 *
 * A blocker, not a warning. `previewCoachRoster` returns `ready: []` when the
 * name column is missing, and an import that runs on that adds nobody and
 * reports success.
 */
export function planBlocker(preview: ImportPreview<CoachClientRow>, plan: RosterPlan): string | null {
  if (preview.missingRequired.length) {
    return 'This file has no column this recognises as a name. Add a header row with a “Name” column and try again — nothing has been imported.';
  }
  if (!preview.sheet.rows.length) {
    return 'This file has a header and no rows under it, so there is nobody to import.';
  }
  if (!plan.create.length) {
    return 'Every row in this file was refused, so there is nobody to import. The reasons are listed below.';
  }
  return null;
}

/**
 * What the import will do, in one paragraph, before the coach confirms.
 *
 * Every number here is a count of a named list above it, so a coach can check
 * the sentence against the rows. Nothing is rounded and nothing is summarised
 * away: "38 of 40" with the two named is the whole point of a dry run.
 */
export function planSummary(plan: RosterPlan, total: number): string {
  const n = plan.create.length;
  // `total` is the row count of a CSV a gym exported from whatever it used
  // before Repple, so four digits is the ordinary case for a club rather than
  // the far end of one. Both halves of the ratio go through the same formatter:
  // "1,204" beside "1204" in one sentence is the defect this gate is for.
  const parts: string[] = [
    `${num(n)} of ${num(total)} row${total === 1 ? '' : 's'} will be added to your roster.`,
  ];
  if (plan.invite.length) {
    parts.push(`${num(plan.invite.length)} of them will also have an invite recorded against their email address, which links them to you the first time they sign in to Repple with it.`);
  } else {
    parts.push('None of them carries an email address to record an invite against. Your coaching code links a client whoever they are and whatever address they sign up with.');
  }
  if (plan.inviteSkipped.length) {
    parts.push(`${num(plan.inviteSkipped.length)} will be added without an invite, listed below with the reason.`);
  }
  if (plan.rejected.length) {
    parts.push(`${num(plan.rejected.length)} row${plan.rejected.length === 1 ? ' was' : 's were'} refused and will not be imported. Nothing about them is guessed at.`);
  }
  return parts.join(' ');
}

/** What became of one row once the import actually ran. */
export type RowOutcome = 'added' | 'added-not-invited' | 'added-invite-failed' | 'failed';

export interface RosterResult {
  /** Row by row, in the order they were attempted, so a coach can see where a
   *  dropped connection stopped it. */
  rows: { name: string; outcome: RowOutcome }[];
}

/**
 * The report, after the fact.
 *
 * The distinction that earns its place is 'added-invite-failed'. A client on
 * the roster with an invite that was NOT recorded will never link when they
 * sign up, and nothing anywhere tells either side. Folding that into 'added'
 * gives a coach forty green ticks and eight people who quietly never appear.
 */
export function resultSummary(r: RosterResult): string {
  const c = (o: RowOutcome) => r.rows.filter((x) => x.outcome === o).length;
  const added = c('added') + c('added-not-invited') + c('added-invite-failed');
  const failed = c('failed');
  const inviteFailed = c('added-invite-failed');
  const parts: string[] = [];
  parts.push(added
    ? `${added} client${added === 1 ? '' : 's'} added to your roster.`
    : 'Nobody was added to your roster.');
  if (inviteFailed) {
    parts.push(`${inviteFailed} of them ${inviteFailed === 1 ? 'is' : 'are'} on your roster with NO invite recorded, so they will not link to you when they sign in. Send them your coaching code instead.`);
  }
  if (failed) {
    parts.push(`${failed} row${failed === 1 ? '' : 's'} did not save at all and ${failed === 1 ? 'is' : 'are'} not on your roster. ${failed === 1 ? 'It is' : 'They are'} named above — import ${failed === 1 ? 'it' : 'them'} again rather than the whole file.`);
  }
  return parts.join(' ');
}

/**
 * A base64 payload as UTF-8 text.
 *
 * Written out rather than reached for, because there is nowhere to reach.
 * `readFileBase64` in src/ui/nativeModules.ts is what this app has for getting
 * a picked file's bytes, `atob` is not guaranteed present in every JavaScript
 * engine this ships on, and Node's Buffer is not present in any of them. A
 * spreadsheet exported from anywhere in Europe carries accented names in its
 * first column, so decoding the bytes and then decoding the UTF-8 are both
 * required — a byte-per-character read turns "Zoë" into "ZoÃ«" on somebody's
 * roster permanently.
 *
 * Returns null for input that is not base64 at all, which the caller reports as
 * a file it could not read rather than importing an empty roster from it.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToUtf8(input: string): string | null {
  const s = input.replace(/[\r\n\s]/g, '').replace(/=+$/, '');
  if (!s) return '';
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return utf8Decode(bytes);
}

/** UTF-8 bytes as a string. Malformed sequences become U+FFFD rather than
 *  throwing: a spreadsheet with one bad byte in row 300 should import the other
 *  299 rows and show the coach a question mark, not refuse the file. */
function utf8Decode(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let cp: number;
    let len: number;
    if (b < 0x80) { cp = b; len = 1; }
    else if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; len = 2; }
    else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; len = 3; }
    else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; len = 4; }
    else { out += '�'; i += 1; continue; }
    if (i + len > bytes.length) { out += '�'; break; }
    let bad = false;
    for (let k = 1; k < len; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) { bad = true; break; }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (bad) { out += '�'; i += 1; continue; }
    i += len;
    if (cp > 0x10ffff) { out += '�'; continue; }
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      out += String.fromCharCode(cp);
    }
  }
  // A byte-order mark at the start of the file. Excel writes one on every CSV
  // it exports as UTF-8, and left in place it becomes part of the first header
  // cell — so "Name" does not match the `name` alias, the import reports no
  // name column, and the most common spreadsheet in the world is refused.
  return out.charCodeAt(0) === 0xfeff ? out.slice(1) : out;
}
