// Client · My bookings. One place for everything the member has booked — group
// classes and personal-training sessions — in chronological order, with cancel.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero (a list has no single number), one hairline-
// separated section instead of a stack of bordered cards, and a coloured dot
// beside ink text where "Waitlist" used to be status-coloured type. Every
// provider, conditional and route is unchanged.
//
// ── TF-32: "PT with <the reader's own name>" ───────────────────────────────
//
// The personal-training rows were titled from `useCoachProfile().name`. That
// provider is the COACH-side one — it calls `supabase.auth.getUser()` and loads
// THAT user's own `profiles.full_name` — so on the client app it resolves to the
// reader, and every PT booking in this list was headed "PT with <your own name>"
// and located "with <your own name>". The title feeds the ICS export below as
// well, so it was also being written into the client's real calendar.
//
// The name now comes from `useThreadPeerName`, which resolves `clients.
// trainer_id` and then reads `profiles.full_name` for that id alone. A client
// usually cannot read their coach's row at all — no policy on `profiles` runs
// client → coach, and src/lib/threadPeer.ts sets out why — so where there is no
// name the row is titled "PT session" and carries no location. A booking that
// reads "PT with —" in the app, and worse in the calendar it is exported to, is
// not more honest than one that simply says what it is.
import { useMemo } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, type as ty, numeric } from '../../src/theme/scale';
import { useClasses } from '../../src/ui/classes';
import { useSessions } from '../../src/ui/sessions';
import { useBrand } from '../../src/ui/brand';
import { useClientData } from '../../src/ui/clientData';
import { buildIcs, shareIcs, type IcsEvent } from '../../src/lib/exportShare';
import { peerHeading } from '../../src/lib/threadPeer';
import { useThreadPeerName } from '../../src/ui/messaging';

// NOTE: this screen used to filter and book against a hardcoded `CLIENT_ID = 'c1'`,
// a leftover from the mock-data era. The real client id is the Supabase user id.
// Because every client shared the literal 'c1', sessions booked by one client
// matched every other client's filter — so two people would see each other's
// bookings, and the trainer side (which stores real user ids) never matched at all.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const timeLabel = (iso: string) => { const d = new Date(iso); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`; };
const dayLabel = (iso: string) => { const d = new Date(iso); const t = new Date(); const tm = new Date(); tm.setDate(t.getDate() + 1); if (d.toDateString() === t.toDateString()) return 'Today'; if (d.toDateString() === tm.toDateString()) return 'Tomorrow'; return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

type Item = { id: string; kind: 'class' | 'pt'; title: string; sub: string; startsAt: string; durationMin: number; location?: string; waitlist?: boolean; onCancel: () => void };

export default function Bookings() {
  const t = useTheme();
  const router = useRouter();
  const { classes, myStatus, cancel: cancelClass } = useClasses();
  const { sessions, releaseSession } = useSessions();
  const peer = useThreadPeerName('client', null);
  const head = peerHeading(peer, 'coach');
  // A name, or null when there is none we may show. This screen has nowhere to
  // put the reason for a dash — a list row's title and an exported location are
  // both too small to explain themselves — so it does not draw one, and the
  // phrasing changes instead. The Book screen states the reason, on the card
  // headed "Your coach" where there is room for a whole sentence.
  const coachName = head.isName ? head.text : null;
  const cd = useClientData();
  const { appName } = useBrand();

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const c of classes) {
      const st = myStatus[c.id];
      if (st && Date.parse(c.startsAt) > Date.now() - 3600_000) {
        out.push({ id: 'c' + c.id, kind: 'class', title: c.title, sub: `${c.kind} · ${c.branch}${c.room ? ' · ' + c.room : ''}`, startsAt: c.startsAt, durationMin: c.durationMin ?? 45, location: [c.branch, c.room].filter(Boolean).join(' · ') || undefined, waitlist: st === 'waitlist', onCancel: () => cancelClass(c.id) });
      }
    }
    for (const s of sessions) {
      if (s.clientId === cd.id && s.status === 'booked' && Date.parse(s.startsAt) > Date.now() - 3600_000) {
        // "PT session" rather than "PT with —". The title is the row's whole
        // identity and it is what the ICS export writes into the calendar, and
        // a booking named after a piece of punctuation is worse in both places
        // than one named after what it is. The location is simply omitted for
        // the same reason: `IcsEvent.location` is optional, and an absent line
        // in a calendar entry says nothing, where a dash says something wrong.
        out.push({ id: 'p' + s.id, kind: 'pt', title: coachName ? `PT with ${coachName}` : 'PT session', sub: `${s.durationMin} min session`, startsAt: s.startsAt, durationMin: s.durationMin, location: coachName ? `with ${coachName}` : undefined, onCancel: () => releaseSession(s.id) });
      }
    }
    return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }, [classes, myStatus, sessions, coachName]);

  const confirmCancel = (it: Item) => {
    Alert.alert('Cancel this booking?', `${it.title} · ${dayLabel(it.startsAt)} ${timeLabel(it.startsAt)}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: it.onCancel },
    ]);
  };

  const addToCalendar = async () => {
    if (items.length === 0) return;
    const evts: IcsEvent[] = items.map((it) => ({
      start: it.startsAt,
      durationMin: it.durationMin || 60,
      title: `${appName} · ${it.title}`,
      location: it.location,
      notes: it.sub,
    }));
    await shareIcs(buildIcs(evts, `${appName} — My bookings`), 'my-bookings.ics', 'Add to calendar');
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>At the gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>My bookings</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Your upcoming classes and personal-training sessions, all in one place.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        <Rule />

        {/* ── book something ─────────────────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', gap: sp.md }}>
            <View style={{ flex: 1 }}><Cta label="Book a class" wide onPress={() => router.push('/(client)/classes')} /></View>
            <View style={{ flex: 1 }}><Ghost label="Book PT" onPress={() => router.push('/(client)/calendar')} /></View>
          </View>
          {items.length > 0 ? (
            <View style={{ marginTop: sp.md }}>
              <Ghost icon="calendar" label="Add to calendar" onPress={addToCalendar} />
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* ── what you have booked ───────────────────────────────────────── */}
        <Section>
          <SectionHead title="Upcoming" note={items.length > 0 ? `${items.length} booked` : undefined} />
          {items.map((it, i) => (
            <View key={it.id}>
              {i > 0 ? <Rule /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>{it.kind === 'pt' ? 'Personal training' : 'Class'}</Text>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: 3 }}>{it.title}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{dayLabel(it.startsAt)} · {timeLabel(it.startsAt)} · {it.sub}</Text>
                  {it.waitlist ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} />
                      <Text style={{ ...ty.caption, color: t.ink2 }}>On the waitlist</Text>
                    </View>
                  ) : null}
                </View>
                <Ghost label={it.waitlist ? 'Leave' : 'Cancel'} onPress={() => confirmCancel(it)} />
              </View>
            </View>
          ))}
          {items.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No upcoming bookings. Book a class or a PT session to get started.</Text>
          ) : null}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
