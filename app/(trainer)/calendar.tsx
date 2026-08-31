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
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Modal } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
import { sendPush, sendPushChecked } from '../../src/ui/pushNotifications';
import { markOutcome } from '../../src/lib/gymSessions';
import { supabase } from '../../src/lib/supabase';
import { useTenant } from '../../src/ui/tenant';
import { reportError } from '../../src/lib/reportError';

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
  const { sessions, addSession, releaseSession, removeSession, refresh } = useSessions();
  // The other side of this booking happens on somebody else's phone. Re-read on
  // focus so what is on screen is the diary as it stands, not as it stood at
  // launch — including a slot that has just been taken.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const { roster, status: rosterStatus } = useRoster();
  const { tenant } = useTenant();
  const { sessionFee } = useMyTrainerProfile();
  const nameOf = (id: string | null) => roster.find((c) => c.id === id)?.name ?? 'Open slot';
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selKey, setSelKey] = useState(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`);
  const [addOpen, setAddOpen] = useState(false);
  const [addHour, setAddHour] = useState(9);
  const [addMinute, setAddMinute] = useState(0);
  const [addDur, setAddDur] = useState(60);
  const [addClient, setAddClient] = useState<string | null>(null);
  // Opened from a client's own profile ("Book a Session"), the coach has already
  // said who this is for. Asking them again on the next screen is the step that
  // made booking-for-a-client feel like it did not exist.
  const params = useLocalSearchParams();
  const bookFor = typeof params.clientId === 'string' && params.clientId ? params.clientId : null;
  useEffect(() => {
    if (!bookFor) return;
    setAddClient(bookFor);
    setAddOpen(true);
  }, [bookFor]);
  const { slots: availSlots, addSlot: addAvail, removeSlot: removeAvail } = useAvailability();
  const [availOpen, setAvailOpen] = useState(false);
  const [avDow, setAvDow] = useState(1);
  const [avHour, setAvHour] = useState(9);
  // `addSession(...).ok` means only that the slot did not overlap one already on
  // this screen. Whether it reached the server is `saved`, and that is the half
  // that decides whether a client can ever see the slot — so a slot the server
  // refused used to be counted in "12 open slots added" and then be bookable by
  // nobody. The count now says how many are actually open.
  const generateSlots = async () => {
    if (!availSlots.length) { Alert.alert('No availability set', 'Add at least one weekly slot first.'); return; }
    const saves: Promise<boolean>[] = [];
    let overlapped = 0;
    for (const sl of availSlots) {
      for (const d of upcomingDates(sl.dow, sl.hour, 4)) {
        const ses: TrainingSession = { id: 'ms' + (SEQ++), trainerId: '', clientId: null, startsAt: d.toISOString(), durationMin: sl.dur, status: 'available', released: false };
        const res = addSession(ses);
        if (res.ok) saves.push(res.saved ?? Promise.resolve(false));
        else overlapped++;
      }
    }
    setAvailOpen(false);
    const results = await Promise.all(saves);
    const added = results.filter(Boolean).length;
    const lost = results.length - added;
    const lines = [
      added + ' open slot' + (added === 1 ? '' : 's') + ' added across the next 4 weeks — your clients can book ' + (added === 1 ? 'it' : 'them') + ' now.',
    ];
    if (overlapped) lines.push(overlapped + ' time' + (overlapped === 1 ? ' was' : 's were') + ' skipped because you already have something booked then.');
    if (lost) lines.push(lost + ' slot' + (lost === 1 ? '' : 's') + ' could not be saved to the server, so ' + (lost === 1 ? 'it is' : 'they are') + ' not open to anyone. Try generating again.');
    Alert.alert(added ? 'Slots generated' : 'No slots opened', lines.join('\n\n'));
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

  async function handleAdd() {
    const d = new Date(selY, selM, selD); d.setHours(addHour, addMinute, 0, 0);
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
    if (!addClient) return;
    const who = nameOf(addClient);
    // Two things had to be true for the old alert to be honest and neither was
    // checked: that the session reached the server (until it does, it is on this
    // phone alone and the client's app knows nothing about it) and that the push
    // was accepted. Both are awaited now, and the alert says what happened.
    const saved = await (res.saved ?? Promise.resolve(false));
    if (!saved) {
      Alert.alert(
        'Not booked',
        `${timeLabel(s.startsAt)} with ${who} was not saved, so it is not on your calendar and ${who} has not been booked.\n\n` +
          'Either the save failed, or somebody booked that time while this screen was open — your diary now allows only one session at a time. Pull down to refresh and check before trying again.',
        [{ text: 'OK' }],
      );
      return;
    }
    const push = await sendPushChecked([addClient], 'Session booked', `Your session on ${DOW[selDate.getDay()]} at ${timeLabel(s.startsAt)} is confirmed.`, { route: '/(client)/calendar' });
    Alert.alert(
      'Session booked',
      `${timeLabel(s.startsAt)} with ${who} is confirmed, and it is now on their calendar in the Repple app.\n\n` +
        (push.ok
          ? `${who} was sent a notification — they will see it if they have notifications on.`
          : `We couldn't send ${who} a notification${push.error ? ` (${push.error})` : ''}, so message them to let them know.`),
      [{ text: 'Great' }],
    );
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

  // Every hour of the day.
  //
  // This was a hand-written list that ran 6am–1pm and then jumped to 4pm, so a
  // coach could not book anybody at 2pm or 3pm at all — and nothing said why.
  // Any hand-picked window is somebody's assumption about when training
  // happens: a 5am lifter, a shift worker training at 11pm, a gym that opens
  // at four. The calendar has no business deciding that, so it offers all
  // twenty-four and lets the coach pick.
  const HOURS = Array.from({ length: 24 }, (_, h) => h);
  // Quarter past, half past, quarter to. The time was whole hours only, and
  // sessions are not: an 8:30 start had to be booked as 8 or 9 and the record
  // was wrong either way. A second row rather than 64 chips in one scroller —
  // hour then minute is two short reads; one list of every quarter hour is a
  // drag through a haystack.
  const MINUTES = [0, 15, 30, 45];
  const DURS = [30, 45, 60, 90];

  const G = layout.gutter;
  const totalSlots = booked.length + open.length;
  /**
   * The client turned up: record it, then open their record.
   *
   * Marked `completed` at check-in rather than after logging, because that is
   * the fact being asserted — this person is here and the session is
   * happening. A coach who gets interrupted and never opens the log has still
   * delivered the session, and leaving the outcome unset would put it back in
   * the Mark Sessions queue as though nobody knew what happened. A no-show is
   * the other button, and a session marked in error can be re-marked there.
   *
   * The write is awaited and read. Navigating away from a refused update would
   * take the coach to a screen implying the attendance was recorded.
   */
  const checkIn = async (s: TrainingSession) => {
    if (!s.clientId) return;
    const who = nameOf(s.clientId);
    try {
      await markOutcome(supabase, s.id, 'completed', tenant?.sessionFee != null ? tenant.sessionFee * 100 : undefined);
    } catch (e) {
      reportError('calendar.checkIn', e, { sessionId: s.id });
      Alert.alert('Not checked in', `${who} was not marked present — that did not save. Check your connection and try again.`);
      return;
    }
    router.push({ pathname: '/(trainer)/client', params: { clientId: s.clientId, name: who, checkedIn: '1' } });
  };

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
          arcLabel="of today's slots booked"
        />

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

        {/* ── the things you do from here ─────────────────────────────────
            Below the calendar, not above it. Two of these read the SELECTED
            DATE — "Add a Session" is captioned with it and books into it — so
            above the grid they asked a coach to act before choosing the day
            they were acting on, and the caption named whatever date happened
            to be selected already. The order now matches the order of the
            decision: pick the day, then do the thing. */}
        <Section>
          <SectionHead title="Manage" />
          <ListRow icon="plus" title="Add a Session"
            note={`Book a client or open a slot on ${DOW[selDate.getDay()]} ${selD} ${MON[selM].slice(0, 3)}`}
            onPress={() => { setAddClient(null); setAddOpen(true); }} />
          <ListRow icon="clock" title="Weekly Availability"
            note={availSlots.length
              ? `${availSlots.length} weekly slot${availSlots.length === 1 ? '' : 's'} · generate the next 4 weeks`
              : 'Set the times you offer every week'}
            onPress={() => setAvailOpen(true)} />
          <ListRow icon="people" title="Group Classes" note="Schedule & fill classes across branches"
            onPress={() => router.push('/(trainer)/classes')} />
          {booked.length > 0 ? (
            <ListRow icon="share" title="Export Schedule" note="Send your booked sessions to your calendar app"
              onPress={exportSchedule} />
          ) : null}
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
                  {s.status === 'booked' ? (<>
                    {/* Check in is the start of the session, and it is the one
                        thing a coach does standing next to somebody. It marks
                        them present and opens their record — the overview
                        first, because what you want thirty seconds before a
                        session is what they did last time and what they cannot
                        do. Entering the exercises is one tap on from there,
                        and lands in the client's OWN record, so it reaches
                        their app rather than staying on the coach's screen. */}
                    <View style={{ flex: 1 }}><Cta label="Check In" wide onPress={() => checkIn(s)} /></View>
                    <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => confirmCancel(s)} /></View>
                  </>) : (<>
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

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>
              Time · {(addHour % 12) || 12}:{String(addMinute).padStart(2, '0')}{addHour >= 12 ? 'pm' : 'am'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
              {HOURS.map((h) => {
                const sel = h === addHour; const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12;
                return <Chip key={h} t={t} label={`${hh}${ap}`} on={sel} onPress={() => setAddHour(h)} />;
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              {MINUTES.map((m) => (
                <View key={m} style={{ flex: 1 }}>
                  <Pressable onPress={() => setAddMinute(m)} accessibilityRole="button"
                    accessibilityState={{ selected: m === addMinute }}
                    accessibilityLabel={`${(addHour % 12) || 12}:${String(m).padStart(2, '0')}${addHour >= 12 ? 'pm' : 'am'}`}
                    style={{ paddingVertical: sp.sm, borderRadius: radius.pill, alignItems: 'center', backgroundColor: m === addMinute ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, ...numeric, fontWeight: m === addMinute ? '500' : '400', color: m === addMinute ? t.brandInk : t.ink2 }}>
                      :{String(m).padStart(2, '0')}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>

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
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.md }}>
              <Chip t={t} label="Open Slot" on={addClient === null} onPress={() => setAddClient(null)} />
              {roster.map((c) => <Chip key={c.id} t={t} label={c.name} on={c.id === addClient} onPress={() => setAddClient(c.id)} />)}
            </View>
            {/* Reported as "nowhere here does it allow me to select a client".
                With an empty roster this row rendered ONE chip — Open Slot —
                and said nothing, which reads as the feature being missing
                rather than as there being nobody to book. And an empty roster
                has three quite different causes that must not look alike: it
                is still loading, the read failed, or there genuinely is
                nobody. */}
            {roster.length === 0 ? (
              <Text style={{ ...ty.caption, color: rosterStatus === 'error' ? t.warn : t.ink3, marginBottom: sp.xl }}>
                {rosterStatus === 'loading'
                  ? 'Reading your clients…'
                  : rosterStatus === 'error'
                    ? 'Your clients could not be read, so none can be listed here. This is a connection problem, not an empty book — you can still add an open slot.'
                    : 'No clients on your roster yet, so there is nobody to book. Add one from the Clients tab, or leave this as an open slot for somebody to take.'}
              </Text>
            ) : rosterStatus === 'partial' ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>
                Part of your roster did not load, so somebody may be missing from this list.
              </Text>
            ) : <View style={{ marginBottom: sp.xl }} />}

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
