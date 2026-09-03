"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The bullets somebody agrees to and the lines that go are one list.
// Compile with tsc, run with node.
const reportShare_1 = require("./reportShare");
const coachShare_1 = require("./coachShare");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── every kind is described ────────────────────────────────────────────── */
eq(reportShare_1.REPORT_SHARE_BULLETS.length, reportShare_1.REPORT_HEALTH_KINDS.length, 'one bullet per kind');
for (const k of reportShare_1.REPORT_HEALTH_KINDS) {
    const line = reportShare_1.REPORT_SENT_WITH_PERMISSION[k];
    ok(typeof line === 'string' && line.trim().length > 10, `${k} has a sentence somebody can read`);
}
eq(new Set(reportShare_1.REPORT_SHARE_BULLETS).size, reportShare_1.REPORT_SHARE_BULLETS.length, 'no bullet is written twice');
eq(new Set(reportShare_1.REPORT_HEALTH_KINDS).size, reportShare_1.REPORT_HEALTH_KINDS.length, 'no kind is listed twice');
// The drift that happened: the scan and the limb finding went to the model and
// the member was shown three bullets about weight, tape and check-ins.
ok(reportShare_1.REPORT_HEALTH_KINDS.includes('composition'), 'the body-composition scan is a named kind');
ok(reportShare_1.REPORT_HEALTH_KINDS.includes('balance'), 'so is the left/right limb finding');
ok(/visceral|lean|fat mass|water/i.test(reportShare_1.REPORT_SENT_WITH_PERMISSION.composition), 'and the composition bullet says what a scan actually contains, not "body composition"');
ok(/left|right/i.test(reportShare_1.REPORT_SENT_WITH_PERMISSION.balance), 'and the balance bullet says it is a left/right finding');
/* ── it is not the AI Coach's list ──────────────────────────────────────── */
// Borrowing that one would have been the same defect: it names injuries, sleep
// hours, readiness and progress photos, none of which this screen sends.
for (const b of reportShare_1.REPORT_SHARE_BULLETS) {
    ok(!/injur|readiness|progress photo/i.test(b), `the report does not send that, so it must not be listed: ${b}`);
}
ok(coachShare_1.SENT_WITH_PERMISSION.some((b) => /injur/i.test(b)), 'the Coach list does name injuries — which is why the two lists are two lists');
/* ── the lines that actually go ─────────────────────────────────────────── */
const facts = [
    { kind: 'body', line: 'Weight 82 kg (down 1 kg overall), body fat 19%.' },
    { kind: 'waist', line: '' },
    { kind: 'checkin', line: 'Check-in energy 4/5, sleep 3/5, mood 4/5, adherence 5/5.' },
    { kind: 'composition', line: 'Body composition improving: visceral fat.' },
    { kind: 'balance', line: '   ' },
];
eq((0, reportShare_1.reportHealthLines)(facts).length, 3, 'blank and whitespace-only lines are not facts');
ok(!(0, reportShare_1.reportHealthLines)(facts).some((l) => l !== l.trim()), 'and what is left is trimmed');
eq((0, reportShare_1.reportHealthLines)([]).length, 0, 'nothing in, nothing out');
// The assertion the module exists for: nothing can be sent that the member was
// not shown a bullet about.
const present = (0, reportShare_1.kindsPresent)(facts);
eq(present.join(','), 'body,checkin,composition', 'only the kinds with a real line are present');
for (const k of present) {
    ok(reportShare_1.REPORT_SHARE_BULLETS.includes(reportShare_1.REPORT_SENT_WITH_PERMISSION[k]), `${k} is going, so ${k} is on the list the member read`);
}
// Exhaustive the other way: every kind that CAN be produced has a bullet. A
// sixth kind added to the union without a sixth bullet fails to compile; this
// catches a sixth added to the Record and left out of the reading order.
const all = ['body', 'waist', 'checkin', 'composition', 'balance'];
for (const k of all)
    ok(reportShare_1.REPORT_HEALTH_KINDS.includes(k), `${k} is in the reading order`);
eq(Object.keys(reportShare_1.REPORT_SENT_WITH_PERMISSION).length, all.length, 'the Record holds exactly the kinds the reading order does');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('reportShare: ok');
