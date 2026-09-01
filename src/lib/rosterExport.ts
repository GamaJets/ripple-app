// A coach's book, out of Repple and into a spreadsheet.
//
// The least dangerous of the bulk actions and the one that is asked for most:
// an accountant wants a client list, a coach moving gyms wants their own
// contacts, somebody wants to sort thirty people by adherence in a way no phone
// screen will ever do. Nothing here writes anything and nothing here leaves the
// coach's own book.
//
// ── A completeness claim over a read that can truncate is a lie ────────────
//
// This is the rule the console's `/export` learned the expensive way, and it is
// written out at the top of src/lib/gymExport.ts: an export is a promise, and a
// partial one is a broken promise. A file named `roster.csv` holding a thousand
// of a coach's twelve hundred clients is not a smaller answer to "give me my
// roster" — it is a different and false answer, and it is false in the
// direction nobody checks. The coach opens it, counts a thousand rows, and has
// no reason on earth to think there were more.
//
// The roster provider already knows: `status` is 'partial' when the read came
// back at its row limit (src/lib/rowCap.ts). So this module refuses to produce
// a file that quietly drops the difference, and does it three ways at once,
// because the coach only has to miss one:
//
//   1. the FILENAME carries INCOMPLETE, so it is still true after the file has
//      been mailed on and nobody remembers the screen it came from;
//   2. the file's FIRST LINE is a sentence saying what is missing and what that
//      costs — above the header row, so it cannot be scrolled past;
//   3. the share TEXT beside the file says the same thing, for the case where
//      the build cannot attach a file at all (see src/lib/exportShare.ts:
//      `fileShareBlocker`) and the rows go as a message instead.
//
// Under 'error' or 'loading' there is no file. An empty roster under a failed
// read is not an empty book, and a CSV with a header row and nothing under it
// is the most convincing possible statement that a coach has no clients.
//
// ── Why the banner row rather than a second file ──────────────────────────
//
// gymExport writes a README and a manifest beside the CSVs, which is right for
// a bundle downloaded in a browser. A phone share sheet takes ONE file, so a
// companion README is a file that does not travel — it would be honest in this
// repository and absent from the coach's email. Putting the sentence in cell A1
// costs the file its "header on row 1" shape, which is a real cost and is
// accepted deliberately: this is an export for a person to read, not an import
// format, and nothing in this app re-reads it. A complete export has no banner
// at all, so the ordinary file is an ordinary CSV.
//
// Pure, and framework-free apart from the CSV writer it borrows. Everything
// here takes rows a screen has already loaded and returns text.
import type { LoadStatus } from '../ui/loadStatus';
import { num } from './format';
import type { CoachedMode } from './types';
import { COACHED_MODE_SHORT } from './types';
// The CSV writer is not written again here. `csvCell` quotes on every delimiter
// src/lib/csv.ts is willing to sniff — not just the comma — so O'Brien, "Bob"
// Smith and a note with a semicolon in it cannot shift every column after them
// for somebody opening the file in a comma-decimal locale. It also renders null
// as an empty cell rather than as a zero, which is the rule this export needs
// most: a client with no scans must not export as having held their weight.
import { toCsv, isoDatePart, type Cell } from './gymExport';
import { weightDeltaIn, type WeightUnit } from './units';

/** One client, as the export needs to see them. Deliberately not `RosterClient`
 *  itself: this module is pure and assertable, and the roster row carries scan
 *  metrics, allergens and injury objects that have no column here. */
export interface RosterExportRow {
  name: string;
  goal: string;
  mode: CoachedMode;
  /** ISO timestamp of when they joined this coach's book, or null. */
  joinedAt: string | null;
  /**
   * What the roster shows for last activity — "3d ago", "no activity yet", or
   * '—' where the stats read was capped and the answer is unknown.
   *
   * The dash is mapped to an EMPTY cell below rather than exported as a dash.
   * In a spreadsheet an em dash is a value somebody can sort on and filter for;
   * empty is the only cell that means "the gym never recorded this", and that
   * is what a capped stats page actually left behind.
   */
  lastActive: string;
  /** 0–100, or null where they have never submitted a check-in. Never 0 for
   *  "unknown": 0% adherence is a statement about a person. */
  adherence: number | null;
  /** Change in body weight across their scans, in KILOGRAMS as stored. Null
   *  until there are two scans to subtract. Converted on the way out. */
  weightDeltaKg: number | null;
  /** Unread messages from them, or null when the count could not be read. */
  unread: number | null;
  /** Live disclosures — areas only. The note a client wrote about their own
   *  injury is theirs and does not travel into a spreadsheet; see the injury
   *  privacy rule the coach app already holds. */
  injuryAreas: string[];
  /** True when this row is a `coach_clients` note with no Repple account
   *  behind it. Exported, because every blank figure on such a row is blank
   *  for that reason and not because the person is inactive. */
  handAdded: boolean;
}

/** The columns, in the order a coach reads them. The weight column names its
 *  unit, because a column headed "Weight change" is two different numbers
 *  depending on who exported it. */
export function rosterHeader(unit: WeightUnit): string[] {
  return [
    'Name', 'Goal', 'Delivery', 'Joined', 'Last active',
    'Adherence %', `Weight change (${unit})`, 'Unread messages', 'Injuries disclosed', 'Added by hand',
  ];
}

/** The dash the roster prints where a capped stats read left it with no answer.
 *  U+2014, matching src/ui/kit.tsx's `fig`. */
const UNKNOWN = '—';

function rosterCells(r: RosterExportRow, unit: WeightUnit): Cell[] {
  return [
    r.name,
    r.goal,
    COACHED_MODE_SHORT[r.mode],
    // Date only. The time somebody joined a book is not a fact anybody wants in
    // a spreadsheet, and a full timestamp is what makes a column of dates sort
    // as text in Excel.
    isoDatePart(r.joinedAt),
    // '—' is the roster's rendering of "we did not find out", and it must not
    // survive into a cell as though it were a reading.
    r.lastActive === UNKNOWN || r.lastActive === '' ? null : r.lastActive,
    r.adherence,
    // The SPAN is converted, not its two ends — see weightDeltaIn. Subtracting
    // two separately rounded pound readings is how a 2.5 kg loss becomes 5 lb
    // one week and 6 lb the next with nothing having changed.
    weightDeltaIn(r.weightDeltaKg, unit),
    r.unread,
    // Areas, joined. csvCell quotes it, so a comma between two areas cannot
    // become a column break.
    r.injuryAreas.length ? r.injuryAreas.join(', ') : null,
    // A boolean, which csvCell renders 'yes'/'no'. Not blank-for-false: this
    // column answers a question about every row, so a blank would read as
    // unknown.
    r.handAdded,
  ];
}

/* ── whether there is a file to make at all ────────────────────────────────── */

/**
 * Why this roster cannot be exported, or null when it can.
 *
 * 'partial' is NOT a blocker. A thousand real clients is a genuinely useful
 * file and refusing it would take a working export away to protect a claim
 * nobody made — the claim is removed instead, by everything `buildRosterExport`
 * does under that status. That is the split src/lib/rowCap.ts draws between a
 * capped read feeding a FIGURE and a capped read feeding a LIST.
 */
export function rosterExportBlocker(status: LoadStatus, rows: number): string | null {
  if (status === 'error') {
    return 'Your roster could not be read, so there is nothing to export. An empty list here means the read failed rather than that you have no clients — try again once you have signal.';
  }
  if (status === 'loading') {
    return 'Still reading your roster. Exporting now would write out whoever has loaded so far and call it your book.';
  }
  if (rows === 0) {
    return 'You have no clients to export yet. Add or invite somebody and they will be in the file.';
  }
  return null;
}

/** The sentence that goes in cell A1, in the share text, and nowhere else —
 *  null when the export really is the whole book. */
export function rosterIncompleteWarning(status: LoadStatus, rows: number): string | null {
  if (status !== 'partial') return null;
  return `This export is INCOMPLETE. Your roster came back at its row limit, so it holds ${num(rows)} clients and there are more on your book that were never read. Do not treat this file as your whole roster or count it as the size of it.`;
}

export interface RosterExport {
  /** The CSV, with its banner row when there is one to carry. */
  csv: string;
  /** The same thing as lines of text, for a build that cannot attach a file. */
  text: string;
  /** Carries INCOMPLETE when it has to. */
  filename: string;
  /** True only when every client on the book is in the file. */
  complete: boolean;
  /** The sentence to put in front of the coach before they share. Null when
   *  complete. */
  warning: string | null;
}

/**
 * Build the file.
 *
 * `on` is the day it was generated, ISO — passed in rather than read from the
 * clock so the output is assertable and so a caller can date it in the coach's
 * own timezone rather than in UTC. See src/lib/localDate.ts for why that is not
 * a nicety: `new Date('2026-08-01')` is UTC midnight, which is the day before
 * for anybody west of Greenwich.
 *
 * Callers must have passed `rosterExportBlocker` first; this builds whatever it
 * is given, because a builder that silently returned an empty string for an
 * unread roster would be the same silence one layer down.
 */
export function buildRosterExport(
  rows: readonly RosterExportRow[],
  status: LoadStatus,
  unit: WeightUnit,
  on: string,
): RosterExport {
  const warning = rosterIncompleteWarning(status, rows.length);
  const complete = warning === null;
  const header = rosterHeader(unit);
  const body = rows.map((r) => rosterCells(r, unit));
  // The banner is a one-cell row ABOVE the header, so a reader meets it before
  // the data rather than after it. `toCsv` quotes it — it contains commas — and
  // the empty cells keep the row the width of the sheet so a spreadsheet does
  // not treat the file as ragged.
  const csv = complete
    ? toCsv(header, body)
    : toCsv([warning as string, ...header.slice(1).map(() => '')], [header, ...body]);

  const stem = complete ? `repple-roster-${on}` : `repple-roster-INCOMPLETE-${on}`;

  const lines = rows.map((r) => {
    const parts = [
      r.goal,
      COACHED_MODE_SHORT[r.mode],
      r.adherence == null ? 'no check-ins' : `${r.adherence}% adherence`,
      r.lastActive === UNKNOWN || r.lastActive === '' ? 'last seen not recorded' : r.lastActive,
    ];
    return `• ${r.name} — ${parts.join(' · ')}`;
  });
  const text = [
    warning,
    `Your clients (${num(rows.length)}) — exported ${on}`,
    ...lines,
  ].filter((x): x is string => !!x).join('\n');

  return { csv, text, filename: `${stem}.csv`, complete, warning };
}
