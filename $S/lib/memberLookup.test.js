"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The number on the member's screen, looked up at the desk.
//
// ── The five this file exists to stop ─────────────────────────────────────
//
//   1. THE NUMBER DRIFTING FROM THE ONE THE MEMBER IS HOLDING. There must be
//      exactly one implementation of it. The assertion compares this module's
//      body against `memberNoFrom` called the way app/(client)/access.tsx calls
//      it — with a name, and with a brand — and requires the tail to be equal.
//
//   2. A PREFIX BEING COMPARED. Two members of one gym can hold "RUO-…" and
//      "REP-…" for the same person's number, because `memberPrefix` reads the
//      brand label the READING DEVICE has cached. Either must find them.
//
//   3. THE WRONG PERSON CHECKED IN. membership.ts states that the hash is not
//      unique. Two people on one roster sharing a number must produce a choice,
//      never a person.
//
//   4. A MEMBER TURNED AWAY OVER A READ THAT DID NOT COME BACK. "Nobody has
//      that number" over a failed or truncated roster is somebody refused entry
//      to a gym they pay for.
//
//   5. A NAME TREATED AS A NUMBER. Nine letters is a plausible surname. A bare
//      nine characters that matches nobody must fall through to the name search
//      silently, and only a PREFIXED number may say "nobody has that".
//
// Compile with tsc, run with node.
const memberLookup_1 = require("./memberLookup");
const membership_1 = require("./membership");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const SARA = 'e3c1a9f0-1111-4222-8333-444455556666';
const MAREK = '7b2d55aa-2222-4333-8444-555566667777';
/* ── 1. one implementation of the number ────────────────────────────────── */
{
    // Exactly the call app/(client)/access.tsx makes: the member's name, their
    // id, and whatever their device calls the app.
    const onPhone = (0, membership_1.memberNoFrom)('Sara Okafor', SARA, 'Ruoni Fitness');
    const body = (0, memberLookup_1.memberNoBody)(SARA);
    ok(!!body, 'a member has a number body');
    eq(onPhone.slice(onPhone.indexOf('-') + 1), body, 'the desk computes the same body the member is holding');
    eq(onPhone.slice(0, 4), 'RUO-', 'and the phone’s prefix is the gym’s, which is what the member sees');
    // 2. The same body whatever the phone had cached as the brand.
    const beforeTheGymNameArrived = (0, membership_1.memberNoFrom)('Sara Okafor', SARA, 'Repple');
    eq(beforeTheGymNameArrived.slice(4), String(body), 'a member whose app has not read the gym name yet holds the same body');
    ok(beforeTheGymNameArrived.slice(0, 4) !== onPhone.slice(0, 4), 'with a different prefix — which is why nothing here compares prefixes');
    // The name is not part of the number when there is an id, which is what makes
    // a console-side lookup possible at all: the console has the id, and does not
    // have the string the member's own device thinks their name is.
    eq((0, membership_1.memberNoFrom)('Sara Okafor', SARA, 'Repple'), (0, membership_1.memberNoFrom)('S. Okafor', SARA, 'Repple'), 'a member who changed their name still has the same number');
    eq((0, memberLookup_1.memberNoBody)(''), null, 'no id is no number');
    eq((0, memberLookup_1.memberNoBody)(null), null, 'and a missing id is answered rather than thrown at');
    eq((0, memberLookup_1.memberNoFor)(SARA, 'Ruoni Fitness'), onPhone, 'the number this gym’s app prints, for reading back');
    eq((0, memberLookup_1.memberNoFor)(null, 'Ruoni Fitness'), null, 'and nothing for nobody');
}
/* ── what a scanner and a person actually type ──────────────────────────── */
{
    const body = String((0, memberLookup_1.memberNoBody)(SARA));
    const full = `RUO-${body}`;
    eq((0, memberLookup_1.readScan)(full).shape, 'numbered', 'the number as printed');
    eq((0, memberLookup_1.readScan)(full).body, body, 'reads as its body');
    eq((0, memberLookup_1.readScan)(`  ${full}\t`).body, body, 'with whatever whitespace the reader adds');
    eq((0, memberLookup_1.readScan)(`*${full}*`).body, body, 'and the Code 39 start and stop characters stripped');
    eq((0, memberLookup_1.readScan)(full.toLowerCase()).body, body, 'typed in lower case by somebody at a keyboard');
    eq((0, memberLookup_1.readScan)(`RUO ${body}`).body, body, 'with a space where the hyphen is');
    eq((0, memberLookup_1.readScan)(`RUO${body}`).shape, 'text', 'but not run together — that is nowhere on the member’s screen and could be anything');
    eq((0, memberLookup_1.readScan)('').shape, 'blank', 'an empty box is not a failed lookup');
    eq((0, memberLookup_1.readScan)('   ').shape, 'blank', 'nor is a space');
    eq((0, memberLookup_1.readScan)('Sara Okafor').shape, 'text', 'a name is a name');
    eq((0, memberLookup_1.readScan)('Sara').shape, 'text', 'even a short one');
    // 5. Nine characters that could be either.
    eq((0, memberLookup_1.readScan)('WHITFIELD').shape, 'bare', 'and nine letters is only MAYBE a number');
}
/* ── the lookup ─────────────────────────────────────────────────────────── */
const ROSTER = [
    { id: SARA, name: 'Sara Okafor' },
    { id: MAREK, name: 'Marek Kowalski' },
];
const BODY = String((0, memberLookup_1.memberNoBody)(SARA));
{
    const found = (0, memberLookup_1.findByMemberNo)(`RUO-${BODY}`, ROSTER, 'ready');
    eq(found.kind, 'one', 'the number finds the member');
    eq(found.person?.name, 'Sara Okafor', 'and it is the right one');
    eq((0, memberLookup_1.scanNote)(found), null, 'with nothing to say about it');
    // 2, at the lookup rather than at the parse: the gym renamed itself, or the
    // member's phone has not caught up. Same person either way.
    eq((0, memberLookup_1.findByMemberNo)(`REP-${BODY}`, ROSTER, "ready").person?.id, SARA, 'and the prefix the member’s device happened to draw does not matter');
    eq((0, memberLookup_1.findByMemberNo)(`MEM-${BODY}`, ROSTER, "ready").person?.id, SARA, 'including the fallback prefix a non-Latin brand name produces');
    eq((0, memberLookup_1.findByMemberNo)(BODY, ROSTER, 'ready').kind, 'one', 'a bare body that matches is still the member — a scanner may drop the prefix');
    eq((0, memberLookup_1.findByMemberNo)('', ROSTER, 'ready').kind, 'blank', 'an empty box is blank');
    eq((0, memberLookup_1.findByMemberNo)('Sara', ROSTER, 'ready').kind, 'name', 'and a name goes to the name search');
}
/* ── 3. two people, one number ──────────────────────────────────────────── */
{
    // Contrived deliberately: the ids differ, and this asserts the behaviour of
    // the CONSOLE when membership.ts's own warning comes true, which is not
    // something a real roster can be relied on to demonstrate.
    const twins = [
        { id: SARA, name: 'Sara Okafor' },
        { id: SARA, name: 'Sara Okafor (second membership)' },
    ];
    const r = (0, memberLookup_1.findByMemberNo)(`RUO-${BODY}`, twins, 'ready');
    eq(r.kind, 'ambiguous', 'two people with one number is a question, not an answer');
    eq(r.people?.length, 2, 'and both are offered');
    ok(/2 members share that number/.test(String((0, memberLookup_1.scanNote)(r))), 'the desk is told why nobody was chosen');
    ok(!/not on this roster/.test(String((0, memberLookup_1.scanNote)(r))), 'and not told the wrong thing');
    eq((0, memberLookup_1.indexByMemberNo)(twins).get(BODY)?.length, 2, 'the index keeps both rather than the last one');
    eq((0, memberLookup_1.indexByMemberNo)([{ id: '', name: 'nobody' }]).size, 0, 'and a row with no id is indexed under nothing');
}
/* ── 4 and 5. what may be said when nothing matched ─────────────────────── */
{
    const stranger = 'RUO-000000000';
    ok(!(0, memberLookup_1.indexByMemberNo)(ROSTER).has('000000000'), 'nobody on this roster has that body');
    const whole = (0, memberLookup_1.findByMemberNo)(stranger, ROSTER, 'ready');
    eq(whole.kind, 'unknown', 'over a whole roster, a number matching nobody is said out loud');
    ok(/Nobody on this roster/.test(String((0, memberLookup_1.scanNote)(whole))), 'in those words');
    for (const state of ['failed', 'partial', 'loading']) {
        const r = (0, memberLookup_1.findByMemberNo)(stranger, ROSTER, state);
        eq(r.kind, 'unsure', `a ${state} roster proves nothing about a number`);
        eq(r.state, state, 'and it carries which of the three it was');
        ok(!/Nobody on this roster/.test(String((0, memberLookup_1.scanNote)(r))), `nobody is turned away on a ${state} read`);
    }
    // Three reads, three sentences. A single hedged line for all of them would
    // send the desk to the same wrong action in two of the three cases.
    const said = ['failed', 'partial', 'loading']
        .map((st) => (0, memberLookup_1.scanNote)((0, memberLookup_1.findByMemberNo)(stranger, ROSTER, st)));
    eq(new Set(said).size, 3, 'and the three are three different sentences');
    // 5: nine characters nobody has is a name, not a stranger's card.
    eq((0, memberLookup_1.findByMemberNo)('WHITFIELD', ROSTER, 'ready').kind, 'name', 'nine letters matching nobody is a surname, and goes quietly to the name search');
    eq((0, memberLookup_1.scanNote)((0, memberLookup_1.findByMemberNo)('WHITFIELD', ROSTER, 'ready')), null, 'with nothing said about it at all');
    eq((0, memberLookup_1.findByMemberNo)('WHITFIELD', ROSTER, 'failed').kind, 'name', 'and that is true whatever the roster read did');
}
/* ── an empty roster is not a wrong number ──────────────────────────────── */
{
    eq((0, memberLookup_1.findByMemberNo)(`RUO-${BODY}`, [], 'ready').kind, 'unknown', 'a gym with nobody on its roster has nobody with that number, which is true');
    eq((0, memberLookup_1.findByMemberNo)(`RUO-${BODY}`, [], 'failed').kind, 'unsure', 'and a gym whose roster did not read has said nothing at all');
}
if (errors.length) {
    console.error(`memberLookup: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  · ${e}`);
    process.exit(1);
}
console.log('memberLookup: ok');
