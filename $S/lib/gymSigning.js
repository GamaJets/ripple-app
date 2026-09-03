"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_REPPLE = exports.SIGNING_RULE = exports.GUARDIAN_REFUSAL = exports.ATTRIBUTION_NOTE = exports.ATTRIBUTION_LABEL = void 0;
exports.attributionOf = attributionOf;
exports.tallyAttribution = tallyAttribution;
exports.forMember = forMember;
exports.waitingOn = waitingOn;
exports.waitingCount = waitingCount;
exports.outstanding = outstanding;
exports.blockedOn = blockedOn;
exports.agreementStanding = agreementStanding;
exports.agreementSummary = agreementSummary;
exports.signingBlocker = signingBlocker;
exports.fetchGymAgreements = fetchGymAgreements;
exports.fetchMySignatures = fetchMySignatures;
exports.signAsMember = signAsMember;
// The half of the gym's paperwork that was never built: the member's own end.
//
// `src/lib/gymDocs.ts` and studio-web/app/compliance/page.tsx are the desk's
// end, and they work. What they produce, in every case, is a member of staff
// choosing a name from the roster and typing it into a box — because there was
// no member-side path anywhere in this repository. Nothing a member opened,
// nothing a member tapped, and not one row written by a member's own session.
//
// So the document a gym would produce after an injury said the member signed,
// and what happened was that somebody at reception typed eleven characters.
//
// ── What this module is, and what it is not ───────────────────────────────
//
// It is the member reading the wording the gym is actually asking for, agreeing
// to it from their own authenticated session, and that agreement being
// attributed to them by the database rather than by the app. Nothing here can
// write a signature for anybody else: `signAsMember` sends no member id at all
// — the row is stamped with auth.uid() by the trigger in supabase/parts/520,
// and the RLS policy there refuses any insert where the two disagree.
//
// It is not a drawn signature, and that is a decision rather than a shortcut.
// An authenticated, timestamped agreement against a version whose wording is
// frozen at the database is stronger evidence than a bitmap of a fingertip
// scrawl: the bitmap proves that a finger moved on a screen, and the account
// proves who was holding it. supabase/parts/185 makes the same argument at
// greater length, and eIDAS Article 25 and the UK Electronic Communications Act
// are what make the typed form admissible.
//
// ── Why the guardian consent is refused here ──────────────────────────────
//
// A guardian consent is an ADULT agreeing on behalf of a minor, and the minor is
// the one with the account. A member-side signing path would therefore let a
// fifteen-year-old give their own guardian consent, which is not a weaker
// signature — it is the wrong person's, and worth less than nothing because it
// looks like the right one. It is refused below and the screen says to take it
// at the desk. Doing it properly means a way for somebody with no account to be
// sent a document and identified, and that is a separate piece of work.
//
// Framework-agnostic like the rest of src/lib: the client arrives as an
// argument, so the console and the phone can both use this.
const rowCap_1 = require("./rowCap");
// The paragraph below names the responsible party, so it names the brand this
// bundle actually is.
const brands_1 = require("./brands");
const ATTRIBUTIONS = ['member', 'staff', 'unknown'];
/**
 * The column, narrowed.
 *
 * Anything unrecognised — a NULL from a database this part has not been applied
 * to, a value added later — becomes 'unknown' rather than throwing or
 * defaulting to 'staff'. An unreadable answer to "who signed this" is exactly
 * what 'unknown' means, so the degraded case lands in the state that already
 * describes it.
 */
function attributionOf(raw) {
    const s = typeof raw === 'string' ? raw : '';
    return (ATTRIBUTIONS.includes(s) ? s : 'unknown');
}
/** What each is, in the words a screen shows. Short: these sit in a table cell. */
exports.ATTRIBUTION_LABEL = {
    member: 'The member',
    staff: 'Staff, for them',
    unknown: 'Not recorded',
};
/** And what each is worth, in the words an owner needs before a dispute. */
exports.ATTRIBUTION_NOTE = {
    member: 'Given by the member from their own signed-in account, against this version of the wording. This is the strong form.',
    staff: 'A member of staff recorded this on the member’s behalf. It is a real business record — a staff attestation that the member agreed — but it is not the member’s own act, and it is not what a signature is usually taken to mean.',
    unknown: 'Written before this product recorded who typed a signature. It is not known whether the member gave it or a member of staff entered it for them, and nothing here will guess.',
};
function tallyAttribution(rows) {
    const t = { member: 0, staff: 0, unknown: 0, total: rows.length };
    for (const r of rows)
        t[r.attribution] += 1;
    return t;
}
exports.GUARDIAN_REFUSAL = 'This one has to be given by the adult responsible for you, in person at the gym. It cannot be given from this account — an account belonging to the person the consent is ABOUT is the wrong signature, however it is worded.';
/** The one sentence a member reads before they agree to anything here. */
exports.SIGNING_RULE = 'Signing records your name, the moment, and the exact wording above, against your account. It is kept as the gym’s evidence that you agreed and it cannot be edited or taken back afterwards — withdrawing consent later is a new record, not the quiet disappearance of this one.';
/**
 * Why the gym holds this rather than the app's publisher, said once and shown
 * on the screen.
 *
 * Reads the brand. The heading above it on `app/(client)/agreements.tsx` always
 * did — `Your gym’s, not ${BRAND.label}’s` — so on a white-label build the
 * title named the member's own app and the sentence under it named a supplier
 * they have never heard of. The entire purpose of this paragraph is to tell a
 * member who to take a dispute to, and it was naming two different parties in
 * consecutive lines.
 */
exports.NOT_REPPLE = `These are your gym’s own documents. ${brands_1.BRAND.label} does not write them, check them or advise on them, `
    + 'and the release you agreed to when you joined the app is a different document owned by a different party.';
/**
 * Everything this gym is currently asking for, joined to what this person has
 * already given.
 *
 * Only ACTIVE versions, because those are the only ones the database will now
 * accept a signature against (supabase/parts/520 narrowed the member insert
 * policy to them) and the only ones the compliance screen counts. A member
 * cannot usefully sign a retired version and should not be shown one.
 *
 * Matching is on the AGREEMENT ROW, never on the kind. Signing version 1 does
 * not cover version 2 — that is the entire reason versions exist, and matching
 * on kind here would silently tell somebody they had signed wording they had
 * never seen.
 */
function forMember(agreements, signatures) {
    const mine = new Map(signatures.map((s) => [s.agreementId, s]));
    return agreements
        .filter((a) => a.active)
        .map((a) => {
        const s = mine.get(a.id);
        return {
            id: a.id,
            kind: a.kind,
            title: a.title,
            body: a.body,
            version: a.version,
            required: a.required,
            signedAt: s?.signedAt ?? null,
            signedName: s?.signedName ?? null,
            attribution: s?.attribution ?? null,
            refusal: a.kind === 'guardian_consent' ? exports.GUARDIAN_REFUSAL : null,
        };
    })
        .sort((x, y) => {
        // Unsigned first, required before optional, then by title. What is waiting
        // on the reader is what the screen is for.
        const wx = waitingOn(x) ? 0 : 1;
        const wy = waitingOn(y) ? 0 : 1;
        return wx - wy || Number(y.required) - Number(x.required) || x.title.localeCompare(y.title);
    });
}
/** Whether this one is still waiting on the member. A refused one is not: there
 *  is nothing they can do about it here, and counting it would send somebody
 *  looking for a button that is deliberately absent. */
function waitingOn(a) {
    return a.signedAt === null && a.refusal === null;
}
function waitingCount(rows) {
    return rows.filter(waitingOn).length;
}
/**
 * Unsigned, whoever is supposed to do something about it.
 *
 * `waitingOn` answers "may this member act on this row", which is the right
 * question for a button and for the ordering. It is the WRONG question for the
 * line at the top of the screen, and one function was answering both.
 *
 * A guardian consent carries `GUARDIAN_REFUSAL` — correct, because a minor may
 * not give consent about themselves however it is worded — and that took the
 * row out of the count as a side effect. So a sixteen-year-old whose guardian
 * consent is unsigned opened the gym paperwork screen and read "Nothing is
 * waiting on you", and supabase/parts/185 is explicit that the gym may not
 * train them at all without it. They turn up and are either turned away at the
 * desk or, worse, trained without it.
 */
function outstanding(a) {
    return a.signedAt === null;
}
/** Unsigned AND not this member's to sign. Someone else has to act, and the
 *  member still needs to know it has not happened. */
function blockedOn(a) {
    return a.signedAt === null && a.refusal !== null;
}
function agreementStanding(rows) {
    const waiting = rows.filter(waitingOn).length;
    const blocked = rows.filter(blockedOn).length;
    return { waiting, blocked, outstanding: waiting + blocked };
}
/**
 * The line at the top of the member's paperwork screen.
 *
 * Never says "nothing is waiting on you" while anything is unsigned. A document
 * the member cannot sign is still a document the gym is missing, and the
 * sentence names who has to give it rather than leaving a minor to discover it
 * at the desk.
 *
 * Only called once the read has landed and there is something to report on —
 * loading, failed and "your gym publishes nothing" are three other sentences
 * that belong to the screen.
 */
function agreementSummary(rows) {
    const { waiting, blocked } = agreementStanding(rows);
    const docs = (n) => `${n} document${n === 1 ? '' : 's'}`;
    const guardian = (n) => `${n === 1 ? 'it' : 'they'} can only be given by the adult responsible for you, in person at the gym`;
    if (waiting === 0 && blocked === 0)
        return 'Nothing is waiting on you.';
    if (waiting === 0) {
        return `Nothing here is for you to sign, but ${docs(blocked)} your gym asks for `
            + `${blocked === 1 ? 'is' : 'are'} still unsigned — ${guardian(blocked)}. `
            + 'Your gym may not be able to train you until that is done.';
    }
    if (blocked === 0)
        return `${docs(waiting)} waiting on you.`;
    return `${docs(waiting)} waiting on you, and ${blocked} more still unsigned — `
        + `${guardian(blocked)}. Your gym may not be able to train you until that is done.`;
}
/**
 * Why this cannot be signed yet, or null when it can.
 *
 * `readIt` is whether the reader has actually opened the wording on this screen.
 * The database cannot check that — nothing about scrolling is visible to it — so
 * the app is the only place it can be true, and a Sign button that works on
 * text nobody expanded records something that did not happen. The same argument
 * and the same gate are in app/(client)/coach-documents.tsx.
 */
function signingBlocker(a, typedName, agreed, readIt) {
    if (a.refusal)
        return a.refusal;
    if (a.signedAt)
        return 'You have already signed this version.';
    if (!readIt)
        return 'Open the wording and read it first. Agreeing to a document you have not seen is not agreeing to anything.';
    if (!agreed)
        return 'Tick the box to say you agree to it.';
    if (!typedName.trim()) {
        return 'Type your name. The name on the document is what makes it a signature, and it is kept exactly as you type it — separately from your account name, so it survives you changing that.';
    }
    if (typedName.trim().length < 2)
        return 'That is too short to be a name.';
    return null;
}
/**
 * Everything the gym asks this tenant's members to agree to.
 *
 * Read through the ordinary agreements policy, which part 185 opened to the
 * whole tenant with the right reason on it: a document somebody has to sign and
 * cannot read before signing is not consent.
 */
async function fetchGymAgreements(sb, tenantId) {
    const { data, error } = await sb
        .from('gym_agreements')
        .select('id, kind, title, body, version, active, required, created_at')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('kind', { ascending: true })
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    return (0, rowCap_1.assertWhole)(data, 'what your gym asks you to sign').map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        version: Number(r.version) || 1,
        active: r.active !== false,
        required: r.required !== false,
        createdAt: r.created_at,
    }));
}
/**
 * What this person has already signed.
 *
 * No member id is sent. `gym_agreement_sig_own_r` is `member_id = auth.uid()`,
 * so the session decides whose signatures these are and a caller cannot ask for
 * somebody else's by passing a different id.
 */
async function fetchMySignatures(sb) {
    const { data, error } = await sb
        .from('gym_agreement_signatures')
        .select('agreement_id, signed_at, signed_name, attribution')
        .order('signed_at', { ascending: false })
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    return (0, rowCap_1.assertWhole)(data, 'what you have signed').map((r) => ({
        agreementId: r.agreement_id,
        signedAt: r.signed_at,
        signedName: r.signed_name,
        attribution: attributionOf(r.attribution),
    }));
}
/**
 * Sign it, as yourself.
 *
 * Three columns are deliberately NOT sent, and each of them is the point:
 *
 *   member_id     omitted, so it defaults to nothing a caller chose. The insert
 *                 policy is `member_id = auth.uid()`, so it has to be supplied —
 *                 and it is supplied from the session below, read fresh rather
 *                 than passed in, so there is no argument a caller could put
 *                 somebody else's id into.
 *   attribution   derived by the database. An app that could set it would be
 *                 the same defect one level up.
 *   witnessed_by  there is no witness. The person signing is the person here.
 *
 * `version` is sent and validated against the agreement row rather than trusted:
 * a mismatch means this screen is showing wording the gym has since replaced,
 * and the write is refused so the reader is asked again against the new one.
 */
async function signAsMember(sb, tenantId, s) {
    const { data: auth, error: authErr } = await sb.auth.getUser();
    const uid = auth?.user?.id ?? null;
    if (authErr || !uid) {
        throw new Error('You are not signed in, so there is no account this could be attributed to. Sign in and try again.');
    }
    const { error } = await sb.from('gym_agreement_signatures').insert({
        tenant_id: tenantId,
        agreement_id: s.agreementId,
        member_id: uid,
        signed_name: s.signedName.trim(),
        version_signed: s.version,
    });
    if (error)
        throw error;
}
