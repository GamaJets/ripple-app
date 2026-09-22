// Client · Attendance. Every time this member has actually been in.
//
// The gym has had this record from both ends since the beginning and the member
// has never seen either half. `class_bookings.attended_at` is the register a
// coach ticks in app/(trainer)/class-checkin.tsx and the owner console marks at
// the desk; `gym_visits` is the door log, which supabase/parts/32-door-log.sql
// describes as the gym's whole attendance substrate and which until now was read
// only by the Studio web console. A member walking through a door generated a
// row about themselves they could not see.
//
// ── What this screen refuses to say ────────────────────────────────────────
//
// "You did not come." Nothing here computes an absence. A class that has run
// with an empty `attended_at` means the register was not ticked, and a coach not
// pressing a button while teaching is at least as likely as a member not turning
// up — src/lib/attendance.ts calls that state `unmarked` and this screen prints
// it as "Not recorded", which is the only true sentence available.
//
// "You have not been in." Only under 'ready'. Under 'error' the list is UNKNOWN
// and the banner has the page instead. This is somebody's own history and the
// person most likely to act on it after them is their coach.
//
// A streak. There isn't one, on purpose. A streak needs a complete record and
// this one has three documented ways of being incomplete — a truncated read, a
// register nobody took, a gym with no door log at all — any of which breaks a
// streak that never actually broke. The weekly strip below shows what was
// recorded and marks the weeks it knows nothing about as exactly that.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, PartialRead, Flag, PageHead, FigureCard, IconPlate, TonedChip, Expandable, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
// `numUpTo`, because `perWeek` is a ONE-DECIMAL mean — `Math.round(x * 10) / 10`
// in src/lib/attendance.ts — and a bare `${perWeek}` writes a full stop in every
// locale. "2.7 a week" is read as twenty-seven by a reader whose language makes
// the full stop the thousands separator, and it sat beside `num(days.length)` in
// the same row, which does ask. See the header of src/lib/format.ts.
import { num, numUpTo, fmtClock, fmtAxisDay } from '../../src/lib/format';
import { appLocale } from '../../src/lib/locale';
import { dateParts } from '../../src/lib/localDate';
import { useMyAttendance, RHYTHM_WEEKS } from '../../src/ui/attendance';
import { dwellMinutes, rhythmWeekLabel, type AttendanceEvent, type ClassOutcome } from '../../src/lib/attendance';
// `my_class_history()` — supabase/parts/136, written for this screen and until
// now called by nothing. See src/lib/classHistory.ts for what it lets this
// screen stop guessing about.
import {
  fetchMyClassHistory, classesNotShown, unopenedClassesLine, missingClassesLine,
} from '../../src/lib/classHistory';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';

// The weekday used to be this file's own English array — 'Sun' through 'Sat',
// hand-written beside a date string that was hardcoded to en-GB. Both are the
// reader's now: `weekday: 'short'` is part of the same format call, so a member
// on a French handset reads "sam. 14 août" rather than "Sat" glued to a British
// date. See src/lib/locale.ts.

/** A timestamp as the day it happened, in the reader's own zone. */
function dayLabel(iso: string | null): string {
  if (!iso) return fig(null);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fig(null);
  return d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** The time of day, in whichever clock the reader's phone is set to. This was
 *  the fifth hand-rolled 12-hour am/pm formatter in the app; `fmtClock` is the
 *  one that asks — see src/lib/format.ts. */
function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return fmtClock(d.getHours(), d.getMinutes());
}

/** A bare ISO day as "5 Sep". Read through `dateParts` and rendered by
 *  `fmtAxisDay`, which is the app's one day-precision date: a bare date parsed
 *  through `new Date(day)` is UTC midnight and prints the day before it in
 *  every zone west of Greenwich, and the local re-parse this used to do by hand
 *  is the exact line the two shipped off-by-one date bugs were written on. */
function shortDay(day: string): string {
  const p = dateParts(day);
  return p ? fmtAxisDay(p[0], p[1], p[2]) : day;
}

/**
 * What the record says happened, in words nobody has to interpret.
 *
 * ── Why the three newest states are all `'quiet'` ─────────────────────────
 *
 * The palette here is three tones and only three: `good` is `t.good`, `quiet`
 * is `t.ink3`, and `ahead` is `t.brand` — the colour this app uses for a thing
 * that is COMING, and the colour a member reads as approval. A cancellation
 * drawn in `ahead` would put the same dot beside "you gave this up" that sits
 * beside "you are booked in", and `missed` in `ahead` would be the brand
 * colour beside the one sentence on this screen that is a statement about the
 * member rather than about the record. All three are `quiet`.
 */
function outcomeWords(o: ClassOutcome): { label: string; tone: 'good' | 'quiet' | 'ahead' } {
  switch (o.kind) {
    case 'attended':
      return {
        // Which record proves it, because "the door says so" and "your coach
        // ticked you off" are different kinds of evidence and a member querying
        // this with reception needs to know which one to ask about.
        label: o.register && o.door ? 'You were there · register and door'
          : o.register ? 'You were there · marked by your gym'
          : 'You were there · logged at the door',
        tone: 'good',
      };
    case 'unmarked':
      return { label: 'Not recorded. Your gym did not mark this either way', tone: 'quiet' };
    case 'missed':
      // Names the REGISTER, because that is the thing a member who disputes
      // this has to ask their gym about. `unmarked` above and this are the same
      // absence of a tick, and the only thing separating them is
      // `gym_classes.register_taken_at` — so a sentence that said only "you
      // were not marked in" would be true of both and would leave somebody
      // arguing with reception about the wrong fact.
      return { label: 'Your gym took the register for this class and you were not on it.', tone: 'quiet' };
    case 'cancelled':
      // Past tense, and it says the place is gone. "You are not booked" is also
      // true of a class they have never heard of; what stops somebody turning
      // up is being told they had this and gave it up. Same sentence shape as
      // `seatNote` in src/lib/classSeat.ts, which says it about a class that
      // has not run yet.
      return { label: 'You cancelled this. Your place was given up.', tone: 'quiet' };
    case 'late_cancelled':
      // NO FEE, NO AMOUNT, NO CURRENCY, and that is not brevity. The fee owed
      // on a late cancellation is the one stored beside the row in
      // `class_booking_cancellations` at the moment of cancelling, so quoting
      // today's policy over last month's cancellation bills a member a price
      // nobody ever showed them. `seatNote` in src/lib/classSeat.ts makes the
      // argument in full; src/lib/classCancel.ts is where a fee is worded, from
      // the row that holds it.
      return { label: 'You cancelled this inside your gym’s notice period.', tone: 'quiet' };
    case 'upcoming':
      return { label: 'Booked · Still to Come', tone: 'ahead' };
    case 'waitlisted':
      return { label: 'You were on the waitlist', tone: 'quiet' };
    case 'unknown':
      return { label: 'We could not read this class', tone: 'quiet' };
  }
}

export default function Attendance() {
  const t = useTheme();
  const router = useRouter();
  const { status, events, undated, days, rhythm, classesComplete, cachedNote, reload } = useMyAttendance();
  const [refreshing, setRefreshing] = useState(false);

  // ── what the SERVER says is this member's class history ──────────────────
  //
  // `my_class_history()` (supabase/parts/136) was written for this screen and
  // has been called by nothing since: it appears once, as the USING clause of
  // `gym_classes_mine_r`. It is `security definer` over `class_bookings` and
  // `gym_visits` for `auth.uid()`, so it answers for every gym the member has
  // ever been in — including the ones they have left — without the tenant
  // scoping that made the caption below true when it was written.
  //
  // Read SEPARATELY from `useMyAttendance` and deliberately so. This is a
  // second opinion about the same record, and folding it into the hook that
  // produces the first one would let a failure in either take out both. It
  // returns ids and nothing else, so it can never add a row to the timeline —
  // rule 3 in src/lib/attendance.ts forbids an event built from an id alone.
  //
  // Null means we could not ask, and `unopenedClassesLine` says something
  // weaker rather than something invented when it is.
  const [history, setHistory] = useState<{ ids: string[]; truncated: boolean } | null>(null);
  const loadHistory = useCallback(async () => {
    const res = await fetchMyClassHistory(supabase);
    if (!res.ok) {
      // Reported, and the caption falls back to the sentence that needs no
      // second opinion. Not fatal: this screen's own three reads are what the
      // list is made of, and they succeeded or failed on their own terms.
      reportError('attendance.classHistory', new Error(res.reason));
      setHistory(null);
      return;
    }
    setHistory(res.value);
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([reload(), loadHistory()]); } finally { setRefreshing(false); }
  }, [reload, loadHistory]);
  // Was four hand-written lines of RefreshControl. The shared hook is the same
  // gesture with the thing those lines never had: a second pull arriving while
  // the first read is in flight is ignored rather than firing it again.
  const pull = usePullToRefresh(refresh);

  // Only from a whole read. 'partial' is excluded for the same reason 'error'
  // is: the rows are real and a count over them is a subtotal shown as a total.
  const countable = status === 'ready';

  /** The class id behind an event, whether or not the class row came back. A
   *  class we could not open still has its id on the booking or the visit that
   *  points at it, which is exactly what makes it checkable against the
   *  server's own list. */
  const classIdOf = (e: AttendanceEvent): string | null =>
    e.klass?.id ?? e.booking?.classId ?? e.visit?.classId ?? null;

  // Every class the timeline accounts for, INCLUDING the ones drawn as "a class
  // we could not read" and the undated ones. An event with no title is still an
  // event the member can see, and counting it as missing as well would report
  // the same class twice.
  const shownClassIds = useMemo(
    () => [...events, ...undated].map(classIdOf).filter((x): x is string => !!x),
    [events, undated],
  );

  // The events that hold no class row, and how many of them the server hands
  // back as the member's own. That second figure is the whole point: it is the
  // difference between "your gym deleted this class" and "this app is not
  // allowed to open it", and the screen used to guess — with the guess that
  // part 136 made wrong.
  const unopenedIds = useMemo(
    () => [...events, ...undated]
      .filter((e) => e.source === 'class' && !e.klass)
      .map(classIdOf)
      .filter((x): x is string => !!x),
    [events, undated],
  );
  const confirmedMine = useMemo(() => {
    if (!history) return null;
    const mine = new Set(history.ids);
    return unopenedIds.filter((id) => mine.has(id)).length;
  }, [history, unopenedIds]);

  // Classes the server holds that are on this screen nowhere at all. Under a
  // whole read this is empty; under a truncated one it is how much of the
  // member's own record is missing from what they are looking at, which is a
  // figure `status: 'partial'` gestures at and never states.
  const notShown = useMemo(
    () => (history ? classesNotShown(history.ids, shownClassIds) : []),
    [history, shownClassIds],
  );

  // Oldest week on the left, which is how a habit reads.
  const strip = useMemo(() => [...rhythm.weeks].reverse(), [rhythm.weeks]);
  const busiest = useMemo(
    () => strip.reduce((m, w) => (w.covered && w.days > m ? w.days : m), 0),
    [strip],
  );

  const G = layout.gutter;

  const row = (e: AttendanceEvent, first: boolean) => {
    const o = outcomeWords(e.outcome);
    const mins = dwellMinutes(e.visit);
    // The outcome as a chip: the accent for "you were there", blue for one
    // still ahead, neutral for everything that is merely a fact (cancelled,
    // unmarked). Nothing here is red — a missed class is the gym's register
    // and not this screen's verdict.
    const tone = o.tone === 'good' ? 'brand' : o.tone === 'ahead' ? 'blue' : 'neutral';
    const title = e.source === 'floor'
      ? 'Gym Visit'
      : e.klass
        ? e.klass.title
        // Rule 3 in src/lib/attendance.ts made visible: this is not a class with
        // no name, it is a class we were not allowed to read. Saying so beats a
        // blank, and beats inventing "Class".
        : 'A Class We Could Not Read';
    const where = e.klass
      ? [e.klass.kind, e.klass.instructor, e.klass.branch, e.klass.room].filter(Boolean).join(' · ')
      : e.source === 'floor'
        ? `Entered ${timeLabel(e.visit?.enteredAt ?? null)}${mins != null ? ` · ${mins} min` : ''}`
        : 'Your gym has this on record; this app cannot open the class itself.';

    return (
      <View key={e.key}>
        {!first ? <Rule /> : null}
        {/* Grouped and spoken whole. The plate names the KIND of row in the
            app's session colours — purple for a class, teal for a walk through
            the door — and the chip is the outcome; colour is the one thing a
            screen reader cannot read, so without this label the row arrived as
            fragments led by an unnamed shape. */}
        <View accessible accessibilityRole="text"
          accessibilityLabel={[dayLabel(e.at), title, where, o.label].filter(Boolean).join('. ')}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
          <IconPlate icon={e.source === 'floor' ? 'grid' : 'calendar'} tone={e.source === 'floor' ? 'teal' : 'purple'} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ ...ty.micro, ...numeric, color: t.ink3 }}>
              {dayLabel(e.at)}{e.at && e.source === 'class' ? ` · ${timeLabel(e.at)}` : ''}
            </Text>
            <Text style={{ ...ty.head, color: t.ink, marginTop: 3 }}>{title}</Text>
            {where ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{where}</Text> : null}
            <View style={{ marginTop: 6 }}><TonedChip label={o.label} tone={tone} /></View>
            {e.source === 'class' && mins != null ? (
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{mins} min in the building</Text>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={pull}
      >
        <PageHead title="Attendance" subtitle="Your classes and every door scan your gym recorded" />


        {status === 'error' ? (
          <Section>
            <Notice tone={t.crit} kicker="Not Read" title="We couldn’t read your attendance"
              note={events.length
                // When the list came off this device, say WHEN. "Not confirmed
                // current" is true of a cache from four minutes ago and of one
                // from four days ago, and the member can only judge what they
                // are looking at if they are told which.
                ? (cachedNote ?? 'What is below is what we had before the read failed. It is not confirmed current, and there may be visits missing from it.')
                : 'This is NOT a record of you never coming in. It is a record we could not open. Pull down to try again.'}>
              <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={() => { void reload(); }} /></View>
            </Notice>
          </Section>
        ) : null}

        {status === 'partial' ? (
          // `shown` is RIGHT as `events.length` and stays: `PartialRead` means
          // "showing the first N", where N is how many rows arrived and are on
          // the screen under it — a statement about the READ, not about how
          // many of them were visits. `what` was wrong for the same reason the
          // heading below was: the truncated lists are `class_bookings` and
          // `gym_visits`, and cancellations come back in the first of them.
          <Section><PartialRead what="bookings and visits" shown={events.length} onPress={() => { void reload(); }} /></Section>
        ) : null}

        {/* ── how often, and only where the record supports saying ────────── */}
        {/* The page opens on its figure — days a week — with the reason
            beside the dash when there is no figure, and the weeks it was
            worked out from as bars directly under it. `FigureCard` is the
            kit's card for exactly that; nothing about WHEN a rate may be
            shown changed. */}
        <FigureCard
          title="How Often You Come"
          figure={countable && rhythm.perWeek != null ? numUpTo(rhythm.perWeek, 1) : null}
          unit="days a week"
          period={`Last ${RHYTHM_WEEKS} weeks`}
          source={countable ? `${num(days.length)} days on record` : undefined}
          detail={status === 'loading' ? 'Reading your attendance…'
            : !countable
              ? 'No average while the record is incomplete. A rate over part of it would be a number about a gym you do not go to.'
              : rhythm.perWeek == null
                ? (rhythm.firstDay
                  ? `Your record starts ${shortDay(rhythm.firstDay)}. There is not yet a finished week inside it to average, so no rate is shown.`
                  : 'Nothing recorded yet, so there is no average to show. A zero here would be a claim, not a blank.')
                : `Averaged over the ${rhythm.countedWeeks} finished week${rhythm.countedWeeks === 1 ? '' : 's'} since ${shortDay(rhythm.firstDay!)}. This week is left out of it because it is not over.`}>
          {status === 'loading' ? null : (
            <>
              {/* The kit's DayBars, drawn by hand: same 18pt rounded bars and
                  grey stub, but DayBars has two states for a bar and this strip
                  has four — a week with days, a week with none, a week BEFORE
                  the record starts (hollow, dashed: not a zero) and the week
                  that is not over (half strength) — and each column keeps its
                  own spoken sentence, which one chart-wide label would lose. */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 84, marginTop: sp.lg }}>
                {strip.map((w) => {
                  // An uncovered week is drawn as a hollow slot, not a zero bar.
                  // A bar of height zero is the claim "you came in no times that
                  // week"; before the first row on record we have no idea.
                  const h = w.covered && w.days > 0 && busiest > 0 ? Math.max(6, Math.round((w.days / busiest) * 64)) : 6;
                  return (
                    // Grouped and spoken whole, like the visit rows below.
                    // Every fact this column carries is drawn as a shape — fill
                    // for days, a dashed outline for a week we know nothing
                    // about, half opacity for the week that is not over — and
                    // the number underneath is blank for a covered week with
                    // none and blank for an uncovered one, so the two are told
                    // apart by a border style alone. `rhythmWeekLabel` is that
                    // distinction in words; see its header.
                    <View key={w.start} accessible accessibilityRole="text"
                      accessibilityLabel={rhythmWeekLabel(w, shortDay(w.start))}
                      style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                      <View style={{
                        width: 18, maxWidth: '100%', height: h, borderRadius: 6,
                        backgroundColor: !w.covered ? 'transparent' : w.days ? t.brand : t.surface3,
                        borderWidth: w.covered ? 0 : hairline,
                        borderColor: t.ring,
                        borderStyle: 'dashed',
                        opacity: w.complete || !w.covered ? 1 : 0.55,
                      }} />
                      <Text style={{ ...ty.micro, ...numeric, color: t.ink3 }}>
                        {w.covered ? (w.days || '') : ''}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Days at a gym, week by week. The last bar is this week and is not finished.
              </Text>
            </>
          )}
        </FigureCard>


        {/* ── the record itself ───────────────────────────────────────────── */}
        <Section>
          {/* RENAMED, and the number left alone. `events` is the whole
              timeline — an upcoming booking is in it, and since part 3060 a
              cancelled and a late-cancelled one are too. "Every visit · 10"
              over a member who cancelled ten classes and attended none is the
              screen counting the opposite of what it names.

              Renamed rather than filtered, because the number sits directly
              above the list it describes: filtering it to `attended` would
              print 0 over ten visible rows, which reads as a broken screen
              rather than as a truer figure. The attended count already has a
              home and a correct source — "Days on record" above, off
              `attendedDays`, which counts DAYS and not rows for its own
              reasons. So the heading is made to say what the number counts. */}
          <SectionHead title="Everything on Record" note={countable && events.length ? num(events.length) : undefined} />

          {/* Why a class would not open, CHECKED rather than guessed.
              This said "usually because they were run by a gym you are no
              longer with", which was true until supabase/parts/136 gave a
              member the right to read any class they booked or visited
              "whichever gym it belongs to". Since then it has been the wrong
              reason, told to somebody about their own record — and the
              function that can answer properly, `my_class_history()`, was
              written in the same part and called by nothing. See
              src/lib/classHistory.ts. */}
          {!classesComplete && events.length && unopenedClassesLine(unopenedIds.length, confirmedMine) ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
              {unopenedClassesLine(unopenedIds.length, confirmedMine)}
            </Text>
          ) : null}

          {/* Classes the server holds that this list does not contain at all.
              Never derived from a count on screen: it is the difference between
              the member's own timeline and the set `my_class_history()` returns,
              and it is a floor rather than a total when that read was itself
              truncated. */}
          {missingClassesLine(notShown.length, history?.truncated ?? false) ? (
            // A <Flag>, not warn-coloured words. scripts/check-contrast.mjs:
            // a status colour is tuned to the 3:1 a MARK needs and not to the
            // 4.5:1 text needs, so the tone goes on the mark and the sentence
            // stays in ink. The words already say it; colour is never the only
            // channel.
            <Flag tone={t.warn} style={{ marginBottom: sp.sm }}>
              {missingClassesLine(notShown.length, history?.truncated ?? false)}
            </Flag>
          ) : null}

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your attendance…</Text>
          ) : events.length === 0 ? (
            // Said ONLY under 'ready'. Under 'error' the banner has the page and
            // this sentence never appears — it is the one lie this screen could
            // tell that a coach would act on.
            status === 'ready' ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Your gym has not recorded you coming in. That may simply mean it does not scan people at the door and your classes have not been marked off. Plenty of gyms record neither. It is not a record of you staying away.
              </Text>
            ) : null
          ) : (
            events.map((e, i) => row(e, i === 0))
          )}
        </Section>

        {undated.length ? (
          <>
            <Section>
              {/* Every other figure on this screen goes through `countable`
                  (`status === 'ready'`); this one did not. */}
              <SectionHead title="On Record, Date Unknown" note={countable ? `${undated.length}` : undefined} />
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
                Classes you booked whose details this app cannot read, so there is no date to put them on. They are listed here rather than dropped or guessed onto a day, and they are not counted above.
              </Text>
              {undated.map((e, i) => (
                <View key={e.key}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md }}>
                    <Text style={{ ...ty.body, color: t.ink }}>A Class We Could Not Read</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      Booked {dayLabel(e.booking?.bookedAt ?? null)}. This is the booking date, not the class date.
                    </Text>
                  </View>
                </View>
              ))}
            </Section>
          </>
        ) : null}


        {/* Folded: whose record this is and how to have it corrected is read
            once, and the approved look keeps paragraphs behind a control. */}
        <Expandable title="About This Record" note="Your gym’s own register. Reception can correct it">
          <Text style={{ ...ty.label, color: t.ink2 }}>
            This is your gym’s own record. A class with nothing marked against it means nobody took the register. It does not mean you were not there. If something here looks wrong, reception can correct it.
          </Text>
        </Expandable>
      </ScrollView>
    </SafeAreaView>
  );
}
