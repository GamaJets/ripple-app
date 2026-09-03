"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Who can read a gym document, whether opening one is recorded, and whether
// "Remove" removed anything. Compile with tsc, run with node.
//
// Three rules here, and all three are silent when they go wrong — which is why
// they get assertions rather than a careful reading:
//
//   · A document about a PERSON is the owner's alone. The bug this replaces was
//     one policy written for a rowing machine governing a member's health
//     questionnaire, and it looked exactly like a working restriction: the
//     screen was owner-gated, so nobody browsing the console would ever have
//     seen it. It was the anon key plus a trainer's session that opened the
//     file.
//   · Opening a member's document is recorded BEFORE the link is minted. If
//     that order ever inverts, the failure mode is a read that happened and was
//     never logged, and nothing anywhere would show it.
//   · Remove removes the object. The old one deleted the row and left the file
//     in the bucket, unindexed and therefore invisible to the only screen that
//     could have removed it — a member asking for erasure had their record
//     taken off a list and kept on disk.
const gymDocs_1 = require("./gymDocs");
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const doc = (over = {}) => ({
    id: 'doc-1',
    memberId: null,
    memberAttached: false,
    equipmentId: null,
    kind: 'insurance',
    title: 'Public liability 2026',
    storagePath: 'tenant-1/2026-09-01-abc123-schedule.pdf',
    mime: 'application/pdf',
    sizeBytes: 4096,
    expiresOn: null,
    note: null,
    uploadedBy: 'owner-1',
    uploadedByName: 'Ana',
    uploadedAt: '2026-09-01T09:00:00.000Z',
    ...over,
});
/* ── who can read what ─────────────────────────────────────────────────────── */
// The one that matters. Whatever the kind, a document about a person is the
// owner's — a part-time coach reaches none of it, related to that member or not.
for (const kind of gymDocs_1.DOCUMENT_KINDS) {
    eq((0, gymDocs_1.documentAudience)({ memberAttached: true, kind }), 'owner', `a ${kind} filed against a member is the owner's alone`);
}
eq((0, gymDocs_1.documentAudience)({ memberAttached: false, kind: 'service_report' }), 'staff', "an engineer's report on a machine is the floor's — that is the case part 185 was right about");
eq((0, gymDocs_1.documentAudience)({ memberAttached: false, kind: 'photo' }), 'staff', 'and so is the photograph of the broken machine');
eq((0, gymDocs_1.documentAudience)({ memberAttached: false, kind: 'certificate' }), 'staff', 'first aid, gas safety and fire certificates are what staff need to see are current');
eq((0, gymDocs_1.documentAudience)({ memberAttached: false, kind: 'insurance' }), 'staff', 'as is the public-liability schedule');
eq((0, gymDocs_1.documentAudience)({ memberAttached: false, kind: 'contract' }), 'owner', 'a loose contract is a lease or a supplier agreement and is not the floor\'s business');
eq((0, gymDocs_1.documentAudience)({ memberAttached: false, kind: 'incident' }), 'owner', 'an incident report is an account of somebody being hurt, and there is no version of it a trainer needs the file of');
eq((0, gymDocs_1.documentAudience)({ memberAttached: false, kind: 'other' }), 'owner', "'other' is where a GP letter lands when nobody picked a kind, so it fails closed");
ok(['owner', 'staff'].every((a) => gymDocs_1.AUDIENCE_LABEL[a]), 'both audiences have words a screen shows');
// A member erased from the platform leaves `member_id` null behind — the flag
// is what stops the rule widening at exactly that moment.
eq((0, gymDocs_1.documentAudience)({ memberAttached: true, kind: 'incident' }), 'owner', 'an erased member\'s incident report does not become gym-wide paperwork when their id goes');
/* ── the same list, in the file that actually enforces it ──────────────────── */
//
// The TypeScript list labels a row; `gym_doc_readable()` decides access. Two
// copies of a security rule are two copies until somebody edits one, so this
// reads the part and fails if they have drifted.
const PARTS = join('supabase', 'parts');
const partFile = readdirSync(PARTS).find((f) => /^390-/.test(f));
ok(!!partFile, 'supabase/parts/390 is where the read rule lives and it is missing');
if (partFile) {
    const sql = readFileSync(join(PARTS, partFile), 'utf8');
    const m = /else p_kind in \(([^)]*)\)/.exec(sql);
    ok(!!m, 'gym_doc_readable() no longer ends in a kind list, so this test can no longer check it');
    if (m) {
        const inSql = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
        eq(inSql.join('|'), [...gymDocs_1.STAFF_READABLE_KINDS].join('|'), 'the kinds a trainer may read differ between src/lib/gymDocs.ts and supabase/parts/390');
    }
    // The policy this part exists to remove. If it comes back under its own name
    // it is OR'd with the new one and the old width simply survives.
    ok(/drop policy if exists gym_documents_staff_r/.test(sql), 'the tenant-wide staff read policy must be dropped by name, not just replaced');
    // Both policies must go through the one predicate. Part 124's lesson: a
    // storage rule and a table rule that are written twice can answer differently
    // about the same document, and only one of the two answers is a leak.
    ok(/create policy gymdoc_obj_read on storage\.objects[\s\S]{0,300}gym_doc_object_readable\(name\)/.test(sql), 'the storage read policy must defer to gym_doc_object_readable, not carry its own copy of the rule');
    ok(/create policy gym_documents_read on public\.gym_documents[\s\S]{0,200}gym_doc_readable\(tenant_id, member_attached, kind\)/.test(sql), 'and the table read policy must defer to gym_doc_readable');
}
/* ── did the bytes go ──────────────────────────────────────────────────────── */
const PATH = 'tenant-1/2026-09-01-abc123-schedule.pdf';
const BASE = '2026-09-01-abc123-schedule.pdf';
ok((0, gymDocs_1.objectRemoved)(PATH, [{ name: PATH }]), 'storage naming the full key is a removal');
ok((0, gymDocs_1.objectRemoved)(PATH, [{ name: BASE }]), 'and so is storage naming the leaf');
ok(!(0, gymDocs_1.objectRemoved)(PATH, []), 'an EMPTY list is not a removal — that is what a refused delete looks like');
ok(!(0, gymDocs_1.objectRemoved)(PATH, null), 'and neither is nothing at all');
ok(!(0, gymDocs_1.objectRemoved)(PATH, [{ name: 'some-other-file.pdf' }]), 'a different file going is not this one going');
ok((0, gymDocs_1.absentFromListing)(PATH, []), 'a folder that does not list it is a folder it has gone from');
ok(!(0, gymDocs_1.absentFromListing)(PATH, [{ name: BASE }]), 'a folder that still lists it is a delete that did not happen');
ok(!(0, gymDocs_1.absentFromListing)(PATH, null), 'and a listing that could not be read is not evidence of absence');
function fakeDb(opts) {
    const calls = { removed: [], listed: 0, deleted: [] };
    const sb = {
        from: (table) => ({
            delete: (_o) => ({
                eq: (_c, id) => {
                    calls.deleted.push(`${table}:${id}`);
                    return Promise.resolve({ error: opts.deleteError ?? null, count: opts.deleteCount ?? 1 });
                },
            }),
        }),
        storage: {
            from: (b) => {
                eq(b, gymDocs_1.GYM_DOCS_BUCKET, 'the file is looked for in the gym bucket');
                return {
                    remove: (paths) => {
                        calls.removed.push(paths);
                        return Promise.resolve({ data: opts.removeData ?? [{ name: paths[0] }], error: opts.removeError ?? null });
                    },
                    list: (_dir, _o) => {
                        calls.listed += 1;
                        return Promise.resolve({ data: opts.listData ?? [], error: opts.listError ?? null });
                    },
                };
            },
        },
    };
    return { sb, calls };
}
const threw = async (p) => {
    try {
        await p;
        return null;
    }
    catch (e) {
        return String(e?.message ?? e);
    }
};
void (async () => {
    {
        const { sb, calls } = fakeDb({});
        const why = await threw((0, gymDocs_1.deleteDocument)(sb, { id: 'doc-1', storagePath: PATH }));
        eq(why, null, 'the ordinary case removes both halves without complaint');
        eq(calls.removed.length, 1, 'the object is removed once');
        eq(calls.deleted[0], 'gym_documents:doc-1', 'and then the row');
    }
    {
        // The defect, restated: the object will not go, so nothing else may.
        const { sb, calls } = fakeDb({ removeError: { message: 'not authorised' } });
        const why = await threw((0, gymDocs_1.deleteDocument)(sb, { id: 'doc-1', storagePath: PATH }));
        ok(why != null && /still on file/.test(why), 'a file that will not delete is reported as still on file');
        eq(calls.deleted.length, 0, 'and the ROW is left alone — deleting it would hide the file from the only screen that could remove it');
    }
    {
        // Storage said nothing and the folder still lists it. That is a refusal
        // wearing a success's clothes, and it is exactly the shape wroteRows.ts
        // exists for.
        const { sb, calls } = fakeDb({ removeData: [], listData: [{ name: BASE }] });
        const why = await threw((0, gymDocs_1.deleteDocument)(sb, { id: 'doc-1', storagePath: PATH }));
        ok(why != null && /removed nothing/.test(why), 'an empty removal that the folder contradicts is refused');
        eq(calls.listed, 1, 'the folder is looked at rather than assumed');
        eq(calls.deleted.length, 0, 'and again the row survives');
    }
    {
        // The retry after a half-failure: the object went last time, the row did
        // not. Removing an absent object confirms absence and the row clears.
        const { sb, calls } = fakeDb({ removeData: [], listData: [] });
        const why = await threw((0, gymDocs_1.deleteDocument)(sb, { id: 'doc-1', storagePath: PATH }));
        eq(why, null, 'an object already absent is an object that has gone, so Remove can finish the job');
        eq(calls.deleted.length, 1, 'and the entry left pointing at nothing is cleared');
    }
    {
        const { sb } = fakeDb({ removeData: [], listError: { message: 'refused' } });
        const why = await threw((0, gymDocs_1.deleteDocument)(sb, { id: 'doc-1', storagePath: PATH }));
        ok(why != null && /cannot be confirmed gone is not gone/.test(why), 'a listing that could not be read is not permission to claim the file went');
    }
    {
        // The other half-failure: bytes gone, row stayed. The owner is told which
        // half is left rather than being told it is still on file, which would be
        // false in the direction that matters.
        const { sb } = fakeDb({ deleteCount: 0 });
        const why = await threw((0, gymDocs_1.deleteDocument)(sb, { id: 'doc-1', storagePath: PATH }));
        ok(why != null && /HAS been deleted from storage/.test(why), 'when only the row survives the owner is told the file has gone');
        ok(why != null && /Press Remove again/.test(why), 'and told how to finish it');
    }
    /* ── opening one ─────────────────────────────────────────────────────────── */
    function fakeOpen(opts) {
        const seen = { inserted: [], signed: 0 };
        const sb = {
            from: (table) => ({
                insert: (row) => {
                    eq(table, 'gym_document_reads', 'the read is recorded in its own table');
                    seen.inserted.push(row);
                    return Promise.resolve({ error: opts.insertError ?? null });
                },
            }),
            storage: {
                from: (_b) => ({
                    createSignedUrl: (p, ttl) => {
                        seen.signed += 1;
                        eq(ttl, gymDocs_1.SIGNED_URL_TTL_S, 'the link is short-lived');
                        return Promise.resolve({
                            data: opts.signError ? null : { signedUrl: `https://example.invalid/${p}` },
                            error: opts.signError ?? null,
                        });
                    },
                }),
            },
        };
        return { sb, seen };
    }
    {
        const { sb, seen } = fakeOpen({});
        const d = doc({ memberAttached: true, memberId: 'member-9', kind: 'contract', title: 'Signed agreement' });
        const url = await (0, gymDocs_1.openDocument)(sb, 'tenant-1', d, 'owner-1');
        ok(url.length > 0, 'a member document opens');
        eq(seen.inserted.length, 1, 'and leaves a record of having been opened');
        eq(seen.inserted[0].read_by, 'owner-1', 'naming who asked');
        eq(seen.inserted[0].document_id, 'doc-1', 'and which document');
        eq(seen.inserted[0].doc_title, 'Signed agreement', 'legibly enough to read after the document is gone');
    }
    {
        // The gate. If the record will not write, no link is cut at all.
        const { sb, seen } = fakeOpen({ insertError: { message: 'refused' } });
        const d = doc({ memberAttached: true, memberId: 'member-9', kind: 'incident', title: 'Fall, 14 Aug' });
        const why = await threw((0, gymDocs_1.openDocument)(sb, 'tenant-1', d, 'owner-1'));
        ok(why != null && /No link has been issued/.test(why), 'a read that cannot be recorded is refused');
        eq(seen.signed, 0, 'and no signed URL is minted — the log is a gate, not a receipt');
    }
    {
        // The building's paperwork is not logged. A fire certificate opened forty
        // times a week would bury the one line that matters.
        const { sb, seen } = fakeOpen({});
        await (0, gymDocs_1.openDocument)(sb, 'tenant-1', doc({ kind: 'certificate' }), 'owner-1');
        eq(seen.inserted.length, 0, 'opening a gym-wide certificate writes no access row');
        eq(seen.signed, 1, 'it just opens');
    }
    {
        const { sb } = fakeOpen({ signError: { message: 'gone' } });
        const why = await threw((0, gymDocs_1.openDocument)(sb, 'tenant-1', doc(), 'owner-1'));
        ok(why != null && /could not be opened/.test(why), 'a link that will not mint is reported rather than swallowed');
    }
    {
        const { sb, seen } = fakeOpen({});
        await (0, gymDocs_1.recordDocumentRead)(sb, 'tenant-1', doc({ memberAttached: true }), null);
        eq(seen.inserted[0].read_by, null, 'a null actor is written as null rather than invented — the database refuses it, which is the point');
    }
    if (errors.length) {
        console.error(`gymDocAccess: ${errors.length} failure(s)`);
        for (const e of errors)
            console.error(`  · ${e}`);
        process.exit(1);
    }
    console.log('gymDocAccess: all assertions passed');
})();
