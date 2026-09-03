"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A member's quiet hours. Compile with tsc, run with node.
//
// The assertion this file exists for is the last block: a half-saved window is
// never reported as saved, and the half that failed is named. Everything above
// it is the promise that one window means one thing to the person setting it,
// even though the product applies it two different ways.
const clientQuiet_1 = require("./clientQuiet");
const notifyPrefs_1 = require("./notifyPrefs");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const prefs = (over = {}) => ({ ...notifyPrefs_1.DEFAULT_NOTIFY_PREFS, ...over });
const server = (fromHour = 22, toHour = 7) => ({ fromHour, toHour, tz: 'Europe/London' });
/* ── which window is shown ─────────────────────────────────────────────── */
const none = (0, clientQuiet_1.quietView)(prefs(), null);
eq(none.fromHour, null, 'nobody who has set nothing is shown a window');
eq(none.source, 'neither', 'and the screen is told that is what it is');
eq(none.note, null, 'with nothing to explain');
// The state every member is in today: the old screen let them set device quiet
// hours and nothing has ever offered them the remote half.
const deviceOnly = (0, clientQuiet_1.quietView)(prefs({ quiet: true, quietFromHour: 23, quietToHour: 6 }), null);
eq(deviceOnly.fromHour, 23, 'a device-only window is shown');
eq(deviceOnly.source, 'device-only', 'and named as such');
ok(/do not stop anything sent to you/.test(deviceOnly.note ?? ''), 'and the note says the half they have not got — which is the half their coach uses');
// A new handset on an account that already has a window.
const serverOnly = (0, clientQuiet_1.quietView)(prefs(), server(21, 8));
eq(serverOnly.fromHour, 21, 'an account window is shown on a phone that has none');
eq(serverOnly.source, 'server-only', 'and named');
ok(/already stopping anything sent to you/.test(serverOnly.note ?? ''), 'and says the half that is already working');
/* ── and which one wins ────────────────────────────────────────────────── */
//
// The account's. The device half is per handset and says so; the account half
// follows the person, and it is the one that stops what other people send.
const both = (0, clientQuiet_1.quietView)(prefs({ quiet: true, quietFromHour: 23, quietToHour: 6 }), server(22, 7));
eq(both.fromHour, 22, 'the account’s hours are shown when the two disagree');
eq(both.toHour, 7, 'both ends of them');
eq(both.source, 'both', 'and the screen knows there are two');
ok(/different hours/.test(both.note ?? ''), 'and the disagreement is said out loud, not resolved silently');
const agree = (0, clientQuiet_1.quietView)(prefs({ quiet: true, quietFromHour: 22, quietToHour: 7 }), server(22, 7));
eq(agree.source, 'both', 'two copies that agree are still two copies');
eq(agree.note, null, 'but there is nothing to say about them');
// Quiet OFF on the device is not a window. `NotifyPrefs` carries hours whether
// or not the switch is on — the defaults are 22 and 7 — and reading those as a
// choice would show every member a window they never set.
const offButStored = (0, clientQuiet_1.quietView)(prefs({ quiet: false, quietFromHour: 1, quietToHour: 5 }), null);
eq(offButStored.source, 'neither', 'hours held behind an off switch are not a window');
eq(offButStored.fromHour, null, 'and nothing is shown');
/* ── the preview cannot disagree with either half ──────────────────────── */
//
// One piece of arithmetic, `hourInWindow`, which is where notifyPrefs and the
// notify_quiet_now view both get theirs. Two copies is how a member comes to be
// quiet at eleven for one kind and not the other.
const w = (0, clientQuiet_1.quietView)(prefs(), server(22, 7));
eq((0, clientQuiet_1.quietNow)(23, w), true, '23:00 is inside 22 to 7');
eq((0, clientQuiet_1.quietNow)(2, w), true, 'and so is 02:00, past midnight');
eq((0, clientQuiet_1.quietNow)(7, w), false, 'the end is exclusive, so 07:00 is not');
eq((0, clientQuiet_1.quietNow)(21, w), false, 'and neither is the hour before it starts');
eq((0, clientQuiet_1.quietNow)(23, none), false, 'a member with no window is never inside one');
const zero = (0, clientQuiet_1.quietView)(prefs(), server(9, 9));
eq((0, clientQuiet_1.quietNow)(9, zero), false, 'a zero-length window is no quiet hours, not twenty-four of them');
/* ── what the screen has to say ────────────────────────────────────────── */
//
// Two effects, because they ARE two: this app's own reminders wait, and
// anything sent to the member does not arrive at all. A member who believed
// their coach's 11pm message would be delivered at 7am would go looking for a
// message that is sitting in their notifications list.
ok(/wait and arrive/.test(clientQuiet_1.QUIET_LOCAL_EFFECT), 'the local half says the reminder waits');
ok(/Nothing is dropped/.test(clientQuiet_1.QUIET_LOCAL_EFFECT), 'and that nothing is lost');
ok(/does not buzz at all/.test(clientQuiet_1.QUIET_REMOTE_EFFECT), 'the remote half says it does not arrive');
ok(/still written into your notifications/.test(clientQuiet_1.QUIET_REMOTE_EFFECT), 'and says where it is instead — which is what makes suppressing it safe to offer');
ok(!/wait/.test(clientQuiet_1.QUIET_REMOTE_EFFECT), 'and never promises the remote half waits, because nothing holds a push');
// The cost, named before the choice. The exact case is a coach calling off an
// early class late at night: the server suppresses on the hour and knows
// nothing about when the session is.
ok(/6am/.test(clientQuiet_1.QUIET_COST) && /eleven/.test(clientQuiet_1.QUIET_COST), 'the cost names the case rather than warning in general');
ok(/still come through/.test(clientQuiet_1.QUIET_COST), 'and says which reminders are exempt, so the sentence is not simply frightening');
ok(/timezone this phone was in when you saved/.test(clientQuiet_1.QUIET_ZONE_KEPT), 'the zone note says the zone is the stored one and not the current one');
/* ── a half-saved window is never a saved one ──────────────────────────── */
//
// The two writes fail differently. AsyncStorage effectively always succeeds; the
// account write is a PostgREST upsert counted from the rows it handed back. So
// the ordinary partial outcome is "this phone is quiet and nothing sent to you
// is" — most of what the member asked for, missing — and reporting that as
// saved is the one thing a settings screen must not do.
const bothOk = (0, clientQuiet_1.quietSaveNote)({ device: true, server: true });
eq(bothOk.saved, true, 'both halves landing is saved');
ok(/anything sent to you/.test(bothOk.note), 'and says both halves are in force');
const halfA = (0, clientQuiet_1.quietSaveNote)({ device: true, server: false });
eq(halfA.saved, false, 'the phone alone is not saved');
ok(/Only half/.test(halfA.note), 'and says so');
ok(/your coach, your gym, a payment/.test(halfA.note), 'naming what is still going to buzz');
const halfB = (0, clientQuiet_1.quietSaveNote)({ device: false, server: true });
eq(halfB.saved, false, 'the account alone is not saved either');
ok(/still arrive in the night/.test(halfB.note), 'and names the other half’s consequence');
ok(halfA.note !== halfB.note, 'the two halves are two sentences — a shared one would be wrong under one of them');
const neither = (0, clientQuiet_1.quietSaveNote)({ device: false, server: false });
eq(neither.saved, false, 'nothing landing is nothing saved');
ok(/unchanged/.test(neither.note), 'and the member is told their setting did not move');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('clientQuiet: ok — one window, two effects both stated, and no half-write reported as a save');
