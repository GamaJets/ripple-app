// Client · Standing Appointments. The same hour with the same coach every week,
// and the way out of it.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// `supabase/parts/135-a-standing-appointment.sql` stores the ARRANGEMENT and a
// daily job writes it out as ordinary booked sessions eight weeks ahead. Both
// halves of the feature shipped for the coach: `my_session_series()` and
// `end_session_series()` are scoped by `auth.uid()` and answer for EITHER
// party, and part 135 says in as many words that either party may end one —
// "an agreement one side cannot leave is not one". The client app had neither.
//
// So a member with a standing Tuesday at seven watched sessions appear on their
// calendar, week after week, from a thing they could not see, could not name
// and could not leave. The only exit they had was to cancel each occurrence one
// at a time — which is the single most expensive way to do it, because each of
// those is an ordinary cancellation and each one inside the coach's notice
// window records its own late fee.
//
// ── THE RULE THIS SCREEN IS BUILT AROUND ──────────────────────────────────
//
// CANCELLING ONE OCCURRENCE AND ENDING THE ARRANGEMENT ARE DIFFERENT ACTS WITH
// DIFFERENT PRICES, AND THEY ARE NEVER COLLAPSED INTO ONE BUTTON.
//
//   · Cancelling one occurrence is an ordinary cancellation. It goes through
//     `cancel_my_session` (part 126) by way of `cancelBookedSession`, the same
//     helper the Book screen and My Bookings call, so the same tap on the same
//     session costs the same money wherever it was made. Inside the notice
//     window it records ONE late fee. The rest of the arrangement is untouched.
//   · Ending the arrangement charges NOTHING, ever, under every policy and
//     every notice window, and it deliberately LEAVES THE NEXT OCCURRENCE
//     BOOKED. "We'll stop after next Tuesday" is what ending a standing
//     appointment means to the two people in it.
//
// Both are offered together, each with what confirming it actually does written
// above its own button, and NEITHER IS THE DEFAULT. The only emphasised control
// on the sheet is the one that changes nothing. A member who taps "cancel" and
// silently ends an agreement, or who ends one and is unexpectedly billed, is
// the failure this screen exists to prevent.
//
// The words are `cancelOptions` in src/lib/recurring.ts rather than anything
// written here. That module is what src/lib/recurring.test.ts holds the promise
// against — ninety combinations of policy, window and count, none of which may
// charge for an ending — and a screen that phrased it itself would be free to
// drift from the thing being tested. Unlike the coach's copy of this sheet,
// `occurrenceDetail` IS the right voice here: it was written for the client,
// and it is their coach's policy and their money it describes.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Alert, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Flag, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric } from '../../src/theme/scale';
import { useRecurringSeries, deviceTimeZone } from '../../src/ui/availability';
import {
  cancelOptions, seriesLabel, RECURRING_CREDIT_NOTE, SERIES_HORIZON_DAYS,
  type CancelOption, type RecurringSeries,
} from '../../src/lib/recurring';
import {
  useSessions, cancelBookedSession, ptCancelLines, useCancellationPolicy, cancelWarningFor,
} from '../../src/ui/sessions';
import { useClientData } from '../../src/ui/clientData';
import { peerHeading } from '../../src/lib/threadPeer';
import { useThreadPeerName } from '../../src/ui/messaging';
import type { TrainingSession } from '../../src/lib/types';
import type { CancellationPolicy } from '../../src/lib/booking';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The reader's own clock, deliberately. `nextAt` is an instant — the moment the
// session starts — and the member is being told when to turn up, which is a
// time where they are standing. The WEEKLY hour beside it is the opposite case
// and is handled the opposite way: see `seriesLabel` and the zone line below.
const timeLabel = (iso: string) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
};
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const today = new Date(); const tm = new Date(); tm.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tm.toDateString()) return 'Tomorrow';
  return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
};

export default function StandingAppointments() {
  const t = useTheme();
  const router = useRouter();

  // One hook, both apps. `my_session_series()` is scoped by auth.uid() and
  // answers for whichever party is asking, so the arrangement this member sees
  // is the row their coach sees and the two cannot come to disagree about what
  // was agreed.
  const { series, status: seriesStatus, reload: reloadSeries, end: endSeries } = useRecurringSeries();
  // The occurrences themselves. A standing appointment's next session is an
  // ordinary booked session in `sessions`, which is why cancelling one needs
  // nothing this screen invented.
  const { sessions, status: sessionsStatus, cancelMyBooking, refresh: refreshSessions } = useSessions();
  const { policy: cancelPolicy, status: policyStatus } = useCancellationPolicy();
  const cd = useClientData();

  // TF-32: the coach's name comes from the thread peer, never from
  // `useCoachProfile()` — that provider reads the SIGNED-IN user's profile, so
  // on the client app it resolves to the reader and every "with <name>" on this
  // screen would have named the member themselves.
  const peer = useThreadPeerName('client', null);
  const head = peerHeading(peer, 'coach');
  const coachName = head.isName ? head.text : null;

  const [endFor, setEndFor] = useState<RecurringSeries | null>(null);
  const [busy, setBusy] = useState(false);

  // A series ended, or an occurrence cancelled, on the coach's phone changes
  // what is true here. BOTH reads are refreshed on focus, not just the
  // arrangements: "Cancel that session only" has to find the concrete session
  // row, and a calendar read taken before the coach moved something is how that
  // button ends up disabled — or worse, aimed at a session that is gone.
  useFocusEffect(useCallback(() => {
    void reloadSeries();
    void refreshSessions();
  }, [reloadSeries, refreshSessions]));

  const devTz = deviceTimeZone();
  const standing = series.filter((s) => s.active);
  const endedCount = series.length - standing.length;

  /** Who the arrangement is with. `my_session_series` hands the CLIENT null for
   *  `client_name` on purpose — they are looking at their own arrangement and
   *  do not need to be told their own name — so the coach's name comes from the
   *  one read that resolves it, or the row says "your coach" and means it. */
  const withWhom = coachName ? `with ${coachName}` : 'with your coach';

  /**
   * The concrete booked session that the next occurrence IS.
   *
   * A series row knows WHEN the next one starts; cancelling it needs the row
   * itself, because an occurrence is an ordinary session and goes down the
   * ordinary path. Matched on the instant and this member's own id rather than
   * guessed at, and null is a real answer the sheet handles: the calendar may
   * not have been read, or that occurrence may already be gone. The option is
   * then shown WITHOUT an action and says which of those it is, rather than
   * wiring a destructive button to a hope.
   */
  const nextOccurrenceOf = (s: RecurringSeries): TrainingSession | null => {
    if (!s.nextAt) return null;
    const at = Date.parse(s.nextAt);
    if (!Number.isFinite(at)) return null;
    return sessions.find((x) => x.status === 'booked' && x.clientId === cd.id
      && Date.parse(x.startsAt) === at) ?? null;
  };

  /**
   * End it. THIS IS NOT A CANCELLATION AND IT CHARGES NOTHING.
   *
   * `end_session_series` does not go near `cancel_my_session`, and `charged`
   * comes back from the server stated as false — so the alert below reports
   * what the server did rather than what this screen believes it did.
   *
   * No effective date is passed. Part 143 made `p_effective` default to the
   * NEXT OCCURRENCE'S own date in the series' zone, so calling this the obvious
   * way now keeps the promise the sheet has just made in words. Before that fix
   * the default was TODAY and the delete is `occurrence_on > cut`, which removed
   * next Tuesday — the one session guaranteed to survive — and every screen had
   * to compute the date itself to avoid it.
   */
  const endNow = async (s: RecurringSeries) => {
    setBusy(true);
    const res = await endSeries(s.id);
    setBusy(false);
    if (!res.ok) {
      Alert.alert(
        'Still standing',
        `${seriesLabel(s)} ${withWhom} is still running — that did not save, so nothing has changed, no session has been removed and your coach has not been told.\n\n${res.error}`,
        [{ text: 'OK' }],
      );
      return;
    }
    setEndFor(null);
    // The later occurrences were deleted server-side. Every other screen in the
    // app is still drawing them off a calendar read that predates this call.
    await refreshSessions();
    const r = res.report;
    Alert.alert(
      'Standing appointment ended',
      `${seriesLabel(s)} ${withWhom} will not repeat again.\n\n`
      + (r.removed
        ? `${r.removed} later session${r.removed === 1 ? '' : 's'} ${r.removed === 1 ? 'was' : 'were'} removed from your calendar and your coach's.`
        : 'There were no later sessions on the books, so nothing was removed.')
      + '\n\n'
      // Read from the server rather than asserted here. This branch can only be
      // reached by a server that broke its own promise, and it is said out loud
      // rather than swallowed: a fee that appeared without anybody deciding to
      // charge one is the member's money and theirs to query.
      + (r.charged
        ? 'The server reported a charge against this, which it should never do — ask your coach about it before you pay anything.'
        : 'Nothing was charged for any of them, however close they were.')
      + (s.nextAt
        ? `\n\nYour next session — ${dayLabel(s.nextAt)} at ${timeLabel(s.nextAt)} — is still booked, on purpose. If you can't make that one either, cancel it on its own and your coach's notice policy prices that session alone.`
        : ''),
      [{ text: 'Done' }],
    );
  };

  /**
   * Cancel the ONE session. The ordinary cancellation, through the ordinary
   * helper, in the ordinary order.
   *
   * Not a second copy of those writes. `cancelBookedSession` is where the pack
   * credit, the waitlist promotion, the re-offer and the coach's push live, and
   * the reason it is one function is that this screen and My Bookings and the
   * Book screen already came apart once and charged different money for the
   * same tap. The sentences about the member's money come back from
   * `ptCancelLines` for the same reason.
   */
  const cancelOne = (one: TrainingSession) => {
    // Captured before the alert and passed through, so the rule the member is
    // warned under is the rule that decides whether their credit comes back.
    const asked = Date.now();
    const warn = cancelWarningFor(one.startsAt, cancelPolicy, asked);
    const doCancel = async () => {
      const out = await cancelBookedSession(one, cancelMyBooking, asked, cancelPolicy);
      if (!out.freed) {
        Alert.alert(
          'Not cancelled',
          `Your ${dayLabel(one.startsAt)} ${timeLabel(one.startsAt)} session is still booked — that did not save, so nothing has changed and you are still expected. Check your connection and try again.`,
          [{ text: 'OK' }],
        );
        return;
      }
      // The occurrence is gone from the server; the counts on this screen came
      // from a read taken before it was.
      await refreshSessions();
      void reloadSeries();
      Alert.alert('Cancelled', ptCancelLines(out, timeLabel(one.startsAt)).join('\n\n'), [{ text: 'OK' }]);
    };
    // Said again on the confirm itself, because this is the tap that can cost
    // money and the sheet behind it is about to disappear.
    const stays = ' Your standing appointment keeps running — the week after is still booked.';
    if (warn.late) {
      Alert.alert('Cancelling late', `${warn.line}${stays} Continue?`, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel anyway', style: 'destructive', onPress: () => { void doCancel(); } },
      ]);
      return;
    }
    Alert.alert('Cancel this session?', `${warn.line}${stays}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: () => { void doCancel(); } },
    ]);
  };

  /**
   * The two choices, priced.
   *
   * `policy` is null unless the read actually landed. A policy this app could
   * not read must not be reported as "no fee" — `cancelOptions` turns null into
   * the 'unknown' verdict, whose sentence says we could not read it, and that
   * is a different thing to say than "your coach doesn't charge".
   *
   * `upcoming` is the count the SERVER reports for the arrangement, never one
   * counted out of `sessions` here: this device's calendar is capped, and a
   * capped read would understate how many sessions are about to be removed.
   */
  const endPolicy: CancellationPolicy | null = policyStatus === 'ready' ? cancelPolicy : null;
  const endNext = endFor ? nextOccurrenceOf(endFor) : null;
  const options: CancelOption[] = endFor
    ? cancelOptions({ startsAt: endFor.nextAt ?? '', policy: endPolicy, upcoming: endFor.upcoming })
    : [];

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>At the gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Standing Appointments</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>
              The same hour every week, booked for you without either of you asking again.
            </Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        <Rule />

        {/* ── your arrangements ──────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your Weekly Slots"
            note={seriesStatus === 'error' ? 'Not read' : seriesStatus === 'partial' ? 'Part of the list' : undefined} />

          {/* An empty list under 'error' means the arrangements could not be
              READ. Told "you have none", a member goes and books the slot they
              already hold — see src/ui/loadStatus.ts, which is where this rule
              is written down and why. Warn is a MARK here and not the colour of
              the words: `Flag` puts the tone in a dot and the sentence in ink,
              because t.warn as text fails AA on the light palettes. */}
          {seriesStatus === 'error' ? (
            <Flag tone={t.warn}>
              Your standing appointments could not be read, so none can be listed. This is a connection problem, not a statement that you have none — any weekly slot you have agreed is still running and its sessions are still booked on your calendar and your coach’s. Nothing here has been ended.
            </Flag>
          ) : seriesStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your standing appointments…</Text>
          ) : standing.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {seriesStatus === 'partial'
                ? 'Nothing came back, but only part of the list loaded — so this is not a statement that you have none. Pull down to refresh.'
                : endedCount
                  ? `Nothing is standing right now. The ${endedCount === 1 ? 'one that has ended is' : `${endedCount} that have ended are`} not listed here.`
                  : 'You have no standing appointment. Ask your coach to set one up and the same hour is booked for you every week — neither of you has to book it again.'}
            </Text>
          ) : (<>
            {/* The rows are real; there are more of them than came back. They
                may be listed. Their number may not be reported as a total. */}
            {seriesStatus === 'partial'
              ? <PartialRead what="standing appointments" shown={standing.length} onPress={() => { void reloadSeries(); }} />
              : null}
            {standing.map((s, i) => (
              <View key={s.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{seriesLabel(s)}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {withWhom} · {s.durationMin} min · {s.upcoming
                        ? `${s.upcoming} booked ahead`
                        : 'nothing on the books ahead'}
                    </Text>
                    {s.nextAt ? (
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
                        Next {dayLabel(s.nextAt)} at {timeLabel(s.nextAt)}
                      </Text>
                    ) : null}
                    {/* The hour on a series is a wall-clock hour in the zone it
                        was AGREED in, not the zone the reader is standing in.
                        Said only when they differ — a member travelling — and
                        that is exactly when "Every Tuesday at 7:00 am" would
                        otherwise be read as seven o'clock where they are now,
                        and a session missed by half a day. */}
                    {s.tz && devTz && s.tz !== devTz ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        That time is {s.tz.split('/').pop()?.replace(/_/g, ' ')} time, where it was agreed.
                      </Text>
                    ) : null}
                  </View>
                  {/* Named for both things it opens. A button that said "End"
                      would be a button that had already chosen. */}
                  <Ghost label="Cancel or End" onPress={() => setEndFor(s)} />
                </View>
              </View>
            ))}
          </>)}
        </Section>

        <Rule />

        {/* ── what a standing appointment is, and is not ──────────────────── */}
        <Section>
          <SectionHead title="How This Works" />
          <Text style={{ ...ty.label, color: t.ink2 }}>
            Your coach agrees the slot once. Sessions are then booked for you about {Math.round(SERIES_HORIZON_DAYS / 7)} weeks
            ahead and keep going from there on their own — they appear on your calendar like any other booking, and you
            cancel one the same way you cancel anything else.
          </Text>
          {/* Why eight weeks of Tuesdays do not silently empty a ten-session
              pack. Held in src/lib/recurring.ts so the apps and the database
              cannot come to say different things about the member's credits. */}
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>{RECURRING_CREDIT_NOTE}</Text>
          {/* The policy is what the "cancel this one" button will hold them to,
              so a policy that could not be read is worth saying before they get
              as far as tapping it. Deliberately not softened into "no fee":
              that is the sentence this whole feature exists to stop being
              printed by accident. */}
          {policyStatus === 'error' ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              We couldn’t read your coach’s cancellation policy, so we can’t tell you whether cancelling a single session would cost you anything. Ending the standing appointment costs nothing either way. Check with your coach what their notice period and fee are.
            </Flag>
          ) : null}
          <View style={{ marginTop: sp.lg, alignSelf: 'flex-start' }}>
            <Ghost icon="calendar" label="See My Calendar" onPress={() => router.push('/(client)/calendar')} />
          </View>
        </Section>
      </ScrollView>

      {/* ── cancel one, or end the arrangement ────────────────────────────────
          THE TWO OPTIONS ARE NEVER COLLAPSED INTO ONE BUTTON, and neither of
          them is the default. Cancelling one occurrence is an ordinary
          cancellation of an ordinary session and may cost a late fee; ending
          the arrangement charges nothing, ever, and deliberately leaves the
          next occurrence standing. So each option carries what confirming it
          actually does, in words, above its own button — and the only
          emphasised control on the sheet is the one that changes nothing. */}
      <Modal visible={!!endFor} animationType="slide" transparent onRequestClose={() => setEndFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setEndFor(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '86%', ...elevation.e2 }}>
          {endFor ? (<>
            <Text style={{ ...ty.head, color: t.ink }}>One session, or the arrangement?</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
              {seriesLabel(endFor)} {withWhom}. These are two different things and they do two different things.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {options.map((o, i) => (
                <View key={o.scope}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{o.label}</Text>
                    {/* Printed exactly as src/lib/recurring writes it, for both
                        options. The series sentence names no amount and no
                        currency in any branch, and every branch of it says what
                        ending costs — which is nothing. The occurrence sentence
                        is the client's own: it quotes their coach's policy, in
                        their gym's currency, and says who actually collects the
                        fee. Rewording either here is how a screen comes to
                        disagree with the module the tests hold it to. */}
                    <Text style={{ ...ty.label, color: t.ink2, marginTop: 5 }}>{o.detail}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5 }}>
                      {o.affects === 1 ? 'Affects 1 booked session.' : `Affects ${o.affects} booked sessions.`}
                    </Text>
                    <View style={{ marginTop: sp.md }}>
                      {o.scope === 'series' ? (
                        <Ghost label={busy ? 'Ending…' : 'End the Standing Appointment'}
                          onPress={() => {
                            if (busy) return;
                            const s = endFor;
                            // Confirmed once more, in the words of the promise,
                            // because this ends an agreement two people made
                            // and there is no undo for it. "Keep it" is the
                            // cancel-style button: nothing here may be the
                            // one a stray tap lands on.
                            Alert.alert(
                              'End this standing appointment?',
                              `${seriesLabel(s)} will stop repeating. ${o.detail}`,
                              [
                                { text: 'Keep it', style: 'cancel' },
                                { text: 'End it', style: 'destructive', onPress: () => { void endNow(s); } },
                              ],
                            );
                          }} />
                      ) : endNext ? (
                        // The ordinary cancel path on the ordinary session. The
                        // confirm fires after the sheet has finished dismissing
                        // rather than in the same tick: an alert raised while a
                        // modal is animating away is presented from a view
                        // controller on its way out and never appears — and the
                        // tap that vanishes on THIS button is a member who then
                        // reaches for the other one.
                        <Ghost label="Cancel That Session Only"
                          onPress={() => { const one = endNext; setEndFor(null); setTimeout(() => cancelOne(one), 350); }} />
                      ) : (
                        <Flag tone={t.warn}>
                          {!endFor.nextAt
                            ? 'There is no next session on the books to cancel — either it has not been written out yet, or it has already been cancelled.'
                            : sessionsStatus === 'error'
                              ? 'Your calendar could not be read, so that session cannot be found to cancel. This is a connection problem — the session is still booked and you are still expected. Try again when you have signal.'
                              : 'That session is not among the ones this screen has loaded. Open it on your calendar and cancel it from there.'}
                        </Flag>
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
            {/* Said once more under both, because it is the half of the promise
                a member is most likely to disbelieve: they are leaving a weekly
                commitment and expect that to be the expensive thing to do. */}
            <Notice tone={t.brand} kicker="Either way"
              title="Ending it never costs anything"
              note="However close the next session is, stopping a standing appointment records no cancellation fee. Only cancelling a single session can, and only under your coach’s notice policy." />
            <View style={{ height: sp.lg }} />
            {/* The only emphasised button on the sheet is the one that does
                nothing. Neither of the two above may be the default: one of
                them ends an arrangement two people made. */}
            <Cta label="Change Nothing" wide onPress={() => setEndFor(null)} />
          </>) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
