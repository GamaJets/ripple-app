"use strict";
// The paperwork a gym has to keep, and somewhere to put a document.
//
// Grepping `app/(owner)` for waiver, contract, consent, signature or PAR-Q
// returns nothing at all, and the two document modules that exist are not the
// gym's: `src/lib/waiver.ts` is the REPPLE platform release a client agrees to,
// and `src/lib/coachDocs.ts` is coach-issued and scoped to one coach and one
// client. So an owner could not see who had signed what, there was no health
// questionnaire, no guardian consent, no photo consent and no terms version
// anywhere — and none of the six storage buckets in this project belonged to a
// gym, so a signed contract, an insurance certificate, a service report or a
// photograph of a broken machine had no home.
//
// ── Why an agreement is versioned, and frozen once signed ─────────────────
//
// The question a gym is asked in a dispute is never "do you have terms". It is
// "what did THIS person agree to, on THAT date". A single mutable body answers
// the first and destroys the answer to the second: an owner editing the waiver
// in 2027 would silently rewrite what everybody signed in 2025, and every
// signature would still point at it.
//
// So editing a signed version is refused — by supabase/parts/185 at the
// database, not only here — and publishing a change means publishing a new
// version. `nextVersion` below is what a screen calls to do that.
//
// ── Who can read a document, and being seen to read one ───────────────────
//
// The filing cabinet shipped readable by every trainer in the gym: the storage
// policy was `my_role() in ('trainer','owner')` across the whole bucket, so a
// part-time coach hired last week could open a member's signed contract and
// their health questionnaire, and nothing recorded that they had.
//
// supabase/parts/390 narrows that to one rule — a document about a PERSON is
// the owner's alone, and a document about the BUILDING is readable by staff for
// the four kinds the floor needs (service reports, photographs, certificates,
// insurance). `documentAudience()` below says which a row is, for labelling; it
// does not decide anything, because a screen deciding this is the defect.
//
// And opening a member-attached document writes a row FIRST, through
// `openDocument()`. A trigger cannot see a signed URL being minted — it happens
// here, in the client, and Postgres never hears about the fetch — so the record
// is written by the only party that can observe it, and the link is not issued
// if the record will not write.
//
// Framework-agnostic like the rest of src/lib: the client arrives as an
// argument, so the console and the phone can both use this.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOCUMENT_MIME = exports.MAX_DOCUMENT_BYTES = exports.AUDIENCE_LABEL = exports.STAFF_READABLE_KINDS = exports.SIGNED_URL_TTL_S = exports.GYM_DOCS_BUCKET = exports.DOCUMENT_LABEL = exports.DOCUMENT_KINDS = exports.AGREEMENT_NOTE = exports.AGREEMENT_LABEL = exports.AGREEMENT_KINDS = void 0;
exports.agreementBlocker = agreementBlocker;
exports.nextVersion = nextVersion;
exports.fetchAgreements = fetchAgreements;
exports.fetchSignatures = fetchSignatures;
exports.publishAgreement = publishAgreement;
exports.recordSignature = recordSignature;
exports.signatureBlocker = signatureBlocker;
exports.outstandingFor = outstandingFor;
exports.documentAudience = documentAudience;
exports.documentBlocker = documentBlocker;
exports.documentPath = documentPath;
exports.fetchDocuments = fetchDocuments;
exports.recordDocument = recordDocument;
exports.recordDocumentRead = recordDocumentRead;
exports.openDocument = openDocument;
exports.objectRemoved = objectRemoved;
exports.absentFromListing = absentFromListing;
exports.removeDocumentObject = removeDocumentObject;
exports.deleteDocument = deleteDocument;
exports.discardUnfiledObject = discardUnfiledObject;
exports.expiring = expiring;
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
const wroteRows_1 = require("./wroteRows");
const gymSigning_1 = require("./gymSigning");
exports.AGREEMENT_KINDS = ['waiver', 'terms', 'par_q', 'photo_consent', 'guardian_consent', 'contract'];
/**
 * What each kind is, in the words a screen shows.
 *
 * Six kinds and not one "terms" bucket, because they are separately required. A
 * gym may lawfully train somebody who refused photo consent; it may not train
 * somebody who refused the waiver, and it may not train a minor at all without
 * the guardian one. Flattening them would make "who has not signed what" — the
 * only question this table exists to answer — unanswerable.
 */
exports.AGREEMENT_LABEL = {
    waiver: 'Liability waiver',
    terms: 'Membership terms',
    par_q: 'Health questionnaire (PAR-Q)',
    photo_consent: 'Photo and filming consent',
    guardian_consent: 'Guardian consent (under 18)',
    contract: 'Membership agreement',
};
exports.AGREEMENT_NOTE = {
    waiver: 'What a member accepts about training here. The document produced first when anybody is hurt.',
    terms: 'What the membership is, what it costs and how it ends.',
    par_q: 'The pre-exercise health questions. A gym that never asked cannot show it screened anybody.',
    photo_consent: 'Whether this person may be photographed or filmed in the building. Usually not required to join.',
    guardian_consent: 'An adult agreeing on behalf of a minor. Training a minor without it is not a records gap.',
    contract: 'A signed membership agreement, where the gym uses one.',
};
/** Why an agreement cannot be published, or null when it can. */
function agreementBlocker(title, body) {
    if (!title.trim())
        return 'Give it a title. It is what appears on the list of things a member is asked to sign.';
    if (!body.trim())
        return 'An agreement with no words in it is not something anybody can agree to.';
    if (body.trim().length < 40) {
        return 'That is shorter than any agreement anybody could rely on. Paste the whole text — this is the document produced when it is disputed, and a summary of it is worth nothing.';
    }
    return null;
}
/**
 * The version number a new publication of this kind takes.
 *
 * Computed from what the caller has ALREADY read rather than from a fresh
 * `max()`, because the caller is holding the list on screen and a second query
 * would be a second answer. The unique index on (tenant_id, kind, version) is
 * what actually guarantees it: two owners publishing at once produce one
 * agreement and one 23505, which is the right outcome — the second is told,
 * rather than a second version quietly appearing with the same number.
 */
function nextVersion(existing, kind) {
    return existing.filter((a) => a.kind === kind).reduce((n, a) => Math.max(n, a.version), 0) + 1;
}
async function fetchAgreements(sb, tenantId) {
    const { data, error } = await sb
        .from('gym_agreements')
        .select('id, kind, title, body, version, active, required, created_at')
        .eq('tenant_id', tenantId)
        .order('kind', { ascending: true })
        .order('version', { ascending: false })
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    return (0, rowCap_1.assertWhole)(data, "this gym's agreements").map((r) => ({
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
 * Every signature this gym holds.
 *
 * ── Why this is paged rather than capped ─────────────────────────────────
 *
 * It used to be `capLimit()` plus `assertWhole`, and that is the right shape
 * for a read whose truncation would make a figure wrong. This one is different:
 * the screen subtracts these rows from the roster to produce the list of people
 * TRAINING WITHOUT A WAIVER, and there is no window on it to narrow.
 *
 * The arithmetic is unforgiving. A gym requiring three agreements crosses a
 * thousand signatures at 334 members, and at 600 members it holds 1800 — so
 * /compliance went to a permanent error at a gym size that is ordinary, on the
 * one screen whose whole purpose is answering what the gym can produce when
 * somebody asks. Not a wrong number: no screen at all, with nothing an owner
 * could do about it.
 *
 * A signature is also never deleted, so the set only grows. `readAll` finishes
 * the read; `PAGE_CEILING` in src/lib/rowCap.ts is still there to stop a
 * predicate that lost its tenant filter walking the whole table.
 *
 * The order carries `id` after `signed_at` because paging needs a TOTAL order:
 * two people signing in the same second are two rows Postgres may hand back in
 * either order, and a tie across a page boundary drops rows silently.
 */
async function fetchSignatures(sb, tenantId) {
    const rows = await (0, rowCap_1.readAll)((from, to) => sb
        .from('gym_agreement_signatures')
        .select('id, agreement_id, member_id, signed_name, signed_at, version_signed, guardian_name, guardian_relationship, note, attribution')
        .eq('tenant_id', tenantId)
        .order('signed_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to), 'the signatures this gym holds');
    if (!rows.length)
        return [];
    const names = await namesFor(sb, rows.map((r) => r.member_id));
    return rows.map((r) => ({
        id: r.id,
        agreementId: r.agreement_id,
        memberId: r.member_id ?? null,
        // The live name where there is one, then the name they SIGNED with. The
        // second is the one that matters legally — a signature is what the person
        // wrote at the time — and it survives them changing their display name or
        // their account being erased.
        memberName: (r.member_id ? names.get(r.member_id) : undefined) ?? r.signed_name ?? null,
        signedName: r.signed_name,
        signedAt: r.signed_at,
        versionSigned: Number(r.version_signed) || 1,
        guardianName: r.guardian_name ?? null,
        guardianRelationship: r.guardian_relationship ?? null,
        note: r.note ?? null,
        attribution: (0, gymSigning_1.attributionOf)(r.attribution),
    }));
}
async function publishAgreement(sb, tenantId, a) {
    // Retire the live version of this kind FIRST. The partial unique index in
    // supabase/parts/185 permits one active version per kind, so inserting before
    // retiring would be refused with 23505 — and the owner would be told their
    // new terms could not be published because their old terms exist, which is
    // true and useless.
    const off = await sb.from('gym_agreements')
        .update({ active: false })
        .eq('tenant_id', tenantId)
        .eq('kind', a.kind)
        .eq('active', true);
    if (off.error)
        throw off.error;
    const { error } = await sb.from('gym_agreements').insert({
        tenant_id: tenantId,
        kind: a.kind,
        title: a.title.trim(),
        body: a.body.trim(),
        version: a.version,
        active: true,
        required: a.required,
        created_by: a.createdBy,
    });
    if (error)
        throw error;
}
/**
 * Record that somebody signed, at the desk.
 *
 * The name is what they wrote, kept independently of `profiles.full_name`,
 * because the name on a waiver IS the waiver.
 *
 * What this produces is a STAFF-ATTRIBUTED row and it cannot produce any other
 * kind: supabase/parts/520 stamps `attribution` from auth.uid(), and the caller
 * here is by definition not the member. `witnessedBy` is who took it, and the
 * database fills it in from the session when a caller leaves it null, so 'staff'
 * always answers "which member of staff".
 *
 * The member signing for themselves is `signAsMember` in src/lib/gymSigning.ts,
 * from the member's own session. There is no argument to this function that
 * would make it write one.
 */
async function recordSignature(sb, tenantId, s) {
    const { error } = await sb.from('gym_agreement_signatures').insert({
        tenant_id: tenantId,
        agreement_id: s.agreementId,
        member_id: s.memberId,
        signed_name: s.signedName.trim(),
        version_signed: s.versionSigned,
        witnessed_by: s.witnessedBy,
        guardian_name: s.guardianName?.trim() || null,
        guardian_relationship: s.guardianRelationship?.trim() || null,
        note: s.note?.trim() || null,
    });
    if (error)
        throw error;
}
/** Why a signature cannot be recorded, or null when it can. */
function signatureBlocker(memberId, signedName, kind, guardianName) {
    if (!memberId)
        return 'Choose who is signing.';
    if (!signedName.trim()) {
        return 'The name they signed with is the signature. It is kept separately from their account name on purpose — it is what the document says, and it must survive them changing it.';
    }
    if (kind === 'guardian_consent' && !guardianName.trim()) {
        return 'A guardian consent has to name the adult giving it. Without that it records only that somebody typed something.';
    }
    return null;
}
function outstandingFor(members, agreements, signatures) {
    const required = agreements.filter((a) => a.active && a.required);
    if (!required.length)
        return [];
    const signed = new Set(signatures.map((s) => `${s.memberId}|${s.agreementId}`));
    const out = [];
    for (const m of members) {
        const missing = required.filter((a) => !signed.has(`${m.memberId}|${a.id}`));
        if (missing.length)
            out.push({ memberId: m.memberId, memberName: m.memberName, missing });
    }
    return out.sort((a, b) => b.missing.length - a.missing.length
        || (a.memberName ?? '').localeCompare(b.memberName ?? ''));
}
exports.DOCUMENT_KINDS = ['contract', 'insurance', 'service_report', 'certificate', 'incident', 'photo', 'other'];
exports.DOCUMENT_LABEL = {
    contract: 'Contract',
    insurance: 'Insurance',
    service_report: 'Service report',
    certificate: 'Certificate',
    incident: 'Incident report',
    photo: 'Photograph',
    other: 'Other',
};
/** The bucket, named once. */
exports.GYM_DOCS_BUCKET = 'gym-docs';
/** Long enough to open one, short enough that a link pasted into a chat is dead
 *  before anybody clicks it. */
exports.SIGNED_URL_TTL_S = 60;
/**
 * The kinds a trainer may read when the document is about the BUILDING and not
 * about a person.
 *
 * This list is the TypeScript half of the rule; the enforcing half is
 * `gym_doc_readable()` in supabase/parts/390, and a test in gymDocAccess.test.ts
 * reads that file and fails if the two lists ever differ. What is here is used
 * to LABEL a row, never to decide access — a screen that decided this would be
 * the defect part 390 exists to remove.
 *
 * `contract`, `incident` and `other` are absent deliberately. A contract is a
 * lease or a supplier agreement; an incident report is an account of somebody
 * being hurt; and `other` is where a GP letter or a physio report lands when
 * nobody picked a kind, which makes it the one kind whose contents cannot be
 * reasoned about.
 */
exports.STAFF_READABLE_KINDS = ['service_report', 'photo', 'certificate', 'insurance'];
/**
 * Who can read this document, in the words a screen shows beside it.
 *
 * Describes what the database will do; it does not cause it. See
 * `gym_doc_readable()` in supabase/parts/390.
 */
function documentAudience(d) {
    if (d.memberAttached)
        return 'owner';
    return exports.STAFF_READABLE_KINDS.includes(d.kind) ? 'staff' : 'owner';
}
exports.AUDIENCE_LABEL = {
    owner: 'Owner only',
    staff: 'Staff',
};
/** 25 MB, matching the bucket's own limit in supabase/parts/185. Checked here
 *  as well so the refusal arrives before the upload rather than after it. */
exports.MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
exports.DOCUMENT_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
/** Why this file cannot be filed, or null when it can. */
function documentBlocker(title, file) {
    if (!title.trim())
        return 'Give it a title. A bucket full of IMG_4471.jpg is a folder, not a record.';
    if (!file)
        return 'Choose the file.';
    if (file.size > exports.MAX_DOCUMENT_BYTES) {
        return `That file is ${(file.size / 1048576).toFixed(1)} MB and the limit is 25 MB. A scan at 300dpi is usually under 5 — the setting to change is the scanner's, not this.`;
    }
    if (file.size === 0)
        return 'That file is empty.';
    if (file.type && !exports.DOCUMENT_MIME.includes(file.type)) {
        return `The bucket accepts PDF, JPEG, PNG and WebP. ${file.type} would be refused after the upload, which is a slower way to find out.`;
    }
    return null;
}
/**
 * Where a file lives inside the `gym-docs` bucket.
 *
 * The FIRST path segment is the tenant id, and that is the whole difference
 * between this bucket and the other five: `injury-docs` and `coach-docs` are
 * scoped to a person, and the storage policies in supabase/parts/185 read
 * `(storage.foldername(name))[1] = my_tenant()::text`. A gym's insurance
 * certificate belongs to the building and has to outlive whichever member of
 * staff uploaded it.
 *
 * The name is prefixed with a random segment rather than being the file's own.
 * Two people uploading `certificate.pdf` in the same month is ordinary, the
 * unique index on `storage_path` would refuse the second, and the owner would be
 * told their insurance certificate already exists.
 */
function documentPath(tenantId, fileName) {
    const clean = fileName.replace(/[^A-Za-z0-9._-]/g, '-').slice(-60) || 'document';
    // utc-day-ok: a storage key, not a date anybody is shown. Nothing reads this
    // segment back — the document's real dates are `issued_on` and `expires_on`,
    // which are columns — and the random segment on the next line is what makes
    // the path unique, so the stamp is only there to keep a bucket listing in
    // rough order for a human scrolling it. It is the same day for every reader
    // by construction, which is the one property a path prefix wants and a figure
    // must never have.
    const stamp = new Date().toISOString().slice(0, 10);
    const rand = Math.random().toString(36).slice(2, 10);
    return `${tenantId}/${stamp}-${rand}-${clean}`;
}
/**
 * The filing cabinet.
 *
 * Paged for the same reason as the signatures above: this is the register of
 * what the gym holds, `expiring()` is computed over all of it, and a cabinet
 * that refuses to open past a thousand files is a compliance screen that goes
 * dark at exactly the gym that has been trading long enough to be audited.
 * Nothing here is ever deleted on a schedule, so the set only grows.
 */
async function fetchDocuments(sb, tenantId) {
    const rows = await (0, rowCap_1.readAll)((from, to) => sb
        .from('gym_documents')
        .select('id, member_id, member_attached, equipment_id, kind, title, storage_path, mime, size_bytes, expires_on, note, uploaded_by, uploaded_at')
        .eq('tenant_id', tenantId)
        .order('uploaded_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to), "this gym's documents");
    if (!rows.length)
        return [];
    const names = await namesFor(sb, rows.map((r) => r.uploaded_by));
    return rows.map((r) => ({
        id: r.id,
        memberId: r.member_id ?? null,
        // The column where there is one, and `member_id` where there is not —
        // which is the answer a database built before supabase/parts/390 would
        // give. Never `?? false`: a missing column must not be read as "this is
        // nobody's paperwork".
        memberAttached: typeof r.member_attached === 'boolean'
            ? r.member_attached
            : r.member_id != null,
        equipmentId: r.equipment_id ?? null,
        kind: exports.DOCUMENT_KINDS.includes(r.kind) ? r.kind : 'other',
        title: r.title,
        storagePath: r.storage_path,
        mime: r.mime ?? null,
        sizeBytes: Number.isFinite(r.size_bytes) ? r.size_bytes : null,
        expiresOn: r.expires_on ?? null,
        note: r.note ?? null,
        uploadedBy: r.uploaded_by ?? null,
        uploadedByName: r.uploaded_by ? names.get(r.uploaded_by) ?? null : null,
        uploadedAt: r.uploaded_at,
    }));
}
/**
 * Record a file that is already in the bucket.
 *
 * Called AFTER the upload and never before. A row pointing at an object that
 * does not exist is a document the register says the gym holds and cannot
 * produce, which is the worse of the two failures: an orphaned object in the
 * bucket is invisible and costs storage, while an orphaned row is a false
 * statement in a compliance record.
 */
async function recordDocument(sb, tenantId, d) {
    const { error } = await sb.from('gym_documents').insert({
        tenant_id: tenantId,
        member_id: d.memberId ?? null,
        equipment_id: d.equipmentId ?? null,
        kind: d.kind,
        title: d.title.trim(),
        storage_path: d.storagePath,
        mime: d.mime,
        size_bytes: d.sizeBytes,
        expires_on: d.expiresOn ?? null,
        note: d.note?.trim() || null,
        uploaded_by: d.uploadedBy,
    });
    if (error)
        throw error;
}
/* ── opening one, and being seen to ────────────────────────────────────────── */
/**
 * Record that a link was cut for a member-attached document.
 *
 * Throws when the row will not write, and `openDocument` below does not mint
 * the link if it does. That is the whole design: the log is a GATE, not a
 * receipt. See the long argument in supabase/parts/390 — of the two ways to be
 * wrong about a read, an entry for a link that was issued and then failed to
 * open is a statement about an attempt that was authorised and made, and an
 * unlogged read is a hole in the only record there is.
 */
async function recordDocumentRead(sb, tenantId, d, readBy) {
    const { error } = await sb.from('gym_document_reads').insert({
        tenant_id: tenantId,
        document_id: d.id,
        storage_path: d.storagePath,
        doc_kind: d.kind,
        doc_title: d.title,
        read_by: readBy,
    });
    if (error) {
        throw new Error('That file was NOT opened. Opening a document about a member has to be recorded first, and the '
            + `record could not be written: ${errText(error)}. No link has been issued.`);
    }
}
/**
 * A signed URL for one document, and the record of having asked for it.
 *
 * The bucket is private, so this is the only way in — and signing is itself
 * checked against the SELECT policy, which is what makes supabase/parts/390 the
 * gate rather than this function.
 */
async function openDocument(sb, tenantId, d, readBy) {
    if (d.memberAttached)
        await recordDocumentRead(sb, tenantId, d, readBy);
    const { data, error } = await bucket(sb).createSignedUrl(d.storagePath, exports.SIGNED_URL_TTL_S);
    if (error || !data?.signedUrl) {
        throw new Error(`That file could not be opened: ${error ? errText(error) : 'no link came back'}. The record of it `
            + 'is still here; the object may have been removed from storage.');
    }
    return data.signedUrl;
}
/* ── removing one ──────────────────────────────────────────────────────────── */
/**
 * Did the Storage API say it removed this path?
 *
 * Pure, because the answer decides whether an owner is told a member's record
 * is gone. `remove()` answers with the list of objects it actually deleted, and
 * an empty list is NOT an error: an object the policy would not let the caller
 * delete is silently omitted, exactly the way a PostgREST delete that matches
 * no rows returns 204 (see wroteRows.ts, which is this same bug wearing its
 * other face).
 */
function objectRemoved(path, data) {
    if (!Array.isArray(data))
        return false;
    const base = path.slice(path.lastIndexOf('/') + 1);
    return data.some((o) => o?.name === path || o?.name === base);
}
/** Is this object absent from a listing of its own folder? Pure, for the same
 *  reason. An empty listing means absent; a listing that names it means the
 *  removal was refused rather than unnecessary. */
function absentFromListing(path, data) {
    if (!Array.isArray(data))
        return false;
    const base = path.slice(path.lastIndexOf('/') + 1);
    return !data.some((o) => o?.name === base || o?.name === path);
}
/**
 * Delete the bytes, and refuse to claim it unless they went.
 *
 * `remove()` returning an empty list is ambiguous — the object was already
 * gone, or the policy refused — and the two are opposite answers to "has this
 * member's record been erased". So the ambiguous case is resolved by looking:
 * a listing of the folder either still names the object, in which case the
 * removal was refused and this throws, or it does not, in which case the object
 * is genuinely absent and that is what was asked for.
 *
 * A listing that cannot be read is not an answer either, and is also refused.
 * The one thing this must never do is report success it has not observed.
 */
async function removeDocumentObject(sb, path) {
    const b = bucket(sb);
    const { data, error } = await b.remove([path]);
    if (error) {
        throw new Error(`That file could not be deleted from storage: ${errText(error)}. Nothing has been removed — the `
            + 'document is still on file and still readable by everybody the policy admits.');
    }
    if (objectRemoved(path, data))
        return;
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash) : '';
    const base = path.slice(slash + 1);
    const listing = await b.list(dir, { search: base, limit: 100 });
    if (listing.error) {
        throw new Error('Storage accepted the delete without saying what it removed, and the folder could not be listed to '
            + `check: ${errText(listing.error)}. Nothing has been changed here, because a file that cannot be `
            + 'confirmed gone is not gone.');
    }
    if (!absentFromListing(path, listing.data)) {
        throw new Error('Storage accepted the delete and removed nothing — the file is still in the bucket. That usually '
            + 'means the delete was refused rather than performed. The document is still on file.');
    }
}
/**
 * Remove a document: the OBJECT first, then the row. Both, or the caller is
 * told it did not happen.
 *
 * The order is the opposite of the upload's and it is the opposite on purpose.
 * Filing writes the object first because a row pointing at a file that does not
 * exist is a false statement in a compliance record. Removing writes the object
 * first because the other order is the defect this replaces: delete the row
 * first and, if the object will not go, what is left is a file in a private
 * bucket that nothing indexes — still readable by everybody the policy admits,
 * and INVISIBLE to the one screen that could have removed it. A member who asked
 * for their record to be erased would have it deleted from a list and kept on
 * disk.
 *
 * This way round, the surviving half is the row. It is visible, it still says
 * what the document was, opening it fails with a sentence that says the object
 * is gone, and pressing Remove again clears it — removing an object that is
 * already absent is confirmed absent and succeeds. A visible half that can be
 * finished beats an invisible half that cannot be found.
 */
async function deleteDocument(sb, d) {
    await removeDocumentObject(sb, d.storagePath);
    const r = await sb.from('gym_documents').delete({ count: 'exact' }).eq('id', d.id);
    const why = r.error ? `Removing that document could not be saved: ${errText(r.error)}` : (0, wroteRows_1.writeFailure)('Removing that document', r);
    if (why) {
        throw new Error(`${why} The file itself HAS been deleted from storage, so what is left is an entry pointing at `
            + 'nothing. Press Remove again to clear it.');
    }
}
/**
 * A file that uploaded and could not be filed.
 *
 * Best effort and deliberately silent: the caller is already reporting that the
 * document was not filed, and a second failure on the way out does not change
 * that sentence. Without this the object sits in the bucket with no row — which
 * is the same invisible orphan the old Remove produced, arriving by the other
 * door.
 */
async function discardUnfiledObject(sb, path) {
    try {
        await removeDocumentObject(sb, path);
    }
    catch { /* reported by the caller as "not filed" */ }
}
function bucket(sb) {
    const b = sb.storage?.from?.(exports.GYM_DOCS_BUCKET);
    if (!b)
        throw new Error('This client has no storage attached, so the file itself cannot be reached.');
    return b;
}
function errText(e) {
    const m = e?.message;
    return typeof m === 'string' && m.trim() ? m : 'the server did not say why';
}
/**
 * Documents whose expiry has passed, or is about to.
 *
 * The reason `expires_on` exists at all. An insurance schedule that lapsed in
 * March is not a filing problem — it is a gym trading uninsured, and nothing in
 * this product could previously say so.
 */
function expiring(docs, today, withinDays = 30) {
    // utc-day-ok: `today` arrives as a bare day string and is anchored at UTC
    // midnight one line down purely so that adding days is arithmetic; the same
    // day string comes back out, so UTC is the carrier and it cancels. It has to
    // cancel, because the value is compared with `<=` against `expires_on`, which
    // is a `date` column and therefore already a bare day with no zone in it.
    // Reading this back with the local getters would shift the horizon by a day
    // for half the world and quietly change which certificates a gym is warned
    // about. Whose day `today` is remains the caller's decision, which is why it
    // is a parameter.
    const limit = new Date(Date.parse(`${today}T00:00:00Z`) + withinDays * 86400000).toISOString().slice(0, 10);
    return docs
        .filter((d) => d.expiresOn != null && d.expiresOn <= limit)
        .sort((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? ''));
}
/**
 * Member and uploader names, by id.
 *
 * CHUNKED, and the limit being argued about is the REQUEST LINE, not the row
 * ceiling. Both callers moved to `readAll`, which PAGES — so the id list is
 * bounded by `PAGE_CEILING`, fifty thousand, and not by a thousand any more.
 * A uuid costs about 39 bytes inside a PostgREST `in.("…","…")` list, so even
 * a modest gym's document history builds a query string past the 8KB request
 * line nginx and most CDNs enforce by default. The proxy refuses it at roughly
 * two hundred ids with a **414**, supabase-js does not reject on it, and it
 * arrives as `data: null`.
 *
 * no-error-ok (about the ROW ceiling, which one row per id in chunks of 150
 * cannot reach): an unreadable name renders as a dash beside the document; the
 * document itself is still listed. That argument was always sound and is
 * silent about the 414, which is not one name lost to RLS — it is EVERY name
 * at once, so a gym's signature register becomes a page of dated dashes and
 * there is nobody on it to chase for a lapsed waiver.
 */
async function namesFor(sb, ids) {
    let rows = [];
    try {
        rows = await (0, idLookup_1.readByIds)(ids, 
        // `.order('id')` on a primary-key lookup is total, which is the contract
        // `readAll` requires of every page it is handed.
        (chunk, from, to) => sb.from('profiles').select('id, full_name')
            .in('id', chunk).order('id', { ascending: true }).range(from, to), 'the names on this gym’s documents');
    }
    catch {
        return new Map();
    }
    return new Map(rows
        .map((p) => [p.id, (p.full_name || '').trim()])
        .filter(([, n]) => !!n));
}
