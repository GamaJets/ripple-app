// Client · Classes. Pick a branch and browse the gym's group-class schedule, then
// book or cancel. Full classes offer a waitlist; cancelling frees your seat.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero (a schedule has no single number), days as
// hairline-separated sections instead of a stack of bordered cards, and a
// coloured dot beside ink text where "Class full" used to be status-coloured
// type. The schedule itself is the gym's own — nothing is scheduled here.
//
// Round five (the look the owner approved) changed that paragraph's picture and
// none of its rules: the screen now opens on a night hero card for the next
// class the member HOLDS, when there is one; days are cards on the grey ground;
// each class carries a purple plate, its state as a toned chip and — only where
// the count was read — how full it is as a meter. Same reads, same gates.
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
// The member's own row against a class, read as the four words it can now hold
// rather than as a truthy string. supabase/parts/3060 stopped a cancellation
// being a DELETE, so the member's row survives a cancellation with status
// 'cancelled' — and this screen read every truthy status as a held seat. Part
// 3180 §8 names this file and says what that does: the class the member just
// cancelled renders as one they still hold, with a Cancel button on it and the
// Book button gone, so there is no way back in. `placesFree` and `isFull` are
// in the same module because they answer the other half of the same row: a
// class nobody sized has an UNKNOWN number of places and this screen was
// calling it full.
import {
  holdsPlace, seatControl, seatNote, waitlistNote, placesFree, isFull,
} from '../../src/lib/classSeat';
import { classCancelBody, fetchClassCancelPolicy, CLASS_POLICY_UNKNOWN_NOTE, type ClassPolicyRead } from '../../src/lib/classCancel';
// The zone every hour on this timetable is drawn in — see `zoneLine` below.
import { deviceZone } from '../../src/lib/quietHours';
import { Rule, Section, SectionHead, Cta, Ghost, Flag, PageHead, HeroCard, IconPlate, TonedChip, Meter, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric, font } from '../../src/theme/scale';
import { Fetched } from '../../src/ui/fetched';
import { useReadStamp } from '../../src/ui/readStamp';
import { useClasses } from '../../src/ui/classes';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useReachability } from '../../src/ui/reachability';
import { retryLine } from '../../src/lib/reachability';
import { useSettings } from '../../src/ui/settings';
import { scheduleLocal } from '../../src/ui/pushNotifications';
import type { GymClass } from '../../src/lib/classesMock';
import { fmtRelativeDay, fmtTime } from '../../src/lib/format';
import type { IconName } from '../../src/ui/Icon';
import { useNow } from '../../src/ui/today';

// The weekday name and the date order were this file's own. `DOW` was a
// hardcoded English array and the fallback read `${d.getDate()}/${d.getMonth() + 1}`,
// which a member in the United States reads as month-first: "Wed 9/12" is 9
// December here and 12 September there, and that string went into every cancel
// confirmation on this screen. Both are the reader's now — see
// `fmtRelativeDay` and `fmtClock` in src/lib/format.ts.
const timeLabel = (iso: string) => fmtTime(iso);
const dayLabel = (iso: string) => fmtRelativeDay(iso);

/**
 * Which clock these hours are on. `fmtTime` formats in the HANDSET's zone, which
 * is right and was said nowhere — and a gym with branches in two zones, or a
 * member booking from somewhere else, reads "18:00" with nothing saying whose
 * six o'clock. The same sentence app/(client)/calendar.tsx prints, so PT and
 * classes describe their times one way. Unnamed rather than guessed when the
 * runtime cannot name the zone.
 */
function zoneLine(): string {
  const z = deviceZone();
  return z
    ? `Times are in your phone’s time zone, ${z.replace(/_/g, ' ')}.`
    : 'Times are in your phone’s own time zone.';
}

/**
 * The gym's cancellation terms, said BEFORE a place is taken.
 *
 * `classChargeLine` answers "what does cancelling NOW cost", which is a
 * question about a booking that exists. This is the condition it would be held
 * to, from the same three fields, and with the same refusals: an unread policy
 * and an unstated notice both fall to `CLASS_POLICY_UNKNOWN_NOTE` rather than
 * to "free", and a fee is never printed as a bare number — the amount is left
 * to the cancel sheet, which has `wholeMoney` and the currency rule behind it.
 */
function classTermsLine(policy: ClassPolicyRead): string {
  if (!policy || policy.notice == null) return CLASS_POLICY_UNKNOWN_NOTE;
  if (policy.notice === 0) return 'Your gym does not run a notice period for classes, so cancelling this later is not a late cancellation.';
  const window = `Your gym asks for ${policy.notice} hours’ notice. Cancelling inside that counts as a late cancellation`;
  if (policy.fee === 0) return `${window}, and your gym has recorded no charge for one.`;
  return `${window} — what that costs is shown before you confirm a cancellation.`;
}

export default function Classes() {
  const t = useTheme();
  const router = useRouter();
  // `myStanding` and not `myStatus`. The provider interprets the member's own
  // `class_bookings.status` once, through `seatStanding`, and publishes two
  // maps: `myStatus` is the places still HELD, for the screens that only ask
  // that, and `myStanding` carries every word the column can hold — including
  // the two that say the member gave the place up, which is what this screen
  // has to say out loud. Absent means 'none'; see src/ui/classes.tsx.
  const { classes, myStanding, status: classStatus, book, cancel, countsKnown, cachedNote, refresh } = useClasses();
  // When the timetable last came off the server. Distinct from `cachedNote`
  // below and complementary to it: that says the copy on screen came off this
  // phone, and this says how old it is even when it did not. A member reads a
  // class list in a basement and walks to a room on the strength of it.
  const { at: readAt, busy: readBusy } = useReadStamp(classStatus, classes);
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

  // The line under the title. Across every branch, not the filtered one: what
  // the member holds does not change with the chip they are browsing by.
  // The instant comes from `useNow()` and sits in the dependency list: this is
  // a tab that never unmounts, and a memo that read its own clock would keep
  // naming a class that started an hour ago as the next one.
  const nowAt = useNow();
  const nextHeld = useMemo(() => {
    if (classStatus !== 'ready') return null;
    const now = nowAt.getTime();
    return classes
      .filter((c) => myStanding[c.id] === 'held' && !isCancelled(c) && Date.parse(c.startsAt) > now)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
  }, [classes, myStanding, classStatus, nowAt]);

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

  // ── review, then confirm ──────────────────────────────────────────────────
  //
  // Book was one tap and the first thing a member read about what they had
  // taken was the alert after it. The data-layout review's order for scheduling
  // is choose → review → confirm, with the zone, the status, the cost, the
  // cancellation terms and who is teaching it on screen before the commitment.
  // Every line below is already on the row or one read away; nothing is
  // invented, and the write itself (`onBook`) is untouched.
  //
  // It resolves rather than calls through, so the caller's `submitOnce` guard
  // holds across the question as well as the write: a second tap while the
  // sheet is up cannot open a second one. Dismissing it any way is a no.
  //
  // "Takes no payment" is the whole of what is said about cost, because it is
  // the whole of what is true here: see the note on Buy a Pass below — nothing
  // on this screen charges anybody.
  const reviewBooking = async (c: GymClass, full: boolean | null, spotsLeft: number | null): Promise<boolean> => {
    const policy = await fetchClassCancelPolicy(c.id);
    const state = full === true
      ? 'This class is full. Confirming puts you on the waitlist — it does not book a place.'
      : spotsLeft == null ? 'How many spaces are left could not be read. Confirming asks for a place.'
      : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left. Confirming books your place.`;
    const body = [
      `${c.title} · ${dayLabel(c.startsAt)} · ${timeLabel(c.startsAt)} · ${c.durationMin} min\n${c.instructor ? `With ${c.instructor} at ` : 'At '}${c.branch}${c.room ? ' · ' + c.room : ''}.`,
      zoneLine(),
      `${state} Booking here takes no payment.`,
      classTermsLine(policy),
    ].join('\n\n');
    return new Promise<boolean>((resolve) => {
      Alert.alert(full === true ? 'Join this waitlist?' : 'Book this class?', body, [
        { text: 'Not Now', style: 'cancel', onPress: () => resolve(false) },
        { text: full === true ? 'Join Waitlist' : 'Book It', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
  };

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
  const onCancel = async (c: GymClass) => {
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
      const wasWaitlist = (myStanding[c.id] ?? 'none') === 'queued';
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
    // What cancelling costs. The PT path states a notice period, a fee and a
    // currency, and says so plainly when the policy could not be read; this
    // path — the one the gym actually bills — said nothing at all, and silence
    // reads as free.
    //
    // Read BEFORE the alert rather than shown after it. A confirmation that
    // appears and then rewrites its own body while somebody is reading it is
    // worse than one that waits: the fee would arrive after the thumb. The
    // read is one RPC against a class already on screen, and every failure of
    // it returns null, which `classCancelBody` renders as the sentence this
    // screen has always shown. So the slow path and the broken path both end
    // where the screen already was.
    const policy = await fetchClassCancelPolicy(c.id);
    Alert.alert('Cancel booking?', classCancelBody(`${c.title} · ${c.branch} · ${dayLabel(c.startsAt)} ${timeLabel(c.startsAt)}`, c.startsAt, Date.now(), policy), [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: () => { void doCancel(); } },
    ]);
  };

  // `selected`, not just a brand fill. Which branch is chosen is drawn here in
  // one channel only — the background colour — and the whole timetable below is
  // filtered by it. A member who cannot see that channel had no way to tell
  // which of five branches they were reading the classes of, on the screen they
  // then walk to a building on the strength of.
  //
  // Role 'button' with a `selected` state, which is what the day strip in
  // app/(client)/workouts.tsx already does for the same shape of control. One
  // spelling of "this is the one that is on", not two.
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{ minHeight: 44, paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill,
        justifyContent: 'center', backgroundColor: active ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, ...font(active ? '600' : '500'), color: active ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );

  const tile = (label: string, icon: IconName, tone: Tone, route: string) => (
    <Pressable key={label} onPress={() => router.push(route as never)} accessibilityRole="button" accessibilityLabel={label}
      style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 7, paddingVertical: sp.md, paddingHorizontal: sp.xs, borderRadius: radius.md, backgroundColor: t.surface, ...elevation.card }}>
      <IconPlate icon={icon} tone={tone} size={36} />
      <Text style={{ ...ty.micro, color: t.ink2, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        {/* The next class this member HOLDS leads, under the title, as the
            data-layout review asks of every scheduling screen. 'held' only — a
            place in a queue is not a booking (app/(client)/bookings.tsx argues
            that at length) — never a class the gym called off, and only off a
            whole read: under 'partial' the earliest row that came back may not
            be the earliest there is. Absent rather than "nothing booked" the
            rest of the time; My Bookings, one tap below, is where that is said
            with both reads behind it. */}
        <PageHead title="Classes" subtitle="Pick your location and book a spot" />

        {/* The same fact the subtitle used to carry, as the approved look's
            night card: what you are next booked into, and the one action —
            My Bookings, which is where a held place is reviewed and cancelled
            against the gym's terms. No class held (or no whole read) means no
            card: an empty night card is a headline about nothing. */}
        {nextHeld ? (
          <HeroCard
            eyebrow="NEXT CLASS"
            title={nextHeld.title}
            meta={[`${dayLabel(nextHeld.startsAt)} · ${timeLabel(nextHeld.startsAt)}`, nextHeld.instructor, nextHeld.branch].filter(Boolean).join(' · ')}
            cta={{ label: 'My Bookings', onPress: () => router.push('/(client)/bookings') }}
          />
        ) : null}

        {/* The other half of the same subject, and the half the member has never
            had: this screen is what is COMING, and app/(client)/attendance.tsx
            is what already happened. The gym has held that record from both ends
            — the register a coach ticks and the door log in `gym_visits` — and
            until now only the gym could read it. Put here rather than only on a
            tab because a member wondering whether to book a class is the same
            member wondering how often they have actually been coming. */}
        {/* Three tiles with toned plates, where these were three grey text
            buttons on a grey ground. The kit's QuickRow is this shape without
            a tone, so it is built here from IconPlate and the card tokens. */}
        <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
          {/* What is already booked, before what already happened: upcoming
              first, history second. This screen had no way to the list of what
              the member holds, which is the first thing the scheduling flow
              asks for. */}
          {tile('My Bookings', 'check', 'blue', '/(client)/bookings')}
          {tile('My Attendance', 'chart', 'teal', '/(client)/attendance')}
          {/* Money and seats, kept apart on purpose.
              A place in a class is scarce and a payment is a second act that
              can fail on its own, so nothing on this screen charges anybody:
              booking stays the immediate, loud, money-free write it already is,
              and what a member buys is a CREDIT — a drop-in or a class pack —
              which the gym can issue any number of and which nobody else can
              take while a card is being typed. The full argument is at the top
              of src/lib/memberBuy.ts, and src/lib/outbox.ts refuses to queue a
              booking for the same family of reasons. */}
          {tile('Buy a Pass', 'target', 'orange', '/(client)/gym-plans')}
        </View>

        {branches.length > 1 ? (
          /* Every branch stays visible. A horizontal row with its scroll
             indicator hidden made the later branches look as though they did
             not exist, particularly at the larger text sizes. */
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.lg }}>
            {chip('All branches', branch === null, () => setBranch(null))}
            {branches.map((b) => chip(b, branch === b, () => setBranch(b === branch ? null : b)))}
          </View>
        ) : null}

        {/* When the server last answered, and a way to ask again. A member
            reads a timetable in a basement and walks to a room on the strength
            of it, and the providers now repair themselves silently on
            reconnect (src/lib/readRefresh.ts) — which makes the difference
            between "this landed a second ago" and "this landed before you came
            downstairs" invisible everywhere else. */}
        <Fetched at={readAt} onRefresh={refresh} busy={readBusy} />
        {/* Whose clock the timetable is on, beside the line that says how old
            it is — both are facts about how to read every hour below. Only over
            a timetable that has hours in it. */}
        {filtered.length > 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{zoneLine()}</Text>
        ) : null}

        {/* The timetable came off this phone, not off the server. Said once,
            above the list, because a member reading a cached timetable as a
            live one turns up to a class that was cancelled yesterday — and the
            counts are withheld entirely in that state (see `countsKnown` in
            src/ui/classes.tsx), so nothing here claims a class has spaces. */}
        {cachedNote ? <Flag tone={t.warn} style={{ marginTop: sp.lg }}>{cachedNote}</Flag> : null}

        {byDay.map((g) => (
          <View key={g.key}>
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
                // The member's own standing, read as a WORD and never as the
                // truthiness of a status string. 'cancelled' and
                // 'late_cancelled' are both truthy and neither is a seat; see
                // src/lib/classSeat.ts and supabase/parts/3180 §8.
                const seat = myStanding[c.id] ?? 'none';
                const holds = holdsPlace(seat);
                // Called off by the gym. Everything below branches on it: there
                // are no spaces in a class that is not running, and there is
                // nothing to book.
                const off = isCancelled(c);
                // `booked` is 0 for every class until the count RPC fills it
                // in. When that failed, subtracting it would advertise a full
                // class as completely empty, so no claim is made about spaces.
                //
                // `placesFree`, not `capacity - booked`: a class whose capacity
                // is zero or missing has an UNKNOWN number of places and this
                // line used to report it as none, under the words "Class full",
                // over a button that said Join Waitlist. `classFillState` is
                // still what decides URGENCY, and it is asked only about a
                // class that has a size — its own contract returns 'full' for
                // `cap <= 0`, which is right for the question it answers and
                // wrong as an answer to this one.
                const spotsLeft = placesFree(c.capacity, c.booked, countsKnown);
                const full = isFull(c.capacity, c.booked, countsKnown);
                const fill = spotsLeft == null ? null : classFillState(c.capacity, c.booked);
                // How many are queueing. Null FIRST — `null > 0` is false, so a
                // null tested after a `> 0` falls into the "nobody was waiting"
                // arm and a class whose demand nobody could read is reported as
                // one nobody wants. Withheld entirely while the counts read has
                // not landed: a queue length off an earlier read is not one now.
                const queue = waitlistNote(c.waiting, countsKnown, full === true);
                const control = off ? 'none' : seatControl(seat);
                return (
                  <View key={c.id}>
                    {i > 0 ? <Rule /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
                      <IconPlate icon="calendar" tone="purple" />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>{c.kind}</Text>
                        <Text style={{ ...ty.head, color: t.ink, marginTop: 3 }}>{c.title}</Text>
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{timeLabel(c.startsAt)} · {c.durationMin}m · {c.instructor} · {c.branch}{c.room ? ' · ' + c.room : ''}</Text>
                        {/* The state as a chip, in the tone that says how
                            urgent it is — red called off, the accent yours,
                            orange full, amber nearly — and the exact words in
                            ink under it, unchanged. A class with two spots left
                            and one with twelve were once the same grey dot, so
                            the one about to go looked like the one nobody
                            wants. */}
                        <View style={{ marginTop: 6, gap: 4 }}>
                          <TonedChip
                            label={off ? 'Cancelled' : seat === 'held' ? 'Booked' : seat === 'queued' ? 'On the Waitlist'
                              : seat === 'cancelled' || seat === 'late_cancelled' ? 'You Cancelled' : seat === 'unknown' ? 'Ask Reception'
                              : spotsLeft == null ? 'Spaces Unknown' : full === true ? 'Class Full' : fill === 'nearly' ? 'Nearly Full' : 'Spaces'}
                            tone={off ? 'red' : holds ? 'brand' : seat === 'queued' ? 'amber' : seat !== 'none' ? 'neutral'
                              : full === true ? 'orange' : fill === 'nearly' ? 'amber' : 'neutral'} />
                          <Text style={{ ...ty.caption, color: t.ink2 }}>{off
                            // `holds`, not the truthiness of a status: a member
                            // who cancelled and then had the class called off
                            // was being told they were booked in on it.
                            ? (holds ? 'Cancelled by the gym — you were booked in' : 'Cancelled by the gym')
                            // The member's own standing comes first and wins,
                            // because "you cancelled this" is what stops a
                            // wasted journey and "4 spots left" is not about
                            // them. `seatNote` returns null only for 'none',
                            // which is where the class speaks for itself.
                            : seatNote(seat) ?? (spotsLeft == null ? 'Spaces unknown'
                              : full === true ? 'Class full'
                              : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`)}</Text>
                        </View>
                        {/* How full, as a bar — only where the count was READ
                            and the class has a size (`spotsLeft` is null
                            otherwise, and so is this). Never on a class that
                            is not running. */}
                        {!off && spotsLeft != null ? (
                          <Meter label="Places" val={c.booked} target={c.capacity} unit=""
                            tone={full === true ? 'orange' : fill === 'nearly' ? 'amber' : 'purple'}
                            note={`${c.booked} of ${c.capacity} taken`} />
                        ) : null}
                        {/* How deep the queue is. Never drawn as a zero over an
                            unread count — `waitlistNote` returns the sentence
                            for each of the three nothings and null where there
                            is nothing worth saying. Mindbody and ClassPass both
                            show this and it is the figure that decides whether
                            somebody joins a waitlist or books elsewhere. */}
                        {queue ? (
                          <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{queue}</Text>
                        ) : null}
                      </View>
                      {/* No control at all on a class that is not running.
                          Booking one is not a thing the gym can honour, and
                          "Cancel" on a class the gym has already called off
                          offers to undo something that has already happened. */}
                      {/* One decision, in `seatControl`, and four answers where
                          this was a two-way truthiness test. 'none' is a class
                          the gym called off AND a standing this build cannot
                          read: neither may arm a write, and the difference
                          between them is already said in the line above.

                          'book' on a CANCELLED booking is the half of this that
                          was missing entirely. The Book control used to be
                          drawn only where there was no booking row, and a
                          cancellation now leaves one — so a member who cancelled
                          and changed their mind had no way back into the class
                          from the screen the timetable is on. Part 3180 §5
                          changed `book_class` to allow the re-book for exactly
                          this reason, and nothing in the app was asking. */}
                      {control === 'none' ? null : control === 'cancel' || control === 'leave' ? (
                        <Ghost label={control === 'leave' ? 'Leave Waitlist' : 'Cancel'} onPress={() => { void onCancel(c); }} />
                      ) : (
                        // Guarded. A seat is a scarce thing and `book` is a
                        // server round trip with no feedback on the button
                        // while it runs, so a member who taps again puts a
                        // second registration in — and at most gyms an unused
                        // seat is a no-show charge. See src/lib/submitOnce.ts.
                        //
                        // `full === true`, not `full`: null is "we could not
                        // tell", and a button reading Join Waitlist over a class
                        // whose size nobody recorded offers a queue that does
                        // not exist. Unknown falls to Book, which is what the
                        // server will decide anyway.
                        <Cta label={booking === c.id ? (full === true ? 'Joining…' : 'Booking…')
                          : seat === 'cancelled' || seat === 'late_cancelled' ? 'Book Again'
                          : full === true ? 'Join Waitlist' : 'Book'}
                          disabled={send.busy}
                          onPress={() => send.run(async () => {
                            if (!(await reviewBooking(c, full, spotsLeft))) return;
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
