// Coach · Their week. What one client has told the calendar they intend to do.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// `planned_days` shipped with a coach policy on it — `planned_days_coach_read`,
// SELECT on `is_my_client(client_id)` — written so that a coach could see this,
// and then nothing read it. The client could mark Thursday as travel and Friday
// as legs and the only person who could see either was the client. A coach
// spent Friday chasing a session that had been called off on Sunday, which is
// the difference this screen is for: knowing a session was never going to
// happen rather than discovering afterwards that it did not.
//
// ── It reads, and it cannot write ─────────────────────────────────────────
//
// There is no edit control here and there is not going to be one. The policy
// grants SELECT and nothing else on purpose, and src/lib/plannedDays.ts has no
// coach-side write for the same reason `client-goals.tsx` has no Done button: a
// plan is the client's own statement of what they mean to do, and a coach
// quietly editing it would turn the client's calendar into an assignment. That
// is what `assigned_programs` already is. A coach who disagrees with a planned
// rest day has the messaging thread, and the disagreement is shown to both of
// them rather than settled behind one of their backs.
//
// ── Nothing here is a record ──────────────────────────────────────────────
//
// Every judgement is src/lib/dayPlan.ts's and every sentence comes from
// src/lib/coachWeek.ts, which puts `planOutcome` and `planConflict` into the
// coach's voice and can be tested without a database. This screen reads no
// training log and says so out loud on every day that has passed — see the
// header of coachWeek.ts for why reading one honestly would need the client's
// timezone, which the schema does not store. So there is no path through this
// file that draws a plan as something that happened: no tick, no percentage, no
// "completed", and past days are drawn quieter than future ones rather than
// resolved.
//
// ── Whose today ───────────────────────────────────────────────────────────
//
// The COACH's. `isoToday(new Date())` reads the device this screen is running
// on, and that device is the coach's. The alternative would be the client's own
// calendar day, which is the one their plan is really about — but no column
// anywhere in this schema holds a client's timezone, so it could only be
// guessed, and a guessed day boundary is exactly the class of invention this
// codebase refuses elsewhere. The cost of choosing the coach's is bounded and
// visible: for a few hours a day a coach in Dubai and a client in Los Angeles
// disagree about which day "today" is, so a date can sit under Ahead for one of
// them and under Already gone for the other. Nothing changes meaning across
// that line — both lists print the full date, both say which side of today they
// are on, and no figure on this screen is computed from the boundary.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { USE_SUPABASE } from '../../src/lib/config';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { fetchClientPlannedDays } from '../../src/lib/plannedDays';
import { scheduledFocus } from '../../src/lib/checklist';
import { isoToday, DAY_TYPE_LABEL, type PlannedDay, type PlannedDayType } from '../../src/lib/dayPlan';
import {
  coachWeek, planWindow, dayHeading, whenLabel, coachPlanLine, coachConflictLine,
  programmeCaveat, planNote, DAYS_AHEAD, DAYS_BEHIND,
  type CoachPlanDay, type ScheduledFocus,
} from '../../src/lib/coachWeek';

/** A day type's mark colour. A mark beside ink-coloured text, never coloured
 *  text: the scale reserves status colour for status and none of these clears
 *  AA as type. Training and deload are both sessions and read as the brand;
 *  the two days without one are deliberately quiet. */
function markFor(type: PlannedDayType, t: ReturnType<typeof useTheme>): string {
  switch (type) {
    case 'training': return t.brand;
    case 'deload': return t.s3;
    case 'rest': return t.ink3;
    case 'off': return t.ink3;
  }
}

export default function ClientWeek() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  const ap = useAssignedPrograms();
  // Arrives from the client sheet on the dashboard, so a coach already looking
  // at somebody lands on that person rather than on a picker.
  const { clientId } = useLocalSearchParams<{ clientId?: string; name?: string }>();

  const [picked, setPicked] = useState<string | null>(clientId ?? null);

  // Null is "we do not know", never "they have marked nothing" — the whole
  // point of the three states below.
  const [days, setDays] = useState<PlannedDay[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [status, setStatus] = useState<LoadStatus>('ready');
  // Fixed at the moment of the read rather than recomputed on every render, so
  // a screen left open over midnight cannot re-sort itself under the coach's
  // hands halfway through reading it. Reopening the client re-reads and moves.
  const [todayISO, setTodayISO] = useState<string>(() => isoToday(new Date()));

  // The client whose read is allowed to reach the screen. Tapping through a
  // book of clients starts a read per tap and they do not come back in order,
  // so without this a slow answer for the person tapped first lands under the
  // name of the person tapped second — one client's plans shown as another's.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string) => {
    wanted.current = id;
    setStatus('loading');
    setDays(null); setSkipped(0);
    const today = isoToday(new Date());
    const w = planWindow(today);
    if (!w) { setStatus('error'); return; } // unreachable; isoToday cannot fail to parse
    const read = await fetchClientPlannedDays(id, w.fromISO, w.toISO);
    if (wanted.current !== id) return;
    setTodayISO(today);
    setDays(read.days);
    setSkipped(read.skipped);
    setStatus(read.days == null ? 'error' : read.truncated ? 'partial' : 'ready');
  }, []);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    if (!picked) {
      // Deselecting has to disown the read in flight too, or it lands on a
      // screen that is no longer showing anybody.
      wanted.current = null;
      setDays(null); setSkipped(0); setStatus('ready');
      return;
    }
    void load(picked);
  }, [picked, load]);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  const who = client?.name.split(' ')[0] ?? 'They';

  // The programme this coach has assigned them, or null. Null covers three
  // different situations — none assigned, the read failed, and a programme
  // assigned by a different coach, which `assigned_programs_coach_rw` will not
  // show this one — and none of the three is "their programme schedules
  // nothing". So a null programme feeds `undefined` into planConflict, which
  // claims no conflict on an unknown, and the caveat below says so in words.
  const programme = picked ? ap.getProgram(picked) : null;
  const focusOn = useCallback<ScheduledFocus>(
    (weekday) => (programme ? scheduledFocus(programme.days, weekday) : undefined),
    [programme],
  );

  const board = useMemo(
    () => coachWeek(status === 'error' ? null : days, todayISO, focusOn),
    [status, days, todayISO, focusOn],
  );

  const caveat = ap.status === 'loading' ? null : programmeCaveat(!!programme, who);

  // The span actually asked for, so the empty-week sentence can name its own
  // edges rather than describe a fortnight in the abstract.
  const window = useMemo(() => planWindow(todayISO), [todayISO]);

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  /** One marked day. Past days are drawn quieter than future ones; that is the
   *  only difference, because it is the only difference we can honestly draw —
   *  a day that has gone is still nothing more than what they intended. */
  const dayRow = (d: CoachPlanDay, i: number) => {
    const past = d.side === 'gone';
    const note = planNote(d);
    return (
      <View key={d.plan.dateISO} style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        <Text style={{ ...ty.micro, color: t.ink3 }}>
          {dayHeading(d.plan.dateISO)} · {whenLabel(d.plan.dateISO, todayISO)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.xs }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: markFor(d.plan.type, t) }} />
          <Text style={{ ...ty.body, fontWeight: '600', color: past ? t.ink2 : t.ink }}>
            {DAY_TYPE_LABEL[d.plan.type]}
          </Text>
        </View>
        <Text style={{ ...ty.label, color: past ? t.ink3 : t.ink2, marginTop: sp.xs }}>
          {coachPlanLine(d.plan.type, d.outcome, who)}
        </Text>
        {/* Their own words, attributed. Refeed and travel are notes rather than
            day types (see the header of dayPlan.ts), so this line is usually
            the only place the reason for a marked day is written down. */}
        {note ? (
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>
            {who}&rsquo;s note: &ldquo;{note}&rdquo;
          </Text>
        ) : null}
        {d.conflict ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.warn}>{coachConflictLine(d.conflict, d.plan.type, who)}</Flag>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>Their Week</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          The days a client has marked ahead of time — training, rest, a deload, or a note about
          being away. Every line here is what they intend, never a record of what they did, and
          none of it is yours to change.
        </Text>

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="Planned days live on the server and belong to the client, so there is no local copy of somebody else's to fall back on. Nothing below is a claim that they have marked none." />
          </Section>
        ) : (
          <>
            {r.status === 'error' ? (
              <Section>
                <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
                  note="This is not an empty book. Nobody is listed below because the list did not come back — pull back and open this again once you are connected." />
              </Section>
            ) : null}

            <Section>
              <SectionHead title="Client" />
              {r.roster.length === 0 && r.status !== 'error' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  Nobody is on your book yet, so there are no weeks to look at.
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

            {picked ? (
              <View>
                <Rule />

                {/* The three states, kept apart. Each is a different fact about
                    this person and each starts a different conversation. */}
                {status === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their planned days&hellip;</Text></Section>
                ) : board.state === 'unreadable' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their planned days could not be read"
                      note={`Nothing is shown below because nothing came back. It does not mean ${who} has marked nothing — that is a different answer, and this screen cannot tell you which one you are looking at until the read succeeds.`} />
                  </Section>
                ) : board.state === 'none' ? (
                  <Section>
                    <SectionHead title={client?.name ?? 'Their week'} note="nothing marked" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      The read came back and {who} has marked no days between{' '}
                      {dayHeading(window?.fromISO ?? '')} and {dayHeading(window?.toISO ?? '')}.
                      That is about them rather than
                      about the connection — most clients never open the planner, so an empty
                      fortnight is the ordinary answer and not a problem to solve.
                    </Text>
                  </Section>
                ) : (
                  <>
                    {/* Conflicts first, and only the ones still ahead. A day
                        their programme and their own mark disagree about is
                        worth a message while it can still be settled; the same
                        disagreement on a day already gone is an argument about
                        the past, so it stays on its row and out of here. */}
                    {board.conflicts.length ? (
                      <Section>
                        <SectionHead title="Worth raising" note={`${board.conflicts.length}`} />
                        <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                          Days where {who}&rsquo;s mark and the programme you assigned them say
                          different things. Neither has been changed by the other, and nothing on
                          this screen will change either.
                        </Text>
                        {board.conflicts.map((d) => (
                          <View key={d.plan.dateISO} style={{ marginTop: sp.sm }}>
                            <Text style={{ ...ty.micro, color: t.ink3 }}>
                              {dayHeading(d.plan.dateISO)} · {whenLabel(d.plan.dateISO, todayISO)}
                            </Text>
                            <View style={{ marginTop: sp.xs }}>
                              <Flag tone={t.warn}>
                                {d.conflict ? coachConflictLine(d.conflict, d.plan.type, who) : ''}
                              </Flag>
                            </View>
                          </View>
                        ))}
                      </Section>
                    ) : null}

                    <Section>
                      <SectionHead
                        title="Ahead"
                        // A count is a figure, so it is only printed when the
                        // read is known to be the whole window. Under 'partial'
                        // it would be a subtotal presented as a total.
                        note={isWhole(status) ? `${board.ahead.length} marked` : undefined}
                      />
                      <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                        Today and the next {DAYS_AHEAD - 1} days. Far enough out to hold the whole of
                        next week, which is where a deload or a week away needs catching — after it
                        starts is too late to reprogramme it.
                      </Text>
                      {board.ahead.length ? board.ahead.map(dayRow) : (
                        // Reaching here means the board is 'planned' and Ahead
                        // is empty, so everything it holds is behind today —
                        // which is why this may say they use the planner.
                        <Text style={{ ...ty.body, color: t.ink2 }}>
                          Nothing marked from today on. {who} did mark days in the week just gone,
                          so they do use the planner — this fortnight is simply empty.
                        </Text>
                      )}
                    </Section>

                    {board.gone.length ? (
                      <>
                        <Rule />
                        <Section>
                          <SectionHead title="Already gone" note={`last ${DAYS_BEHIND} days`} />
                          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                            What {who} meant to do, on days that have passed. Still only intentions:
                            this screen does not read their training log, so nothing below says
                            whether any of it happened.
                          </Text>
                          {board.gone.map(dayRow)}
                        </Section>
                      </>
                    ) : null}
                  </>
                )}

                {/* Three things the lists above cannot say for themselves. */}
                {caveat && board.state !== 'unreadable' ? (
                  <Section><Flag tone={t.ink3}>{caveat}</Flag></Section>
                ) : null}
                {status === 'partial' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      Their planned days came back at the row limit, so this is some of the window
                      rather than all of it. What is listed is real; days may be missing from it.
                    </Flag>
                  </Section>
                ) : null}
                {skipped > 0 ? (
                  <Section>
                    <Flag tone={t.warn}>
                      {skipped === 1
                        ? `${who} has marked one more day as a kind of day this version of the app does not know, so it is not in the lists above.`
                        : `${who} has marked ${skipped} more days as kinds of day this version of the app does not know, so they are not in the lists above.`}
                    </Flag>
                  </Section>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
