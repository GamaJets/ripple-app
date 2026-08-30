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
import { pct } from '../../src/lib/gymSchedule';
import { fetchGymTrainers, type GymTrainer } from '../../src/lib/gymTrainers';
import {
  fetchShifts, fetchDemand, addShift, setShiftStatus, shiftFromHours,
  weekStartOf, weekDays, weekWindow, shiftWeek, coverage, shiftsByDay,
  rosterByTrainer, summariseRota, hourLabel,
  type Shift, type ShiftRole, type DemandBlock, type RotaGap,
} from '../../src/lib/gymRota';

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

/** A local ISO date rendered as "Mon 7 Sep". */
function dayLabel(dateIso: string, long = false): string {
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString(undefined, long
    ? { weekday: 'long', day: 'numeric', month: 'short' }
    : { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Hours as a figure a human reads — 7.5 stays 7.5, 8 does not become 8.0. */
function hrs(n: number | null): string | null {
  if (n == null) return null;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** A stored instant as the gym's wall clock. An unreadable one is a dash, not
 *  a plausible-looking midnight. */
function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

  const [week, setWeek] = useState<string>(() => weekStartOf());
  // null = not loaded yet. [] = loaded, and genuinely empty.
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [demand, setDemand] = useState<DemandBlock[] | null>(null);
  const [trainers, setTrainers] = useState<GymTrainer[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [who, setWho] = useState<string | null>(null);
  const [day, setDay] = useState<string>(week);
  const [from, setFrom] = useState('06');
  const [to, setTo] = useState('14');
  const [role, setRole] = useState<ShiftRole>('floor');

  const days = useMemo(() => weekDays(week), [week]);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    const win = weekWindow(week);
    if (!win) return;
    setShifts(null);
    setDemand(null);
    try {
      const [s, d] = await Promise.all([
        fetchShifts(supabase, tenant.id, win.fromISO, win.toISO),
        fetchDemand(supabase, tenant.id, win.fromISO, win.toISO),
      ]);
      setShifts(s);
      setDemand(d);
    } catch (e) {
      reportError('rota.fetch', e);
      // Loaded-and-empty is the honest fallback here: the screen then says the
      // rota is empty rather than spinning forever on a failed read.
      setShifts([]);
      setDemand([]);
    }
  }, [tenant?.id, week]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchGymTrainers(supabase, tenant.id);
        if (!cancelled) setTrainers(list);
      } catch (e) {
        reportError('rota.trainers', e);
        if (!cancelled) setTrainers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  const loaded = shifts !== null && demand !== null;
  const cov = loaded ? coverage(days, shifts!, demand!) : null;
  const sum = loaded ? summariseRota(shifts!) : null;
  const byDay = loaded ? shiftsByDay(days, shifts!) : [];
  const roster = loaded ? rosterByTrainer(shifts!) : [];

  const nameOf = useCallback((id: string, fallback: string | null): string => {
    if (fallback) return fallback;
    return trainers?.find((x) => x.id === id)?.name || 'Trainer';
  }, [trainers]);

  const gapNames = (g: RotaGap): string =>
    [...g.assigned, ...g.cancelled].map((id) => nameOf(id, null)).join(', ');

  const commitAdd = async () => {
    if (!tenant?.id || !who) return;
    const draft = shiftFromHours(who, day, parseInt(from, 10), parseInt(to, 10), role);
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
        try { await setShiftStatus(supabase, s.id, next); await load(); }
        catch (e) { reportError('rota.status', e); }
      } },
    ]);
  };

  const thisWeek = weekStartOf();
  const inp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12 } as const;
  const lab = { ...ty.caption, color: t.ink2, marginBottom: 6 } as const;

  const heroNote = (): string => {
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
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg, marginBottom: sp.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="chevron" size={20} color={t.ink3} />
          </Pressable>
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }}>Rota</Text>
        </View>

        {/* ── the week being read ────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
          <Ghost icon="back" a11yLabel="Previous week" onPress={() => setWeek((w) => shiftWeek(w, -1))} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
              {dayLabel(days[0] ?? week)} – {dayLabel(days[6] ?? week)}
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
              {week === thisWeek ? 'This week' : week < thisWeek ? 'Past week' : 'Upcoming week'}
            </Text>
          </View>
          {week !== thisWeek ? <Ghost label="Today" onPress={() => setWeek(thisWeek)} /> : null}
          <Ghost icon="chevron" a11yLabel="Next week" onPress={() => setWeek((w) => shiftWeek(w, 1))} />
        </View>

        <Hero
          label="Uncovered Hours"
          figure={fig(loaded ? (cov?.uncovered?.length ?? null) : null)}
          tone={(cov?.uncovered?.length ?? 0) > 0 ? t.crit : undefined}
          note={heroNote()}
        />

        <Rule />

        <Section>
          <SectionHead title="Supply against demand" />
          <KpiRow items={[
            { label: 'Rostered hours', value: fig(loaded ? hrs(cov?.rosteredHours ?? null) : null), unit: 'h' },
            { label: 'Booked hours covered', value: fig(loaded ? pct(cov?.coverRate ?? null) : null) },
            { label: 'Idle hours', value: fig(loaded ? (cov?.idle?.length ?? null) : null) },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {!loaded
              ? 'Reading this week’s shifts, classes and one-to-ones.'
              : cov?.blocker
                ? 'An empty rota is not an uncovered gym. These stay blank until shifts are entered, rather than reporting a confident zero.'
                : `${cov!.demandHours} hour${cov!.demandHours === 1 ? '' : 's'} this week have a class or a one-to-one booked in them.`}
          </Text>
        </Section>

        <Rule />

        {/* ── the whole point: where the two disagree ────────────────────── */}
        <Section>
          <SectionHead title="Where the rota misses" />
          {!loaded ? (
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
            title="The week"
            note={loaded && sum!.shifts > 0
              ? `${sum!.shifts} shift${sum!.shifts === 1 ? '' : 's'}${sum!.cancelled ? ` · ${sum!.cancelled} pulled` : ''}`
              : undefined}
          />
          {!loaded ? (
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
                    accessibilityLabel={`${pulled ? 'Put back' : 'Pull'} ${nameOf(s.trainerId, s.trainerName)}, ${timeOf(s.startsAt)} to ${timeOf(s.endsAt)}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, opacity: pulled ? 0.5 : 1 }}>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3, width: 92 }}>
                      {timeOf(s.startsAt)}–{timeOf(s.endsAt)}
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
              <SectionHead title="Hours per trainer" />
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
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter }}>
            <Text style={{ ...ty.head, color: t.ink }}>Add a shift</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
              One row per block on the floor. Shifts are written for this week only — cover and
              swaps are edits to a single day, not to a pattern.
            </Text>

            <Text style={lab}>Trainer</Text>
            {trainers === null ? (
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
                <TextInput value={from} onChangeText={setFrom} keyboardType="numeric" maxLength={2}
                  style={inp} accessibilityLabel="Start hour" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={lab}>Finishes (hour)</Text>
                <TextInput value={to} onChangeText={setTo} keyboardType="numeric" maxLength={2}
                  returnKeyType="done" onSubmitEditing={() => { void commitAdd(); }}
                  style={inp} accessibilityLabel="Finish hour" />
              </View>
            </View>

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
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
