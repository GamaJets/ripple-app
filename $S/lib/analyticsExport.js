"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPORT_BASIS = void 0;
exports.monthLabel = monthLabel;
exports.analyticsGapWarning = analyticsGapWarning;
exports.buildAnalyticsExport = buildAnalyticsExport;
exports.analyticsExportBlocker = analyticsExportBlocker;
exports.analyticsShareNote = analyticsShareNote;
const format_1 = require("./format");
const gymExport_1 = require("./gymExport");
const monthlyHistory_1 = require("./monthlyHistory");
/** The month label a person reads — 'Aug 2026' — from a 'YYYY-MM' key. Written
 *  here rather than with `toLocaleDateString` because `new Date('2026-08')` is
 *  UTC and dates the column a month early for nobody but is one more place a
 *  timezone can bite. */
function monthLabel(key) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
    if (!m)
        return key;
    return `${monthlyHistory_1.MONTH_LABELS[Number(m[2]) - 1]} ${m[1]}`;
}
/**
 * The sentence at the top of the file, or null when every read was whole.
 *
 * Names the reads by what they are to the coach ("your roster", "your
 * sessions") rather than by table, because the person opening this in a
 * spreadsheet next March will not remember which screen it came from.
 */
function analyticsGapWarning(reads) {
    const bad = [];
    const say = (s, what) => {
        if (s === 'error')
            bad.push(`${what} could not be read`);
        else if (s === 'partial')
            bad.push(`${what} came back at its row limit, so it is not all of them`);
        else if (s === 'loading')
            bad.push(`${what} had not finished loading`);
    };
    say(reads.roster, 'your roster');
    say(reads.sessions, 'your sessions');
    say(reads.history, 'your recorded months');
    if (!bad.length)
        return null;
    const list = bad.length === 1 ? bad[0] : `${bad.slice(0, -1).join(', ')} and ${bad[bad.length - 1]}`;
    return `INCOMPLETE. When this was exported ${list}. Empty cells below mean the figure is UNKNOWN — they do not mean zero, and a total or an average built over them would be wrong rather than small.`;
}
/** What the figures are, said in the file. A coach mails this on, and by then
 *  the screen's own caveats are not in the room. */
exports.EXPORT_BASIS = 'Sessions are the ones whose outcome you RECORDED as delivered in this calendar month. A booking whose time has passed is not one of them, and a session nobody has marked is counted neither as delivered nor as missed — it is on its own row. The revenue figure is the delivered count multiplied by the session rate on your own profile — it is not what anybody has paid you, it is not net of any fee, and nothing here has been reconciled against Stripe or a bank. Cash and transfers you have recorded are not in it, and neither are packages or subscription renewals: those are on the Money screen.';
/**
 * Build the file.
 *
 * `on` is the coach's own calendar day, ISO, passed in rather than read from
 * the clock — `new Date().toISOString()` is UTC and dates the file the day
 * before for anybody west of Greenwich.
 *
 * Two sections in one file rather than two files, because a phone share sheet
 * takes ONE file: the figures as label/value rows, then the recorded months as
 * their own table underneath. A companion file would be honest in this
 * repository and absent from the coach's email.
 */
function buildAnalyticsExport(snap, reads, on) {
    const warning = analyticsGapWarning(reads);
    const complete = warning === null;
    // The currency is a COLUMN rather than being pasted onto each amount, so the
    // amounts stay numeric and a spreadsheet can add them up. An amount with no
    // currency is still written — it is the coach's own arithmetic on their own
    // rate — and the column says so, which is the honest version of a figure
    // whose unit nobody has set.
    const cur = snap.currency ?? '';
    const rows = [
        ['Exported', on, ''],
        ['Currency', cur || 'not set — amounts below have no unit', ''],
        ['', '', ''],
        ['Sessions delivered this month', snap.sessionsThisMonth, ''],
        ['Sessions this month still to be marked', snap.sessionsUnmarked ?? null, ''],
        ['Revenue at your own session rate', snap.revenueAtOwnRate, cur],
        ['Clients', snap.clients, ''],
        ['Average adherence %', snap.avgAdherencePct, ''],
        ['On track', snap.onTrack, ''],
        ['Watch', snap.watch, ''],
        ['At risk', snap.atRisk, ''],
        ['', '', ''],
        ['Recorded month', 'Revenue at your own session rate', 'Currency'],
        ...snap.months.map((m, i) => [monthLabel(m), snap.history[i] ?? null, snap.history[i] == null ? '' : cur]),
    ];
    const header = ['Figure', 'Value', 'Currency'];
    const csv = complete
        ? (0, gymExport_1.toCsv)(header, [...rows, ['', '', ''], [exports.EXPORT_BASIS, '', '']])
        // The banner is a one-cell row ABOVE the header so a reader meets it before
        // the data. Same shape as the roster export, and the empty cells keep the
        // sheet rectangular.
        : (0, gymExport_1.toCsv)([warning, '', ''], [header, ...rows, ['', '', ''], [exports.EXPORT_BASIS, '', '']]);
    return {
        csv,
        filename: complete ? `repple-analytics-${on}.csv` : `repple-analytics-INCOMPLETE-${on}.csv`,
        complete,
        warning,
    };
}
/**
 * Why there is nothing worth exporting, or null when there is.
 *
 * Stricter than the roster export, and the difference is the point made in the
 * header: a partial ROSTER is a thousand real people and a useful file, but a
 * partial read behind a FIGURE produces a cell that is simply wrong. Under
 * anything but a whole read the figures it fed are already null, so the file is
 * still produced — it is the ones with nothing in them at all that are refused,
 * because a spreadsheet of empty cells is not an export, it is a screenshot of
 * a failure.
 */
function analyticsExportBlocker(reads) {
    if (reads.roster === 'loading' && reads.sessions === 'loading') {
        return 'Still reading your figures. Exporting now would write a file of empty cells.';
    }
    if (reads.roster === 'error' && reads.sessions === 'error') {
        return 'Neither your roster nor your sessions came back, so there is no figure to export. That is unknown rather than zero — try again once you have signal.';
    }
    return null;
}
/** The sentence beside a file that is not the whole picture. Said to the coach
 *  before they share it, because after that it is somebody else's copy. */
function analyticsShareNote(exp, months) {
    const base = `${(0, format_1.num)(months)} recorded ${months === 1 ? 'month' : 'months'} of history ${months === 1 ? 'is' : 'are'} in the file.`;
    return exp.complete ? base : `${exp.warning}\n\n${base}`;
}
