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
//   2. NOWHERE TO PUT A DOCUMENT. The six storage buckets in the project AT
//      THAT POINT were photos, exercise-videos, exercise-demos, message-media,
//      coach-docs and injury-docs. Not one was the gym's, so a signed contract,
//      an insurance certificate, a service report or a photograph of a broken
//      machine had no home in the product at all.
//
//      That sentence was written in the present tense and is left here in the
//      past, because both halves of it have moved: `gym-docs` (part 185) is
//      that home and is what this screen files into, and `storage.buckets`
//      holds ELEVEN today — the six above plus gym-docs, avatars (961),
//      coach-logos (330), share-cards (400) and scans (empty and unused, part
//      1122). Counted live on 3 Sep 2026. Anyone reaching for the number six
//      from this paragraph is reading a fact about a day that has passed.
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
//
// ── And the thing it wrote that was not true ──────────────────────────────
//
// The form below is a <select> of the roster beside a text box, filled in by
// whoever is at the desk. There was no member-side path anywhere in the
// product, so EVERY signature this gym held was a member of staff typing the
// member's name, and this screen called all of them "Signed by".
//
// That is a labelling defect rather than a worthless record — a signature taken
// at a desk is a staff attestation, which is an ordinary and useful business
// record — so the fix is to stop the record claiming to be the other thing.
// supabase/parts/520 derives `attribution` in the database from auth.uid(), the
// "Given by the member" column and the How These Were Given panel show the
// split, and the member's own path is app/(client)/agreements.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate, Loading } from '@/components/Gate';
import { type Unread, type Read, reading } from '@/lib/read';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchMemberships, money, type Membership } from '@lib/gymRecord';
// The reader's locale, the GYM's zone. A signature date and a document's filing
// date are evidence; the day they fall on is a fact about the gym, and this page
// was drawing both on whichever laptop was open.
import { gymDateText, gymDateTimeText } from '@lib/gymWhen';
import { readTenant, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import {
  fetchAgreements, fetchSignatures, publishAgreement, recordSignature,
  agreementBlocker, signatureBlocker, nextVersion, outstandingFor,
  fetchDocuments, recordDocument, deleteDocument, documentBlocker, documentPath, expiring,
  openDocument, discardUnfiledObject, documentAudience, AUDIENCE_LABEL,
  AGREEMENT_KINDS, AGREEMENT_LABEL, AGREEMENT_NOTE, DOCUMENT_KINDS, DOCUMENT_LABEL,
  type Agreement, type AgreementKind, type Signature, type GymDocument, type DocumentKind,
} from '@lib/gymDocs';
import {
  tallyAttribution, ATTRIBUTION_LABEL, ATTRIBUTION_NOTE,
  type AttributionTally,
} from '@lib/gymSigning';
import { capLimit, readAll } from '@lib/rowCap';
// The actor ids behind the filing feed are not bounded by the row cap — see
// the note in `fetchFeed`. One chunk size, in src/lib/idLookup.ts.
import { chunkIds, uniqueIds } from '@lib/idLookup';
import { isoDate } from '@lib/format';
// The gym's calendar day. A certificate's `expires_on` is a bare day somebody
// entered on the gym's clock, so the "today" it is compared against is that
// clock and not whichever laptop is open.
import { gymDay } from '@lib/gymZone';
import { Banner as SharedBanner, type BannerTone } from '@/components/Banner';

/**
 * What a read is when it holds no rows: still in flight, or refused.
 *
 * On this screen the distinction is sharper than usual. "Nobody has signed a
 * waiver" and "the signatures could not be read" render as the same empty table
 * unless something separates them — and the first is a reason to stop trading
 * until people sign, while the second is a reason to reload.
 */

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
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymErr, setGymErr] = useState<string | null>(null);
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);

  /**
   * How long this gym keeps a financial record, per its own jurisdiction.
   *
   * `tenants.record_retention_years` was added by supabase/parts/184 with a
   * 1-to-30 check and a comment saying, in as many words, that NULL means the
   * gym has not said, that records are then kept indefinitely, and that "the
   * compliance screen states that". Nothing in the repository read the column
   * and nothing offered a way to set it, so a gym in a seven-year jurisdiction
   * and a gym in a three-year one were treated identically and the statement
   * the schema promised was made nowhere.
   *
   * Four states, and they are all different: still reading, the read failed,
   * the gym has not said, and a number. `undefined` is in flight, null inside
   * a settled read is the gym's own silence.
   */
  const [retentionYears, setRetentionYears] = useState<number | null | undefined>(undefined);
  const [retentionErr, setRetentionErr] = useState<string | null>(null);

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

  /**
   * Read separately from `readTenant`, which is shared with five other screens
   * and has no business growing a column only this one asks about. The error is
   * read off the result rather than dropped: supabase-js resolves on a database
   * error, and a refused read arriving as `data: null` would be
   * indistinguishable from a gym that has not stated a period — which is the
   * one distinction this whole section is about.
   */
  const readRetention = useCallback(async (tenantId: string) => {
    const { data, error } = await supabase
      .from('tenants').select('record_retention_years').eq('id', tenantId).single();
    if (error) {
      setRetentionYears(undefined);
      setRetentionErr((error as any)?.message ?? 'The retention period could not be read.');
      return;
    }
    setRetentionErr(null);
    const raw = (data as { record_retention_years?: number | null } | null)?.record_retention_years;
    setRetentionYears(typeof raw === 'number' ? raw : null);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      // Not `null`. Signed out and unreachable are different facts and they
      // send a person to two different places — see ME_UNREADABLE.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);
      if (!who?.tenantId) return;
      const t = await readTenant(supabase, who.tenantId);
      if (!live) return;
      setGymName(t.name); setCcy(t.currency); setZone(t.zone); setGymErr(t.error);
      await readRetention(who.tenantId);
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load, readRetention]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

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

      <Retention
        years={retentionYears} why={retentionErr} tenantId={tenantId}
        onChange={() => readRetention(tenantId)}
      />

      <Agreements
        agreements={agreements} signatures={signatures} members={members}
        tenantId={tenantId} me={me} onChange={refresh}
      />

      <Documents
        documents={documents} members={members} ccy={ccy} zone={zone}
        tenantId={tenantId} me={me} onChange={refresh}
      />

      <Feed feed={feed} zone={zone} />
    </Shell>
  );
}

/* ── how long the record is kept ───────────────────────────────────────────── */

/** The range `tenants_retention_sane` permits. Stated here so the form cannot
 *  offer a number the database will refuse without saying why. */
const RETENTION_MIN = 1;
const RETENTION_MAX = 30;

/**
 * The statement supabase/parts/184 said this screen would make.
 *
 * ── Why there is no default ──────────────────────────────────────────────
 *
 * Because no number this product invented would be the law anywhere in
 * particular. Six years in England, five in the UAE, seven in much of the
 * United States, three in parts of the EU — a product that picked one would be
 * telling a gym its legal obligation, wrongly, on the screen it opens when a
 * regulator asks. So the unset state is stated rather than filled in, and what
 * it means is stated with it: records are kept indefinitely until the gym says
 * otherwise, which is the safe direction to be wrong in.
 */
function Retention({ years, why, tenantId, onChange }: {
  years: number | null | undefined; why: string | null; tenantId: string; onChange: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const save = async (value: number | null) => {
    setBusy(true); setMsg(null);
    // Counted, because an UPDATE matching zero rows is not an error — see
    // src/lib/wroteRows.ts. `tenants_owner_rw` is the only write policy on this
    // table, so a trainer who reached this form changes nothing and would
    // otherwise be told the period was saved.
    const { error, count } = await supabase
      .from('tenants')
      .update({ record_retention_years: value }, { count: 'exact' })
      .eq('id', tenantId);
    setBusy(false);
    if (error) {
      setMsg(`That was NOT saved: ${error.message}. The period is unchanged.`);
      return;
    }
    if (!count) {
      setMsg('That was NOT saved — the database refused the write and said nothing was changed. The period is unchanged.');
      return;
    }
    setMsg(null); setEditing(false); setDraft('');
    onChange();
  };

  const n = Number(draft);
  const blocker = draft.trim() === ''
    ? 'Type a number of years.'
    : !Number.isInteger(n) || n < RETENTION_MIN || n > RETENTION_MAX
      ? `A retention period is a whole number of years between ${RETENTION_MIN} and ${RETENTION_MAX}. The database refuses anything else.`
      : null;

  return (
    <Section
      title="How long this gym keeps its records"
      sub="A financial record is kept for as long as the gym's own jurisdiction requires. Nothing here deletes anything on a date — an erasure request is actioned by a person, and this is the period they judge it against."
    >
      {why ? <Banner tone="crit">Could not read the retention period: {why}</Banner> : null}
      {msg ? <Banner tone="crit">{msg}</Banner> : null}

      <p style={{ margin: 0, padding: '12px 14px', fontSize: 13, color: 'var(--ink2)', maxWidth: '84ch' }}>
        {years === undefined && !why ? 'Reading…'
          : why ? 'Unknown — the read failed, which is not the same as a gym that has not said.'
          : years === null ? (
            <>
              <strong style={{ color: 'var(--ink)' }}>This gym has not stated a retention period,
              so its records are kept indefinitely.</strong>{' '}
              That is deliberate rather than a gap: no number this product invented would be the law
              anywhere in particular, and keeping too much is the safe direction to be wrong in.
              Six years in England, five in the UAE, three in parts of the EU — say which applies
              here and every invoice and payment carries the date it may be destroyed after.
            </>
          ) : (
            <>
              <strong style={{ color: 'var(--ink)' }}>
                {years} {years === 1 ? 'year' : 'years'}
              </strong>{' '}
              from the date a record was raised. An invoice or a payment reaches the end of that
              period and becomes destroyable; nothing destroys it automatically, and nothing here is
              a timer.
            </>
          )}
      </p>

      <div style={{ ...formRow, borderBottom: 'none' }}>
        {editing || years === null ? (
          <>
            <input
              value={draft} onChange={(e) => setDraft(e.target.value)}
              inputMode="numeric" placeholder="Years"
              aria-label="How many years this gym keeps its records"
              style={{ ...field, width: 100 }}
            />
            <button disabled={busy || !!blocker} onClick={() => void save(n)} style={primaryBtn}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {years !== null && years !== undefined ? (
              <button onClick={() => { setEditing(false); setDraft(''); setMsg(null); }}
                      style={{ ...linkBtn, color: 'var(--ink3)' }}>Cancel</button>
            ) : null}
            {blocker && draft.trim() ? (
              <span style={{ fontSize: 12.5, color: 'var(--warn)', maxWidth: '60ch' }}>{blocker}</span>
            ) : null}
          </>
        ) : (
          <>
            <button onClick={() => { setEditing(true); setDraft(String(years ?? '')); }} style={primaryBtn}>
              Change it
            </button>
            {/* Clearing it is not a deletion, it is the gym withdrawing a
                statement — and what follows is stated rather than implied. */}
            <button disabled={busy} onClick={() => void save(null)} style={{ ...linkBtn, color: 'var(--ink3)' }}>
              Say nothing instead, and keep records indefinitely
            </button>
          </>
        )}
      </div>
    </Section>
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

  const signaturesFor = (a: Agreement) => (signatures.rows ?? []).filter((s) => s.agreementId === a.id);
  const signedFor = (a: Agreement) => signaturesFor(a).length;
  /**
   * How many of this version's signatures the MEMBER actually gave.
   *
   * Split out rather than folded into the count beside it, because until
   * supabase/parts/520 every signature this product held was a member of staff
   * typing the member's name and every screen — this one included — called all
   * of them "signed by". One number could not say which, so it said the
   * flattering thing by default.
   */
  const byMemberFor = (a: Agreement) => signaturesFor(a).filter((s) => s.attribution === 'member').length;

  const cols: Column<Agreement>[] = [
    { key: 'kind', header: 'What it is', value: (a) => AGREEMENT_LABEL[a.kind] ?? a.kind },
    { key: 'title', header: 'Title', value: (a) => a.title },
    { key: 'v', header: 'Version', value: (a) => a.version, numeric: true },
    { key: 'required', header: 'Required', value: (a) => (a.required ? 1 : 0),
      render: (a) => a.required
        ? <span style={{ color: 'var(--ink2)' }}>to join</span>
        : <span style={{ color: 'var(--ink3)' }}>optional</span> },
    { key: 'signed', header: 'Signatures held', value: (a) => (signatures.rows ? signedFor(a) : null), numeric: true,
      render: (a) => signatures.rows
        ? String(signedFor(a))
        : <span className="dash">not read</span> },
    { key: 'own', header: 'Given by the member', value: (a) => (signatures.rows ? byMemberFor(a) : null), numeric: true,
      render: (a) => {
        if (!signatures.rows) return <span className="dash">not read</span>;
        const own = byMemberFor(a);
        const all = signedFor(a);
        return (
          <span style={{ color: own === all ? 'var(--ink2)' : 'var(--ink3)' }}>
            {own}{all ? ` of ${all}` : ''}
          </span>
        );
      } },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (a) => <button style={linkBtn} onClick={() => { setErr(null); setSigning(a); }}>Record one at the desk</button> },
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
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '74ch' }}>{blocker}</p>
      ) : null}

      {signing ? (
        <SignHere
          agreement={signing} roster={roster} tenantId={tenantId} me={me}
          onDone={() => { setSigning(null); onChange(); }}
          onCancel={() => setSigning(null)}
          onErr={setErr}
        />
      ) : null}

      {agreements.state === 'loading' ? <Loading />
        : agreements.state === 'failed' ? (
          <Unread
            why={agreements.why} what="what this gym publishes for signing"
            cost="an owner asked for their waiver must not be told the gym publishes nothing over a query that errored"
          />
        ) : (
          <DataTable noun="agreements"
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

      <HowGiven read={signatures} />
      <Outstanding rows={outstanding} live={live.length} />
    </Section>
  );
}

/**
 * Who actually gave the signatures this gym holds.
 *
 * The panel this screen most needed and did not have. Every other figure here
 * answers "has this been signed"; this one answers "by whom", and until
 * supabase/parts/520 the second question had no answer at all — a signature was
 * a member of staff typing the member's name into the box below, in every case,
 * and the record could not say so.
 *
 * Counts and not a percentage. "84% member-signed" invites an owner to read the
 * remainder as rounding, and the remainder is precisely the part of the filing
 * cabinet that would not survive being asked about.
 */
function HowGiven({ read }: { read: Read<Signature> }) {
  const tally: AttributionTally | null = read.rows ? tallyAttribution(read.rows) : null;
  const kinds = ['member', 'staff', 'unknown'] as const;
  return (
    <div style={{ borderTop: '1px solid var(--ring)' }}>
      <div style={{ padding: '11px 14px' }}>
        <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>How these were given</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12, maxWidth: '78ch' }}>
          A signature the member gave from their own account and a signature somebody at the desk
          entered for them are both real records, and they are not the same record. This console used
          to write only the second kind and call it the first.
        </p>
      </div>
      {tally === null ? (
        <div style={{ padding: '0 14px 14px', color: 'var(--ink2)', fontSize: 13, maxWidth: '78ch' }}>
          {read.state === 'loading'
            ? 'Reading.'
            : 'The signatures could not be read, so this says nothing about how any of them were given. It is not a statement that the gym holds none.'}
        </div>
      ) : tally.total === 0 ? (
        <div style={{ padding: '0 14px 14px', color: 'var(--ink3)', fontSize: 13 }}>
          This gym holds no signatures at all.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: '0 14px 14px', listStyle: 'none' }}>
          {kinds.map((k) => (
            <li key={k} style={{ marginTop: 8, maxWidth: '80ch' }}>
              <span style={{
                fontSize: 13,
                color: k === 'member' ? 'var(--ink)' : k === 'unknown' ? 'var(--ink3)' : 'var(--ink2)',
              }}>
                <strong style={{ fontWeight: 600 }}>{tally[k]}</strong> &mdash; {ATTRIBUTION_LABEL[k]}
              </span>
              <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.55, marginTop: 2 }}>
                {ATTRIBUTION_NOTE[k]}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
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
      // Two refusals from supabase/parts/520 arrive here and neither is a
      // fault: recording a signature for YOURSELF is refused because that would
      // be staff writing a member-attributed row, and a version mismatch means
      // this console is holding wording the gym has since replaced.
      const why = memberId === me.id
        ? 'You cannot record your own signature from the desk — that would file a staff entry as though you had signed it yourself. Sign it in the app, from your own account.'
        : `That signature was NOT recorded: ${e?.message ?? 'the write was refused'}. Nothing is on file and this person has still signed nothing.`;
      onErr(why);
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      margin: '0 14px 14px', padding: '12px 14px', background: 'var(--surface2)',
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--brand)',
    }}>
      <div className="micro">{AGREEMENT_LABEL[agreement.kind]} v{agreement.version} — {agreement.title}</div>
      <p style={{ margin: '7px 0 10px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '76ch' }}>
        This records that <em>you</em> took their signature, not that they gave it. The row is
        attributed to staff by the database from your session, and it says so on the row and in the
        column above &mdash; there is no argument to this form that would make it say otherwise, and
        that is deliberate: what a gym had here before was a member of staff typing a member&rsquo;s
        name into a box, filed as though the member had signed.
      </p>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '76ch' }}>
        It is still a proper record &mdash; a staff attestation that this person agreed, taken at the
        desk, which is what a gym with a clipboard has always had. The stronger one is the member
        agreeing in the app from their own account, which they can now do without anybody at
        reception, and which is what the &ldquo;Given by the member&rdquo; column counts. Use this
        when the member is standing in front of you and the app is not.
        The name is kept apart from their account name on purpose: the name on a waiver
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
               placeholder="The name they gave"
               style={{ ...field, flex: 2, minWidth: 200 }} aria-label="The name they gave" />
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
          {busy ? 'Recording…' : 'Record it as taken by me'}
        </button>
        <button onClick={onCancel} style={{ ...linkBtn, color: 'var(--ink3)' }}>Cancel</button>
      </div>
      {blocker ? <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--warn)', maxWidth: '70ch' }}>{blocker}</p> : null}
    </div>
  );
}

/* ── the filing cabinet ────────────────────────────────────────────────────── */

function Documents({ documents, members, ccy, zone, tenantId, me, onChange }: {
  documents: Read<GymDocument>; members: Read<Membership>; ccy: TenantCurrency;
  /** `tenants.timezone` — a filing date is a fact about the gym's day. */
  zone: string | null;
  tenantId: string; me: Me; onChange: () => void;
}) {
  const [kind, setKind] = useState<DocumentKind>('insurance');
  const [title, setTitle] = useState('');
  const [memberId, setMemberId] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /**
   * The document Remove is waiting to be confirmed on.
   *
   * Remove used to delete on the first click. It is the most destructive
   * control on the screen — since supabase/parts/390 it takes the OBJECT out of
   * the bucket as well as the index row, which is the fix for a file that
   * outlived the entry pointing at it, and it means there is now nothing left
   * to recover from. A signed contract or an insurance schedule removed by a
   * mis-aimed click in a table row is gone, and the register that says the gym
   * holds it is gone with it.
   *
   * Two clicks rather than a `confirm()`: the browser dialog is dismissed by
   * reflex, cannot say which document it is about in the gym's own words, and
   * is the same shape as every cookie banner anybody has ever clicked through.
   */
  const [removing, setRemoving] = useState<GymDocument | null>(null);

  // The GYM's calendar day, not the reader's. It was `isoDate(new Date())`, and
  // `expiring` in src/lib/gymDocs.ts is explicit that this is the caller's
  // decision — "whose day `today` is remains the caller's decision, which is
  // why it is a parameter" — because it is compared with `<=` against
  // `expires_on`, a `date` column holding a bare gym day. Two calendars either
  // side of that comparison is a public liability certificate drawn in red as
  // expired on the morning of the day it is still valid, or left in black on
  // the day it lapsed. `zone` is already a prop on this component for the
  // filing dates below. The reader's day remains the fallback for a gym that
  // has set no zone, which is what this line has always been.
  const today = gymDay(Date.now(), zone) ?? isoDate(new Date());
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
      try {
        await recordDocument(supabase, tenantId, {
          kind, title, storagePath: path,
          mime: file.type || null, sizeBytes: file.size,
          memberId: memberId || null,
          expiresOn: expiresOn || null,
          uploadedBy: me.id,
        });
      } catch (e) {
        // The object landed and the row did not. Take the object back out:
        // otherwise it sits in the bucket with nothing indexing it, which is
        // the same invisible orphan the old Remove produced, arriving by the
        // other door. Best effort — the sentence below is the same either way.
        await discardUnfiledObject(supabase, path);
        throw e;
      }
      setTitle(''); setFile(null); setExpiresOn('');
      onChange();
    } catch (e: any) {
      setErr(`That file was NOT filed: ${e?.message ?? 'the upload was refused'}. Nothing has been added to the record.`);
    } finally { setBusy(false); }
  };

  const open = async (d: GymDocument) => {
    // A signed URL, because the bucket is private — and for a document about a
    // member, a row in `gym_document_reads` FIRST. Nothing in the database can
    // watch a signed URL being minted, so the console is the only party that
    // can record it; and it records before it asks, so a read that cannot be
    // recorded does not happen. See supabase/parts/390.
    try {
      const url = await openDocument(supabase, tenantId, d, me.id);
      setErr(null);
      window.open(url, '_blank', 'noopener');
    } catch (e: any) {
      setErr(e?.message ?? 'That file could not be opened.');
    }
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
    // Who the DATABASE will let read this, not who this screen chooses to show
    // it to. The rule is `gym_doc_readable()` in supabase/parts/390 and this
    // column only reports it.
    { key: 'seen', header: 'Readable by', value: (d) => AUDIENCE_LABEL[documentAudience(d)],
      render: (d) => documentAudience(d) === 'owner'
        ? <span style={{ color: 'var(--ink2)' }}>Owner only</span>
        : <span style={{ color: 'var(--ink3)' }}>Staff</span> },
    { key: 'who', header: 'Filed by', value: (d) => d.uploadedByName },
    { key: 'when', header: 'Filed', value: (d) => d.uploadedAt,
      render: (d) => gymDateText(d.uploadedAt, zone) ?? <span className="dash">not stated</span> },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (d) => removing?.id === d.id ? (
        <span style={{ display: 'inline-flex', gap: 9, alignItems: 'baseline' }}>
          <button
            style={{ ...linkBtn, color: 'var(--crit)' }}
            // The file goes with the entry. `deleteDocument` deletes the OBJECT
            // first and refuses to report success unless it observed the bytes
            // go — so the sentence below is whatever it says happened, not a
            // guess that the document is still on file. It might not be.
            onClick={() => {
              setRemoving(null);
              deleteDocument(supabase, d)
                .then(() => { setErr(null); onChange(); })
                .catch((e: any) => { setErr(e?.message ?? 'That document was not removed.'); onChange(); });
            }}
          >
            Delete it
          </button>
          <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={() => setRemoving(null)}>Keep</button>
        </span>
      ) : (
        <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={() => { setErr(null); setRemoving(d); }}>
          Remove
        </button>
      ) },
  ];

  const roster = (members.rows ?? []).filter((m) => m.memberName);

  return (
    <Section
      title="Documents"
      sub="A signed contract, an insurance schedule, an engineer's report, a photograph of a broken machine. Anything filed against a member is yours alone to read; the building's service reports, photographs, certificates and insurance are readable by your staff. The file itself opens through a link that expires in a minute, and opening a member's document is recorded in the log below."
    >
      {documents.why ? <Banner tone="crit">{documents.why}</Banner> : null}
      {err ? <Banner tone="crit">{err}</Banner> : null}

      {removing ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>Delete &ldquo;{removing.title}&rdquo;?</strong>{' '}
          The file is taken out of the bucket as well as the register, so there is nothing left to
          recover it from — not the entry, and not the document.
          {removing.memberAttached
            ? ' This one is filed against a member, and it may be the only copy of something they signed.'
            : ''}
          {' '}Use the row&rsquo;s Delete it to go ahead, or Keep to leave it on file.
        </Banner>
      ) : null}

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
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '74ch' }}>{blocker}</p>
      ) : null}

      {documents.state === 'loading' ? <Loading />
        : documents.state === 'failed' ? (
          <Unread
            why={documents.why} what="the filing cabinet"
            cost="&ldquo;nothing is on file&rdquo; over a failed read is the sentence that stops somebody looking for the insurance certificate they need"
          />
        ) : (
          <DataTable noun="documents"
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
function Feed({ feed, zone }: { feed: Read<Activity>; zone: string | null }) {
  const [kind, setKind] = useState('');
  const rows = (feed.rows ?? []).filter((e) => !kind || e.kind === kind);
  const kinds = useMemo(
    () => [...new Set((feed.rows ?? []).map((e) => e.kind))].sort(),
    [feed.rows],
  );

  const cols: Column<Activity>[] = [
    { key: 'at', header: 'When', value: (e) => e.at,
      render: (e) => gymDateTimeText(e.at, zone) ?? <span className="dash">not stated</span> },
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
      sub={`The last ${FEED_DAYS} days. Written by the database as things happen, so nothing here was typed by anyone and nothing can be missed by a screen forgetting to record it — except the two kinds nothing in a database can watch: record-exported and document-opened. A download and a signed link both happen in the browser, so those two are stated by this console and then logged the same way as everything else.`}
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
      {feed.state === 'failed' ? (
        <Unread
          why={feed.why} what="the activity log"
          cost="telling an owner nothing has been recorded, and to go and check their database triggers, over a query that errored sends them to fix something that is not broken"
        />
      ) : feed.state === 'loading' ? <Loading /> : (
        <DataTable noun="filing-record entries"
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
 * audited.
 *
 * It is also PAGED rather than refused. A truncated audit log is one that has
 * silently lost its oldest entries, which on this screen is the half somebody
 * came looking for — but refusing loses all of them, and this feed is written
 * by triggers on every payment, price change, cancellation, export and document
 * opened. A gym of any size crosses a thousand of those inside ninety days, so
 * the audit feed was an error message on precisely the gyms that have something
 * to audit. The window is already bounded, which is the shape `readAll` is for.
 * `id` after `created_at` because paging needs a total order.
 */
async function fetchActivity(tenantId: string): Promise<Activity[]> {
  const since = new Date(Date.now() - FEED_DAYS * DAY).toISOString();
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_events')
      .select('id, kind, summary, actor_id, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    `this gym's activity in the last ${FEED_DAYS} days`,
  );
  if (!rows.length) return [];

  /*
   * CHUNKED, for the reason `fetchEvents` on /activity gives at length: the
   * `gym_events` read above it PAGES, so the distinct actors behind it are no
   * longer bounded by a row cap, and a couple of hundred uuids in one
   * `in.("…","…")` is past the 8KB request line. The 414 arrives as a null
   * `data`, the `no-error-ok` below swallows it, and every entry in the filing
   * record loses its actor at once — on the screen an owner opens to show
   * somebody who did what.
   */
  const names = new Map<string, string>();
  for (const chunk of chunkIds(uniqueIds(rows.map((r: any) => r.actor_id)))) {
    // eslint-disable-next-line -- no-error-ok: an unreadable name renders as its own sentence beside the entry; the entry is still legible
    const { data: ps } = await supabase.from('profiles').select('id, full_name').in('id', chunk).limit(capLimit());
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

// The banner is the shared one now: studio-web/components/Banner.tsx. This
// page carried a byte-for-byte copy of it that rendered into a plain <div>,
// so every sentence it printed — including the ones saying a write was
// REFUSED and nothing was saved — was silent to a screen reader. The shared
// component carries role="alert"/"status" and aria-live.
// The wrapper stays only for this page's inset, surface and 84ch measure, which is passed
// through the shared component's `style` rather than duplicating it.
function Banner({ children, tone }: { children: React.ReactNode; tone?: BannerTone }) {
  return <SharedBanner tone={tone} style={{ margin: '14px', background: 'var(--surface2)', maxWidth: '84ch' }}>{children}</SharedBanner>;
}


/**
 * A read that has not landed, said as which of the two it is.
 *
 * Three sections on this screen were a two-state ternary — `state === 'loading'
 * ? <Loading /> : <DataTable rows={rows ?? []} empty="…" />` — so a FAILED read
 * arrived as zero rows and printed the confident empty sentence. On the screen
 * that decides whether a gym can produce an insurance schedule or a signed
 * contract, "we hold nothing" and "we could not look" were drawn identically,
 * and one of them is reassuring.
 */
function Unread({ why, what, cost }: { why: string | null; what: string; cost: string }) {
  return (
    <div style={{
      padding: '16px 14px', margin: 14, borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13, maxWidth: '78ch',
    }}>
      Could not read {what}. This section is <strong style={{ color: 'var(--ink)' }}>unknown</strong>,
      not empty &mdash; {cost}.{why ? <> The read said: {why}</> : null}
    </div>
  );
}
