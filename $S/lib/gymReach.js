"use strict";
// Reaching members as a group, from the console.
//
// ── What existed before ────────────────────────────────────────────────────
//
// Two things, both phone-only. `app/(owner)/ops.tsx` posts an announcement to
// members with an optional push and no targeting at all; `app/(owner)
// /promotions.tsx` pushes to `all_member_ids()`. `studio-web` could not post
// anything to anybody. So an owner sitting at the desk with a laptop, looking at
// the retention board that has just named eleven people who have not been in for
// six weeks, had no way to say anything to those eleven people — and the tool
// they did have could only shout at everyone.
//
// ── The two halves, and why they are kept apart ───────────────────────────
//
// SEGMENTS are pure and live in this file's first half. They are built from
// rows the console has already read, so a segment is always the same set the
// screen is showing — an owner who filters a roster and then messages "these
// people" must be messaging the people they can see, and a segment recomputed
// server-side from a different query would eventually disagree.
//
// SENDING is two writes, and they are different facts:
//
//   · `announcements` is the notice board. One row, tenant-scoped, readable by
//     every member of the gym. This is what /(client) renders as "from your gym".
//   · `notify_users` is the inbox. One row per named recipient, which is what
//     makes targeting real: the announcement is public to the gym, the inbox
//     row is what actually reaches a person.
//
// They are done in that order and reported separately, because a notice that
// posted and reached nobody is not the same failure as one that never posted.
//
// ── What this deliberately does NOT do ────────────────────────────────────
//
// It does not push, and the console says so. A push needs the Expo token
// plumbing that lives in the phone app (`sendPushChecked`), and inventing a
// second, weaker copy of it here would give the owner a switch whose promise
// nothing keeps. It also does not schedule: nothing in this repository records
// what timezone anybody is in, so "it will go out in the morning" is a sentence
// no code here could honour — the same reasoning ops.tsx already prints.
//
// And it is not an email campaign. Roadmap E6 is right that a real one needs a
// list model, an unsubscribe path and consent tracking, none of which exist. The
// honest half is built here; `segmentCsv` hands the rest to whatever the gym
// already uses to send email, rather than pretending.
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTICE_ROUTE = exports.INBOX_BODY = exports.MAX_BODY = exports.UNSEEN_DAYS = exports.LAPSING_DAYS = void 0;
exports.buildSegments = buildSegments;
exports.segmentCsv = segmentCsv;
exports.reachBlocker = reachBlocker;
exports.willTruncateInbox = willTruncateInbox;
exports.postToSegment = postToSegment;
exports.deliveryNote = deliveryNote;
// One CSV writer for the whole product. `toCsv` carries the BOM and the CRLF
// endings that decide whether a non-ASCII member name survives being opened.
const gymExport_1 = require("./gymExport");
/**
 * How long without a door scan counts as drifting rather than absent.
 *
 * Two bands rather than one, because they want different messages: a member 21
 * days out is somebody a friendly nudge brings back, and one 60 days out is a
 * cancellation that has not been filed yet. Collapsing them into "inactive"
 * produces one message that is wrong for both.
 */
exports.LAPSING_DAYS = 21;
exports.UNSEEN_DAYS = 60;
/**
 * Sort a roster into the groups an owner would actually address.
 *
 * ── The door log is a precondition, not an input ──────────────────────────
 *
 * `doorLogLive` is false when the gym's door log is silent or unread, and the
 * three attendance-based segments are then EMPTY WITH A DIFFERENT NOTE rather
 * than full of everybody. A gym that has never recorded a visit would otherwise
 * have its entire roster sorted into "not seen in 60 days" and receive a
 * winback message — which is the single most damaging thing this feature could
 * do, and it would look like it was working.
 *
 * The same gate guards the same two figures on /members and /retention.
 */
function buildSegments(members, opts) {
    const live = opts.doorLogLive;
    const active = members.filter((m) => m.status === 'active');
    const doorNote = live
        ? ''
        : ' The door log is silent or unread, so nobody can be placed here — this is not a gym where everyone is still coming in.';
    const seenBand = (lo, hi) => (live
        ? active.filter((m) => m.lastSeenDays != null && m.lastSeenDays >= lo && (hi == null || m.lastSeenDays < hi))
        : []);
    return [
        {
            id: 'active',
            label: 'Every active member',
            note: 'Anybody holding a membership that is not frozen or cancelled.',
            members: active,
        },
        {
            id: 'lapsing',
            label: `Slipping — ${exports.LAPSING_DAYS} to ${exports.UNSEEN_DAYS} days`,
            note: `Active members whose last visit was between ${exports.LAPSING_DAYS} and ${exports.UNSEEN_DAYS} days ago. Still members; the gap is new.${doorNote}`,
            members: seenBand(exports.LAPSING_DAYS, exports.UNSEEN_DAYS),
        },
        {
            id: 'unseen',
            label: `Not seen in ${exports.UNSEEN_DAYS} days`,
            note: `Active members still paying and not coming in. A cancellation that has not been filed yet.${doorNote}`,
            members: seenBand(exports.UNSEEN_DAYS, null),
        },
        {
            id: 'never-seen',
            label: 'Never through the door',
            note: `Active members with no visit in the window at all — usually a new joiner nobody has got in yet, occasionally a desk that stopped scanning.${doorNote}`,
            members: live ? active.filter((m) => m.lastSeenDays == null) : [],
        },
        {
            id: 'frozen',
            label: 'Frozen',
            note: 'Memberships on hold. Worth a message before the hold runs out, and worth never sending a winback to.',
            members: members.filter((m) => m.status === 'frozen'),
        },
        {
            id: 'cancelled',
            label: 'Cancelled',
            note: 'People who left. Nothing here is sent to them by default, and a message that treats them as members reads badly.',
            members: members.filter((m) => m.status === 'cancelled'),
        },
    ];
}
/**
 * The segment as a spreadsheet, for the mailing tool the gym already has.
 *
 * This is the honest half of "email campaigns". There is no sender, no
 * unsubscribe register and no consent record in this product, and building a
 * bulk email path without those three is how a gym gets itself into trouble
 * with the law rather than with its members. A CSV hands the list to whatever
 * already has them.
 *
 * ── written by `toCsv`, having been written by hand ───────────────────────
 *
 * This had its own `cell()` and joined its lines with `'\n'`, and it emitted no
 * byte-order mark. Both omissions have the same victim: Excel opens a
 * BOM-less UTF-8 file in the machine's legacy code page, so a gym in the Gulf
 * downloads its own call list and `Ahmed Al-Naïm` arrives as mojibake — in the
 * NAME column, on the list somebody is about to ring people from.
 *
 * `toCsv` in src/lib/gymExport.ts does the BOM and the CRLF endings and says
 * why in as many words, and /export advertises it as the correct writer. The
 * roster segment beside the desk is the download an owner actually uses and it
 * used a different one. There is now one writer.
 */
function segmentCsv(seg, contactFor) {
    return (0, gymExport_1.toCsv)(['Member id', 'Name', 'Membership', 'Days since last visit', 'Email', 'Phone'], seg.members.map((m) => {
        const c = contactFor?.(m.memberId) ?? { email: null, phone: null };
        return [
            m.memberId,
            m.name,
            m.status,
            // Empty, not 0: a member the door log has never seen has no interval, and
            // 0 in this column reads as "came in today" to whoever opens the file.
            m.lastSeenDays == null ? '' : String(m.lastSeenDays),
            c.email,
            c.phone,
        ];
    }));
}
/* ── sending ───────────────────────────────────────────────────────────────── */
/** `announcements.body` accepts 2000; `notify_users` stores `left(v_body, 500)`.
 *  Both are enforced by the database, and the second silently truncates — so the
 *  screen is told about it rather than finding out from a member. */
exports.MAX_BODY = 2000;
exports.INBOX_BODY = 500;
/** Where a member's inbox row takes them when they tap it. Matches the route
 *  the phone app's own notice fan-out uses, so a console notice and a phone
 *  notice land in the same place. */
exports.NOTICE_ROUTE = '/(client)/notifications';
/**
 * Why this message cannot be sent yet, in the owner's words, or null.
 *
 * Pure, so the sentence is assertable without a database and appears while they
 * are still typing rather than after the round trip.
 */
function reachBlocker(body, recipients) {
    const b = (body ?? '').trim();
    if (!b)
        return 'Write the message first. An empty card on forty dashboards is worse than nothing at all.';
    if (b.length > exports.MAX_BODY) {
        return `That is ${b.length} characters and the limit is ${exports.MAX_BODY}. The database refuses the rest rather than trimming it.`;
    }
    if (recipients === 0) {
        return 'Nobody is in this group, so there is nobody for this to reach. Pick another group.';
    }
    return null;
}
/** True when the inbox copy will be cut short — worth saying before it is sent,
 *  since `notify_users` truncates without complaining. */
function willTruncateInbox(body) {
    return (body ?? '').trim().length > exports.INBOX_BODY;
}
/**
 * Post a notice to the gym, and put it in the named members' inboxes.
 *
 * The order is deliberate. The notice board row goes first and is checked: if
 * it fails, nothing is sent to anybody and the owner still has their words. The
 * inbox fan-out follows and is reported separately, because a notice that
 * posted and reached nobody is a real and recoverable state — the notice is on
 * the board and can be re-fanned — whereas reporting the pair as one boolean
 * makes the two indistinguishable.
 *
 * `audience: 'clients'` is not a naming choice: `announcements_audience_check`
 * admits 'clients' or 'trainers' and nothing else, and a gym notice is
 * addressed to the people the schema calls clients. `coach_id` stays null,
 * which is what `ann_read` requires for a tenant-wide notice.
 */
async function postToSegment(sb, args) {
    const body = (args.body ?? '').trim().slice(0, exports.MAX_BODY);
    if (!body)
        throw new Error('Nothing to send.');
    const { data, error } = await sb
        .from('announcements')
        .insert({
        author_id: args.authorId,
        coach_id: null,
        audience: 'clients',
        body,
        tenant_id: args.tenantId,
    })
        .select('id')
        .single();
    // `.single()` sets error when nothing comes back, so a row RLS refused cannot
    // arrive here looking like a success. The id is checked as well: a notice with
    // no id is a notice nothing can point at.
    if (error || !data?.id) {
        throw new Error(`That notice was not posted, so nobody has seen it: ${error?.message ?? 'the write was refused'}. Your words are still here.`);
    }
    const ids = [...new Set(args.memberIds.filter(Boolean))];
    if (!ids.length)
        return { posted: true, delivered: 0, deliveryError: null };
    try {
        const title = args.gymName?.trim() ? args.gymName.trim() : 'Your gym';
        const res = await sb.rpc?.('notify_users', {
            p_user_ids: ids,
            p_title: title,
            p_body: body,
            p_icon: 'megaphone',
            p_route: exports.NOTICE_ROUTE,
        });
        if (res?.error) {
            return { posted: true, delivered: null, deliveryError: res.error.message ?? 'The inbox rows were refused.' };
        }
        // notify_users returns the row count it inserted. Anything else is a shape
        // this code does not understand, and null says so rather than claiming zero.
        const n = typeof res?.data === 'number' ? res.data : null;
        return { posted: true, delivered: n, deliveryError: null };
    }
    catch (e) {
        return { posted: true, delivered: null, deliveryError: e?.message ?? 'The inbox rows could not be written.' };
    }
}
/** What to tell the owner after a send. One sentence, and it never claims more
 *  than the two halves actually reported. */
function deliveryNote(r, intended) {
    if (!r.posted)
        return 'Nothing was posted.';
    if (r.deliveryError) {
        return `Posted to the gym’s notice board, but the ${intended} inbox ${intended === 1 ? 'row' : 'rows'} could not be written: ${r.deliveryError}. Members will see it when they open the app; nobody has been notified.`;
    }
    if (r.delivered == null) {
        return 'Posted to the gym’s notice board. How many inboxes it reached could not be read, so that number is unknown rather than nil.';
    }
    if (r.delivered < intended) {
        return `Posted, and delivered to ${r.delivered} of ${intended} inboxes. The difference is accounts the database would not write to — usually somebody who has left the gym. No push was sent; the console cannot send one.`;
    }
    return `Posted, and delivered to ${r.delivered} ${r.delivered === 1 ? 'inbox' : 'inboxes'}. No push was sent — the console cannot send one, so it will be read next time they open the app.`;
}
