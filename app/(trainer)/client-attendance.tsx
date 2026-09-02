// Coach · Their attendance. What the gym recorded about one client turning up.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// src/lib/attendance.ts merges the two records a gym keeps about a member —
// `class_bookings.attended_at`, the register a coach ticks, and `gym_visits`,
// the door log — and de-duplicates the pair so one hour of somebody's life is
// one row. Its header says what the whole exercise is for: protecting the
// person "having the retention conversation with them" from reading an unticked
// register as a missed session.
//
// That person is the coach, and until now the module had no coach-side reader.
// The member could see their own record (app/(client)/attendance.tsx) and the
// gym owner could see the console's; the one person who acts on it could not.
//
// ── The distinction this screen exists to carry ────────────────────────────
//
// `unmarked` is a class that has run with nothing recorded either way, and it
// is NOT an absence — a coach who is teaching does not always press the button.
// So the two are never drawn alike here: an attendance says which record proves
// it, and an unmarked class says that nobody marked it and stops. There is no
// "missed" anywhere on this page, no absence count, and no attendance
// percentage — a percentage needs a denominator of classes they were expected
// at, and an unticked register is not evidence they were expected or that they
// did not come.
//
// ── And one caveat that is only true on the coach's side ───────────────────
//
// A coach reads these rows as gym STAFF: `class_bookings_staff_r` (part 165) and
// `gym_visits_staff_rw` (part 32) are both scoped to `my_tenant()`. A coach with
// no gym matches neither and is handed zero rows with error null — RLS filters,
// it does not refuse — which is indistinguishable from a client who has never
// been recorded. `staffScopeNote` is what is said instead, and it is a rule in
// the module rather than a sentence in this file so that the next reader of
// this record inherits it.
import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { MIN_TARGET } from '../../src/lib/a11y';
import { num, fmtClock, fmtAxisDay } from '../../src/lib/format';
import { appLocale } from '../../src/lib/locale';
import { dateParts } from '../../src/lib/localDate';
import { useRoster } from '../../src/ui/roster';
import { useTenant } from '../../src/ui/tenant';
import { RHYTHM_WEEKS } from '../../src/ui/attendance';
import { useClientAttendance } from '../../src/ui/clientAttendance';
import {
  dwellMinutes, staffScopeNote, STAFF_RECORD_NOTE,
  type AttendanceEvent, type ClassOutcome,
} from '../../src/lib/attendance';

/** A timestamp as the day it happened, in the coach's own zone — they are the
 *  reader, the same call app/(trainer)/leaderboard.tsx makes about units. */
function dayLabel(iso: string | null): string {
  if (!iso) return fig(null);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fig(null);
  return d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** The time of day, in whichever clock the reader's phone is set to. */
function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return fmtClock(d.getHours(), d.getMinutes());
}

/** A bare ISO day as "5 Sep". Through `dateParts` and `fmtAxisDay`, because a
 *  bare date through `new Date(day)` is UTC midnight and prints the day before
 *  it everywhere west of Greenwich. */
function shortDay(day: string): string {
  const p = dateParts(day);
  return p ? fmtAxisDay(p[0], p[1], p[2]) : day;
}

/**
 * What the record says, in the words a coach needs.
 *
 * Every one of these is a statement about the RECORD. None is a statement about
 * the client, because only one of the five states supports one: `attended`. The
 * `unmarked` line is written the long way round on purpose — a coach skimming
 * for a reason to ring somebody must not be able to read it as an absence, and
 * "Not recorded" on its own is exactly what would get read that way.
 */
function outcomeWords(o: ClassOutcome): { label: string; tone: 'good' | 'quiet' | 'ahead' } {
  switch (o.kind) {
    case 'attended':
      return {
        // Which record proves it. "The door says so" and "somebody ticked the
        // register" are different kinds of evidence, and a coach querying this
        // at reception needs to know which one to ask about.
        label: o.register && o.door ? 'Here — register and door'
          : o.register ? 'Here — marked on the register'
          : 'Here — logged at the door',
        tone: 'good',
      };
    case 'unmarked':
      return {
        label: 'Nobody took the register for this one, so there is nothing on record either way. It is not a missed session.',
        tone: 'quiet',
      };
    case 'upcoming':
      return { label: 'Booked — still to come', tone: 'ahead' };
    case 'waitlisted':
      return { label: 'On the waitlist — they never had a place to turn up to', tone: 'quiet' };
    case 'unknown':
      return { label: 'This class could not be read, so we cannot say whether it has even run', tone: 'quiet' };
  }
}

export default function ClientAttendanceScreen() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  const tenant = useTenant();

  // Arrives from the client screen so a coach already looking at somebody lands
  // on that person rather than on a picker they have to search. With no param
  // this is the picker, which is also what makes the route safe to list in
  // search — see the exclusion rule at the top of src/lib/features.ts.
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const [picked, setPicked] = useState<string | null>(clientId ?? null);
  const a = useClientAttendance(picked);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);

  // Only from a whole read. 'partial' is excluded for the same reason 'error'
  // is: the rows are real and a count over them is a subtotal shown as a total.
  const countable = a.status === 'ready';

  /**
   * Whether this coach can read a register at all, as three states.
   *
   * `useTenant` under 'error' means we could not find out, which is not the
   * same as "no gym" and does not render the same. Only `true` lets the empty
   * state below say the words "nothing on record".
   *
   * A tenant still LOADING is null here for that gating — nothing is known yet,
   * so nothing may be claimed — but it deliberately shows no notice: "we could
   * not tell which gym you belong to" is false of a read that is still in
   * flight, and it would be on screen for the whole of every normal open.
   */
  const tenantSettled = tenant.status !== 'loading';
  const hasGym: boolean | null = !tenantSettled || tenant.status === 'error'
    ? null
    : tenant.tenant != null;
  const scopeNote = tenantSettled ? staffScopeNote(hasGym) : null;

  // Oldest week on the left, which is how a habit reads.
  const strip = useMemo(() => [...a.rhythm.weeks].reverse(), [a.rhythm.weeks]);
  const busiest = useMemo(
    () => strip.reduce((m, w) => (w.covered && w.days > m ? w.days : m), 0),
    [strip],
  );

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    minHeight: MIN_TARGET, justifyContent: 'center' as const,
    backgroundColor: on ? t.brand : t.surface2,
  });

  const G = layout.gutter;

  const row = (e: AttendanceEvent, first: boolean) => {
    const o = outcomeWords(e.outcome);
    const mins = dwellMinutes(e.visit);
    const tone = o.tone === 'good' ? t.good : o.tone === 'ahead' ? t.brand : t.ink3;
    const title = e.source === 'floor'
      ? 'Gym visit'
      : e.klass
        ? e.klass.title
        // Rule 3 in src/lib/attendance.ts made visible: not a class with no
        // name, a class this app was not allowed to read.
        : 'A class we could not read';
    const where = e.klass
      ? [e.klass.kind, e.klass.instructor, e.klass.branch, e.klass.room].filter(Boolean).join(' · ')
      : e.source === 'floor'
        ? `In ${timeLabel(e.visit?.enteredAt ?? null)}${mins != null ? ` · ${mins} min` : ''}`
        : '';

    return (
      <View key={e.key}>
        {!first ? <Rule /> : null}
        {/* Grouped and spoken whole. The dot is the outcome said in colour, and
            colour is the one thing a screen reader cannot read. */}
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Their Attendance</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Every time your gym recorded them coming in — the class register and the door log, folded
          together so one visit is one line. A class with nothing marked against it means nobody took
          the register. It is not a missed session, and nothing here counts it as one.
        </Text>

        {/* ── who ──────────────────────────────────────────────────────────── */}
        {r.status === 'error' ? (
          <Section>
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="This is not an empty book. Nobody is listed below because the list did not come back — go back and open this again once you are connected." />
          </Section>
        ) : null}

        <Section>
          <SectionHead title="Client" />
          {r.roster.length === 0 && r.status !== 'error' ? (
            <Text style={{ ...ty.body, color: t.ink3 }}>
              Nobody is on your book yet, so there is no record to open.
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {r.roster.map((c) => (
                <Pressable key={c.id} onPress={() => setPicked(c.id === picked ? null : c.id)}
                  accessibilityRole="button" accessibilityState={{ selected: picked === c.id }}
                  accessibilityLabel={c.name} style={chip(picked === c.id)}>
                  <Text style={{ ...ty.micro, color: picked === c.id ? t.brandInk : t.ink2 }}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Section>

        {!picked ? (
          <>
            <Rule />
            <Section>
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Pick somebody to see what the gym has on them.
              </Text>
            </Section>
          </>
        ) : (
          <>
            <Rule />

            {/* ── what this record is, before any of it is read ───────────── */}
            {scopeNote ? (
              <Section>
                <Notice tone={t.warn} kicker="Scope"
                  title={hasGym === null ? 'We could not tell which gym you belong to' : 'Your account is not attached to a gym'}
                  note={scopeNote} />
              </Section>
            ) : null}

            {a.status === 'error' ? (
              <Section>
                <Notice tone={t.crit} kicker="Not read" title="Their attendance could not be read"
                  note={a.events.length
                    ? 'What is below is what we had before the read failed. It is not confirmed current, and there may be visits missing from it.'
                    : 'This is NOT a record of them never coming in — it is a record we could not open.'}>
                  <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={() => { void a.reload(); }} /></View>
                </Notice>
              </Section>
            ) : null}

            {a.status === 'partial' ? (
              <Section><PartialRead what="visits" shown={a.events.length} onPress={() => { void a.reload(); }} /></Section>
            ) : null}

            {/* ── how often, and only where the record supports saying ────── */}
            <Section>
              <SectionHead
                title="How often they come"
                note={countable && a.rhythm.perWeek != null ? `${a.rhythm.perWeek} a week` : undefined}
              />

              {a.status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Reading their attendance…</Text>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 76, marginTop: sp.sm }}>
                    {strip.map((w) => {
                      // An uncovered week is a hollow slot, not a zero bar. A bar
                      // of height zero claims they came in no times that week;
                      // before the first row on record there is no such claim.
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
                    {`Days they were recorded at a gym, week by week, over the last ${RHYTHM_WEEKS} weeks. A dashed slot is a week before your record of them starts — not a week they stayed away. The last bar is this week and is not finished.`}
                  </Text>

                  <View style={{ flexDirection: 'row', gap: sp.xl, marginTop: sp.lg }}>
                    <View>
                      <Text style={{ ...ty.micro, color: t.ink3 }}>Days on record</Text>
                      <Text style={{ ...ty.head, ...numeric, color: t.ink, marginTop: 2 }}>
                        {countable ? num(a.days.length) : fig(null)}
                      </Text>
                    </View>
                    <View>
                      <Text style={{ ...ty.micro, color: t.ink3 }}>Days a week</Text>
                      <Text style={{ ...ty.head, ...numeric, color: t.ink, marginTop: 2 }}>
                        {countable && a.rhythm.perWeek != null ? a.rhythm.perWeek : fig(null)}
                      </Text>
                    </View>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    {!countable
                      ? 'No average while the record is incomplete. A rate over part of it is a figure about a gym they may not even go to.'
                      : a.rhythm.perWeek == null
                        ? (a.rhythm.firstDay
                          ? `Your record of them starts ${shortDay(a.rhythm.firstDay)}. There is not yet a finished week inside it to average, so no rate is shown.`
                          : 'Nothing recorded yet, so there is no average. A zero here would be a claim, not a blank.')
                        : `Averaged over the ${a.rhythm.countedWeeks} finished week${a.rhythm.countedWeeks === 1 ? '' : 's'} since ${shortDay(a.rhythm.firstDay as string)}. This week is left out — it is not over.`}
                  </Text>
                </>
              )}
            </Section>

            <Rule />

            {/* ── the record itself ───────────────────────────────────────── */}
            <Section>
              <SectionHead
                title={client ? `${client.name} · every visit` : 'Every visit'}
                note={countable && a.events.length ? num(a.events.length) : undefined}
              />

              {!a.classesComplete && a.events.length ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
                  Some of these are classes this app could not open — usually a gym they are no longer
                  with. The attendance is still real; only the class details are missing.
                </Text>
              ) : null}

              {a.status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Reading their attendance…</Text>
              ) : a.events.length === 0 ? (
                // Said only under 'ready' AND only when this coach's account can
                // actually reach a register. Either gate failing means the empty
                // list is unknown, and the notices above already have the page.
                a.status === 'ready' && hasGym === true ? (
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    Your gym has nothing on record for them. That can simply mean it does not scan
                    people at the door and their classes have not been marked off — plenty of gyms
                    record neither. It is not a record of them staying away, and it is not a reason
                    to ring them about one.
                  </Text>
                ) : null
              ) : (
                a.events.map((e, i) => row(e, i === 0))
              )}
            </Section>

            {a.undated.length ? (
              <>
                <Rule />
                <Section>
                  <SectionHead title="On record, date unknown" note={countable ? `${a.undated.length}` : undefined} />
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
                    Classes they booked whose details this app cannot read, so there is no date to put
                    them on. Listed here rather than dropped or guessed onto a day, and not counted above.
                  </Text>
                  {a.undated.map((e, i) => (
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
              <Text style={{ ...ty.caption, color: t.ink3 }}>{STAFF_RECORD_NOTE}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                There is no attendance percentage on this page and there is not going to be one. It
                would need a count of the classes they were expected at, and a register nobody ticked
                is not evidence that they were expected or that they did not come.
              </Text>
              {client ? (
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Message Them" onPress={() => router.push({ pathname: '/(trainer)/chat', params: { clientId: client.id, name: client.name } })} />
                </View>
              ) : null}
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
