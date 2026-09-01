'use client';

// Compliance — the paperwork, the filing cabinet and the log of who did what.
//
// Three things the product could not hold at all, and they are one screen
// because they are one question: what can this gym PRODUCE when somebody asks.
//
// ── What was missing ──────────────────────────────────────────────────────
//
//   1. NO MEMBERSHIP PAPERWORK. Grepping `app/(owner)` for waiver, contract,
//      consent, signature or PAR-Q returns nothing. `src/lib/waiver.ts` is the
//      Repple platform release a client agrees to with US, and
//      `src/lib/coachDocs.ts` is coach-issued and private to one coach and one
//      client. So an owner could not see who had signed what, and there was no
//      health questionnaire, guardian consent, photo consent or terms version
//      anywhere. An injury claim arrives and the gym cannot produce the waiver;
//      a sixteen-year-old is signed up and nothing records that a guardian ever
//      agreed.
//
//   2. NOWHERE TO PUT A DOCUMENT. The six storage buckets in this project are
//      photos, exercise-videos, exercise-demos, message-media, coach-docs and
//      injury-docs. Not one is the gym's, so a signed contract, an insurance
//      certificate, a service report or a photograph of a broken machine had no
//      home in the product at all.
//
//   3. NO AUDIT OF WHO DID WHAT. `gym_events` carried five trigger-written
//      kinds, all of them things that HAPPENED TO the gym — member joined,
//      session delivered — and none of them a thing somebody DID to the record.
//      Nothing recorded a payment being entered, a price being changed, a
//      membership being cancelled or a full export being taken off the
//      platform. And `studio-web` had no activity feed at all: the five kinds
//      were read on exactly one screen, on a phone, capped at a hundred rows.
//
// ── The one place this screen writes carefully ────────────────────────────
//
// The signature. Everything else here can be corrected; a signature is evidence
// and the name on it is what makes it evidence. It is stored as the person
// TYPED it, separately from `profiles.full_name`, so it survives them changing
// their display name or their account being erased — and the version they
// signed is denormalised onto the row, because a signature has to be legible
// from itself.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchMemberships, money, type Membership } from '@lib/gymRecord';
import { readTenant, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import {
  fetchAgreements, fetchSignatures, publishAgreement, recordSignature,
  agreementBlocker, signatureBlocker, nextVersion, outstandingFor,
  fetchDocuments, recordDocument, deleteDocument, documentBlocker, documentPath, expiring,
  AGREEMENT_KINDS, AGREEMENT_LABEL, AGREEMENT_NOTE, DOCUMENT_KINDS, DOCUMENT_LABEL,
  type Agreement, type AgreementKind, type Signature, type GymDocument, type DocumentKind,
} from '@lib/gymDocs';
import { assertWhole, capLimit } from '@lib/rowCap';
import { isoDate } from '@lib/format';

/**
 * What a read is when it holds no rows: still in flight, or refused.
 *
 * On this screen the distinction is sharper than usual. "Nobody has signed a
 * waiver" and "the signatures could not be read" render as the same empty table
 * unless something separates them — and the first is a reason to stop trading
 * until people sign, while the second is a reason to reload.
 */
type Unread = 'loading' | 'failed' | null;

interface Read<T> { rows: T[] | null; state: Unread; why: string | null }
const reading = <T,>(): Read<T> => ({ rows: null, state: 'loading', why: null });
const landed = <T,>(res: PromiseSettledResult<T[]>, what: string): Read<T> =>
  res.status === 'fulfilled'
    ? { rows: res.value, state: null, why: null }
    : { rows: null, state: 'failed', why: `Could not read ${what}${(res.reason as any)?.message ? `: ${(res.reason as any).message}` : '.'}` };

/** One row of `gym_events`, read for the console's first activity feed. */
interface Activity {
  id: string;
  kind: string;
  summary: string;
  actorId: string | null;
  actorName: string | null;
  at: string;
}

/** How far back the feed reads. Ninety days rather than "the last hundred rows"
 *  — a cap on ROWS answers "what happened lately" differently at a quiet gym
 *  and a busy one, and the busy one is the one being audited. */
const FEED_DAYS = 90;
const DAY = 86400000;

export default function Compliance() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymErr, setGymErr] = useState<string | null>(null);
  const [ccy, setCcy] = useState<TenantCurrency>(null);

  const [agreements, setAgreements] = useState<Read<Agreement>>(reading);
  const [signatures, setSignatures] = useState<Read<Signature>>(reading);
  const [documents, setDocuments] = useState<Read<GymDocument>>(reading);
  const [members, setMembers] = useState<Read<Membership>>(reading);
  const [feed, setFeed] = useState<Read<Activity>>(reading);

  const load = useCallback(async (tenantId: string) => {
    // allSettled, never all. A refused documents read must not empty the
    // signatures beside it — a gym would then be shown as having nobody signed
    // up to anything because a different table failed, which on this screen is
    // an instruction to stop letting people train.
    const [aRes, sRes, dRes, mRes, fRes] = await Promise.allSettled([
      fetchAgreements(supabase, tenantId),
      fetchSignatures(supabase, tenantId),
      fetchDocuments(supabase, tenantId),
      fetchMemberships(supabase, tenantId),
      fetchActivity(tenantId),
    ]);
    setAgreements(landed(aRes, 'the agreements this gym publishes'));
    setSignatures(landed(sRes, 'the signatures it holds'));
    setDocuments(landed(dRes, 'the documents on file'));
    setMembers(landed(mRes, 'the member roster'));
    setFeed(landed(fRes, 'the activity log'));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) return;
      const t = await readTenant(supabase, who.tenantId);
      if (!live) return;
      setGymName(t.name); setCcy(t.currency); setGymErr(t.error);
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/compliance">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/compliance">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          This is what the gym holds about everybody who trains here, and the log of everything
          anybody has done to its record. It is owner-only, and the database says the same thing
          independently.
        </p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId);

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/compliance">
      <h1>Compliance</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '78ch' }}>
        What this gym asks people to agree to, who has agreed to it, the documents it holds, and
        the log of what has been done to its record. Everything here is what the gym has to be able
        to produce when somebody asks — an insurer, a regulator, or the member themselves.
      </p>

      <Agreements
        agreements={agreements} signatures={signatures} members={members}
        tenantId={tenantId} me={me} onChange={refresh}
      />

      <Documents
        documents={documents} members={members} ccy={ccy}
        tenantId={tenantId} me={me} onChange={refresh}
      />

      <Feed feed={feed} />
    </Shell>
  );
}

/* ── the paperwork ─────────────────────────────────────────────────────────── */

function Agreements({ agreements, signatures, members, tenantId, me, onChange }: {
  agreements: Read<Agreement>; signatures: Read<Signature>; members: Read<Membership>;
  tenantId: string; me: Me; onChange: () => void;
}) {
  const [kind, setKind] = useState<AgreementKind>('waiver');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [required, setRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signing, setSigning] = useState<Agreement | null>(null);

  const live = (agreements.rows ?? []).filter((a) => a.active);
  const retired = (agreements.rows ?? []).filter((a) => !a.active);

  const roster = useMemo(() => {
    if (!members.rows) return null;
    return [...new Map(members.rows
      .filter((m) => m.memberId)
      .map((m) => [m.memberId, m.memberName] as const)).entries()]
      .map(([memberId, memberName]) => ({ memberId, memberName }))
      .sort((a, b) => (a.memberName ?? '').localeCompare(b.memberName ?? ''));
  }, [members.rows]);

  /**
   * Who has not signed what.
   *
   * Only computable when all three reads returned. A partial answer here is
   * worse than none: an owner reading a SHORT outstanding list concludes the
   * paperwork is nearly done, and the people missing from it are exactly the
   * ones nobody chases.
   */
  const outstanding = useMemo(() => (
    roster && agreements.rows && signatures.rows
      ? outstandingFor(roster, agreements.rows, signatures.rows)
      : null
  ), [roster, agreements.rows, signatures.rows]);

  const blocker = agreementBlocker(title, body);

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocker) { setErr(blocker); return; }
    if (!agreements.rows) {
      setErr('The existing agreements have not been read, so this console cannot tell what version number a new one would take. Reload before publishing.');
      return;
    }
    setBusy(true); setErr(null);
    try {
      await publishAgreement(supabase, tenantId, {
        kind, title, body,
        version: nextVersion(agreements.rows, kind),
        required,
        createdBy: me.id,
      });
      setTitle(''); setBody('');
      onChange();
    } catch (e: any) {
      setErr(`That was NOT published: ${e?.message ?? 'the write was refused'}. Whatever was in force before still is.`);
    } finally { setBusy(false); }
  };

  const signedFor = (a: Agreement) => (signatures.rows ?? []).filter((s) => s.agreementId === a.id).length;

  const cols: Column<Agreement>[] = [
    { key: 'kind', header: 'What it is', value: (a) => AGREEMENT_LABEL[a.kind] ?? a.kind },
    { key: 'title', header: 'Title', value: (a) => a.title },
    { key: 'v', header: 'Version', value: (a) => a.version, numeric: true },
    { key: 'required', header: 'Required', value: (a) => (a.required ? 1 : 0),
      render: (a) => a.required
        ? <span style={{ color: 'var(--ink2)' }}>to join</span>
        : <span style={{ color: 'var(--ink3)' }}>optional</span> },
    { key: 'signed', header: 'Signed by', value: (a) => (signatures.rows ? signedFor(a) : null), numeric: true,
      render: (a) => signatures.rows
        ? String(signedFor(a))
        : <span className="dash">not read</span> },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (a) => <button style={linkBtn} onClick={() => { setErr(null); setSigning(a); }}>Record a signature</button> },
  ];

  return (
    <Section
      title="What people agree to"
      sub="Versioned, and frozen once anybody signs. Editing publishes a new version and the old one stays — because the question in a dispute is what THIS person agreed to on THAT date, not what the document says today."
    >
      {agreements.why ? <Banner tone="crit">{agreements.why}</Banner> : null}
      {signatures.why ? <Banner tone="crit">{signatures.why} Every count in the Signed column is a dash for that reason, not a zero.</Banner> : null}
      {err ? <Banner tone="crit">{err}</Banner> : null}

      <form onSubmit={publish} style={{ ...formRow, alignItems: 'flex-start' }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as AgreementKind)}
                style={{ ...field, minWidth: 220 }} aria-label="What kind of agreement this is">
          {AGREEMENT_KINDS.map((k) => <option key={k} value={k}>{AGREEMENT_LABEL[k]}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
               style={{ ...field, flex: 2, minWidth: 200 }} aria-label="What this document is called" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink2)' }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          required to join
        </label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)}
                  placeholder="Paste the whole text. A summary of an agreement is worth nothing when it is disputed."
                  rows={5} style={{ ...field, width: '100%', fontFamily: 'var(--sans)', lineHeight: 1.5 }}
                  aria-label="The words of the agreement" />
        <button type="submit" disabled={busy || !!blocker} style={primaryBtn}>
          {agreements.rows && agreements.rows.some((a) => a.kind === kind) ? 'Publish a new version' : 'Publish'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '58ch' }}>
          {AGREEMENT_NOTE[kind]}
          {agreements.rows && agreements.rows.some((a) => a.kind === kind)
            ? ` Publishing retires the version in force and starts version ${nextVersion(agreements.rows, kind)}; every signature already given stays pointed at the version it was given for.`
            : ''}
        </span>
      </form>
      {blocker && (title || body) ? (
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: '#f0c04e', maxWidth: '74ch' }}>{blocker}</p>
      ) : null}

      {signing ? (
        <SignHere
          agreement={signing} roster={roster} tenantId={tenantId} me={me}
          onDone={() => { setSigning(null); onChange(); }}
          onCancel={() => setSigning(null)}
          onErr={setErr}
        />
      ) : null}

      {agreements.state === 'loading' ? <Loading /> : (
        <DataTable
          rows={live} columns={cols} rowKey={(a) => a.id}
          empty="This gym publishes nothing for anybody to sign. Nothing on this screen can then say who has agreed to what, because there is nothing to agree to."
        />
      )}

      {retired.length ? (
        <div style={{ padding: '11px 14px', borderTop: '1px solid var(--ring)' }}>
          <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>Superseded versions — {retired.length}</h3>
          <p style={{ margin: '4px 0 8px', color: 'var(--ink3)', fontSize: 12, maxWidth: '76ch' }}>
            Kept, and kept unchanged. Every signature given against one of these still points at it,
            which is the whole reason the wording is frozen the moment somebody signs.
          </p>
          <ul style={{ margin: 0, padding: '0 0 0 18px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.6 }}>
            {retired.map((a) => (
              <li key={a.id}>
                {AGREEMENT_LABEL[a.kind] ?? a.kind} v{a.version} &mdash; {a.title}
                {signatures.rows ? ` · ${signedFor(a)} signature${signedFor(a) === 1 ? '' : 's'}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Outstanding rows={outstanding} live={live.length} />
    </Section>
  );
}

/** Who is training here without having signed what the gym requires. */
function Outstanding({ rows, live }: { rows: ReturnType<typeof outstandingFor> | null; live: number }) {
  return (
    <div style={{ borderTop: '1px solid var(--ring)' }}>
      <div style={{ padding: '11px 14px' }}>
        <h3 style={{ fontSize: 13, margin: 0, color: rows && rows.length ? 'var(--crit)' : 'var(--ink2)' }}>
          Not signed {rows ? `— ${rows.length} member${rows.length === 1 ? '' : 's'}` : ''}
        </h3>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12, maxWidth: '78ch' }}>
          Members on the roster with no signature against a version that is live AND required.
          Signing version 1 does not cover version 2 — that is the entire reason versions exist, and
          it is why republishing terms puts everybody back on this list.
        </p>
      </div>
      {rows === null ? (
        <div style={{ padding: '0 14px 14px', color: 'var(--ink2)', fontSize: 13, maxWidth: '78ch' }}>
          Withheld. This needs the roster, the agreements and the signatures, and one of them has
          not returned — a SHORT list here is worse than none, because it reads as paperwork nearly
          finished and the people missing from it are exactly the ones nobody would chase.
        </div>
      ) : live === 0 ? (
        <div style={{ padding: '0 14px 14px', color: 'var(--ink3)', fontSize: 13 }}>
          Nothing is required, so nobody is outstanding. That is not a clean bill of health.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: '0 14px 14px 32px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.7 }}>
          {rows.length === 0
            ? <li style={{ listStyle: 'none', marginLeft: -14, color: 'var(--ink3)' }}>Everybody on the roster has signed everything this gym requires.</li>
            : rows.map((o) => (
                <li key={o.memberId}>
                  {o.memberName ?? <span className="dash">unnamed member</span>} &mdash;{' '}
                  {o.missing.map((a) => `${AGREEMENT_LABEL[a.kind] ?? a.kind} v${a.version}`).join(', ')}
                </li>
              ))}
        </ul>
      )}
    </div>
  );
}

function SignHere({ agreement, roster, tenantId, me, onDone, onCancel, onErr }: {
  agreement: Agreement;
  roster: Array<{ memberId: string; memberName: string | null }> | null;
  tenantId: string; me: Me; onDone: () => void; onCancel: () => void; onErr: (s: string | null) => void;
}) {
  const [memberId, setMemberId] = useState('');
  const [signedName, setSignedName] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianRel, setGuardianRel] = useState('');
  const [busy, setBusy] = useState(false);

  const blocker = signatureBlocker(memberId, signedName, agreement.kind, guardianName);

  const go = async () => {
    if (blocker) { onErr(blocker); return; }
    setBusy(true);
    try {
      await recordSignature(supabase, tenantId, {
        agreementId: agreement.id,
        memberId,
        signedName,
        versionSigned: agreement.version,
        witnessedBy: me.id,
        guardianName: agreement.kind === 'guardian_consent' ? guardianName : null,
        guardianRelationship: agreement.kind === 'guardian_consent' ? guardianRel : null,
      });
      onErr(null);
      onDone();
    } catch (e: any) {
      onErr(`That signature was NOT recorded: ${e?.message ?? 'the write was refused'}. Nothing is on file and this person has still signed nothing.`);
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      margin: '0 14px 14px', padding: '12px 14px', background: 'var(--surface2)',
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--brand)',
    }}>
      <div className="micro">{AGREEMENT_LABEL[agreement.kind]} v{agreement.version} — {agreement.title}</div>
      <p style={{ margin: '7px 0 10px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '76ch' }}>
        Recorded as a simple electronic signature: the name they typed, the moment, and the version
        they were shown. That is what eIDAS Article 25 and the UK Electronic Communications Act make
        admissible &mdash; a drawn squiggle on a phone is not more binding and is considerably more
        storage. The name is kept apart from their account name on purpose: the name on a waiver
        <em> is</em> the waiver, and it must survive them renaming themselves or being erased.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}
                style={{ ...field, minWidth: 200 }} aria-label="Who is signing">
          <option value="">{roster === null ? 'The roster could not be read' : 'Who is signing?'}</option>
          {(roster ?? []).map((m) => (
            <option key={m.memberId} value={m.memberId}>{m.memberName ?? m.memberId}</option>
          ))}
        </select>
        <input value={signedName} onChange={(e) => setSignedName(e.target.value)}
               placeholder="The name they signed with"
               style={{ ...field, flex: 2, minWidth: 200 }} aria-label="The name they signed with" />
        {agreement.kind === 'guardian_consent' ? (
          <>
            <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)}
                   placeholder="Guardian's name" style={{ ...field, minWidth: 170 }}
                   aria-label="The name of the adult giving consent" />
            <input value={guardianRel} onChange={(e) => setGuardianRel(e.target.value)}
                   placeholder="Relationship" style={{ ...field, width: 150 }}
                   aria-label="Their relationship to the member" />
          </>
        ) : null}
        <button onClick={go} disabled={busy || !!blocker} style={primaryBtn}>
          {busy ? 'Recording…' : 'Record it'}
        </button>
        <button onClick={onCancel} style={{ ...linkBtn, color: 'var(--ink3)' }}>Cancel</button>
      </div>
      {blocker ? <p style={{ margin: '9px 0 0', fontSize: 12.5, color: '#f0c04e', maxWidth: '70ch' }}>{blocker}</p> : null}
    </div>
  );
}

/* ── the filing cabinet ────────────────────────────────────────────────────── */

function Documents({ documents, members, ccy, tenantId, me, onChange }: {
  documents: Read<GymDocument>; members: Read<Membership>; ccy: TenantCurrency;
  tenantId: string; me: Me; onChange: () => void;
}) {
  const [kind, setKind] = useState<DocumentKind>('insurance');
  const [title, setTitle] = useState('');
  const [memberId, setMemberId] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const today = isoDate(new Date());
  const soon = documents.rows ? expiring(documents.rows, today) : null;
  const blocker = documentBlocker(title, file);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocker || !file) { setErr(blocker); return; }
    setBusy(true); setErr(null);
    const path = documentPath(tenantId, file.name);
    try {
      // The OBJECT first, the row second. A row pointing at a file that does not
      // exist is a document the register says the gym holds and cannot produce
      // — a false statement in a compliance record. An orphaned object in the
      // bucket is invisible and costs storage, which is the cheaper failure.
      const up = await supabase.storage.from('gym-docs').upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (up.error) throw up.error;
      await recordDocument(supabase, tenantId, {
        kind, title, storagePath: path,
        mime: file.type || null, sizeBytes: file.size,
        memberId: memberId || null,
        expiresOn: expiresOn || null,
        uploadedBy: me.id,
      });
      setTitle(''); setFile(null); setExpiresOn('');
      onChange();
    } catch (e: any) {
      setErr(`That file was NOT filed: ${e?.message ?? 'the upload was refused'}. Nothing has been added to the record.`);
    } finally { setBusy(false); }
  };

  const open = async (d: GymDocument) => {
    // A signed URL, because the bucket is private. Sixty seconds is enough to
    // open one and short enough that a link pasted into a chat is dead before
    // anybody clicks it.
    const { data, error } = await supabase.storage.from('gym-docs').createSignedUrl(d.storagePath, 60);
    if (error || !data?.signedUrl) {
      setErr(`That file could not be opened: ${error?.message ?? 'no link came back'}. The record of it is still here; the object may have been removed from storage.`);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const cols: Column<GymDocument>[] = [
    { key: 'kind', header: 'Kind', value: (d) => DOCUMENT_LABEL[d.kind] },
    { key: 'title', header: 'Title', value: (d) => d.title,
      render: (d) => <button style={linkBtn} onClick={() => open(d)}>{d.title}</button> },
    { key: 'expires', header: 'Expires', value: (d) => d.expiresOn,
      render: (d) => d.expiresOn == null
        ? <span className="dash">no expiry recorded</span>
        : <span style={{ color: d.expiresOn <= today ? 'var(--crit)' : undefined }}>{d.expiresOn}</span> },
    { key: 'size', header: 'Size', value: (d) => d.sizeBytes, numeric: true,
      render: (d) => d.sizeBytes == null ? <span className="dash">—</span> : `${(d.sizeBytes / 1024).toFixed(0)} KB` },
    { key: 'who', header: 'Filed by', value: (d) => d.uploadedByName },
    { key: 'when', header: 'Filed', value: (d) => d.uploadedAt,
      render: (d) => new Date(d.uploadedAt).toLocaleDateString() },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (d) => (
        <button
          style={{ ...linkBtn, color: 'var(--ink3)' }}
          onClick={() => deleteDocument(supabase, d.id)
            .then(() => { setErr(null); onChange(); })
            .catch((e: any) => setErr(`That document was not removed: ${e?.message ?? 'the delete was refused'}. It is still on file.`))}
        >
          Remove
        </button>
      ) },
  ];

  const roster = (members.rows ?? []).filter((m) => m.memberName);

  return (
    <Section
      title="Documents"
      sub="A signed contract, an insurance schedule, an engineer's report, a photograph of a broken machine. Private to this gym's staff; the file itself is opened through a link that expires in a minute."
    >
      {documents.why ? <Banner tone="crit">{documents.why}</Banner> : null}
      {err ? <Banner tone="crit">{err}</Banner> : null}

      {soon && soon.length ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>
            {soon.length} document{soon.length === 1 ? '' : 's'} {soon.length === 1 ? 'has' : 'have'} expired or expire within 30 days
          </strong>{' '}
          — {soon.map((d) => `${d.title} (${d.expiresOn})`).join(', ')}. An insurance schedule that
          lapsed is not a filing problem; it is a gym trading uninsured.
        </Banner>
      ) : null}

      <form onSubmit={upload} style={formRow}>
        <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}
                style={{ ...field, minWidth: 160 }} aria-label="What kind of document this is">
          {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{DOCUMENT_LABEL[k]}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What it is"
               style={{ ...field, flex: 2, minWidth: 180 }} aria-label="What this document is" />
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}
                style={{ ...field, minWidth: 180 }} aria-label="Who it is about, if anybody">
          <option value="">Not about a member</option>
          {roster.map((m) => <option key={m.memberId} value={m.memberId}>{m.memberName}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink3)', fontSize: 12.5 }}>
          expires
          <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)}
                 style={{ ...field, width: 148 }} aria-label="When what this evidences expires" />
        </label>
        <input type="file" accept=".pdf,image/jpeg,image/png,image/webp"
               onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }}
               style={{ ...field, padding: '6px 8px' }} aria-label="The file" />
        <button type="submit" disabled={busy || !!blocker} style={primaryBtn}>
          {busy ? 'Filing…' : 'File it'}
        </button>
      </form>
      <p style={{ margin: '0 14px 12px', fontSize: 12, color: 'var(--ink3)', maxWidth: '80ch' }}>
        PDF, JPEG, PNG or WebP, up to 25 MB. Leave the expiry empty where the document does not
        expire &mdash; a blank there means &ldquo;does not expire, or nobody has said&rdquo;, and
        nothing here invents a date. {ccy ? null : `This gym has not set its currency, so a cost cannot be recorded against a service report — ${NO_CURRENCY_NOTE}.`}
      </p>
      {blocker && (title || file) ? (
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: '#f0c04e', maxWidth: '74ch' }}>{blocker}</p>
      ) : null}

      {documents.state === 'loading' ? <Loading /> : (
        <DataTable
          rows={documents.rows ?? []} columns={cols} rowKey={(d) => d.id}
          empty="Nothing is on file. Until this wave there was nowhere in the product to put a document at all, so an empty list here is expected rather than alarming — the first insurance certificate is the one worth adding."
        />
      )}
    </Section>
  );
}

/* ── who did what ─────────────────────────────────────────────────────────── */

/**
 * The console's first activity feed.
 *
 * `gym_events` is written by database TRIGGERS and by nothing else — no role can
 * insert into it, and the writer functions are SECURITY DEFINER. That is what
 * makes it worth reading: the log cannot drift from the data because it is
 * written by the data, and the audited party cannot forge it.
 *
 * What it still cannot do is worth saying beside it, and the section says so:
 * there is no MFA anywhere in this repo and no re-auth in front of the money
 * screens, so this records who was SIGNED IN, not who was at the keyboard.
 */
function Feed({ feed }: { feed: Read<Activity> }) {
  const [kind, setKind] = useState('');
  const rows = (feed.rows ?? []).filter((e) => !kind || e.kind === kind);
  const kinds = useMemo(
    () => [...new Set((feed.rows ?? []).map((e) => e.kind))].sort(),
    [feed.rows],
  );

  const cols: Column<Activity>[] = [
    { key: 'at', header: 'When', value: (e) => e.at,
      render: (e) => new Date(e.at).toLocaleString() },
    { key: 'kind', header: 'What', value: (e) => e.kind,
      render: (e) => <span className="mono" style={{ fontSize: 11.5 }}>{e.kind}</span> },
    { key: 'summary', header: 'Detail', value: (e) => e.summary },
    { key: 'who', header: 'By', value: (e) => e.actorName,
      // A null actor is not an unknown person — it is nobody signed in: a
      // webhook, a scheduled job, the service role. Saying so is more useful
      // than a dash and far more useful than naming the owner by default.
      render: (e) => e.actorId
        ? (e.actorName ?? <span className="dash">a name that could not be read</span>)
        : <span style={{ color: 'var(--ink3)' }}>not a signed-in person</span> },
  ];

  return (
    <Section
      title="What has been done to this record"
      sub={`The last ${FEED_DAYS} days. Written by the database as things happen, so nothing here was typed by anyone and nothing can be missed by a screen forgetting to record it.`}
    >
      {feed.why ? <Banner tone="crit">{feed.why}</Banner> : null}
      {kinds.length > 1 ? (
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...field, minWidth: 220 }}
                  aria-label="Filter the log by what happened">
            <option value="">Everything — {feed.rows?.length ?? 0} entries</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k} — {(feed.rows ?? []).filter((e) => e.kind === k).length}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {feed.state === 'loading' ? <Loading /> : (
        <DataTable
          rows={rows} columns={cols} rowKey={(e) => e.id}
          empty={`Nothing has been recorded in ${FEED_DAYS} days. On a gym that is being used, that is a database whose triggers have not been applied rather than a quiet quarter.`}
        />
      )}
      <p style={{ margin: 0, padding: '11px 14px', borderTop: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '80ch' }}>
        This says who was SIGNED IN, not who was at the keyboard. There is no multi-factor
        authentication anywhere in this product and nothing re-authenticates in front of the money
        screens, so a shared laptop left open is a gap this log cannot see and does not claim to.
      </p>
    </Section>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * The activity log for the last ninety days.
 *
 * Bounded by DATE and not by row count. `app/(owner)/ops.tsx` reads the same
 * table capped at a hundred rows, which answers "what happened lately"
 * differently at a quiet gym and a busy one — and the busy one is the gym being
 * audited. Capped as well, and refusing: a truncated audit log is one that has
 * silently lost its oldest entries, which on this screen is the half somebody
 * came looking for.
 */
async function fetchActivity(tenantId: string): Promise<Activity[]> {
  const since = new Date(Date.now() - FEED_DAYS * DAY).toISOString();
  const { data, error } = await supabase
    .from('gym_events')
    .select('id, kind, summary, actor_id, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  const rows = assertWhole(data, `this gym's activity in the last ${FEED_DAYS} days`);
  if (!rows.length) return [];

  const ids = [...new Set(rows.map((r: any) => r.actor_id).filter((x: any): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    // eslint-disable-next-line -- no-error-ok: an unreadable name renders as its own sentence beside the entry; the entry is still legible
    const { data: ps } = await supabase.from('profiles').select('id, full_name').in('id', ids).limit(capLimit());
    for (const p of (ps ?? []) as any[]) {
      const n = (p.full_name || '').trim();
      if (n) names.set(p.id, n);
    }
  }

  return rows.map((r: any) => ({
    id: r.id,
    kind: r.kind,
    summary: r.summary,
    actorId: r.actor_id ?? null,
    actorName: r.actor_id ? names.get(r.actor_id) ?? null : null,
    at: r.created_at,
  }));
}

/* ── bits (the same shapes as every other console page) ────────────────────── */

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const linkBtn = {
  background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer',
  fontSize: 12.5, padding: 0, fontFamily: 'var(--sans)', textAlign: 'left' as const,
} as const;

const formRow = {
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '84ch' }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone?: 'crit' }) {
  return (
    <div style={{
      margin: '14px', padding: '11px 14px', borderRadius: 0, background: 'var(--surface2)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13, maxWidth: '84ch',
    }}>{children}</div>
  );
}

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
