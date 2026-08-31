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
import { useSessions, cancelBookedSession, ptCancelLines, useCancellationPolicy, useSlotWaitlist, cancelWarningFor, waitlistLine } from '../../src/ui/sessions';
import { useBrand } from '../../src/ui/brand';
import { useClientData } from '../../src/ui/clientData';
import type { TrainingSession } from '../../src/lib/types';
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

// `onCancel` resolves TRUE only when the server actually took the cancellation.
//
// It used to be `() => void`, wrapping two calls that both return
// `Promise<boolean>` — `useClasses().cancel` and `useSessions().releaseSession`
// — and throwing the answer away at the call site. Both of those booleans exist
// for one reason: a cancellation the server refuses still empties the row off
// this screen for a moment, because both providers paint optimistically and
// then put the booking back when the write does not land. So the member watched
// their booking vanish, saw no message of any kind, and left believing they had
// cancelled. Class no-shows are charged by the gym and a missed PT session is
// charged off the member's pack, so the cost of that silence lands on them.
//
// app/(client)/calendar.tsx has done this correctly since the re-offer bug:
// await the release, and say plainly that nothing changed when it comes back
// false. This screen now does the same.
//
// ── The divergence that made the same tap cost different money ─────────────
//
// `onCancel` was the whole of a cancellation on this screen, and for a class it
// still is. For a PT session it was not enough, and the note that used to sit
// beside the PT row said so: cancelling here freed the slot and stopped, while
// app/(client)/calendar.tsx also returned the pack credit when the cancellation
// was more than 24h out, offered the freed slot to the coach's other clients,
// and told the coach. So the member lost a paid session by cancelling from the
// list instead of from the calendar, and nothing on either screen suggested the
// two buttons were different.
//
// `pt` is what carries that. It is not a second copy of those writes — the fix
// the note asked for was a shared helper, and `cancelBookedSession` in
// src/ui/sessions.tsx is it, called by both screens with the same arguments in
// the same order. This screen keeps only the wording of its own alerts.
type Item = { id: string; kind: 'class' | 'pt'; title: string; sub: string; startsAt: string; durationMin: number; location?: string; waitlist?: boolean; onCancel: () => Promise<boolean>; pt?: TrainingSession };

export default function Bookings() {
  const t = useTheme();
  const router = useRouter();
  const { classes, myStatus, status: classStatus, cancel: cancelClass } = useClasses();
  const { sessions, status: sessionStatus, releaseSession, cancelMyBooking } = useSessions();
  // The coach's own policy, so the warning on this screen and the warning on
  // the Book screen are the same sentence about the same money. They came apart
  // once already — see the long note above `Item` — and a hardcoded 24 hours in
  // one of them was how a coach's 48-hour policy would have gone unmentioned
  // here and mentioned there.
  const { policy: cancelPolicy } = useCancellationPolicy();
  // What this member is waiting for. `session_waitlist_client_r` shows them
  // their own row and nobody else's, so a position can only come from the
  // server: read from the app the queue is a set of one and everybody is first.
  const { mine: myQueue, status: waitStatus, leave: leaveWait, reload: reloadWait } = useSlotWaitlist();
  // Either read failing makes this list a fragment, and a fragment must not be
  // announced as "you have nothing booked" — the member then turns up to
  // nothing, or fails to turn up to something.
  const bookingsWhole = classStatus === 'ready' && sessionStatus === 'ready';
  const bookingsFailed = classStatus === 'error' || sessionStatus === 'error';
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
        // The divergence the note above this type described is closed: `pt`
        // routes this row's cancellation through the same helper the Book
        // screen calls, so the credit, the re-offer and the coach's push happen
        // whichever screen the member cancelled from. `onCancel` stays as the
        // release the helper itself performs, so a class row and a PT row still
        // share one shape.
        out.push({ id: 'p' + s.id, kind: 'pt', title: coachName ? `PT with ${coachName}` : 'PT session', sub: `${s.durationMin} min session`, startsAt: s.startsAt, durationMin: s.durationMin, location: coachName ? `with ${coachName}` : undefined, onCancel: () => releaseSession(s.id), pt: s });
      }
    }
    return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }, [classes, myStatus, sessions, coachName]);

  const confirmCancel = (it: Item) => {
    // Captured before either alert, so the 24-hour rule the member is warned
    // about is the same one that decides whether their credit comes back.
    const asked = Date.now();
    // The booking is named in the failure sentence as well as the question. By
    // the time this alert appears the row has already blinked out and back, and
    // "that didn't save" over an unnamed booking leaves the member checking the
    // list to work out which one it meant.
    const failed = () => Alert.alert(
      it.waitlist ? 'Still on the waitlist' : 'Not cancelled',
      it.waitlist
        ? `You are still on the waitlist for ${it.title} — that did not save, so nothing has changed. Check your connection and try again.`
        : `${it.title} on ${dayLabel(it.startsAt)} at ${timeLabel(it.startsAt)} is still booked — that did not save, so nothing has changed and you are still expected. Check your connection and try again.`,
      [{ text: 'OK' }],
    );
    const doCancel = async () => {
      // A PT session is not just a row coming off a list: there is a pack credit
      // to return, a slot to re-offer, and a coach expecting somebody. All of it
      // is in `cancelBookedSession` so that this screen and the Book screen
      // cannot drift into settling the same cancellation differently — and the
      // sentences about the member's money come back from `ptCancelLines`, for
      // the same reason.
      if (it.pt) {
        const out = await cancelBookedSession(it.pt, cancelMyBooking, asked, cancelPolicy);
        if (!out.freed) { failed(); return; }
        // The slot may have gone straight to somebody's queue, and this member's
        // own queues may have moved with it.
        reloadWait();
        Alert.alert('Cancelled', ptCancelLines(out, timeLabel(it.startsAt)).join('\n\n'), [{ text: 'OK' }]);
        return;
      }
      const ok = await it.onCancel();
      if (ok) return;
      failed();
    };
    // The notice warning is part of the cancellation, not part of the calendar
    // screen. Asked without it, a member cancelling from this list agreed to
    // something they were not told the price of — and the price is a session off
    // a pack they paid for, plus whatever their coach charges. Same rule, same
    // wording, from the same helper, and only for PT: a class is the gym's own
    // no-show policy and this app does not know it.
    const warn = it.pt ? cancelWarningFor(it.startsAt, cancelPolicy, asked) : null;
    if (warn?.late) {
      Alert.alert(
        'Cancelling late',
        `${warn.line}\n\n${it.title} · ${dayLabel(it.startsAt)} ${timeLabel(it.startsAt)}. Continue?`,
        [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel anyway', style: 'destructive', onPress: () => { void doCancel(); } }],
      );
      return;
    }
    if (warn) {
      Alert.alert('Cancel this booking?', `${it.title} · ${dayLabel(it.startsAt)} ${timeLabel(it.startsAt)}\n\n${warn.line}`, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel', style: 'destructive', onPress: () => { void doCancel(); } },
      ]);
      return;
    }
    Alert.alert('Cancel this booking?', `${it.title} · ${dayLabel(it.startsAt)} ${timeLabel(it.startsAt)}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: () => { void doCancel(); } },
    ]);
  };

  const confirmLeave = (q: { sessionId: string; startsAt: string }) => {
    Alert.alert(
      'Leave this waitlist?',
      `You’ll lose your place in line for ${dayLabel(q.startsAt)} ${timeLabel(q.startsAt)}. If it frees up after that, it goes to whoever is in the queue instead of you.`,
      [
        { text: 'Stay in line', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            const res = await leaveWait(q.sessionId);
            // A delete that matched nothing is not an error in PostgREST, so
            // the RPC counts its rows and this screen believes the count. Told
            // otherwise, a member walks away still in a queue that can book
            // them into a session they no longer want.
            if (!res.ok) {
              Alert.alert('Still on the waitlist', `${res.error || 'That did not save.'} You are still in line for ${timeLabel(q.startsAt)}, so it could still be booked for you.`, [{ text: 'OK' }]);
              return;
            }
            Alert.alert('Left the waitlist', `You’re no longer in line for ${dayLabel(q.startsAt)} ${timeLabel(q.startsAt)}.`, [{ text: 'OK' }]);
          },
        },
      ],
    );
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
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>My Bookings</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Your upcoming classes and personal-training sessions, all in one place.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        <Rule />

        {/* ── book something ─────────────────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', gap: sp.md }}>
            <View style={{ flex: 1 }}><Cta label="Book a Class" wide onPress={() => router.push('/(client)/classes')} /></View>
            <View style={{ flex: 1 }}><Ghost label="Book PT" onPress={() => router.push('/(client)/calendar')} /></View>
          </View>
          {items.length > 0 ? (
            <View style={{ marginTop: sp.md }}>
              <Ghost icon="calendar" label="Add to Calendar" onPress={addToCalendar} />
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
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {bookingsFailed
                ? 'Your bookings could not be read, so this is not a statement that you have none. Check again when you have signal before assuming a session is not on.'
                : !bookingsWhole
                  ? 'Loading.'
                  : 'No upcoming bookings. Book a class or a PT session to get started.'}
            </Text>
          ) : null}
        </Section>

        {/* ── the queues this member is in ────────────────────────────────
            A PT waitlist is not a booking and is never listed as one: it lives
            under its own heading, below Upcoming, and every line of it says
            where in the queue they actually are. The one promise made here is
            the one the database keeps — the slot goes to whoever is first,
            inside the transaction that frees it, so nobody has to be quick and
            nobody can be beaten to it by a faster phone. */}
        {waitStatus === 'error' || myQueue.length > 0 ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Waiting For" note={waitStatus === 'error' ? 'Not read' : myQueue.length > 0 ? `${myQueue.length} slot${myQueue.length === 1 ? '' : 's'}` : undefined} />
              {waitStatus === 'error' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  We couldn’t read your waitlists. This is not a statement that you are on none — any place you hold still stands, and a slot that frees can still be booked for you.
                </Text>
              ) : (
                myQueue.map((q, i) => (
                  <View key={q.sessionId}>
                    {i > 0 ? <Rule /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>Personal training</Text>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: 3 }}>{dayLabel(q.startsAt)} · {timeLabel(q.startsAt)}</Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                          {/* A slot that is no longer taken and did not come to
                              this member is worth saying plainly: the queue
                              moved past them, or the coach opened the hour up
                              rather than it being cancelled into the list. */}
                          {q.stillTaken ? waitlistLine(q.position, q.waiting) : 'This slot is open again and did not come to you — book it from the Book screen if you still want it.'}
                        </Text>
                      </View>
                      <Ghost label="Leave" onPress={() => confirmLeave(q)} />
                    </View>
                  </View>
                ))
              )}
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
