"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUIET_ZONE_KEPT = exports.QUIET_COST = exports.QUIET_REMOTE_EFFECT = exports.QUIET_LOCAL_EFFECT = void 0;
exports.quietSaveNote = quietSaveNote;
exports.quietView = quietView;
exports.quietNow = quietNow;
// A member's quiet hours, which this product already applies and has never
// offered.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// `notify_quiet_hours` (part 530) is keyed on `user_id`, its RLS policy is
// `nqh_self` on the `authenticated` role with `user_id = auth.uid()`, and the
// view that reads it — `notify_quiet_now` — knows nothing about roles. Both
// senders honour it for WHOEVER the recipient turns out to be:
// supabase/functions/send-push filters every recipient id against that view,
// and supabase/functions/notify-message applies it to `recipient`, which is the
// CLIENT whenever the sender is a coach. `notify_quiet_hours_rollout.enforced`
// is true in production.
//
// So the whole mechanism is live, and for a member it is unreachable. The one
// screen that draws the control is app/(trainer)/settings.tsx. A member's
// remote notifications — their coach's chat messages, a class called off, a
// card declined, a gym invoice, a notice, a session booked or cancelled or
// moved, a slot that opened — arrive at every hour of the night, and the only
// control the member has over any of them is the master Push Notifications
// switch, which is all-or-nothing by construction (it takes the handset out of
// `push_tokens`).
//
// src/lib/notifyPrefs.ts is scrupulously honest about this and says so on the
// screen: the 'coach' category is `local: false` and its note reads "These are
// sent from the server, so they follow the single Push Notifications switch
// rather than this list." That sentence was true when it was written. It has
// been false since part 530 shipped and nobody noticed, because the sentence
// describes the app rather than the server.
//
// ── Why this is a module and not just a second control ────────────────────
//
// A member who sets quiet hours means ONE thing by it. The product has two
// mechanisms and they behave differently, and putting two windows on one screen
// would be the worst possible answer:
//
//   LOCAL   src/lib/notifyPrefs.ts. This app's own reminders, and quiet hours
//           SHIFT them — `whenToDeliver` moves a nudge to the end of the window
//           because "a hydration nudge that never arrives is a different defect
//           and the member cannot tell it apart from a broken reminder".
//
//   REMOTE  `notify_quiet_hours`. A push already handed to Expo is not a thing
//           this system can hold, so it SUPPRESSES and the inbox row stays.
//           src/lib/quietHours.ts carries that argument in full.
//
// One window, written to both. Two effects, both stated, because a member who
// believed their coach's 11pm message would arrive at 7am would be wrong, and
// would go looking for a message that is sitting in their notifications list.
//
// ── And the one thing quiet hours must not be allowed to silence ──────────
//
// `CategoryDef.quietable` is false for sessions and classes, and the reason is
// exact: "a booked session at 6:30am is a thing the member ASKED FOR at a time
// they chose, and silencing its one-hour warning because it falls inside quiet
// hours would make them late for it."
//
// The SERVER has no such concept. `notify_quiet_now` is a statement about the
// hour and nothing else, so a coach who calls off tomorrow's 6am class at 23:00
// reaches a member with quiet hours NOWHERE — the row is written, the banner is
// suppressed, and the member turns up to a locked room. That is not fixable in
// this module and it is not a reason to withhold the control: the member's
// alternative today is the master switch, which suppresses that cancellation
// too and everything else besides. What it IS a reason for is `QUIET_COST`
// below — the consequence goes in front of the member before they choose, the
// way `CHANNEL_QUIET_COST_MONEY` does for a coach.
//
// Pure. The reads and writes are src/ui/quietHours.ts, which is already
// role-agnostic and needs no change.
const quietHours_1 = require("./quietHours");
/**
 * What one quiet window does to each half, in the member's words.
 *
 * Two sentences and not one. They are genuinely different behaviours and the
 * difference is the whole of what somebody would otherwise get wrong.
 */
exports.QUIET_LOCAL_EFFECT = 'Reminders this app sets — hydration, supplements, weigh-ins, streaks — wait and arrive when your quiet hours end. Nothing is dropped.';
exports.QUIET_REMOTE_EFFECT = 'Anything sent to you — a message from your coach, a class change, a payment problem — does not buzz at all inside these hours. It is still written into your notifications, so you find it when you open the app.';
/**
 * What setting quiet hours costs, named before the member chooses.
 *
 * The same shape as `CHANNEL_QUIET_COST_MONEY` in src/lib/coachNotify.ts and
 * for the same reason: the consequence that matters is specific, it is
 * invisible until it happens, and a reassuring sentence would be worse than
 * none. A session or class reminder this app set is exempt already; a
 * CANCELLATION sent by a coach at eleven at night is not, and cannot be — the
 * server suppresses on the hour and knows nothing about when the session is.
 */
exports.QUIET_COST = 'Your own session and class reminders still come through, whatever the hour — you asked for those at a time you chose. A change your coach or gym makes late at night does not: if they call off a 6am class at eleven, you will find it in your notifications rather than being told. If your sessions are early, that is worth weighing.';
/**
 * That the zone is the one stored, not the one the phone is in.
 *
 * Said for members as it is for coaches: the remote half is applied by a server
 * against an IANA name written down when the window was saved, and nothing
 * updates it when somebody flies.
 */
exports.QUIET_ZONE_KEPT = 'These are read in the timezone this phone was in when you saved them, because most of them are sent by a server rather than by this handset. Save them again after you move.';
/**
 * Whether a saved window may be reported as saved.
 *
 * ── Why this is not `deviceOk && serverOk` ────────────────────────────────
 *
 * Because the two failures are not the same failure and the member has to be
 * told which one happened. The device write is AsyncStorage and effectively
 * always succeeds; the server write is a PostgREST upsert whose success is
 * counted from the rows it handed back (src/ui/quietHours.ts says why). So the
 * ordinary partial outcome is: this phone is quiet, and everything sent to you
 * is not — which is most of what the member was asking for, missing.
 *
 * "Saved" over that is the one thing a settings screen must never say.
 */
function quietSaveNote(t) {
    if (t.device && t.server) {
        return { saved: true, note: 'Quiet hours saved. They apply on this phone and to anything sent to you.' };
    }
    if (t.device && !t.server) {
        return {
            saved: false,
            note: 'Only half of this saved. Reminders this app sets will wait for the morning, but anything sent to you — '
                + 'your coach, your gym, a payment — has not been told to stay quiet, because that part is stored on your '
                + 'account and the server did not answer. Try again once you have signal.',
        };
    }
    if (!t.device && t.server) {
        return {
            saved: false,
            note: 'Only half of this saved. Anything sent to you will stay quiet, but the reminders this app sets on this '
                + 'phone have not been moved and may still arrive in the night. Try again.',
        };
    }
    return { saved: false, note: 'Nothing was saved. Your quiet hours are unchanged.' };
}
function quietView(prefs, stored) {
    const device = prefs?.quiet === true
        ? { fromHour: prefs.quietFromHour, toHour: prefs.quietToHour }
        : null;
    if (stored && device) {
        const same = stored.fromHour === device.fromHour && stored.toHour === device.toHour;
        return {
            fromHour: stored.fromHour,
            toHour: stored.toHour,
            source: 'both',
            note: same ? null
                : 'This phone and your account are set to different hours. Your account’s are shown, because they are '
                    + 'the ones that stop anything sent to you. Save to put both on the same hours.',
        };
    }
    if (stored) {
        return {
            fromHour: stored.fromHour, toHour: stored.toHour, source: 'server-only',
            note: 'These came from your account, so they are already stopping anything sent to you. Save to have this '
                + 'phone move its own reminders out of them too.',
        };
    }
    if (device) {
        return {
            fromHour: device.fromHour, toHour: device.toHour, source: 'device-only',
            note: 'These are set on this phone only, so they move this app’s own reminders and do not stop anything '
                + 'sent to you. Save them to your account to do that as well.',
        };
    }
    return { fromHour: null, toHour: null, source: 'neither', note: null };
}
/**
 * Whether a member's window is in force at `hour`, in their own local terms.
 *
 * For the screen's preview only. The remote half is decided by
 * `notify_quiet_now` against the stored zone and the local half by
 * `inQuietHours`; this is the third copy of nothing — it is `hourInWindow`,
 * which is where both of those get their arithmetic, called once more so the
 * preview cannot disagree with either of them about an hour.
 */
function quietNow(hour, v) {
    if (v.fromHour == null || v.toHour == null)
        return false;
    return (0, quietHours_1.hourInWindow)(hour, v.fromHour, v.toHour);
}
