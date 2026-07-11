// Book — month calendar of your in-person sessions. Tap a day to book an open
// slot or cancel one you've booked (24h+ ahead avoids the late fee). Reads the
// shared session store, so slots the coach opens appear here to book.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Image, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useSessions } from '../../src/ui/sessions';
import { useCoachProfile } from '../../src/ui/coachProfile';
import type { TrainingSession } from '../../src/lib/types';

const CLIENT_ID = 'c1';
const initialsOf = (name: string) => name.replace('Coach ', '').split(' ').map((x) => x[0]).join('').slice(0, 2);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayKey(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function timeLabel(iso: string) {
  const d = new Date(iso); let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  const m = d.getMinutes(); return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
}

export default function Calendar() {
  const t = useTheme();
  const router = useRouter();
  const now = new Date();
  const { sessions, bookSession, releaseSession } = useSessions();
  const coach = useCoachProfile();
  const fee = coach.sessionFee;
  const [showCoach, setShowCoach] = useState(false);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selKey, setSelKey] = useState(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`);

  const mine = sessions.filter((s) => s.clientId === CLIENT_ID && s.status === 'booked');
  const open = sessions.filter((s) => s.status === 'available');

  // Days visible to the client: their booked sessions + any open slots.
  const visible = sessions.filter((s) => s.status === 'available' || (s.status === 'booked' && s.clientId === CLIENT_ID));
  const byDay = new Map<string, TrainingSession[]>();
  for (const s of visible) { const k = dayKey(s.startsAt); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(s); }

  const first = new Date(viewYear, viewMonth, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const [selY, selM, selD] = selKey.split('-').map(Number);
  const selDate = new Date(selY, selM, selD);
  const selDaySessions = (byDay.get(selKey) ?? []).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  function shiftMonth(delta: number) {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  }

  function book(s: TrainingSession) {
    bookSession(s.id, CLIENT_ID);
    Alert.alert('Session booked ✓', `${DOW[new Date(s.startsAt).getDay()]} ${timeLabel(s.startsAt)} with ${coach.name} is confirmed.\n\nA confirmation has been sent to you and your coach.`, [{ text: 'Great' }]);
  }
  function cancel(s: TrainingSession) {
    const late = Date.parse(s.startsAt) - Date.now() < 24 * 3600 * 1000;
    const doCancel = () => {
      releaseSession(s.id);
      Alert.alert('Cancelled', `Your ${timeLabel(s.startsAt)} session was cancelled. The slot has been re-offered to other clients.${late ? `\n\nA $${fee} late-cancellation fee applies.` : ''}`, [{ text: 'OK' }]);
    };
    if (late) Alert.alert('Within 24 hours', `Cancelling now charges the $${fee} late-cancellation fee, and the slot is offered to other clients. Continue?`, [{ text: 'Keep it', style: 'cancel' }, { text: `Cancel · $${fee}`, style: 'destructive', onPress: doCancel }]);
    else Alert.alert('Cancel session?', 'This is more than 24h away, so no fee. The slot re-opens for others.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel', style: 'destructive', onPress: doCancel }]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.push('/(client)/dashboard')} style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Home</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Book Sessions</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 14 }}>Tap a day to book or cancel</Text>

        {/* Coach card */}
        <Pressable onPress={() => setShowCoach(true)} style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {coach.photo ? (
            <Image source={{ uri: coach.photo }} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.surface2 }} />
          ) : (
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.brand, fontWeight: '800', fontSize: 18 }}>{initialsOf(coach.name)}</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{coach.name}</Text>
            <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{coach.tagline}</Text>
          </View>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 12 }}>View ›</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: t.brand, borderRadius: 16, padding: 14 }}>
            <Text style={{ color: t.brandInk, fontSize: 12, fontWeight: '700', opacity: 0.85 }}>Your Sessions</Text>
            <Text style={{ color: t.brandInk, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{mine.length}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Open Slots</Text>
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{open.length}</Text>
          </View>
        </View>

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
                const hasMine = daySess.some((s) => s.status === 'booked');
                const hasOpen = daySess.some((s) => s.status === 'available');
                return (
                  <Pressable key={i} onPress={() => setSelKey(k)} style={{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? t.brand : 'transparent', borderWidth: isToday && !isSel ? 1 : 0, borderColor: t.brand }}>
                      <Text style={{ color: isSel ? t.brandInk : t.ink, fontSize: 14, fontWeight: isToday || isSel ? '800' : '600' }}>{d}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 3, height: 6, marginTop: 2 }}>
                      {hasMine && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.brand }} />}
                      {hasOpen && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.ink3 }} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 10, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} /><Text style={{ color: t.ink3, fontSize: 11 }}>Your session</Text></View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink3 }} /><Text style={{ color: t.ink3, fontSize: 11 }}>Open slot</Text></View>
          </View>
        </View>

        {/* Selected day */}
        <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, marginBottom: 10 }}>{DOW[selDate.getDay()]}, {MON[selM].slice(0, 3)} {selD}</Text>
        {selDaySessions.length === 0 ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 22, alignItems: 'center' }}>
            <Text style={{ fontSize: 26, marginBottom: 6 }}>🗓️</Text>
            <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center' }}>No sessions this day. Days with a grey dot have open slots you can book.</Text>
          </View>
        ) : selDaySessions.map((s) => {
          const isMine = s.status === 'booked';
          return (
            <View key={s.id} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 8, height: 44, borderRadius: 4, backgroundColor: isMine ? t.brand : t.surface3 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{timeLabel(s.startsAt)} · {s.durationMin} min</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{isMine ? 'Confirmed with your coach' : (s.released ? 'Just opened up' : 'Available')}</Text>
              </View>
              {isMine ? (
                <Pressable onPress={() => cancel(s)} style={{ borderWidth: 1, borderColor: t.s6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                  <Text style={{ color: t.s6, fontWeight: '700', fontSize: 12 }}>Cancel</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => book(s)} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9 }}>
                  <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Book</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={showCoach} transparent animationType="slide" onRequestClose={() => setShowCoach(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowCoach(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '82%' }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              {coach.photo ? (
                <Image source={{ uri: coach.photo }} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.surface2 }} />
              ) : (
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.brand, fontWeight: '800', fontSize: 22 }}>{initialsOf(coach.name)}</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 19, fontWeight: '800' }}>{coach.name}</Text>
                <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2 }}>{coach.tagline}</Text>
              </View>
            </View>
            {coach.specialties.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {coach.specialties.map((s, i) => <View key={i} style={{ backgroundColor: 'rgba(45,212,191,0.12)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 12 }}>{s}</Text></View>)}
              </View>
            )}
            <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 20, marginBottom: 14 }}>{coach.bio}</Text>
            {coach.offers.length > 0 && (
              <View style={{ marginBottom: 14 }}>
                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>What I Offer</Text>
                {coach.offers.map((o, i) => <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}><Text style={{ color: t.brand, fontSize: 14 }}>✓</Text><Text style={{ color: t.ink, fontSize: 14 }}>{o}</Text></View>)}
              </View>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, borderTopWidth: 1, borderTopColor: t.ring }}>
              <Text style={{ color: t.ink3, fontSize: 13 }}>Session rate</Text>
              <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>${coach.sessionFee}<Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}> / session</Text></Text>
            </View>
            <Pressable onPress={() => setShowCoach(false)} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 18 }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Close</Text></Pressable>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
