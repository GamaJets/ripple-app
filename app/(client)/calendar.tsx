// Book — month calendar of your in-person sessions. Tap a day to book an open
// slot or cancel one you've booked (24h+ ahead avoids the late fee). Reads the
// shared session store, so slots the coach opens appear here to book.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, conditional branch, alert and route from the previous version
// is preserved — only the presentation changed: one hero figure instead of three
// competing tiles, hairline-separated sections instead of stacked bordered
// boxes, and the one card spent on the coach you're booking with.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Image, Modal } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Card, ListRow, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import { useSessions } from '../../src/ui/sessions';
import { useCoachProfile } from '../../src/ui/coachProfile';
import { useClientData } from '../../src/ui/clientData';
import type { TrainingSession } from '../../src/lib/types';
import { sessionsRemaining, redeemSession, refundSession, reofferSlot } from '../../src/lib/connect';
import { buildIcs, shareIcs } from '../../src/lib/exportShare';
import { sendPush, sendPushChecked } from '../../src/ui/pushNotifications';

// NOTE: this screen used to filter and book against a hardcoded `CLIENT_ID = 'c1'`,
// a leftover from the mock-data era. The real client id is the Supabase user id.
// Because every client shared the literal 'c1', sessions booked by one client
// matched every other client's filter — so two people would see each other's
// bookings, and the trainer side (which stores real user ids) never matched at all.
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
  const cd = useClientData();
  const fee = coach.sessionFee;
  const [showCoach, setShowCoach] = useState(false);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selKey, setSelKey] = useState(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`);

  const [packLeft, setPackLeft] = useState<number | null>(null);
  useEffect(() => { let c = false; sessionsRemaining().then((n) => { if (!c) setPackLeft(n); }).catch(() => {}); return () => { c = true; }; }, []);
  const mine = sessions.filter((s) => s.clientId === cd.id && s.status === 'booked');
  const open = sessions.filter((s) => s.status === 'available');

  // Days visible to the client: their booked sessions + any open slots.
  const visible = sessions.filter((s) => s.status === 'available' || (s.status === 'booked' && s.clientId === cd.id));
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

  // One tap, three separate writes: the booking, the credit drawn off the pack,
  // and the push that tells the coach. This used to fire all three and then
  // assert all three had worked, in an alert that appeared before any of them
  // could have answered. The two that can report back are now awaited, and the
  // alert claims only what actually happened.
  async function book(s: TrainingSession) {
    const slot = `${DOW[new Date(s.startsAt).getDay()]} ${timeLabel(s.startsAt)}`;
    // Unknown counts as "might have had credits". A null balance means the
    // count could not be read, not that there is nothing to draw from, and
    // silence is the wrong side to err on when somebody's pack may not have
    // been debited.
    const mayHaveCredits = packLeft == null || packLeft > 0;
    bookSession(s.id, cd.id);

    // `redeemSession` declines rather than throws — no pack, an exhausted pack,
    // or an update the server refused all come back as `ok:false`. Only the
    // `ok` branch existed, so a client whose credit was never drawn watched the
    // count sit unchanged and was told the session was confirmed regardless.
    const redeem = await redeemSession(s.trainerId);
    // Only replace the shown balance with a real count. A failed re-read is
    // not news about the balance, and blanking the row would hide a number we
    // still have every reason to believe.
    if (redeem.ok) { const n = await sessionsRemaining(); if (n != null) setPackLeft(n); }

    // `sendPush` discards both outcomes, so a screen built on it can only ever
    // claim success — which is why `sendPushChecked` exists. "Your coach has
    // been notified" was printed either way, and a client whose coach never
    // heard would turn up to the gym believing they were expected.
    const push = await sendPushChecked([s.trainerId], 'New booking', `A client booked ${slot}.`, { route: '/(trainer)/calendar' });

    const lines = [`${slot} with ${coach.name} is confirmed.`];
    lines.push(push.ok
      ? 'Your coach has been notified.'
      : 'We couldn’t notify your coach — the booking is on their calendar, but message them if it’s soon.');
    // Only worth raising to someone who was showing credits: for a client who
    // pays per session there is no pack to draw from and nothing went wrong.
    if (mayHaveCredits && !redeem.ok) {
      lines.push(`This wasn’t taken off your session pack${redeem.error ? ` (${redeem.error})` : ''} — check your package before you book again.`);
    }
    Alert.alert('Session booked', lines.join('\n\n'), [{ text: 'Great' }]);
  }
  function cancel(s: TrainingSession) {
    const late = Date.parse(s.startsAt) - Date.now() < 24 * 3600 * 1000;
    const doCancel = async () => {
      // Offer the freed slot to the trainer's other clients (server-side lookup + push).
      // Both halves used to be fired and forgotten, and the alert below then told
      // the client the slot "was offered to your coach's other clients" whether
      // anyone had been found or anyone had been reached. Three outcomes, not one:
      // offered, nobody to offer it to, or we tried and could not.
      const others = await reofferSlot(s.id);
      const offered = others.length === 0
        ? null
        : (await sendPushChecked(others, 'A PT slot just opened', `${timeLabel(s.startsAt)} with ${coach.name} just opened up — first to book it gets it.`, { route: '/(client)/calendar' })).ok;
      releaseSession(s.id);
      // Late cancel (within 24h): the session is charged — keep the credit drawn. Otherwise refund it.
      // `refundSession` returns `{ok:false}` when there is no pack to credit and
      // when the server refused the update, and its answer was discarded — so
      // "returned to your package" was printed either way, which is how a client
      // comes to believe they are holding a credit they do not have.
      const refund = late ? { ok: false } : await refundSession(s.trainerId);
      { const n = await sessionsRemaining(); if (n != null) setPackLeft(n); }
      sendPush([s.trainerId], 'Session cancelled', `A client cancelled ${DOW[new Date(s.startsAt).getDay()]} ${timeLabel(s.startsAt)}. The slot re-opened.${late ? ' (Late cancel — charged.)' : ''}`, { route: '/(trainer)/calendar' });

      const lines: string[] = [];
      if (late) lines.push('Cancelled within 24 hours — this session is charged from your package.');
      else if (refund.ok) lines.push(`Your ${timeLabel(s.startsAt)} session was cancelled and returned to your package.`);
      else lines.push(`Your ${timeLabel(s.startsAt)} session was cancelled. Nothing was returned to a session pack — if you booked it with a pack credit, check your package before booking again.`);
      lines.push(offered === true ? `The freed slot was offered to your coach's other clients.`
        : offered === false ? `The slot is open again, but we couldn't tell your coach's other clients about it.`
        : `The slot is open again on your coach's calendar.`);
      Alert.alert('Cancelled', lines.join('\n\n'), [{ text: 'OK' }]);
    };
    if (late) Alert.alert('Within 24 hours', `This is inside 24 hours, so the session is charged from your package (and a $${fee} late fee may apply). The slot is offered to your coach's other clients. Continue?`, [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel anyway', style: 'destructive', onPress: doCancel }]);
    else Alert.alert('Cancel session?', 'This is more than 24h away, so no fee. The slot re-opens for others.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel', style: 'destructive', onPress: doCancel }]);
  }

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.push('/(client)/dashboard')} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Personal training</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Book sessions</Text>
          </View>
        </View>

        {/* ── the hero: what you have booked ──────────────────────────────── */}
        <Hero
          label="Booked with your coach"
          figure={fig(mine.length)}
          unit={mine.length === 1 ? 'session' : 'sessions'}
          note={open.length > 0
            ? `${open.length} open slot${open.length === 1 ? '' : 's'} — tap a day to book`
            : 'No open slots yet — your coach adds them here'}
        />

        <Rule />

        {/* ── availability ───────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Availability" />
          <KpiRow items={[
            { label: 'Open slots', value: fig(open.length) },
            ...(packLeft != null && packLeft > 0 ? [{ label: 'Pack credits', value: fig(packLeft) }] : []),
          ]} />
          {mine.length > 0 ? (
            <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
              <Ghost label="Add to calendar" icon="calendar"
                onPress={async () => { const evts = mine.map((s) => ({ start: s.startsAt, durationMin: s.durationMin, title: `Training with ${coach.name}` })); await shareIcs(buildIcs(evts, `Repple — ${coach.name}`), 'repple-sessions.ics', 'Add sessions to your calendar'); }} />
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* ── month ──────────────────────────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.lg }}>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous month" style={{ padding: 4 }}>
              <Icon name="back" size={18} color={t.ink2} />
            </Pressable>
            <Text style={{ ...ty.head, color: t.ink }}>{MON[viewMonth]} {viewYear}</Text>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Next month" style={{ padding: 4 }}>
              <Icon name="chevron" size={18} color={t.ink2} />
            </Pressable>
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
                const hasMine = daySess.some((s) => s.status === 'booked');
                const hasOpen = daySess.some((s) => s.status === 'available');
                return (
                  <Pressable key={i} onPress={() => setSelKey(k)} style={{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? t.brand : 'transparent', borderWidth: isToday && !isSel ? hairline : 0, borderColor: t.brand }}>
                      <Text style={{ ...value(14), color: isSel ? t.brandInk : isToday ? t.ink : t.ink2 }}>{d}</Text>
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
          <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.md, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} /><Text style={{ ...ty.caption, color: t.ink3 }}>Your session</Text></View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink3 }} /><Text style={{ ...ty.caption, color: t.ink3 }}>Open slot</Text></View>
          </View>
        </Section>

        <Rule />

        {/* ── the selected day ───────────────────────────────────────────── */}
        <Section>
          <SectionHead title={`${DOW[selDate.getDay()]} · ${MON[selM].slice(0, 3)} ${selD}`}
            note={selDaySessions.length > 0 ? `${selDaySessions.length} slot${selDaySessions.length === 1 ? '' : 's'}` : undefined} />
          {selDaySessions.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: sp.lg }}>
              <Icon name="calendar" size={24} color={t.ink3} />
              <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>No sessions this day. Days with a grey dot have open slots you can book.</Text>
            </View>
          ) : selDaySessions.map((s, si) => {
            const isMine = s.status === 'booked';
            return (
              <View key={s.id}>
                {si > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ width: 3, height: 34, borderRadius: 2, backgroundColor: isMine ? t.brand : t.surface3 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{timeLabel(s.startsAt)} · {s.durationMin} min</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{isMine ? 'Confirmed with your coach' : (s.released ? 'Just opened up' : 'Available')}</Text>
                  </View>
                  {isMine ? (
                    <Ghost label="Cancel" onPress={() => cancel(s)} />
                  ) : (
                    <Cta label="Book" onPress={() => book(s)} />
                  )}
                </View>
              </View>
            );
          })}
        </Section>

        <Rule />

        {/* ── your coach + the rest ──────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your coach" />
          <Card onPress={() => setShowCoach(true)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              {coach.photo ? (
                <Image source={{ uri: coach.photo }} style={{ width: 46, height: 46, borderRadius: radius.pill, backgroundColor: t.surface2 }} />
              ) : (
                <View style={{ width: 46, height: 46, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ ...value(16), color: t.brand }}>{initialsOf(coach.name)}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{coach.name || 'Your coach'}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={1}>{coach.tagline || 'Tap to see their profile'}</Text>
              </View>
              <Icon name="chevron" size={16} color={t.ink3} />
            </View>
          </Card>

          <View style={{ marginTop: sp.md }}>
            <ListRow icon="calendar" title="Gym classes" note="Book HIIT, spin, yoga & more"
              onPress={() => router.push('/(client)/classes')} />
            <ListRow icon="grid" title="Membership & entry pass" note="Card, barcode & visits"
              onPress={() => router.push('/(client)/membership')} />
          </View>
        </Section>

      </ScrollView>

      <Modal visible={showCoach} transparent animationType="slide" onRequestClose={() => setShowCoach(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowCoach(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '82%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: layout.gutter, paddingBottom: 30 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.lg }}>
              {coach.photo ? (
                <Image source={{ uri: coach.photo }} style={{ width: 60, height: 60, borderRadius: radius.pill, backgroundColor: t.surface2 }} />
              ) : (
                <View style={{ width: 60, height: 60, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ ...value(20), color: t.brand }}>{initialsOf(coach.name)}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.head, color: t.ink }}>{coach.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{coach.tagline}</Text>
              </View>
            </View>
            {coach.specialties.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: sp.lg }}>
                {coach.specialties.map((s, i) => (
                  <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                    <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2 }}>{s}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>{coach.bio}</Text>
            {coach.offers.length > 0 && (
              <View style={{ marginBottom: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>What I offer</Text>
                {coach.offers.map((o, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: 6 }}>
                    <Icon name="check" size={13} color={t.brand} />
                    <Text style={{ ...ty.body, color: t.ink }}>{o}</Text>
                  </View>
                ))}
              </View>
            )}
            <Rule />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: sp.lg }}>
              <Text style={{ ...ty.label, color: t.ink3 }}>Session rate</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={{ ...value(20), color: t.ink }}>${coach.sessionFee}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginLeft: 3 }}>/ session</Text>
              </View>
            </View>
            <View style={{ marginTop: sp.xl }}>
              <Cta label="Close" wide onPress={() => setShowCoach(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
