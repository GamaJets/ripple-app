// Owner · Trainer rota. Who is on the floor when — and where that disagrees
// with what the floor is booked to do.
//
// The rules behind this screen live in src/lib/gymRota.ts with tests; no maths
// happens in this file. It is a view onto two findings and a week grid:
//
//  · UNCOVERED — an hour with a class or a one-to-one booked and nobody
//    rostered. This is the hero, because it is the one that costs the gym a
//    member.
//  · IDLE — an hour with somebody rostered and nothing booked at all. Paid
//    floor time that is not being sold.
//
// The distinction the screen is careful to keep: an empty rota is not an
// uncovered gym. When no shifts exist for the week, gymRota returns null for
// both findings and a reason, and this renders a dash and the reason rather
// than "37 uncovered hours" against a form nobody has filled in. "Not loaded
// yet" is a third state again, and reads as "Reading the rota…".
import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { Fetched } from '../../src/ui/fetched';
import { oldestFetch } from '../../src/lib/freshness';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { pct } from '../../src/lib/gymSchedule';
import { fetchGymTrainers, type GymTrainer } from '../../src/lib/gymTrainers';
import {
  fetchShifts, fetchDemand, addShift, setShiftStatus, shiftFromHours,
  weekStartOf, weekDays, weekWindow, shiftWeek, coverage, shiftsByDay,
  rosterByTrainer, summariseRota, hourLabel,
  type Shift, type ShiftRole, type DemandBlock, type RotaGap,
} from '../../src/lib/gymRota';
// Whose clock this whole screen is on. The gym's where `tenants.timezone` is
// set, the reader's where it is not — and `note` is the sentence that says which,
// printed rather than implied. See src/lib/rotaClock.ts.
import { rotaClock, rotaTimeLabel } from '../../src/lib/rotaClock';
import { fetchGymZone } from '../../src/lib/gymZone';
import { calendarDateText } from '../../src/lib/gymWhen';
import { BACK_ICON, FORWARD_ICON } from '../../src/ui/direction';
import { numUpTo } from '../../src/lib/format';

const ROLES: { key: ShiftRole; label: string }[] = [
  { key: 'floor', label: 'Floor' },
  { key: 'classes', label: 'Classes' },
  { key: 'pt', label: 'PT' },
  { key: 'desk', label: 'Desk' },
  { key: 'admin', label: 'Admin' },
];

const ROLE_LABEL: Record<ShiftRole, string> = {
  floor: 'Floor', classes: 'Classes', pt: 'PT', desk: 'Desk', admin: 'Admin',
};

/**
 * A calendar date rendered as "Mon 7 Sep".
 *
 * Through `calendarDateText`, which is the one tool for a date that is ALREADY
 * a day: "the 7th of September" is not an instant and asking which day it falls
 * on has no content. The old body parsed `${dateIso}T00:00:00`, the reader's own
 * midnight — an hour some zones do not have — and then asked the reader's
 * calendar which day that was. It gave the right answer almost everywhere,
 * which is what kept it.
 */
function dayLabel(dateIso: string, long = false): string {
  return calendarDateText(dateIso, long
    ? { weekday: 'long', day: 'numeric', month: 'short' }
    : { weekday: 'short', day: 'numeric', month: 'short' }) ?? dateIso;
}

/** Hours as a figure a human reads — 7.5 stays 7.5, 8 does not become 8.0. */
function hrs(n: number | null): string | null {
  if (n == null) return null;
  return numUpTo(n, 1);
}

/**
 * A stored instant as the rota's wall clock. An unreadable one is a dash, not a
 * plausible-looking midnight.
 *
 * This function's doc comment used to say "the gym's wall clock" over a body
 * that read `d.getHours()` — the READER's. A shift rostered from a phone in
 * Sydney for a gym in Dubai was drawn six hours from where it runs, and
 * `studio-web/app/staff`, which formats the same instant with `timeZone: zone`,
 * printed a different time for the same row. `rotaTimeLabel` is now the only
 * implementation of the sentence, and rotaClock.test.ts asserts it agrees with
 * what the console draws.
 */
function timeOf(iso: string, zone: string | null): string {
  return rotaTimeLabel(iso, zone) ?? '—';
}

function Chip({ label, on, onPress, tone }: { label: string; on: boolean; onPress: () => void; tone: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={{
        paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.pill,
        backgroundColor: on ? tone : t.surface2,
      }}>
      <Text style={{ ...ty.caption, fontWeight: on ? '600' : '400', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
}

export default function OwnerRota() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useTenant();

  /**
   * The gym's own IANA zone, or null because it has not set one.
   *
   * THREE states, and the third is why this is two pieces of state rather than
   * one string. `zoneRead` false means the question has not been answered yet —
   * a week bucketed on the reader's clock and then re-bucketed a moment later
   * would redraw the grid under the owner, so the screen waits. `zoneErr` means
   * we could not ask, which is NOT "the gym has not set one": that sentence is
   * an instruction to go and set a setting that may already be correct.
   */
  const [zone, setZone] = useState<string | null>(null);
  const [zoneRead, setZoneRead] = useState(false);
  const [zoneErr, setZoneErr] = useState<string | null>(null);
  /** Whose clock, and the sentence owed to the reader when it is not the gym's. */
  const clock = rotaClock(zone);

  const [week, setWeek] = useState<string>(() => weekStartOf());
  // null = not loaded yet. [] = loaded, and genuinely empty.
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [demand, setDemand] = useState<DemandBlock[] | null>(null);
  const [trainers, setTrainers] = useState<GymTrainer[] | null>(null);
  /**
   * The week's shifts and bookings could not be READ.
   *
   * This screen used to answer a failed read with `setShifts([]); setDemand([])`
   * under a comment calling that the honest fallback, and it is the one place in
   * the owner app that still did. It is not honest: an empty shift list makes
   * `coverage()` return the blocker "No shifts on the rota for this week", the
   * hero prints "Uncovered Hours 0", and "The Week" invites the owner to add a
   * shift. So a gym with a full rota and a refused query was told its rota was
   * empty, shown a zero where its uncovered hours should be, and asked to fix a
   * problem it does not have — which is the sentence app/(owner)/trainers.tsx
   * names as the worst thing an empty-state can do.
   */
  const [failed, setFailed] = useState(false);
  /** Same distinction for the roster the Add-a-Shift sheet picks from. */
  const [trainersFailed, setTrainersFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** When the week's shifts and demand last landed. Not moved by a failed
   *  retry — what is on screen is still the earlier read's. */
  const [shiftsAt, setShiftsAt] = useState<number | null>(null);
  /** And when the coaching staff came back. It is a second, independent read —
   *  every name on this rota comes from it — and it had neither a stamp nor a
   *  way to be asked for again, so a refresh brought back the shifts and left
   *  the names at whatever the first read returned. */
  const [trainersAt, setTrainersAt] = useState<number | null>(null);
  const [trainersTick, setTrainersTick] = useState(0);

  const [addOpen, setAddOpen] = useState(false);
  const [who, setWho] = useState<string | null>(null);
  const [day, setDay] = useState<string>(week);
  const [from, setFrom] = useState('06');
  const [to, setTo] = useState('14');
  const [role, setRole] = useState<ShiftRole>('floor');

  // The gym's zone, before anything is bucketed by it. One narrow read —
  // `fetchGymZone` exists so a rota does not have to pull the gym's pay policy
  // and brand colour to find out what time it is.
  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { zone: z, error } = await fetchGymZone(supabase, tenant.id);
        if (cancelled) return;
        setZone(z);
        setZoneErr(error);
        setZoneRead(true);
        // The week on screen was opened on whatever clock was in force when this
        // screen mounted. Once the gym's own is known, the current week is
        // re-asked — an owner in London opening a Sydney gym's rota late on a
        // Saturday is looking at a gym where it is already Sunday.
        if (z) setWeek((w) => (w === weekStartOf() ? weekStartOf(Date.now(), z) : w));
      } catch (e) {
        reportError('rota.zone', e);
        if (cancelled) return;
        setZone(null);
        setZoneErr('The gym’s timezone could not be read.');
        setZoneRead(true);
      }
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  const days = useMemo(() => weekDays(week), [week]);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    // Not before the zone is known. The window bound sent to the database IS the
    // gym's midnight, so a read issued on the reader's midnight and a grid drawn
    // on the gym's would disagree by exactly the offset — the screen would be
    // missing an evening at one end and carrying somebody else's at the other,
    // and `coverage` would report the hole as uncovered.
    if (!zoneRead) return;
    const win = weekWindow(week, zone);
    if (!win) return;
    setShifts(null);
    setDemand(null);
    // Cleared with them, so a retry reads as "Loading…" rather than leaving the
    // previous attempt's failure standing over a read that is in flight.
    setFailed(false);
    try {
      const [s, d] = await Promise.all([
        fetchShifts(supabase, tenant.id, win.fromISO, win.toISO),
        fetchDemand(supabase, tenant.id, win.fromISO, win.toISO),
      ]);
      setShifts(s);
      setDemand(d);
      setFailed(false);
      setShiftsAt(Date.now());
    } catch (e) {
      reportError('rota.fetch', e);
      // Null, and `failed` says which of the two nulls this is. See the note on
      // that flag for what the old `setShifts([])` told an owner.
      setShifts(null);
      setDemand(null);
      setFailed(true);
    }
  }, [tenant?.id, week, zone, zoneRead]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchGymTrainers(supabase, tenant.id);
        if (!cancelled) { setTrainers(list); setTrainersFailed(false); setTrainersAt(Date.now()); }
      } catch (e) {
        reportError('rota.trainers', e);
        // Not `[]`: that rendered as "No trainers on this gym yet, so there is
        // nobody to roster" to a gym whose roster read was simply refused.
        if (!cancelled) { setTrainers(null); setTrainersFailed(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, trainersTick]);

  /** One line over both reads, and it is the age of the older. */
  const fetchedAt = oldestFetch(shiftsAt, trainersAt);
  /** Both reads. The Refresh button ran only the shifts one, so an owner could
   *  press it all morning and still be looking at yesterday's staff list. */
  const refreshAll = useCallback(() => { void load(); setTrainersTick((n) => n + 1); }, [load]);
  const pull = usePullToRefresh(refreshAll);

  const loaded = shifts !== null && demand !== null;
  const cov = loaded ? coverage(days, shifts!, demand!, zone) : null;
  const sum = loaded ? summariseRota(shifts!) : null;
  const byDay = loaded ? shiftsByDay(days, shifts!, zone) : [];
  const roster = loaded ? rosterByTrainer(shifts!) : [];

  const nameOf = useCallback((id: string, fallback: string | null): string => {
    if (fallback) return fallback;
    return trainers?.find((x) => x.id === id)?.name || 'Trainer';
  }, [trainers]);

  const gapNames = (g: RotaGap): string =>
    [...g.assigned, ...g.cancelled].map((id) => nameOf(id, null)).join(', ');

  const commitAdd = async () => {
    if (!tenant?.id || !who) return;
    // The hours typed are the GYM's. Before the zone reached here they were the
    // device's, so "06 to 14" typed in London for a Dubai gym was stored as
    // 10:00–18:00 at the gym and the coach was rostered four hours late.
    const draft = shiftFromHours(who, day, parseInt(from, 10), parseInt(to, 10), role, zone);
    if (!draft) {
      Alert.alert('That is not a shift', 'The finish time has to be after the start time.');
      return;
    }
    setBusy(true);
    try {
      await addShift(supabase, tenant.id, draft);
      setAddOpen(false);
      await load();
    } catch (e) {
      reportError('rota.add', e);
      Alert.alert('Could not save that shift', 'Nothing was written. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  const togglePulled = (s: Shift) => {
    const next = s.status === 'scheduled' ? 'cancelled' : 'scheduled';
    const verb = next === 'cancelled' ? 'Pull this shift' : 'Put this shift back';
    Alert.alert(`${verb}?`, next === 'cancelled'
      ? 'It stays on the rota struck through, so the hole it leaves is visible rather than silent.'
      : `${nameOf(s.trainerId, s.trainerName)} goes back on the rota for this shift.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: verb, style: next === 'cancelled' ? 'destructive' : 'default', onPress: async () => {
        // Said out loud. A pull that did not happen leaves the rota looking
        // covered for an hour nobody is working, which is the one thing this
        // screen exists to make visible — and a silent `reportError` left the
        // owner reading the reloaded list as confirmation.
        try { await setShiftStatus(supabase, s.id, next); await load(); }
        catch (e) {
          reportError('rota.status', e);
          Alert.alert(
            next === 'cancelled' ? 'Could not pull that shift' : 'Could not put that shift back',
            (e instanceof Error && e.message) || 'The rota is unchanged. Check your connection and try again.',
          );
        }
      } },
    ]);
  };

  const thisWeek = weekStartOf(Date.now(), zone);
  const inp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12 } as const;
  const lab = { ...ty.caption, color: t.ink2, marginBottom: 6 } as const;

  const heroNote = (): string => {
    if (failed) return 'This week could not be read, so cover is not known — that is a failed read, not a covered week.';
    if (!zoneRead) return 'Checking what time it is at the gym, before the week is bucketed by it.';
    if (!loaded) return 'Reading the rota…';
    if (cov?.blocker) return cov.blocker;
    const u = cov?.uncovered?.length ?? 0;
    if (u === 0) return 'Every booked hour this week has somebody on the rota.';
    return `${u} hour${u === 1 ? '' : 's'} with work booked and nobody rostered.`;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={pull}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg, marginBottom: sp.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name={BACK_ICON} size={20} color={t.ink3} />
          </Pressable>
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }}>Rota</Text>
        </View>

        {/* Who is on the floor this week, and when that was last asked. A rota
            read in a basement an hour ago and still on screen is exactly the
            figure somebody staffs a shift against. */}
        <Fetched at={fetchedAt} onRefresh={refreshAll} busy={!loaded && !failed}
          style={{ marginTop: 0, marginBottom: sp.md }} />

        {/* ── the week being read ────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
          <Ghost icon={BACK_ICON} a11yLabel="Previous week" onPress={() => setWeek((w) => shiftWeek(w, -1))} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
              {dayLabel(days[0] ?? week)} – {dayLabel(days[6] ?? week)}
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
              {week === thisWeek ? 'This week' : week < thisWeek ? 'Past week' : 'Upcoming week'}
            </Text>
          </View>
          {week !== thisWeek ? <Ghost label="Today" onPress={() => setWeek(thisWeek)} /> : null}
          <Ghost icon={FORWARD_ICON} a11yLabel="Next week" onPress={() => setWeek((w) => shiftWeek(w, 1))} />
        </View>

        {/* Whose clock every time and every column on this screen is drawn on.
            Stated always, in both states, because the failure it closes is
            invisible: a shift at the wrong hour renders exactly as neatly as one
            at the right hour, and the only reader who finds out is the coach who
            turns up. studio-web/app/staff prints the same sentence over the same
            rota — that agreement is the point. */}
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          {!zoneRead
            ? 'Checking what time it is at the gym…'
            : zoneErr
            ? `The gym’s timezone could not be read, so the times below are this device’s. That is a failed read, not a gym without a timezone — ${zoneErr}`
            : clock.atGym
            ? `Times are ${clock.zone}, this gym’s own clock, and the hours you type are read as the gym’s too.`
            : `Times are this device’s, not the gym’s — ${clock.note}. Set the gym’s timezone and this screen becomes the gym’s clock.`}
        </Text>

        <Hero
          label="Uncovered Hours"
          figure={fig(loaded ? (cov?.uncovered?.length ?? null) : null)}
          tone={(cov?.uncovered?.length ?? 0) > 0 ? t.crit : undefined}
          note={heroNote()}
        />

        <Rule />

        <Section>
          <SectionHead title="Supply Against Demand" />
          <KpiRow items={[
            { label: 'Rostered Hours', value: fig(loaded ? hrs(cov?.rosteredHours ?? null) : null), unit: 'h' },
            { label: 'Booked Hours Covered', value: fig(loaded ? pct(cov?.coverRate ?? null) : null) },
            { label: 'Idle Hours', value: fig(loaded ? (cov?.idle?.length ?? null) : null) },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {failed
              ? 'This week’s shifts and bookings could not be read, so none of these could be worked out.'
              : !loaded
              ? 'Reading this week’s shifts, classes and one-to-ones.'
              : cov?.blocker
                ? 'An empty rota is not an uncovered gym. These stay blank until shifts are entered, rather than reporting a confident zero.'
                : `${cov!.demandHours} hour${cov!.demandHours === 1 ? '' : 's'} this week ${cov!.demandHours === 1 ? 'has' : 'have'} a class or a one-to-one booked in ${cov!.demandHours === 1 ? 'it' : 'them'}.`}
          </Text>
        </Section>

        <Rule />

        {/* ── the whole point: where the two disagree ────────────────────── */}
        <Section>
          <SectionHead title="Where the Rota Misses" />
          {failed ? (
            // Ahead of every other branch: an unread week misses nothing that
            // anybody has established, and a clean list here reads as a clean
            // week. The retry is under "The Week" below.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              This week could not be read, so no gap has been found and none has been ruled out.
            </Text>
          ) : !loaded ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Loading…</Text>
          ) : cov?.blocker ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>{cov.blocker}</Text>
          ) : (cov!.uncovered!.length === 0 && cov!.idle!.length === 0) ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              The rota and the timetable agree this week — nothing booked without cover, and no
              rostered hour with nothing in it.
            </Text>
          ) : (
            <>
              {cov!.uncovered!.map((g, i) => (
                <View key={`u-${g.date}-${g.hour}`}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
                        {dayLabel(g.date)} · {hourLabel(g.hour)}
                      </Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {g.note}{gapNames(g) ? ` · ${gapNames(g)}` : ''}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
              {cov!.uncovered!.length > 0 && cov!.idle!.length > 0 ? <Rule /> : null}
              {cov!.idle!.map((g, i) => (
                <View key={`i-${g.date}-${g.hour}`}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
                        {dayLabel(g.date)} · {hourLabel(g.hour)}
                      </Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {g.note} {g.rostered.map((id) => nameOf(id, null)).join(', ')}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </>
          )}
        </Section>

        <Rule />

        {/* ── the rota itself ───────────────────────────────────────────── */}
        <Section>
          <SectionHead
            title="The Week"
            note={loaded && sum!.shifts > 0
              ? `${sum!.shifts} shift${sum!.shifts === 1 ? '' : 's'}${sum!.cancelled ? ` · ${sum!.cancelled} pulled` : ''}`
              : undefined}
          />
          {failed ? (
            <View>
              <Text style={{ ...ty.label, color: t.ink3 }}>
                This week’s rota could not be read. Nobody has been taken off it — this screen
                simply does not know who is on, which is not the same as nobody being on.
              </Text>
              <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                <Ghost label="Try Again" onPress={() => { void load(); }} />
              </View>
            </View>
          ) : !loaded ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Loading…</Text>
          ) : shifts!.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nothing on the rota for this week. Add a shift and this becomes the check against
              what the timetable has booked.
            </Text>
          ) : byDay.map((d, i) => (
            <View key={d.date} style={{ marginTop: i === 0 ? 0 : sp.lg }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>{dayLabel(d.date, true)}</Text>
              {d.shifts.length === 0 ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>Nobody rostered</Text>
              ) : d.shifts.map((s) => {
                const pulled = s.status === 'cancelled';
                return (
                  <Pressable key={s.id} onPress={() => togglePulled(s)}
                    accessibilityRole="button"
                    accessibilityLabel={`${pulled ? 'Put back' : 'Pull'} ${nameOf(s.trainerId, s.trainerName)}, ${timeOf(s.startsAt, zone)} to ${timeOf(s.endsAt, zone)}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, opacity: pulled ? 0.5 : 1 }}>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3, width: 92 }}>
                      {timeOf(s.startsAt, zone)}–{timeOf(s.endsAt, zone)}
                    </Text>
                    <Text style={{ ...ty.body, color: t.ink, flex: 1, textDecorationLine: pulled ? 'line-through' : 'none' }} numberOfLines={1}>
                      {nameOf(s.trainerId, s.trainerName)}
                    </Text>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>{pulled ? 'Pulled' : ROLE_LABEL[s.role]}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Section>

        {roster.length > 0 ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Hours Per Trainer" />
              {roster.map((r, i) => (
                <View key={r.trainerId}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>
                      {nameOf(r.trainerId, r.trainerName)}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>
                      {r.shifts.length} shift{r.shifts.length === 1 ? '' : 's'}
                    </Text>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>
                      {fig(hrs(r.hours))}{r.hours == null ? '' : 'h'}
                    </Text>
                  </View>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        <View style={{ marginTop: sp.lg }}>
          <Cta label="Add a Shift" wide
            onPress={() => { setDay(days[0] ?? week); setAddOpen(true); }} />
        </View>
      </ScrollView>

      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)} />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, maxHeight: '90%' }}>
            {/* Trainer chips, day chips, two hour boxes, a clock note, role chips and
                two buttons, with no scroller — so with the keyboard up over the hour
                boxes "Put on the rota" is below the bottom of the window and there is
                no gesture that brings it back. */}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <Text style={{ ...ty.head, color: t.ink }}>Add a Shift</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
                One row per block on the floor. Shifts are written for this week only — cover and
                swaps are edits to a single day, not to a pattern.
              </Text>

              <Text style={lab}>Trainer</Text>
              {trainersFailed ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Your trainers could not be read, so nobody can be offered here — this is a failed
                  read, not a gym with no staff.
                </Text>
              ) : trainers === null ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Loading trainers…</Text>
              ) : trainers.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  No trainers on this gym yet, so there is nobody to roster.
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: sp.sm, paddingVertical: 2 }}>
                  {trainers.map((x) => (
                    <Chip key={x.id} label={x.name} on={who === x.id} tone={t.brand}
                      onPress={() => setWho(x.id)} />
                  ))}
                </ScrollView>
              )}

              <Text style={{ ...lab, marginTop: sp.lg }}>Day</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: sp.sm, paddingVertical: 2 }}>
                {days.map((d) => (
                  <Chip key={d} label={dayLabel(d)} on={day === d} tone={t.brand} onPress={() => setDay(d)} />
                ))}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}>
                  <Text style={lab}>Starts (hour)</Text>
                  <TextInput value={from} onChangeText={setFrom} keyboardType="number-pad" maxLength={2}
                    style={inp} accessibilityLabel="Start hour" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={lab}>Finishes (hour)</Text>
                  <TextInput value={to} onChangeText={setTo} keyboardType="number-pad" maxLength={2}
                    returnKeyType="done" onSubmitEditing={() => { void commitAdd(); }}
                    style={inp} accessibilityLabel="Finish hour" />
                </View>
              </View>

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {clock.atGym
                  ? `Those hours are ${clock.zone}, the gym’s own clock — wherever you are typing them.`
                  : `Those hours are this device’s, not the gym’s — ${clock.note}.`}
              </Text>

              <Text style={{ ...lab, marginTop: sp.lg }}>On for</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, flexWrap: 'wrap', marginBottom: sp.lg }}>
                {ROLES.map((r) => (
                  <Chip key={r.key} label={r.label} on={role === r.key} tone={t.brand}
                    onPress={() => setRole(r.key)} />
                ))}
              </View>

              <Pressable disabled={!who || busy} onPress={commitAdd}
                accessibilityRole="button" accessibilityLabel="Save shift"
                accessibilityState={{ disabled: !who || busy }}
                style={{ backgroundColor: who && !busy ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginBottom: sp.sm }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: who && !busy ? t.brandInk : t.ink3 }}>
                  {busy ? 'Saving…' : 'Put on the rota'}
                </Text>
              </Pressable>
              <Ghost label="Cancel" onPress={() => setAddOpen(false)} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
