// Client · Ask your coach for a time they have not opened.
//
// ── What was missing ──────────────────────────────────────────────────────
//
// The product owner tested the app and reported: "i can't see my coach Dayne's
// availability and am not able to book a session or send a request for a
// booking." A client is never shown a coach's weekly availability — that table
// is coach-side on purpose — and what they CAN see is generated open slots on
// app/(client)/calendar.tsx. So a member whose coach had not published Tuesday
// at seven had nothing at all to tap. This screen is the missing half.
//
// ── The one rule this screen exists to keep ───────────────────────────────
//
// A REQUEST IS NOT A BOOKING, and the member must never be able to read one as
// though it were. That is not a copy preference; it is the harm this feature can
// actually do — somebody arranging their evening around a question nobody has
// answered. Four separate things enforce it here:
//
//  · The sentence is on the screen before the button. `NOT_A_BOOKING` sits
//    above the ask, not in a confirmation somebody dismisses.
//  · The lapse rule is on the screen before it is relied on. `EXPIRY_RULE` says
//    what happens to a request nobody answers, at the moment the member is
//    deciding whether to count on the hour — not on a screen they reach after
//    being let down.
//  · Every outcome gets its OWN sentence. `outcomeLine` writes five of them and
//    src/lib/sessionRequests.test.ts asserts they are five, and asserts that the
//    four which are not sessions never say booked or confirmed.
//  · A request kept on this phone is not shown as asked. The list is the
//    server's answer; a queued intent is counted separately and said out loud,
//    exactly as a queued coach-document acceptance is, because the difference
//    between "your coach has been asked" and "your coach has not been asked" is
//    the whole point.
//
// ── Money is not on this screen ───────────────────────────────────────────
//
// No price, no credit, no fee, no currency. A question costs nothing, and an
// accepted one becomes a session paid for by the route that already exists:
// part 740 leaves `sessions.booking_drew_credit_at` null, so part 370 draws the
// credit at DELIVERY, off whatever the member actually holds, exactly as it
// does for a session a coach books into their own diary. There is no second
// path and this screen would be the wrong place to build one.
//
// ── Offline ───────────────────────────────────────────────────────────────
//
// Kept, and 'session-request' is an outbox kind. src/lib/outbox.ts argues why
// this one is admitted where BOOKING a slot is refused: the exclusion is about
// scarcity, and a request holds nothing that anybody else could take first.
import { useCallback, useMemo, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Notice, Cta, Ghost, Flag, Card } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { USE_SUPABASE } from '../../src/lib/config';
import { MIN_TARGET, hitSlopFor } from '../../src/lib/a11y';
import { appLocale } from '../../src/lib/locale';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { useClientData } from '../../src/ui/clientData';
import { useSessions } from '../../src/ui/sessions';
import { useThreadPeerName } from '../../src/ui/messaging';
import { peerHeading } from '../../src/lib/threadPeer';
import { useOutbox } from '../../src/ui/outbox';
import { outboxNote } from '../../src/lib/outbox';
import { keptOnPhoneNote, notKeptNote, sessionRequestExpiry } from '../../src/lib/recordQueue';
import { sendPushChecked } from '../../src/ui/pushNotifications';
import { fetchMyRequests, askForSession, withdrawRequest } from '../../src/ui/sessionRequests';
import {
  EXPIRY_RULE, NOT_A_BOOKING, NO_COACH_TO_ASK, OUTCOME_LABEL, REQUEST_NOTE_MAX,
  askBlocker, askRefusalNote, askedConfirmation, myRequests, outcomeLine, outcomeOf,
  ownDiaryNote, isLive, type SessionRequest,
} from '../../src/lib/sessionRequests';

/** How far ahead the day strip offers. Four weeks is as far as anybody plans a
 *  gym session; the horizon that actually governs is REQUEST_HORIZON_DAYS and
 *  `askBlocker` is what enforces it. */
const DAYS_OFFERED = 28;

/** The hours a coach might be asked for. A list rather than a free field: this
 *  is a request for an appointment, and 06:17 is not one somebody means. */
const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

/** The lengths offered. Sixty first, because it is what almost every one-to-one
 *  in this app is, and the others are beside it rather than behind a picker. */
const LENGTHS = [30, 45, 60, 90];

/**
 * A local instant from a local day and a local hour.
 *
 * `new Date(y, m, d, h)` and never a string slice. A `${iso}T${hh}:00:00Z`
 * would be UTC and would move a 7pm request by hours for most of the world;
 * this is the same discipline `dateParts` exists for elsewhere in this app.
 */
const instantAt = (day: Date, hour: number, minute = 0): string =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).toISOString();

/** The quarters a session can start on, matching the coach's own Add Session
 *  grid and the slots a range generates. A client who can only ask on the hour
 *  cannot ask for the 07:15 their coach actually offers. */
const REQUEST_MINUTES = [0, 15, 30, 45];

export default function RequestSessionScreen() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  // `status` as well as the rows. `myBusy` below is built out of this list and
  // is the only check of the member's OWN calendar anywhere in this feature —
  // see `ownDiaryNote`. Taking the sessions without the status is how a read
  // that failed becomes a diary with nothing in it.
  const { sessions, status: sessionsStatus, refresh: refreshSessions } = useSessions();
  const outbox = useOutbox();

  // The coach's name where it can be read, and a sentence that works without
  // one where it cannot. No policy on `profiles` runs client → coach for most
  // accounts (src/lib/threadPeer.ts), so "no name" is the ordinary case here
  // rather than the exception.
  const peer = useThreadPeerName('client', null);
  const head = peerHeading(peer, 'coach');
  const coachName = head.isName ? head.text : null;

  const [rows, setRows] = useState<SessionRequest[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [busy, setBusy] = useState(false);

  const [dayIdx, setDayIdx] = useState(1);
  const [hour, setHour] = useState(18);
  const [minute, setMinute] = useState(0);
  const [length, setLength] = useState(60);
  const [note, setNote] = useState('');

  const waitingToSend = outbox?.countOf('session-request') ?? 0;

  /**
   * A KNOWN absence of a coach, which is a different thing from an unread one.
   *
   * `coachLinked` is `boolean | null` and its own header says so: "null means
   * unread, never 'no coach'". Only the explicit false closes this screen down;
   * under null the ask is still offered, because withdrawing the one route to a
   * coach on the strength of a read that did not land costs the member more
   * than the wasted tap it would save.
   */
  const noCoach = cd.coachLinked === false;

  const load = useCallback(async () => {
    const out = await fetchMyRequests();
    setRows(out.rows);
    setStatus(out.status);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // The requests already sent — including one the coach has just answered —
  // and the booked sessions the picker greys out against.
  const pull = usePullToRefresh(useCallback(() => {
    void load(); void refreshSessions();
  }, [load, refreshSessions]));

  /** Today at midnight, local, and the days after it. Built from the device's
   *  own calendar rather than by adding 86,400,000 to an instant, so a day that
   *  is 23 or 25 hours long across a clock change is still one day. */
  const days = useMemo(() => {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Array.from({ length: DAYS_OFFERED }, (_, i) =>
      new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
  }, []);

  const chosen = days[dayIdx] ?? days[0];
  const startsAt = chosen ? instantAt(chosen, hour, minute) : '';

  const dayLabel = (d: Date) => d.toLocaleDateString(appLocale(), { weekday: 'short' });
  const dateLabel = (d: Date) => d.toLocaleDateString(appLocale(), { day: 'numeric' });
  const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' });
  /** The whole time, for the quarter pills' spoken label. ":15" on its own tells
   *  a screen-reader user nothing about what they are choosing. */
  const timeLabel = (h: number, m: number) =>
    new Date(2000, 0, 1, h, m).toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' });
  /** The hour a sentence is about, written out. Never assembled around a value
   *  that might not be there — a caller with no readable instant does not draw
   *  the row at all. */
  const whenLabel = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString(appLocale(), {
      weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    });
  };

  /** The member's own booked sessions, which their app can see. Asking across
   *  one is a mistake worth catching here — the server checks the COACH's
   *  diary, and the member's own is theirs. */
  const myBusy = useMemo(
    () => sessions.filter((s) => s.status === 'booked' && s.clientId === cd.id)
      .map((s) => ({ startsAt: s.startsAt, durationMin: s.durationMin })),
    [sessions, cd.id],
  );

  /** Said where the button is when that list is not the member's whole diary.
   *  Null under a whole read, which is the only state in which the absence of a
   *  clash is a fact rather than a silence. */
  const diaryNote = ownDiaryNote(sessionsStatus);

  const live = useMemo(() => rows.filter((r) => isLive(r)), [rows]);
  const blocker = askBlocker(startsAt, length, Date.now(), { myBusy, live });

  async function ask() {
    if (blocker) { Alert.alert('Not sent', blocker); return; }
    const when = whenLabel(startsAt);
    if (!when) { Alert.alert('Not sent', 'That time could not be read. Pick the day and the time again.'); return; }
    setBusy(true);
    const words = note.trim() || null;
    const res = await askForSession(startsAt, length, words);
    setBusy(false);

    if (!res.ok) {
      // A refusal the server actually made is final: the same bytes get the
      // same answer, so it is not queued and the sentence does not pretend
      // otherwise. Only an unanswered write is kept.
      if (res.reason) { Alert.alert('Not sent', askRefusalNote(res.reason)); await load(); return; }
      if (!outbox) { Alert.alert('Not sent', notKeptNote('request', 'unavailable')); return; }
      const { result } = await outbox.enqueue(
        'session-request',
        { startsAt, durationMin: length, note: words },
        // The hour it asks for. The same boundary the server enforces and the
        // same one EXPIRY_RULE states — see src/lib/recordQueue.ts.
        { expiresAt: sessionRequestExpiry(startsAt) },
      );
      if (result !== 'queued') {
        Alert.alert('Not sent', notKeptNote('request', result === 'full' ? 'full' : 'unavailable'));
        return;
      }
      // Deliberately NOT followed by a reload that would draw it in the list
      // below. That list is the server's answer, and a row there says the coach
      // has been asked — which is exactly what has not happened.
      Alert.alert('Saved on this phone', keptOnPhoneNote('request'));
      return;
    }

    setNote('');
    await load();
    // 'bookings', so a coach who has muted chat still hears about this one —
    // the same category the booking push uses, because it is the same part of
    // their working day. `sendPushChecked` rather than `sendPush`, because a
    // screen built on the latter can only ever claim success.
    // The coach the SERVER says was asked, not one this screen worked out.
    // `request_session` resolves `clients.trainer_id` itself, and a phone that
    // guessed — from a session on the calendar, say — could page somebody who
    // was never asked anything.
    const push = res.trainerId
      ? await sendPushChecked([res.trainerId], 'A session request',
        `A client asked about ${when}.`, { route: '/(trainer)/sessions' }, 'bookings')
      : { ok: false };
    const lines = [askedConfirmation(when, coachName)];
    if (!push.ok) {
      lines.push('We couldn’t send them a notification, so they may not see it until they open the app. Message them if it’s soon.');
    }
    Alert.alert('Request sent', lines.join('\n\n'), [{ text: 'OK' }]);
  }

  function takeBack(r: SessionRequest) {
    const when = whenLabel(r.startsAt);
    if (!when) return;
    Alert.alert(
      'Take back this request?',
      `Your coach will no longer be asked about ${when}. Nothing was booked, so nothing is being cancelled and no session comes off your account.`,
      [
        { text: 'Leave It', style: 'cancel' },
        {
          text: 'Take It Back',
          style: 'destructive',
          onPress: async () => {
            const res = await withdrawRequest(r.id);
            await load();
            if (!res.ok) {
              Alert.alert(
                'Not taken back',
                res.reason === 'gone'
                  ? 'That isn’t a live request any more — your coach may have just answered it. The list has been refreshed.'
                  : 'That could not be taken back just now, so your coach is still being asked. Try again in a moment.',
              );
            }
          },
        },
      ],
    );
  }

  const listed = myRequests(rows);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          The padding stays at 40: the field sits well above the end of this screen, and the
          inset iOS adds already gives the focused row the room it needs to rise. Padding it
          out to a keyboard's height here would only scroll into empty space. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            {/* "With your coach" is a claim, and for a member with no coach
                linked it is a false one this screen can prove is false before
                it makes it. `coachLinked` is `boolean | null` and only the
                explicit false is acted on — see the gate below. */}
            <Text style={{ ...ty.micro, color: t.ink3 }}>
              {coachName ? `With ${coachName}` : noCoach ? 'Nobody to ask yet' : 'With your coach'}
            </Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Ask for a Time</Text>
          </View>
        </View>

        {!USE_SUPABASE ? (
          <Section>
            <Flag tone={t.ink3}>
              This build is running without the server, so there is nobody to ask. Your coach’s answer
              would come back over it.
            </Flag>
          </Section>
        ) : noCoach ? (
          /* ── nobody to ask ──────────────────────────────────────────────
             `request_session` refuses this too, and `askRefusalNote('no-coach')`
             is the sentence for that refusal — but it arrives only after
             somebody has picked a day, an hour and a length, typed a note and
             tapped a button headed "Ask My Coach". The absence of a coach is
             already known on launch (`clients.trainer_id`, surfaced as
             `coachLinked`), so it is said first instead.

             Gated on `=== false` and never on falsiness. `coachLinked` is null
             while unread, and hiding the only route to a coach on the strength
             of a read that did not land is the same mistake pointing the other
             way — and the more expensive one, because the member who most needs
             this screen is the one whose reads are failing. */
          <>
            <Section>
              <Notice kicker="BEFORE YOU CAN ASK" title="You don’t have a coach yet" note={NO_COACH_TO_ASK} />
            </Section>
            <Section>
              <Cta label="Find a Coach" onPress={() => router.push('/(client)/trainers')} wide
                a11yLabel="Find a coach to work with" />
            </Section>
          </>
        ) : (
          <>
            <Section>
              <Notice kicker="WHAT THIS DOES" title="It asks — it doesn’t book" note={NOT_A_BOOKING} />
            </Section>

            {/* ── the day ─────────────────────────────────────────────── */}
            <Section>
              <SectionHead title="DAY" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingVertical: sp.sm }}>
                {days.map((d, i) => {
                  const on = i === dayIdx;
                  return (
                    <Pressable
                      key={d.toISOString()}
                      onPress={() => setDayIdx(i)}
                      hitSlop={hitSlopFor(MIN_TARGET)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={d.toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
                      style={{
                        minWidth: MIN_TARGET, minHeight: MIN_TARGET,
                        paddingHorizontal: sp.md, paddingVertical: sp.sm,
                        borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: on ? t.brand : t.surface2,
                        borderWidth: on ? 0 : hairline, borderColor: t.ring,
                      }}
                    >
                      <Text style={{ ...ty.micro, color: on ? t.brandInk : t.ink3 }}>{dayLabel(d)}</Text>
                      <Text style={{ ...ty.body, fontWeight: '600', color: on ? t.brandInk : t.ink }}>{dateLabel(d)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Section>

            {/* ── the hour ────────────────────────────────────────────── */}
            <Section>
              <SectionHead title="TIME" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, paddingVertical: sp.sm }}>
                {HOURS.map((h) => {
                  const on = h === hour;
                  return (
                    <Pressable
                      key={h}
                      onPress={() => setHour(h)}
                      hitSlop={hitSlopFor(MIN_TARGET)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={hourLabel(h)}
                      style={{
                        minWidth: MIN_TARGET + 24, minHeight: MIN_TARGET,
                        alignItems: 'center', justifyContent: 'center',
                        paddingHorizontal: sp.sm, borderRadius: radius.sm,
                        backgroundColor: on ? t.brand : t.surface2,
                        borderWidth: on ? 0 : hairline, borderColor: t.ring,
                      }}
                    >
                      <Text style={{ ...ty.body, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink }}>{hourLabel(h)}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* ── the quarters ────────────────────────────────────────────
                  Hours alone could not ask for the 07:15 a coach actually
                  offers: a range generates slots on every quarter and the
                  coach's own Add Session grid has had these since it was
                  written, so a client restricted to the hour could only ever
                  ask for a quarter of the times that exist. */}
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                {REQUEST_MINUTES.map((m) => {
                  const on = m === minute;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setMinute(m)}
                      hitSlop={hitSlopFor(MIN_TARGET)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      // The WHOLE time, not ":15" — a row of four pills each
                      // announcing a bare minute tells a screen-reader user
                      // nothing about what they are choosing.
                      accessibilityLabel={timeLabel(hour, m)}
                      style={{
                        flex: 1, minHeight: MIN_TARGET,
                        alignItems: 'center', justifyContent: 'center',
                        borderRadius: radius.sm,
                        backgroundColor: on ? t.brand : t.surface2,
                        borderWidth: on ? 0 : hairline, borderColor: t.ring,
                      }}
                    >
                      <Text style={{ ...ty.body, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink }}>
                        :{String(m).padStart(2, '0')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            {/* ── how long ────────────────────────────────────────────── */}
            <Section>
              <SectionHead title="HOW LONG" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, paddingVertical: sp.sm }}>
                {LENGTHS.map((m) => {
                  const on = m === length;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setLength(m)}
                      hitSlop={hitSlopFor(MIN_TARGET)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${m} minutes`}
                      style={{
                        minWidth: MIN_TARGET + 24, minHeight: MIN_TARGET,
                        alignItems: 'center', justifyContent: 'center',
                        paddingHorizontal: sp.sm, borderRadius: radius.sm,
                        backgroundColor: on ? t.brand : t.surface2,
                        borderWidth: on ? 0 : hairline, borderColor: t.ring,
                      }}
                    >
                      <Text style={{ ...ty.body, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink }}>{m} min</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            {/* ── their own words ─────────────────────────────────────── */}
            <Section>
              <SectionHead title="ANYTHING TO ADD" note="Optional" />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Legs, if you have the rack free"
                placeholderTextColor={t.ink3}
                multiline
                maxLength={REQUEST_NOTE_MAX}
                accessibilityLabel="A note for your coach"
                style={{
                  ...ty.body, color: t.ink, backgroundColor: t.surface2,
                  borderRadius: radius.sm, borderWidth: hairline, borderColor: t.ring,
                  padding: sp.md, minHeight: 88, textAlignVertical: 'top',
                }}
              />
            </Section>

            <Section>
              {/* The refusal is shown where the button is, in a sentence about
                  what the member did — not as an alert after the tap. */}
              {blocker ? <Flag tone={t.warn} style={{ marginBottom: sp.sm }}>{blocker}</Flag> : null}
              {/* The clash check above is the only one of the member's own
                  calendar that exists — part 740 refuses on the COACH's diary
                  and deliberately says nothing about the client's. So a
                  sessions read that failed makes `myBusy` empty and turns that
                  check into silence, which reads exactly like "you are free".
                  Said here rather than swallowed, because the cost is two
                  sessions at one hour and two credits drawn at delivery. */}
              {diaryNote ? <Flag tone={t.warn} style={{ marginBottom: sp.sm }}>{diaryNote}</Flag> : null}
              <Cta
                label={busy ? 'Sending…' : 'Ask My Coach'}
                onPress={ask}
                disabled={busy || !!blocker}
                wide
                a11yLabel="Ask your coach for this time"
              />
            </Section>

            <Section>
              <Notice kicker="IF NOBODY ANSWERS" title="It lapses on its own" note={EXPIRY_RULE} />
            </Section>

            {/* ── what has become of the ones already asked ───────────── */}
            <Section>
              <SectionHead title="YOUR REQUESTS" />

              {/* A request on this phone that the server has not taken. It has
                  to be SAID, because the list below cannot show it: a row there
                  means the coach has been asked, and a queued one means they
                  have not. */}
              {outboxNote(waitingToSend, 'session-request') ? (
                <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                  {outboxNote(waitingToSend, 'session-request')} Until then your coach has not been asked, and it is not in the list below.
                </Flag>
              ) : null}

              {/* Loading, failed and empty are three different sentences. An
                  unread list rendered as "you haven't asked for anything" is
                  the failure this whole codebase keeps having to take back. */}
              {status === 'error' ? (
                <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                  Your requests could not be read just now, so this is not a list of what you have asked
                  for. Check again when you have signal.
                </Flag>
              ) : status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Reading what you have asked for.</Text>
              ) : listed.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                  You haven’t asked your coach for a time yet.
                </Text>
              ) : (
                <>
                  {status === 'partial' ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                      There are more requests than fitted in one read, so this is the most recent of them
                      rather than all of them.
                    </Flag>
                  ) : null}
                  {listed.map((r, i) => {
                    const when = whenLabel(r.startsAt);
                    // No readable hour, no row. A sentence assembled around a
                    // dash is worse than a row that is not drawn.
                    if (!when) return null;
                    const o = outcomeOf(r);
                    return (
                      <View key={r.id}>
                        {i ? <Rule /> : null}
                        <View style={{ paddingVertical: sp.md }}>
                          <Text style={{ ...ty.micro, color: t.ink3 }}>{OUTCOME_LABEL[o]}</Text>
                          <Text style={{ ...ty.body, fontWeight: '600', color: t.ink, marginTop: 2 }}>{when}</Text>
                          <Text style={{ ...ty.caption, color: t.ink2, marginTop: 4 }}>{outcomeLine(r, when)}</Text>
                          {r.note ? (
                            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>You said: {r.note}</Text>
                          ) : null}
                          {o === 'asked' ? (
                            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                              <Ghost label="Take It Back" onPress={() => takeBack(r)} />
                            </View>
                          ) : null}
                          {o === 'accepted' ? (
                            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                              <Ghost label="See It on My Calendar" onPress={() => router.push('/(client)/calendar')} />
                            </View>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </>
              )}
            </Section>

            {/* Only over a whole read. A count off a truncated or failed one is
                a figure about an unknown fraction of the set — see isWhole. */}
            {isWhole(status) && listed.length ? (
              <Section>
                <Card>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {live.length === 0
                      ? 'Nothing is waiting on your coach.'
                      : live.length === 1
                        ? '1 request is waiting on your coach.'
                        : `${live.length} requests are waiting on your coach.`}
                  </Text>
                </Card>
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
