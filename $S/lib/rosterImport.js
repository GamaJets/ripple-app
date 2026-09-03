"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rosterPlan = rosterPlan;
exports.planBlocker = planBlocker;
exports.planSummary = planSummary;
exports.resultSummary = resultSummary;
exports.base64ToUtf8 = base64ToUtf8;
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
function rosterPlan(preview, screened) {
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
            .map((r) => ({ name: r.row.name, email: r.row.email, reason: r.reason })),
    };
}
/**
 * Why this file cannot be imported at all, or null when it can.
 *
 * A blocker, not a warning. `previewCoachRoster` returns `ready: []` when the
 * name column is missing, and an import that runs on that adds nobody and
 * reports success.
 */
function planBlocker(preview, plan) {
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
function planSummary(plan, total) {
    const n = plan.create.length;
    const parts = [
        `${n} of ${total} row${total === 1 ? '' : 's'} will be added to your roster.`,
    ];
    if (plan.invite.length) {
        parts.push(`${plan.invite.length} of them will also have an invite recorded against their email address, which links them to you the first time they sign in to Repple with it.`);
    }
    else {
        parts.push('None of them carries an email address to record an invite against. Your coaching code links a client whoever they are and whatever address they sign up with.');
    }
    if (plan.inviteSkipped.length) {
        parts.push(`${plan.inviteSkipped.length} will be added without an invite, listed below with the reason.`);
    }
    if (plan.rejected.length) {
        parts.push(`${plan.rejected.length} row${plan.rejected.length === 1 ? ' was' : 's were'} refused and will not be imported. Nothing about them is guessed at.`);
    }
    return parts.join(' ');
}
/**
 * The report, after the fact.
 *
 * The distinction that earns its place is 'added-invite-failed'. A client on
 * the roster with an invite that was NOT recorded will never link when they
 * sign up, and nothing anywhere tells either side. Folding that into 'added'
 * gives a coach forty green ticks and eight people who quietly never appear.
 */
function resultSummary(r) {
    const c = (o) => r.rows.filter((x) => x.outcome === o).length;
    const added = c('added') + c('added-not-invited') + c('added-invite-failed');
    const failed = c('failed');
    const inviteFailed = c('added-invite-failed');
    const parts = [];
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
function base64ToUtf8(input) {
    const s = input.replace(/[\r\n\s]/g, '').replace(/=+$/, '');
    if (!s)
        return '';
    const bytes = [];
    let acc = 0;
    let bits = 0;
    for (const ch of s) {
        const v = B64.indexOf(ch);
        if (v < 0)
            return null;
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
function utf8Decode(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length;) {
        const b = bytes[i];
        let cp;
        let len;
        if (b < 0x80) {
            cp = b;
            len = 1;
        }
        else if ((b & 0xe0) === 0xc0) {
            cp = b & 0x1f;
            len = 2;
        }
        else if ((b & 0xf0) === 0xe0) {
            cp = b & 0x0f;
            len = 3;
        }
        else if ((b & 0xf8) === 0xf0) {
            cp = b & 0x07;
            len = 4;
        }
        else {
            out += '�';
            i += 1;
            continue;
        }
        if (i + len > bytes.length) {
            out += '�';
            break;
        }
        let bad = false;
        for (let k = 1; k < len; k++) {
            const c = bytes[i + k];
            if ((c & 0xc0) !== 0x80) {
                bad = true;
                break;
            }
            cp = (cp << 6) | (c & 0x3f);
        }
        if (bad) {
            out += '�';
            i += 1;
            continue;
        }
        i += len;
        if (cp > 0x10ffff) {
            out += '�';
            continue;
        }
        if (cp > 0xffff) {
            const v = cp - 0x10000;
            out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
        }
        else {
            out += String.fromCharCode(cp);
        }
    }
    // A byte-order mark at the start of the file. Excel writes one on every CSV
    // it exports as UTF-8, and left in place it becomes part of the first header
    // cell — so "Name" does not match the `name` alias, the import reports no
    // name column, and the most common spreadsheet in the world is refused.
    return out.charCodeAt(0) === 0xfeff ? out.slice(1) : out;
}
