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
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, fig, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { useTenant } from '../../src/ui/tenant';
import { useAuth } from '../../src/ui/auth';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { tapLight } from '../../src/ui/haptics';
import { type PtSession, type SessionOutcome } from '../../src/lib/gymSessions';
import {
  MARK_WINDOW_DAYS, awaitingOutcome, clearMyOutcome, fetchMySessions, markMyOutcome, windowStart,
} from '../../src/lib/trainerSessions';

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
  // The rate to snapshot when an outcome is recorded. A gym's fee where there
  // is a gym, and otherwise the coach's own — an independent trainer's sessions
  // are priced by the rate on their profile, and there is nowhere else for that
  // figure to come from. Null stays null: `markMyOutcome` then leaves rate_cents
  // untouched rather than writing a zero that reads as "this was free".
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

  const load = useCallback(async () => {
    // Still working out who is signed in. Not an answer either way, so leave
    // the queue unread — the effect runs again when auth settles.
    if (authLoading) return;
    if (!uid) {
      // Nobody signed in. This screen has no way to know whose sessions to
      // ask for, and an empty queue would say "nothing outstanding" — which is
      // the one thing it must never say without having looked.
      reportError('sessions.awaiting', new Error('no signed-in coach to read sessions for'));
      setQueue(null);
      setFailed(true);
      return;
    }
    setFailed(false);
    try {
      // 90 days back: far enough to catch a forgotten fortnight, short enough
      // that the query stays cheap and the list stays readable.
      const since = windowStart(MARK_WINDOW_DAYS);
      const mine = await fetchMySessions(supabase, uid, since, new Date().toISOString());
      setQueue(awaitingOutcome(mine));
    } catch (e) {
      reportError('sessions.awaiting', e);
      // Leave the queue unknown rather than empty. [] here would be read as
      // "nothing outstanding", which is a claim about the gym's payroll this
      // screen is in no position to make.
      setQueue(null);
      setFailed(true);
    }
  }, [uid, authLoading]);

  useEffect(() => { void load(); }, [load]);

  const loaded = queue !== null;
  const rows = queue ?? [];
  const days = byDay(rows);

  const mark = async (s: PtSession, outcome: SessionOutcome) => {
    // Unreachable in practice — with no uid the queue is `failed` and no row is
    // drawn to tap — but the write is scoped by the coach's id and a `!` here
    // would be a claim rather than a check.
    if (!uid) return;
    setBusy(s.id);
    try {
      // Snapshot the gym's fee at the moment of marking, so a later fee change
      // cannot rewrite what this session was worth.
      await markMyOutcome(supabase, uid, s.id, outcome, feeToSnapshot != null ? feeToSnapshot * 100 : undefined);
      setQueue((prev) => (prev ?? []).filter((x) => x.id !== s.id));
      setJustMarked((prev) => [{ s, outcome }, ...prev].slice(0, 8));
      tapLight();
    } catch (e) {
      reportError('sessions.mark', e);
      Alert.alert('Not recorded', 'That outcome was not saved. Check your connection and try again.');
    } finally { setBusy(null); }
  };

  const undo = async (entry: { s: PtSession; outcome: SessionOutcome }) => {
    if (!uid) return;
    try {
      await clearMyOutcome(supabase, uid, entry.s.id);
      setJustMarked((prev) => prev.filter((x) => x.s.id !== entry.s.id));
      setQueue((prev) => [entry.s, ...(prev ?? [])]);
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

        {failed ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
            <Flag tone={t.crit}>Could not read your sessions</Flag>
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>
              There may or may not be sessions waiting on an outcome — the app could not find out.
              {hasGym ? ' Do not settle payroll on this screen until it loads.' : ' Do not treat this as a clear queue until it loads.'}
            </Text>
            <Pressable onPress={() => void load()} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="Try reading your sessions again"
              style={{ marginTop: sp.lg, borderWidth: hairline, borderColor: t.ring, borderRadius: radius.pill, paddingHorizontal: sp.lg, paddingVertical: sp.sm }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Try again</Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}
