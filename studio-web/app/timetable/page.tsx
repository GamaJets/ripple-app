'use client';

// Timetable — everything happening on the gym's floor, on one board.
//
// This screen used to show classes only. One-to-ones lived in the trainer's
// own calendar and reached the gym solely as payroll, so an owner looking at
// 18:00 saw three classes and had to guess at the four trainers who were also
// on the floor with clients. Two calendars cannot answer "is the floor
// covered?", and neither can be used to spot that the studio is holding a
// class and a one-to-one at the same hour.
//
// So the board is now the merge of `gym_classes` and `sessions`. The check-in
// row is still the point of the class half — attendance is what makes
// retention visible before a cancellation arrives — and the one-to-one half
// adds the other thing an owner cannot otherwise see: where their trainers
// actually are.
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  fetchPtSlots, fetchTrainerOptions, createPtSlot, removePtSlot,
  mergeTimetable, summariseBoard, clashes, floorByHour, floorAt,
  slotBlocker,
  type PtSlot, type TimetableEntry, type FloorSlice,
} from '@lib/gymPtSchedule';

const DAY = 86400000;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FIRST_HOUR = 6;
const LAST_HOUR = 22;

/** Both halves of the board, or nothing. A half-loaded board is a wrong
 *  answer wearing the clothes of a right one: an owner reading "one thing on
 *  at six" cannot tell that the one-to-ones simply failed to arrive. */
interface Board { classes: GymClass[]; slots: PtSlot[] }

export default function Timetable() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  // Kept separate from `err`: load() clears that on a successful timetable
  // read moments later, which would wipe this message off the screen.
  const [gymNameErr, setGymNameErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<Board | null>(null);
  const [openClass, setOpenClass] = useState<GymClass | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadFail, setLoadFail] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  const range = useCallback(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday.getTime() + 7 * DAY - 1);
    return { from: monday.toISOString(), to: sunday.toISOString(), monday };
  }, [weekOffset]);

  const load = useCallback(async (tenantId: string) => {
    const { from, to } = range();
    setRaw(null); setLoadFail(null);
    // allSettled, not all: which half failed is the useful part of the message.
    const [c, p] = await Promise.allSettled([
      fetchClasses(supabase, tenantId, from, to),
      fetchPtSlots(supabase, tenantId, from, to),
    ]);
    const missing: string[] = [];
    if (c.status === 'rejected') missing.push(`classes (${c.reason?.message ?? 'unknown error'})`);
    if (p.status === 'rejected') missing.push(`one-to-ones (${p.reason?.message ?? 'unknown error'})`);
    if (missing.length) { setLoadFail(missing.join(' and ')); return; }
    if (c.status === 'fulfilled' && p.status === 'fulfilled') {
      setRaw({ classes: c.value, slots: p.value });
    }
  }, [range]);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setRaw({ classes: [], slots: [] }); return; }
      // supabase-js resolves with { data, error } rather than rejecting, so a
      // read that failed — or that RLS refused — arrives as t === null and is
      // indistinguishable from a tenant row that genuinely is not there. Dropping
      // the error leaves the sidebar saying "No gym linked", which the owner reads
      // as a fact about their account: they go off to re-link a gym that was
      // linked all along and never learn the read is what broke.
      const { data: t, error: tErr } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) {
        setGymName(tErr ? null : (t?.name ?? null));
        setGymNameErr(tErr ? (tErr.message ?? 'Could not read which gym this account is linked to.') : null);
      }
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const board = useMemo(
    () => (raw ? mergeTimetable(raw.classes, raw.slots) : null),
    [raw],
  );
  const sum = useMemo(() => (board ? summariseBoard(board) : null), [board]);
  const conflicts = useMemo(() => (board ? clashes(board) : []), [board]);
  // Fill and show rate stay class-only. A one-to-one has no fill rate worth the
  // name (its capacity is one), and folding it in would move a number owners
  // have been reading for months without saying so.
  const classSum = useMemo(() => (raw ? summariseAttendance(raw.classes) : null), [raw]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;
  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/timetable">
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
      <Shell me={me} gymName={gymName} current="/timetable">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>The timetable is owner-only.</p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId);
  const { monday } = range();
  const weekLabel = `${monday.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(monday.getTime() + 6 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

  const remove = (e: TimetableEntry) => {
    const what = e.kind === 'class' ? `"${e.title}"` : 'that one-to-one';
    if (!confirm(`Remove ${what} from the timetable?`)) return;
    const job = e.kind === 'class'
      ? deleteClass(supabase, e.sourceId)
      : removePtSlot(supabase, e.sourceId);
    job.then(() => { setErr(null); refresh(); })
       .catch((x: any) => setErr(x?.message ?? 'Could not remove that.'));
  };

  const cols: Column<TimetableEntry>[] = [
    { key: 'when', header: 'When', value: (e) => e.startsAt,
      render: (e) => new Date(e.startsAt).toLocaleString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) },
    { key: 'what', header: 'What', value: (e) => e.title,
      render: (e) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Tag kind={e.kind} />
          <span style={{ color: 'var(--ink)' }}>{e.title}</span>
          {e.withName ? <span style={{ color: 'var(--ink3)' }}>· {e.withName}</span> : null}
        </span>
      ) },
    { key: 'room', header: 'Room', value: (e) => e.room },
    { key: 'who', header: 'Who', value: (e) => e.staffName,
      // A class with a free-text instructor and a one-to-one with a trainer
      // both land here; neither is invented, and an unnamed one stays a dash.
      render: (e) => e.staffName ?? <span className="dash">—</span> },
    { key: 'mins', header: 'Mins', value: (e) => e.durationMin, numeric: true },
    { key: 'booked', header: 'Booked', value: (e) => e.booked, numeric: true,
      render: (e) => (e.booked == null
        ? <span className="dash">—</span>
        : `${e.booked}${e.capacity == null ? '' : ` / ${e.capacity}`}`) },
    { key: 'state', header: 'State', value: (e) => stateLabel(e),
      render: (e) => {
        const s = stateLabel(e);
        return s ? <span style={{ color: 'var(--ink2)' }}>{s}</span> : <span className="dash">—</span>;
      } },
    { key: 'act', header: '', value: () => '', align: 'right',
      render: (e) => (
        <span style={{ display: 'inline-flex', gap: 12 }}>
          {e.kind === 'class' ? (
            <button
              onClick={() => {
                const c = raw?.classes.find((x) => x.id === e.sourceId);
                if (c) setOpenClass(c);
              }}
              style={linkBtn}
            >Check in</button>
          ) : null}
          <button onClick={() => remove(e)} style={{ ...linkBtn, color: 'var(--crit)' }}>Remove</button>
        </span>
      ) },
  ];

  return (
    <Shell me={me} gymName={gymName} current="/timetable">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1>Timetable</h1>
          <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
            {weekLabel} · classes and one-to-ones on one board
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setWeekOffset((w) => w - 1)} style={ghostBtn}>← Previous</button>
          <button onClick={() => setWeekOffset(0)} style={ghostBtn} disabled={weekOffset === 0}>This week</button>
          <button onClick={() => setWeekOffset((w) => w + 1)} style={ghostBtn}>Next →</button>
        </div>
      </div>

      {gymNameErr ? (
        <Banner tone="crit">
          This account is linked to a gym, but its record could not be read — the name is missing
          here, not unset: {gymNameErr}
        </Banner>
      ) : null}
      {err ? <Banner tone="crit">{err}</Banner> : null}
      {loadFail ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>The board is incomplete, so none of it is shown.</strong>{' '}
          Could not read {loadFail}. Half a timetable would read as a quiet week rather than a failed query.{' '}
          <button onClick={refresh} style={{ ...linkBtn, color: 'var(--brand)' }}>Try again</button>
        </Banner>
      ) : null}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
        borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
      }}>
        <Kpi label="Classes" text={sum ? String(sum.classes) : null} />
        <Kpi label="One-to-ones" text={sum ? String(sum.oneToOnes) : null}
             note={sum && sum.openSlots > 0 ? `${sum.openSlots} still open` : undefined} />
        <Kpi label="Places booked" text={sum ? (sum.booked == null ? null : String(sum.booked)) : null}
             note={sum && sum.booked == null ? 'nothing on the board reports a number' : 'classes and one-to-ones'} />
        <Kpi label="Class fill rate" text={classSum ? pct(classSum.fillRate) : null}
             note={classSum?.fillRate == null ? 'no capacity recorded' : undefined} />
        <Kpi label="Class show rate" text={classSum ? pct(classSum.showRate) : null}
             note={classSum?.showRate == null ? 'nothing booked yet' : undefined} />
        <Kpi label="Double-booked" text={sum ? String(sum.clashes) : null}
             note={sum && sum.clashes === 0 ? 'no room or trainer clashes' : 'needs a look'} />
      </div>

      {conflicts.length ? <Clashes rows={conflicts} /> : null}

      <FloorCover board={board} monday={monday} />

      <div style={{ display: 'grid', gap: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', marginBottom: 22 }}>
        <AddClass tenantId={tenantId} onChange={refresh} />
        <AddOneToOne tenantId={tenantId} onChange={refresh} />
      </div>

      <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
          <h2>This week</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
            Every class and every one-to-one, in the order they happen.
          </p>
        </div>
        {loadFail ? (
          <div style={{ padding: '26px 20px', color: 'var(--ink3)', fontSize: 13.5 }}>
            Not shown — the board could not be read in full.
          </div>
        ) : board === null ? <Loading /> : (
          <DataTable rows={board} columns={cols} rowKey={(e) => e.key}
            empty="Nothing on the timetable this week — no classes and no one-to-ones. Add one below." />
        )}
      </section>

      {openClass ? (
        <Roster gymClass={openClass} onClose={() => { setOpenClass(null); refresh(); }} />
      ) : null}
    </Shell>
  );
}

/** What state a row is in, in the language of its own kind. */
function stateLabel(e: TimetableEntry): string {
  if (e.kind === 'class') return '';
  if (e.outcome === 'completed') return 'Delivered';
  if (e.outcome === 'no_show') return 'No-show';
  if (e.outcome === 'cancelled') return 'Cancelled';
  if (e.outcome === 'late_cancelled') return 'Late cancel';
  if (e.slotStatus === 'blocked') return 'Held';
  if (e.slotStatus === 'available') return 'Open';
  if (e.slotStatus === 'booked') return 'Booked';
  return '';
}

/* ── is the floor covered at six? ──────────────────────────────────────────── */

function FloorCover({ board, monday }: { board: TimetableEntry[] | null; monday: Date }) {
  // Default to today when the shown week contains it, so the first thing an
  // owner sees is the day they are standing in.
  const todayIdx = useMemo(() => {
    const start = monday.getTime();
    const now = Date.now();
    const i = Math.floor((now - start) / DAY);
    return i >= 0 && i < 7 ? i : 0;
  }, [monday]);
  const [dayIdx, setDayIdx] = useState(todayIdx);
  const [hour, setHour] = useState(18);
  useEffect(() => { setDayIdx(todayIdx); }, [todayIdx]);

  // Local midnight built from parts rather than by adding 86_400_000, so a
  // clock change does not shift the whole strip by an hour.
  const dayStart = useMemo(
    () => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayIdx),
    [monday, dayIdx],
  );

  const hours = useMemo(
    () => (board ? floorByHour(board, dayStart.getTime(), FIRST_HOUR, LAST_HOUR) : null),
    [board, dayStart],
  );
  const slice = useMemo(
    () => (board ? floorAt(board, dayStart.getTime() + hour * 3_600_000) : null),
    [board, dayStart, hour],
  );

  const busiest = hours ? Math.max(1, ...hours.map((h) => h.entries.length)) : 1;

  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)', display: 'flex', gap: 12, alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h2>Who is on the floor</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
            Classes and one-to-ones counted together. A quiet hour is shown as a quiet hour, not left out.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {DAY_NAMES.map((d, i) => (
            <button key={d} onClick={() => setDayIdx(i)}
              style={{ ...ghostBtn, padding: '5px 9px',
                       background: i === dayIdx ? 'var(--brand)' : 'var(--surface2)',
                       color: i === dayIdx ? 'var(--brand-ink)' : 'var(--ink2)' }}>{d}</button>
          ))}
        </div>
      </div>

      {board === null ? <Loading /> : (
        <>
          <div style={{ padding: '14px 14px 4px', display: 'grid', gap: 3,
                        gridTemplateColumns: `repeat(${(hours ?? []).length}, minmax(0, 1fr))` }}>
            {(hours ?? []).map((h, i) => {
              const on = h.entries.length;
              const selected = FIRST_HOUR + i === hour;
              return (
                <button
                  key={h.at}
                  onClick={() => setHour(FIRST_HOUR + i)}
                  aria-pressed={selected}
                  title={`${FIRST_HOUR + i}:00 — ${on} on the floor`}
                  style={{
                    border: selected ? '1px solid var(--brand)' : '1px solid var(--ring)',
                    borderRadius: 0, padding: '6px 2px', cursor: 'pointer',
                    background: on === 0 ? 'var(--surface2)' : 'var(--surface2)',
                    fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink3)',
                    display: 'grid', gap: 4, justifyItems: 'center',
                  }}
                >
                  <span>{String(FIRST_HOUR + i).padStart(2, '0')}</span>
                  <span style={{
                    display: 'block', width: '100%',
                    height: 4 + Math.round((on / busiest) * 20),
                    background: on === 0 ? 'var(--ring)' : 'var(--brand)',
                    borderRadius: 0, opacity: on === 0 ? 0.5 : 1,
                  }} />
                  <span style={{ color: on === 0 ? 'var(--ink3)' : 'var(--ink2)' }}>
                    {on === 0 ? '—' : on}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ padding: '10px 14px 16px' }}>
            <SliceDetail slice={slice} hour={hour} day={dayStart} />
          </div>
        </>
      )}
    </section>
  );
}

function SliceDetail({ slice, hour, day }: { slice: FloorSlice | null; hour: number; day: Date }) {
  const when = `${day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })} at ${String(hour).padStart(2, '0')}:00`;
  if (!slice) return <Loading />;

  if (!slice.entries.length) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink3)' }}>
        Nothing at all on {when} — no class, and no trainer with a client.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
        <strong style={{ color: 'var(--ink)' }}>{when}</strong>
        {' · '}{slice.classes} class{slice.classes === 1 ? '' : 'es'}
        {' · '}{slice.oneToOnes} one-to-one{slice.oneToOnes === 1 ? '' : 's'}
        {' · '}{slice.staff.length} on the floor
        {slice.unstaffed > 0 ? ` · ${slice.unstaffed} with nobody named` : ''}
        {' · '}
        {slice.heads == null
          ? <span className="dash">no headcount recorded</span>
          : `${slice.heads} expected in`}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {slice.entries.map((e) => (
          <li key={e.key} style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            fontSize: 12.5, color: 'var(--ink2)',
            border: '1px solid var(--ring)', borderRadius: 0, padding: '7px 10px',
            background: 'var(--surface2)',
          }}>
            <Tag kind={e.kind} />
            <span style={{ color: 'var(--ink)' }}>{e.title}</span>
            {e.withName ? <span style={{ color: 'var(--ink3)' }}>with {e.withName}</span> : null}
            <span style={{ color: 'var(--ink3)' }}>
              {e.staffName ?? 'nobody named'}
              {e.room ? ` · ${e.room}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Clashes({ rows }: { rows: ReturnType<typeof clashes> }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>Double-booked</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
          Only visible now that both calendars are on one board. A room clash is
          counted when a class is one of the two — several one-to-ones sharing the
          main floor is normal, and nothing here records how many a room holds.
        </p>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((c, i) => (
          <li key={`${c.reason}:${c.a.key}:${c.b.key}:${i}`} style={{
            padding: '10px 14px', borderTop: i ? '1px solid var(--ring)' : 'none', fontSize: 13,
          }}>
            <span style={{ color: 'var(--crit)', fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {c.reason === 'room' ? 'Room' : 'Trainer'}
            </span>
            <span style={{ color: 'var(--ink)', marginLeft: 8 }}>{c.what}</span>
            <span style={{ color: 'var(--ink3)', marginLeft: 8 }}>
              {new Date(c.a.startsAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
              {' — '}{c.a.title}{c.a.withName ? ` (${c.a.withName})` : ''}
              {' overlaps '}{c.b.title}{c.b.withName ? ` (${c.b.withName})` : ''}
              {' at '}{new Date(c.b.startsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tag({ kind }: { kind: TimetableEntry['kind'] }) {
  const cls = kind === 'class';
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.09em', textTransform: 'uppercase',
      border: '1px solid var(--ring)', borderRadius: 0, padding: '2px 5px', whiteSpace: 'nowrap',
      color: cls ? 'var(--ink2)' : 'var(--brand)',
    }}>{cls ? 'Class' : '1:1'}</span>
  );
}

/* ── adding a one-to-one ───────────────────────────────────────────────────── */

function AddOneToOne({ tenantId, onChange }: { tenantId: string; onChange: () => void }) {
  const [trainers, setTrainers] = useState<{ id: string; name: string | null }[] | null>(null);
  const [trainersErr, setTrainersErr] = useState<string | null>(null);
  const [trainerId, setTrainerId] = useState('');
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState('60');
  const [room, setRoom] = useState('');
  const [hold, setHold] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchTrainerOptions(supabase, tenantId)
      .then((rows) => { if (live) { setTrainers(rows); setTrainersErr(null); } })
      // Null stays null: an empty picker must not claim the gym has no
      // trainers when the query is what failed.
      .catch((e: any) => { if (live) setTrainersErr(e?.message ?? 'Could not read your trainers.'); });
    return () => { live = false; };
  }, [tenantId]);

  const draft = {
    trainerId,
    startsAt: when ? new Date(when).toISOString() : '',
    durationMin: parseInt(duration, 10),
    room,
    blocked: hold,
  };
  // Only nag once there is something to nag about.
  const blocker = (trainerId || when) ? slotBlocker(draft) : null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const stop = slotBlocker(draft);
    if (stop) { setMsg(stop); return; }
    setBusy(true); setMsg(null);
    try {
      await createPtSlot(supabase, tenantId, draft);
      setMsg(hold ? 'Held on the timetable.' : 'On the timetable, open for a member to book.');
      setWhen('');
      onChange();
    } catch (x: any) {
      setMsg(x?.message ?? 'Could not add that slot.');
    } finally { setBusy(false); }
  };

  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>Add a one-to-one</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
          Puts a PT slot on the gym&apos;s board rather than only in the trainer&apos;s calendar.
          Members book an open slot from the Repple app; hold it instead to keep the hour off sale.
        </p>
      </div>
      <form onSubmit={add} style={{ display: 'flex', gap: 8, padding: '12px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
        {trainersErr ? (
          <span style={{ fontSize: 12.5, color: 'var(--crit)' }}>{trainersErr}</span>
        ) : trainers === null ? (
          <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>Loading trainers…</span>
        ) : trainers.length === 0 ? (
          <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
            No trainers on your roster yet — invite one first and they will appear here.
          </span>
        ) : (
          <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)} style={{ ...field, minWidth: 150 }}>
            <option value="">Which trainer?</option>
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>{t.name ?? 'Unnamed trainer'}</option>
            ))}
          </select>
        )}
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ ...field, flex: 2, minWidth: 190 }} />
        <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Minutes" inputMode="numeric" style={{ ...field, width: 90 }} />
        <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" style={{ ...field, width: 110 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink3)', fontSize: 12.5 }}>
          <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} />
          hold the hour
        </label>
        <button type="submit" disabled={busy || !trainers?.length} style={primaryBtn}>Add</button>
      </form>
      {blocker ? <div style={{ padding: '0 14px 12px', color: '#f0c04e', fontSize: 12.5 }}>{blocker}</div> : null}
      {msg ? <div style={{ padding: '0 14px 12px', color: 'var(--ink3)', fontSize: 12.5 }}>{msg}</div> : null}
    </section>
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
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)' }}>
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

  // setAttendance throws on a database error. Unreported, the tick simply did
  // not move and the button still reads "Mark here" — so a member who attended
  // is recorded absent, which corrupts the show-rate and the attendance history
  // the gym pays trainers on.
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
          background: 'var(--surface)', border: '1px solid var(--ring)', borderRadius: 0,
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
                    border: '1px solid var(--ring)', borderRadius: 0, padding: '5px 12px',
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
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const ghostBtn = {
  background: 'var(--surface2)', color: 'var(--ink2)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '6px 11px', fontSize: 12.5, cursor: 'pointer',
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
      margin: '14px 0', padding: '11px 14px', borderRadius: 0, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13,
    }}>{children}</div>
  );
}

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
