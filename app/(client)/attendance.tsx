// Client · Attendance. Every time this member has actually been in.
//
// The gym has had this record from both ends since the beginning and the member
// has never seen either half. `class_bookings.attended_at` is the register a
// coach ticks in app/(trainer)/class-checkin.tsx and the owner console marks at
// the desk; `gym_visits` is the door log, which supabase/parts/32-gym-visits.sql
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
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { num } from '../../src/lib/format';
import { useMyAttendance, RHYTHM_WEEKS } from '../../src/ui/attendance';
import { dwellMinutes, type AttendanceEvent, type ClassOutcome } from '../../src/lib/attendance';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A timestamp as the day it happened, in the reader's own zone. */
function dayLabel(iso: string | null): string {
  if (!iso) return fig(null);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fig(null);
  return `${DOW[d.getDay()]} ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
}

/** A bare ISO day as "5 Sep". Parsed from components rather than through Date,
 *  which would read a bare date as UTC midnight and print the day before it in
 *  every zone west of Greenwich. */
function shortDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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
  const { status, events, undated, days, rhythm, classesComplete, reload } = useMyAttendance();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);

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
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={t.ink3} />}
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
                ? 'What is below is what we had before the read failed. It is not confirmed current, and there may be visits missing from it.'
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
