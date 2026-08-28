'use client';

// Door — who is in the building, who came in today, and the passes taken at
// the desk.
//
// This is the one console screen a trainer sees as well as an owner, because
// working the door is a staff job. It is a capture screen before it is a
// reporting one: until visits are recorded, attendance is only ever the subset
// of people who booked a class, and retention is inferred from a number that
// is missing most of its input.
import { useCallback, useEffect, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchVisits, checkIn, checkOut, summariseVisits, dwellMinutes,
  type Visit,
} from '@lib/gymVisits';
import {
  fetchPasses, fetchPassTypes, issuePass, redeemPass,
  summarisePasses, passStatus, remainingUses,
  type GymPass, type PassType,
} from '@lib/gymPasses';
import { fetchMemberships, money, type Membership } from '@lib/gymRecord';
import { isoDate } from '@lib/format';

const DAY = 86400000;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "ok, this read returned".
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "No visits logged today" are both lies about a query that errored, and staff
 * act on both of them — one by waiting, the other by telling the owner the gym
 * was empty this morning.
 */
type Unread = 'loading' | 'failed' | null;

/** The calendar day a visit belongs to, in the gym's own timezone. */
const dayOf = (iso: string) => isoDate(new Date(iso));

/** One settled read, as a line for the banner. Null when it came back fine. */
function failure(res: PromiseSettledResult<unknown>, what: string): string | null {
  if (res.status === 'fulfilled') return null;
  const why = (res.reason as any)?.message;
  return `Could not read ${what}${why ? `: ${why}` : '.'}`;
}

export default function Door() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [passes, setPasses] = useState<GymPass[] | null>(null);
  const [types, setTypes] = useState<PassType[] | null>(null);
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    // allSettled, not all: one failing read must not take the others with it.
    // Under Promise.all a refused gym_passes query also emptied the other three
    // — the visits table said "No visits logged today" on a morning that had
    // visits, and the check-in dropdown lost every member — so one broken query
    // produced three wrong facts and the banner named none of them.
    const [vRes, pRes, tRes, mRes] = await Promise.allSettled([
      fetchVisits(supabase, tenantId, { sinceIso: new Date(Date.now() - 30 * DAY).toISOString() }),
      fetchPasses(supabase, tenantId),
      fetchPassTypes(supabase, tenantId),
      fetchMemberships(supabase, tenantId),
    ]);

    // A read that failed is null, never []. [] is the gym saying it has none;
    // null is nobody knowing. Staff act differently on the two.
    setVisits(vRes.status === 'fulfilled' ? vRes.value : null);
    setPasses(pRes.status === 'fulfilled' ? pRes.value : null);
    setTypes(tRes.status === 'fulfilled' ? tRes.value : null);
    setMembers(mRes.status === 'fulfilled' ? mRes.value : null);

    // Surfaced rather than swallowed: a door screen that silently fails to read
    // is worse than one that says so, because staff will keep using it. Each
    // failure is named, because "could not read" without saying which query
    // broke leaves the desk unable to tell the owner what is down.
    const trouble = [
      failure(vRes, 'the door log'),
      failure(pRes, 'the passes'),
      failure(tRes, 'the pass types'),
      failure(mRes, 'the member list'),
    ].filter((s): s is string => s !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setVisits([]); setPasses([]); setTypes([]); setMembers([]); return; }
      // no-error-ok: the gym's name is a header label; without it the header is blank and every figure below is unaffected
      const { data: t } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) setGymName(t?.name ?? null);
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.role !== 'owner' && me.role !== 'trainer') {
    return (
      <Shell me={me} gymName={gymName} current="/door">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>The door log is for gym staff.</p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId);

  // The gym's own calendar day, not UTC's. This product sells in AED, so the
  // desk that reads this is four hours ahead of UTC and the UTC date does not
  // turn over until 04:00 local: every 6am arrival was filed under yesterday,
  // and "Visits today", "Members today" and "Busiest hour" each opened the
  // morning already short. The same date decides a pass expiry, so a pass good
  // "to the 3rd" was refused at the desk for the four hours either side of
  // local midnight. One date, and every "today" below is compared against it.
  const today = isoDate(new Date());
  const todays = (visits ?? []).filter((v) => dayOf(v.enteredAt) === today);

  // "Inside now" means today, the same thing the Overview tile means by "In the
  // building". Over the 30-day window it meant "no exit recorded at any point
  // in the last month" — and because the overnight sweep deliberately writes
  // only a note and leaves exited_at null, every abandoned check-in stayed in
  // that count forever. The tile crept upward all month and the two screens
  // disagreed. Visits left open from earlier days are counted separately and
  // said out loud: nobody is standing in the gym from Tuesday.
  const inside = todays.filter((v) => !v.exitedAt);
  const openBefore = (visits ?? []).filter((v) => !v.exitedAt && dayOf(v.enteredAt) !== today);

  const sum = visits ? summariseVisits(todays) : null;
  const pSum = passes ? summarisePasses(passes, today) : null;

  // err is only ever set by a finished load, so a state still null once it is
  // set is a read that was refused rather than one still in flight.
  const unread = (rows: unknown[] | null): Unread => (rows !== null ? null : err ? 'failed' : 'loading');

  return (
    <Shell me={me} gymName={gymName} current="/door">
      <h1>Door</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        Every visit, not just the booked ones. A member who trains on the floor
        counts the same as one who books a class.
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 8, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="Inside now"
          text={visits ? String(inside.length) : null}
          note={openBefore.length > 0 ? `${openBefore.length} left open on an earlier day` : undefined}
        />
        <Kpi label="Visits today" text={sum ? String(sum.visits) : null}
             note={sum && sum.anonymous > 0 ? `${sum.anonymous} not identified` : undefined} />
        <Kpi label="Members today" text={sum ? String(sum.uniqueMembers) : null} />
        <Kpi
          label="Average stay"
          text={sum?.averageDwell == null ? null : `${sum.averageDwell} min`}
          note={
            sum == null ? undefined
              : sum.averageDwell == null ? 'no exits recorded yet'
              : `from ${sum.dwellFrom} of ${sum.visits}`
          }
        />
        <Kpi
          label="Busiest hour"
          text={sum?.peak ? `${String(sum.peak.hour).padStart(2, '0')}:00` : null}
          note={sum?.peak ? `${sum.peak.visits} in` : 'nothing logged today'}
        />
      </div>

      <CheckInBar
        members={members} passes={passes} tenantId={tenantId}
        membersUnread={unread(members)} onChange={refresh}
      />
      <Inside inside={inside} openBefore={openBefore.length} unread={unread(visits)} onChange={refresh} />
      <Today visits={todays} unread={unread(visits)} />
      <Passes
        passes={passes} types={types} members={members} summary={pSum}
        passesUnread={unread(passes)} typesUnread={unread(types)}
        tenantId={tenantId} today={today} me={me} onChange={refresh}
      />
    </Shell>
  );
}

/* ── check-in ──────────────────────────────────────────────────────────────── */

function CheckInBar({ members, passes, tenantId, membersUnread, onChange }: {
  members: Membership[] | null; passes: GymPass[] | null; tenantId: string;
  membersUnread: Unread; onChange: () => void;
}) {
  const [memberId, setMemberId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      // An empty selection is a deliberate anonymous head-count, not an error.
      await checkIn(supabase, tenantId, { memberId: memberId || null, source: 'desk' });
      setMemberId('');
      setMsg(memberId ? 'Checked in.' : 'Anonymous visit recorded.');
      onChange();
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not record that check-in.');
    } finally { setBusy(false); }
  };

  const active = (members ?? []).filter((m) => m.status === 'active');

  return (
    <Section title="Check someone in" sub="Leave the member blank to record a visit you cannot attribute — it still counts toward the day.">
      <form onSubmit={go} style={formRow}>
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={{ ...field, flex: 2 }}>
          <option value="">Anonymous / walk-in</option>
          {active.map((m) => (
            <option key={m.id} value={m.memberId}>{m.memberName ?? m.memberId}</option>
          ))}
        </select>
        <button type="submit" disabled={busy} style={{ ...btn, flex: 'none' }}>
          {busy ? 'Recording…' : 'Check in'}
        </button>
      </form>
      {/* A dropdown holding nothing but "Anonymous" reads as a gym with no
          members. Say which it is, or the desk checks a member in as a walk-in
          and the visit never reaches their record. */}
      {membersUnread ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          {membersUnread === 'loading'
            ? 'Still reading the member list — check in anonymously for now.'
            : 'The member list did not come back, so only an anonymous visit can be recorded. The banner above says why.'}
        </p>
      ) : null}
      {msg ? <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
    </Section>
  );
}

/* ── who is inside ─────────────────────────────────────────────────────────── */

function Inside({ inside, openBefore, unread, onChange }: {
  inside: Visit[]; openBefore: number; unread: Unread; onChange: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  const close = async (v: Visit) => {
    setMsg(null);
    try {
      await checkOut(supabase, v.id);
      onChange();
    } catch (e: any) {
      // checkOut throws on a refused update, and with no catch that rejection
      // went nowhere: the row stayed exactly as it was and the screen said
      // nothing, so the desk clicked again and read the gym as slow rather
      // than as refusing. The reason is what tells staff to retry or escalate.
      setMsg(e?.message ?? 'Could not check that visit out.');
    }
  };

  const cols: Column<Visit>[] = [
    { key: 'who', header: 'Who', value: (v) => v.memberName ?? 'zzz',
      render: (v) => v.memberName ?? <span className="dash">not identified</span> },
    { key: 'in', header: 'In since', value: (v) => v.enteredAt,
      render: (v) => new Date(v.enteredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
    { key: 'for', header: 'For', value: (v) => Date.now() - Date.parse(v.enteredAt), numeric: true,
      render: (v) => `${Math.max(0, Math.round((Date.now() - Date.parse(v.enteredAt)) / 60000))} min` },
    { key: 'out', header: '', value: () => 0, align: 'right',
      render: (v) => (
        <button style={linkBtn} onClick={() => close(v)}>Check out</button>
      ) },
  ];
  return (
    <Section title="Inside now" sub="Anyone who came in today and has not been checked out. A visit left open overnight is swept with a note, never a guessed exit time.">
      {msg ? <p style={{ margin: '14px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
      {openBefore > 0 ? (
        <p style={{ margin: '14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          {openBefore === 1 ? '1 visit is' : `${openBefore} visits are`} still open from an earlier
          day — check-ins nobody closed, not people standing in the gym, so they are said here and
          counted nowhere. There is no Check out on them on purpose: closing one now would stamp
          this minute as the exit and put a twenty-hour stay into the average.
        </p>
      ) : null}
      {unread ? <Unresolved state={unread} what="the door log" /> : (
        <DataTable rows={inside} columns={cols} rowKey={(v) => v.id} empty="Nobody is checked in." />
      )}
    </Section>
  );
}

/* ── today ─────────────────────────────────────────────────────────────────── */

function Today({ visits, unread }: { visits: Visit[]; unread: Unread }) {
  const cols: Column<Visit>[] = [
    { key: 'who', header: 'Who', value: (v) => v.memberName ?? 'zzz',
      render: (v) => v.memberName ?? <span className="dash">not identified</span> },
    { key: 'in', header: 'In', value: (v) => v.enteredAt,
      render: (v) => new Date(v.enteredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
    { key: 'out', header: 'Out', value: (v) => v.exitedAt ?? '',
      render: (v) => v.exitedAt
        ? new Date(v.exitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : <span className="dash">—</span> },
    { key: 'stay', header: 'Stay', value: (v) => dwellMinutes(v) ?? -1, numeric: true,
      render: (v) => {
        const d = dwellMinutes(v);
        // A dash, not a zero: an open visit has no measured length.
        return d == null ? <span className="dash">—</span> : `${d} min`;
      } },
    { key: 'via', header: 'Via', value: (v) => v.source },
  ];
  return (
    <Section title="Today" sub="Every arrival logged since local midnight — the gym's midnight, not UTC's.">
      {unread ? <Unresolved state={unread} what="the door log" /> : (
        <DataTable rows={visits} columns={cols} rowKey={(v) => v.id} empty="No visits logged today." />
      )}
    </Section>
  );
}

/* ── passes ────────────────────────────────────────────────────────────────── */

function Passes({ passes, types, members, summary, passesUnread, typesUnread, tenantId, today, me, onChange }: {
  passes: GymPass[] | null; types: PassType[] | null; members: Membership[] | null;
  summary: ReturnType<typeof summarisePasses> | null;
  passesUnread: Unread; typesUnread: Unread;
  tenantId: string; today: string; me: Me; onChange: () => void;
}) {
  const [typeId, setTypeId] = useState('');
  const [holderName, setHolderName] = useState('');
  const [hostId, setHostId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sell = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = (types ?? []).find((x) => x.id === typeId);
    if (!t || !holderName.trim()) { setMsg('Pick a pass and give a name.'); return; }
    setBusy(true); setMsg(null);
    try {
      await issuePass(supabase, tenantId, {
        passType: t,
        holderName: holderName.trim(),
        hostMemberId: t.kind === 'guest' ? (hostId || null) : null,
        issuedOn: today,
      });
      setHolderName(''); setHostId(''); setMsg('Pass issued.');
      onChange();
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not issue that pass.');
    } finally { setBusy(false); }
  };

  const take = async (p: GymPass) => {
    setMsg(null);
    try {
      await redeemPass(supabase, p, { redeemedBy: me.id ?? null, today });
      onChange();
    } catch (e: any) {
      // The reason matters at a desk: "expired on the 3rd" ends an argument
      // that "could not redeem" starts.
      setMsg(e?.message ?? 'Could not take that pass.');
    }
  };

  const cols: Column<GymPass>[] = [
    { key: 'who', header: 'Holder', value: (p) => p.holderName ?? 'zzz',
      render: (p) => p.holderName ?? <span className="dash">—</span> },
    { key: 'type', header: 'Pass', value: (p) => p.passTypeName ?? '',
      render: (p) => p.passTypeName ?? <span className="dash">retired type</span> },
    { key: 'left', header: 'Left', value: (p) => remainingUses(p), numeric: true,
      render: (p) => `${remainingUses(p)} / ${p.usesTotal}` },
    { key: 'expires', header: 'Expires', value: (p) => p.expiresOn ?? '',
      render: (p) => p.expiresOn ?? <span className="dash">no expiry</span> },
    { key: 'paid', header: 'Paid', value: (p) => p.paidCents ?? -1, numeric: true,
      // Null is a pass nobody priced, which is not a free pass.
      render: (p) => p.paidCents == null ? <span className="dash">not recorded</span> : money(p.paidCents, p.currency) },
    { key: 'status', header: 'Status', value: (p) => passStatus(p, today) },
    { key: 'take', header: '', value: () => 0, align: 'right',
      render: (p) => passStatus(p, today) === 'live'
        ? <button style={linkBtn} onClick={() => take(p)}>Take a visit</button>
        : null },
  ];

  const selected = (types ?? []).find((t) => t.id === typeId);
  const activeMembers = (members ?? []).filter((m) => m.status === 'active');

  return (
    <Section
      title="Passes"
      sub={
        summary
          ? `${summary.live} live · ${summary.expired} expired · ${summary.usedUp} used up · ${summary.visitsRemaining} visits still owed`
          : undefined
      }
    >
      {types === null ? (
        // Not the same sentence as "none yet": sending someone to Money to add
        // pass types they already have, because the read broke, wastes the one
        // person who could fix it.
        <p style={{ padding: '0 14px 14px', margin: 0, color: 'var(--ink3)', fontSize: 12.5 }}>
          {typesUnread === 'failed'
            ? 'The pass types did not come back, so nothing can be sold from here yet. The banner above says why.'
            : 'Still reading the pass types…'}
        </p>
      ) : types.length === 0 ? (
        <p style={{ padding: '0 14px 14px', margin: 0, color: 'var(--ink3)', fontSize: 12.5 }}>
          No pass types yet. Add them under Money before selling at the desk.
        </p>
      ) : (
        <form onSubmit={sell} style={formRow}>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={{ ...field, flex: 2 }}>
            <option value="">Pass type…</option>
            {(types ?? []).filter((t) => t.active).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {money(t.priceCents, t.currency)}{t.uses > 1 ? ` (${t.uses} visits)` : ''}
              </option>
            ))}
          </select>
          <input
            value={holderName} onChange={(e) => setHolderName(e.target.value)}
            placeholder="Name at the desk" style={{ ...field, flex: 2 }}
          />
          {selected?.kind === 'guest' ? (
            <select value={hostId} onChange={(e) => setHostId(e.target.value)} style={{ ...field, flex: 2 }}>
              <option value="">Guest of…</option>
              {activeMembers.map((m) => (
                <option key={m.id} value={m.memberId}>{m.memberName ?? m.memberId}</option>
              ))}
            </select>
          ) : null}
          <button type="submit" disabled={busy} style={{ ...btn, flex: 'none' }}>
            {busy ? 'Issuing…' : 'Issue'}
          </button>
        </form>
      )}
      {msg ? <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}

      {summary && summary.revenueCents == null && summary.issued > 0 ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          No price is recorded against any pass, so pass revenue reads as a dash
          rather than nil. Record what was taken when you issue one.
        </p>
      ) : null}

      {passes === null ? <Unresolved state={passesUnread === 'failed' ? 'failed' : 'loading'} what="the passes" /> : (
        <DataTable rows={passes} columns={cols} rowKey={(p) => p.id} empty="No passes issued yet." />
      )}
    </Section>
  );
}

/* ── shared bits (same shapes as the Money screen) ─────────────────────────── */

const field = {
  padding: '9px 11px', borderRadius: 7, fontSize: 13.5,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const btn = {
  ...field, background: 'var(--brand)', color: 'var(--brand-ink)',
  fontWeight: 600, cursor: 'pointer', border: '1px solid transparent',
} as const;

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)',
} as const;

const formRow = {
  display: 'flex', gap: 9, padding: 14, borderBottom: '1px solid var(--ring)', flexWrap: 'wrap' as const,
};

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, text, note }: { label: string; text: string | null; note?: string }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '14px 16px' }}>
      <div className="micro">{label}</div>
      <div className="mono" style={{ fontSize: 21, marginTop: 5, letterSpacing: '-0.02em', color: text == null ? 'var(--ink3)' : 'var(--ink)' }}>
        {text ?? '—'}
      </div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 3 }}>{note}</div> : null}
    </div>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone?: 'crit' }) {
  return (
    <div style={{
      margin: '14px 0', padding: '11px 14px', borderRadius: 8, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13,
    }}>{children}</div>
  );
}

/**
 * What stands in for a table whose rows are not known.
 *
 * A refused read used to fall through to the table's own empty line, so "we
 * could not ask" and "the gym has none" were the same sentence on screen.
 */
function Unresolved({ state, what }: { state: Exclude<Unread, null>; what: string }) {
  return (
    <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
      {state === 'loading' ? 'Loading…' : `Could not read ${what}. The banner above says why.`}
    </div>
  );
}
