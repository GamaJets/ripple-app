// Coach · Check-ins your clients have sent you.
//
// ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
//
// `check_ins` is the spine of coaching somebody you never see: once a week a
// client writes a weight, four self-ratings and a paragraph about their week.
// src/lib/coachCheckins.ts was written because nothing on the coach's side had
// ever READ the paragraph; its header records the measurement — four coach-side
// reads existed and between them they took the weight, the timestamp and the
// adherence number.
//
// That module fixed the reading of ONE check-in, on ONE client's screen. What
// stayed broken is the shape of the coach's Monday: twelve clients send twelve
// forms, and the only way to reach them was to open twelve named clients one at
// a time and look. There was no list, and — until supabase/parts/3340 — nothing
// told the coach a form had arrived at all.
//
// So this screen is the queue, and the notification is what sends them to it.
//
// ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
//
// It does not mark anything as read. There is no `check_ins.seen_at` and this
// screen does not invent one: a row that renders "New" off nothing but the
// order it arrived in would be a badge that lies the moment the coach opens
// this list on a second device. Newest first is the whole of the ordering.
//
// It does not summarise a week, score anybody, or rank the queue by who "needs
// attention". The four ratings are the client's own account of their week and
// the app does not get to grade it — the dashboard already carries the app's
// own risk bands, computed from what people did rather than from what they
// said about it (src/lib/clientDrift.ts). Two different claims, kept apart.
//
// It reads `check_ins` across the book, which the coach's own grant already
// allows — `check_ins_coach_read` is `using (is_my_client(user_id))`. Rows the
// roster cannot name are dropped rather than drawn as "Client": the coach's own
// check-ins come back under the same policy (a coach who trains is a client of
// nobody and is not on their own roster), and a queue that listed the coach's
// own Monday form under their own name would be this screen misreading who it
// is for.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Ghost, Notice, PageHead, PartialRead, Rule, Section, SectionHead } from '../../src/ui/kit';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { CheckInReview } from '../../src/ui/coach/CheckInReview';
import { useRoster } from '../../src/ui/roster';
import { useAuth } from '../../src/ui/auth';
import { useCheckinQuestions, fetchAnswers } from '../../src/ui/checkinQuestions';
import type { Answer } from '../../src/lib/checkinQuestions';
import { CheckinQuestionEditor } from '../../src/ui/coach/CheckinQuestionEditor';
import { useSettings } from '../../src/ui/settings';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useBackFromHub } from '../../src/ui/backTo';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, ROW_CAP } from '../../src/lib/rowCap';
import { num } from '../../src/lib/format';
import { MIN_TARGET, hitSlopFor } from '../../src/lib/a11y';
import { hairline, layout, sp, type as ty, font } from '../../src/theme/scale';
import {
  checkInAge, ratingsLine, readCoachCheckIns, type CheckInRow, type CoachCheckIn,
} from '../../src/lib/coachCheckins';

/** The column list, written out here rather than imported.
 *
 *  scripts/check-schema.mjs reads a select list only when it is a literal on
 *  the line — a list arriving by import is a read it cannot verify against the
 *  live database, and `workouts.session_mins` is the reason that check exists.
 *  `user_id` is on it because this screen reads across the book and has to
 *  attribute every row to a person. */
const COLS = 'id, at, user_id, weight_kg, energy, sleep, mood, adherence, note';

interface Entry {
  checkIn: CoachCheckIn;
  clientId: string;
  name: string;
}

export default function CoachCheckIns() {
  const t = useTheme();
  const router = useRouter();
  const goBack = useBackFromHub('(trainer)');
  const { roster, status: rosterStatus } = useRoster();
  const wu = useSettings().weightUnit;
  const { user } = useAuth();
  const myQuestions = useCheckinQuestions(user?.id ?? null);
  /** The client a notification named, or none. The queue opens on them and
   *  says so, with the way back to everybody beside it — the same shape
   *  client-photos.tsx uses for the same parameter. */
  const params = useLocalSearchParams<{ clientId?: string }>();
  const [only, setOnly] = useState<string | null>(
    typeof params.clientId === 'string' && params.clientId ? params.clientId : null,
  );

  const [rows, setRows] = useState<CheckInRow[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [open, setOpen] = useState<string | null>(null);
  /** Answers for the open check-in only. Read when a row is expanded rather
   *  than for the whole queue: a coach opening one of forty should not pay for
   *  forty reads, and the answers mean nothing until a row is open. Undefined
   *  is "not asked yet", null is "the read failed", and `CheckInReview` draws
   *  those two differently. */
  const [answers, setAnswers] = useState<Record<string, Answer> | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    if (!open) { setAnswers(undefined); return () => { live = false; }; }
    setAnswers(undefined);
    void fetchAnswers(open).then((a) => { if (live) setAnswers(a); });
    return () => { live = false; };
  }, [open]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const pull = usePullToRefresh(reload);

  useEffect(() => {
    let live = true;
    if (!USE_SUPABASE) { setStatus('ready'); setRows([]); return () => { live = false; }; }
    (async () => {
      setStatus('loading');
      const { data, error } = await supabase.from('check_ins').select(COLS)
        .order('at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit());
      if (!live) return;
      if (error) {
        // Left as null, never as []. An empty list under 'error' renders as
        // "nobody has sent you a check-in", which is an accusation about
        // twelve people manufactured by a failed read.
        reportError('coachCheckins.list', error);
        setRows(null); setStatus('error');
        return;
      }
      const got = (data ?? []) as CheckInRow[];
      setRows(got);
      // At the cap the list is real and is not the whole list, which is what
      // 'partial' means everywhere else in this app.
      setStatus(got.length >= ROW_CAP ? 'partial' : 'ready');
    })();
    return () => { live = false; };
  }, [tick]);

  /** Rows the roster can put a name to, newest first. */
  const entries = useMemo<Entry[]>(() => {
    if (!rows) return [];
    const names = new Map(roster.map((c) => [c.id, c.name]));
    const out: Entry[] = [];
    for (const row of rows) {
      // `user_id` is on the select list and not on `CheckInRow`, which is the
      // shape of ONE check-in and carries no owner. Read off the row as it
      // arrived, with the same "anything but a string is not an id" rule the
      // rest of that module applies to every column it parses.
      const owner = (row as { user_id?: unknown }).user_id;
      const id = typeof owner === 'string' && owner ? owner : null;
      if (!id) continue;
      const name = names.get(id);
      // Not on the book: the coach's own check-in, or a client whose link has
      // ended. Dropped rather than drawn under a made-up label.
      if (!name) continue;
      const [parsed] = readCoachCheckIns([row]);
      if (parsed) out.push({ checkIn: parsed, clientId: id, name });
    }
    return out;
  }, [rows, roster]);

  const shown = useMemo(
    () => (only ? entries.filter((e) => e.clientId === only) : entries),
    [entries, only],
  );
  const onlyName = only ? roster.find((c) => c.id === only)?.name ?? null : null;

  const read = isWhole(status) && isWhole(rosterStatus);
  const G = layout.gutter;

  /** One person's check-in, closed. Open, it draws the client's own form back
   *  through `CheckInReview` — the same component the client sheet uses, so
   *  there is one reading of a check-in in this app and not two. */
  const row = (e: Entry) => {
    const age = checkInAge(e.checkIn.at);
    const line = ratingsLine(e.checkIn);
    const isOpen = open === e.checkIn.id;
    const who = e.name.split(' ')[0] || e.name;
    return (
      <View key={e.checkIn.id} style={{ borderTopWidth: hairline, borderTopColor: t.ring }}>
        <Pressable
          onPress={() => setOpen(isOpen ? null : e.checkIn.id)}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen }}
          // One stop, one sentence — the ratings and the note are inside this
          // label because they are what the row says, and a screen reader
          // landing on four separate figures reads a table nobody drew.
          accessibilityLabel={[
            e.name,
            age,
            line,
            e.checkIn.note ? 'They wrote a note' : 'No note',
            isOpen ? 'Tap to close' : 'Tap to read it',
          ].filter(Boolean).join('. ')}
          hitSlop={hitSlopFor(MIN_TARGET)}
          style={{ paddingVertical: sp.md, minHeight: MIN_TARGET, justifyContent: 'center' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
            <Text style={{ ...ty.body, ...font('600'), color: t.ink, flex: 1 }}>{e.name}</Text>
            {age ? <Text style={{ ...ty.caption, color: t.ink3 }}>{age}</Text> : null}
          </View>
          {line ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{line}</Text> : null}
          {e.checkIn.note ? (
            <Text numberOfLines={2} style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
              {e.checkIn.note}
            </Text>
          ) : null}
        </Pressable>
        {isOpen ? (
          <View style={{ paddingBottom: sp.lg }}>
            <CheckInReview checkIn={e.checkIn} who={who} weightUnit={wu}
              questions={myQuestions.questions} answers={answers === undefined ? {} : answers}
              onReply={() => router.push({ pathname: '/(trainer)/chat', params: { clientId: e.clientId } } as any)} />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false} refreshControl={pull}>
        <PageHead title="Check-Ins" subtitle="What your clients sent you" onBack={goBack} />

        {status === 'loading' ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xl, textAlign: 'center' }}>
            Reading the check-ins your clients have sent…
          </Text>
        ) : status === 'error' ? (
          <Notice tone={t.warn} kicker="Check-Ins" title="These could not be read"
            note="This is our end, not yours. Nothing has been lost and nobody has been told anything. Pull down to try again once you have signal." />
        ) : !isWhole(rosterStatus) ? (
          <Notice tone={t.warn} kicker="Your Clients" title="Your roster could not be read"
            note="A check-in is only worth reading beside the name of the person who sent it, and that list did not come back. Pull down to try again." />
        ) : roster.length === 0 ? (
          <EmptyRoster lacks="there is nobody to send you one" />
        ) : (
          <>
            {status === 'partial' ? (
              <PartialRead what="check-ins" shown={entries.length} onPress={reload} />
            ) : null}

            {only ? (
              <Section>
                <Text style={{ ...ty.label, color: t.ink2 }}>
                  {onlyName
                    ? `Showing what ${onlyName} has sent.`
                    : 'Showing one client’s check-ins.'}
                </Text>
                <View style={{ marginTop: sp.sm, alignSelf: 'flex-start' }}>
                  <Ghost label="Show Everyone" icon="people"
                    a11yLabel="Show the check-ins from everybody on your book"
                    onPress={() => { setOnly(null); setOpen(null); }} />
                </View>
              </Section>
            ) : null}

            {/* The coach's own questions, written where they read the
                answers to the last ones — which is the moment somebody
                realises they are asking the wrong thing. Part 3380. */}
            <Rule />
            <CheckinQuestionEditor questions={myQuestions.questions} status={myQuestions.status}
              onChanged={myQuestions.reload} />

            <Rule />
            <Section>
              <SectionHead title={only && onlyName ? onlyName : 'Newest First'}
                note={read && shown.length
                  ? `${num(shown.length)} check-in${shown.length === 1 ? '' : 's'}`
                  : undefined} />
              {shown.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                  {only
                    ? 'They have not sent a check-in yet. The form is on their Progress tab, and it is theirs to fill in when they want to.'
                    : 'Nobody has sent a check-in yet. The form is on your clients’ own Progress tab. It is theirs to fill in, and there is nothing to chase from this screen.'}
                </Text>
              ) : shown.map(row)}
            </Section>

            {/* What this list is, said once, at the foot. It is a fact about
                the read and it belongs under the rows it describes. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
              Check-ins from everybody on your book, newest first. Nothing here is marked as read, and
              opening one tells the client nothing. Replying does.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
