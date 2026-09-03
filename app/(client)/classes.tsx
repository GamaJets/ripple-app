// Client · Classes. Pick a branch and browse the gym's group-class schedule, then
// book or cancel. Full classes offer a waitlist; cancelling frees your seat.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero (a schedule has no single number), days as
// hairline-separated sections instead of a stack of bordered cards, and a
// coloured dot beside ink text where "Class full" used to be status-coloured
// type. The schedule itself is the gym's own — nothing is scheduled here.
import { useMemo, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useSubmitOnce } from '../../src/ui/submitOnce';
// `isCancelled` is the one place `status: undefined` is interpreted, so the
// coach's screen and this one agree about what a called-off class is. This
// screen read no status at all: a class the gym had cancelled kept its spaces
// count and its Book button, and members turned up to it.
import { classFillState, isCancelled, classesThatRan } from '../../src/lib/gymSchedule';
import { classCancelBody } from '../../src/lib/classCancel';
import { Rule, Section, SectionHead, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useClasses } from '../../src/ui/classes';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useReachability } from '../../src/ui/reachability';
import { retryLine } from '../../src/lib/reachability';
import { useSettings } from '../../src/ui/settings';
import { scheduleLocal } from '../../src/ui/pushNotifications';
import type { GymClass } from '../../src/lib/classesMock';
import { fmtRelativeDay, fmtTime } from '../../src/lib/format';

// The weekday name and the date order were this file's own. `DOW` was a
// hardcoded English array and the fallback read `${d.getDate()}/${d.getMonth() + 1}`,
// which a member in the United States reads as month-first: "Wed 9/12" is 9
// December here and 12 September there, and that string went into every cancel
// confirmation on this screen. Both are the reader's now — see
// `fmtRelativeDay` and `fmtClock` in src/lib/format.ts.
const timeLabel = (iso: string) => fmtTime(iso);
const dayLabel = (iso: string) => fmtRelativeDay(iso);

export default function Classes() {
  const t = useTheme();
  const router = useRouter();
  const { classes, myStatus, status: classStatus, book, cancel, countsKnown, cachedNote, refresh } = useClasses();
  // The timetable and this member's place in it come from one provider read, so
  // one call brings back both the classes and whether they are booked on them.
  const pull = usePullToRefresh(useCallback(() => { void refresh(); }, [refresh]));
  // Whether this phone can reach us at all. It decides which second half every
  // failure sentence on this screen gets.
  const reach = useReachability();
  // The class reminder below is a notification, so it answers to the switch on
  // the Settings screen like every other one. That switch used to be wired to
  // nothing at all; now that it means something, a member who has turned
  // notifications off must not be told "we'll remind you an hour before" —
  // which is the sentence this screen has always printed, unconditionally.
  const { notifPush } = useSettings();
  const [branch, setBranch] = useState<string | null>(null);

  const branches = useMemo(() => Array.from(new Set(classes.map((c) => c.branch).filter(Boolean))).sort(), [classes]);
  const filtered = useMemo(() => classes.filter((c) => branch === null || c.branch === branch), [classes, branch]);

  const byDay = useMemo(() => {
    const groups: { key: string; label: string; items: GymClass[] }[] = [];
    const map = new Map<string, GymClass[]>();
    for (const c of [...filtered].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
      const k = new Date(c.startsAt).toDateString();
      if (!map.has(k)) { map.set(k, []); groups.push({ key: k, label: dayLabel(c.startsAt), items: map.get(k)! }); }
      map.get(k)!.push(c);
    }
    return groups;
  }, [filtered]);

  // One booking at a time — `send.busy` disables every Book button on the
  // screen while one is in flight, because a seat is a scarce thing and two
  // requests racing is how a member ends up in two classes at once. `booking`
  // is which class that is, so only the row actually being booked says
  // "Booking…" — the others are simply not pressable, rather than all claiming
  // to be doing something.
  const [booking, setBooking] = useState<string | null>(null);
  const send = useSubmitOnce('classes.book');

  const onBook = async (c: GymClass) => {
    const st = await book(c.id);
    // book() now returns null when the server refused the seat. That used to
    // fall into the else below, so the client was told "Booked", got a local
    // reminder an hour before, and turned up to a class with no seat.
    if (st === null) {
      // A booking is deliberately NOT queued for later. A seat is a scarce
      // thing somebody else can take, and "we will book you when you have
      // signal" is a promise this app cannot keep — forty minutes later the
      // class is full and the member has arranged their evening around a place
      // they never had. See src/lib/outbox.ts on which writes may wait.
      // What CAN be improved is saying why, which is what `retryLine` does.
      Alert.alert('Not booked', `We could not get you into ${c.title}. Nothing has been reserved. ${retryLine(reach)}`);
      return;
    }
    if (st === 'waitlist') Alert.alert('Added to waitlist', `${c.title} is full — you're on the waitlist and we'll move you up if a spot opens.`);
    else {
      // ── the sentence is decided by what actually happened ────────────────
      //
      // It used to be decided by `notifPush` alone, over a call whose answer
      // was thrown away. `scheduleLocal` resolves null in three cases this
      // screen never asked about: no notifications module, the member's own
      // 'classes' switch turned off — which the comment below introduces five
      // lines before the promise it belonged to — and a time already in the
      // past. So a member booking a 6pm class at half past five, and a member
      // who muted class reminders while keeping everything else, both read a
      // promise the app had already declined to keep. They stop watching the
      // clock because they were told something would. A missed class is a
      // missed class, and at most gyms it is a no-show charge too.
      const when = new Date(Date.parse(c.startsAt) - 60 * 60 * 1000);
      const tooLate = when.getTime() <= Date.now();
      // Category 'classes' — its own switch, separate from session reminders
      // and separate from anything the coach sends. "A member's only way to
      // stop 6am class reminders was to stop hearing from their coach" is the
      // report this closes. Quiet hours do not apply: the class is at 6am
      // because they booked it at 6am.
      const armed = notifPush
        ? await scheduleLocal(`${c.title} in 1 hour`, `${timeLabel(c.startsAt)} at ${c.branch}${c.room ? ' · ' + c.room : ''} with ${c.instructor}.`, when, { route: '/(client)/bookings' }, 'classes')
        : null;
      // Four outcomes, four sentences. A member who has switched notifications
      // off is told the booking is theirs and that nothing will arrive to
      // remind them, which is what makes the switch trustworthy rather than
      // merely obeyed — and the same courtesy is now extended to the other
      // three ways there is no reminder.
      const reminder = armed
        ? " We'll remind you an hour before."
        : !notifPush
        ? ' Notifications are off, so there will be no reminder.'
        : tooLate
        ? ' It starts in under an hour, so there is no reminder — head over.'
        : ' We could not set a reminder for this one, so nothing will arrive. Check your class reminders in Settings, or set your own alarm.';
      Alert.alert('Booked', `You're in for ${c.title} at ${c.branch}, ${dayLabel(c.startsAt)} ${timeLabel(c.startsAt)}.` + reminder);
    }
  };
  const onCancel = (c: GymClass) => {
    // `cancel()` resolves false when the server did not take the cancellation,
    // and that answer was being thrown away here — the exact mirror of the
    // book() bug fixed directly above, and the same shape of harm pointing the
    // other way.
    //
    // useClasses().cancel drops the seat off this screen FIRST and puts it back
    // when the write does not land (see the `restore` closure in
    // src/ui/classes.tsx). So a refused cancellation showed the member their
    // seat disappear, then quietly reappear, with no sentence anywhere saying
    // which of the two was true. They stop turning up, and the gym charges the
    // no-show. app/(client)/calendar.tsx has awaited its release and said so
    // since the re-offer fix; this now does the same.
    const doCancel = async () => {
      const wasWaitlist = myStatus[c.id] === 'waitlist';
      if (await cancel(c.id)) return;
      // The second half of each sentence used to be "Check your connection and
      // try again" whatever had happened. Half the time it is wrong: the server
      // read the cancellation and declined it, and sending somebody to their
      // wifi settings hides that. `retryLine` says which — see
      // src/lib/reachability.ts, which is how this app knows the difference
      // without a native connectivity module.
      Alert.alert(
        wasWaitlist ? 'Still on the waitlist' : 'Not cancelled',
        wasWaitlist
          ? `You are still on the waitlist for ${c.title} — that did not save, so nothing has changed. ${retryLine(reach)}`
          : `Your seat in ${c.title} on ${dayLabel(c.startsAt)} at ${timeLabel(c.startsAt)} is still booked — that did not save, so nothing has changed and the gym still expects you. ${retryLine(reach)}`,
        [{ text: 'OK' }],
      );
    };
    // What cancelling costs, or rather that this app cannot say. The PT path
    // states a notice period, a fee and a currency, and says so plainly when
    // the policy could not be read; this path — the one the gym actually bills
    // — said nothing at all, and silence reads as free. See
    // src/lib/classCancel.ts for why no notice window is invented here.
    Alert.alert('Cancel booking?', classCancelBody(`${c.title} · ${c.branch} · ${dayLabel(c.startsAt)} ${timeLabel(c.startsAt)}`, c.startsAt), [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: () => { void doCancel(); } },
    ]);
  };

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: active ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: active ? '600' : '500', color: active ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>At the gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Classes</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Pick your location and book a spot. Full classes have a waitlist.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* The other half of the same subject, and the half the member has never
            had: this screen is what is COMING, and app/(client)/attendance.tsx
            is what already happened. The gym has held that record from both ends
            — the register a coach ticks and the door log in `gym_visits` — and
            until now only the gym could read it. Put here rather than only on a
            tab because a member wondering whether to book a class is the same
            member wondering how often they have actually been coming. */}
        <View style={{ flexDirection: 'row', gap: sp.sm, flexWrap: 'wrap', marginTop: sp.lg }}>
          <Ghost label="My Attendance" onPress={() => router.push('/(client)/attendance')} />
          {/* Money and seats, kept apart on purpose.
              A place in a class is scarce and a payment is a second act that
              can fail on its own, so nothing on this screen charges anybody:
              booking stays the immediate, loud, money-free write it already is,
              and what a member buys is a CREDIT — a drop-in or a class pack —
              which the gym can issue any number of and which nobody else can
              take while a card is being typed. The full argument is at the top
              of src/lib/memberBuy.ts, and src/lib/outbox.ts refuses to queue a
              booking for the same family of reasons. */}
          <Ghost label="Buy a Pass" onPress={() => router.push('/(client)/gym-plans')} />
        </View>

        {branches.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: sp.lg }} contentContainerStyle={{ gap: sp.sm }}>
            {chip('All branches', branch === null, () => setBranch(null))}
            {branches.map((b) => chip(b, branch === b, () => setBranch(b === branch ? null : b)))}
          </ScrollView>
        ) : null}

        {/* The timetable came off this phone, not off the server. Said once,
            above the list, because a member reading a cached timetable as a
            live one turns up to a class that was cancelled yesterday — and the
            counts are withheld entirely in that state (see `countsKnown` in
            src/ui/classes.tsx), so nothing here claims a class has spaces. */}
        {cachedNote ? <Flag tone={t.warn} style={{ marginTop: sp.lg }}>{cachedNote}</Flag> : null}

        {byDay.map((g) => (
          <View key={g.key}>
            <Rule />
            <Section>
              {/* A count of what came back, printed as a count of what is on.
                  Under 'partial' the timetable stops at the row cap without
                  saying so, and "Tuesday · 4 classes" over nine running classes
                  is the same wrong answer as any other subtotal wearing the
                  name of a total — with the difference that a member reads this
                  one and decides there is nothing worth booking. */}
              {/* Cancelled classes are listed — a member who booked one has to
                  see it — and are not COUNTED. "Tuesday · 4 classes" over three
                  running ones and a called-off one is a count of rows rather
                  than a count of classes anybody can attend. */}
              <SectionHead title={g.label}
                note={classStatus === 'ready'
                  ? `${classesThatRan(g.items).length} class${classesThatRan(g.items).length === 1 ? '' : 'es'}`
                  : classStatus === 'partial' ? 'Not all read' : undefined} />
              {g.items.map((c, i) => {
                const mine = myStatus[c.id];
                // Called off by the gym. Everything below branches on it: there
                // are no spaces in a class that is not running, and there is
                // nothing to book.
                const off = isCancelled(c);
                // `booked` is 0 for every class until the count RPC fills it
                // in. When that failed, subtracting it would advertise a full
                // class as completely empty, so no claim is made about spaces.
                const spotsLeft = countsKnown ? Math.max(0, c.capacity - c.booked) : null;
                const fill = countsKnown ? classFillState(c.capacity, c.booked) : null;
                const full = fill === 'full';
                return (
                  <View key={c.id}>
                    {i > 0 ? <Rule /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>{c.kind}</Text>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: 3 }}>{c.title}</Text>
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{timeLabel(c.startsAt)} · {c.durationMin}m · {c.instructor} · {c.branch}{c.room ? ' · ' + c.room : ''}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                          {/* The mark carries the urgency; the words keep the
                              exact count. A class with two spots left and one
                              with twelve were the same grey dot, so the one
                              about to go looked like the one nobody wants. */}
                          <View style={{ width: 6, height: 6, borderRadius: 3,
                            backgroundColor: off ? t.crit : mine ? t.brand : full ? t.s3 : fill === 'nearly' ? t.warn : t.ink3 }} />
                          <Text style={{ ...ty.caption, color: t.ink2 }}>{off
                            ? (mine ? 'Cancelled by the gym — you were booked in' : 'Cancelled by the gym')
                            : mine === 'waitlist' ? 'On the waitlist' : mine ? 'Booked' : spotsLeft == null ? 'Spaces unknown' : full ? 'Class full' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}</Text>
                        </View>
                      </View>
                      {/* No control at all on a class that is not running.
                          Booking one is not a thing the gym can honour, and
                          "Cancel" on a class the gym has already called off
                          offers to undo something that has already happened. */}
                      {off ? null : mine ? (
                        <Ghost label={mine === 'waitlist' ? 'Leave Waitlist' : 'Cancel'} onPress={() => onCancel(c)} />
                      ) : (
                        // Guarded. A seat is a scarce thing and `book` is a
                        // server round trip with no feedback on the button
                        // while it runs, so a member who taps again puts a
                        // second registration in — and at most gyms an unused
                        // seat is a no-show charge. See src/lib/submitOnce.ts.
                        <Cta label={booking === c.id ? (full ? 'Joining…' : 'Booking…') : full ? 'Join Waitlist' : 'Book'}
                          disabled={send.busy}
                          onPress={() => send.run(async () => {
                            setBooking(c.id);
                            try { await onBook(c); } finally { setBooking(null); }
                          })} />
                      )}
                    </View>
                  </View>
                );
              })}
            </Section>
          </View>
        ))}

        {filtered.length === 0 ? (
          <View style={{ paddingTop: sp.huge, alignItems: 'center' }}>
            {/* An empty timetable under a failed read is not an empty
                timetable. A member reading "no classes scheduled" does not turn
                up to one that is running. */}
            <Text style={{ ...ty.head, color: t.ink, textAlign: 'center' }}>
              {classStatus === 'error' ? 'The timetable could not be read'
                : classStatus === 'loading' ? 'Loading'
                // 'partial' was the one status with no branch. With a branch
                // filter over a capped timetable, `filtered.length === 0` is
                // reachable while classes ARE running at that branch — they
                // simply fell past the row limit — and "No classes scheduled at
                // Shoreditch yet" is exactly the sentence that stops a member
                // turning up to one.
                : classStatus === 'partial' ? 'More timetable than we can read at once'
                : `No classes scheduled${branch ? ' at ' + branch : ''} yet`}
            </Text>
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: 6, maxWidth: 300 }}>
              {/* 'partial' had no branch here either, so it inherited the
                  'ready' sentence and told the member their gym has not added
                  any classes — directly under a heading saying the opposite.
                  Two sentences in one empty state contradicting each other is
                  worse than either alone: the reader picks the one that sounds
                  like an answer, and the one that sounds like an answer is the
                  wrong one. */}
              {classStatus === 'error'
                ? 'This is not a statement that your gym has none on. Check again when you have signal.'
                : classStatus === 'loading' ? ''
                : classStatus === 'partial'
                  ? 'Your gym has more classes on than we can read in one go, and the ones for this filter were not among them. Clear the filter or check again in a moment.'
                  : 'Classes appear here as soon as your gym adds them to the schedule.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
