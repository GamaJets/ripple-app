// Client · Reminders. The nudges a member sets for themselves: hydration
// through the day, training, weigh-in, progress photo, and anything else they
// name — each on the days they choose.
//
// ── What this screen used to be, and the three gaps ────────────────────────
//
// Hydration and supplements, daily only, scheduled once at the moment Save was
// pressed:
//
//   · NO TRAINING, WEIGH-IN OR PHOTO REMINDER. The three things the product
//     actually has an opinion about, and a member had to type them in as
//     "supplements" to get any of them.
//   · DAILY ONLY. Somebody training Monday, Wednesday and Friday was nudged on
//     the four days they were not, or not at all.
//   · SCHEDULED ONLY ON SAVE. The screen said so about itself, and the
//     consequence was that reminders saved before the notifications build
//     existed were never scheduled by the build that could — see the header of
//     src/ui/reminderSync.tsx, which now reschedules them at every launch.
//
// What each setting SCHEDULES is decided in src/lib/reminderPlan.ts, which is
// pure and tested, and the save handler and the launch-time resync both read
// it — so the count this screen reports and the reminders that exist cannot
// drift apart.
//
// Re-skinned onto the kit (`src/ui/kit`) + scale (`src/theme/scale`): two
// bordered boxes became hairline-separated sections, the "not on this build
// yet" banner became the screen's one <Notice>. Hooks, state, scheduling and
// persistence are unchanged.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Cta, Ghost, Field } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { pushAvailable } from '../../src/ui/pushNotifications';
import { REMINDERS_KEY as KEY, rescheduleReminders } from '../../src/ui/reminderSync';
import {
  DAY_LABEL, EVERY_DAY, FIXED_LABEL, daysLabel, plannedNotificationCount,
  plannedReminders, savedFromStored,
  type CustomReminder, type FixedKind, type FixedReminder, type SavedReminders, type Weekday,
} from '../../src/lib/reminderPlan';
import { jsDayForIndex } from '../../src/lib/weekStart';
// The slop that brings a small control up to 44pt. See the Remove button on
// each of the member's own reminders.
import { hitSlopFor } from '../../src/lib/a11y';
import { movedNote } from '../../src/lib/notifyPrefs';
import { useNotifyPrefs } from '../../src/ui/notifyPrefs';
import { BACK_ICON, FORWARD_ICON } from '../../src/ui/direction';

const two = (n: number) => String(n).padStart(2, '0');
const fmt = (h: number, m: number) => `${two(((h + 11) % 12) + 1)}:${two(m)} ${h < 12 ? 'AM' : 'PM'}`;
const newId = () => 'r_' + Math.random().toString(36).slice(2, 8);

export default function Reminders() {
  const t = useTheme();
  const router = useRouter();
  // The member's own quiet hours, so this screen can say when a time it is
  // being given will not be the time the reminder arrives.
  const notify = useNotifyPrefs();
  const [hydration, setHydration] = useState(true);
  const [every, setEvery] = useState(3);      // hours between hydration nudges
  const [startH, setStartH] = useState(9);
  const [endH, setEndH] = useState(21);
  const [hydrationDays, setHydrationDays] = useState<Weekday[]>([...EVERY_DAY]);
  const [supps, setSupps] = useState<CustomReminder[]>([]);
  const [fixed, setFixed] = useState<Partial<Record<FixedKind, FixedReminder>>>({});
  const [ids, setIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [sh, setSh] = useState('08');
  const [sm, setSm] = useState('00');

  // Through `savedFromStored`, not a bare JSON.parse. That function migrates
  // the older shape — which had no day lists at all — by reading an ABSENT list
  // as every day. Parsing the blob here by hand would read it as no days and
  // silently switch off every reminder every existing member has set.
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((r) => {
      const p = savedFromStored(r);
      setHydration(p.hydration); setEvery(p.every); setStartH(p.startH); setEndH(p.endH);
      setHydrationDays(p.hydrationDays); setSupps(p.supps); setFixed(p.fixed); setIds(p.ids);
    }).catch(() => { /* the defaults stand, and nothing is scheduled from them */ });
  }, []);

  /** The settings as they stand, in the shape the plan and the store both take. */
  const current = (): SavedReminders => ({ hydration, every, startH, endH, hydrationDays, supps, fixed, ids });

  const addSupp = () => {
    const nm = name.trim(); const h = parseInt(sh, 10); const m = parseInt(sm, 10);
    if (!nm) { Alert.alert('Name it', 'Give the supplement or reminder a name.'); return; }
    if (isNaN(h) || h < 0 || h > 23 || isNaN(m) || m < 0 || m > 59) { Alert.alert('Check the time', 'Use 24-hour time — 08:00 is eight in the morning, 20:00 is eight in the evening.'); return; }
    // Every day unless they say otherwise, because that is what this control
    // did before day pickers existed and changing the default silently would
    // change what "Add Reminder" means for everybody who already knows it.
    setSupps((p) => [...p, { id: newId(), name: nm, hour: h, minute: m, days: [...EVERY_DAY] }]);
    setName(''); setSh('08'); setSm('00');
  };
  const removeSupp = (id: string) => setSupps((p) => p.filter((x) => x.id !== id));

  /** Toggle one day on one reminder. Shared by every day picker on the screen. */
  const toggleDay = (days: readonly Weekday[], d: Weekday): Weekday[] =>
    (days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b));

  const setFixedFor = (k: FixedKind, patch: Partial<FixedReminder>) =>
    setFixed((p) => {
      // 18:00 every day is the shape a new one starts in, and it is a starting
      // point rather than a claim: the row is OFF until the member switches it
      // on, so no reminder is ever scheduled at an hour nobody chose.
      const cur = p[k] ?? { on: false, hour: k === 'weighin' ? 7 : 18, minute: 0, days: [...EVERY_DAY] };
      return { ...p, [k]: { ...cur, ...patch } };
    });

  /** The day picker, used by hydration, all three fixed kinds and every custom
   *  reminder — one control, so seven abbreviations cannot come to mean seven
   *  different things in four places. */
  const DayPicker = ({ days, onToggle, label }: { days: readonly Weekday[]; onToggle: (d: Weekday) => void; label: string }) => (
    <View style={{ flexDirection: 'row', gap: 5, marginTop: sp.sm }}>
      {/* Drawn in the order src/lib/weekStart.ts opens a week. The underlying
          numbering starts at Sunday because that is what expo-notifications
          wants, and that is not the member's problem — see reminderPlan.ts,
          whose `daysLabel` reads the same order back. */}
      {(Array.from({ length: 7 }, (_, i) => (jsDayForIndex(i) + 1) as Weekday)).map((d) => {
        const on = days.includes(d);
        return (
          <Pressable key={d} onPress={() => onToggle(d)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${label}, ${DAY_LABEL[d]}`}
            hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
            style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
            <Text style={{ ...ty.caption, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink3 }}>{DAY_LABEL[d].slice(0, 1)}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const saveAndSchedule = async () => {
    // Stored FIRST, then scheduled from what was stored.
    //
    // The order is the whole point. `rescheduleReminders` reads the saved blob,
    // cancels the ids it names, schedules the plan and writes the new ids back
    // — which is exactly what runs at every launch, so the two paths cannot
    // schedule different things. The previous version scheduled from local
    // state and then wrote the result, which is how the screen came to be the
    // only thing in the app that could ever arm a reminder.
    const saved = current();
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      Alert.alert('Not saved', 'Your reminder settings could not be stored on this phone, so nothing was scheduled and nothing was changed. Try again in a moment.');
      return;
    }

    const plan = plannedReminders(saved);
    const wanted = plannedNotificationCount(plan);
    const { scheduled } = await rescheduleReminders();
    // Re-read so the ids this screen holds are the ones now scheduled;
    // otherwise the next Save cancels a stale set and leaves the live one
    // firing forever with nothing on any screen to explain it.
    try {
      const raw = await AsyncStorage.getItem(KEY);
      setIds(savedFromStored(raw).ids);
    } catch { /* the next launch's resync will correct it */ }

    // `scheduled` is the only thing here that knows what actually happened.
    // `pushAvailable()` answers whether the notifications MODULE is in this
    // build and says nothing about whether the member granted permission — so
    // somebody who had declined was previously shown the title "Reminders set"
    // above the body "You'll get 0 daily reminders", a title and a count that
    // contradict each other over nothing being scheduled at all.
    if (!pushAvailable()) {
      Alert.alert('Settings saved, nothing scheduled yet',
        'This build cannot schedule notifications, so no reminder has been set. Your settings are kept and will be scheduled on their own once notifications are working — you do not have to come back to this screen.');
      return;
    }
    if (scheduled === 0) {
      Alert.alert(
        wanted === 0 ? 'Saved' : 'Saved, but nothing will be sent',
        wanted === 0
          ? 'No reminders are set. Turn one on, or add your own, and it will be scheduled.'
          : 'Your settings are saved, but this phone is not allowing notifications from us, so nothing was scheduled. Turn them on for this app in your phone’s Settings — they will be scheduled the next time you open the app, without coming back here.',
      );
      return;
    }
    Alert.alert('Reminders set',
      `${plan.length} reminder${plan.length === 1 ? '' : 's'}, ${scheduled} notification${scheduled === 1 ? '' : 's'} a week.`
      + (scheduled < wanted ? ` ${wanted - scheduled} could not be scheduled.` : ''));
  };

  // Which of the three is chosen is drawn as a fill and a half-step of weight.
  // accessibilityState carries the same fact to VoiceOver, which otherwise
  // hears "2 hours, 3 hours, 4 hours" and no indication of which one is set.
  const seg = (val: number, cur: number, set: (n: number) => void, label: string) => (
    <Pressable onPress={() => set(val)}
      accessibilityRole="radio" accessibilityState={{ selected: cur === val }}
      style={{ flex: 1, paddingVertical: sp.md, borderRadius: radius.sm, alignItems: 'center', backgroundColor: cur === val ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: cur === val ? '600' : '500', color: cur === val ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
  // What the hour and minute boxes will actually schedule, in the 12-hour form
  // most people think in.
  //
  // ── Why an echo rather than an am/pm control ──────────────────────────────
  //
  // The obvious alternative is to drop the 24-hour clock and offer AM/PM. It was
  // not taken: every reminder in this file is scheduled on a 0–23 hour, the
  // validation below is written in those terms, and an extra segmented control
  // is one more thing that can be left on the wrong setting — a mis-set toggle
  // reads exactly as right as a correct one. An echo cannot be mis-set. It
  // states the consequence of what is already typed, before the reminder is
  // created, which is the moment the ambiguity is still free to fix.
  const suppH = parseInt(sh, 10);
  const suppM = parseInt(sm, 10);
  // Deliberately the same bounds as addSupp's refusal, so the sentence on screen
  // and the alert cannot disagree about what counts as a time.
  const suppOk = !isNaN(suppH) && suppH >= 0 && suppH <= 23 && !isNaN(suppM) && suppM >= 0 && suppM <= 59;
  const suppEcho = suppOk
    ? `Reminds you every day at ${fmt(suppH, suppM)}.`
    : 'Use a 24-hour time — 20:30 is half past eight in the evening.';
  // ── the other half of the echo ─────────────────────────────────────────
  //
  // The echo above says what was typed. It said nothing about what will
  // actually be scheduled, and those are not the same time: every reminder here
  // is 'reminders', which is quietable, so a time inside the member's own quiet
  // hours is MOVED. Somebody who set a supplement reminder for 11pm saw 11pm
  // echoed back beside the box and found out it was a morning reminder by never
  // being reminded at night. The only mention of quiet hours on this screen was
  // a link at the bottom.
  const movedFor = (h: number, m: number) => movedNote(h, m, 'reminders', notify.prefs, fmt);
  const suppMoved = suppOk ? movedFor(suppH, suppM) : null;
  const num = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, width: 54, textAlign: 'center' } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Daily</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Reminders</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }}>Gentle daily nudges for hydration and supplements.</Text>

        {!pushAvailable() ? (
          <Notice kicker="Not sending yet" title="Nothing can be scheduled on this build"
            note="You can set your reminders up here and they are kept. They will be scheduled on their own once notifications are working — you do not have to come back to this screen." />
        ) : null}

        <Rule />

        {/* Hydration */}
        <Section>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: hydration ? sp.lg : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Icon name="water" size={17} color={t.brand} />
              <Text style={{ ...ty.head, color: t.ink }}>Hydration nudges</Text>
            </View>
            {/* A switch, announced as one. It was an unnamed button whose state
                was a dot's position and a track colour — nothing a screen
                reader gets, and 48 × 28 is under the 44pt minimum besides. */}
            <Pressable onPress={() => setHydration((v) => !v)}
              accessibilityRole="switch"
              accessibilityLabel="Hydration nudges"
              accessibilityState={{ checked: hydration }}
              hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
              style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: hydration ? t.brand : t.surface3, justifyContent: 'center', paddingHorizontal: 3 }}>
              <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: hydration ? 'flex-end' : 'flex-start' }} />
            </Pressable>
          </View>
          {hydration ? (
            <View>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>Every</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>{seg(2, every, setEvery, '2 hours')}{seg(3, every, setEvery, '3 hours')}{seg(4, every, setEvery, '4 hours')}</View>
              {/* Two bare boxes reading [9] to [21] under the word "Between".
                  Nothing said they were hours, and nothing said they were a
                  24-hour clock — so somebody who wants nudges until nine in the
                  evening types 9 and switches them off for the whole afternoon.
                  The labels stay put (a placeholder would not), the hint names
                  the clock, and the sentence beside them says the same times
                  back in the 12-hour form most people think in. */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.sm }}>
                <Field label="From" hint="24h" style={{ flex: 0 }} a11y="First nudge, hour on a 24-hour clock">
                  <TextInput value={String(startH)} onChangeText={(x) => setStartH(Math.min(23, Math.max(0, parseInt(x, 10) || 0)))} keyboardType="number-pad" style={num} />
                </Field>
                <Text style={{ ...ty.label, color: t.ink3, paddingBottom: 13 }}>to</Text>
                <Field label="To" hint="24h" style={{ flex: 0 }} a11y="Last nudge, hour on a 24-hour clock">
                  <TextInput value={String(endH)} onChangeText={(x) => setEndH(Math.min(23, Math.max(0, parseInt(x, 10) || 0)))} keyboardType="number-pad" style={num} />
                </Field>
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3, flex: 1, paddingBottom: 13 }}>{fmt(startH, 0)} – {fmt(endH, 0)}</Text>
              </View>
              {/* The scheduling loop below counts UP from the first hour to the
                  last, so a window that ends before it starts silently produces
                  no nudges at all — and the save then reports "0 reminders" in
                  the same breath as the window it did not honour. Said here,
                  while it can still be corrected. */}
              {startH > endH ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.sm }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                  <Text style={{ ...ty.caption, color: t.ink2 }}>No nudges yet — the last hour is earlier in the day than the first.</Text>
                </View>
              ) : null}
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg }}>On these days · {daysLabel(hydrationDays)}</Text>
              <DayPicker days={hydrationDays} label="Hydration nudges" onToggle={(d) => setHydrationDays((p) => toggleDay(p, d))} />
              {hydrationDays.length === 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.sm }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                  <Text style={{ ...ty.caption, color: t.ink2 }}>No days chosen, so nothing will be sent.</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* ── Training, weigh-in, progress photo ────────────────────────────
            The three the product has an opinion about, and the three a member
            previously had to type in as "supplements" to get at all. Each is
            OFF until switched on, so no reminder is ever scheduled at an hour
            nobody chose — the same rule that keeps the app from inventing a
            step goal or a water target. */}
        <Section>
          <SectionHead title="Training And Body" />
          {(['training', 'weighin', 'photo'] as FixedKind[]).map((k, i) => {
            const f = fixed[k] ?? { on: false, hour: k === 'weighin' ? 7 : 18, minute: 0, days: [...EVERY_DAY] };
            const label = k === 'training' ? 'Train Today' : k === 'weighin' ? 'Weigh In' : 'Progress Photo';
            const why = k === 'training'
              ? 'A nudge on the days you plan to train.'
              : k === 'weighin'
                ? 'One reading a week is enough to see a trend.'
                : 'Same spot, same light, same time of day.';
            return (
              <View key={k} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{label}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {f.on ? `${fmt(f.hour, f.minute)} · ${daysLabel(f.days)}` : why}
                    </Text>
                  </View>
                  <Pressable onPress={() => setFixedFor(k, { on: !f.on })}
                    accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: f.on }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
                    style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: f.on ? t.brand : t.surface3, justifyContent: 'center', paddingHorizontal: 3 }}>
                    <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: f.on ? 'flex-end' : 'flex-start' }} />
                  </Pressable>
                </View>
                {f.on ? (
                  <View style={{ marginTop: sp.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.sm }}>
                      <Field label="Hour" hint="24h" style={{ flex: 0 }} a11y={`${label}, hour on a 24-hour clock`}>
                        <TextInput value={String(f.hour)} onChangeText={(x) => setFixedFor(k, { hour: Math.min(23, Math.max(0, parseInt(x, 10) || 0)) })} keyboardType="number-pad" style={num} />
                      </Field>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink3, paddingBottom: 13 }}>:</Text>
                      <Field label="Min" style={{ flex: 0 }} a11y={`${label}, minutes past the hour`}>
                        <TextInput value={two(f.minute)} onChangeText={(x) => setFixedFor(k, { minute: Math.min(59, Math.max(0, parseInt(x, 10) || 0)) })} keyboardType="number-pad" style={num} />
                      </Field>
                      {/* The same echo the hydration hours have, for the same
                          reason: somebody who wants a reminder at eight in the
                          evening types 8 and is woken by it otherwise. */}
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, flex: 1, paddingBottom: 13 }}>{fmt(f.hour, f.minute)}</Text>
                    </View>
                    {movedFor(f.hour, f.minute) ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{movedFor(f.hour, f.minute)}</Text>
                    ) : null}
                    <DayPicker days={f.days} label={label} onToggle={(d) => setFixedFor(k, { days: toggleDay(f.days, d) })} />
                    {f.days.length === 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.sm }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                        <Text style={{ ...ty.caption, color: t.ink2 }}>No days chosen, so nothing will be sent.</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </Section>

        <Rule />

        {/* Supplements */}
        <Section>
          <SectionHead title="Your Own Reminders" note={supps.length ? String(supps.length) : undefined} />
          {supps.map((s, i) => (
            <View key={s.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, color: t.ink2 }}>{s.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{daysLabel(s.days)}</Text>
                </View>
                <Text style={{ ...ty.label, ...numeric, fontWeight: '600', color: t.ink, marginEnd: sp.md }}>{fmt(s.hour, s.minute)}</Text>
                {/* 16pt of glyph with `hitSlop={6}` is a 28pt target — the
                    smallest control on this screen, and the only destructive
                    one on it. The two switches above it are 48 × 28 and each
                    carries 8pt of slop for the same reason; this one was left
                    at 6, which does not even reach what they reach.
                    `hitSlopFor` takes a 16pt icon to the 44pt in
                    src/lib/a11y.ts without moving anything on the row, which
                    matters here because the row's time sits immediately to its
                    left. */}
                <Pressable accessibilityLabel={`Remove ${s.name}`} accessibilityRole="button" onPress={() => removeSupp(s.id)} hitSlop={hitSlopFor(16)}><Icon name="minus" size={16} color={t.ink3} /></Pressable>
              </View>
              <DayPicker days={s.days} label={s.name} onToggle={(d) => setSupps((p) => p.map((x) => (x.id === s.id ? { ...x, days: toggleDay(x.days, d) } : x)))} />
            </View>
          ))}
          {/* [08]:[00] beside a name, with nothing saying which clock. This is
              the one that actually costs something: the hydration hours have
              always had their times echoed back beside them and this row had
              nothing — so somebody adding a magnesium reminder for eight in the
              evening types 8, gets 08:00, and is woken by it instead. The
              labels stay put where the placeholders did not, and the line below
              says what is about to be scheduled before it is. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.sm, marginTop: sp.md }}>
            <Field label="Name">
              <TextInput value={name} onChangeText={setName} placeholder="e.g. Creatine" placeholderTextColor={t.ink3}
                style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }} />
            </Field>
            <Field label="Hour" hint="24h" style={{ flex: 0 }} a11y="Hour on a 24-hour clock">
              <TextInput value={sh} onChangeText={setSh} keyboardType="number-pad" style={num} />
            </Field>
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink3, paddingBottom: 13 }}>:</Text>
            <Field label="Min" style={{ flex: 0 }} a11y="Minutes past the hour">
              <TextInput value={sm} onChangeText={setSm} keyboardType="number-pad" style={num} />
            </Field>
          </View>
          <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 6 }}>{suppEcho}</Text>
          {suppMoved ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{suppMoved}</Text> : null}
          <View style={{ marginTop: sp.md, alignItems: 'flex-start' }}>
            <Ghost label="Add Reminder" icon="plus" onPress={addSupp} />
          </View>
        </Section>

        <Rule />

        <Rule />

        {/* The other half of the same subject. This screen decides WHAT gets
            sent and when; that one decides which kinds reach you at all, and
            holds the quiet hours these reminders are moved out of. It is also
            the only route to that screen, so a member who wants a 3am nudge to
            stop has somewhere to go from the screen they set it on. */}
        <Section>
          <Pressable onPress={() => router.push('/(client)/notification-prefs')}
            accessibilityRole="button" accessibilityLabel="Notification settings and quiet hours"
            style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Notification Settings</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Which kinds of notification reach you, and the hours to hold them until.</Text>
            </View>
            <Icon name={FORWARD_ICON} size={14} color={t.ink3} />
          </Pressable>
        </Section>

        <View style={{ marginTop: layout.section }}>
          <Cta label="Save & Schedule" onPress={saveAndSchedule} wide />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
