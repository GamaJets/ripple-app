// Trainer · Class check-in. Tap each member as they arrive; the checked-in count
// is what the owner's payroll and class analytics are built from. Attendance is
// written straight to the class_roster / set_class_attendance RPCs — when there
// is no backend row the roster is empty, never invented.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every handler, param, conditional and route from the
// previous version is preserved — only the presentation changed: the two bordered
// stat boxes became the screen's one hero figure, the bordered member cards
// became hairline-separated rows, and "Waitlist" is a coloured dot beside ink
// text rather than warn-coloured text.
//
// Removed — fabricated data, not a style change:
//   · the rate field defaulted to a hardcoded "25" and the screen printed
//     "You'll be paid AED {rate × present}" as a headline figure. Nothing in the
//     app knows this trainer's per-attendee rate or currency — it is never read
//     from the gym, never stored, and never sent anywhere — so that was a payout
//     amount with no payer behind it, in a currency left over from the deleted
//     Dubai branch list. The field now starts empty and is labelled as what it
//     is: an estimate the trainer computes from a number they typed.
//   · the file header claimed "a demo roster otherwise". There is no demo
//     roster; `classRoster` returns [] when the backend has no bookings.
//
// ── The rate is now remembered, and nothing else about it has changed ──────
//
// It was `useState('')` and nothing else — not persisted anywhere at all, not
// even to this device — so a coach checking in four classes a day retyped their
// own rate four times, and the pay estimate restarted from an empty box on
// every visit. It now follows the account (`coach_prefs.class_rate`, part 129),
// self-only: no owner and no other coach can read it.
//
// What deliberately did NOT come back with it is the currency. The stored
// number is bare, the column says so, and the sentence under the field is the
// same one it had: the trainer's own arithmetic, on a number they typed, about
// a payment Repple does not make and is not told the unit of. Persisting the
// figure removes the retyping. It does not turn the estimate into a payout, and
// nothing on this screen may start printing a currency beside it.
//
// The box is also no longer written back blindly. An empty box means "unset my
// rate" and is saved as NULL; a half-typed one ("12." on the way to "12.50")
// means nothing yet and is not saved at all, because `parseFloat` would have
// called it 12 and quietly replaced a real rate mid-keystroke. And an empty box
// after a FAILED read says why it is empty, rather than looking like a coach
// who has never set one. src/lib/coachPrefs.ts holds those rules, under test.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, Ghost, fig, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { tapLight } from '../../src/ui/haptics';
import { classRoster, UNLINKED_CLASS, type RosterMember } from '../../src/lib/classAttendance';
import { parseRate, rateText, payEstimate, rateFieldNote } from '../../src/lib/coachPrefs';
import { fetchCoachPrefs, saveCoachPrefs } from '../../src/lib/coachPrefsStore';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { useAuth } from '../../src/ui/auth';
import { useFloorQueue } from '../../src/ui/floorQueue';
import {
  floorFullLine, floorPendingNote, flushResultLine, keptOfflineLine, refusedLine, registerVisibilityLine,
} from '../../src/lib/floorQueue';
import { countRegister, registerArc, registerLine } from '../../src/lib/classRegister';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useRefreshOnFocus } from '../../src/ui/refreshOnFocus';
import { BACK_ICON } from '../../src/ui/direction';

export default function ClassCheckin() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; title?: string; branch?: string }>();
  const classId = String(params.id || UNLINKED_CLASS);
  const title = String(params.title || 'Class');
  const branch = String(params.branch || '');

  // Routed to without an id, `classId` falls back to UNLINKED_CLASS — and both
  // classRoster and setAttendance refuse that id by name. The screen then
  // rendered an empty roster under "No one has booked this class yet", which is
  // a statement about a class, and offered ticks that went nowhere while the
  // footnote promised "Check-ins are saved as you tap". Neither is a claim this
  // screen can make when it was never told which class it is looking at.
  const unlinked = !params.id || classId === UNLINKED_CLASS;

  // null is not []. [] means nobody booked this class; null means the roster
  // could not be read, and the two used to render the same sentence.
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState<string | null>(null);
  // The tick a trainer is PAID on, and the gym's payroll is built from it. This
  // screen is used standing in a studio, which is where the signal is worst.
  const auth = useAuth();
  const queue = useFloorQueue(auth.user?.id ?? null);
  // Pulled out because the hook hands back a fresh object each render while the
  // callback inside it is stable.
  const flushQueue = queue.flush;
  // Send what this phone is still carrying, now. The queue is also emptied on
  // the app's own two triggers (signal back, app foregrounded) through the
  // registry in src/lib/offlineQueue.ts; this is the one a coach can press.
  // All three arms of the result are reported, because a refused tick has been
  // DROPPED rather than kept and a coach not told that will press this forever.
  //
  // Reported in a Flag rather than an Alert, because this screen deliberately
  // says everything else inline: a coach with a phone in one hand and a room in
  // front of them should not have to dismiss a dialog to get back to the
  // register.
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const sendWaiting = async () => {
    if (sending) return;
    setSending(true);
    setSentNote(null);
    try {
      setSentNote(flushResultLine(await queue.flush()));
    } finally { setSending(false); }
  };
  const [loading, setLoading] = useState(true);
  // Per-attendee pay, as the coach typed it. UNITLESS — see the header. The
  // string is what is on screen; `coach_prefs.class_rate` is what is stored.
  const [rate, setRate] = useState('');
  const [rateStatus, setRateStatus] = useState<LoadStatus>('loading');
  // True once the account's stored rate has actually come back. It gates one
  // thing only — see `persistRate`.
  const rateRead = useRef(false);
  // The coach has typed in the box. A read landing afterwards must not yank
  // what they are typing out from under them.
  const touched = useRef(false);
  const savePending = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The rate the coach has already set, read once. `fetchCoachPrefs` reports
  // its own failure rather than returning a bare null, so an empty box after a
  // refused read can say so instead of looking like a coach who never set one.
  const loadRate = useCallback(async () => {
    setRateStatus('loading');
    try {
      const { prefs, status } = await fetchCoachPrefs();
      setRateStatus(status);
      if (status === 'ready') {
        rateRead.current = true;
        // Still guarded on `touched`. A refresh must not yank the box out from
        // under a coach who is mid-type any more than the first read may.
        if (!touched.current) setRate(rateText(prefs.classRate));
      }
    } catch { setRateStatus('error'); }
  }, []);
  useEffect(() => { void loadRate(); }, [loadRate]);

  // Saved as the coach stops typing rather than on every keystroke, and the
  // timer is cleared on unmount so a half-typed rate cannot land after the
  // screen is gone.
  useEffect(() => () => { if (savePending.current) clearTimeout(savePending.current); }, []);

  /**
   * Persist what is in the box.
   *
   * Three cases, and they are three different requests:
   *
   *  · a number — save it. This is saved even when the read failed, because it
   *    is a thing the coach deliberately typed and refusing it would leave them
   *    retyping their rate exactly as before.
   *  · half-typed or mistyped ("12." on the way to "12.50", "12abc") — NOT a
   *    request. Not sent. `parseFloat` would have called both of those 12 and
   *    replaced a real rate mid-keystroke, and the coach would have found out
   *    at payroll.
   *  · empty — "unset my rate", and sent as NULL, but ONLY once the stored rate
   *    has actually been read. An empty box under a failed read is empty for a
   *    reason that has nothing to do with the coach, and writing NULL from it
   *    would delete the very rate the read could not show them.
   */
  const persistRate = (text: string) => {
    const parsed = parseRate(text);
    if (parsed.kind === 'invalid') return;
    if (parsed.kind === 'empty' && !rateRead.current) return;
    void saveCoachPrefs({ classRate: parsed.kind === 'empty' ? null : parsed.value });
  };

  const onRateChange = (text: string) => {
    touched.current = true;
    setRate(text);
    if (savePending.current) clearTimeout(savePending.current);
    savePending.current = setTimeout(() => persistRate(text), 700);
  };

  /* ── whose answer may land, and whose members may be drawn ────────────────
   *
   * `wanted` is the guard every sibling reader in this app already has —
   * src/ui/clientAttendance.ts, app/(trainer)/client-week.tsx,
   * app/(trainer)/my-register.tsx — and this screen was the one without it.
   *
   * The register is reached from the open-registers list on my-register.tsx, so
   * tapping down a list of classes starts a read per tap and they do not come
   * back in the order they went out. Tuesday's Spin (slow), back out,
   * Wednesday's HIIT: HIIT landed and drew, then Spin's answer overwrote it. The
   * header said HIIT, the hero said "Checked In 3 / 12", and the twelve members
   * listed under it were Spin's — every one of them tappable, and `toggle` sends
   * the classId this render has, so a tick on one of them was a write about a
   * Spin member against Wednesday's HIIT.
   *
   * `drawn` is the other half and does not exist on the siblings, because they
   * hold one subject's rows and this screen holds a ROOM. Dropping the late
   * answer is not enough on its own: the rows already on screen belong to the
   * previous class and stay there under the new class's title while the new read
   * is in flight. So a change of class empties the register first. `loading`
   * goes back up with it, which is the one case the note below does not cover:
   * an empty register under "Loading roster…" is the truth about a class nothing
   * has been read for yet.
   *
   * The banner goes too. `saveFailed` names a MEMBER — "Priya is still marked
   * absent" — and a sentence about somebody who was in Tuesday's Spin, left
   * standing over Wednesday's HIIT, is about a person who is not in the room.
   */
  const wanted = useRef<string | null>(null);
  const drawn = useRef<string | null>(null);

  // The rejection handler is not decoration: without it a thrown read would
  // leave `loading` true forever, and "Loading roster…" is at least honest,
  // where a silent unhandled rejection is not.
  // `loading` is deliberately NOT set back to true for a re-read of the SAME
  // class. It starts true and is cleared by the first read; a refresh that
  // raised it again would replace a register the coach is reading off in front
  // of a room with "Loading roster…", which is the one thing worse than a
  // slightly old count.
  const loadRoster = useCallback(async () => {
    wanted.current = classId;
    if (drawn.current !== classId) {
      drawn.current = classId;
      setRoster(null);
      setReadFailed(false);
      setSaveFailed(null);
      setLoading(true);
    }
    try {
      const r = await classRoster(classId);
      // The coach has moved on to another class. Dropping the answer is the
      // whole of it: the read for the class that is on screen now will set the
      // state, and this one may not.
      if (wanted.current !== classId) return;
      setRoster(r);
      setReadFailed(r === null && !unlinked);
    } catch {
      if (wanted.current !== classId) return;
      // The rows already on screen are left alone. A failed re-read is not a
      // class that emptied — `readFailed` is what says the count is unknown,
      // and blanking the register a coach is standing in front of would be the
      // worse of the two mistakes by a distance.
      setReadFailed(!unlinked);
    } finally { if (wanted.current === classId) setLoading(false); }
  }, [classId, unlinked]);
  useEffect(() => { void loadRoster(); }, [loadRoster]);

  /* ── pull to refresh ─────────────────────────────────────────────────────
   *
   * This screen is used standing in a studio with the worst signal in the
   * building, and the register it draws is written by members booking and
   * dropping the class on their own phones right up to the door. A coach whose
   * roster read failed on the way in was left with "could not be read" and no
   * way to ask again while the room filled up.
   *
   * The queued check-ins are flushed too. They are the ticks a trainer is PAID
   * on, they are sitting on this handset, and the gesture a coach reaches for
   * when they want the screen to be right about the room should not leave them
   * on it. `flush` is the same call the "Send" button makes and it is safe to
   * repeat — an empty queue sends nothing. */
  const reloadEverything = useCallback(
    () => Promise.all([loadRoster(), loadRate(), flushQueue()]),
    [loadRoster, loadRate, flushQueue],
  );
  const pull = usePullToRefresh(reloadEverything);
  /* ── and on the way back in ──────────────────────────────────────────────
   *
   * The register was read ONCE, on mount, while the room was still filling —
   * and this screen is registered `href: null` inside <Tabs>, so it stays
   * mounted between classes. A coach who opened it, stepped away to take a
   * payment, and came back was taking a register written before three people
   * booked and one dropped. Members book and cancel on their own phones right
   * up to the door; nothing else on this screen goes and looks.
   *
   * The queued check-ins flush with it, exactly as they do on the gesture: the
   * ticks a trainer is PAID on are sitting on this handset, and coming back to
   * the screen is as good a moment to send them as pulling it. */
  useRefreshOnFocus(reloadEverything);

  // Whether there is a roster to count at all. Without this the two counts
  // below are computed over `[]` and come out as 0 — and the hero then prints a
  // confident "0 / 0" over a sentence explaining that it is not a count. The
  // house rule is a dash with a reason, never a zero: a coach glancing at the
  // figure and not the note reads an unread class as an empty one.
  const counted = !unlinked && !readFailed && roster !== null;
  // ── one filter, not two ────────────────────────────────────────────────
  //
  // `present` counted EVERY ticked row and `booked` counted only the rows
  // holding a place. `classRoster` returns waitlist rows too and every row here
  // is tappable — deliberately, because a place comes free at the door and the
  // coach ticks the person in front of them — so two walk-ins pushed the two
  // numbers level while two people who had paid were still missing, and the
  // hero printed "Everyone booked is here." The ring was `present / booked` and
  // could draw more than a full circle.
  //
  // src/lib/classRegister.ts holds the counting and is tested under node. The
  // walk-ins are not discarded to fix the rate: they are real people who really
  // trained and the gym pays for them, so they are counted beside it.
  const reg = useMemo(() => countRegister(roster ?? []), [roster]);
  const present = reg.present;
  const booked = reg.booked;
  // Null unless BOTH halves are known: a rate that parses, and a check-in count
  // from a roster that was actually read. `counted` is what makes the second
  // true — see the note on the estimate below.
  const parsedRate = parseRate(rate);
  // EVERYBODY who trained, not the show-rate numerator. The hero above counts
  // booked members against booked places because that is the only honest
  // reading of a rate — but a coach is paid per attendee, and somebody who came
  // off the waitlist at the door did an hour in the room. Splitting the two
  // counts would have quietly cut this figure if it were taken from the rate.
  const attendeesPaidFor = reg.present + reg.walkIns;
  const pay = payEstimate(parsedRate.kind === 'value' ? parsedRate.value : null, counted ? attendeesPaidFor : null);
  // Only shown while the stored rate is in flight or could not be read. Under
  // 'ready' an empty box speaks for itself.
  const rateNote = rate.trim() ? null : rateFieldNote(rateStatus);

  // The tick used to move before anything was written, and `setAttendance`
  // swallowed every failure — so a refused check-in looked exactly like a saved
  // one. Attendance is what the trainer is paid on, so the row moves only once
  // this phone has actually taken responsibility for it, and the banner says
  // whether the GYM has it.
  const toggle = async (m: RosterMember) => {
    const next = !m.attended;
    tapLight();
    // ── the tick, and the basement it is usually made in ──────────────────
    //
    // `setAttendance` returns a boolean, which collapses the only two answers
    // that matter here into one: a refusal the server MADE, and a request that
    // never reached it. The screen said the same sentence for both — "that
    // change did not save" — and the coach, standing in a room with no signal,
    // was right to believe it and wrong about what to do next.
    //
    // Through the queue: a refusal is still a refusal and the row does not
    // move, and a request nobody answered is kept on this phone and goes up on
    // the next launch with signal. The row DOES move for a kept tick, because
    // it is the coach's decision and this phone now holds it — but the banner
    // says plainly that the gym cannot see it yet, because a trainer who
    // believes the gym has the attendance does not check it, and they are paid
    // on it.
    const out = await queue.attempt({
      kind: 'class-attendance', classId, userId: m.userId, memberName: m.name, present: next,
    });
    if (out === 'refused') {
      // ── and now a refusal can mean the booking is gone ────────────────────
      //
      // src/ui/floorQueue.ts used to report this write on the error alone, and
      // `set_class_attendance` is `returns void` over an update that raises
      // nothing when it matches no row. It now establishes the write instead, so
      // 'refused' has a second cause the coach can act on and a likelier one
      // than a permission: the member cancelled their place after this register
      // was read, and there is no longer a booking to mark. `cancel_class`
      // deletes the row.
      //
      // So the register is re-read rather than left standing. A list that still
      // shows somebody who has cancelled, beside a sentence saying their tick
      // did not save, invites the coach to tap them again — and it would be
      // refused again, for the same reason, for as long as the screen is open.
      setSaveFailed(refusedLine(
        `${m.name} is still marked ${m.attended ? 'present' : 'absent'} — that change`,
        classId === UNLINKED_CLASS
          ? 'This screen was opened without a class.'
          : `The usual cause is that ${m.name} no longer holds a place on this class — a cancelled booking is removed, and there is nothing left to mark. This register is being read again now.`,
      ));
      if (classId !== UNLINKED_CLASS) void loadRoster();
      return;
    }
    // Nothing was kept, so the row does not move either. A tick drawn against a
    // change this phone refused to hold is the same lie as one drawn against a
    // change the server refused, and it is the lie a trainer is paid on.
    if (out === 'full') {
      setSaveFailed(floorFullLine(`${m.name} is still marked ${m.attended ? 'present' : 'absent'} — that change`));
      return;
    }
    setRoster((p) => (p ?? []).map((x) => (x.userId === m.userId ? { ...x, attended: next } : x)));
    setSaveFailed(out === 'unsent' ? keptOfflineLine(`${m.name} marked ${next ? 'present' : 'absent'}`) : null);
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* Back leads the row and carries a label. Seen on an iPhone 17 Pro:
            it trailed, which put the one control that leaves this screen in the
            top-RIGHT corner — where iOS has never put it and where the rest of
            this app does not put it — and without `a11yLabel` a screen reader
            announced it as "button". The house form is in
            src/ui/FeedbackScreen.tsx, which carries the whole argument. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{title}{branch ? ' · ' + branch : ''}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Check-in</Text>
          </View>
        </View>

        {/* ── the hero: the count payroll is built from ───────────────────── */}
        <Hero
          label="Checked In"
          figure={fig(counted ? present : null)}
          unit={counted ? '/ ' + booked : undefined}
          note={unlinked ? 'No class was passed to this screen — this is not a count.' : loading ? 'Still reading the roster.' : registerLine(reg, counted)}
          arc={!counted ? undefined : registerArc(reg) ?? undefined}
          arcLabel="of those booked checked in"
        />

        <Rule />

        {/* ── the trainer's own estimate ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Pay Estimate" />
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 6 }}>Rate per attendee</Text>
          <TextInput value={rate} onChangeText={onRateChange} onEndEditing={() => persistRate(rate)} onBlur={() => persistRate(rate)}
            keyboardType="decimal-pad" placeholder="Your rate" placeholderTextColor={t.ink3}
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }} />
          {/* An empty box means two entirely different things and they must not
              read the same: a coach who has not set a rate, and a read that was
              refused. Silence under 'ready' is the first; a sentence under
              'error' is the second. */}
          {rateNote ? (
            rateStatus === 'error'
              ? <Flag tone={t.crit} style={{ marginTop: 6 }}>{rateNote}</Flag>
              : <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{rateNote}</Text>
          ) : null}
          {/* The arithmetic needs a real check-in count. With the roster unread
              `present` is 0, and this line rendered "25 × 0 checked in = 0" —
              a payout figure for a class the screen never managed to look at,
              in the one place on the trainer's phone that talks about money.
              `pay` is null in that case rather than 0, so there is nothing to
              print by accident. */}
          {pay != null ? (
            <Text style={{ ...ty.label, ...numeric, color: t.ink2, marginTop: sp.md }}>{rate.trim()} × {attendeesPaidFor} checked in = {pay}</Text>
          ) : rate.trim() && parsedRate.kind === 'invalid' ? (
            // Said rather than left blank: the box looks filled in, and without
            // this the missing total reads as a broken screen rather than as a
            // number the app cannot make sense of. Nothing is saved either.
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>
              That is not a rate this can multiply yet — digits and at most one decimal point. Nothing has been saved.
            </Text>
          ) : rate.trim() ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>
              {unlinked
                ? 'No class was passed to this screen, so there is nobody checked in to multiply by.'
                : loading ? 'Waiting on the roster before this is worth anything.'
                : 'The roster could not be read, so there is no check-in count to multiply — this is not zero attendees.'}
            </Text>
          ) : null}
          {/* This sentence used to say "Repple is not told your rate", which
              stopped being true the moment the rate was persisted. It is
              rewritten rather than dropped: what made it worth saying is
              untouched — the number has no currency attached, nothing is paid
              from it, and nobody else can read it. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Your own arithmetic. Your rate is kept on your account so you don't retype it — nobody else can see it, no currency is attached to it, and Repple does not process this payment. Your gym owner pays from the attendance below.
          </Text>
        </Section>

        <Rule />

        {/* What this phone is still carrying. Drawn even when the last tick
            went through, because the count is about the morning and not about
            the tap — and a queue that could not be READ is not an empty one. */}
        {!queue.queueRead ? (
          <Flag tone={t.warn} style={{ paddingTop: sp.sm }}>
            What this phone is still carrying could not be read, so whether any check-ins are waiting to go up is not known. Nothing has been lost — it is not being written over either.
          </Flag>
        ) : floorPendingNote(queue.unsent) ? (
          <>
            <Flag tone={t.warn} style={{ paddingTop: sp.sm }}>{floorPendingNote(queue.unsent)}</Flag>
            {/* The banner said something was waiting and gave no way to send
                it. The app's reconnect and foreground triggers reach this queue
                now; this is the button for a coach who has walked up out of the
                basement and wants the register gone before they forget. */}
            <View style={{ alignItems: 'flex-start', paddingTop: sp.sm }}>
              <Ghost label="Send Now" a11yLabel="Send what is waiting on this phone"
                onPress={() => { void sendWaiting(); }} />
            </View>
          </>
        ) : null}
        {sentNote ? (
          <Flag tone={t.warn} style={{ paddingTop: sp.sm }}>{sentNote}</Flag>
        ) : null}
        {saveFailed ? (
          <Flag tone={t.crit} style={{ paddingTop: sp.sm }}>{saveFailed}</Flag>
        ) : null}

        {/* ── the roster ─────────────────────────────────────────────────── */}
        <Section>
          {/* `counted` is the same fact the body under this header spells out
              in words. On a thrown re-read the previous rows are deliberately
              kept and `readFailed` is set, so a header taken from
              `roster.length` asserted that twelve members are known directly
              above a Flag saying the roster could not be read — while the coach
              is standing at the door of a full room. */}
          <SectionHead title="Members" note={counted && roster?.length ? String(roster.length) : undefined} />
          {unlinked ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              This screen was opened without a class. Nothing can be read or checked in here — open a
              class from your schedule and use its Check in button.
            </Text>
          ) : loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Loading roster…</Text>
          ) : readFailed || roster === null ? (
            <Flag tone={t.crit}>
              This class's roster could not be read, so nobody can be checked in here yet. This is
              not the same as an empty class — do not treat it as one. Leave the screen and open it
              again once you have signal.
            </Flag>
          ) : roster.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No one has booked this class yet — members appear here as they book.</Text>
          ) : (
            roster.map((m, i) => (
              <Pressable key={m.userId} onPress={() => toggle(m)} accessibilityRole="button" accessibilityLabel={m.name}
                accessibilityState={{ checked: m.attended, selected: m.attended }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: m.attended ? t.brand : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  {m.attended ? <Icon name="check" size={15} color={t.brandInk} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{m.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    {m.status === 'waitlist' ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.warn }} /> : null}
                    <Text style={{ ...ty.caption, color: t.ink3 }}>{m.status === 'waitlist' ? 'Waitlist' : m.attended ? 'Present' : 'Booked · tap when they arrive'}</Text>
                  </View>
                </View>
              </Pressable>
            ))
          )}
        </Section>

        <Rule />

        {/* Who can see the ticks that have just been made.

            This said "Your gym owner sees attendance per class for payroll and
            class analytics" unconditionally — including while the queue above
            was holding every one of them on this phone. That is rule 1 in
            src/lib/floorQueue.ts broken on the register a trainer is PAID from,
            and it is the worse of the two sentences on screen because it is the
            calm one: the banner said the ticks were waiting and this footnote
            said the gym had them, and a person believes the footnote.

            `registerVisibilityLine` has the three answers, and the third of
            them is that a queue which could not be READ cannot say either. */}
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          {unlinked
            ? 'Nothing on this screen is being saved — it was not told which class it is checking in.'
            : registerVisibilityLine(queue.unsent, queue.queueRead)}
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
