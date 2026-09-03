"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const intakeSeed_1 = require("./intakeSeed");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const ALL_STATUS = ['loading', 'ready', 'partial', 'error'];
const ALL_SOURCE = [null, 'server', 'restored', 'local'];
/* ── nothing happens while the read is in flight ─────────────────────────── */
{
    for (const s of ALL_SOURCE) {
        eq((0, intakeSeed_1.intakeSeedAction)('loading', s), 'wait', `nothing is seeded while the read is in flight (${String(s)})`);
        eq((0, intakeSeed_1.intakeSaveAllowed)('loading', s), false, `and nothing is sent while it is in flight (${String(s)})`);
        eq((0, intakeSeed_1.intakeBanner)('loading', s), 'loading', `and the sentence says so (${String(s)})`);
    }
}
/* ── the first settled read seeds, whichever way it went ─────────────────── */
{
    eq((0, intakeSeed_1.intakeSeedAction)('ready', null), 'seed', 'the first landed read puts the document on screen');
    eq((0, intakeSeed_1.intakeSeedAction)('error', null), 'seed', 'and a failed one puts the stand-in on screen');
    eq((0, intakeSeed_1.intakeSeedAction)('partial', null), 'seed', 'and a truncated one is still an answer to seed from');
}
/* ── THE ONE. a failed read, then a pull-to-refresh that works ───────────── */
{
    // The member is in a gym reception. The read fails.
    eq((0, intakeSeed_1.intakeSeedAction)('error', null), 'seed', 'the read failed, so a blank stands in for the form');
    eq((0, intakeSeed_1.intakeBanner)('error', 'local'), 'unread', 'and the screen says this is not their form');
    eq((0, intakeSeed_1.intakeSaveAllowed)('error', 'local'), false, 'and Save is withheld');
    // They pull down. The provider goes back through 'loading' to 'ready',
    // carrying their real answers.
    eq((0, intakeSeed_1.intakeSeedAction)('loading', 'local'), 'wait', 'the re-read is in flight');
    eq((0, intakeSeed_1.intakeSeedAction)('ready', 'local'), 'seed', 'A STAND-IN FOR A DOCUMENT THAT COULD NOT BE READ IS REPLACED THE MOMENT IT CAN BE — '
        + 'this is the latch that let Save write a blank over a cardiac disclosure');
    eq((0, intakeSeed_1.intakeSeedAction)('partial', 'local'), 'seed', 'and part of the document beats a blank standing in for all of it');
    // And in the frame between the status flipping and the effect running, the
    // document on screen is still the blank one. It must not be sendable.
    eq((0, intakeSeed_1.intakeSaveAllowed)('ready', 'local'), false, 'A READY STATUS OVER A PHONE-ONLY DOCUMENT IS NOT PERMISSION TO SEND IT');
    eq((0, intakeSeed_1.intakeBanner)('ready', 'local'), 'none', 'the read landed, so the failure sentence goes');
}
/* ── the latch still holds for a seed that came from a read that landed ──── */
{
    for (const s of ['server', 'restored']) {
        for (const st of ['ready', 'partial', 'error']) {
            eq((0, intakeSeed_1.intakeSeedAction)(st, s), 'hold', `what the member has typed on top of a read that landed is never re-seeded (${s}/${st})`);
        }
    }
    eq((0, intakeSeed_1.intakeSeedAction)('error', 'local'), 'hold', 'and a second failure does not re-seed a stand-in over itself');
}
/* ── what may be sent ────────────────────────────────────────────────────── */
{
    eq((0, intakeSeed_1.intakeSaveAllowed)('ready', 'server'), true, 'a document that came back from the server may be sent');
    eq((0, intakeSeed_1.intakeSaveAllowed)('ready', 'restored'), true, 'and so may one restored on top of it');
    eq((0, intakeSeed_1.intakeSaveAllowed)('partial', 'server'), false, 'a document read in part is as unknown, for replacing it, as one not read at all');
    eq((0, intakeSeed_1.intakeSaveAllowed)('error', 'server'), false, 'and a failed re-read withholds the send');
    eq((0, intakeSeed_1.intakeSaveAllowed)('ready', null), false, 'and nothing is sent before anything is seeded');
    for (const st of ALL_STATUS) {
        eq((0, intakeSeed_1.intakeSaveAllowed)(st, 'local'), false, `a phone-only form is never sent (${st})`);
    }
}
/* ── three failures are three different sentences ────────────────────────── */
{
    eq((0, intakeSeed_1.intakeBanner)('error', null), 'unread', 'a failure before anything was read is an unread form');
    eq((0, intakeSeed_1.intakeBanner)('error', 'local'), 'unread', 'and so is a failure over a stand-in');
    eq((0, intakeSeed_1.intakeBanner)('error', 'server'), 'stale', '"this is not your form" is FALSE of a form that was read a moment ago — only the re-read failed');
    eq((0, intakeSeed_1.intakeBanner)('error', 'restored'), 'stale', 'and of one restored on top of it');
    eq((0, intakeSeed_1.intakeBanner)('ready', 'server'), 'none', 'a read that landed says nothing');
    eq((0, intakeSeed_1.intakeBanner)('partial', 'server'), 'none', 'and neither does a truncated one here');
}
if (errors.length) {
    console.error(`intakeSeed: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  ✗ ${e}`);
    process.exit(1);
}
console.log('intakeSeed: ok — a refresh that works can no longer arm a save of a blank');
