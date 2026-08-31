// Coach · What this client has actually done.
//
// ── The hole this closes ───────────────────────────────────────────────────
//
// A coach could not see a client's training. Not "could see it badly" — there
// was no reader. `workouts` was written from three places, one of them the
// coach's own app/(trainer)/log-session.tsx, and read back only by the client's
// phone. Every coach-side query against the table selected `(user_id,
// performed_at)`: src/ui/roster.tsx to date-stamp "last active" on the roster,
// src/lib/clientDrift.ts to decide whether somebody had gone quiet. Timestamps,
// never a movement, never a set, never a load. The client detail sheet on the
// roster carried the sentence "Session history appears here once <name> logs
// workouts", which had never been true and never would be, because nothing was
// ever going to populate it. A client could log a squat session standing next
// to their coach and the coach's app would show a date and nothing else.
//
// ── The permission was already there ───────────────────────────────────────
//
// No migration was needed and none was written. `workouts_coach_read` grants
// SELECT `USING (is_my_client(user_id))`, and `is_my_client(c)` is
// `exists (select 1 from clients where id = c and trainer_id = auth.uid())` —
// coach-scoped, one client at a time, and tenant-scoped by way of the `clients`
// row it has to find. It shipped alongside the insert policy in
// supabase/parts/53-coach-logged-workouts.sql: the write half was used the day
// it landed and the read half was never called by anything. Verified against
// the live database rather than inferred from the repo.
//
// ── Nothing here works anything out ────────────────────────────────────────
//
// The grouping, the volume, the attribution and every sentence come from
// src/lib/clientTraining.ts, which is pure and tested. This file reads two
// queries and draws them. The two are kept apart because they fail
// independently: a refused `clients` read says nothing about the sessions, and
// a refused `workouts` read must never be drawn as a client who has never
// trained.
//
// ── The dashes ─────────────────────────────────────────────────────────────
//
// A total is printed only when the read was WHOLE. Under 'partial' the sessions
// are listed — they are real sessions and worth reading — and every figure over
// them is a dash, because `capped()` hands back a prefix of an unknown set and
// a sum over a prefix is a wrong number rather than a small one. Under 'error'
// the screen says it could not read, and never that there is nothing to read.
//
// ── Whose kilograms ────────────────────────────────────────────────────────
//
// The client's, where the record names one. Every other coach-side screen
// prints in the coach's own unit and is right to; this one is a transcript of
// what the client's phone showed them mid-session, and a coach saying "how did
// 100 feel" to somebody whose app said 220 looks like a coach who was not
// paying attention. `unitFor` decides it, refuses to read a NULL column as
// kilograms, and hands back the sentence that says whose unit is on screen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Ghost, Notice, Flag, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAuth } from '../../src/ui/auth';
import { useSettings } from '../../src/ui/settings';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { type LoadStatus } from '../../src/ui/loadStatus';
import { isQueryableId } from '../../src/lib/clientDrift';
import { rowToEntry, type WorkoutRow } from '../../src/lib/workoutRow';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { setsSummary } from '../../src/lib/ownTraining';
import { volumeIn, type WeightUnit } from '../../src/lib/units';
import { num, fmtTime } from '../../src/lib/format';
import { dayLabel } from '../../src/lib/adherence';
import {
  sessionsOf, attributionOf, attributionLabel, trainingBoard, unitFor,
  type LoggedSession, type TrainingDay, type Attribution,
} from '../../src/lib/clientTraining';

// Written out here, on one line, rather than imported from the library beside
// the logic that consumes them. scripts/check-schema.mjs resolves a select list
// that arrives as a named constant only within the file that names it, so a
// shared constant is a select list nothing compares against the SQL or against
// the live database — which is exactly how `workouts.session_mins` came to be
// declared, committed, generated into setup.sql and never run, breaking every
// workout save for two days. Every other screen in this group declares its own
// (GOAL_COLS, SCAN_COLS, ITEM_COLS) for the same reason.
const WORKOUT_COLS = 'id, performed_at, exercise, sets, feel, cardio, kcal, session_mins, logged_by, amended_at';
const UNIT_COLS = 'weight_unit';

/** How the attribution reads as a chip: short, and tinted only when it is not
 *  the ordinary case. A client logging their own training is what is supposed
 *  to happen and does not need a colour drawing the eye to it. */
const CHIP_SHORT: Record<Attribution, string> = {
  client: 'Theirs',
  you: 'You logged it',
  coach: 'A coach logged it',
  mixed: 'Both',
};

export default function ClientTraining() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  // Whose id "You logged it" is allowed to mean. Null while the session is
  // still being restored, and `attributionOf` deliberately declines to say
  // "you" against a null — see the note there.
  const auth = useAuth();
  const coachUnit: WeightUnit = useSettings().weightUnit;

  // `name` rides along so the header is right during the first render while the
  // roster provider is still reading. It is never an access claim: the read is
  // filtered on the id and the policy behind it is `is_my_client`.
  const params = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const [picked, setPicked] = useState<string | null>(
    typeof params.clientId === 'string' && params.clientId ? params.clientId : null,
  );

  // Null is "we do not know", never "there are none". That distinction is the
  // whole point of the screen: `trainingBoard` is handed null under 'error' so
  // an empty list can never arrive at the renderer meaning two things.
  const [log, setLog] = useState<WorkoutEntry[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [clientUnit, setClientUnit] = useState<unknown>(null);
  const [unitStatus, setUnitStatus] = useState<LoadStatus>('loading');

  // The client whose answers are allowed to reach the screen. Tapping through a
  // book starts a read per tap and they do not come back in order, so without
  // this a slow answer for the first person can land under the name of the
  // second — one client's training attributed to another, which is worse than
  // showing nothing. Same guard as client-body.tsx.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string) => {
    wanted.current = id;
    setStatus('loading'); setUnitStatus('loading');
    setLog(null); setClientUnit(null);

    // A client the coach typed in by hand has a `coach_clients` row and no user
    // account, so their id is not a uuid and Postgres refuses the whole
    // statement rather than skipping the value. Nothing is asked for them, and
    // the screen says why rather than drawing them as somebody who never trains.
    if (!isQueryableId(id)) {
      setStatus('error'); setUnitStatus('error');
      return;
    }

    const [woRes, cliRes] = await Promise.all([
      // Newest first, and `id` settles the ties: one session writes every
      // exercise with the SAME `performed_at`, so an order on the timestamp
      // alone has ties in it by construction — and at the cap the server may
      // break them differently on each read, which would shuffle the exercises
      // of the oldest session on screen between two visits.
      supabase.from('workouts').select(WORKOUT_COLS)
        .eq('user_id', id)
        .order('performed_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
      // Their own unit. RLS on `clients` is what limits this to the coach's own
      // book; the filter is about which client is on screen, not about who may
      // be seen.
      supabase.from('clients').select(UNIT_COLS).eq('id', id).limit(1),
    ]);
    if (wanted.current !== id) return;

    if (woRes.error) {
      reportError('clientTraining.workouts', woRes.error);
      setLog(null);
      setStatus('error');
    } else {
      const page = capped((woRes.data ?? []) as unknown as WorkoutRow[]);
      setLog(page.rows.map(rowToEntry));
      setStatus(page.truncated ? 'partial' : 'ready');
    }

    if (cliRes.error) {
      reportError('clientTraining.unit', cliRes.error);
      setClientUnit(null);
      setUnitStatus('error');
    } else {
      // No row is a real answer and not a failure: a client added to the book
      // by hand has no `clients` row to carry a preference. `unitFor` reads
      // that the same way it reads a NULL column — as never chosen.
      const rows = (cliRes.data ?? []) as { weight_unit?: unknown }[];
      setClientUnit(rows[0]?.weight_unit ?? null);
      setUnitStatus('ready');
    }
  }, []);

  useEffect(() => {
    if (!USE_SUPABASE || picked) return;
    // Deselecting disowns the read in flight too, or it lands on a screen that
    // is no longer showing anybody.
    wanted.current = null;
    setLog(null); setClientUnit(null);
    setStatus('ready'); setUnitStatus('ready');
  }, [picked]);

  // On focus, not on mount, and this is the difference the screen exists for.
  //
  // A coach walks a client through a session, taps into Log a Session, saves
  // it, and comes back here. A mount-only effect would have shown them the read
  // they took before the session existed, and they would have had to relaunch
  // the app to see the work they had just typed. The same is true the other way
  // round: the client logs their own set on their own phone mid-session and the
  // coach pulls back to this screen to check it landed.
  //
  // Deliberately does NOT refresh the roster the way client.tsx does. That
  // provider hands out a fresh value object on every render, so a focus effect
  // keyed on it re-runs whenever the provider re-renders; `load` is a
  // useCallback with no dependencies and `picked` is a piece of state, so this
  // one re-runs when the coach changes client and at no other time.
  useFocusEffect(useCallback(() => {
    if (!USE_SUPABASE || !picked) return;
    void load(picked);
  }, [picked, load]));

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  const fullName = client?.name ?? (typeof params.name === 'string' ? params.name : '') ?? '';
  const who = (fullName || 'They').split(' ')[0];

  const sessions = useMemo(() => (log ? sessionsOf(log) : null), [log]);
  // 'error' hands the board a null, which is the only way it can answer
  // 'unreadable'. Under any other status the rows are the server's own answer.
  const board = useMemo(
    () => trainingBoard(status === 'error' ? null : sessions, status),
    [status, sessions],
  );
  const pick = useMemo(
    () => unitFor(clientUnit, coachUnit, unitStatus, who),
    [clientUnit, coachUnit, unitStatus, who],
  );
  const unit = pick.unit;

  const G = layout.gutter;
  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  /** One exercise inside a session: the movement and what was done to it. */
  const exerciseRow = (e: WorkoutEntry, i: number) => {
    const lifted = setsSummary(e.sets, unit);
    // A cardio entry carries no sets at all, so `setsSummary` is null for it and
    // this is the line instead. Every figure on it is one somebody recorded —
    // there is no derived pace here, because a pace over a distance the client
    // rounded is a precision the record does not have.
    const cardio = e.cardio
      ? [
        e.cardio.mins ? `${e.cardio.mins} min` : null,
        e.cardio.dist ? `${e.cardio.dist} ${e.cardio.unit || ''}`.trim() : null,
        e.cardio.hrAvg ? `avg ${e.cardio.hrAvg} bpm` : null,
      ].filter(Boolean).join(' · ')
      : null;
    // Per-set effort, and only when it lines up with the sets it claims to
    // describe. A `feel` array of a different length than `sets` cannot be
    // matched to them, and printing it anyway would attribute "hard" to a set
    // that was not the hard one.
    const effort = e.feel && e.sets && e.feel.length === e.sets.length ? e.feel.join(' · ') : null;
    return (
      <View key={`${e.id ?? e.exercise}-${i}`}
        style={{ paddingVertical: sp.sm, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.exercise}</Text>
        {lifted ? <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{lifted}</Text> : null}
        {cardio ? <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{cardio}</Text> : null}
        {!lifted && !cardio ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            Recorded with no sets and no distance — the movement was logged, what was done to it was not.
          </Text>
        ) : null}
        {effort ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>How it felt, set by set: {effort}</Text>
        ) : null}
      </View>
    );
  };

  /**
   * One logging event inside a day: who put it there, what was in it, and what
   * it totals. `alone` says this is the day's only entry, in which case the day
   * heading above already carries the totals and the time would only be noise.
   */
  const sessionBlock = (sn: LoggedSession, i: number, alone: boolean) => {
    const attr = attributionOf(sn, auth.user?.id ?? null);
    const vol = volumeIn(sn.volumeKg, unit);
    // fmtTime reads the instant in the coach's own zone, which is where they
    // are standing. A coach in Dubai reading a session logged at 18:15 in Dubai
    // sees 18:15; one reading it from London is entitled to their own clock
    // rather than a time that matches nothing around them.
    const at = Number.isFinite(Date.parse(sn.at)) ? fmtTime(sn.at) : null;
    return (
      <View key={sn.at} style={{ paddingTop: i ? sp.md : sp.sm, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring, marginTop: i ? sp.md : 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>
            {alone ? attributionLabel(attr, who) : `${at ?? 'Time unreadable'} · ${attributionLabel(attr, who)}`}
          </Text>
          {attr === 'client' ? null : (
            <Text style={{ ...ty.micro, color: t.brand }}>{CHIP_SHORT[attr]}</Text>
          )}
        </View>
        {sn.amendedAt ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            {who} has since changed part of this — the record keeps the mark, and neither app can remove it.
          </Text>
        ) : null}

        <View style={{ marginTop: sp.sm }}>
          {sn.entries.map(exerciseRow)}
        </View>

        {/* A per-event footer only where it says something the day's own
            footer does not: a length, an energy figure, or a tonnage that is
            one of several on the day. */}
        {sn.mins != null || sn.kcal != null || (!alone && vol != null) ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.sm }}>
            {!alone && vol != null ? (
              <Text style={{ ...ty.caption, color: t.ink3 }}>{num(vol)} {unit}</Text>
            ) : null}
            {sn.mins != null ? <Text style={{ ...ty.caption, color: t.ink3 }}>{sn.mins} min</Text> : null}
            {sn.kcal != null ? <Text style={{ ...ty.caption, color: t.ink3 }}>{num(sn.kcal)} kcal</Text> : null}
          </View>
        ) : null}
        {sn.minsDisagree ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.warn}>
              The rows of this entry disagree about how long it ran. The figure above is the first
              one on record; nothing here picks a winner between them.
            </Flag>
          </View>
        ) : null}
      </View>
    );
  };

  /**
   * One training day.
   *
   * The day is the heading rather than the session, and src/lib/clientTraining.ts
   * says at length why: this client's own record holds one squat workout written
   * as four rows a second apart, and by timestamp that is four sessions. Where a
   * day does hold more than one logging event they are all here, each with its
   * own time, under a line saying how many there are — so nothing is hidden and
   * nothing has to be worked out from four identical headings.
   */
  const dayBlock = (d: TrainingDay, i: number) => {
    const vol = volumeIn(d.volumeKg, unit);
    const alone = d.sessions.length === 1;
    return (
      <View key={d.day} style={{ paddingTop: i ? sp.xl : sp.md }}>
        <Text style={{ ...ty.head, color: t.ink }}>{dayLabel(d.day)}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: 2 }}>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            {d.exercises} exercise{d.exercises === 1 ? '' : 's'} · {d.sets} set{d.sets === 1 ? '' : 's'}
          </Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            Volume {vol == null ? '—' : `${num(vol)} ${unit}`}
          </Text>
          {d.kcal != null ? <Text style={{ ...ty.caption, color: t.ink3 }}>{num(d.kcal)} kcal</Text> : null}
        </View>
        {/* Two things the line above cannot say for itself, and both of them
            stop a small figure being read as an easy hour. */}
        {d.volumeKg == null && d.sets > 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            No load was recorded against any set, so there is no tonnage to total — a dash rather
            than a nought. Bodyweight work reads exactly like this.
          </Text>
        ) : d.bodyweightSets > 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            {d.bodyweightSets} of those set{d.bodyweightSets === 1 ? '' : 's'} carried no load, so the volume does not cover
            {d.bodyweightSets === 1 ? ' it' : ' them'}.
          </Text>
        ) : null}
        {!alone ? (
          <Flag tone={t.warn} style={{ marginTop: 2 }}>
            Logged in {d.sessions.length} separate entries, listed below. The totals above add all of
            them up — if {who} saved the same work twice, this day reads high and the entries show it.
          </Flag>
        ) : null}

        <View style={{ marginTop: sp.sm }}>
          {d.sessions.map((sn, k) => sessionBlock(sn, k, alone))}
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
            <Text style={{ ...ty.micro, color: t.ink3 }}>{fullName || 'Your book'}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>Their Training</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Every day {who} has trained, newest first — what they logged themselves and what was
          logged for them, with the exercises, sets, reps and loads as they were recorded.
          Read-only: this is their record, and nothing on this screen changes it.
        </Text>

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="Training belongs to the client and lives on the server, so there is no local copy of somebody else's to fall back on. Nothing below is a claim that they have never trained." />
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
                  Nobody is on your book yet, so there is no training to look at.
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
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their logged sessions&hellip;</Text></Section>
                ) : board.state === 'unreadable' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their training could not be read"
                      note={`Nothing is shown below because nothing came back. It does not mean ${who} has logged nothing — that is a different fact and a different conversation. If they were added to your book by hand they have no account for workouts to belong to, which reads the same way from here.`} />
                  </Section>
                ) : board.state === 'none' ? (
                  <Section>
                    <SectionHead title={fullName || 'Their Training'} note="nothing logged" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      The read came back and {who} has no logged sessions at all. That is about them
                      rather than about the connection, which makes it worth raising — and a session
                      you run together can go in from Log a Session on their page, which lands in
                      their own record marked as logged by you.
                    </Text>
                  </Section>
                ) : (
                  <>
                    {/* ── the figures, and a dash wherever the read cannot
                        support one ─────────────────────────────────────── */}
                    <Hero
                      label="Days Trained"
                      figure={fig(board.dayCount)}
                      unit={board.dayCount != null ? (board.dayCount === 1 ? 'day' : 'days') : undefined}
                      note={board.dayCount == null
                        ? 'Their training came back at the row limit, so how much of it there is cannot be counted from here. Everything listed below is real.'
                        : board.newestDay
                          ? `Last trained ${dayLabel(board.newestDay)}.`
                          : 'Nothing on record carries a date this build can read.'}
                      tone={board.dayCount == null ? t.warn : undefined}
                    />
                    <KpiRow items={[
                      { label: 'Sets', value: num(board.sets) },
                      {
                        label: 'Volume',
                        value: board.volumeKg == null ? '—' : num(volumeIn(board.volumeKg, unit)),
                        unit: board.volumeKg == null ? undefined : unit,
                      },
                      { label: 'Last', value: board.newestDay ? dayLabel(board.newestDay) : '—' },
                    ]} />
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                      {board.dayCount == null
                        ? 'Every total here is a dash on purpose: the read came back at its row limit, so a sum over what arrived would be a subtotal wearing a total’s label.'
                        : board.volumeKg == null
                          ? 'Across everything on record. Nothing carried a load, so there is no tonnage to total — a dash rather than a nought.'
                          : 'Across everything on record, over sets that carried a load. Bodyweight sets count on the left and contribute no tonnage.'}
                      {board.entryCount != null && board.dayCount != null && board.entryCount > board.dayCount
                        ? ` Those ${board.dayCount} day${board.dayCount === 1 ? '' : 's'} were logged in ${board.entryCount} separate entries — some days hold more than one, and the days that do say so.`
                        : ''}
                    </Text>
                    {pick.note ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{pick.note}</Text>
                    ) : null}

                    {status === 'partial' ? (
                      <Section>
                        <PartialRead what="training days" shown={board.days.length}
                          onPress={() => { if (picked) void load(picked); }} />
                      </Section>
                    ) : null}

                    <Rule />

                    {board.days.length ? (
                      <Section>
                        <SectionHead title="Sessions" note={board.dayCount == null ? undefined : `${board.dayCount} days`} />
                        {board.days.map(dayBlock)}
                      </Section>
                    ) : null}

                    {/* Kept out of the list above rather than filed under a day
                        nobody trained on. The sets are real; where they sit in
                        the week is not something the record supports. */}
                    {board.undated.length ? (
                      <Section>
                        <SectionHead title="No Readable Date" note={`${board.undated.length}`} />
                        <Flag tone={t.warn}>
                          {board.undated.length === 1 ? 'One entry carries' : `${board.undated.length} entries carry`} a
                          timestamp this build cannot read, so {board.undated.length === 1 ? 'it belongs' : 'they belong'} to
                          no day above. What was done is below and is real; when it was done is not something this
                          screen can state, and it is counted in the totals rather than dropped out of them.
                        </Flag>
                        <View style={{ marginTop: sp.md }}>
                          {board.undated.map((sn, k) => sessionBlock(sn, k, true))}
                        </View>
                      </Section>
                    ) : null}
                  </>
                )}

                {/* The unit note belongs on the page even when there is nothing
                    to print it against — a coach who reads pounds should not
                    have to see a figure first to learn whose unit this is. */}
                {board.state !== 'some' && pick.note ? (
                  <Section>
                    <Flag tone={t.ink3}>{pick.note}</Flag>
                  </Section>
                ) : null}
              </View>
            ) : null}
          </>
        )}

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Grouped by the day it was done on, in your own timezone. Inside a day, each entry is the
          exercises saved together in one go — a client who logs a movement at a time makes several,
          and a day that holds more than one says so above them rather than reading as several
          workouts. Loads are shown in {unit}.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
