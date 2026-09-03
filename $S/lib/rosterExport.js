"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rosterHeader = rosterHeader;
exports.rosterExportBlocker = rosterExportBlocker;
exports.rosterIncompleteWarning = rosterIncompleteWarning;
exports.buildRosterExport = buildRosterExport;
const format_1 = require("./format");
const types_1 = require("./types");
// The CSV writer is not written again here. `csvCell` quotes on every delimiter
// src/lib/csv.ts is willing to sniff — not just the comma — so O'Brien, "Bob"
// Smith and a note with a semicolon in it cannot shift every column after them
// for somebody opening the file in a comma-decimal locale. It also renders null
// as an empty cell rather than as a zero, which is the rule this export needs
// most: a client with no scans must not export as having held their weight.
const gymExport_1 = require("./gymExport");
const units_1 = require("./units");
/** The columns, in the order a coach reads them. The weight column names its
 *  unit, because a column headed "Weight change" is two different numbers
 *  depending on who exported it. */
function rosterHeader(unit) {
    return [
        'Name', 'Goal', 'Delivery', 'Joined', 'Last active',
        'Adherence %', `Weight change (${unit})`, 'Unread messages', 'Injuries disclosed', 'Added by hand',
    ];
}
/** The dash the roster prints where a capped stats read left it with no answer.
 *  U+2014, matching src/ui/kit.tsx's `fig`. */
const UNKNOWN = '—';
function rosterCells(r, unit) {
    return [
        r.name,
        r.goal,
        types_1.COACHED_MODE_SHORT[r.mode],
        // Date only. The time somebody joined a book is not a fact anybody wants in
        // a spreadsheet, and a full timestamp is what makes a column of dates sort
        // as text in Excel.
        (0, gymExport_1.isoDatePart)(r.joinedAt),
        // '—' is the roster's rendering of "we did not find out", and it must not
        // survive into a cell as though it were a reading.
        r.lastActive === UNKNOWN || r.lastActive === '' ? null : r.lastActive,
        r.adherence,
        // The SPAN is converted, not its two ends — see weightDeltaIn. Subtracting
        // two separately rounded pound readings is how a 2.5 kg loss becomes 5 lb
        // one week and 6 lb the next with nothing having changed.
        (0, units_1.weightDeltaIn)(r.weightDeltaKg, unit),
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
function rosterExportBlocker(status, rows) {
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
function rosterIncompleteWarning(status, rows) {
    if (status !== 'partial')
        return null;
    return `This export is INCOMPLETE. Your roster came back at its row limit, so it holds ${(0, format_1.num)(rows)} clients and there are more on your book that were never read. Do not treat this file as your whole roster or count it as the size of it.`;
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
function buildRosterExport(rows, status, unit, on) {
    const warning = rosterIncompleteWarning(status, rows.length);
    const complete = warning === null;
    const header = rosterHeader(unit);
    const body = rows.map((r) => rosterCells(r, unit));
    // The banner is a one-cell row ABOVE the header, so a reader meets it before
    // the data rather than after it. `toCsv` quotes it — it contains commas — and
    // the empty cells keep the row the width of the sheet so a spreadsheet does
    // not treat the file as ragged.
    const csv = complete
        ? (0, gymExport_1.toCsv)(header, body)
        : (0, gymExport_1.toCsv)([warning, ...header.slice(1).map(() => '')], [header, ...body]);
    const stem = complete ? `repple-roster-${on}` : `repple-roster-INCOMPLETE-${on}`;
    const lines = rows.map((r) => {
        const parts = [
            r.goal,
            types_1.COACHED_MODE_SHORT[r.mode],
            r.adherence == null ? 'no check-ins' : `${r.adherence}% adherence`,
            r.lastActive === UNKNOWN || r.lastActive === '' ? 'last seen not recorded' : r.lastActive,
        ];
        return `• ${r.name} — ${parts.join(' · ')}`;
    });
    const text = [
        warning,
        `Your clients (${(0, format_1.num)(rows.length)}) — exported ${on}`,
        ...lines,
    ].filter((x) => !!x).join('\n');
    return { csv, text, filename: `${stem}.csv`, complete, warning };
}
