"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A coach bringing their book across from a spreadsheet. Compile with tsc, run
// with node.
//
// The bugs these guard:
//
//   · an invite reported as sent when the write was refused. A coach's email
//     invite only links a client who signs up with that exact address, so a
//     silent failure is somebody who never appears and a coach with no list of
//     who;
//   · a half-done import reported as done, leaving twelve clients across and
//     twenty-eight nowhere with no way to tell which;
//   · a delivery mode nobody recognised defaulted to 'online', which changes
//     which screens a client gets;
//   · an Excel byte-order mark eating the first header cell, so "Name" does not
//     match and the most common spreadsheet in the world is refused.
const csvImport_1 = require("./csvImport");
const memberInvites_1 = require("./memberInvites");
const rosterImport_1 = require("./rosterImport");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── reading a coach's file ─────────────────────────────────────────────── */
const FILE = [
    'Name,Email,Goal,Delivery',
    'Sam Patel,sam@fit.com,Fat loss,in person',
    'Zoë Adams,zoe@fit.com,Strength,Online',
    'Ben Ito,,,',
    ',nobody@fit.com,,',
    'Ada Lin,ada@fit.com,Rehab,quarterly',
    'Dup Person,sam@fit.com,,hybrid',
].join('\n');
const preview = (0, csvImport_1.previewCoachRoster)(FILE);
eq(preview.missingRequired.length, 0, 'a Name header is found');
eq(preview.ready.length, 3, 'the readable rows are the readable rows');
eq(preview.ready.map((r) => r.name).join(','), 'Sam Patel,Zoë Adams,Ben Ito', 'and they are the right three');
// Only a name is required. A coach's list of names with nothing else is the
// most common file there is, and demanding an email would refuse it.
const bare = preview.ready.find((r) => r.name === 'Ben Ito');
eq(bare.email, null, 'no email is no email, not an empty string');
eq(bare.goal, null, 'and no goal is null, so the roster does not draw a blank line');
eq(bare.mode, 'online', 'a file that says nothing about delivery lands where Add Client starts');
// A mode nobody recognises is REFUSED, never defaulted. Filing an in-person
// client as online changes which screens they get.
const quarterly = preview.rows.find((r) => r.value?.name === 'Ada Lin');
ok(quarterly.errors.some((e) => /quarterly/.test(e)), 'an unrecognised delivery is refused with the word in it');
ok(!preview.ready.some((r) => r.name === 'Ada Lin'), 'and that row does not come across');
// Spellings that ARE unambiguous are read.
eq(preview.ready.find((r) => r.name === 'Sam Patel').mode, 'inperson', '"in person" is in person');
eq(preview.ready.find((r) => r.name === 'Zoë Adams').mode, 'online', 'and case does not matter');
// A row with no name is refused rather than imported as a nameless client.
ok(preview.rejected.some((r) => r.errors.includes('no name')), 'a nameless row is refused');
// A duplicate address in the file itself would invite one person twice.
ok(preview.rejected.some((r) => r.value?.name === 'Dup Person' && r.errors.some((e) => /duplicate of line/.test(e))), 'the second use of one address names the line the first was on');
// Two people can genuinely share a name. Refusing the second would make a coach
// hand-add somebody the file already listed.
const twins = (0, csvImport_1.previewCoachRoster)('Name\nSam Patel\nSam Patel');
eq(twins.ready.length, 2, 'two clients with the same name are two clients');
/* ── the file that cannot be imported at all ────────────────────────────── */
const noName = (0, csvImport_1.previewCoachRoster)('Email,Goal\na@b.com,Strength');
const noNamePlan = (0, rosterImport_1.rosterPlan)(noName, (0, memberInvites_1.screenInvites)(noName.ready));
ok(!!(0, rosterImport_1.planBlocker)(noName, noNamePlan), 'a file with no name column is blocked');
ok(/nothing has been imported/i.test((0, rosterImport_1.planBlocker)(noName, noNamePlan)), 'and says nothing has happened, because an import that adds nobody must not report success');
const headerOnly = (0, csvImport_1.previewCoachRoster)('Name,Email');
ok(!!(0, rosterImport_1.planBlocker)(headerOnly, (0, rosterImport_1.rosterPlan)(headerOnly, (0, memberInvites_1.screenInvites)([]))), 'a header with no rows under it is blocked');
const allBad = (0, csvImport_1.previewCoachRoster)('Name,Delivery\nSam,quarterly');
ok(!!(0, rosterImport_1.planBlocker)(allBad, (0, rosterImport_1.rosterPlan)(allBad, (0, memberInvites_1.screenInvites)(allBad.ready))), 'a file every row of which was refused is blocked');
/* ── the plan, and the asymmetry that matters ───────────────────────────── */
const screened = (0, memberInvites_1.screenInvites)(preview.ready, ['zoe@fit.com']);
const plan = (0, rosterImport_1.rosterPlan)(preview, screened);
// THE asymmetry. An address that is already invited is a reason not to send a
// SECOND invite. It is not a reason to leave somebody off a coach's roster.
eq(plan.create.length, 3, 'every readable row becomes a client');
ok(plan.create.some((r) => r.name === 'Zoë Adams'), 'including the one whose invite is skipped');
eq(plan.invite.length, 1, 'and only the address with no open invite is invited');
eq(plan.invite[0].email, 'sam@fit.com', 'which is the right one');
eq(plan.inviteSkipped.length, 1, 'the skipped invite is reported, never silently dropped');
eq(plan.inviteSkipped[0].email, 'zoe@fit.com', 'naming the address');
ok(plan.inviteSkipped[0].reason.trim().length > 0, 'and the reason');
// A row with no email is not "an invite that was skipped" — there was never one
// to send, and listing it as skipped would make a clean import look damaged.
ok(!plan.inviteSkipped.some((r) => r.name === 'Ben Ito'), 'a client with no address is not a skipped invite');
eq(plan.rejected.length, preview.rejected.length, 'every refused row is carried into the plan');
ok(plan.rejected.every((r) => r.reason.trim().length > 0), 'each with the reason the file gave');
ok(plan.rejected.some((r) => r.line > 1), 'and the line number, so the coach can find it');
/* ── the sentence before the coach confirms ─────────────────────────────── */
const summary = (0, rosterImport_1.planSummary)(plan, preview.rows.length);
ok(/3 of 6 rows/.test(summary), 'the summary counts against the whole file, not against itself');
ok(/1 of them/.test(summary), 'and says how many carry an invite');
ok(/refused/.test(summary), 'and that some rows were refused');
ok(/guessed at/.test(summary), 'restating the rule the whole importer is built on');
// A file with no addresses at all does not read as damaged. It is the ordinary
// case, and the coaching code is the reliable path anyway.
const noEmails = (0, csvImport_1.previewCoachRoster)('Name\nSam\nBen');
const noEmailPlan = (0, rosterImport_1.rosterPlan)(noEmails, (0, memberInvites_1.screenInvites)(noEmails.ready));
const noEmailSummary = (0, rosterImport_1.planSummary)(noEmailPlan, noEmails.rows.length);
ok(/coaching code/.test(noEmailSummary), 'a file with no addresses is pointed at the code instead');
ok(!/refused/.test(noEmailSummary), 'and is not described as having anything wrong with it');
/* ── the report afterwards, and the outcome that must not be folded away ── */
const result = {
    rows: [
        { name: 'Sam', outcome: 'added' },
        { name: 'Ben', outcome: 'added-not-invited' },
        { name: 'Zoe', outcome: 'added-invite-failed' },
        { name: 'Ada', outcome: 'failed' },
    ],
};
const report = (0, rosterImport_1.resultSummary)(result);
eq(/3 clients added/.test(report), true, 'everyone who reached the roster is counted as added');
// THE one. A client on the roster whose invite was NOT recorded will never link
// when they sign up, and nothing anywhere tells either side. Folding it into
// "added" gives a coach green ticks and people who quietly never appear.
ok(/NO invite recorded/.test(report), 'a failed invite is named, not counted as a success');
ok(/coaching code/.test(report), 'and the coach is told the thing that still works');
// And the half-done case: which rows, so they re-import the remainder.
ok(/did not save at all/.test(report), 'a row that never landed is named as such');
ok(/rather than the whole file/.test(report), 'and the coach is told to import only those');
const clean = (0, rosterImport_1.resultSummary)({ rows: [{ name: 'Sam', outcome: 'added' }] });
ok(/1 client added/.test(clean), 'a clean import counts in the singular');
ok(!/NO invite|did not save/.test(clean), 'and carries no warnings it has not earned');
const nothing = (0, rosterImport_1.resultSummary)({ rows: [] });
ok(/Nobody was added/.test(nothing), 'an import that added nobody says so plainly');
/* ── the bytes, which is where an accented name is lost ─────────────────── */
const b64 = (s) => {
    // A local encoder, so the decoder is tested against something other than
    // itself. Node's Buffer is deliberately not used: it does not exist in the
    // engine this ships on, which is the whole reason base64ToUtf8 was written.
    const utf8 = [];
    for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (cp < 0x80)
            utf8.push(cp);
        else if (cp < 0x800)
            utf8.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
        else if (cp < 0x10000)
            utf8.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        else
            utf8.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < utf8.length; i += 3) {
        const [a, b, c] = [utf8[i], utf8[i + 1], utf8[i + 2]];
        out += A[a >> 2];
        out += A[((a & 3) << 4) | ((b ?? 0) >> 4)];
        out += b === undefined ? '=' : A[((b & 15) << 2) | ((c ?? 0) >> 6)];
        out += c === undefined ? '=' : A[c & 63];
    }
    return out;
};
eq((0, rosterImport_1.base64ToUtf8)(b64('Name,Email')), 'Name,Email', 'plain ASCII survives');
// A spreadsheet exported anywhere in Europe has accented names in column one.
// A byte-per-character read turns Zoë into ZoÃ« on somebody's roster forever.
eq((0, rosterImport_1.base64ToUtf8)(b64('Zoë Adams')), 'Zoë Adams', 'an accented name is read as itself');
eq((0, rosterImport_1.base64ToUtf8)(b64('Ünal Öz, Škoda, 北京')), 'Ünal Öz, Škoda, 北京', 'so are two- and three-byte characters');
eq((0, rosterImport_1.base64ToUtf8)(b64('Sam 🏋️ Patel')), 'Sam 🏋️ Patel', 'and four-byte ones, as a surrogate pair');
eq((0, rosterImport_1.base64ToUtf8)(''), '', 'an empty payload is an empty file, not a failure');
eq((0, rosterImport_1.base64ToUtf8)(b64('a\nb\nc')), 'a\nb\nc', 'newlines survive, which is the entire file format');
// Excel writes a byte-order mark on every UTF-8 CSV it exports. Left in place
// it becomes part of the first header cell, "Name" stops matching the alias,
// and the most common spreadsheet in the world is refused.
const withBom = (0, rosterImport_1.base64ToUtf8)(b64('﻿Name,Email\nSam,sam@fit.com'));
ok(withBom.startsWith('Name'), 'a byte-order mark is stripped');
eq((0, csvImport_1.previewCoachRoster)(withBom).missingRequired.length, 0, 'so an Excel export finds its name column');
// Bytes that are not base64 are a file this cannot read, which the caller
// reports as such rather than importing an empty roster from it.
eq((0, rosterImport_1.base64ToUtf8)('not base64!!'), null, 'a payload that is not base64 is refused');
eq((0, rosterImport_1.base64ToUtf8)('%%%%'), null, 'and so is one made of characters outside the alphabet');
// Whitespace and padding are ordinary and must not be.
eq((0, rosterImport_1.base64ToUtf8)('TmFtZQ=='), 'Name', 'padding is fine');
eq((0, rosterImport_1.base64ToUtf8)('TmFt\nZQ=='), 'Name', 'and so are line breaks inside the payload');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('rosterImport: ok');
