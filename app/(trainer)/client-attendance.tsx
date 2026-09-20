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
// it, and an unmarked class says that nobody marked it and stops.
//
// This paragraph used to continue: "There is no 'missed' anywhere on this page,
// no absence count, and no attendance percentage." Quoted rather than deleted,
// because the first third of it stopped being true at part 3060 and the rest
// did not.
//
// There IS a missed line now. `gym_classes.register_taken_at` records whether
// anybody opened the register at all, which is the one fact that separates "she
// did not come" from "nobody pressed the button" — and with it set, an un-ticked
// booked member is a no-show that this screen may say out loud. It is reachable
// on no other path: src/lib/attendance.ts still answers `unmarked` wherever that
// column is null, absent, or unreadable, and refuses to guess it.
//
// What has NOT changed is the rest of the sentence, and it never depended on the
// missing word. There is still no absence COUNT and no attendance percentage —
// a percentage needs a denominator of classes they were expected at, and neither
// an unticked register nor a cancellation is evidence of what they were expected
// at. A screen that can name one no-show is not a screen that can total them.
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
//
// ── And a THIRD empty, which is neither of those two ──────────────────────
//
// A client the coach typed into Add Client has a `coach_clients` row and no
// account. They have never been a member of anything, so there is no register
// to be on and no door to be logged at — and the read for them came back empty
// with no error, exactly like the tenant case above and exactly like a real
// member whose gym does not scan. The screen printed the third one as the
// second: "Your gym has nothing on record for them", over a rhythm strip of
// empty weeks and a "Days on record" of zero, about somebody who has never had
// the app.
//
// `clientIsQueryable` is the only thing that can tell them apart. The id cannot
// — `coach_clients.id` is `uuid DEFAULT gen_random_uuid()` — and the whole
// argument is in src/lib/clientRecord.ts.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { useTheme } from '../../src/ui/components';
import { isWhole } from '../../src/ui/loadStatus';
import { Rule, Section, SectionHead, PageHead, Ghost, Notice, PartialRead, DayBars, Expandable, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value, font } from '../../src/theme/scale';
import { MIN_TARGET } from '../../src/lib/a11y';
import { num, fmtClock, fmtAxisDay } from '../../src/lib/format';
import { appLocale } from '../../src/lib/locale';
import { dateParts } from '../../src/lib/localDate';
import { subjectOf, subjectChange, type RouteParam } from '../../src/lib/routeSubject';
import { useRoster } from '../../src/ui/roster';
import { useTenant } from '../../src/ui/tenant';
import { RHYTHM_WEEKS } from '../../src/ui/attendance';
import { useClientAttendance } from '../../src/ui/clientAttendance';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
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
 * Every one of these is a statement about the RECORD. The `unmarked` line is
 * written the long way round on purpose — a coach skimming for a reason to ring
 * somebody must not be able to read it as an absence, and "Not recorded" on its
 * own is exactly what would get read that way.
 *
 * ── A correction, recorded rather than swallowed ──────────────────────────
 *
 * Until part 3060 this paragraph went on: "None is a statement about the
 * client, because only one of the five states supports one: `attended`." That
 * is written down here rather than deleted, because it is what this screen was
 * built on and a reader who finds the old sentence quoted in a review needs to
 * know it was looked at.
 *
 * It is wrong, and the count is the smaller half of why. There are eight states
 * now, and FOUR of them are statements about the client: `attended`, and the
 * three part 3060 made readable — `cancelled` and `late_cancelled`, which the
 * client performed themselves, and `missed`, which says somebody took the
 * register and they were not on it. A coach may act on `missed`: it is the one
 * line here that is evidence of a no-show, and at a gym with a notice window a
 * `late_cancelled` is evidence behind a charge.
 *
 * What survives the correction is the discipline, which never depended on the
 * count: each line says WHICH RECORD says it, so a coach ringing somebody knows
 * what they are ringing about and what to check at reception. `unmarked` stays
 * the state that asserts nothing, and it is still the majority of an un-ticked
 * register — `missed` is reachable only where `gym_classes.register_taken_at`
 * is set, and src/lib/attendance.ts refuses to guess it.
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
    case 'missed':
      // The one line on this page a coach may act on, and it is still worded as
      // the record: the fact is that the register was taken AND they are not on
      // it, and a coach who says "you missed Tuesday" to somebody who was there
      // needs to know which record to go and look at. Says "the register was
      // taken" out loud because the line above it is the same missing tick with
      // that one fact absent — without it the two read as the same state
      // arbitrarily worded two ways.
      return {
        label: 'The register was taken for this class and they were not marked on it.',
        tone: 'quiet',
      };
    case 'cancelled':
      // Theirs, not the gym's, and said so: a seat withdrawn by the gym is a
      // different event and does not arrive here. Past tense, because this row
      // may equally be a class that has not run — `classOutcome` puts the
      // cancellation ahead of the clock so nobody is told they hold a seat they
      // gave up.
      //
      // ── A correction, recorded rather than swallowed ────────────────────
      //
      // This line read "Cancelled — they gave the seat up, outside your gym's
      // notice period." That clause is written down here rather than deleted,
      // because a coach who remembers reading it needs to know it was looked at
      // and why it went.
      //
      // It asserted a notice period. `cancelStanding` in src/lib/classCancel.ts
      // returns null — and `cancel_class` (supabase/parts/3180) then files a
      // plain 'cancelled' — when `tenants.class_cancel_hours` is NOT SET, and
      // both say in as many words that there is no default window and there
      // must never be one. So 'cancelled' arrives here two ways that the record
      // cannot tell apart: a gym with a window, cancelled in time; and a gym
      // that has never stated one, where there is no inside or outside to be.
      // At the second the old clause invented the gym's policy and then scored
      // the client as having met it — the exact invention that function refuses
      // — in front of the person deciding whether to ring them.
      //
      // What is said instead is the only thing the status word carries: it is
      // not the late one. That is true under both readings, it is a statement
      // about the RECORD like every other line here, and it is the distinction
      // a coach actually needs, because the late word is the one with a charge
      // behind it.
      return {
        label: 'Cancelled — they gave the seat up. It is not recorded as a late cancellation.',
        tone: 'quiet',
      };
    case 'late_cancelled':
      // NO FEE, NO AMOUNT, NO CURRENCY, on the coach's side as well as the
      // member's. What was charged was fixed by the gym's policy at the moment
      // of cancelling and is stored beside the row in
      // `class_booking_cancellations`; today's policy quoted over last month's
      // cancellation is a figure nobody agreed to, and a coach repeating it to
      // a client is how it becomes one. The argument in full is on `seatNote`
      // in src/lib/classSeat.ts. A coach who needs the amount opens the
      // cancellation, where src/lib/classCancel.ts words it from the row.
      return {
        label: 'Cancelled late — they gave the seat up inside your gym’s notice period.',
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
  // Seeded once, and this screen never unmounts — it is registered `href: null`
  // inside <Tabs> (app/(trainer)/_layout.tsx), so a `useState` initialiser runs
  // for the FIRST client a coach opens it for and for nobody after. Opening it
  // for Ben used to draw Amy. `subjectChange` is the rule, with the reasoning
  // and the string[] hazard in src/lib/routeSubject.ts; it is applied during
  // render rather than in an effect so the wrong person is never painted, not
  // even for one frame.
  const [picked, setPicked] = useState<string | null>(subjectOf(clientId));
  const [seenParam, setSeenParam] = useState<RouteParam>(clientId);
  const moved = subjectChange(seenParam, clientId);
  if (moved) { setSeenParam(clientId); setPicked(moved.subject); }
  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);

  /**
   * Whether the server may be asked about this person at all.
   *
   * ── The hole this closes ────────────────────────────────────────────────
   *
   * A client the coach typed into Add Client is a `coach_clients` row. There is
   * no account behind it, no `clients` row, and `class_bookings.client_id` and
   * `gym_visits.client_id` both reference tables such a row is not in — so this
   * screen's read could never return anything for them, whatever gym the coach
   * belongs to. It ran anyway: `coach_clients.id` is `uuid DEFAULT
   * gen_random_uuid()`, so every shape test the id could be put to passes, and
   * both reads came back with zero rows and NO error.
   *
   * The screen then rendered that as a record about the person — "Days on
   * record 0", a rhythm strip of empty weeks, and the sentence "Your gym has
   * nothing on record for them", which goes on to explain that this is not a
   * reason to ring them. It is not a reason to ring them, because there is
   * nobody to have the conversation with: they have never had the app.
   *
   * Computed at render rather than inside the hook call, so a roster that
   * arrives AFTER the read and says this row was typed in by hand withdraws the
   * answer instead of leaving an empty record standing as a fact. `handAdded`
   * undefined is "the roster has not said", which goes on asking — only an
   * explicit true withholds. See src/lib/clientRecord.ts.
   */
  const askable = clientIsQueryable(picked, client?.handAdded);

  // Null, not `picked`, when there is nothing to ask about: the hook's own
  // no-client branch clears its state and asks for nothing, which is exactly
  // right here. Nothing below reads that as an answer — the `!askable` branch
  // takes the whole page before any of it is drawn.
  const a = useClientAttendance(askable ? picked : null);

  // Three reads: the attendance itself, the roster the picker and the header
  // name come from, and the gym whose week-start decides which days fall in
  // which week on the strip below.
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([a.reload(), r.refresh(), Promise.resolve(tenant.refresh())]),
    [a, r, tenant],
  ));

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

  /**
   * The client picker. Above everything while nobody is chosen, because there
   * is nothing else to draw; under the record once somebody is, because the
   * board opens a record page on the client's figure and not on a list of
   * names. The screen is reachable without a param, so the picker cannot go.
   */
  const picker = (
    <Section>
      <SectionHead title={picked ? 'Switch Client' : 'Client'} />
      {/* `isWhole`, not `!== 'error'`. The failed read is already announced
          by the Notice above it, so what this gate was really admitting was
          'loading' — and "Nobody is on your book yet" is a claim about a
          coach's own livelihood being made before anything has been read.
          Loading, failed and genuinely empty are three sentences. */}
      {r.roster.length === 0 && isWhole(r.status) ? (
        <EmptyRoster lacks="there is no record to open" />
      ) : r.roster.length === 0 && r.status === 'loading' ? (
        <Text style={{ ...ty.body, color: t.ink3 }}>Reading your clients…</Text>
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
  );

  const row = (e: AttendanceEvent, first: boolean) => {
    const o = outcomeWords(e.outcome);
    const mins = dwellMinutes(e.visit);
    const tone = o.tone === 'good' ? t.good : o.tone === 'ahead' ? t.brand : t.ink3;
    const title = e.source === 'floor'
      ? 'Gym Visit'
      : e.klass
        ? e.klass.title
        // Rule 3 in src/lib/attendance.ts made visible: not a class with no
        // name, a class this app was not allowed to read.
        : 'A Class We Could Not Read';
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
            <Text style={{ ...ty.body, ...font('500'), color: t.ink, marginTop: 3 }}>{title}</Text>
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── the board's head: back, and the title on the centre line ────
            The client's name sits under it because this is one person's
            record; the picker that names them is below the fold once
            somebody is chosen, as on client-body.tsx. */}
        <PageHead title="Attendance" subtitle={client?.name || undefined} />

        {/* ── who ──────────────────────────────────────────────────────────── */}
        {r.status === 'error' ? (
          <Section>
            <Notice tone={t.warn} kicker="Roster" title="Your Clients Could Not Be Read"
              note="This is not an empty book. Nobody is listed below because the list did not come back — go back and open this again once you are connected." />
          </Section>
        ) : null}

        {!picked ? picker : null}

        {!picked ? (
          <>
            <Rule />
            <Section>
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Pick somebody to see what the gym has on them.
              </Text>
            </Section>
          </>
        ) : !askable ? (
          /* ── the third answer ────────────────────────────────────────────
             Not "the gym has nothing on them" and not "the read failed". This
             person is a name the coach typed into their own book: a
             `coach_clients` row with no account behind it, so there is no
             register they could be on and no door log they could be in — and
             nothing was refused, because nothing was ever entitled to be asked.

             The whole record takes this branch rather than one section of it.
             The rhythm strip, the two figures and the visit list are all the
             same claim said three ways, and a page of them with one notice on
             top is still a page that says a person stopped coming in.

             The same distinction `wellnessPanel`'s `not-asked` kind keeps apart
             from `unreadable` in src/lib/coachWellness.ts. */
          <>
            <Rule />
            <Section>
              <Notice kicker="No Account" title={`${client?.name ?? 'This Client'} Has No Repple Account`}
                note={`You added ${client?.name?.trim().split(/\s+/)[0] || 'them'} to your book by hand, so they have never been a member your gym could record. There is no register with their name on it and no door log to fold together — that is not an empty attendance record and not a failed read. Invite them from your client list and this screen starts from the day they join.`} />
            </Section>
            {client ? (
              <Section>
                <Ghost label="Open Their Client Screen"
                  a11yLabel={`Open the client screen for ${client.name}, where you can invite them`}
                  onPress={() => router.push({ pathname: '/(trainer)/client', params: { clientId: client.id, name: client.name } })} />
              </Section>
            ) : null}
          </>
        ) : (
          <>
            <Rule />

            {/* ── what this record is, before any of it is read ───────────── */}
            {scopeNote ? (
              <Section>
                <Notice tone={t.warn} kicker="Scope"
                  title={hasGym === null ? 'We Could Not Tell Which Gym You Belong To' : 'Your Account Is Not Attached to a Gym'}
                  note={scopeNote} />
              </Section>
            ) : null}

            {a.status === 'error' ? (
              <Section>
                <Notice tone={t.crit} kicker="Not Read" title="Their Attendance Could Not Be Read"
                  note={a.events.length
                    ? 'What is below is what we had before the read failed. It is not confirmed current, and there may be visits missing from it.'
                    : 'This is NOT a record of them never coming in — it is a record we could not open.'}>
                  <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={() => { void a.reload(); }} /></View>
                </Notice>
              </Section>
            ) : null}

            {a.status === 'partial' ? (
              // `shown` is RIGHT as `a.events.length` and stays: `PartialRead`
              // says "showing the first N", and N is how many rows arrived and
              // are on screen below it — a fact about the READ, not a count of
              // visits. `what` was wrong for the same reason the heading below
              // was: the two truncated lists are `class_bookings` and
              // `gym_visits`, and a cancellation is a row in the first.
              <Section><PartialRead what="bookings and visits" shown={a.events.length} onPress={() => { void a.reload(); }} /></Section>
            ) : null}

            {/* ── how often, and only where the record supports saying ──────
                The board's figure card: one headline figure under a quiet
                head, the note that qualifies it, and the strip below. The
                rate is the figure because it is the one thing a coach acts
                on; the day count sits beside it at the smaller size. */}
            <Section>
              <SectionHead
                title="Days a Week"
                note={countable ? `${num(a.days.length)} ${a.days.length === 1 ? 'day' : 'days'} on record` : undefined}
              />

              {a.status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Reading their attendance…</Text>
              ) : (
                <>
                  {/* A dash, never a zero. `countable` is the whole-read gate
                      and `perWeek` is null until there is a finished week to
                      average; either way a rate nobody can stand behind is
                      not drawn as a rate. */}
                  <Text style={{ ...ty.hero, color: t.ink }}>
                    {countable && a.rhythm.perWeek != null ? a.rhythm.perWeek : fig(null)}
                  </Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                    {!countable
                      ? 'No average while the record is incomplete. A rate over part of it is a figure about a gym they may not even go to.'
                      : a.rhythm.perWeek == null
                        ? (a.rhythm.firstDay
                          ? `Your record of them starts ${shortDay(a.rhythm.firstDay)}. There is not yet a finished week inside it to average, so no rate is shown.`
                          : 'Nothing recorded yet, so there is no average. A zero here would be a claim, not a blank.')
                        : `Averaged over the ${a.rhythm.countedWeeks} finished week${a.rhythm.countedWeeks === 1 ? '' : 's'} since ${shortDay(a.rhythm.firstDay as string)}. This week is left out — it is not over.`}
                  </Text>

                  {/* The kit's bars, one per week. An uncovered week is a
                      week before the record starts: its value is null and
                      NOTHING is drawn — a bar of height zero would claim they
                      came in no times that week. A covered week with no days
                      is the grey stub, which is that claim and is true. The
                      count sits under each bar; the unfinished week is grey
                      so it is not read against the finished ones. */}
                  <View style={{ marginTop: sp.lg }}>
                    <DayBars h={64} max={busiest || undefined}
                      days={strip.map((w) => ({
                        label: w.covered ? String(w.days) : '',
                        value: w.covered ? w.days : null,
                        tone: w.complete ? 'brand' as const : 'neutral' as const,
                      }))}
                      spoken={`Days at a gym in each of the last ${RHYTHM_WEEKS} weeks, oldest first: ${strip.map((w) => (w.covered ? w.days : 'before your record')).join(', ')}`} />
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    The grey bar is this week, which is not finished.
                  </Text>
                  <Expandable title="About These Weeks">
                    <Text style={{ ...ty.caption, color: t.ink3 }}>
                      {`Days they were recorded at a gym, week by week, over the last ${RHYTHM_WEEKS} weeks. A week with no bar at all is a week before your record of them starts — not a week they stayed away.`}
                    </Text>
                  </Expandable>
                </>
              )}
            </Section>

            <Rule />

            {/* ── the record itself ───────────────────────────────────────── */}
            <Section>
              {/* RENAMED, and the number left alone. `a.events` is the whole
                  timeline — upcoming bookings are in it, and since part 3060 so
                  are cancellations. "Amy · every visit · 10" beside a client who
                  cancelled ten classes and attended none is the heading naming
                  the opposite of what the figure counts, in front of the person
                  deciding whether to ring them.

                  Renamed rather than filtered: the number sits directly above
                  the list it describes, so filtering it to `attended` would
                  print 0 over ten visible rows and read as a broken screen. The
                  attended figure already has a home and a correct source —
                  "Days on record" above, off `attendedDays`. */}
              <SectionHead
                title={client ? `${client.name} · Everything on Record` : 'Everything on Record'}
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
                  <SectionHead title="On Record, Date Unknown" note={countable ? `${a.undated.length}` : undefined} />
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
                    Classes they booked whose details this app cannot read, so there is no date to put
                    them on. Listed here rather than dropped or guessed onto a day, and not counted above.
                  </Text>
                  {a.undated.map((e, i) => (
                    <View key={e.key}>
                      {i > 0 ? <Rule /> : null}
                      <View style={{ paddingVertical: sp.md }}>
                        <Text style={{ ...ty.body, color: t.ink }}>A Class We Could Not Read</Text>
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

        {picked ? picker : null}

        {/* What this page is, said once and below the record: the board opens
            on the figure, not on a paragraph. */}
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Their classes and every time your gym recorded them coming through the door — the register
          and the door log, folded together so one visit is one line. A class with nothing marked
          against it means nobody took the register. It is not a missed session, and nothing here
          counts it as one.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
