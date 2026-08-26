'use client';

// Timetable — the week's classes, and the front desk marking who turned up.
//
// The check-in row is the point of this screen. Attendance is what makes
// retention visible before a cancellation arrives, and it is the history any
// later forecasting has to learn from. Everything else here exists to get a
// class onto the board so somebody can be ticked off against it.
import { useCallback, useEffect, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchEquipment, capacityFor, type Equipment } from '@lib/gymEquipment';
import {
  fetchClasses, createClass, createSeries, deleteClass,
  fetchRoster, setAttendance,
  summariseAttendance, pct,
  type GymClass, type RosterEntry,
} from '@lib/gymSchedule';

const DAY = 86400000;

export default function Timetable() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymNameErr, setGymNameErr] = useState<string | null>(null);
  const [classes, setClasses] = useState<GymClass[] | null>(null);
  const [openClass, setOpenClass] = useState<GymClass | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  const range = () => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday.getTime() + 7 * DAY - 1);
    return { from: monday.toISOString(), to: sunday.toISOString(), monday };
  };

  const load = useCallback(async (tenantId: string) => {
    const { from, to } = range();
    try {
      setClasses(await fetchClasses(supabase, tenantId, from, to));
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not read the timetable.');
      setClasses([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setClasses([]); return; }
      // supabase-js resolves with { data, error } rather than rejecting, so a
      // read that failed — or that RLS refused — arrives here as t === null and
      // is indistinguishable from a tenant row that genuinely is not there.
      // Dropping the error leaves the sidebar saying "No gym linked", which the
      // owner reads as a fact about their account: they go off to re-link a gym
      // that was linked all along, and never learn the read is the thing that
      // broke. Named on screen instead, next to the timetable it belongs to.
      const { data: t, error: tErr } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) {
        setGymName(tErr ? null : (t?.name ?? null));
        setGymNameErr(tErr ? (tErr.message ?? 'Could not read which gym this account is linked to.') : null);
      }
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;
  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} current="/timetable">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>The timetable is owner-only.</p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId);
  const sum = classes ? summariseAttendance(classes) : null;
  const { monday } = range();
  const weekLabel = `${monday.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(monday.getTime() + 6 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

  const cols: Column<GymClass>[] = [
    { key: 'when', header: 'When', value: (c) => c.startsAt,
      render: (c) => new Date(c.startsAt).toLocaleString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) },
    { key: 'title', header: 'Class', value: (c) => c.title },
    { key: 'room', header: 'Room', value: (c) => c.room },
    { key: 'instructor', header: 'Instructor', value: (c) => c.instructor },
    { key: 'booked', header: 'Booked', value: (c) => c.booked, numeric: true,
      render: (c) => `${c.booked} / ${c.capacity}` },
    { key: 'attended', header: 'Turned up', value: (c) => c.attended, numeric: true,
      // Before a class happens there is nothing to report; 0 would read as
      // "nobody came" rather than "not yet".
      render: (c) => (new Date(c.startsAt) > new Date()
        ? <span className="dash">—</span>
        : String(c.attended)) },
    { key: 'act', header: '', value: () => '', align: 'right',
      render: (c) => (
        <span style={{ display: 'inline-flex', gap: 12 }}>
          <button onClick={() => setOpenClass(c)} style={linkBtn}>Check in</button>
          <button
            onClick={() => {
              if (!confirm(`Remove "${c.title}" from the timetable?`)) return;
              // deleteClass throws on a database error, and this is the point
              // after the owner has already said yes. Unreported, the class is
              // simply still on the board a moment later — which reads as a
              // click that did not register, so the next thing anyone does is
              // press Remove again, and members keep booking a class the gym
              // believes it cancelled.
              deleteClass(supabase, c.id).then(refresh).catch((e: any) => {
                setErr(e?.message ?? 'Could not remove that class.');
              });
            }}
            style={{ ...linkBtn, color: 'var(--crit)' }}
          >Remove</button>
        </span>
      ) },
  ];

  return (
    <Shell me={me} gymName={gymName} current="/timetable">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1>Timetable</h1>
          <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>{weekLabel}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setWeekOffset((w) => w - 1)} style={ghostBtn}>← Previous</button>
          <button onClick={() => setWeekOffset(0)} style={ghostBtn} disabled={weekOffset === 0}>This week</button>
          <button onClick={() => setWeekOffset((w) => w + 1)} style={ghostBtn}>Next →</button>
        </div>
      </div>

      {gymNameErr ? (
        <Banner tone="crit">
          The gym this account is linked to could not be read: {gymNameErr}. The sidebar says no
          gym is linked because that lookup failed, not because one is missing.
        </Banner>
      ) : null}

      {err ? <Banner tone="crit">{err}</Banner> : null}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
        borderRadius: 8, overflow: 'hidden', margin: '20px 0 26px',
      }}>
        <Kpi label="Classes" text={sum ? String(sum.classes) : null} />
        <Kpi label="Places booked" text={sum ? String(sum.booked) : null} />
        <Kpi label="Fill rate" text={sum ? pct(sum.fillRate) : null} note={sum?.fillRate == null ? 'no capacity recorded' : undefined} />
        <Kpi label="Show rate" text={sum ? pct(sum.showRate) : null} note={sum?.showRate == null ? 'nothing booked yet' : undefined} />
      </div>

      <AddClass tenantId={tenantId} onChange={refresh} />

      <section style={{ border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
          <h2>This week</h2>
        </div>
        {classes === null ? <Loading /> : (
          <DataTable rows={classes} columns={cols} rowKey={(c) => c.id}
            empty="Nothing on the timetable this week. Add a class above, or use a weekly series." />
        )}
      </section>

      {openClass ? (
        <Roster gymClass={openClass} onClose={() => { setOpenClass(null); refresh(); }} />
      ) : null}
    </Shell>
  );
}

/* ── adding classes ────────────────────────────────────────────────────────── */

function AddClass({ tenantId, onChange }: { tenantId: string; onChange: () => void }) {
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState('45');
  const [capacity, setCapacity] = useState('20');
  const [room, setRoom] = useState('');
  const [instructor, setInstructor] = useState('');
  const [weeks, setWeeks] = useState('1');
  const [needs, setNeeds] = useState('');
  // Dates to leave out of a series. weeklyOccurrences() has taken these since
  // it was written — a gym closes for Eid, for a public holiday, for a
  // refurbishment — and nothing ever passed them, so the capability existed
  // and was unreachable. Comma-separated yyyy-mm-dd, because that is what the
  // library takes and inventing a picker for four dates a year is not worth it.
  const [skip, setSkip] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // The register, read once. A class capped at 20 in a room holding 18 bikes is
  // exactly what this data exists to prevent, and the moment to say so is while
  // the number is still being typed — not after twenty people have booked.
  const [kit, setKit] = useState<Equipment[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchEquipment(supabase, tenantId)
      .then((rows) => { if (live) setKit(rows); })
      .catch(() => { if (live) setKit([]); });
    return () => { live = false; };
  }, [tenantId]);

  const cap = parseInt(capacity, 10) || 0;
  const check = (kit && needs.trim() && cap > 0) ? capacityFor(kit, needs.trim(), cap) : null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !when) return;
    setBusy(true); setMsg(null);
    const c = {
      title: title.trim(),
      startsAt: new Date(when).toISOString(),
      durationMin: parseInt(duration, 10) || 45,
      capacity: parseInt(capacity, 10) || 0,
      room: room.trim() || null,
      instructor: instructor.trim() || null,
    };
    try {
      const n = parseInt(weeks, 10) || 1;
      if (n > 1) {
        const skipDates = skip.split(',').map((d) => d.trim()).filter(Boolean);
        const made = await createSeries(supabase, tenantId, c, n, skipDates);
        setMsg(`Added ${made} weekly occurrences.`);
      } else {
        await createClass(supabase, tenantId, c);
        setMsg('Added.');
      }
      setTitle(''); setWhen('');
      onChange();
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not add that class.');
    } finally { setBusy(false); }
  };

  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>Add a class</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
          A series creates one real class per week, so a single week can be moved or removed later.
        </p>
      </div>
      <form onSubmit={add} style={{ display: 'flex', gap: 8, padding: '12px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Class name" style={{ ...field, flex: 2, minWidth: 140 }} />
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ ...field, flex: 2, minWidth: 190 }} />
        <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Minutes" inputMode="numeric" style={{ ...field, width: 90 }} />
        <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Capacity" inputMode="numeric" style={{ ...field, width: 96 }} />
        <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" style={{ ...field, width: 110 }} />
        <input value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="Instructor" style={{ ...field, width: 130 }} />
          <input value={needs} onChange={(e) => setNeeds(e.target.value)} placeholder="Equipment needed" style={{ ...field, width: 160 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink3)', fontSize: 12.5 }}>
          repeat
          <input value={weeks} onChange={(e) => setWeeks(e.target.value)} inputMode="numeric" style={{ ...field, width: 56 }} />
          weeks
        </label>
          <input value={skip} onChange={(e) => setSkip(e.target.value)}
                 placeholder="Skip dates — 2026-12-25, 2027-01-01"
                 style={{ ...field, width: 210 }} />
        <button type="submit" disabled={busy} style={primaryBtn}>Add</button>
      </form>
      {check ? (
        <div style={{ padding: '0 14px 12px', fontSize: 12.5,
                      color: check.supported === false ? '#f0c04e' : 'var(--ink3)' }}>
          {check.supported === false
            ? `${check.note} Adding it anyway is allowed — the register may simply be out of date, and a stale inventory should not stop a class reaching the timetable.`
            : check.supported === null
              ? check.note
              : `${check.usable} available — enough for ${check.limit}.`}
        </div>
      ) : null}
      {msg ? <div style={{ padding: '0 14px 12px', color: 'var(--ink3)', fontSize: 12.5 }}>{msg}</div> : null}
    </section>
  );
}

/* ── the check-in roster ───────────────────────────────────────────────────── */

function Roster({ gymClass, onClose }: { gymClass: GymClass; onClose: () => void }) {
  const [rows, setRows] = useState<RosterEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await fetchRoster(supabase, gymClass.id)); }
    catch (e: any) { setErr(e?.message ?? 'Could not read the roster.'); setRows([]); }
  }, [gymClass.id]);

  useEffect(() => { load(); }, [load]);

  // setAttendance throws on a database error. Unreported, the row simply
  // re-renders as it was: the desk sees "Mark here" still sitting there and
  // reads it as a mis-click, or worse walks away assuming the tick landed. The
  // register is the record of who was in the room, so a check-in that silently
  // does not stick marks a member absent from a class they attended — and that
  // history is what the show rate above, and any later retention work, is read
  // from. A wrong attendance record is worse than a visible failure.
  const toggle = async (r: RosterEntry) => {
    try {
      await setAttendance(supabase, r.bookingId, !r.attendedAt);
      setErr(null);
      load();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not save that check-in.');
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Check in for ${gymClass.title}`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'grid', placeItems: 'center', padding: 24, zIndex: 10,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '100%', maxHeight: '80vh', overflow: 'auto',
          background: 'var(--surface)', border: '1px solid var(--ring)', borderRadius: 10,
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--ring)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2>{gymClass.title}</h2>
            <p style={{ margin: '3px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
              {new Date(gymClass.startsAt).toLocaleString()} · {gymClass.booked} booked of {gymClass.capacity}
            </p>
          </div>
          <button onClick={onClose} style={ghostBtn}>Done</button>
        </div>

        {err ? <Banner tone="crit">{err}</Banner> : null}

        {rows === null ? <Loading /> : rows.length === 0 ? (
          <div style={{ padding: '26px 18px', color: 'var(--ink3)', fontSize: 13.5 }}>
            Nobody has booked this class. Members book from the Repple app; a walk-in can be added
            once member sign-up is wired to the desk.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li key={r.bookingId} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--ring)',
              }}>
                <span style={{ color: r.name ? 'var(--ink)' : 'var(--ink3)' }}>
                  {r.name ?? 'Member'}
                </span>
                <button
                  onClick={() => toggle(r)}
                  aria-pressed={!!r.attendedAt}
                  style={{
                    border: '1px solid var(--ring)', borderRadius: 6, padding: '5px 12px',
                    fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--sans)',
                    background: r.attendedAt ? 'var(--brand)' : 'var(--surface2)',
                    color: r.attendedAt ? 'var(--brand-ink)' : 'var(--ink2)',
                  }}
                >
                  {r.attendedAt ? 'Here' : 'Mark here'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 6,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const ghostBtn = {
  background: 'var(--surface2)', color: 'var(--ink2)', border: '1px solid var(--ring)',
  borderRadius: 6, padding: '6px 11px', fontSize: 12.5, cursor: 'pointer',
  fontFamily: 'var(--sans)', whiteSpace: 'nowrap',
} as const;

const linkBtn = {
  background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer',
  fontSize: 12.5, padding: 0, fontFamily: 'var(--sans)',
} as const;

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

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
