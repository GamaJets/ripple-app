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
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { num, fmtClock, fmtAxisDay } from '../../src/lib/format';
import { appLocale } from '../../src/lib/locale';
import { dateParts } from '../../src/lib/localDate';
import { useMyAttendance, RHYTHM_WEEKS } from '../../src/ui/attendance';
import { dwellMinutes, type AttendanceEvent, type ClassOutcome } from '../../src/lib/attendance';

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

/** What the record says happened, in words nobody has to interpret. */
function outcomeWords(o: ClassOutcome): { label: string; tone: 'good' | 'quiet' | 'ahead' } {
  switch (o.kind) {
    case 'attended':
      return {
        // Which record proves it, because "the door says so" and "your coach
        // ticked you off" are different kinds of evidence and a member querying
        // this with reception needs to know which one to ask about.
        label: o.register && o.door ? 'You were there — register and door'
          : o.register ? 'You were there — marked by your gym'
          : 'You were there — logged at the door',
        tone: 'good',
      };
    case 'unmarked':
      return { label: 'Not recorded — your gym did not mark this either way', tone: 'quiet' };
    case 'upcoming':
      return { label: 'Booked — still to come', tone: 'ahead' };
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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);
  // Was four hand-written lines of RefreshControl. The shared hook is the same
  // gesture with the thing those lines never had: a second pull arriving while
  // the first read is in flight is ignored rather than firing it again.
  const pull = usePullToRefresh(refresh);

  // Only from a whole read. 'partial' is excluded for the same reason 'error'
  // is: the rows are real and a count over them is a subtotal shown as a total.
  const countable = status === 'ready';

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
    const tone = o.tone === 'good' ? t.good : o.tone === 'ahead' ? t.brand : t.ink3;
    const title = e.source === 'floor'
      ? 'Gym visit'
      : e.klass
        ? e.klass.title
        // Rule 3 in src/lib/attendance.ts made visible: this is not a class with
        // no name, it is a class we were not allowed to read. Saying so beats a
        // blank, and beats inventing "Class".
        : 'A class we could not read';
    const where = e.klass
      ? [e.klass.kind, e.klass.instructor, e.klass.branch, e.klass.room].filter(Boolean).join(' · ')
      : e.source === 'floor'
        ? `Entered ${timeLabel(e.visit?.enteredAt ?? null)}${mins != null ? ` · ${mins} min` : ''}`
        : 'Your gym has this on record; this app cannot open the class itself.';

    return (
      <View key={e.key}>
        {!first ? <Rule /> : null}
        {/* Grouped and spoken whole. The dot is the outcome said in colour —
            attended, missed, cancelled — and colour is the one thing a screen
            reader cannot read; without this the row arrived as four fragments
            led by an unnamed shape. */}
        <View accessible accessibilityRole="text"
          accessibilityLabel={[dayLabel(e.at), title, where, o.label].filter(Boolean).join('. ')}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, marginTop: 6, backgroundColor: tone }} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, ...numeric, color: t.ink3 }}>
              {dayLabel(e.at)}{e.at && e.source === 'class' ? ` · ${timeLabel(e.at)}` : ''}
            </Text>
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: 3 }}>{title}</Text>
            {where ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{where}</Text> : null}
            <Text style={{ ...ty.caption, color: o.tone === 'good' ? t.ink2 : t.ink3, marginTop: 4 }}>{o.label}</Text>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>At the gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Attendance</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Every time your gym recorded you coming in — classes and the door.
        </Text>

        <Rule />

        {status === 'error' ? (
          <Section>
            <Notice tone={t.crit} kicker="Not read" title="We couldn’t read your attendance"
              note={events.length
                // When the list came off this device, say WHEN. "Not confirmed
                // current" is true of a cache from four minutes ago and of one
                // from four days ago, and the member can only judge what they
                // are looking at if they are told which.
                ? (cachedNote ?? 'What is below is what we had before the read failed. It is not confirmed current, and there may be visits missing from it.')
                : 'This is NOT a record of you never coming in — it is a record we could not open. Pull down to try again.'}>
              <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={() => { void reload(); }} /></View>
            </Notice>
          </Section>
        ) : null}

        {status === 'partial' ? (
          <Section><PartialRead what="visits" shown={events.length} onPress={() => { void reload(); }} /></Section>
        ) : null}

        {/* ── how often, and only where the record supports saying ────────── */}
        <Section>
          <SectionHead
            title="How often you come"
            note={countable && rhythm.perWeek != null ? `${rhythm.perWeek} a week` : undefined}
          />

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your attendance…</Text>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 76, marginTop: sp.sm }}>
                {strip.map((w) => {
                  // An uncovered week is drawn as a hollow slot, not a zero bar.
                  // A bar of height zero is the claim "you came in no times that
                  // week"; before the first row on record we have no idea.
                  const h = w.covered && busiest > 0 ? Math.max(3, Math.round((w.days / busiest) * 64)) : 3;
                  return (
                    <View key={w.start} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                      <View style={{
                        width: '100%', height: h, borderRadius: radius.sm / 2,
                        backgroundColor: !w.covered ? 'transparent' : w.days ? t.brand : t.surface2,
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
                {`Days you were recorded at a gym, week by week, over the last ${RHYTHM_WEEKS} weeks. The last bar is this week and is not finished.`}
              </Text>

              {/* The figure, and the reason there isn't one. Never a zero. */}
              <View style={{ flexDirection: 'row', gap: sp.xl, marginTop: sp.lg }}>
                <View>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Days on record</Text>
                  <Text style={{ ...ty.head, ...numeric, color: t.ink, marginTop: 2 }}>
                    {countable ? num(days.length) : fig(null)}
                  </Text>
                </View>
                <View>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Days a week</Text>
                  <Text style={{ ...ty.head, ...numeric, color: t.ink, marginTop: 2 }}>
                    {countable && rhythm.perWeek != null ? rhythm.perWeek : fig(null)}
                  </Text>
                </View>
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {!countable
                  ? 'No average while the record is incomplete — a rate over part of it would be a number about a gym you do not go to.'
                  : rhythm.perWeek == null
                    ? (rhythm.firstDay
                      ? `Your record starts ${shortDay(rhythm.firstDay)}. There is not yet a finished week inside it to average, so no rate is shown.`
                      : 'Nothing recorded yet, so there is no average to show. A zero here would be a claim, not a blank.')
                    : `Averaged over the ${rhythm.countedWeeks} finished week${rhythm.countedWeeks === 1 ? '' : 's'} since ${shortDay(rhythm.firstDay!)}. This week is left out of it — it is not over.`}
              </Text>
            </>
          )}
        </Section>

        <Rule />

        {/* ── the record itself ───────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Every visit" note={countable && events.length ? num(events.length) : undefined} />

          {!classesComplete && events.length ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
              Some of these are classes this app could not open — usually because they were run by a gym you are no longer with. The attendance is still yours; only the class details are missing.
            </Text>
          ) : null}

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your attendance…</Text>
          ) : events.length === 0 ? (
            // Said ONLY under 'ready'. Under 'error' the banner has the page and
            // this sentence never appears — it is the one lie this screen could
            // tell that a coach would act on.
            status === 'ready' ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Your gym has not recorded you coming in. That may simply mean it does not scan people at the door and your classes have not been marked off — plenty of gyms record neither. It is not a record of you staying away.
              </Text>
            ) : null
          ) : (
            events.map((e, i) => row(e, i === 0))
          )}
        </Section>

        {undated.length ? (
          <>
            <Rule />
            <Section>
              {/* Every other figure on this screen goes through `countable`
                  (`status === 'ready'`); this one did not. */}
              <SectionHead title="On record, date unknown" note={countable ? `${undated.length}` : undefined} />
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
                Classes you booked whose details this app cannot read, so there is no date to put them on. They are listed here rather than dropped or guessed onto a day, and they are not counted above.
              </Text>
              {undated.map((e, i) => (
                <View key={e.key}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md }}>
                    <Text style={{ ...ty.body, color: t.ink }}>A class we could not read</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      Booked {dayLabel(e.booking?.bookedAt ?? null)} — the booking date, not the class date.
                    </Text>
                  </View>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            This is your gym’s own record. A class with nothing marked against it means nobody took the register — it does not mean you were not there. If something here looks wrong, reception can correct it.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
