// Trainer · Schedule — month calendar of sessions with add & cancel.
// Reads/writes the shared session store so booked/open slots and cancellations
// stay in sync with the client app. Adding a slot that overlaps an existing one
// is rejected (no double-booking). Cancelling a booked session frees the slot
// and re-offers it to the coach's other clients.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same store, same routes, same alerts, same modals — only
// the presentation changed: the two stat tiles and the Georgia serif header
// became one hero figure, the six bordered cards became hairline-separated
// sections, and the day grid now reads through weight and the accent rather
// than through boxes and 800-weight text.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Modal } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, ListRow, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric } from '../../src/theme/scale';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { cancelSession } from '../../src/lib/booking';
import { useSessions } from '../../src/ui/sessions';
import { useAvailability, upcomingDates } from '../../src/ui/availability';
import { useRoster } from '../../src/ui/roster';
import type { TrainingSession } from '../../src/lib/types';
import { buildIcs, shareIcs } from '../../src/lib/exportShare';
import { sendPush } from '../../src/ui/pushNotifications';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function timeLabel(iso: string) {
  const d = new Date(iso); let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  const m = d.getMinutes(); return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
}

/**
 * A selectable pill. Takes the theme as a prop rather than calling useTheme —
 * the screen's hook order is part of its contract.
 */
function Chip({ t, label, on, onPress }: { t: Theme; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: on ? '500' : '400', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
}

let SEQ = 5000;

export default function TrainerSchedule() {
  const t = useTheme();
  const now = new Date();
  const router = useRouter();
  const { sessions, addSession, releaseSession, removeSession } = useSessions();
  const { roster } = useRoster();
  const { sessionFee } = useMyTrainerProfile();
  const nameOf = (id: string | null) => roster.find((c) => c.id === id)?.name ?? 'Open slot';
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selKey, setSelKey] = useState(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`);
  const [addOpen, setAddOpen] = useState(false);
  const [addHour, setAddHour] = useState(9);
  const [addDur, setAddDur] = useState(60);
  const [addClient, setAddClient] = useState<string | null>(null);
  const { slots: availSlots, addSlot: addAvail, removeSlot: removeAvail } = useAvailability();
  const [availOpen, setAvailOpen] = useState(false);
  const [avDow, setAvDow] = useState(1);
  const [avHour, setAvHour] = useState(9);
  const generateSlots = () => {
    if (!availSlots.length) { Alert.alert('No availability set', 'Add at least one weekly slot first.'); return; }
    let added = 0;
    for (const sl of availSlots) {
      for (const d of upcomingDates(sl.dow, sl.hour, 4)) {
        const ses: TrainingSession = { id: 'ms' + (SEQ++), trainerId: '', clientId: null, startsAt: d.toISOString(), durationMin: sl.dur, status: 'available', released: false };
        if (addSession(ses).ok) added++;
      }
    }
    setAvailOpen(false);
    Alert.alert('Slots generated', added + ' open slot' + (added === 1 ? '' : 's') + ' added across the next 4 weeks (existing/overlapping times were skipped).');
  };

  const booked = sessions.filter((s) => s.status === 'booked');
  const open = sessions.filter((s) => s.status === 'available');

  const byDay = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    const k = dayKey(s.startsAt);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(s);
  }

  const first = new Date(viewYear, viewMonth, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const selDaySessions = (byDay.get(selKey) ?? []).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const [selY, selM, selD] = selKey.split('-').map(Number);
  const selDate = new Date(selY, selM, selD);

  function shiftMonth(delta: number) {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  }

  function handleAdd() {
    const d = new Date(selY, selM, selD); d.setHours(addHour, 0, 0, 0);
    const s: TrainingSession = {
      id: `ms${SEQ++}`, trainerId: '', clientId: addClient,
      startsAt: d.toISOString(), durationMin: addDur,
      status: addClient ? 'booked' : 'available', released: false,
    };
    const res = addSession(s);
    if (!res.ok) {
      Alert.alert('Time not available', `You already have a session that overlaps ${timeLabel(s.startsAt)} on ${DOW[selDate.getDay()]} ${selD}/${selM + 1}. Pick another time.`, [{ text: 'OK' }]);
      return;
    }
    setAddOpen(false);
    if (addClient) {
      sendPush([addClient], 'Session booked', `Your session on ${DOW[selDate.getDay()]} at ${timeLabel(s.startsAt)} is confirmed.`, { route: '/(client)/calendar' });
      Alert.alert('Session booked', `${timeLabel(s.startsAt)} with ${nameOf(addClient)} confirmed.\n\nA notification was sent to ${nameOf(addClient)} — they will see it if they have notifications on.`, [{ text: 'Great' }]);
    }
  }

  function doCancel(s: TrainingSession) {
    const others = roster.filter((c) => c.id !== s.clientId).map((c) => c.name);
    // `cancelSession` prices the late-cancel from a plain number, so a rate that
    // is not known is passed as 0 and the resulting `feeAmount` is not printed —
    // the sentence below drops out entirely. Quoting "$0" here would be the same
    // fabrication the client app was making: a figure about money, on the screen
    // where somebody decides whether a cancellation costs anything.
    const res = cancelSession(s, sessionFee ?? 0, roster.map((c) => c.id));
    releaseSession(s.id);
    if (s.clientId) sendPush([s.clientId], 'Session cancelled', `Your ${timeLabel(s.startsAt)} session on ${DOW[new Date(s.startsAt).getDay()]} was cancelled.`, { route: '/(client)/calendar' });
    const _openTo = roster.filter((c) => c.id !== s.clientId).map((c) => c.id);
    if (_openTo.length) sendPush(_openTo, 'A slot just opened', `${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]} is available — first to book it gets it.`, { route: '/(client)/calendar' });
    Alert.alert(
      'Session cancelled',
      `${timeLabel(s.startsAt)} with ${nameOf(s.clientId)} was cancelled.\n\n` +
      `${nameOf(s.clientId)} was sent a notification. The slot is open again and ${others.length} other client${others.length === 1 ? '' : 's'} can book it (${others.slice(0, 3).join(', ')}${others.length > 3 ? '…' : ''}) — first to book takes it.` +
      // Repple does not charge anything. This used to say the fee "applies",
      // which described a charge that no code anywhere makes. It also printed
      // the rate with no dollar sign in front of it, and printed it whatever it
      // was — including the 0 that stood in for "not loaded".
      (res.charged
        ? (sessionFee == null
          ? '\n\nInside 24h — your late-cancel policy would apply. Repple does not charge it; settle it with the client yourself.'
          : `\n\nInside 24h — your $${sessionFee} late-cancel policy would apply. Repple does not charge it; settle it with the client yourself.`)
        : ''),
      [{ text: 'Done' }]
    );
  }
  function confirmCancel(s: TrainingSession) {
    Alert.alert('Cancel this session?', `${timeLabel(s.startsAt)} with ${nameOf(s.clientId)} on ${DOW[selDate.getDay()]} ${selD}/${selM + 1}.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel session', style: 'destructive', onPress: () => doCancel(s) },
    ]);
  }
  function removeOpen(s: TrainingSession) {
    Alert.alert('Remove open slot?', `${timeLabel(s.startsAt)} is currently open. Remove it from your availability?`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeSession(s.id) },
    ]);
  }

  function reoffer(s: TrainingSession) {
    const ids = roster.map((c) => c.id);
    Alert.alert('Re-offer this slot?', `Push all ${ids.length} of your clients that ${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]} is open to book.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: `Notify ${ids.length}`, onPress: () => {
        if (ids.length) sendPush(ids, 'A slot just opened', `${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]} is available — first to book it gets it.`, { route: '/(client)/calendar' });
        Alert.alert('Slot re-opened', `Notified ${ids.length} client${ids.length === 1 ? '' : 's'} — delivery depends on their notification settings.`);
      } },
    ]);
  }

  const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20];
  const DURS = [30, 45, 60, 90];

  const G = layout.gutter;
  const totalSlots = booked.length + open.length;
  const exportSchedule = async () => {
    const evts = booked.map((s) => ({ start: s.startsAt, durationMin: s.durationMin, title: `Session · ${nameOf(s.clientId)}` }));
    await shareIcs(buildIcs(evts, 'Repple — Coaching schedule'), 'repple-schedule.ics', 'Export your schedule');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your coaching week</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Schedule</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>Tap a day to see sessions · add or cancel any time</Text>
        </View>

        {/* ── the hero: how much of the schedule is spoken for ────────────── */}
        <Hero
          label="Booked"
          figure={fig(booked.length)}
          unit={booked.length === 1 ? 'session' : 'sessions'}
          note={totalSlots === 0
            ? 'Nothing scheduled yet — add a session or set your weekly availability.'
            : `${open.length} open slot${open.length === 1 ? '' : 's'} · ${Math.round((booked.length / totalSlots) * 100)}% of your slots are filled`}
          arc={totalSlots ? booked.length / totalSlots : undefined}
        />

        <Rule />

        {/* ── the things you do from here ─────────────────────────────────── */}
        <Section>
          <SectionHead title="Manage" />
          <ListRow icon="plus" title="Add a session"
            note={`Book a client or open a slot on ${DOW[selDate.getDay()]} ${selD} ${MON[selM].slice(0, 3)}`}
            onPress={() => { setAddClient(null); setAddOpen(true); }} />
          <ListRow icon="clock" title="Weekly availability"
            note={availSlots.length
              ? `${availSlots.length} weekly slot${availSlots.length === 1 ? '' : 's'} · generate the next 4 weeks`
              : 'Set the times you offer every week'}
            onPress={() => setAvailOpen(true)} />
          <ListRow icon="people" title="Group classes" note="Schedule & fill classes across branches"
            onPress={() => router.push('/(trainer)/classes')} />
          {booked.length > 0 ? (
            <ListRow icon="share" title="Export schedule" note="Send your booked sessions to your calendar app"
              onPress={exportSchedule} />
          ) : null}
        </Section>

        <Rule />

        {/* ── month grid ─────────────────────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.lg }}>
            <Ghost icon="back" onPress={() => shiftMonth(-1)} />
            <Text style={{ ...ty.head, color: t.ink }}>{MON[viewMonth]} {viewYear}</Text>
            <Ghost icon="chevron" onPress={() => shiftMonth(1)} />
          </View>

          <View style={{ flexDirection: 'row', marginBottom: sp.sm }}>
            {DOW.map((d) => <Text key={d} style={{ ...ty.micro, flex: 1, textAlign: 'center', color: t.ink3 }}>{d[0]}</Text>)}
          </View>

          {Array.from({ length: cells.length / 7 }).map((_, row) => (
            <View key={row} style={{ flexDirection: 'row' }}>
              {cells.slice(row * 7, row * 7 + 7).map((d, i) => {
                if (d == null) return <View key={i} style={{ flex: 1, aspectRatio: 1 }} />;
                const k = `${viewYear}-${viewMonth}-${d}`;
                const daySess = byDay.get(k) ?? [];
                const isSel = k === selKey;
                const isToday = k === todayKey;
                const hasBooked = daySess.some((s) => s.status === 'booked');
                const hasOpen = daySess.some((s) => s.status === 'available');
                return (
                  <Pressable key={i} onPress={() => setSelKey(k)} accessibilityRole="button" accessibilityState={{ selected: isSel }}
                    style={{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                    {/* Selected reads as the accent; today reads as weight and
                        accent ink — no border pretending to be a state. */}
                    <View style={{ width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? t.brand : 'transparent' }}>
                      <Text style={{
                        ...ty.body, ...numeric,
                        fontWeight: isSel || isToday ? '600' : '400',
                        color: isSel ? t.brandInk : isToday ? t.brand : t.ink2,
                      }}>{d}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 3, height: 6, marginTop: 2 }}>
                      {hasBooked && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.brand }} />}
                      {hasOpen && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.ink3 }} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.md, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
              <Text style={{ ...ty.caption, color: t.ink3 }}>Booked</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink3 }} />
              <Text style={{ ...ty.caption, color: t.ink3 }}>Open</Text>
            </View>
          </View>
        </Section>

        <Rule />

        {/* ── the selected day ───────────────────────────────────────────── */}
        <Section>
          <SectionHead title={`${DOW[selDate.getDay()]} ${selD} ${MON[selM].slice(0, 3)}`} note="Add"
            onPress={() => { setAddClient(null); setAddOpen(true); }} />

          {selDaySessions.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No sessions this day. Tap Add to book one.</Text>
          ) : selDaySessions.map((s, i) => (
            <View key={s.id}>
              {i > 0 ? <Rule /> : null}
              <View style={{ paddingVertical: sp.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.status === 'booked' ? t.brand : t.surface3 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{timeLabel(s.startsAt)} · {s.durationMin} min</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.status === 'booked' ? nameOf(s.clientId) : (s.released ? 'Open · re-offered' : 'Open slot')}</Text>
                    {s.approvedAt ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.good }} />
                        <Text style={{ ...ty.caption, color: t.ink3 }}>Confirmed by client</Text>
                      </View>
                    ) : null}
                    {s.approvalNote ? (
                      <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>“{s.approvalNote}”</Text>
                    ) : null}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, marginLeft: sp.md + 6 }}>
                  {s.status === 'booked' ? (
                    <Ghost label="Cancel" onPress={() => confirmCancel(s)} />
                  ) : (<>
                    <View style={{ flex: 1 }}><Ghost label="Re-offer" onPress={() => reoffer(s)} /></View>
                    <View style={{ flex: 1 }}><Ghost label="Remove" onPress={() => removeOpen(s)} /></View>
                  </>)}
                </View>
              </View>
            </View>
          ))}
        </Section>

      </ScrollView>

      {/* ── weekly availability sheet ─────────────────────────────────────── */}
      <Modal visible={availOpen} animationType="slide" transparent onRequestClose={() => setAvailOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAvailOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '82%', ...elevation.e2 }}>
          <Text style={{ ...ty.head, color: t.ink }}>Weekly availability</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.md }}>Set the times you offer every week, then generate open slots.</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {availSlots.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>No weekly slots yet.</Text>
            ) : availSlots.map((sl, i) => (
              <View key={sl.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <Icon name="clock" size={16} color={t.brand} />
                  <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink, flex: 1 }}>{DOW[sl.dow]} · {sl.hour % 12 || 12}{sl.hour >= 12 ? 'pm' : 'am'} · {sl.dur}min</Text>
                  <Pressable onPress={() => removeAvail(sl.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${DOW[sl.dow]} slot`}>
                    <Icon name="minus" size={16} color={t.ink3} />
                  </Pressable>
                </View>
              </View>
            ))}

            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.md }}>Add a weekly slot</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
              {DOW.map((d, i) => <Chip key={d} t={t} label={d} on={avDow === i} onPress={() => setAvDow(i)} />)}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
              {[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map((h) => (
                <Chip key={h} t={t} label={`${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`} on={avHour === h} onPress={() => setAvHour(h)} />
              ))}
            </ScrollView>
            <Ghost label={`Add ${DOW[avDow]} ${avHour % 12 || 12}${avHour >= 12 ? 'pm' : 'am'}`} icon="plus" onPress={() => addAvail(avDow, avHour, 60)} />
          </ScrollView>
          <View style={{ height: sp.lg }} />
          <Cta label="Generate Open Slots · Next 4 Weeks" wide onPress={generateSlots} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Done" onPress={() => setAvailOpen(false)} />
        </View>
      </Modal>

      {/* ── add-session sheet ─────────────────────────────────────────────── */}
      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 34, ...elevation.e2 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.surface3, alignSelf: 'center', marginBottom: sp.lg }} />
            <Text style={{ ...ty.head, color: t.ink }}>Add Session</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>{DOW[selDate.getDay()]}, {MON[selM]} {selD}</Text>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Time</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.lg }}>
              {HOURS.map((h) => {
                const sel = h === addHour; const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12;
                return <Chip key={h} t={t} label={`${hh}${ap}`} on={sel} onPress={() => setAddHour(h)} />;
              })}
            </ScrollView>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Duration</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              {DURS.map((d) => {
                const sel = d === addDur;
                return (
                  <View key={d} style={{ flex: 1 }}>
                    <Pressable onPress={() => setAddDur(d)} accessibilityRole="button" accessibilityState={{ selected: sel }}
                      style={{ paddingVertical: sp.sm, borderRadius: radius.pill, alignItems: 'center', backgroundColor: sel ? t.brand : t.surface2 }}>
                      <Text style={{ ...ty.label, ...numeric, fontWeight: sel ? '500' : '400', color: sel ? t.brandInk : t.ink2 }}>{d}m</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Client</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.xl }}>
              <Chip t={t} label="Open slot" on={addClient === null} onPress={() => setAddClient(null)} />
              {roster.map((c) => <Chip key={c.id} t={t} label={c.name} on={c.id === addClient} onPress={() => setAddClient(c.id)} />)}
            </View>

            <View style={{ flexDirection: 'row', gap: sp.md }}>
              <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => setAddOpen(false)} /></View>
              <View style={{ flex: 2 }}><Cta label={addClient ? 'Book Session' : 'Add Open Slot'} wide onPress={handleAdd} /></View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
