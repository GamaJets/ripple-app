"use strict";
// Inviting people to become members of a gym.
//
// memberships.member_id references profiles(id), so until somebody has a Repple
// account they cannot hold a membership. That is correct — a membership belongs
// to a person, not to a row of spreadsheet text — but it left the gym owner
// with nowhere to put the two hundred members they already have. An invite is
// the intermediate record: the gym's intention to enrol somebody, held until
// that person exists and claims it.
//
// Framework-agnostic on purpose — it takes the Supabase client as an argument,
// so the web console and the phone app can both use it and neither owns it.
// See src/lib/gymRecord.ts and src/lib/gymSchedule.ts for the same shape.
// Importing ./supabase here would drag AsyncStorage in and make every pure
// rule below untestable under plain node.
//
// The rules that decide whether an invite is still good are pure functions,
// separate from the queries. They have to be: the same question is asked by the
// owner's list screen, by the invitee's "you have been invited" banner, and by
// accept_member_invite in 37-member-invites.sql. Three answers that disagree is
// a support ticket, so there is one implementation and the SQL mirrors it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_VALID_DAYS = void 0;
exports.normaliseEmail = normaliseEmail;
exports.isExpired = isExpired;
exports.inviteState = inviteState;
exports.isRedeemable = isRedeemable;
exports.daysUntilExpiry = daysUntilExpiry;
exports.expiryFor = expiryFor;
exports.inviteBlocker = inviteBlocker;
exports.screenInvites = screenInvites;
exports.planIdFor = planIdFor;
exports.summariseInvites = summariseInvites;
exports.inviteSubject = inviteSubject;
exports.inviteMessage = inviteMessage;
exports.inviteMailto = inviteMailto;
exports.bulkInviteMailto = bulkInviteMailto;
exports.fetchInvites = fetchInvites;
exports.fetchMyInvites = fetchMyInvites;
exports.createInvite = createInvite;
exports.createInvites = createInvites;
exports.revokeInvite = revokeInvite;
exports.extendInvite = extendInvite;
exports.acceptInvite = acceptInvite;
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
const wroteRows_1 = require("./wroteRows");
/** How long a new invite stays open. Long enough to survive a holiday, short
 *  enough that a leaked link from last season is already dead. */
exports.DEFAULT_VALID_DAYS = 30;
/* ── pure rules (no database, so they are testable and shared) ─────────────── */
/**
 * The address as it will be compared.
 *
 * Returns null rather than a best guess for anything that is not an address —
 * the caller shows "that does not look like an email", which is far better than
 * sending an invitation into a typo and reporting success.
 *
 * Only case and surrounding whitespace are normalised. Notably `.` and `+` are
 * left alone: they are significant on plenty of mail servers, and a gym whose
 * members are `first.last@` would find their invites silently collapsing into
 * one another if we stripped them.
 */
function normaliseEmail(raw) {
    if (raw == null)
        return null;
    const e = raw.trim().toLowerCase();
    if (!e)
        return null;
    // Deliberately loose. Strict RFC validation rejects real, deliverable
    // addresses, and the only test that settles it is delivery.
    if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(e))
        return null;
    return e;
}
/**
 * Has the invite passed its expiry at `now`?
 *
 * An invite with no expiry recorded is NOT expired — that is a gap in the
 * record, and treating a gap as a lapse would lock a real member out. An
 * unparseable timestamp is treated the same way, for the same reason.
 */
function isExpired(inv, now = Date.now()) {
    if (!inv.expiresAt)
        return false;
    const t = Date.parse(inv.expiresAt);
    if (Number.isNaN(t))
        return false;
    return t <= now;
}
/**
 * What to show for this invite.
 *
 * A decision somebody made outranks the clock: an invite that was accepted or
 * withdrawn keeps saying so even long after its expiry would have passed, since
 * "expired" would misdescribe what happened to it.
 */
function inviteState(inv, now = Date.now()) {
    if (inv.status !== 'pending')
        return inv.status;
    return isExpired(inv, now) ? 'expired' : 'pending';
}
/** Whether accept_member_invite would accept this one. The SQL applies exactly
 *  these two conditions, so the button and the server agree. */
function isRedeemable(inv, now = Date.now()) {
    return inviteState(inv, now) === 'pending';
}
/**
 * Whole days left before the invite lapses.
 *
 * Null when no expiry was recorded — the honest answer is "not known", never 0,
 * because 0 reads as "expires today" and would have the desk chasing somebody
 * who has no deadline at all.
 *
 * Rounded up, so an invite with nine hours left says "1 day", not "0 days".
 * Never negative: something already lapsed has 0 days left, not -4.
 */
function daysUntilExpiry(inv, now = Date.now()) {
    if (!inv.expiresAt)
        return null;
    const t = Date.parse(inv.expiresAt);
    if (Number.isNaN(t))
        return null;
    return Math.max(0, Math.ceil((t - now) / 86400000));
}
/** The expiry an invite created at `fromISO` should carry. Null validDays means
 *  no expiry, and yields null — the caller then leaves the column to its
 *  default rather than writing a date it made up. */
function expiryFor(fromISO, validDays = exports.DEFAULT_VALID_DAYS) {
    if (validDays == null)
        return null;
    const t = Date.parse(fromISO);
    if (Number.isNaN(t))
        return null;
    return new Date(t + validDays * 86400000).toISOString();
}
/**
 * Why this invite cannot be sent, or null when it can.
 *
 * Checked before the insert so the owner gets a sentence instead of a Postgres
 * unique-violation, and so a CSV import can report the bad rows without
 * attempting two hundred round trips. Same shape as settleBlocker in
 * gymSessions.ts: null means go.
 *
 * `openTo` is the set of addresses this gym already has an open invite for —
 * the partial unique index in 37-member-invites.sql enforces the same rule, and
 * this is the readable half of it.
 */
function inviteBlocker(email, openTo = [], existingMemberEmails = []) {
    const e = normaliseEmail(email);
    if (!e)
        return 'That does not look like an email address.';
    const open = new Set(openTo.map((x) => normaliseEmail(x)).filter(Boolean));
    if (open.has(e))
        return 'There is already an invitation waiting for that address.';
    const members = new Set(existingMemberEmails.map((x) => normaliseEmail(x)).filter(Boolean));
    if (members.has(e))
        return 'That person is already a member here.';
    return null;
}
/**
 * Drop the rows that cannot be sent, and say which — the shape a bulk import
 * needs. Duplicates WITHIN the batch are caught too: a spreadsheet listing the
 * same address twice would otherwise pass row-by-row validation and then fail
 * halfway through the insert, leaving the gym with a partial import and no idea
 * where it stopped.
 */
function screenInvites(rows, openTo = [], existingMemberEmails = []) {
    const send = [];
    const rejected = [];
    const seen = new Set();
    for (const row of rows) {
        const reason = inviteBlocker(row.email, openTo, existingMemberEmails);
        if (reason) {
            rejected.push({ row, reason });
            continue;
        }
        const e = normaliseEmail(row.email);
        if (seen.has(e)) {
            rejected.push({ row, reason: 'That address appears more than once in this file.' });
            continue;
        }
        seen.add(e);
        send.push(row);
    }
    return { send, rejected };
}
/**
 * The plan a spreadsheet's plan column refers to, as an id the invite can hold.
 *
 * Matched on the name after trimming and lower-casing, and no more cleverly
 * than that. Null for three different situations that must all stay null:
 * the sheet named no plan, the sheet named one this gym does not sell, and the
 * gym sells two plans by that name so the file does not say which. The invite
 * then carries no plan — which 37-member-invites.sql explicitly allows, and
 * which the desk sorts out at signup — rather than one nobody chose. A closest
 * match would enrol somebody on a price they never agreed to.
 */
function planIdFor(name, plans) {
    const want = (name ?? '').trim().toLowerCase();
    if (!want)
        return null;
    const hits = plans.filter((p) => p.name.trim().toLowerCase() === want);
    return hits.length === 1 ? hits[0].id : null;
}
function summariseInvites(invites, now = Date.now()) {
    let pending = 0, accepted = 0, revoked = 0, expired = 0;
    for (const inv of invites) {
        switch (inviteState(inv, now)) {
            case 'pending':
                pending++;
                break;
            case 'accepted':
                accepted++;
                break;
            case 'revoked':
                revoked++;
                break;
            case 'expired':
                expired++;
                break;
        }
    }
    const settled = accepted + revoked + expired;
    return {
        total: invites.length,
        pending, accepted, revoked, expired,
        acceptanceRate: settled > 0 ? accepted / settled : null,
    };
}
/* ── handing the invitation over ───────────────────────────────────────────── */
/**
 * ── Why an invitation has to be COMPOSED rather than just recorded ─────────
 *
 * /invites says it plainly at the top of the screen: "Nothing here sends an
 * email." That was true and it is the whole gap. An invite is a row addressed
 * to an email address, and until somebody actually tells that person, it does
 * nothing at all — so the entire onboarding funnel required the owner to leave
 * the console, open their own mail, and remember which of two hundred addresses
 * they had already contacted.
 *
 * ── What this deliberately does not do ────────────────────────────────────
 *
 * It does not build a magic link. `member_invites.token` exists and is
 * selected, but NOTHING in this product accepts one: `accept_member_invite`
 * takes the invite ID and authorises on the signed-in user's own email address
 * (`mi_invitee_read` is `lower(email) = lower(auth.jwt() ->> 'email')`), and
 * there is no page anywhere — not in `web/`, not in the app — that reads a
 * token out of a URL. Rendering a link that goes nowhere would be worse than
 * rendering none: an owner would send two hundred of them.
 *
 * So the address IS the link. What the invitee needs to be told is exactly one
 * thing — sign up with THIS address — and that is what these compose.
 *
 * The sending is done by the owner's own mail client, through a `mailto:`. That
 * is not a placeholder for a real sender; it is the only path that works today
 * without a transactional template, a bounce path and an unsubscribe register,
 * and it puts the message in the gym's own sent folder where they can see what
 * went out.
 */
/** The subject line. Named after the gym, because that is what the recipient
 *  recognises — "Repple" means nothing to somebody who has not joined yet. */
function inviteSubject(gymName) {
    const gym = (gymName ?? '').trim();
    return gym ? `Join ${gym} on Repple` : 'Your gym has invited you to Repple';
}
/**
 * The body of the invitation, as plain text.
 *
 * Written to be sent as-is by somebody who is not going to edit it, and every
 * line of it is load-bearing:
 *
 *  · the ADDRESS is repeated back, because signing up with a different one is
 *    the single failure mode of this whole mechanism — the invite is matched on
 *    email and an account made with a personal address never sees it;
 *  · the EXPIRY is stated when there is one, because "it says it has lapsed" is
 *    the support call this sentence prevents;
 *  · the PLAN is named when the gym chose one, and left out entirely when they
 *    did not — "we will sort the package out at the desk" is a real thing gyms
 *    do and part 37 made `plan_id` nullable for it.
 *
 * `siteUrl` is the brand's own site, never a hardcoded repplefitness.com: a
 * chain buying Repple must not be handing their own members a link to their
 * supplier. Null leaves the line out rather than inventing one.
 */
function inviteMessage(invite, opts = {}) {
    const gym = (opts.gymName ?? '').trim() || 'your gym';
    const who = (invite.fullName ?? '').trim();
    const lines = [];
    lines.push(who ? `Hi ${who},` : 'Hi,');
    lines.push('');
    lines.push(invite.planName
        ? `${gym} has set up a membership for you on Repple, on the ${invite.planName} plan.`
        : `${gym} has invited you to join on Repple. We will sort your membership out at the desk.`);
    lines.push('');
    lines.push(`Download the Repple app and sign up with this exact address: ${invite.email}`);
    lines.push('That is how the invitation finds you — an account made with a different address will not see it.');
    const days = daysUntilExpiry(invite);
    if (days != null) {
        lines.push('');
        lines.push(days <= 0
            ? 'This invitation has lapsed — tell us and we will reopen it.'
            : `The invitation is open for another ${days} day${days === 1 ? '' : 's'}.`);
    }
    const site = (opts.siteUrl ?? '').trim();
    if (site) {
        lines.push('');
        lines.push(site);
    }
    lines.push('');
    lines.push(`See you soon,\n${gym}`);
    return lines.join('\n');
}
/**
 * A `mailto:` that opens the owner's own mail client with the whole thing
 * filled in.
 *
 * Body and subject are percent-encoded with `encodeURIComponent`, which is what
 * RFC 6068 asks for and — the part that actually matters — is what turns the
 * newlines above into a message with paragraphs rather than one run-on line.
 *
 * ── The length caveat ─────────────────────────────────────────────────────
 *
 * Some mail clients truncate a very long `mailto:`. The composed message is a
 * few hundred characters and well inside every limit anybody documents, but the
 * console offers Copy beside this rather than only the link, so an owner whose
 * client mangles it has the text itself.
 */
function inviteMailto(invite, opts = {}) {
    const subject = encodeURIComponent(inviteSubject(opts.gymName));
    const body = encodeURIComponent(inviteMessage(invite, opts));
    return `mailto:${encodeURIComponent(invite.email)}?subject=${subject}&body=${body}`;
}
/**
 * One `mailto:` addressed to a whole batch, over BCC.
 *
 * BCC and not TO, and this is not a preference. A gym that mails two hundred
 * members with every address in the To line has disclosed its entire membership
 * list to all of them, which is a data breach in most of the places this
 * product sells. The To field is left empty for the same reason.
 *
 * The message is therefore the one written without a name, because it goes to
 * everybody: `inviteMessage` is called with the batch's shared plan only when
 * every invitation in it is on the same plan, and with none otherwise.
 */
function bulkInviteMailto(invites, opts = {}) {
    const addresses = [...new Set(invites.map((i) => normaliseEmail(i.email)).filter((e) => !!e))];
    if (!addresses.length)
        return null;
    const plans = new Set(invites.map((i) => i.planName ?? ''));
    const shared = plans.size === 1 ? invites[0] : { ...invites[0], planName: null };
    // No name: this one message is read by everybody in the batch, and greeting
    // two hundred people by the first one's name is worse than greeting nobody.
    const body = encodeURIComponent(inviteMessage({ ...shared, fullName: null, expiresAt: null }, opts));
    const subject = encodeURIComponent(inviteSubject(opts.gymName));
    return `mailto:?bcc=${addresses.map((a) => encodeURIComponent(a)).join(',')}&subject=${subject}&body=${body}`;
}
/**
 * The gym's invites, newest first.
 *
 * Capped through src/lib/rowCap.ts. This is the one read here that a gym can
 * realistically push past a thousand: an owner moving two hundred members off a
 * spreadsheet does it in one afternoon, and does it again next year. The order
 * is `created_at desc`, so truncation drops the OLDEST invites — which are
 * exactly the ones that have been either accepted or left to expire. Both
 * figures `inviteStats` reports would then be computed over the recent invites
 * alone: the acceptance rate would read as whatever this month happened to do,
 * under a heading that says it is the gym's. It refuses instead.
 */
async function fetchInvites(sb, tenantId) {
    const { data, error } = await sb
        .from('member_invites')
        .select('id, tenant_id, email, full_name, plan_id, invited_by, token, status, created_at, expires_at, accepted_at, accepted_by')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    const rows = (0, rowCap_1.assertWhole)(data, "this gym's invites");
    if (!rows.length)
        return [];
    // One query for every plan name rather than one per invite — the same reason
    // fetchMemberships batches it in gymRecord.ts.
    const planNames = await planNamesFor(sb, rows.map((r) => r.plan_id).filter(Boolean));
    return rows.map((r) => toInvite(r, planNames));
}
/**
 * The invites addressed to the signed-in person, across every gym.
 *
 * No tenant filter and none wanted: the point is that this runs BEFORE the
 * person belongs to a gym, so there is no tenant to filter by. The mi_invitee_
 * read policy scopes it to their own email address on the server.
 */
async function fetchMyInvites(sb) {
    const { data, error } = await sb
        .from('member_invites')
        .select('id, tenant_id, email, full_name, plan_id, invited_by, token, status, created_at, expires_at, accepted_at, accepted_by')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
    if (error)
        throw error;
    return (data ?? []).map((r) => toInvite(r, new Map()));
}
/**
 * Invite one person. Throws with a readable reason when the address is not
 * usable, rather than letting a constraint violation surface as raw Postgres.
 */
async function createInvite(sb, tenantId, inv, invitedBy) {
    const blocked = inviteBlocker(inv.email);
    if (blocked)
        throw new Error(blocked);
    const { error } = await sb.from('member_invites').insert(row(tenantId, inv, invitedBy));
    if (error)
        throw error;
}
/**
 * Invite a batch — the CSV importer's path.
 *
 * Screens first and inserts only what can go, returning the rejects so the
 * import screen can show the gym exactly which lines of their spreadsheet did
 * not make it. A batch is never silently trimmed.
 */
async function createInvites(sb, tenantId, rows, invitedBy) {
    const { send, rejected } = screenInvites(rows.map((r) => ({ ...r, email: r.email ?? null })));
    if (!send.length)
        return { sent: 0, rejected };
    const { error } = await sb
        .from('member_invites')
        .insert(send.map((r) => row(tenantId, r, invitedBy)));
    if (error)
        throw error;
    return { sent: send.length, rejected: rejected };
}
/**
 * Withdraw an invite.
 *
 * Marked, not deleted — for the same reason setPlanActive retires a plan rather
 * than removing it. "We never invited them" and "we invited them and changed
 * our mind" are different answers to the same question from a member standing
 * at the desk, and only one of them is true.
 */
async function revokeInvite(sb, inviteId) {
    // Counted, not merely unerrored — see src/lib/wroteRows.ts. Both filters below
    // can legitimately match nothing: `mi_owner` is `is_owner_of(tenant_id)`, so
    // another gym's owner withdraws nothing, and `.eq('status','pending')` matches
    // nothing once somebody has already accepted. PostgREST answers both with 204
    // and no error, so without the count the screen tells an owner an invitation
    // has been withdrawn while it is still open and still redeemable.
    const r = await sb
        .from('member_invites')
        .update({ status: 'revoked' }, { count: 'exact' })
        .eq('id', inviteId)
        .eq('status', 'pending'); // never reopen a decision by overwriting 'accepted'
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)('That invitation', r);
}
/** Push an invite's expiry out — the "they were away, send it again" case.
 *  Measured from now, not from the old expiry, so extending a lapsed invite
 *  gives a full window rather than a date still in the past. */
async function extendInvite(sb, inviteId, validDays = exports.DEFAULT_VALID_DAYS) {
    const expiresAt = expiryFor(new Date().toISOString(), validDays);
    if (!expiresAt)
        throw new Error('An invite extension needs a number of days.');
    // Counted for the same reason revokeInvite is, and it matters more here: the
    // owner extends an invite precisely because somebody is about to lose it, and
    // an extension that matched no row leaves the invite lapsing on its original
    // date under a screen that has just said it was extended.
    const r = await sb
        .from('member_invites')
        .update({ expires_at: expiresAt }, { count: 'exact' })
        .eq('id', inviteId)
        .eq('status', 'pending');
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)('That extension', r);
}
/**
 * Accept the invite addressed to me. Returns the id of the membership that is
 * now open.
 *
 * Everything real happens in accept_member_invite (37-member-invites.sql): the
 * writes cross rows the invitee has no rights over, and the validation has to
 * be on the server or it is not validation. This is the call, not the logic —
 * which is why isRedeemable exists separately for the button's enabled state.
 */
async function acceptInvite(sb, inviteId) {
    if (!sb.rpc)
        throw new Error('This Supabase client cannot call functions.');
    const { data, error } = await sb.rpc('accept_member_invite', { p_invite: inviteId });
    if (error)
        throw error;
    return data;
}
/* ── helpers ───────────────────────────────────────────────────────────────── */
function row(tenantId, inv, invitedBy) {
    const expiresAt = expiryFor(new Date().toISOString(), inv.validDays ?? exports.DEFAULT_VALID_DAYS);
    return {
        tenant_id: tenantId,
        email: inv.email.trim(),
        full_name: inv.fullName?.trim() || null,
        plan_id: inv.planId ?? null,
        invited_by: invitedBy ?? null,
        // Omitted rather than nulled when there is no expiry to write: expires_at is
        // NOT NULL with a default, so sending null would fail where leaving it out
        // correctly falls back to the schema's own window.
        ...(expiresAt ? { expires_at: expiresAt } : {}),
    };
}
function toInvite(r, planNames) {
    return {
        id: r.id,
        tenantId: r.tenant_id,
        email: r.email,
        fullName: r.full_name?.trim() || null,
        planId: r.plan_id ?? null,
        planName: r.plan_id ? planNames.get(r.plan_id) ?? null : null,
        invitedBy: r.invited_by ?? null,
        token: r.token ?? null,
        status: r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at ?? null,
        acceptedAt: r.accepted_at ?? null,
        acceptedBy: r.accepted_by ?? null,
    };
}
/**
 * Chunked, because `fetchInvites` above is a `capLimit()` read and the header
 * on it says out loud that this is the read a gym realistically pushes past a
 * thousand rows. Distinct plan ids off a thousand invites is bounded by how
 * many plans the gym has ever sold, and nothing in the schema or this code
 * bounds that below two hundred — a gym that reprices seasonally makes a new
 * plan row each time and keeps the old ones for the members still on them.
 * Past about two hundred uuids the `in.("…","…")` list crosses the 8KB request
 * line, the proxy answers 414, and supabase-js reports that as `data: null` —
 * which the `no-error-ok` below then reads as "none of these plans has a
 * name", turning every invite in the list into a dash at once. One unreadable
 * plan is what that marker was written for; all of them is not.
 */
async function planNamesFor(sb, ids) {
    const out = new Map();
    for (const chunk of (0, idLookup_1.chunkIds)((0, idLookup_1.uniqueIds)(ids))) {
        // no-error-ok: an unreadable plan name becomes null and renders as a dash; the invite is still listed
        const { data } = await sb.from('membership_plans').select('id, name').in('id', chunk);
        for (const p of (data ?? []))
            out.set(p.id, p.name);
    }
    return out;
}
