'use client';

// Door — who is in the building, who came in today, and the passes taken at
// the desk.
//
// This is the one console screen a trainer sees as well as an owner, because
// working the door is a staff job. It is a capture screen before it is a
// reporting one: until visits are recorded, attendance is only ever the subset
// of people who booked a class, and retention is inferred from a number that
// is missing most of its input.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchVisits, checkIn, checkOut, summariseVisits, dwellMinutes,
  sweepStaleVisits, wasSwept, currentlyInside,
  busiestSlots, visitsByHour, visitsByWeekday, averageDwellMinutes,
  WEEKDAYS,
  type Visit,
} from '@lib/gymVisits';
import { searchRows } from '@lib/consoleSearch';
import {
  fetchPasses, fetchPassTypes, issuePass, redeemPass,
  summarisePasses, passStatus, remainingUses,
  type GymPass, type PassType,
} from '@lib/gymPasses';
import { fetchMemberships, money, type Membership } from '@lib/gymRecord';
import { fetchClasses, type GymClass } from '@lib/gymSchedule';
import { isoDate } from '@lib/format';

const DAY = 86400000;

/**
 * How far either side of now a class is offered as the reason for a visit.
 *
 * `gym_visits.class_id` is what makes a class attendance and a floor visit
 * distinguishable in one table, and the desk is the only place that knows
 * which it is. The window is deliberately wide enough for the person who
 * arrives early to change and the one who stays behind to stretch, and narrow
 * enough that a busy timetable does not offer eleven classes: attaching a
 * visit to the WRONG class is worse than leaving it on the floor, because the
 * floor is at least true.
 */
const CLASS_WINDOW_MIN = 90;

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
  // The classes running around now, so a check-in can name the one it is
  // attendance at. Null on a refused read, like every other state here: an
  // empty picker that says "gym floor only" is a claim about the timetable.
  const [classes, setClasses] = useState<GymClass[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    // allSettled, not all: one failing read must not take the others with it.
    // Under Promise.all a refused gym_passes query also emptied the other three
    // — the visits table said "No visits logged today" on a morning that had
    // visits, and the check-in dropdown lost every member — so one broken query
    // produced three wrong facts and the banner named none of them.
    const now = Date.now();
    const [vRes, pRes, tRes, mRes, cRes] = await Promise.allSettled([
      fetchVisits(supabase, tenantId, { sinceIso: new Date(now - 30 * DAY).toISOString() }),
      fetchPasses(supabase, tenantId),
      fetchPassTypes(supabase, tenantId),
      fetchMemberships(supabase, tenantId),
      fetchClasses(
        supabase, tenantId,
        new Date(now - CLASS_WINDOW_MIN * 60_000).toISOString(),
        new Date(now + CLASS_WINDOW_MIN * 60_000).toISOString(),
      ),
    ]);

    // A read that failed is null, never []. [] is the gym saying it has none;
    // null is nobody knowing. Staff act differently on the two.
    setVisits(vRes.status === 'fulfilled' ? vRes.value : null);
    setPasses(pRes.status === 'fulfilled' ? pRes.value : null);
    setTypes(tRes.status === 'fulfilled' ? tRes.value : null);
    setMembers(mRes.status === 'fulfilled' ? mRes.value : null);
    setClasses(cRes.status === 'fulfilled' ? cRes.value : null);

    // Surfaced rather than swallowed: a door screen that silently fails to read
    // is worse than one that says so, because staff will keep using it. Each
    // failure is named, because "could not read" without saying which query
    // broke leaves the desk unable to tell the owner what is down.
    const trouble = [
      failure(vRes, 'the door log'),
      failure(pRes, 'the passes'),
      failure(tRes, 'the pass types'),
      failure(mRes, 'the member list'),
      failure(cRes, 'the classes running now'),
    ].filter((s): s is string => s !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setVisits([]); setPasses([]); setTypes([]); setMembers([]); setClasses([]); return; }
      // no-error-ok: the gym's name is a header label; without it the header is blank and every figure below is unaffected
      const { data: t } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) setGymName(t?.name ?? null);
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/door">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

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
  // `currentlyInside` rather than a hand-rolled filter, so the Door and every
  // other reader of the door log agree on what "inside" means. It had no caller
  // anywhere in the repository until now — the definition existed, was tested,
  // and every screen re-implemented it.
  const inside = currentlyInside(todays);
  const openBefore = (visits ?? []).filter((v) => !v.exitedAt && dayOf(v.enteredAt) !== today);
  // Of those, the ones a sweep has already accounted for. Two different things
  // for the desk: "nobody has looked at these" and "these are known to be
  // people who left without scanning out".
  const sweptBefore = openBefore.filter(wasSwept);

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
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
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
        members={members} passes={passes} classes={classes} tenantId={tenantId}
        membersUnread={unread(members)} classesUnread={unread(classes)}
        today={today} onChange={refresh}
      />
      <Inside
        inside={inside} openBefore={openBefore.length} swept={sweptBefore.length}
        unread={unread(visits)} tenantId={tenantId} isOwner={me.role === 'owner'}
        onChange={refresh}
      />
      <Today visits={todays} unread={unread(visits)} />
      {/* Thirty days rather than today, because "when is my gym busy" is not a
          question about today. The window is the same one `load()` reads, so
          nothing here needs a second query. */}
      <Occupancy visits={visits} unread={unread(visits)} days={30} />
      <Passes
        passes={passes} types={types} members={members} summary={pSum}
        passesUnread={unread(passes)} typesUnread={unread(types)}
        tenantId={tenantId} today={today} me={me} onChange={refresh}
      />
    </Shell>
  );
}

/* ── check-in ──────────────────────────────────────────────────────────────── */

function CheckInBar({ members, passes, classes, tenantId, membersUnread, classesUnread, today, onChange }: {
  members: Membership[] | null; passes: GymPass[] | null; classes: GymClass[] | null;
  tenantId: string;
  membersUnread: Unread; classesUnread: Unread; today: string; onChange: () => void;
}) {
  const [memberId, setMemberId] = useState('');
  /**
   * What paid for this visit, as one value the desk picks.
   *
   * `''` is the gym floor. `pass:<id>` and `class:<id>` are the two things
   * `gym_visits` has a column for and has never been given: 32-door-log.sql
   * added `pass_id` and `class_id` in the same breath as the comment "so the
   * two records reconcile instead of double counting the same person", and
   * this console wrote neither. The consequences were all silent — /members
   * printed "gym floor" against every console visit including the ones that
   * were plainly a booked class, a pass and its visit could not be reconciled
   * so the same person counted twice, and nothing could tell class attendance
   * from floor attendance in the one table built to hold both.
   *
   * One control rather than two, because they are alternatives: a visit is
   * paid for by a pass or it is attendance at a class. A pass taken AT a class
   * is redeemed from the Passes table below, which writes both.
   */
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /* The live passes held by the person selected. Keyed on `holderId`, which is
   * the whole reason A1 had to be fixed first: a pass issued with only a
   * `holderName` belongs to nobody and can never appear here. */
  const theirPasses = (passes ?? []).filter(
    (p) => !!memberId && p.holderId === memberId && passStatus(p, today) === 'live',
  );
  // Soonest first, so the class about to start is the first thing in the list
  // rather than the one that finished an hour ago.
  const nearby = [...(classes ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  // A pass belongs to its holder, so changing who is at the desk must not leave
  // somebody else's pass selected. Silently keeping it would take a visit off
  // the wrong person's pass — a real entitlement, spent on somebody else.
  const pickMember = (id: string) => {
    setMemberId(id);
    if (reason.startsWith('pass:')) setReason('');
  };

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const passId = reason.startsWith('pass:') ? reason.slice(5) : null;
    const classId = reason.startsWith('class:') ? reason.slice(6) : null;
    try {
      // An empty selection is a deliberate anonymous head-count, not an error.
      await checkIn(supabase, tenantId, {
        memberId: memberId || null,
        passId,
        classId,
        source: 'desk',
      });
      setMemberId(''); setReason('');
      setMsg(memberId ? 'Checked in.' : 'Anonymous visit recorded.');
      onChange();
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not record that check-in.');
    } finally { setBusy(false); }
  };

  return (
    <Section title="Check someone in" sub="Leave the member blank to record a visit you cannot attribute — it still counts toward the day. Say what the visit was for and it reconciles against the class or the pass instead of counting twice.">
      <form onSubmit={go} style={formRow}>
        <MemberPicker
          members={members} value={memberId} onPick={pickMember}
          unread={membersUnread}
        />
        <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...field, flex: 2 }}
                aria-label="What this visit was for">
          <option value="">Gym floor</option>
          {theirPasses.map((p) => (
            <option key={p.id} value={`pass:${p.id}`}>
              On their {p.passTypeName ?? 'pass'} — {remainingUses(p)} left
            </option>
          ))}
          {nearby.map((c) => (
            <option key={c.id} value={`class:${c.id}`}>
              {c.title} · {new Date(c.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} style={{ ...btn, flex: 'none' }}>
          {busy ? 'Recording…' : 'Check in'}
        </button>
      </form>
      {/* Same distinction as the member list beside it. An unread timetable
          offers no classes, and a desk reading that as "no class is on" files
          a room full of people under gym floor for the rest of the morning. */}
      {classesUnread ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          {classesUnread === 'loading'
            ? 'Still reading the timetable — a visit checked in now is recorded on the gym floor.'
            : 'The timetable did not come back, so no class can be named against a visit. The banner above says why — this is not a morning with no classes on.'}
        </p>
      ) : null}
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

/* ── finding a member at the desk ──────────────────────────────────────────── */

/** How many matches the picker shows before it asks for more typing. Enough to
 *  cover a family with one surname; short enough that the desk is never
 *  scrolling a list while somebody stands in front of them. */
const PICKER_ROWS = 8;

/**
 * Find the person standing at the desk.
 *
 * ── What this replaces, and why a `<select>` was not merely inelegant ──────
 *
 * This was `<select>` over `members.filter(m => m.status === 'active')`, and it
 * failed in two ways that both land on the same person:
 *
 *  · at 300 members a native select is a scroll list with no search — some
 *    browsers offer type-ahead on the first characters of the label and none of
 *    them find "Okafor" from "oka" if the label starts with "Sara". The desk
 *    gives up and checks a member in as a walk-in, and the visit never reaches
 *    that member's record;
 *  · FROZEN AND LAPSED MEMBERS WERE NOT IN THE LIST AT ALL. The one member you
 *    most want a row about — the one whose membership just ran out, who is
 *    standing at the desk about to renew or about to leave — was the one the
 *    desk could only record anonymously. That is the exact person /retention
 *    and /passes exist to find, missing from the log at the moment they are
 *    most visible.
 *
 * So every membership is searchable and the status is shown beside the name.
 * Anonymous stays available and stays the default: an unattributable head-count
 * is a real answer and it still counts toward the day.
 */
function MemberPicker({ members, value, onPick, unread }: {
  members: Membership[] | null;
  value: string;
  onPick: (id: string) => void;
  unread: Unread;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  // One entry per PERSON, not per membership row. Somebody who froze a
  // membership and opened another is one human being at the desk, and two
  // identical names in a picker is how the wrong one gets clicked. The live
  // membership wins the status label, because that is what the desk is being
  // asked about.
  const people = useMemo(() => {
    const byPerson = new Map<string, { id: string; name: string; status: string; plan: string | null }>();
    for (const m of members ?? []) {
      const seen = byPerson.get(m.memberId);
      const rank = (s: string) => (s === 'active' ? 3 : s === 'frozen' ? 2 : 1);
      if (!seen || rank(m.status) > rank(seen.status)) {
        byPerson.set(m.memberId, {
          id: m.memberId,
          name: m.memberName ?? m.memberId,
          status: m.status,
          plan: m.planName ?? null,
        });
      }
    }
    return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [members]);

  const hits = useMemo(
    // Searchable on the plan too, because "who is on Gold" is a question the
    // desk asks out loud, and on the id because that is what a barcode scanner
    // types into a text field.
    () => searchRows(people, q, (p) => [p.name, p.plan, p.status, p.id]),
    [people, q],
  );

  const chosen = value ? people.find((p) => p.id === value) ?? null : null;

  // Chosen: the name, and a way back. Nothing is more confusing at a desk than
  // a search box that still says "sara" after Sara has been selected.
  if (chosen) {
    return (
      <span style={{ ...field, flex: 2, display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {chosen.name}
          {chosen.status !== 'active'
            ? <span style={{ color: 'var(--warn)', marginLeft: 7, fontSize: 11.5 }}>{chosen.status}</span>
            : null}
        </span>
        <button type="button" style={linkBtn} onClick={() => { onPick(''); setQ(''); }}>change</button>
      </span>
    );
  }

  return (
    <span style={{ flex: 2, minWidth: 180, position: 'relative' }}>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // Closed on a delay rather than immediately: a click on one of the
        // buttons below blurs this input first, and closing on blur would
        // unmount the button before its own click handler ran.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={unread === 'failed' ? 'Member list unread — check in anonymously' : 'Search a member, or leave blank for a walk-in'}
        aria-label="Search for the member at the desk"
        style={{ ...field, width: '100%' }}
      />
      {open && q.trim() ? (
        <span
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
            background: 'var(--surface)', border: '1px solid var(--ring)', borderTop: 'none',
            display: 'block', maxHeight: 260, overflowY: 'auto',
          }}
        >
          {hits.slice(0, PICKER_ROWS).map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(p.id); setQ(''); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: 'transparent', color: 'var(--ink2)', fontFamily: 'var(--sans)',
                fontSize: 13, padding: '7px 11px', border: 'none',
                borderBottom: '1px solid var(--ring2)',
              }}
            >
              {p.name}
              {/* The status is the whole reason a lapsed member is in this list.
                  Said in colour as well as words, because the desk is reading
                  it in two seconds with somebody waiting. */}
              {p.status !== 'active' ? (
                <span style={{ color: 'var(--warn)', marginLeft: 8, fontSize: 11.5 }}>{p.status}</span>
              ) : null}
              {p.plan ? <span style={{ color: 'var(--ink3)', marginLeft: 8, fontSize: 11.5 }}>{p.plan}</span> : null}
            </button>
          ))}
          {hits.length > PICKER_ROWS ? (
            <span style={{ display: 'block', padding: '7px 11px', color: 'var(--ink3)', fontSize: 11.5 }}>
              {hits.length - PICKER_ROWS} more match — keep typing.
            </span>
          ) : null}
          {hits.length === 0 ? (
            <span style={{ display: 'block', padding: '9px 11px', color: 'var(--ink3)', fontSize: 12 }}>
              {/* Three different sentences for three different facts, the same
                  distinction the rest of this screen makes. An empty result
                  under a failed read must never read as "we have no members". */}
              {members === null
                ? (unread === 'failed'
                  ? 'The member list did not come back, so nobody can be found here. This is not a gym with no members.'
                  : 'Still reading the member list…')
                : `Nobody on the roster matches that. ${people.length} ${people.length === 1 ? 'person is' : 'people are'} searchable — frozen and cancelled included.`}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/* ── who is inside ─────────────────────────────────────────────────────────── */

function Inside({ inside, openBefore, swept, unread, tenantId, isOwner, onChange }: {
  inside: Visit[]; openBefore: number; swept: number; unread: Unread;
  tenantId: string; isOwner: boolean; onChange: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

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
  /**
   * Mark the visits nobody closed.
   *
   * ── Why there is a button here at all ────────────────────────────────────
   *
   * `sweepStaleVisits` had no caller anywhere in the repository, and the
   * sentence under this heading used to say a stale visit "is swept with a
   * note" — a promise about a job that did not exist. Two ways to make that
   * true: run it on a schedule, and let the person looking at the pile run it.
   * Both are here. The scheduled half is
   * `supabase/functions/sweep-stale-visits`, which is written and NOT deployed;
   * this button works today, with the owner's own session, because
   * `gym_visits_staff_u` already permits it.
   *
   * Owner-only, matching that policy's intent rather than its letter — the
   * policy admits trainers too, and a trainer sweeping the gym's whole backlog
   * of open visits is a housekeeping decision rather than a desk one.
   */
  const sweep = async () => {
    setSweeping(true); setMsg(null);
    try {
      const n = await sweepStaleVisits(supabase, tenantId);
      // Zero is a real answer and gets its own sentence: pressing the button
      // twice must not report the same rows twice, and it does not — the sweep
      // skips what it has already marked.
      setMsg(n === 0
        ? 'Nothing left to sweep — every visit still open has already been accounted for.'
        : `${n} ${n === 1 ? 'visit' : 'visits'} marked as left without scanning out. They stay open on purpose: no exit time is invented, so none of them enters the average stay.`);
      onChange();
    } catch (e: any) {
      setMsg(e?.message ?? 'Those visits could not be swept, so nothing has changed.');
    } finally { setSweeping(false); }
  };

  return (
    <Section title="Inside now" sub="Anyone who came in today and has not been checked out. A visit left open overnight is marked with a note and never a guessed exit time — an invented exit would put a twenty-hour stay into the average.">
      {msg ? <p style={{ margin: '14px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
      {openBefore > 0 ? (
        <p style={{ margin: '14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          {openBefore === 1 ? '1 visit is' : `${openBefore} visits are`} still open from an earlier
          day — check-ins nobody closed, not people standing in the gym, so they are said here and
          counted nowhere. There is no Check out on them on purpose: closing one now would stamp
          this minute as the exit and put a twenty-hour stay into the average.
          {swept > 0 ? ` ${swept} of them ${swept === 1 ? 'has' : 'have'} already been marked.` : ''}
          {isOwner && openBefore > swept ? (
            <>
              {' '}
              <button type="button" style={linkBtn} disabled={sweeping} onClick={sweep}>
                {sweeping ? 'Marking…' : `Mark the other ${openBefore - swept} as left without scanning out`}
              </button>
            </>
          ) : null}
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

/* ── when is the gym busy ──────────────────────────────────────────────────── */

/**
 * The building's own shape: which hours are busy, which days, and how long
 * people stay.
 *
 * ── Why this is here and was not anywhere ────────────────────────────────
 *
 * `visitsByHour`, `peakHour`, `averageDwellMinutes` and `currentlyInside` have
 * all been written, commented and tested since the door log was built, and
 * `src/lib/coverage.test.ts` was their only caller. The logic existed; no screen
 * rendered it. "When is my gym busy" is the single most actionable staffing
 * question an owner has, and the console could not answer it.
 *
 * ── Why the week and the day are shown separately ────────────────────────
 *
 * Because collapsing them produces a wrong rota. `visitsByHour` flattens every
 * day together, so a gym whose Saturday mornings are heaving and whose Tuesday
 * mornings are empty reads as "busy at 09:00" — and somebody gets rostered on a
 * Tuesday. `busiestSlots` keeps the weekday, which is the unit a rota is
 * actually written in, and carries how many calendar days each slot is averaged
 * over so a 30-day window's five Mondays and four Fridays are not compared as
 * though they were the same sample.
 */
function Occupancy({ visits, unread, days }: {
  visits: Visit[] | null; unread: Unread; days: number;
}) {
  const hours = useMemo(() => (visits ? visitsByHour(visits) : null), [visits]);
  const week = useMemo(() => (visits ? visitsByWeekday(visits) : null), [visits]);
  const slots = useMemo(() => (visits ? busiestSlots(visits, 5) : null), [visits]);
  const dwell = useMemo(() => (visits ? averageDwellMinutes(visits) : null), [visits]);

  if (unread) {
    return (
      <Section title="When the gym is busy" sub={`Every arrival in the last ${days} days.`}>
        <Unresolved state={unread} what="the door log" />
      </Section>
    );
  }
  if (!visits || !hours || !week || !slots) return null;

  if (visits.length === 0) {
    return (
      <Section title="When the gym is busy" sub={`Every arrival in the last ${days} days.`}>
        <p style={{ padding: '22px 14px', margin: 0, color: 'var(--ink3)', fontSize: 13 }}>
          Nothing has been recorded at the door in {days} days, so there is no shape to show. That
          is a desk that is not checking people in rather than a gym nobody visits — every figure on
          this page, and the retention reading on Members, is built on these rows.
        </p>
      </Section>
    );
  }

  // The tallest bar sets the scale. Floored at 1 so a single visit does not
  // divide by zero, and taken over the hours actually present rather than a
  // fixed maximum — the shape is what matters, not the absolute height.
  const busiestHour = Math.max(1, ...hours.map((h) => h.visits));
  const busiestDay = Math.max(1, ...week.map((d) => d.visits));

  return (
    <Section
      title="When the gym is busy"
      sub={`Every arrival in the last ${days} days, by hour and by day. A quiet hour is drawn as a quiet hour rather than left out.`}
    >
      <div style={{ padding: '14px 14px 4px' }}>
        <div className="micro" style={{ marginBottom: 7 }}>By hour of the day</div>
        <div style={{ display: 'grid', gap: 3, gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
          {hours.map((h) => (
            <div key={h.hour} title={`${String(h.hour).padStart(2, '0')}:00 — ${h.visits} in`}
                 style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
              <span style={{
                display: 'block', width: '100%',
                height: 4 + Math.round((h.visits / busiestHour) * 34),
                background: h.visits === 0 ? 'var(--ring)' : 'var(--brand)',
                opacity: h.visits === 0 ? 0.5 : 1,
              }} />
              <span className="mono" style={{ fontSize: 8.5, color: 'var(--ink3)' }}>
                {String(h.hour).padStart(2, '0')}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px' }}>
        <div className="micro" style={{ marginBottom: 7 }}>By day of the week</div>
        <div style={{ display: 'grid', gap: 3, gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {week.map((d) => (
            <div key={d.day} title={`${d.day} — ${d.visits} in`} style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
              <span style={{
                display: 'block', width: '100%',
                height: 4 + Math.round((d.visits / busiestDay) * 34),
                background: d.visits === 0 ? 'var(--ring)' : 'var(--brand)',
                opacity: d.visits === 0 ? 0.5 : 1,
              }} />
              <span className="mono" style={{ fontSize: 9, color: 'var(--ink3)' }}>{d.day}</span>
              <span className="mono" style={{ fontSize: 10, color: d.visits === 0 ? 'var(--ink3)' : 'var(--ink2)' }}>
                {d.visits === 0 ? '—' : d.visits}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 14px 14px' }}>
        <div className="micro" style={{ marginBottom: 7 }}>Busiest slots</div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 5 }}>
          {slots.map((s) => (
            <li key={`${s.weekday}:${s.hour}`} style={{
              display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap',
              fontSize: 12.5, color: 'var(--ink2)',
              border: '1px solid var(--ring)', background: 'var(--surface2)', padding: '6px 10px',
            }}>
              <span className="mono" style={{ color: 'var(--ink)' }}>
                {WEEKDAYS[s.weekday]} {String(s.hour).padStart(2, '0')}:00
              </span>
              <span>{s.visits} in</span>
              {/* The average is the number to staff against, and it needs its
                  denominator said out loud: 30 days holds five Mondays and four
                  Fridays, so a total alone makes Monday look busier than it is. */}
              <span style={{ color: 'var(--ink3)' }}>
                {s.days === 1 ? 'on one day' : `across ${s.days} of them — about ${Math.round((s.visits / s.days) * 10) / 10} each time`}
              </span>
            </li>
          ))}
        </ul>
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--ink3)' }}>
          {/* Two figures, never one. A dwell average computed over the visits
              that recorded an exit is honest only if it says how many that was
              — half of them being open makes the average a sample, not a fact. */}
          {dwell && dwell.minutes != null
            ? `Average stay ${dwell.minutes} min, measured from the ${dwell.closed} of ${dwell.total} visits that recorded an exit.`
            : `No visit in this window recorded an exit, so there is no average stay — that is a door with no way out recorded, not a gym nobody stays in.`}
        </p>
      </div>
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
  /**
   * The account the pass belongs to, when the person at the desk has one.
   *
   * `gym_passes.holder_id` has existed since 31-drop-ins-and-passes.sql and
   * `IssuePass.holderId` since the library was written; this form passed only
   * `holderName`, so EVERY pass this console has ever sold is anonymous. That
   * is not a cosmetic gap. /passes measures whether pass holders go on to join
   * — the console's headline retention number — and it excludes anonymous
   * passes from the denominator on purpose, because a walk-in name cannot be
   * matched to a member without guessing at spellings. A price book of
   * name-only passes therefore leaves that metric structurally empty: not low,
   * not falling, empty, for a gym doing the exact thing the metric measures.
   *
   * The constraint takes either (`holder_id is not null or holder_name`), and
   * `issuePass` nulls the name when an id is given so the two can never
   * disagree about who holds it.
   */
  const [holderId, setHolderId] = useState('');
  const [holderName, setHolderName] = useState('');
  const [hostId, setHostId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sell = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = (types ?? []).find((x) => x.id === typeId);
    if (!t) { setMsg('Pick a pass.'); return; }
    if (!holderId && !holderName.trim()) {
      setMsg('Say who the pass is for — pick the member, or type the name at the desk for somebody with no account.');
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await issuePass(supabase, tenantId, {
        passType: t,
        holderId: holderId || null,
        holderName: holderName.trim() || null,
        hostMemberId: t.kind === 'guest' ? (hostId || null) : null,
        issuedOn: today,
      });
      const who = activeMembers.find((m) => m.memberId === holderId)?.memberName;
      setHolderId(''); setHolderName(''); setHostId('');
      setMsg(holderId
        ? `Pass issued to ${who ?? 'that member'} — it is on their record, so what they do next counts.`
        : 'Pass issued to a name at the desk. It counts toward pass revenue, but nothing can tell whether this person later joined.');
      onChange();
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not issue that pass.');
    } finally { setBusy(false); }
  };

  const take = async (p: GymPass) => {
    setMsg(null);
    try {
      // Two rows, deliberately, and `redeemPass` writes both — see the note on
      // it in src/lib/gymPasses.ts. Taking a visit off a pass used to write the
      // redemption alone, so somebody who paid at the desk and walked into the
      // gym left NO trace in the door log: they are not in "Visits today", not
      // in "Inside now", not in the busiest-hour count, and not in any
      // attendance or retention figure built on gym_visits. The pass ledger
      // knew and the door did not.
      await redeemPass(supabase, p, { tenantId, redeemedBy: me.id ?? null, today });
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
      // money() is null when the ROW states no currency, which is a second
      // silence and gets its own words — an amount with no currency is not an
      // amount, and printing the bare number invites the reader to supply one.
      render: (p) => p.paidCents == null ? <span className="dash">not recorded</span>
        : money(p.paidCents, p.currency) ?? <span className="dash">no currency on this pass</span> },
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
                {t.name}{money(t.priceCents, t.currency) ? ` — ${money(t.priceCents, t.currency)}` : ''}{t.uses > 1 ? ` (${t.uses} visits)` : ''}
              </option>
            ))}
          </select>
          {/* The member picker comes FIRST, and the free-text name is the
              fallback beside it rather than the only field. A desk offered one
              box marked "Name at the desk" types a name every time, including
              for the member standing there holding an account — which is how a
              gym ends up unable to answer whether any pass it ever sold turned
              into a membership. */}
          {/* The same searchable picker as the check-in bar, and for the same
              reason plus one: a pass is most often sold to somebody whose
              membership has just lapsed, and the `<select>` that stood here
              listed active memberships only — so the one person a day pass is
              for was the one person it could not be attributed to. */}
          <MemberPicker
            members={members} value={holderId}
            onPick={(id) => { setHolderId(id); if (id) setHolderName(''); }}
            unread={members === null ? 'failed' : null}
          />
          {/* Disabled rather than hidden once a member is picked: the two are a
              real either/or — `issuePass` nulls the name when it is given an id
              — and a control that vanishes reads as one that was never there. */}
          <input
            value={holderName} onChange={(e) => setHolderName(e.target.value)}
            disabled={!!holderId}
            placeholder={holderId ? 'On their account' : 'Name at the desk'}
            style={{ ...field, flex: 2, opacity: holderId ? 0.5 : 1 }}
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
      {/* An empty member picker reads as a gym whose passes can only ever be
          anonymous, and a desk that believes that stops looking for the name. */}
      {types !== null && types.length > 0 && members === null ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          The member list did not come back, so a pass sold now can only carry a name at the desk —
          and a pass with no account behind it is left out of the conversion figure on Passes. The
          banner above says why; sell it on the member&rsquo;s record once the page reloads.
        </p>
      ) : null}
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
  padding: '9px 11px', borderRadius: 0, fontSize: 13.5,
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
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
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
      margin: '14px 0', padding: '11px 14px', borderRadius: 0, background: 'var(--surface)',
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
