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
  cancelClass, restoreClass, cancelSeriesFrom, updateClass, updateSeriesFrom,
  fetchRoster, setAttendance, promoteFromWaitlist, returnToWaitlist,
  summariseAttendance, pct, isCancelled, classesThatRan, splitRoster, placesLeft,
  type GymClass, type RosterEntry, type ClassPatch,
} from '@lib/gymSchedule';
import {
  fetchPtSlots, fetchTrainerOptions, createPtSlot, removePtSlot, updatePtSlot,
  mergeTimetable, summariseBoard, clashes, floorByHour, floorAt,
  slotBlocker,
  type PtSlot, type TimetableEntry, type FloorSlice,
} from '@lib/gymPtSchedule';
import { fetchMemberships, type Membership } from '@lib/gymRecord';

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
  // The class being corrected. There was no edit-a-class path in the product at
  // all: a class typed in with the wrong capacity or the wrong coach could only
  // be deleted and retyped, which took its bookings with it.
  const [editing, setEditing] = useState<GymClass | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadFail, setLoadFail] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  // Who the gym can book a one-to-one to. Read once rather than per week — the
  // roster does not change when the board does — and kept null on a failed read
  // so an empty picker never reads as a gym with no members.
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [membersErr, setMembersErr] = useState<string | null>(null);

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
      // `includeCancelled` because this is the board: a class the gym called
      // off is a thing that happened to this week and the owner has to be able
      // to see it, put it back on, and know why it is not running. Every other
      // caller of `fetchClasses` gets the default — cancelled rows excluded —
      // so a called-off Tuesday cannot put twenty unsold places into anybody's
      // fill rate. The merged board below drops them again before any figure is
      // computed; only the "Called off" list and the register keep them.
      fetchClasses(supabase, tenantId, from, to, { includeCancelled: true }),
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
      // The roster, independently of the board: it is not week-scoped, and a
      // membership read that fails must not empty the timetable with it.
      fetchMemberships(supabase, who.tenantId)
        .then((rows) => { if (live) { setMembers(rows); setMembersErr(null); } })
        .catch((e: any) => { if (live) { setMembers(null); setMembersErr(e?.message ?? 'Could not read the member list.'); } });
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  // Cancelled classes are OFF the merged board, and everything computed from
  // the board — floor cover, clashes, "on the floor at six" — is therefore
  // computed over what is actually happening. A called-off class left in would
  // report a trainer as covering an hour they are not working, and would raise
  // a room clash against a class that is not in the room. They are listed
  // separately below, which is the only place they belong.
  const board = useMemo(
    () => (raw ? mergeTimetable(classesThatRan(raw.classes), raw.slots) : null),
    [raw],
  );
  const calledOff = useMemo(() => (raw ? raw.classes.filter(isCancelled) : null), [raw]);
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

  /* ── who may see this board, and who may change it ────────────────────────
   *
   * This said `me.role !== 'owner'` → "The timetable is owner-only", and that
   * sentence was the reason a class could go unregistered for good.
   *
   * The register — the Check in button on each class row, which is the only
   * thing in this console that writes `class_bookings.attended_at` — sat behind
   * it. So did the one on /classes, which is a cross-coach performance screen
   * and correctly owner-only, and whose refusal message tells a trainer in as
   * many words: "Your own classes and their registers are on the Timetable."
   * They were not. Both doors were shut and one of them pointed at the other.
   *
   * The cost of a missed register is not cosmetic and it is not recoverable
   * later: attendance is `attended_at is not null`, nobody ticks a class three
   * days afterwards from memory, and fill rate, show rate, the retention
   * signal, the coach's own delivery record and — where a gym pays per head —
   * class pay are all computed from it. A coach standing in the room is the
   * only person who knows, and until now the only surface they had was
   * app/(trainer)/class-checkin.tsx on a phone.
   *
   * So the board is staff-wide, like /door and /equipment, for the same reason
   * those two are: it is a fact about the building. Editing it is not. Adding a
   * class, putting up a one-to-one and removing anything from the board stay
   * with the owner, and are not rendered at all for a trainer rather than
   * rendered and refused — the database says the same thing independently
   * (`gym_classes_owner_rw`, `pt_slots`' own policies), so a hand-typed URL
   * gets an empty result rather than a leak.
   */
  const staff = me.role === 'owner' || me.role === 'trainer';
  if (!staff) {
    return (
      <Shell me={me} gymName={gymName} current="/timetable">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>The timetable is for gym staff.</p>
      </Shell>
    );
  }
  const owner = me.role === 'owner';

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId);
  const { monday } = range();
  const weekLabel = `${monday.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(monday.getTime() + 6 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

  const classFor = (id: string) => raw?.classes.find((x) => x.id === id) ?? null;

  /**
   * ── Two verbs, because they are two different acts ────────────────────────
   *
   * "Remove" was the only one the board had, and it is a hard DELETE.
   * `class_bookings.class_id` is `on delete cascade`, so calling off a
   * snowed-off Tuesday destroyed its twelve bookings, every `attended_at` on
   * them, and its waiting list — and quietly improved the month's fill rate,
   * because the class that went badly stopped being in the average the moment
   * the owner acted on it.
   *
   * So: a class with anybody attached to it can only be CALLED OFF, which keeps
   * the row, the bookings and the register, and records a reason. Delete stays
   * for the class typed in wrong five minutes ago that nobody has booked — and
   * is not rendered at all otherwise, rather than rendered and refused.
   */
  const callOff = (c: GymClass) => {
    const why = prompt(
      `Why is "${c.title}" not running?\n\nThe class, its ${c.booked} booking${c.booked === 1 ? '' : 's'} and its register are all kept — this records that it did not happen.`,
      '',
    );
    // Cancel on the prompt is null and must do nothing. An empty string is
    // somebody who cleared the box, and `cancelClass` refuses that with its own
    // sentence rather than filing a cancellation nobody explained.
    if (why === null) return;
    cancelClass(supabase, c.id, why)
      .then(() => { setErr(null); refresh(); })
      .catch((x: any) => setErr(x?.message ?? 'That class was not called off, so it is still on the timetable.'));
  };

  const putBack = (c: GymClass) => {
    restoreClass(supabase, c.id)
      .then(() => { setErr(null); refresh(); })
      .catch((x: any) => setErr(x?.message ?? 'That class was not put back on.'));
  };

  const remove = (e: TimetableEntry) => {
    if (e.kind === 'class') {
      const c = classFor(e.sourceId);
      // Belt and braces: the button is only rendered on an empty class, and
      // this refuses anyway. Between render and click somebody can book.
      if (c && (c.booked > 0 || c.waitlisted > 0)) {
        setErr('That class has people on it, so it can only be called off — deleting it would take their bookings and the register with it.');
        return;
      }
      if (!confirm(`Delete "${e.title}"? Nobody has booked it, so nothing is lost. Use “Call off” instead if it was meant to run.`)) return;
      deleteClass(supabase, e.sourceId)
        .then(() => { setErr(null); refresh(); })
        .catch((x: any) => setErr(x?.message ?? 'Could not remove that.'));
      return;
    }
    if (!confirm('Remove that one-to-one from the timetable?')) return;
    removePtSlot(supabase, e.sourceId)
      .then(() => { setErr(null); refresh(); })
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
      render: (e) => {
        const c = e.kind === 'class' ? classFor(e.sourceId) : null;
        // Nobody attached means nothing is lost by deleting; anybody attached
        // means the only honest verb is "call off".
        const empty = !!c && c.booked === 0 && c.waitlisted === 0;
        return (
        <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
          {e.kind === 'class' ? (
            <button
              onClick={() => { if (c) setOpenClass(c); }}
              style={linkBtn}
            >Check in</button>
          ) : null}
          {owner && c ? (
            <button onClick={() => setEditing(c)} style={linkBtn}>Edit</button>
          ) : null}
          {owner && c ? (
            <button onClick={() => callOff(c)} style={{ ...linkBtn, color: 'var(--warn)' }}>Call off</button>
          ) : null}
          {/* Booking somebody onto an hour and taking an hour off the board are
              the owner's, and the two policies behind them say so. Not rendered
              for a trainer rather than rendered and refused: a button that
              silently matches zero rows is the failure this codebase is
              written against. The register beside them is staff work. */}
          {owner && e.kind === 'one_to_one' ? (
            <BookTo
              slot={raw?.slots.find((s) => s.id === e.sourceId) ?? null}
              members={members} membersErr={membersErr}
              onDone={(m) => { setErr(m); if (!m) refresh(); }}
            />
          ) : null}
          {/* Rendered only where deleting destroys nothing. A class with
              bookings has no Remove at all rather than one that refuses — the
              refusal above is the guard, this is the answer to "why is it not
              offered". */}
          {owner && (e.kind !== 'class' || empty) ? (
            <button onClick={() => remove(e)} style={{ ...linkBtn, color: 'var(--crit)' }}>
              {e.kind === 'class' ? 'Delete' : 'Remove'}
            </button>
          ) : null}
        </span>
        );
      } },
  ];

  return (
    <Shell me={me} gymName={gymName} current="/timetable">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1>Timetable</h1>
          <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
            {weekLabel} · classes and one-to-ones on one board
            {owner ? null : ' · take a register from any class here'}
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
      {/* Said before the figures, not after them. `sessions_trainer` is
          `trainer_id = auth.uid()`, so a coach reading this board gets every
          class in the gym and only their OWN one-to-ones — and RLS filters
          rather than refuses, so the missing hours arrive as an ordinary empty
          result with no error anywhere. Unsaid, "One-to-ones 2" and
          "Double-booked 0" read as facts about the gym's week rather than about
          this coach's, and a clash with a colleague's slot is invisible in the
          one place built to show clashes. */}
      {!owner ? (
        <Banner>
          Every class in the gym is here; the one-to-ones are <strong style={{ color: 'var(--ink)' }}>yours
          only</strong> — colleagues&rsquo; hours are not readable from your account, so the
          one-to-one, floor cover and double-booked figures below describe your week rather than the
          gym&rsquo;s. Check in is the register and it writes for real.
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

      {owner ? (
        <div style={{ display: 'grid', gap: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', marginBottom: 22 }}>
          <AddClass tenantId={tenantId} onChange={refresh} />
          <AddOneToOne tenantId={tenantId} members={members} membersErr={membersErr} onChange={refresh} />
        </div>
      ) : null}

      <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
          <h2>This week</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
            Every class and every one-to-one, in the order they happen.{' '}
            {owner ? (
              <>
                A one-to-one can be booked to a member here — for the one who rang up — and freeing
                one opens the hour to anybody rather than to whoever is first on its waitlist in the
                app; only the trainer&rsquo;s own screen hands it to them.
              </>
            ) : (
              <>
                Check in marks who turned up. It is the only record of attendance there is — nothing
                infers it from a booking — so a class left unregistered stays unattended in the fill
                and show rates, in the gym&rsquo;s retention figures and on your own delivery record.
                Changing the board itself is the owner&rsquo;s.
              </>
            )}
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

      {owner ? <CalledOff classes={calledOff} onPutBack={putBack} /> : null}

      {openClass ? (
        <Roster gymClass={openClass} canEdit={staff} onClose={() => { setOpenClass(null); refresh(); }} />
      ) : null}
      {editing ? (
        <EditClass
          gymClass={editing} tenantId={tenantId}
          onClose={(changed) => { setEditing(null); if (changed) refresh(); }}
        />
      ) : null}
    </Shell>
  );
}

/* ── the classes that are not running ──────────────────────────────────────── */

/**
 * Classes the gym called off this week.
 *
 * They are off the board above — nothing that computes floor cover or clashes
 * may count a class that is not happening — so without this section a cancelled
 * class would simply vanish, which is the behaviour a hard DELETE had and the
 * whole reason cancelling was worth building. The reason is shown because it is
 * the point: "instructor off sick" and "nobody booked it" are two very different
 * facts about the same empty slot, and both are gone in three months without a
 * column to keep them in.
 */
function CalledOff({ classes, onPutBack }: {
  classes: GymClass[] | null; onPutBack: (c: GymClass) => void;
}) {
  if (!classes || classes.length === 0) return null;
  return (
    <section style={{ border: '1px solid var(--ring)', borderLeft: '3px solid var(--warn)', background: 'var(--surface)', marginTop: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>Called off this week</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
          Kept, with their bookings and their registers. They are out of the fill and show rates —
          a class that did not open its room did not fail to sell it — and out of the floor cover
          above, because nobody is standing in that room.
        </p>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {classes.map((c, i) => (
          <li key={c.id} style={{
            padding: '10px 14px', borderTop: i ? '1px solid var(--ring)' : 'none',
            display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 13,
          }}>
            <span className="mono" style={{ color: 'var(--ink3)', fontSize: 11.5 }}>
              {new Date(c.startsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span style={{ color: 'var(--ink)' }}>{c.title}</span>
            <span style={{ color: 'var(--ink2)' }}>
              {c.cancelReason ?? <span className="dash">no reason recorded</span>}
            </span>
            {c.booked > 0 || c.waitlisted > 0 ? (
              <span style={{ color: 'var(--ink3)', fontSize: 12 }}>
                {c.booked} booked{c.waitlisted > 0 ? `, ${c.waitlisted} waiting` : ''} — still on the record
              </span>
            ) : null}
            <button onClick={() => onPutBack(c)} style={{ ...linkBtn, marginLeft: 'auto' }}>Put it back on</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── correcting a class that is already up ─────────────────────────────────── */

/** Local-time value for an `<input type="datetime-local">`, which takes wall
 *  clock and no zone. `toISOString()` here would show a UK owner their 6am
 *  class as 05:00 in summer and save it an hour early. */
function localInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Edit one class, or the whole series from this one onward.
 *
 * ── Why "this and every later one" and never "the whole series" ───────────
 *
 * The occurrences already past are the gym's attendance record. Applying a coach
 * change backwards would re-attribute last month's classes to somebody who did
 * not teach them, move their class hours on /staff, and change who /classes
 * reports a fill rate against. What an owner is actually changing when they say
 * "the Tuesday 6am Spin has a new coach" is the arrangement going forward, and
 * that is the only thing this offers.
 *
 * Time is deliberately per-occurrence only. Moving a series means moving each
 * occurrence by the same offset; setting `starts_at` across a series would put
 * twelve classes on one Tuesday evening, and `updateSeriesFrom` refuses the
 * field outright rather than trusting this form not to send it.
 */
function EditClass({ gymClass, tenantId, onClose }: {
  gymClass: GymClass; tenantId: string; onClose: (changed: boolean) => void;
}) {
  const [title, setTitle] = useState(gymClass.title);
  const [when, setWhen] = useState(localInputValue(gymClass.startsAt));
  const [duration, setDuration] = useState(String(gymClass.durationMin));
  const [capacity, setCapacity] = useState(String(gymClass.capacity));
  const [room, setRoom] = useState(gymClass.room ?? '');
  const [trainerId, setTrainerId] = useState(gymClass.trainerId ?? '');
  const [instructor, setInstructor] = useState(gymClass.instructor ?? '');
  const [scope, setScope] = useState<'one' | 'series'>('one');
  const [trainers, setTrainers] = useState<{ id: string; name: string | null }[] | null>(null);
  const [trainersErr, setTrainersErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchTrainerOptions(supabase, tenantId)
      .then((rows) => { if (live) { setTrainers(rows); setTrainersErr(null); } })
      .catch((e: any) => { if (live) { setTrainers(null); setTrainersErr(e?.message ?? 'Could not read your coaches.'); } });
    return () => { live = false; };
  }, [tenantId]);

  const inSeries = !!gymClass.seriesId;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    // The picked coach's name wins over anything typed, so the label and the
    // join can never name two different people — the same rule AddClass keeps.
    const named = trainerId ? (trainers?.find((t) => t.id === trainerId)?.name ?? null) : (instructor.trim() || null);
    const patch: ClassPatch = {
      title: title.trim(),
      room: room.trim() || null,
      instructor: named,
      trainerId: trainerId || null,
      durationMin: parseInt(duration, 10) || gymClass.durationMin,
      capacity: parseInt(capacity, 10) || 0,
    };
    try {
      if (scope === 'series' && gymClass.seriesId) {
        const n = await updateSeriesFrom(supabase, gymClass.seriesId, gymClass.startsAt, patch);
        setMsg(`${n} ${n === 1 ? 'class' : 'classes'} changed, from this one onward. The ones already past are untouched — they are the attendance record.`);
      } else {
        // Time only ever moves one occurrence. See the note above.
        await updateClass(supabase, gymClass.id, {
          ...patch,
          ...(when ? { startsAt: new Date(when).toISOString() } : {}),
        });
        setMsg('Saved.');
      }
      onClose(true);
    } catch (x: any) {
      setMsg(x?.message ?? 'That change was refused, so the class is unchanged.');
    } finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-label={`Edit ${gymClass.title}`}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', padding: 24, zIndex: 10 }}
         onClick={() => onClose(false)}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ width: 560, maxWidth: '100%', maxHeight: '85vh', overflow: 'auto', background: 'var(--surface)', border: '1px solid var(--ring)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--ring)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2>Edit this class</h2>
            <p style={{ margin: '3px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
              {new Date(gymClass.startsAt).toLocaleString()} · {gymClass.booked} booked
              {inSeries ? ' · part of a weekly series' : ' · a one-off'}
            </p>
          </div>
          <button onClick={() => onClose(false)} style={ghostBtn}>Close</button>
        </div>

        <form onSubmit={save} style={{ display: 'grid', gap: 9, padding: 14 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Class name" style={field} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                   disabled={scope === 'series'}
                   style={{ ...field, flex: 2, minWidth: 190, opacity: scope === 'series' ? 0.5 : 1 }} />
            <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Minutes" inputMode="numeric" style={{ ...field, width: 90 }} />
            <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Capacity" inputMode="numeric" style={{ ...field, width: 96 }} />
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" style={{ ...field, width: 120 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)} style={{ ...field, minWidth: 160 }}
                    aria-label="Which coach is teaching this class">
              <option value="">
                {trainersErr ? 'Coaches unread — name beside' : trainers === null ? 'Reading coaches…' : 'Visiting — name beside'}
              </option>
              {(trainers ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name ?? 'Unnamed trainer'}</option>
              ))}
            </select>
            <input value={instructor} onChange={(e) => setInstructor(e.target.value)}
                   disabled={!!trainerId}
                   placeholder={trainerId ? 'On their record' : 'Instructor'}
                   style={{ ...field, width: 150, opacity: trainerId ? 0.5 : 1 }} />
          </div>

          {inSeries ? (
            <div style={{ display: 'grid', gap: 5, fontSize: 12.5, color: 'var(--ink2)' }}>
              <label style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                <input type="radio" checked={scope === 'one'} onChange={() => setScope('one')} />
                This class only
              </label>
              <label style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                <input type="radio" checked={scope === 'series'} onChange={() => setScope('series')} />
                This class and every later one in the series
              </label>
              <span style={{ color: 'var(--ink3)' }}>
                The occurrences already past are never touched — they are what the gym’s attendance
                record says happened. The time can only be moved on a single class: setting one
                instant across a series would stack twelve classes on one evening.
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
              This class belongs to no series, so there is nothing else to change with it. Classes
              added as a repeat from now on carry a series id and can be changed together.
            </span>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={busy} style={primaryBtn}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => onClose(false)} style={ghostBtn}>Cancel</button>
          </div>
          {msg ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
        </form>
      </div>
    </div>
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

/* ── booking a slot to a named member ──────────────────────────────────────── */

/** The gym's own members, one option each, newest membership first. A person
 *  with two memberships is one person and one option. */
function memberOptions(members: Membership[] | null): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const m of members ?? []) {
    if (m.status !== 'active') continue;
    if (!seen.has(m.memberId)) seen.set(m.memberId, m.memberName ?? m.memberId);
  }
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Put a named member on an open slot, or take them off it.
 *
 * The gym books people in over the phone. Until now the board said "Members
 * book an open slot from the Repple app", which is a reasonable default and not
 * a complete product: the hour was taken, the trainer knew, and nothing in the
 * record did — so the slot still counted as spare PT capacity and the member's
 * own app showed them nothing.
 *
 * It writes what the app's own booking writes — `bookingFields` in
 * gymPtSchedule.ts holds that in one place — so a slot booked here is the same
 * row `book_session` would have produced, and the no-double-booking constraint,
 * payroll and the member's calendar all see it as one.
 *
 * Not offered once a session has an outcome or has been paid for. That is no
 * longer a plan, it is the record: `sessions_block_delete_of_record` refuses to
 * let one be removed for exactly this reason, and moving whose session it was
 * after the fact would rewrite who a trainer was paid for.
 *
 * ONE THING IT DELIBERATELY DOES NOT DO, and the section below says so out loud:
 * it does not promote the waitlist. Promotion is not a trigger — it rides inside
 * `cancel_my_session` and `promote_session_waitlist`
 * (126-the-late-fee-and-the-waitlist.sql), and the second is authorised on
 * `trainer_id = auth.uid()`, so an owner cannot call it. Freeing an hour here
 * therefore opens it for anyone rather than handing it to whoever was first in
 * the queue. Claiming otherwise would be worse than saying it.
 */
function BookTo({ slot, members, membersErr, onDone }: {
  slot: PtSlot | null;
  members: Membership[] | null;
  membersErr: string | null;
  onDone: (err: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!slot) return null;

  if (slot.outcome !== null || slot.settlementId !== null) {
    return (
      <span style={{ fontSize: 11.5, color: 'var(--ink3)' }}>
        {slot.settlementId ? 'paid' : 'marked'}
      </span>
    );
  }

  const options = memberOptions(members);

  const change = async (next: string) => {
    setBusy(true);
    try {
      await updatePtSlot(supabase, slot.id, { clientId: next || null });
      onDone(null);
    } catch (e: any) {
      const who = options.find((o) => o.id === next)?.name ?? 'that member';
      onDone(next
        ? `${who} was not booked in: ${e?.message ?? 'the change was refused'}. The slot is unchanged.`
        : `That slot was not freed: ${e?.message ?? 'the change was refused'}. It is still booked.`);
    } finally { setBusy(false); }
  };

  return (
    <select
      value={slot.clientId ?? ''}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      aria-label="Book this one-to-one to a member"
      style={{ ...field, padding: '3px 6px', fontSize: 11.5, maxWidth: 170 }}
    >
      {/* Three different sentences, because they are three different facts: the
          slot is open, the roster failed to read, or the gym has nobody active. */}
      <option value="">
        {members === null
          ? (membersErr ? 'Open — roster unread' : 'Open — reading the roster')
          : 'Open — nobody booked'}
      </option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      {/* A slot booked to somebody who is no longer on the active roster still
          shows who holds it, rather than silently reading as open. */}
      {slot.clientId && !options.some((o) => o.id === slot.clientId) ? (
        <option value={slot.clientId}>{slot.clientName ?? 'booked — not on the roster'}</option>
      ) : null}
    </select>
  );
}

/* ── adding a one-to-one ───────────────────────────────────────────────────── */

function AddOneToOne({ tenantId, members, membersErr, onChange }: {
  tenantId: string;
  members: Membership[] | null;
  membersErr: string | null;
  onChange: () => void;
}) {
  const [trainers, setTrainers] = useState<{ id: string; name: string | null }[] | null>(null);
  const [trainersErr, setTrainersErr] = useState<string | null>(null);
  const [trainerId, setTrainerId] = useState('');
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState('60');
  const [room, setRoom] = useState('');
  const [hold, setHold] = useState(false);
  // Empty is the default and stays the default: a slot goes up open unless the
  // gym says who is already in it.
  const [clientId, setClientId] = useState('');
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
    clientId: clientId || null,
  };
  const options = memberOptions(members);
  // Only nag once there is something to nag about.
  const blocker = (trainerId || when) ? slotBlocker(draft) : null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const stop = slotBlocker(draft);
    if (stop) { setMsg(stop); return; }
    setBusy(true); setMsg(null);
    try {
      await createPtSlot(supabase, tenantId, draft);
      const who = options.find((o) => o.id === clientId)?.name;
      setMsg(hold
        ? 'Held on the timetable.'
        : who
          ? `On the timetable, booked to ${who}. It shows in their app as a session with the trainer.`
          : 'On the timetable, open for a member to book.');
      setWhen(''); setClientId('');
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
          Members book an open slot from the Repple app — or name one here, for the member who
          rang up. Hold it instead to keep the hour off sale entirely.
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
        {/* Disabled rather than hidden while the hour is held: the two are a
            real either/or (slotBlocker refuses both together) and a control
            that disappears reads as one that was never there. */}
        <select
          value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={hold}
          style={{ ...field, minWidth: 170, opacity: hold ? 0.5 : 1 }}
          aria-label="Book this one-to-one to a member"
        >
          <option value="">
            {members === null
              ? (membersErr ? 'Open — roster unread' : 'Open — reading the roster')
              : 'Open — members book it'}
          </option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink3)', fontSize: 12.5 }}>
          <input type="checkbox" checked={hold} onChange={(e) => { setHold(e.target.checked); if (e.target.checked) setClientId(''); }} />
          hold the hour
        </label>
        <button type="submit" disabled={busy || !trainers?.length} style={primaryBtn}>Add</button>
      </form>
      {blocker ? <div style={{ padding: '0 14px 12px', color: '#f0c04e', fontSize: 12.5 }}>{blocker}</div> : null}
      {membersErr ? (
        <div style={{ padding: '0 14px 12px', color: '#f0c04e', fontSize: 12.5 }}>
          The member list could not be read, so this slot can only go up open: {membersErr}. That is
          a failed query, not a gym with no members — book it to somebody once the page reloads.
        </div>
      ) : null}
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
  /**
   * Who is teaching it, as the trainer's own id.
   *
   * `gym_classes.trainer_id` has existed since part 02 and this form has never
   * written it — it wrote `instructor`, a free-text name, and nothing else. All
   * three consequences were silent:
   *
   *  · /staff reports class hours per coach out of `fetchDemand`, which keys on
   *    `gym_classes.trainer_id`. Null for every class means every coach's class
   *    hours read zero, on the screen an owner uses to decide who is
   *    overworked. Nothing says "unknown"; it says none.
   *  · /classes groups performance "By coach" and falls back to a name bucket
   *    when there is no id, so "Sam", "sam" and "Sam T" are three coaches and
   *    the same person's fill rate is split three ways.
   *  · `gym_classes_write` is `trainer_id = auth.uid()`. A trainer therefore
   *    cannot edit, move or delete any class the console created — the policy
   *    that exists to give them their own timetable can never match a row.
   *
   * `instructor` is kept beside it rather than removed, for the visiting
   * instructor with no Repple account. A name is a label; an id is a join.
   */
  const [trainerId, setTrainerId] = useState('');
  const [trainers, setTrainers] = useState<{ id: string; name: string | null }[] | null>(null);
  // Null stays null on a failed read: an empty picker must not claim the gym
  // has no coaches when the query is what failed, because the honest response
  // to "no coaches" is to type a name into the box beside it — which is exactly
  // the anonymous class this change exists to stop.
  const [trainersErr, setTrainersErr] = useState<string | null>(null);
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
  // Kept, because a failed read used to be swallowed into `setKit([])` and an
  // empty register is not an unread one: capacityFor on an empty list answers
  // "No rower recorded in the register, so this capacity cannot be checked",
  // which is a confident statement about a register nobody managed to read.
  // The owner then goes and re-registers kit that was there all along.
  const [kitErr, setKitErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchEquipment(supabase, tenantId)
      .then((rows) => { if (live) { setKit(rows); setKitErr(null); } })
      .catch((e: any) => { if (live) { setKit(null); setKitErr(e?.message ?? 'The equipment register could not be read.'); } });
    fetchTrainerOptions(supabase, tenantId)
      .then((rows) => { if (live) { setTrainers(rows); setTrainersErr(null); } })
      .catch((e: any) => { if (live) { setTrainers(null); setTrainersErr(e?.message ?? 'Could not read your trainers.'); } });
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
      // The picked coach's own name wins over anything typed, so the label and
      // the join can never name two different people. `instructor` is only ever
      // free text where there is no id to attach.
      instructor: trainerId
        ? (trainers?.find((t) => t.id === trainerId)?.name ?? null)
        : (instructor.trim() || null),
      trainerId: trainerId || null,
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
        {/* The picker first, the free-text name second and disabled once a
            coach is chosen — the same either/or as the one-to-one form above,
            and for a stronger reason: a typed name is a label nothing can join
            on, and three screens plus one write policy read the id. */}
        <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)}
                style={{ ...field, minWidth: 150 }} aria-label="Which coach is teaching this class">
          <option value="">
            {trainersErr ? 'Coaches unread — name below' : trainers === null ? 'Reading coaches…' : 'Visiting — name below'}
          </option>
          {(trainers ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.name ?? 'Unnamed trainer'}</option>
          ))}
        </select>
        <input value={instructor} onChange={(e) => setInstructor(e.target.value)}
               disabled={!!trainerId}
               placeholder={trainerId ? 'On their record' : 'Instructor'}
               style={{ ...field, width: 130, opacity: trainerId ? 0.5 : 1 }} />
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
      {/* Said where the choice is made, not discovered a month later on
          /staff. A class with no coach attached is not a broken class — it is
          a class no per-coach figure can ever count. */}
      {trainersErr ? (
        <div style={{ padding: '0 14px 12px', fontSize: 12.5, color: '#f0c04e' }}>
          Your coaches could not be read, so this class can only carry a typed name: {trainersErr}.
          That is a failed query, not a gym with no coaches — a class saved now will not appear in
          anybody&rsquo;s class hours on Staff, and its own coach will not be able to edit it.
        </div>
      ) : !trainerId && trainers !== null && trainers.length > 0 ? (
        <div style={{ padding: '0 14px 12px', fontSize: 12.5, color: 'var(--ink3)' }}>
          No coach attached. The class still goes on the timetable, but a typed name is a label:
          it counts toward nobody&rsquo;s class hours on Staff, is bucketed separately from that
          coach&rsquo;s other classes on Classes, and leaves them unable to edit the class in their
          own app. Pick the coach unless the instructor genuinely has no Repple account.
        </div>
      ) : null}
      {kitErr && needs.trim() ? (
        <div style={{ padding: '0 14px 12px', fontSize: 12.5, color: '#f0c04e' }}>
          The equipment register could not be read, so this capacity is unchecked rather than
          checked and found fine: {kitErr}. Adding the class is still allowed — the check is a
          warning, not a gate.
        </div>
      ) : null}
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

/**
 * The register, and the queue behind it.
 *
 * ── Why the waiting list is here ─────────────────────────────────────────
 *
 * `book_class` and `cancel_class` implement a capacity-safe queue with
 * automatic FIFO promotion, and have done since part 02. Neither RPC is called
 * anywhere in `studio-web`, and `status === 'waitlist'` was rendered nowhere in
 * the console at all — so the gym could not see its own waiting list. Members
 * could: `web/client.html` sells the feature to them.
 *
 * Automatic promotion only fires when the MEMBER cancels from their own app,
 * because `cancel_class` deletes `where user_id = auth.uid()`. Every case the
 * desk handles — the member who rings up, the no-show at 06:05 whose bike is
 * free, the coach who says one more can squeeze in — had no path at all.
 */
function Roster({ gymClass, canEdit, onClose }: {
  gymClass: GymClass; canEdit: boolean; onClose: () => void;
}) {
  const [rows, setRows] = useState<RosterEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // A failed read used to land in `setRows([])`, and rows.length === 0 is the
  // branch that says "Nobody has booked this class" — to a desk about to turn
  // away people who did. Three states, not two: null with no readErr is still
  // reading, null with one is a read that failed, and only a list is a fact.
  const [readErr, setReadErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await fetchRoster(supabase, gymClass.id)); setReadErr(null); }
    catch (e: any) { setRows(null); setReadErr(e?.message ?? 'Could not read the roster.'); }
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

  const promote = async (r: RosterEntry) => {
    try {
      await promoteFromWaitlist(supabase, r.bookingId);
      setErr(null);
      load();
    } catch (e: any) {
      setErr(e?.message ?? 'That place was not given, so they are still waiting.');
    }
  };

  const demote = async (r: RosterEntry) => {
    try {
      await returnToWaitlist(supabase, r.bookingId);
      setErr(null);
      load();
    } catch (e: any) {
      setErr(e?.message ?? 'That booking was not moved back.');
    }
  };

  const split = rows ? splitRoster(rows) : null;
  // Computed off the roster in hand rather than off `gymClass.booked`, which is
  // whatever the board read a minute ago. A place that came free while this
  // dialog was open is a place the desk can give away now.
  const left = split ? placesLeft({ capacity: gymClass.capacity, booked: split.booked.length }) : null;

  const line = (r: RosterEntry, waiting: boolean) => (
    <li key={r.bookingId} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--ring)',
    }}>
      <span style={{ color: r.name ? 'var(--ink)' : 'var(--ink3)' }}>
        {r.name ?? 'Member'}
        {/* A waitlister who was let in and ticked present is a real person who
            really trained, and is counted separately from `attended` so a show
            rate cannot exceed its own denominator. Said here so the coach can
            see what they did. */}
        {waiting && r.attendedAt
          ? <span style={{ color: 'var(--warn)', marginLeft: 8, fontSize: 11.5 }}>let in and marked present</span>
          : null}
      </span>
      <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
        {waiting && canEdit ? (
          <button onClick={() => promote(r)} style={linkBtn}>
            {/* The words change with the fact, because they are different
                decisions: handing over a free place, and deliberately going
                over capacity. The database refuses neither — over-sell is a
                thing a coach is allowed to do and /classes reports it as real
                — so the button says which one is being taken. */}
            {left != null && left <= 0 ? 'Squeeze them in (over capacity)' : 'Give them the place'}
          </button>
        ) : null}
        {!waiting && canEdit && split && split.waiting.length > 0 ? (
          <button onClick={() => demote(r)} style={{ ...linkBtn, color: 'var(--ink3)' }}>Back to the list</button>
        ) : null}
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
      </span>
    </li>
  );

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
              {new Date(gymClass.startsAt).toLocaleString()}
              {/* Counted off the roster in hand, not off the board's snapshot.
                  Capacity of 0 is a class nobody sized, and "of 0" would read
                  as a class with no room in it. */}
              {split ? ` · ${split.booked.length} booked` : ''}
              {gymClass.capacity > 0 ? ` of ${gymClass.capacity}` : ' · capacity not set'}
              {split && split.waiting.length > 0 ? ` · ${split.waiting.length} waiting` : ''}
              {isCancelled(gymClass) ? ' · called off' : ''}
            </p>
          </div>
          <button onClick={onClose} style={ghostBtn}>Done</button>
        </div>

        {err ? <Banner tone="crit">{err}</Banner> : null}
        {isCancelled(gymClass) ? (
          <p style={{ margin: 0, padding: '11px 16px', borderBottom: '1px solid var(--ring)', fontSize: 12.5, color: 'var(--ink2)' }}>
            This class was called off{gymClass.cancelReason ? `: ${gymClass.cancelReason}` : ''}. Its
            bookings and its register are kept exactly as they were — the class is out of the fill
            and show rates rather than counted as a class nobody came to.
          </p>
        ) : null}

        {rows === null && readErr ? (
          <div style={{ padding: '26px 18px', color: 'var(--ink3)', fontSize: 13.5 }}>
            The roster could not be read, so this is not a class nobody booked — it is a class
            whose bookings did not arrive: {readErr}.{' '}
            <button onClick={load} style={{ ...linkBtn, color: 'var(--brand)' }}>Try again</button>
          </div>
        ) : rows === null || split === null ? <Loading /> : rows.length === 0 ? (
          <div style={{ padding: '26px 18px', color: 'var(--ink3)', fontSize: 13.5 }}>
            Nobody has booked this class. Members book from the Repple app; a walk-in can be added
            once member sign-up is wired to the desk.
          </div>
        ) : (
          <>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {split.booked.map((r) => line(r, false))}
            </ul>
            {split.waiting.length > 0 ? (
              <>
                <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--ring)', background: 'var(--surface2)' }}>
                  <h3 style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
                    Waiting — {split.waiting.length}
                  </h3>
                  <p style={{ margin: '3px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
                    {/* Three sentences for three states, because the desk acts
                        differently on each and "waiting" alone answers none of
                        them. */}
                    {left == null
                      ? 'This class records no capacity, so nothing here can say whether a place is free. Set one on the board and this line becomes an answer.'
                      : left > 0
                        ? `${left} ${left === 1 ? 'place is' : 'places are'} free right now — the app only promotes somebody when a member cancels from their own phone, so a place freed at the desk is given away here.`
                        : 'The class is full. Giving a place away from here puts it over capacity, which is a decision a coach is allowed to make and which /classes will report as a real over-sell.'}
                    {' '}They are not counted in the fill rate: a place the gym could not sell is not
                    a place it sold.
                  </p>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {split.waiting.map((r) => line(r, true))}
                </ul>
              </>
            ) : null}
          </>
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
