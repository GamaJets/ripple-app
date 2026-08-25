'use client';

// Import — read a spreadsheet from whatever the gym used before Repple.
//
// The parser and the two previewers have been in src/lib with tests since the
// CSV work landed; nothing has ever reached them. This is that surface.
//
// Everything is a dry run until the gym presses the button. previewMembers and
// previewPayments write nothing — they read the file, report what they found
// and what they could not make sense of, and hand back rows. An import that
// half-succeeded and left no record of which half is the worst outcome
// available, so the confirm step is deliberate and the preview is complete.
//
// TWO HONEST LIMITS, stated on the screen rather than discovered at the end:
//
//  · Payments import. gym_payments.member_id is nullable, so a payment whose
//    member cannot be matched is still recorded — unattributed, which is true,
//    rather than dropped, which loses money the gym actually took.
//
//  · Members do NOT import. memberships.member_id is `not null references
//    profiles(id)`, so a membership needs a real account behind it, and
//    creating an account is an invite flow rather than an insert. The preview
//    still runs, because validating and cleaning the file is most of the work
//    and worth having before the invite path exists.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import {
  previewMembers, previewPayments, describePreview,
  type ImportPreview, type MemberRow, type PaymentRow, type DateOrder,
} from '@lib/csvImport';
import { recordPayment, fetchMemberships, type Membership } from '@lib/gymRecord';

type Kind = 'payments' | 'members';

export default function ImportPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [gymName, setGymName] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>('payments');
  const [text, setText] = useState('');
  const [order, setOrder] = useState<DateOrder | ''>('');
  const [members, setMembers] = useState<Membership[] | null>(null);

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ line: number; why: string }[]>([]);

  useEffect(() => {
    (async () => {
      const who = await loadMe();
      if (!who) return;
      setMe(who);
      setTenantId(who.tenantId);
      if (who.tenantId) {
        const { data } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
        setGymName((data as any)?.name ?? null);
        try { setMembers(await fetchMemberships(supabase, who.tenantId)); } catch { setMembers([]); }
      }
    })();
  }, []);

  // Widened to the union element rather than left as a union OF previews: the
  // shape is identical either way and only the row type differs, so this reads
  // the common fields without a cast at every use.
  const preview = useMemo<ImportPreview<MemberRow | PaymentRow> | null>(() => {
    if (!text.trim()) return null;
    const o = order || undefined;
    return kind === 'payments' ? previewPayments(text, o) : previewMembers(text, o);
  }, [text, kind, order]);

  /**
   * Match an imported payment to a member by name.
   *
   * Name only: Membership carries no email, so the email column the importer
   * parses cannot be used for matching without another read. Name matching is
   * exact after trimming and lower-casing — deliberately not fuzzy, because
   * attaching a payment to the wrong member is worse than leaving it
   * unattributed, and the screen says how many will be unattributed before
   * anything is written.
   */
  const matchMember = useCallback((row: PaymentRow): string | null => {
    const list = members ?? [];
    const name = (row.memberName ?? '').trim().toLowerCase();
    if (!name) return null;
    const hit = list.find((m) => (m.memberName ?? '').trim().toLowerCase() === name);
    return hit?.memberId ?? null;
  }, [members]);

  const runImport = async () => {
    if (!preview || !tenantId || kind !== 'payments') return;
    const rows = preview.ready as PaymentRow[];
    if (!rows.length) return;
    setBusy(true); setDone(null); setFailed([]);
    let ok = 0; const bad: { line: number; why: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        await recordPayment(supabase, tenantId, {
          memberId: matchMember(r),
          amountCents: r.amountCents,
          method: r.method,
          takenAt: new Date(r.takenOn + 'T12:00:00Z').toISOString(),
          note: r.note,
        });
        ok++;
      } catch (e: any) {
        bad.push({ line: i + 2, why: e?.message ?? 'write failed' });
      }
    }
    setBusy(false);
    setFailed(bad);
    setDone(`${ok} payment${ok === 1 ? '' : 's'} recorded${bad.length ? `, ${bad.length} could not be written` : ''}.`);
  };

  const matched = kind === 'payments' && preview
    ? (preview.ready as PaymentRow[]).filter((r) => matchMember(r) !== null).length
    : 0;

  if (!me) return null;

  return (
    <Shell me={me} gymName={gymName} current="/import">
      <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>Import</h1>
      <p style={{ margin: '0 0 20px', color: 'var(--ink3)', fontSize: 13 }}>
        Paste a spreadsheet exported from whatever you used before. Nothing is written until you
        say so, and you see exactly what will happen first.
      </p>

      <Section title="The file" sub="Copy the whole sheet, header row included, and paste it here.">
        <div style={{ ...formRow, borderBottom: 'none' }}>
          {(['payments', 'members'] as Kind[]).map((k) => (
            <button key={k} onClick={() => { setKind(k); setDone(null); setFailed([]); }}
              style={k === kind
                ? { ...primaryBtn, textTransform: 'capitalize' }
                : { ...field, cursor: 'pointer', textTransform: 'capitalize' }}>
              {k}
            </button>
          ))}
          <select value={order} onChange={(e) => setOrder(e.target.value as DateOrder | '')} style={field}>
            <option value="">Work out the date order</option>
            <option value="dmy">Dates are day/month/year</option>
            <option value="mdy">Dates are month/day/year</option>
            <option value="ymd">Dates are year-month-day</option>
          </select>
        </div>
        <div style={{ padding: '0 14px 14px' }}>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setDone(null); setFailed([]); }}
            placeholder={kind === 'payments'
              ? 'member,amount,date,method\nJane Okafor,250.00,04/03/2026,card'
              : 'name,email,plan,started,status\nJane Okafor,jane@example.com,Monthly,04/03/2025,active'}
            rows={8}
            style={{ ...field, width: '100%', fontFamily: 'var(--mono)', fontSize: 12.5, resize: 'vertical' }}
          />
        </div>
      </Section>

      {kind === 'members' ? (
        <p style={{
          border: '1px solid var(--ring)', borderLeft: '3px solid #f0c04e', borderRadius: 8,
          background: 'var(--surface)', padding: '14px 16px', fontSize: 13, lineHeight: 1.55,
          color: 'var(--ink2)', margin: '0 0 22px',
        }}>
          <strong style={{ color: 'var(--ink)' }}>Members can be checked here but not imported yet.</strong>{' '}
          A membership must point at a real Repple account, and creating an account is an invite
          rather than a row we can insert. The check below is still worth running — it finds the
          bad dates, the unreadable amounts and the columns nobody will recognise, which is most
          of the work of cleaning an export.
        </p>
      ) : null}

      {preview ? (
        <>
          <Section title="What the file says" sub={describePreview(preview)}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1, background: 'var(--ring)' }}>
              <Kpi label="Rows read" text={String(preview.rows.length)} />
              <Kpi label="Ready" text={String(preview.ready.length)} />
              <Kpi label="Need attention" text={String(preview.rejected.length)} />
              {kind === 'payments' ? (
                <Kpi label="Matched to a member" text={String(matched)}
                     note={preview.ready.length ? `${preview.ready.length - matched} will be unattributed` : undefined} />
              ) : null}
            </div>

            {preview.missingRequired.length ? (
              <p style={{ margin: '12px 14px', fontSize: 13, color: '#ef8080' }}>
                No {preview.missingRequired.join(' or ')} column found, so nothing can be read from this file.
              </p>
            ) : null}

            {preview.dateOrder === 'ambiguous' ? (
              <p style={{ margin: '12px 14px', fontSize: 13, color: '#f0c04e' }}>
                Every date in this file works read either way round — 03/04 could be 3 April or
                4 March. Say which above; guessing would silently move somebody&rsquo;s renewal by
                nine months.
              </p>
            ) : null}

            {preview.unmatchedColumns.length ? (
              <p style={{ margin: '12px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                Ignoring {preview.unmatchedColumns.length} column{preview.unmatchedColumns.length === 1 ? '' : 's'} nothing recognised:{' '}
                <span style={{ fontFamily: 'var(--mono)' }}>{preview.unmatchedColumns.join(', ')}</span>. They are
                reported rather than dropped quietly, in case one of them mattered.
              </p>
            ) : null}
          </Section>

          {preview.rejected.length ? (
            <Section title={`${preview.rejected.length} rows need attention`}
                     sub="These are skipped. Fix them in the sheet and paste again — nothing here is imported.">
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {preview.rejected.slice(0, 60).map((r) => (
                  <div key={r.line} style={{ display: 'flex', gap: 12, padding: '8px 14px', borderTop: '1px solid var(--ring)', fontSize: 12.5 }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink3)', minWidth: 44 }}>line {r.line}</span>
                    <span style={{ color: 'var(--ink2)' }}>{r.errors.join(' · ')}</span>
                  </div>
                ))}
                {preview.rejected.length > 60 ? (
                  <p style={{ margin: '10px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                    …and {preview.rejected.length - 60} more. Showing the first 60 so the page stays readable.
                  </p>
                ) : null}
              </div>
            </Section>
          ) : null}

          {kind === 'payments' && preview.ready.length > 0 ? (
            <Section title="Import" sub={`${preview.ready.length} payments will be recorded. This writes to your gym.`}>
              <div style={{ ...formRow, borderBottom: 'none' }}>
                <button onClick={runImport} disabled={busy} style={primaryBtn}>
                  {busy ? 'Importing…' : `Record ${preview.ready.length} payments`}
                </button>
                {done ? <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{done}</span> : null}
              </div>
              {failed.length ? (
                <div style={{ padding: '0 14px 14px' }}>
                  {failed.slice(0, 20).map((f) => (
                    <div key={f.line} style={{ fontSize: 12.5, color: '#ef8080' }}>line {f.line}: {f.why}</div>
                  ))}
                </div>
              ) : null}
            </Section>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}

/* ── local presentation ────────────────────────────────────────────────────── */

function Kpi({ label, text, note }: { label: string; text: string; note?: string }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '12px 14px' }}>
      <span style={{ display: 'block', fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{label}</span>
      <span style={{ display: 'block', fontSize: 22, fontFamily: 'var(--mono)', marginTop: 4 }}>{text}</span>
      {note ? <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink3)', marginTop: 3 }}>{note}</span> : null}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 6,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const formRow = {
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};
