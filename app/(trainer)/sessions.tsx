// Trainer · Mark what happened. The queue of past sessions whose outcome
// nobody has recorded yet.
//
// This screen exists because of a coupling that is easy to miss: payroll is
// deliberately unanswerable while any session sits unmarked. payrollTotal()
// returns null rather than guessing, which is right — but it means the gym
// cannot pay anybody until this queue is empty, so marking has to be faster
// than opening each session in turn. Everything here is one tap.
//
// Four outcomes, not two. "Cancelled" and "late cancelled" are different
// commercially — one is usually paid and the other usually is not, per the
// gym's PayPolicy — and "no show" is different again from both. Collapsing
// them into done/not-done would quietly decide a payroll question that belongs
// to the gym, not to this screen.
//
// An empty queue is the good state and says so, rather than rendering a blank
// stretch of screen that looks like a loading failure.
//
// ── It is the coach's queue, not the gym's ─────────────────────────────────
//
// This screen read the queue by `tenant_id` and opened with
// `if (!tenant?.id) return;`. A coach who works for himself has no gym and
// therefore no tenant, so that line returned before anything was read — and
// because the unread state IS null, the screen sat on "Loading…" indefinitely
// with no error and no retry. He could not mark a single session.
//
// The rows are now read by `trainer_id`, which is what `sessions_trainer` in
// supabase/parts/09-sessions-access.sql has always scoped them by. A gym
// trainer sees exactly what they saw before; an independent one can finally
// work. See src/lib/trainerSessions.ts for why that is the right key rather
// than a convenient one.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, fig, Flag, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { useTenant } from '../../src/ui/tenant';
import { useAuth } from '../../src/ui/auth';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { minorFromWhole } from '../../src/lib/coachMoney';
import { tapLight } from '../../src/ui/haptics';
import { type PtSession, type SessionOutcome } from '../../src/lib/gymSessions';
import {
  MARK_WINDOW_DAYS, awaitingOutcome, clearMyOutcome, fetchMySessions, windowStart,
} from '../../src/lib/trainerSessions';
import { useFloorQueue } from '../../src/ui/floorQueue';
import { floorPendingNote, flushResultLine, keptOfflineLine } from '../../src/lib/floorQueue';
// The record, as opposed to the queue. See "What Already Happened" below.
import {
  pastSessions, pastVerdict, PAST_STATE_LABEL, PAST_STATE_NOTE, type PastState,
} from '../../src/lib/sessionHistory';
import { appLocale } from '../../src/lib/locale';

/** The four outcomes, in the order a person would consider them. */
const OUTCOMES: { id: SessionOutcome; label: string; short: string; tone: (t: Theme) => string }[] = [
  { id: 'completed',      label: 'Went Ahead',    short: 'Done',        tone: (t) => t.brand },
  { id: 'no_show',        label: 'Did Not Turn Up', short: 'No show',   tone: (t) => t.crit },
  { id: 'late_cancelled', label: 'Cancelled Late', short: 'Late cxl',   tone: (t) => t.s3 },
  { id: 'cancelled',      label: 'Cancelled in Time', short: 'Cxl',     tone: (t) => t.ink3 },
];

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

/** The mark beside a past session. A 6pt dot; the words stay in ink beside it,
 *  because `crit`/`warn`/`good` are marks in this app and never text colour. */
const stateTone = (t: Theme, s: PastState): string => {
  switch (s) {
    case 'delivered': return t.brand;
    case 'missed': return t.crit;
    case 'late_cancelled': return t.s3;
    case 'cancelled': return t.ink3;
    case 'unmarked': return t.warn;
  }
};

/** A bare day, through `appLocale()` — a hardcoded tag is what `check:locale`
 *  refuses, and this string names the edge of what has been read. */
const dayOnly = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Group by calendar day so a trainer can clear a whole day at once. */
function byDay(sessions: PtSession[]): { day: string; label: string; rows: PtSession[] }[] {
  const m = new Map<string, PtSession[]>();
  for (const s of sessions) {
    const day = s.startsAt.slice(0, 10);
    const list = m.get(day);
    if (list) list.push(s); else m.set(day, [s]);
  }
  return [...m.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))   // most recent day first
    .map(([day, rows]) => ({
      day,
      label: new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, {
        weekday: 'long', day: 'numeric', month: 'long',
      }),
      rows: rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }));
}

export default function TrainerSessions() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useTenant();
  // ── who these sessions belong to ──────────────────────────────────────────
  //
  // The coach, by `trainer_id` — NOT the gym, by `tenant_id`.
  //
  // This screen opened with `if (!tenant?.id) return;`, and a coach with no gym
  // has no tenant, so `load` returned before doing anything at all. `queue`
  // stays null, and null is this screen's "not read yet" state — so it sat on
  // "Loading…" for ever, with no error, no retry and nothing to say why. An
  // independent trainer could not mark a single session outcome, which is the
  // one thing this screen exists to do.
  //
  // `sessions_trainer` in supabase/parts/09-sessions-access.sql has always
  // scoped these rows by the trainer who owns the slot; the tenant filter was
  // an extra narrowing the coach app had no reason to apply to its own
  // sessions. See src/lib/trainerSessions.ts.
  const { user, loading: authLoading } = useAuth();
  const uid = user?.id ?? null;
  // Named `floor` rather than `queue`: this screen already calls its list of
  // unmarked sessions `queue`, and two things called that on one screen is how
  // somebody later flushes the wrong one.
  const floor = useFloorQueue(uid);
  // The rate to snapshot when an outcome is recorded. A gym's fee where there
  // is a gym, and otherwise the coach's own — an independent trainer's sessions
  // are priced by the rate on their profile, and there is nowhere else for that
  // figure to come from. Null stays null: the queue's sender then leaves
  // rate_cents untouched rather than writing a zero that reads as "this was
  // free" — `undefined` and null are different instructions and src/ui/floorQueue.ts
  // carries that distinction through unflattened.
  const { sessionFee: ownFee } = useMyTrainerProfile();
  const feeToSnapshot = tenant?.sessionFee ?? ownFee;

  // Whether there is a gym behind these sessions, which decides only what the
  // screen CALLS the thing it is asking for. A gym trainer is holding up a
  // payroll run; an independent coach is holding up their own record of what
  // they delivered. The work is identical, and telling a self-employed trainer
  // that "payroll can be settled" names a process he does not have.
  const hasGym = !!tenant?.id;

  const [queue, setQueue] = useState<PtSession[] | null>(null);
  // Separate from `queue === null`, which only means "not read yet". A refused
  // or unreachable read used to land here as an empty queue, and an empty queue
  // is the screen's good state — so the coach got a tick and "nothing is
  // holding payroll up" at the exact moment the app had no idea what was
  // outstanding. Payroll is then settled short, and nobody finds out until a
  // trainer asks where their session went.
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Marked in this sitting, so an accidental tap can be taken back without
  // hunting for the session again once it has left the queue.
  const [justMarked, setJustMarked] = useState<{ s: PtSession; outcome: SessionOutcome }[]>([]);

  /* ── the window, and what it costs to widen it ────────────────────────────
   *
   * This screen read a fixed 90 days and kept only the UNMARKED sessions out of
   * it. That is a to-do list, and a to-do list empties itself: a coach who
   * cleared the queue on Monday had, by Tuesday, no screen anywhere in the app
   * that said what they had delivered, to whom, or what became of it. The
   * marking is what generates the record and then the record was thrown away.
   *
   * So the whole read is kept now, the queue is derived from it, and the window
   * can be pushed back a quarter at a time. It is paged rather than opened
   * wide, because going further back costs a read and `fetchMySessions` refuses
   * a truncated one outright (`assertWhole` — a payroll figure over an unknown
   * fraction of a set is worse than no figure). A quarter at a time keeps each
   * read inside the row cap for any realistic coach and makes the boundary
   * something the coach chose rather than something that happened to them.
   */
  const [all, setAll] = useState<PtSession[] | null>(null);
  /** The window the rows in `all` actually cover. Never assumed from a control
   *  the coach tapped — only set from a read that came back. */
  const [loadedDays, setLoadedDays] = useState(MARK_WINDOW_DAYS);
  const [widening, setWidening] = useState(false);
  /** A widening that failed. Kept apart from `failed`: the rows already on
   *  screen are still real and still current, and blanking them because the
   *  quarter BEFORE them could not be read would take a working record away. */
  const [widenErr, setWidenErr] = useState<string | null>(null);
  // Read inside the catch below, where the state value would be the one
  // captured when `load` was built rather than the one that is true now.
  const haveRows = useRef(false);

  const load = useCallback(async (days: number = MARK_WINDOW_DAYS) => {
    // Still working out who is signed in. Not an answer either way, so leave
    // the queue unread — the effect runs again when auth settles.
    if (authLoading) return;
    if (!uid) {
      // Nobody signed in. This screen has no way to know whose sessions to
      // ask for, and an empty queue would say "nothing outstanding" — which is
      // the one thing it must never say without having looked.
      reportError('sessions.awaiting', new Error('no signed-in coach to read sessions for'));
      setQueue(null);
      setAll(null);
      haveRows.current = false;
      setFailed(true);
      return;
    }
    setWidening(true);
    setWidenErr(null);
    if (!haveRows.current) setFailed(false);
    try {
      // 90 days back by default: far enough to catch a forgotten fortnight,
      // short enough that the query stays cheap and the list stays readable.
      // `days` is what the coach has asked for beyond that.
      const since = windowStart(days);
      const mine = await fetchMySessions(supabase, uid, since, new Date().toISOString());
      setAll(mine);
      haveRows.current = true;
      setLoadedDays(days);
      setQueue(awaitingOutcome(mine));
      setFailed(false);
    } catch (e) {
      reportError('sessions.awaiting', e);
      if (haveRows.current) {
        // A wider read that failed leaves the narrower one standing. What the
        // coach loses is the extra quarter, and they are told exactly that
        // rather than watching the screen they were working on empty itself.
        setWidenErr('That earlier period could not be read, so this list still ends where it did. Nothing already on this screen has changed.');
      } else {
        // Leave the queue unknown rather than empty. [] here would be read as
        // "nothing outstanding", which is a claim about the gym's payroll this
        // screen is in no position to make.
        setQueue(null);
        setAll(null);
        setFailed(true);
      }
    } finally {
      setWidening(false);
    }
  }, [uid, authLoading]);

  useEffect(() => { void load(MARK_WINDOW_DAYS); }, [load]);

  const loaded = queue !== null;
  const rows = queue ?? [];
  const days = byDay(rows);

  /* Everything in the window that has already finished, newest first —
   * delivered, not attended, cancelled either way, and the ones still waiting
   * on an outcome. Cancellations are kept rather than filtered out: they are
   * the evidence the hour was booked, and supabase/parts/195 is the argument
   * for why removing that evidence quietly improves every figure computed over
   * what is left. */
  const history = useMemo(() => pastSessions(all ?? []), [all]);
  const historyDays = useMemo(() => byDay(history), [history]);
  /** The instant the loaded window starts at — the edge of what this screen can
   *  answer for, named on screen rather than implied by a list that stops. */
  const windowFrom = useMemo(() => windowStart(loadedDays), [loadedDays]);

  const mark = async (s: PtSession, outcome: SessionOutcome) => {
    // Unreachable in practice — with no uid the queue is `failed` and no row is
    // drawn to tap — but the write is scoped by the coach's id and a `!` here
    // would be a claim rather than a check.
    if (!uid) return;
    setBusy(s.id);
    try {
      // Snapshot the gym's fee at the moment of marking, so a later fee change
      // cannot rewrite what this session was worth. The snapshot is taken HERE
      // and carried into the queue rather than recomputed at flush time: a
      // session marked on Tuesday and sent on Thursday is worth what it was
      // worth on Tuesday, and re-reading the fee would let a rate change in
      // between quietly rewrite it.
      // Converted by the gym's currency, never by a factor of a hundred: in
      // yen that snapshot was a hundred times the fee and in dinar a tenth of
      // it, on the column payroll is settled from. An independent coach's own
      // fee has no currency recorded anywhere, so it converts to null and NO
      // rate is written — payrollByTrainer falls back to the rate the gym
      // states today, which is a figure somebody chose.
      const rateCents = minorFromWhole(feeToSnapshot, tenant?.currency) ?? undefined;
      // ── the outcome, and the room it is recorded in ────────────────────
      //
      // This is the same money as the class tick, one session at a time, and
      // it went straight through: a throw produced "check your connection and
      // try again", the row stayed in the list, and a coach clearing a day's
      // sessions in a basement did it three times and got nowhere.
      //
      // `markMyOutcome` throws on a zero-row update as well as on a transport
      // failure, and those are not the same event — one is the session not
      // being theirs to mark, which will be true again next time. The queue
      // separates them: `refused` keeps the row in the list and says so,
      // `unsent` takes it off the list because the coach HAS decided and this
      // phone now holds that decision, and says the gym cannot see it yet.
      const out = await floor.attempt({
        kind: 'session-outcome', sessionId: s.id, clientName: s.clientName ?? null, outcome, rateCents,
      });
      if (out === 'refused') {
        Alert.alert('Not recorded',
          'That outcome was not saved and is not waiting to send — the session may no longer exist, or it is not yours to mark.');
        return;
      }
      setQueue((prev) => (prev ?? []).filter((x) => x.id !== s.id));
      // The session leaves the queue and JOINS the record, in the same tap. It
      // is the same row seen two ways, and letting the history keep saying
      // "still needs an outcome" for one it has just been given would make the
      // two halves of this screen disagree with each other in front of the
      // person who resolved it.
      setAll((prev) => (prev ?? []).map((x) => (x.id === s.id
        ? { ...x, outcome, outcomeAt: new Date().toISOString() } : x)));
      setJustMarked((prev) => [{ s, outcome }, ...prev].slice(0, 8));
      tapLight();
      if (out === 'unsent') {
        Alert.alert('Kept on this phone', keptOfflineLine('That outcome'));
      }
    } catch (e) {
      reportError('sessions.mark', e);
      Alert.alert('Not recorded', 'That outcome was not saved. Check your connection and try again.');
    } finally { setBusy(null); }
  };

  /**
   * Send what this phone is still carrying, now.
   *
   * The queue is emptied on the app's own two triggers as well — the signal
   * coming back and the app returning to the foreground, both of which reach it
   * through the registry in src/lib/offlineQueue.ts. This is the button for the
   * coach who can see the banner and wants it gone before they walk out.
   *
   * All three arms of the result are reported, because they mean three
   * different things and only one of them is "done". A refused act has been
   * dropped from the queue rather than kept, and a coach who is not told that
   * will press this button for the rest of the install.
   */
  const [sending, setSending] = useState(false);
  const sendWaiting = async () => {
    if (sending) return;
    setSending(true);
    try {
      const line = flushResultLine(await floor.flush());
      if (line) Alert.alert('Sending finished', line);
    } finally { setSending(false); }
  };

  const undo = async (entry: { s: PtSession; outcome: SessionOutcome }) => {
    if (!uid) return;
    try {
      await clearMyOutcome(supabase, uid, entry.s.id);
      setJustMarked((prev) => prev.filter((x) => x.s.id !== entry.s.id));
      setQueue((prev) => [entry.s, ...(prev ?? [])]);
      // Back to unmarked in the record too, for the same reason as above.
      setAll((prev) => (prev ?? []).map((x) => (x.id === entry.s.id
        ? { ...x, outcome: null, outcomeAt: null } : x)));
      tapLight();
    } catch (e) {
      // The row keeps its outcome on the server, so saying nothing here leaves
      // the coach believing they took back a "no show" they did not — and the
      // gym pays, or does not pay, on the outcome that is still recorded.
      reportError('sessions.undo', e);
      Alert.alert('Not undone', `${entry.s.clientName ?? 'That session'} is still recorded as “${OUTCOMES.find((o) => o.id === entry.outcome)?.label ?? entry.outcome}”. Check your connection and tap undo again.`);
    }
  };

  /** Mark a whole day the same way. Confirmed, because it is many writes. */
  const markDay = (day: { label: string; rows: PtSession[] }, outcome: SessionOutcome) => {
    const label = OUTCOMES.find((o) => o.id === outcome)?.label ?? outcome;
    Alert.alert(
      `${label} — all ${day.rows.length}?`,
      `Every unmarked session on ${day.label} will be recorded as "${label}". You can undo each one afterwards.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark all', onPress: async () => { for (const s of day.rows) await mark(s, outcome); } },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg, marginBottom: sp.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="chevron" size={20} color={t.ink3} />
          </Pressable>
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }}>Mark Sessions</Text>
        </View>

        <Hero
          label="Waiting on an Outcome"
          figure={fig(loaded ? rows.length : null)}
          note={failed
            ? 'Could not be read — this is not a count of zero.'
            : !loaded
              ? 'Reading your sessions…'
              : rows.length === 0
                ? (hasGym ? 'Nothing outstanding — payroll can be settled.' : 'Nothing outstanding — every session you have delivered is on the record.')
                : (hasGym ? 'Payroll cannot be worked out until every one of these is marked.' : 'Your delivered-sessions count is incomplete until every one of these is marked.')}
        />

        <Rule />

        {loaded && rows.length > 0 ? (
          <Section>
            <KpiRow items={[
              { label: 'Sessions', value: fig(rows.length) },
              { label: 'Days', value: fig(days.length) },
              { label: 'Oldest', value: days.length ? days[days.length - 1].day.slice(5) : '—' },
            ]} />
          </Section>
        ) : null}

        {/* What this phone is still carrying, said above the list rather than
            inside it: an outcome kept here has already left the list, so a
            coach who does not see this believes the gym has it — and a gym
            settles payroll on it. A queue that could not be READ is not an
            empty one, so "nothing waiting" is withheld rather than claimed. */}
        {!floor.queueRead ? (
          <View style={{ paddingTop: sp.sm }}>
            <Flag tone={t.warn}>
              What this phone is still carrying could not be read, so whether any outcomes are waiting to go up is not known. Nothing has been lost — it is not being written over either.
            </Flag>
          </View>
        ) : floorPendingNote(floor.unsent) ? (
          <View style={{ paddingTop: sp.sm }}>
            <Flag tone={t.warn}>{floorPendingNote(floor.unsent)}</Flag>
            {/* The banner used to say something was waiting and offer no way to
                send it, so a coach standing in reception with four bars had to
                guess at what would trigger a flush. The app's own reconnect and
                foreground triggers reach this queue now, and this is the manual
                one for the coach who wants to watch it happen before they leave
                the building. */}
            <View style={{ alignItems: 'flex-start', paddingTop: sp.sm }}>
              <Ghost label="Send Now" a11yLabel="Send what is waiting on this phone"
                onPress={() => { void sendWaiting(); }} />
            </View>
          </View>
        ) : null}

        {failed ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
            <Flag tone={t.crit}>Could not read your sessions</Flag>
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>
              There may or may not be sessions waiting on an outcome — the app could not find out.
              {hasGym ? ' Do not settle payroll on this screen until it loads.' : ' Do not treat this as a clear queue until it loads.'}
            </Text>
            <Pressable onPress={() => void load(loadedDays)} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="Try reading your sessions again"
              style={{ marginTop: sp.lg, borderWidth: hairline, borderColor: t.ring, borderRadius: radius.pill, paddingHorizontal: sp.lg, paddingVertical: sp.sm }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Try Again</Text>
            </Pressable>
          </View>
        ) : !loaded ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>Loading…</Text>
        ) : rows.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
            <Icon name="check" size={26} color={t.brand} />
            <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>All caught up</Text>
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>
              Every session that has already happened has an outcome recorded{hasGym ? ', so nothing is holding payroll up.' : '.'}
            </Text>
          </View>
        ) : days.map((day, di) => (
          <View key={day.day}>
            <Section>
              <SectionHead title={day.label} note={`${day.rows.length} to mark`} />

              <View style={{ flexDirection: 'row', gap: sp.sm, flexWrap: 'wrap', marginBottom: sp.md }}>
                <Text style={{ ...ty.caption, color: t.ink3, alignSelf: 'center' }}>Whole day:</Text>
                {OUTCOMES.slice(0, 2).map((o) => (
                  <Pressable key={o.id} onPress={() => markDay(day, o.id)} hitSlop={6}
                    accessibilityRole="button" accessibilityLabel={`Mark every session on ${day.label} as ${o.label}`}
                    style={{ borderWidth: hairline, borderColor: o.tone(t), borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                    <Text style={{ ...ty.caption, color: o.tone(t) }}>{o.short}</Text>
                  </Pressable>
                ))}
              </View>

              {day.rows.map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md, opacity: busy === s.id ? 0.5 : 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>
                      {s.clientName ?? 'Client'}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {when(s.startsAt)} · {s.durationMin} min
                      {s.trainerName ? ` · ${s.trainerName}` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                      {OUTCOMES.map((o) => (
                        <Pressable key={o.id} disabled={busy === s.id} onPress={() => mark(s, o.id)} hitSlop={4}
                          accessibilityRole="button" accessibilityLabel={`${s.clientName ?? 'Client'}: ${o.label}`}
                          style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 8 }}>
                          <Text style={{ ...ty.label, fontWeight: '600', color: o.tone(t) }}>{o.short}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              ))}
            </Section>
            {di < days.length - 1 ? <Rule /> : null}
          </View>
        ))}

        {justMarked.length > 0 ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Marked Just Now" note="Tap to undo" />
              {justMarked.map((e, i) => (
                <View key={e.s.id}>
                  {i > 0 ? <Rule /> : null}
                  <Pressable onPress={() => undo(e)} accessibilityRole="button"
                    accessibilityLabel={`Undo ${e.outcome} for ${e.s.clientName ?? 'client'}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, color: t.ink2 }} numberOfLines={1}>{e.s.clientName ?? 'Client'}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {when(e.s.startsAt)} · {OUTCOMES.find((o) => o.id === e.outcome)?.label}
                      </Text>
                    </View>
                    <Text style={{ ...ty.label, fontWeight: '600', color: t.ink3 }}>Undo</Text>
                  </Pressable>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        {/* ── what already happened ───────────────────────────────────────
            The queue above is a to-do list and empties itself. This is the
            record it generates, and it is the only place in the coach app that
            says what became of a session once it has been marked. Shown only
            once a read has come back: under `failed` the section above already
            says the app could not find out, and repeating a second empty list
            underneath it would read as a coach with no history. */}
        {all !== null ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="What Already Happened"
                note={`${history.length} in ${loadedDays} days`} />

              {/* The edge of the window, said plainly. A list that simply stops
                  is read as a record that stops. */}
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                Sessions from {dayOnly(windowFrom)} onwards. Anything earlier is on the server and has not
                been read onto this screen.
              </Text>

              {widenErr ? <Flag tone={t.warn}>{widenErr}</Flag> : null}

              {history.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  No sessions of yours have finished in this window. Read further back to see earlier ones.
                </Text>
              ) : historyDays.map((day, di) => (
                <View key={day.day}>
                  {di > 0 ? <Rule /> : null}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md, marginBottom: sp.xs }}>{day.label}</Text>
                  {day.rows.map((s) => {
                    const v = pastVerdict(s);
                    return (
                      <View key={s.id} style={{ paddingVertical: sp.sm }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                          <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>
                            {s.clientName ?? 'Client'}
                          </Text>
                          {/* The tone is the dot. The label is ink beside it. */}
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: stateTone(t, v.state) }} />
                          <Text style={{ ...ty.caption, color: t.ink2 }}>{PAST_STATE_LABEL[v.state]}</Text>
                        </View>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                          {when(s.startsAt)} · {s.durationMin} min
                          {v.at ? ` · marked ${when(v.at)}` : ''}
                        </Text>
                        {/* Said in full only where it changes what somebody
                            should do. A delivered session needs no sentence; an
                            unmarked one is holding up a settlement. */}
                        {v.state === 'unmarked' ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{PAST_STATE_NOTE.unmarked}</Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}

              {/* Going further back costs a read, so it is a tap and not a
                  scroll. The label names the price rather than hiding it. */}
              <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
                <Pressable
                  disabled={widening}
                  onPress={() => void load(loadedDays + MARK_WINDOW_DAYS)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Read the ${MARK_WINDOW_DAYS} days before ${dayOnly(windowFrom)}`}
                  style={{ borderWidth: hairline, borderColor: t.ring, borderRadius: radius.pill, paddingHorizontal: sp.lg, paddingVertical: sp.sm, opacity: widening ? 0.5 : 1 }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>
                    {widening ? 'Reading…' : 'Read Another 90 Days'}
                  </Text>
                </Pressable>
              </View>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
