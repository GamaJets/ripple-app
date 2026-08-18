// Trainer · Schedule — month calendar of sessions with add & cancel.
// Reads/writes the shared session store so booked/open slots and cancellations
// stay in sync with the client app. Adding a slot that overlaps an existing one
// is rejected (no double-booking). Cancelling a booked session frees the slot
// and re-offers it to the coach's other clients.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Modal } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useCoachProfile } from '../../src/ui/coachProfile';
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

let SEQ = 5000;

export default function TrainerSchedule() {
  const t = useTheme();
  const now = new Date();
  const router = useRouter();
  const { sessions, addSession, releaseSession, removeSession } = useSessions();
  const { roster } = useRoster();
  const { sessionFee } = useCoachProfile();
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
      Alert.alert('Session booked', `${timeLabel(s.startsAt)} with ${nameOf(addClient)} confirmed.\n\nA confirmation push has been sent to both your app and ${nameOf(addClient)}'s client app.`, [{ text: 'Great' }]);
    }
  }

  function doCancel(s: TrainingSession) {
    const others = roster.filter((c) => c.id !== s.clientId).map((c) => c.name);
    const res = cancelSession(s, sessionFee, roster.map((c) => c.id));
    releaseSession(s.id);
    if (s.clientId) sendPush([s.clientId], 'Session cancelled', `Your ${timeLabel(s.startsAt)} session on ${DOW[new Date(s.startsAt).getDay()]} was cancelled.`, { route: '/(client)/calendar' });
    const _openTo = roster.filter((c) => c.id !== s.clientId).map((c) => c.id);
    if (_openTo.length) sendPush(_openTo, 'A slot just opened', `${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]} is available — first to book it gets it.`, { route: '/(client)/calendar' });
    Alert.alert(
      'Session cancelled',
      `${timeLabel(s.startsAt)} with ${nameOf(s.clientId)} was cancelled.\n\n` +
      `${nameOf(s.clientId)} has been notified. The freed slot was re-offered to ${others.length} other client${others.length === 1 ? '' : 's'} (${others.slice(0, 3).join(', ')}${others.length > 3 ? '…' : ''}) — first to accept books it.` +
      (res.charged ? `\n\nInside 24h: a ${sessionFee} late-cancel fee applies.` : ''),
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
        Alert.alert('Re-offered', `Offered to ${ids.length} client${ids.length === 1 ? '' : 's'}.`);
      } },
    ]);
  }

  const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20];
  const DURS = [30, 45, 60, 90];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Schedule</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Tap a day to see sessions · add or cancel any time</Text>

 {booked.length > 0 ? (
 <Pressable onPress={async () => { const evts = booked.map((s) => ({ start: s.startsAt, durationMin: s.durationMin, title: `Session · ${nameOf(s.clientId)}` })); await shareIcs(buildIcs(evts, 'Repple — Coaching schedule'), 'repple-schedule.ics', 'Export your schedule'); }} accessibilityRole="button" accessibilityLabel="Export your schedule to calendar" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16 }}>
 <Icon name="calendar" size={15} color={t.brand} />
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Export schedule</Text>
 </Pressable>
 ) : null}

 <Pressable onPress={() => router.push('/(trainer)/classes')} accessibilityRole="button" accessibilityLabel="Manage gym classes" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface, borderColor: t.brand, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16 }}>
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
 <Icon name="calendar" size={19} color={t.brand} />
 <View><Text style={{ color: t.ink, fontWeight: '800', fontSize: 14.5 }}>Group classes</Text><Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 1 }}>Schedule & fill classes across branches</Text></View>
 </View>
 <Text style={{ color: t.brand, fontWeight: '800', fontSize: 18 }}>›</Text>
 </Pressable>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: t.brand, borderRadius: 16, padding: 14 }}>
            <Text style={{ color: t.brandInk, fontSize: 12, fontWeight: '700', opacity: 0.85 }}>Booked</Text>
            <Text style={{ color: t.brandInk, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{booked.length}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Open Slots</Text>
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{open.length}</Text>
          </View>
          <Pressable onPress={() => { setAddClient(null); setAddOpen(true); }} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 14, justifyContent: 'center', alignItems: 'center' }}>
            <Icon name="plus" size={20} color={t.brand} />
            <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginTop: 4 }}>Add Session</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => setAvailOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, marginBottom: 16 }}>
          <Icon name="calendar" size={16} color={t.brand} />
          <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13, flex: 1 }}>Weekly availability{availSlots.length ? ' · ' + availSlots.length + ' slot' + (availSlots.length === 1 ? '' : 's') : ''}</Text>
          <Text style={{ color: t.brand, fontWeight: '800', fontSize: 12 }}>Set up ›</Text>
        </Pressable>

        {/* Month calendar */}
        <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={12} style={{ padding: 4 }}><Text style={{ color: t.ink2, fontSize: 20, fontWeight: '800' }}>‹</Text></Pressable>
            <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>{MON[viewMonth]} {viewYear}</Text>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={12} style={{ padding: 4 }}><Text style={{ color: t.ink2, fontSize: 20, fontWeight: '800' }}>›</Text></Pressable>
          </View>
          <View style={{ flexDirection: 'row', marginBottom: 6 }}>
            {DOW.map((d) => <Text key={d} style={{ flex: 1, textAlign: 'center', color: t.ink3, fontSize: 11, fontWeight: '700' }}>{d[0]}</Text>)}
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
                  <Pressable key={i} onPress={() => setSelKey(k)} style={{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? t.brand : 'transparent', borderWidth: isToday && !isSel ? 1 : 0, borderColor: t.brand }}>
                      <Text style={{ color: isSel ? t.brandInk : t.ink, fontSize: 14, fontWeight: isToday || isSel ? '800' : '600' }}>{d}</Text>
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
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 10, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} /><Text style={{ color: t.ink3, fontSize: 11 }}>Booked</Text></View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink3 }} /><Text style={{ color: t.ink3, fontSize: 11 }}>Open</Text></View>
          </View>
        </View>

        {/* Selected day */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{DOW[selDate.getDay()]}, {MON[selM].slice(0, 3)} {selD}</Text>
          <Pressable onPress={() => { setAddClient(null); setAddOpen(true); }} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 12 }}>＋ Add</Text>
          </Pressable>
        </View>

        {selDaySessions.length === 0 ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 22, alignItems: 'center' }}>
            <View style={{ marginBottom: 6 }}><Icon name="calendar" size={26} color={t.ink3} /></View>
            <Text style={{ color: t.ink3, fontSize: 13 }}>No sessions this day. Tap Add to book one.</Text>
          </View>
        ) : selDaySessions.map((s) => (
          <View key={s.id} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 8, height: 44, borderRadius: 4, backgroundColor: s.status === 'booked' ? t.brand : t.surface3 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{timeLabel(s.startsAt)} · {s.durationMin} min</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{s.status === 'booked' ? nameOf(s.clientId) : (s.released ? 'Open · re-offered' : 'Open slot')}</Text>
            </View>
            {s.status === 'booked' ? (
              <Pressable onPress={() => confirmCancel(s)} style={{ borderWidth: 1, borderColor: t.s6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ color: t.s6, fontWeight: '700', fontSize: 12 }}>Cancel</Text>
              </Pressable>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => reoffer(s)} style={{ borderWidth: 1, borderColor: t.brand, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                  <Text style={{ color: t.brand, fontWeight: '700', fontSize: 12 }}>Re-offer</Text>
                </Pressable>
                <Pressable onPress={() => removeOpen(s)} style={{ borderWidth: 1, borderColor: t.ring, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                  <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 12 }}>Remove</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Add-session modal */}
      <Modal visible={availOpen} animationType="slide" transparent onRequestClose={() => setAvailOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAvailOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30, maxHeight: '82%' }}>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>Weekly availability</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 14 }}>Set the times you offer every week, then generate open slots.</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {availSlots.length === 0 ? <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 10 }}>No weekly slots yet.</Text> : availSlots.map((sl) => (
              <View key={sl.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 8 }}>
                <Icon name="calendar" size={16} color={t.brand} />
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, flex: 1 }}>{DOW[sl.dow]} · {sl.hour % 12 || 12}{sl.hour >= 12 ? 'pm' : 'am'} · {sl.dur}min</Text>
                <Pressable onPress={() => removeAvail(sl.id)} hitSlop={8}><Text style={{ color: t.ink3, fontWeight: '800', fontSize: 16 }}>×</Text></Pressable>
              </View>
            ))}
            <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 8 }}>Add a weekly slot</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 8 }}>
              {DOW.map((d, i) => (<Pressable key={d} onPress={() => setAvDow(i)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: avDow === i ? t.brand : t.surface2, borderWidth: 1, borderColor: avDow === i ? t.brand : t.ring }}><Text style={{ color: avDow === i ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{d}</Text></Pressable>))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 12 }}>
              {[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map((h) => (<Pressable key={h} onPress={() => setAvHour(h)} style={{ paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: avHour === h ? t.brand : t.surface2, borderWidth: 1, borderColor: avHour === h ? t.brand : t.ring }}><Text style={{ color: avHour === h ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{h % 12 || 12}{h >= 12 ? 'pm' : 'am'}</Text></Pressable>))}
            </ScrollView>
            <Pressable onPress={() => addAvail(avDow, avHour, 60)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 8 }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 13 }}>+ Add {DOW[avDow]} {avHour % 12 || 12}{avHour >= 12 ? 'pm' : 'am'}</Text></Pressable>
          </ScrollView>
          <Pressable onPress={generateSlots} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Generate open slots · next 4 weeks</Text></Pressable>
          <Pressable onPress={() => setAvailOpen(false)} style={{ paddingVertical: 12, alignItems: 'center' }}><Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Done</Text></Pressable>
        </View>
      </Modal>

      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, borderTopWidth: 1, borderColor: t.ring }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.surface3, alignSelf: 'center', marginBottom: 16 }} />
            <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>Add Session</Text>
            <Text style={{ color: t.ink3, fontSize: 13, marginTop: 3, marginBottom: 16 }}>{DOW[selDate.getDay()]}, {MON[selM]} {selD}</Text>

            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13, marginBottom: 8 }}>Time</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {HOURS.map((h) => {
                  const sel = h === addHour; const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12;
                  return (
                    <Pressable key={h} onPress={() => setAddHour(h)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: sel ? t.brand : t.surface2, borderWidth: 1, borderColor: sel ? t.brand : t.ring }}>
                      <Text style={{ color: sel ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{hh}{ap}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13, marginBottom: 8 }}>Duration</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {DURS.map((d) => {
                const sel = d === addDur;
                return (
                  <Pressable key={d} onPress={() => setAddDur(d)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: sel ? t.brand : t.surface2, borderWidth: 1, borderColor: sel ? t.brand : t.ring }}>
                    <Text style={{ color: sel ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{d}m</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13, marginBottom: 8 }}>Client</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              <Pressable onPress={() => setAddClient(null)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: addClient === null ? t.brand : t.surface2, borderWidth: 1, borderColor: addClient === null ? t.brand : t.ring }}>
                <Text style={{ color: addClient === null ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>Open slot</Text>
              </Pressable>
              {roster.map((c) => {
                const sel = c.id === addClient;
                return (
                  <Pressable key={c.id} onPress={() => setAddClient(c.id)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: sel ? t.brand : t.surface2, borderWidth: 1, borderColor: sel ? t.brand : t.ring }}>
                    <Text style={{ color: sel ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setAddOpen(false)} style={{ flex: 1, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}>
                <Text style={{ color: t.ink2, fontWeight: '800' }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleAdd} style={{ flex: 2, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: t.brand }}>
                <Text style={{ color: t.brandInk, fontWeight: '800' }}>{addClient ? 'Book Session' : 'Add Open Slot'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
