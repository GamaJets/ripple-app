// Coach · one client. How they are doing, and the ways into the rest of it.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// Everything a coach could do with one named person had ended up inside a modal
// sheet on the roster (app/(trainer)/dashboard.tsx), and the sheet had grown to
// around fifteen hundred lines carrying it. Five per-client screens were added
// in one day — their checklist, what they are working toward, the week they
// have planned, the photos they sent, the session you ran — and each of them
// added another row to that sheet. It had become the client detail view by
// accident, and a client detail view that is a bottom sheet is one a coach
// cannot deep-link to, cannot come back to, and cannot see the top and the
// bottom of at once.
//
// ── Why it is not a menu ───────────────────────────────────────────────────
//
// Replacing five rows in a sheet with the same five rows on a screen would have
// been a rearrangement, not a fix. A coach opening a client does not want a
// list of places to go; they want to know how that person is doing, and THEN
// where to go about it. So the screen answers three questions before it offers
// a destination:
//
//   · when was this person last seen at all — the hero, from `assessDrift`,
//     the same verdict and the same words the roster orders itself by;
//   · what is outstanding — unread messages, goals past their target date,
//     days they have marked that disagree with the programme;
//   · and only then, the five screens plus the thread and the builder, each
//     with a line underneath saying whether there is anything in there.
//
// ── Nothing here recomputes anything ───────────────────────────────────────
//
// Every figure and every sentence comes from a pure module that already owns
// it: src/lib/clientDrift.ts for the verdict, src/lib/clientGoals.ts and
// goalTargets.ts for the goals, src/lib/coachWeek.ts for the marked days,
// src/lib/photoInbox.ts for the inbox states, src/lib/adherence.ts for the
// ticks, and src/lib/clientBrief.ts for the wording of the summary lines. The
// five screens stay exactly as they are; this is the way in to them, and the
// summary that says which one to open.
//
// ── Where the dashes come from ─────────────────────────────────────────────
//
// Six independent reads feed this, and each carries its own LoadStatus, because
// they fail independently and mean different things when they do. A refused
// read is never rendered as an empty answer, and a truncated one is never
// counted — see src/lib/rowCap.ts and src/ui/loadStatus.ts. Where a figure
// cannot be supported it is an em-dash with a reason beside it, never a zero:
// a zero here is a specific claim about somebody's month.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Cta, Ghost, Notice, Flag, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useSettings } from '../../src/ui/settings';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
import {
  assessDrift, fetchClientActivity, isQueryableId, DEFAULT_WINDOWS, DRIFT_LABEL,
  type Drift,
} from '../../src/lib/clientDrift';
import { readGoals, goalBoard, type GoalRow } from '../../src/lib/clientGoals';
import { type GoalTarget } from '../../src/lib/goalTargets';
import { fetchClientPlannedDays } from '../../src/lib/plannedDays';
import { scheduledFocus } from '../../src/lib/checklist';
import { isoToday, type PlannedDay } from '../../src/lib/dayPlan';
import { coachWeek, planWindow, type ScheduledFocus } from '../../src/lib/coachWeek';
import { recentWindow, summariseAdherence, type ChecklistRow, type TickRow } from '../../src/lib/adherence';
import { fetchSharedInbox } from '../../src/lib/photoShare';
import { type Inbox } from '../../src/lib/photoInbox';
import { weightDeltaIn } from '../../src/lib/units';
import { bodyLine } from '../../src/lib/clientBody';
import {
  COACHED_MODES, COACHED_MODE_SHORT, COACHED_MODE_NOTE_COACH, type CoachedMode,
} from '../../src/lib/types';
import {
  lastSeenLine, goalsLine, weekLine, photosLine, listLine, programmeLine,
  attention, noAccountNote, unaskedNote,
} from '../../src/lib/clientBrief';

const GOAL_COLS = 'id, kind, target_value, title, target_date, achieved_at, created_at';
const ITEM_COLS = 'id, label, icon, active, created_at, updated_at';

/**
 * A selectable pill — the same one the Schedule and the roster sheet use, and
 * takes the theme as a prop for the same reason they do: the screen's hook
 * order is part of its contract.
 *
 * `busy` is not `disabled` under another name. The chip keeps its ink and keeps
 * its selected mark; it only stops taking a second tap while the first one is
 * still in the air. Two writes racing to one row leaves the client classified
 * as whichever answer came back last, which is not necessarily the one the
 * coach pressed last — and nothing on screen would say which had won.
 */
function Chip({ t, label, on, busy, onPress }: {
  t: Theme; label: string; on: boolean; busy: boolean; onPress: () => void;
}) {
  return (
    <Pressable onPress={busy ? undefined : onPress} accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: busy }}
      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2, opacity: busy && !on ? 0.5 : 1 }}>
      <Text style={{ ...ty.label, fontWeight: on ? '500' : '400', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
}

export default function ClientScreen() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  const ap = useAssignedPrograms();
  const { tenant } = useTenant();
  // The coach's own unit. Weight is stored in kilograms whatever it was typed
  // in (TF-37), so this changes what is printed and nothing else — but printing
  // kilograms to a coach who reads pounds is a wrong number, not a style.
  const wu = useSettings().weightUnit;

  // `name` rides along so the header can be right during the first render, when
  // the roster provider may still be reading. It is never used as an access
  // claim: every read below is filtered on the id and every policy behind them
  // is `is_my_client`.
  const params = useLocalSearchParams<{ clientId?: string; name?: string; checkedIn?: string }>();
  /** Arrived here from Check In on the calendar: the client is standing in
   *  front of the coach and the session is under way. The screen leads with
   *  logging rather than making them find it among nine other rows. */
  const justCheckedIn = params.checkedIn === '1';
  const id = typeof params.clientId === 'string' && params.clientId ? params.clientId : null;
  const client = useMemo(() => r.roster.find((c) => c.id === id) ?? null, [r.roster, id]);
  const fullName = client?.name ?? (typeof params.name === 'string' ? params.name : '') ?? '';
  const who = (fullName || 'They').split(' ')[0];

  // A client the coach typed in by hand has a `coach_clients` row and no user
  // account, so their id is not a uuid and Postgres refuses the whole statement
  // rather than skipping the value. Nothing server-backed is asked for them,
  // and the screen says why instead of showing six empty sections.
  const queryable = !!id && isQueryableId(id);
  const canRead = USE_SUPABASE && queryable && !!id;

  /* ── when were they last seen at all ────────────────────────────────────── */

  const [drift, setDrift] = useState<Drift | null>(null);
  const [driftFailed, setDriftFailed] = useState(false);
  const joinedAt = client?.joinedAt ?? null;
  useEffect(() => {
    if (!canRead || !id) return;
    let live = true;
    setDrift(null); setDriftFailed(false);
    (async () => {
      try {
        const events = await fetchClientActivity(supabase, [id], {
          days: DEFAULT_WINDOWS.historyDays,
          tenantId: tenant?.id ?? null,
        });
        if (!live) return;
        // `since` is when they joined the book. Without it a client added
        // yesterday and a client silent for eight weeks are the same shape of
        // nothing — see the note in clientDrift.ts.
        setDrift(assessDrift({ clientId: id, events: events[id] ?? [], since: joinedAt }));
      } catch (e) {
        reportError('client.drift', e);
        if (live) { setDrift(null); setDriftFailed(true); }
      }
    })();
    return () => { live = false; };
  }, [canRead, id, tenant?.id, joinedAt]);

  /* ── what they are working toward ───────────────────────────────────────── */

  // Only `goal_targets`. The scans and weigh-ins a percentage would need are
  // deliberately not read here: how far along a goal is belongs on
  // client-goals.tsx, which reads all three and holds the arithmetic. A summary
  // row that recomputed progress from a subset of the same rows is how two
  // screens come to show a client two different numbers for one goal.
  const [goals, setGoals] = useState<GoalTarget[] | null>(null);
  const [goalStatus, setGoalStatus] = useState<LoadStatus>('loading');
  useEffect(() => {
    if (!canRead || !id) return;
    let live = true;
    setGoals(null); setGoalStatus('loading');
    (async () => {
      const { data, error } = await supabase.from('goal_targets').select(GOAL_COLS)
        .eq('client_id', id).order('created_at', { ascending: false }).limit(capLimit());
      if (!live) return;
      if (error) {
        reportError('client.goals', error);
        setGoals(null); setGoalStatus('error'); return;
      }
      const page = capped((data ?? []) as unknown as GoalRow[]);
      setGoals(readGoals(page.rows).goals);
      setGoalStatus(page.truncated ? 'partial' : 'ready');
    })();
    return () => { live = false; };
  }, [canRead, id]);

  // 'error' is the only thing that may produce an unreadable board, and an
  // unreadable board is the only thing that may print as "could not be read".
  const board = useMemo(
    () => goalBoard(goalStatus === 'error' ? null : goals),
    [goalStatus, goals],
  );

  /* ── the week they have planned ─────────────────────────────────────────── */

  const [days, setDays] = useState<PlannedDay[] | null>(null);
  const [weekStatus, setWeekStatus] = useState<LoadStatus>('loading');
  // Fixed at the read rather than recomputed every render, so a screen left
  // open over midnight cannot re-sort itself under the coach's hands.
  const [todayISO, setTodayISO] = useState<string>(() => isoToday(new Date()));
  useEffect(() => {
    if (!canRead || !id) return;
    let live = true;
    setDays(null); setWeekStatus('loading');
    (async () => {
      const today = isoToday(new Date());
      const w = planWindow(today);
      if (!w) { if (live) setWeekStatus('error'); return; } // unreachable: isoToday always parses
      const read = await fetchClientPlannedDays(id, w.fromISO, w.toISO);
      if (!live) return;
      setTodayISO(today);
      setDays(read.days);
      setWeekStatus(read.days == null ? 'error' : read.truncated ? 'partial' : 'ready');
    })();
    return () => { live = false; };
  }, [canRead, id]);

  // The programme is the coach's own row and null covers three situations —
  // none assigned, the read failed, and one assigned by a different coach,
  // which `assigned_programs_coach_rw` will not show this one. `undefined`
  // through `planConflict` claims no conflict on an unknown.
  const programme = id ? ap.getProgram(id) : null;
  const focusOn = useCallback<ScheduledFocus>(
    (weekday) => (programme ? scheduledFocus(programme.days, weekday) : undefined),
    [programme],
  );
  const week = useMemo(
    () => coachWeek(weekStatus === 'error' ? null : days, todayISO, focusOn),
    [weekStatus, days, todayISO, focusOn],
  );

  /* ── their list, and the days they were in the app ──────────────────────── */

  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    if (!USE_SUPABASE) return;
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (live) setUid(data?.user?.id ?? null);
      } catch { if (live) setUid(null); }
    })();
    return () => { live = false; };
  }, []);

  const [items, setItems] = useState<ChecklistRow[] | null>(null);
  const [itemStatus, setItemStatus] = useState<LoadStatus>('loading');
  const [ticks, setTicks] = useState<{ rows: TickRow[]; windowDays: number; start: string; end: string } | null>(null);
  const [tickStatus, setTickStatus] = useState<LoadStatus>('loading');
  useEffect(() => {
    if (!canRead || !id || !uid) return;
    let live = true;
    setItems(null); setItemStatus('loading');
    setTicks(null); setTickStatus('loading');
    (async () => {
      const w = recentWindow();
      const [itemRes, tickRes] = await Promise.all([
        supabase.from('coach_checklist_items').select(ITEM_COLS)
          .eq('coach_id', uid).eq('client_id', id).limit(capLimit()),
        // Every habit, not only this coach's lines: a tick against the client's
        // OWN targets is the only evidence this screen has that they opened the
        // app on a given day, which is what separates a line they saw and
        // skipped from a line nobody was ever shown. See adherence.ts.
        supabase.from('habit_logs').select('habit, done_on')
          .eq('user_id', id).gte('done_on', w.start).lte('done_on', w.end).limit(capLimit()),
      ]);
      if (!live) return;
      if (itemRes.error) {
        reportError('client.checklistItems', itemRes.error);
        setItems(null); setItemStatus('error');
      } else {
        const page = capped((itemRes.data ?? []) as unknown as ChecklistRow[]);
        setItems(page.rows);
        setItemStatus(page.truncated ? 'partial' : 'ready');
      }
      if (tickRes.error) {
        reportError('client.ticks', tickRes.error);
        setTicks(null); setTickStatus('error');
      } else {
        const page = capped((tickRes.data ?? []) as unknown as TickRow[]);
        setTicks({ rows: page.rows, windowDays: w.days, start: w.start, end: w.end });
        setTickStatus(page.truncated ? 'partial' : 'ready');
      }
    })();
    return () => { live = false; };
  }, [canRead, id, uid]);

  /**
   * Days the client ticked ANYTHING, out of the window.
   *
   * `summariseAdherence` is handed an empty item list on purpose. `seenDays`
   * and `silentDays` are computed from the ticks alone — the items only supply
   * denominators for the per-line figures, which are this screen's business
   * only in so far as it counts them — so passing no items yields exactly the
   * same two numbers and nothing else is read off the result. It also means a
   * refused read of the coach's own lines cannot hide a fact about the client
   * that the ticks already established.
   */
  const seen = useMemo(() => {
    if (tickStatus !== 'ready' || !ticks) return null;
    const sum = summariseAdherence({
      window: { start: ticks.start, end: ticks.end, days: ticks.windowDays },
      ticks: ticks.rows,
      items: [],
    });
    return { seenDays: sum.seenDays, windowDays: ticks.windowDays };
  }, [tickStatus, ticks]);

  /** The coach's own lines that are still on the client's list. Null unless the
   *  read was whole: a count over a prefix is not a count. */
  const activeLines = useMemo(
    () => (itemStatus === 'ready' && items ? items.filter((it) => it.active).length : null),
    [itemStatus, items],
  );

  /* ── what they have sent ────────────────────────────────────────────────── */

  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [photosFailed, setPhotosFailed] = useState(false);
  useEffect(() => {
    if (!canRead || !id) return;
    let live = true;
    setInbox(null); setPhotosFailed(false);
    (async () => {
      try {
        const next = await fetchSharedInbox(id);
        // An answer about a client this screen has since been re-pointed at is
        // not an answer about the one on it.
        if (!live || next.clientId !== id) return;
        setInbox(next); setPhotosFailed(false);
      } catch (e) {
        reportError('client.sharedInbox', e);
        // Null, never an empty inbox. A refused read must not tell a coach
        // their client has sent them nothing.
        if (live) { setInbox(null); setPhotosFailed(true); }
      }
    })();
    return () => { live = false; };
  }, [canRead, id]);

  /* ── whether there is a body-composition trend to look at ───────────────── */

  // Two rows, deliberately, and not a capped read of the set. All this screen
  // has to say is whether there is anything worth opening — when they were last
  // scanned, and whether there is an earlier scan to measure it against — and
  // the screen that draws the trend reads the history properly with `capLimit()`
  // and owns every figure taken off it. Asking for a thousand rows to render one
  // sentence would be a worse answer to the same question, and a count computed
  // here would be a second place that could disagree with client-body.tsx about
  // how many scans somebody has.
  const [scanTop, setScanTop] = useState<{ newestISO: string | null; hasEarlier: boolean } | null>(null);
  const [scansFailed, setScansFailed] = useState(false);
  useEffect(() => {
    if (!canRead || !id) return;
    let live = true;
    setScanTop(null); setScansFailed(false);
    (async () => {
      // `taken_at` is a DATE and nothing stops two scans sharing one, so the id
      // settles the ties — otherwise which of them is "the newest" can change
      // between reads, and so can the date printed under this client's name.
      const { data, error } = await supabase.from('scans').select('taken_at')
        .eq('client_id', id)
        .order('taken_at', { ascending: false }).order('id', { ascending: false })
        .limit(2);
      if (!live) return;
      if (error) {
        // Null, never an empty answer. A refused read must not tell a coach
        // their client has never been scanned.
        reportError('client.scans', error);
        setScanTop(null); setScansFailed(true); return;
      }
      const rows = (data ?? []) as { taken_at: string }[];
      setScanTop({ newestISO: rows[0]?.taken_at ?? null, hasEarlier: rows.length > 1 });
    })();
    return () => { live = false; };
  }, [canRead, id]);

  /* ── how the coach delivers to this person ──────────────────────────────── */

  // Delivery could be set exactly once — in the Add Client sheet — and never
  // again. A client who started online and now comes in on Thursdays stayed
  // 'Online' forever, on the roster filter, in the owner's split, and on the
  // Book button at the top of this screen, which an online-only client has no
  // calendar behind. `setClientMode` has been sitting in roster.tsx unused.
  //
  // Two pieces of state rather than one, because "in the air" and "did not
  // reach the server" are different things to say and only one of them is a
  // warning.
  const [modeSaving, setModeSaving] = useState<CoachedMode | null>(null);
  const [modeUnsaved, setModeUnsaved] = useState<CoachedMode | null>(null);
  // Same reset every other read on this screen does when the route is pointed
  // at somebody else: a warning about one person's delivery must not survive
  // onto the next person's page.
  useEffect(() => { setModeSaving(null); setModeUnsaved(null); }, [id]);

  /**
   * Whether this screen is entitled to draw three buttons with one of them
   * lit. Under 'error' the roster is not the server's answer — an empty list
   * there means the read was refused, not that the book is empty — so a
   * `mode` taken off it is a value of unknown provenance, and lighting a chip
   * from it would assert how somebody is coached on the strength of a read
   * that failed. 'partial' is fine: the people listed are real, this client is
   * one of them, and their row came back whole.
   */
  const modeKnown = !!client && r.status !== 'error' && r.status !== 'loading';

  const pickMode = async (m: CoachedMode) => {
    if (!id || modeSaving) return;
    setModeSaving(m);
    setModeUnsaved(null);
    const stored = await r.setClientMode(id, m);
    setModeSaving(null);
    // `setClientMode` writes the coach's answer to this device BEFORE it tries
    // the server and keeps it there either way, so by the time `false` comes
    // back the chips already show `m` — and quietly flipping them back would
    // be its own lie, because the override is on disk and will be there at the
    // next launch. False does not mean lost; it means only this phone knows.
    // That is the sentence the coach needs, because the alternative is finding
    // the client Online in their own app a week later and having no idea when
    // the two devices stopped agreeing.
    setModeUnsaved(stored ? null : m);
  };

  /* ── the briefing ───────────────────────────────────────────────────────── */

  const nowMs = Date.now();
  const attn = attention({
    who,
    unread: client ? client.unread : null,
    goalStatus, board, weekStatus, week,
    driftFailed,
    nowMs,
  });
  const noAccount = noAccountNote(queryable, who);
  // Non-null when no read was issued at all. Every line below defers to it,
  // because the alternative is a screen full of "Reading their goals…" for a
  // read nobody started — a promise that something is on its way when nothing
  // is. It is not an error and it is not an empty answer; it is the third
  // thing, and it has to say so in each place a summary would have gone.
  // A missing id is its own reason and gets its own sentence: `unaskedNote`
  // would otherwise explain it as a client who has not joined, which is a
  // statement about a person nobody named.
  const unasked = !id
    ? 'No client was named in the link that opened this screen, so nothing was read.'
    : unaskedNote(USE_SUPABASE, queryable, who);
  const driftTone = !drift ? t.ink3
    : drift.status === 'at_risk' ? t.crit
    : drift.status === 'idle' ? t.s5
    : drift.status === 'watch' ? t.warn
    : t.brand;

  // Weight moves in kilograms on the wire and is read in whichever unit the
  // coach set. Converted as a SPAN rather than as two rounded ends — the reason
  // `weightDeltaIn` exists — and a dash where no second scan has ever been
  // taken, because "0 kg" claims they held their weight exactly.
  const deltaKg = client?.weightDelta ?? null;
  const delta = deltaKg == null ? null : weightDeltaIn(deltaKg, wu);

  const go = (pathname: string) => () => {
    if (!id) return;
    router.push({ pathname, params: { clientId: id, name: fullName } } as any);
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs, textTransform: 'capitalize' }} numberOfLines={1}>
              {fullName || 'Client'}
            </Text>
          </View>
        </View>

        {/* The row's own facts, which the roster already holds. `lastActive`
            and `next` are the roster's strings and are printed as they are. */}
        {client ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
            {client.goal} · {COACHED_MODE_SHORT[client.mode]} · last active {client.lastActive} · next {client.next}
          </Text>
        ) : null}

        {/* Three different reasons there is no client here, and they are not
            the same sentence. A refused roster read is not an empty book. */}
        {!id ? (
          <Section>
            <Notice tone={t.warn} kicker="No client" title="This screen was opened without a client"
              note="Go back to your clients and open somebody from the list." />
          </Section>
        ) : !client && r.status === 'error' ? (
          <Section>
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="Everything below is still read for this person directly. What is missing is the roster row — their goal, delivery, weight and unread count come from it." />
          </Section>
        ) : !client && r.status !== 'loading' ? (
          <Section>
            <Notice tone={t.warn} kicker="Not on your book" title={`${who} is not on your roster`}
              note="They may have been removed, or the coaching relationship may have ended. The reads below will come back empty because the policies behind them require a live coaching link." />
          </Section>
        ) : null}

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="Goals, planned days, ticks and photos belong to the client and live on the server, so there is no local copy of somebody else's to fall back on. Nothing below is a claim that they have none." />
          </Section>
        ) : noAccount ? (
          <Section>
            <Notice tone={t.s5} kicker="Added by hand" title={`${who} has no Repple account yet`} note={noAccount} />
          </Section>
        ) : null}

        {/* ── the two things a coach comes here to DO ─────────────────────────
            Both of these existed already and neither could be found: booking a
            client was only ever reachable from the calendar, which asks who it
            is for after the coach has already said, and their programme was the
            sixth row of a list below a hero and two sections — off the bottom of
            the screen on any phone. Reading about somebody is not the reason you
            open their page; these are. */}
        {id ? (
          <Section>
            <Cta label={`Book ${who} a Session`} wide onPress={go('/(trainer)/calendar')} />
            <View style={{ marginTop: sp.md }}>
              <ListRow icon="grid" title={programme ? 'Their Program' : `Build ${who} a Program`}
                note={programmeLine(ap.status, programme?.title ?? null, programme?.days.length ?? null, who)}
                tone={ap.status === 'error' ? t.warn : undefined}
                onPress={go('/(trainer)/builder')} />
            </View>
          </Section>
        ) : null}

        <Rule />

        {/* ── the hero: the one thing worth knowing first ─────────────────── */}
        <Hero
          label="Days Since Anything on Record"
          figure={fig(drift?.quietDays ?? null)}
          unit={drift?.quietDays != null ? (drift.quietDays === 1 ? 'day' : 'days') : undefined}
          note={unasked ?? lastSeenLine(drift, driftFailed, who)}
          tone={driftTone}
        />
        {!unasked && drift && drift.status !== 'on_track' ? (
          <Flag tone={driftTone}>
            {DRIFT_LABEL[drift.status]} — check-ins, logged workouts, completed sessions and gym visits, over the last {DEFAULT_WINDOWS.historyDays} days.
          </Flag>
        ) : null}

        <Rule />

        {/* ── what is outstanding ─────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Needs You" />
          {unasked ? (
            <Flag tone={t.ink3}>
              {unasked} Nothing is outstanding on this screen because nothing was asked for — which
              is not the same as there being nothing.
            </Flag>
          ) : null}
          {!unasked && attn.items.length === 0 && !attn.blind ? (
            <Text style={{ ...ty.body, color: t.ink2 }}>
              Nothing outstanding that this screen can see: no unread messages, no goal past its
              target date, and nothing marked ahead that argues with your programme.
            </Text>
          ) : null}
          {(unasked ? [] : attn.items).map((line, i) => (
            <View key={line} style={{ paddingVertical: sp.sm, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
              <Flag tone={t.warn}>{line}</Flag>
            </View>
          ))}
          {/* An empty list above cannot be allowed to read as an all-clear when
              a read that would have filled it never landed. */}
          {!unasked && attn.blind ? (
            <View style={{ marginTop: attn.items.length ? sp.md : 0 }}>
              <Flag tone={t.ink3}>{attn.blind}</Flag>
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* ── three figures, and a dash wherever the record cannot answer ─── */}
        <Section>
          <SectionHead title="Where They Are" />
          <KpiRow items={[
            {
              label: 'Weight Change',
              value: delta == null ? '—' : `${delta > 0 ? '+' : ''}${fig(delta)}`,
              unit: delta == null ? undefined : wu,
            },
            { label: 'In the App', value: fig(seen ? seen.seenDays : null), unit: seen ? `/ ${seen.windowDays} days` : undefined },
            { label: 'Unread', value: fig(client ? client.unread : null) },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {deltaKg == null
              ? `No second scan on record for ${who}, so there is no change to state — a dash rather than a nil movement nobody measured. `
              : `Across the scans on record. `}
            {unasked
              ? unasked
              : seen == null
              ? 'Their ticks could not be read, so the days they were in the app are unknown rather than none.'
              : `Days out of the last ${seen.windowDays} they ticked something — evidence they stood in front of their list, not a score.`}
          </Text>
        </Section>

        <Rule />

        {/* ── the ways in, each saying whether there is anything in there ─── */}
        <Section>
          <SectionHead title="Open" />

          <ListRow icon="target" title="What They're Working Toward"
            note={unasked ?? goalsLine(goalStatus, board, who, nowMs)}
            tone={goalStatus === 'error' ? t.warn : undefined}
            onPress={go('/(trainer)/client-goals')} />

          {/* Directly under the goals, because the scans on the other side of
              this row are what two of the three measured goal kinds are held
              against — and because "how is this person actually going" is the
              same question asked twice. */}
          <ListRow icon="chart" title="Their Body Composition"
            note={unasked ?? bodyLine(
              scansFailed,
              scanTop == null && !scansFailed,
              scanTop?.newestISO ?? null,
              scanTop?.hasEarlier ?? false,
              todayISO,
              who,
            )}
            tone={scansFailed ? t.warn : undefined}
            onPress={go('/(trainer)/client-body')} />

          <ListRow icon="calendar" title="The Week They've Planned"
            note={unasked ?? weekLine(weekStatus, week, who)}
            tone={weekStatus === 'error' ? t.warn : undefined}
            onPress={go('/(trainer)/client-week')} />

          {/* `checklists.tsx` starts on its own client picker and does not read
              `clientId` off the route — the row this replaced on the dashboard
              sheet pushed it without one for the same reason. So the summary
              below is about this client and the screen it opens still asks the
              coach to pick them. That belongs in checklists.tsx, which is not
              this change's to edit; the param is passed so it works the moment
              that screen starts reading it. */}
          <ListRow icon="check" title="Their Daily Checklist"
            note={unasked ?? listLine(itemStatus, activeLines, seen, who)}
            tone={worstStatus(itemStatus, tickStatus) === 'error' ? t.warn : undefined}
            onPress={go('/(trainer)/checklists')} />

          <ListRow icon="camera" title="Progress Photos They Sent You"
            note={unasked ?? photosLine(inbox, photosFailed, who)}
            tone={photosFailed ? t.warn : undefined}
            onPress={go('/(trainer)/client-photos')} />

          <ListRow icon="train" title={justCheckedIn ? `Log What ${who} Just Did` : 'Log a Session You Ran'}
            note={justCheckedIn
              ? `${who} is checked in. Enter the exercises as you go — it lands in their own record and shows up in their app.`
              : `Goes into ${who}'s own record, marked as logged by you.`}
            onPress={go('/(trainer)/log-session')} />

          <ListRow icon="chat" title={`Message ${who}`}
            note={client && client.unread != null && client.unread > 0
              ? `${client.unread} unread from them in your thread.`
              : 'Open your thread with them.'}
            onPress={go('/(trainer)/chat')} />
        </Section>

        <Rule />

        {/* ── the one thing here that is yours to change ────────────────────
            Small on purpose. It is one word about somebody, sitting where a
            coach looks when the arrangement has changed — not a decision the
            screen is about. The line underneath is the same sentence the Add
            Client and invite sheets show, because "Hybrid" on its own is a
            word rather than a choice anybody can make. */}
        {id ? (
          <Section>
            <SectionHead title="How You Coach Them" />
            {r.status === 'error' ? (
              <Flag tone={t.warn}>
                Your roster could not be read, and their delivery is a column on it. Three buttons
                with one of them already pressed would be a claim about how you coach {who} taken
                off a read that failed, so this says nothing instead. Try the Clients tab again,
                and it will be settable here once the roster comes back.
              </Flag>
            ) : !modeKnown ? (
              <Flag tone={t.ink3}>
                {r.status === 'loading'
                  ? `Reading your roster. How you coach ${who} is on it.`
                  : `${who} is not on your book, so there is no coaching arrangement here to classify.`}
              </Flag>
            ) : client ? (
              <>
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  {COACHED_MODES.map((m) => (
                    <Chip key={m} t={t} label={COACHED_MODE_SHORT[m]} on={client.mode === m}
                      busy={!!modeSaving} onPress={() => { void pickMode(m); }} />
                  ))}
                </View>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {COACHED_MODE_NOTE_COACH[client.mode]}
                </Text>
                {modeSaving ? (
                  <View style={{ marginTop: sp.md }}>
                    <Flag tone={t.ink3}>
                      Saving {COACHED_MODE_SHORT[modeSaving].toLowerCase()}…
                    </Flag>
                  </View>
                ) : modeUnsaved ? (
                  <View style={{ marginTop: sp.md }}>
                    <Flag tone={t.warn}>
                      Not saved. {COACHED_MODE_SHORT[modeUnsaved]} is on this phone only — the server
                      kept the delivery it already had, so {who}&rsquo;s own app and your other devices
                      are still on that one and this screen is the only place the two disagree. Tap
                      it again to retry.
                    </Flag>
                  </View>
                ) : null}
              </>
            ) : null}
          </Section>
        ) : null}

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Notes, feedback, tags and meal-plan targets are on the client sheet on your Clients
          screen. Everything else here is read-only: a goal, a planned day and a tick are the
          client&rsquo;s own, and none of them can be changed from here. How you coach somebody is
          yours rather than theirs, which is why it is the one thing above that you can set.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
