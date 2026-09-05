// Coach · one client's intake, as they answered it.
//
// ── What this screen is for ────────────────────────────────────────────────
//
// Reading somebody's own account of themselves before deciding what to put them
// through. Their readiness answers, how long they have trained, what they want,
// what they have already tried and given up on, which days they can actually
// turn up, and who to ring if something happens.
//
// It is read-only, entirely and permanently. `clients_intake_guard`
// (supabase/parts/127) refuses a coach's write with 42501 — the same mechanism
// as `clients.injuries` in part 96 and for the same reason: row-level security
// cannot restrict which COLUMNS an update touches, so the coach's own
// `clients_trainer_update` policy would otherwise have let them rewrite the
// disclosure they are meant to be reading. A coach who could edit an intake
// could also edit a "yes" into a "no", and then what is on this screen would be
// a note the reader wrote rather than something their client said.
//
// ── The rule that shapes every line on it ─────────────────────────────────
//
// A readiness questionnaire produces a referral, not a grade. So there is no
// banner here, no colour coding, no count of yeses treated as a score, and no
// ordering that puts the cardiac question above the joint one — that ordering
// would itself be a clinical judgement, made by a fitness app, about a person
// it has never met. The answers are printed in the order they were asked, with
// the client's own words underneath, and the only conclusion offered is the one
// the form has always carried: speak to a doctor before starting.
//
// Everything on this screen comes from src/lib/intake.ts, which holds that rule
// and has a test that fails if anything here starts ranking people.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Notice, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { USE_SUPABASE } from '../../src/lib/config';
import { useRoster } from '../../src/ui/roster';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { useClientIntake } from '../../src/ui/intake';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import {
  READINESS_NOT_ADVICE, READINESS_SEE_A_DOCTOR, TIME_WINDOWS, TRAINING_KINDS,
  TRAINING_PLACES, TRAINING_YEARS, WORK_KINDS, intakeLine, readinessDisclosed,
  readinessNote, readinessUnanswered,
} from '../../src/lib/intake';
import { fmtDay } from '../../src/lib/format';
// The emergency number is the one thing on this screen that is read in a hurry,
// and it was a plain <Text>. `telUrl` decides what may be offered as a call —
// never a handle, never a number with an extension welded on.
import { telUrl, DIAL_UNAVAILABLE_NOTE } from '../../src/lib/dialling';
import { BACK_ICON } from '../../src/ui/direction';

/** A label out of one of the option lists, or the raw id where a document
 *  written by a later build carries something this one does not know. Printing
 *  the id is uglier than printing nothing and is the right way round: the coach
 *  can see that an answer exists. */
const labelOf = (list: { id: string; label: string }[], id: string | null): string | null =>
  id == null ? null : (list.find((x) => x.id === id)?.label ?? id);

export default function ClientIntakeScreen() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  const params = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const param = typeof params.clientId === 'string' && params.clientId ? params.clientId : null;
  // Seeded from the param, so the way in from a client's own screen is
  // unchanged, and falling back to a picker when there is none — the same shape
  // as client-report.tsx and client-nutrition.tsx. Without one this screen was
  // unreachable from Explore, because a row that opens it with no client would
  // have led to a page saying nobody was named.
  const [picked, setPicked] = useState<string | null>(param);
  const id = picked;
  const client = useMemo(() => r.roster.find((c) => c.id === id) ?? null, [r.roster, id]);
  const fullName = client?.name ?? (typeof params.name === 'string' ? params.name : '') ?? '';
  const who = (fullName || 'They').split(' ')[0];

  // A client typed in by hand has a `coach_clients` row and no user account, so
  // nothing server-backed is asked for them and the screen says why rather than
  // showing an empty form.
  //
  // This was `isQueryableId(id)` alone, on the belief that a hand-added client
  // carries an id the phone invented and Postgres would refuse. It does not:
  // `coach_clients.id` is uuid DEFAULT gen_random_uuid(), so from the first
  // round trip onward the guard passed, the read ran, it came back with zero
  // rows and no error, and this screen told the coach that somebody who has
  // never been given the app had not filled in their intake. That is an
  // accusation about a person manufactured out of a read that was never
  // entitled to an answer. The roster is the only thing that knows which table
  // the row came from, so it is asked. See src/lib/clientRecord.ts.
  const queryable = clientIsQueryable(id, client?.handAdded);
  const ci = useClientIntake(USE_SUPABASE && queryable ? id : null);
  // Two reads: the intake itself, and the roster this screen gets the client's
  // name and hand-added standing from — the second decides whether the first
  // is even asked for. The client fills this in on their own phone, so the
  // only way a coach learns they finished it is by asking again.
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([Promise.resolve(ci.reload()), r.refresh()]),
    [ci, r],
  ));
  const intake = ci.intake;

  const disclosed = readinessDisclosed(intake);
  const unanswered = readinessUnanswered(intake);

  /**
   * The emergency number as something the phone can ring, or null.
   *
   * Null is drawn as the ordinary line: a handle, a note or a half-typed number
   * gets no Call control rather than a control that opens nothing. See
   * src/lib/dialling.ts.
   */
  const dialEmergency = telUrl(intake?.emergency.phone);
  const callEmergency = () => {
    if (!dialEmergency) return;
    Linking.openURL(dialEmergency).catch(() => {
      Alert.alert('Could not open the dialler', DIAL_UNAVAILABLE_NOTE);
    });
  };

  /** A line of the document, or nothing at all where they left it blank. An
   *  em-dash in a paragraph of somebody's own words reads as an answer they
   *  gave; a missing line reads as a question they skipped, which is what it
   *  is. */
  const Line = ({ label, value }: { label: string; value: string | null }) =>
    value && value.trim() ? (
      <View style={{ marginTop: sp.lg }}>
        <Text style={{ ...ty.micro, color: t.ink3 }}>{label}</Text>
        <Text style={{ ...ty.body, color: t.ink, marginTop: sp.xs }}>{value.trim()}</Text>
      </View>
    ) : null;

  // No `!id` branch any more: with nobody chosen the screen shows the picker
  // below rather than a sentence about a link. Every branch here is about a
  // client who HAS been named.
  const unasked = !USE_SUPABASE
      ? 'This build is running without the server, and an intake belongs to the client and lives on it. There is no local copy of somebody else’s to fall back on.'
      : !queryable
        ? `${who} was added by hand and has no Repple account yet, so there is nothing to read. Their intake starts existing when they join.`
        : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Before you train them</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }} numberOfLines={1}>
              {fullName ? `${fullName}'s Intake` : 'Their Intake'}
            </Text>
          </View>
        </View>

        {/* Only where the coach chose on this screen. Arriving from a client's
            own page, the way back is Back — a second control that undoes the
            navigation would be two answers to one gesture. */}
        {id && !param ? (
          <View style={{ alignItems: 'flex-start', marginTop: sp.md }}>
            <Ghost label="Someone Else" onPress={() => setPicked(null)} />
          </View>
        ) : null}

        {/* Nobody chosen. The same picker client-report.tsx shows, and for the
            same reason: this screen is reachable from Explore with no params,
            and a coach who searched "intake" must land on something they can
            use rather than on a sentence about a missing link. */}
        {!id ? (
          <Section>
            <SectionHead title="Whose intake?" />
            {r.status === 'error' ? (
              <Flag>Your client list could not be read, so this is not a list of everyone you coach.</Flag>
            ) : null}
            {r.roster.map((c) => (
              <Pressable key={c.id} onPress={() => setPicked(c.id)} accessibilityRole="button" accessibilityLabel={c.name}
                style={{ paddingVertical: sp.md, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                <Text style={{ ...ty.body, color: t.ink }}>{c.name}</Text>
              </Pressable>
            ))}
            {!r.roster.length && r.status === 'ready' ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>You have nobody on your book yet.</Text>
            ) : null}
          </Section>
        ) : /* Four outcomes a naive screen would render identically, and they mean
            different things. `intakeLine` owns which sentence, so this screen
            and the row on their profile cannot come to disagree about whether
            somebody has filled in a form. */
        unasked ? (
          <Section>
            <Flag tone={t.ink3}>{unasked}</Flag>
          </Section>
        ) : (
          <>
            {ci.status === 'error' ? (
              <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{intakeLine(ci.state, ci.progress, who)}</Flag>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                {ci.state === 'unknown' && ci.status === 'loading'
                  ? `Reading ${who}'s intake.`
                  : intakeLine(ci.state, ci.progress, who)}
              </Text>
            )}
            {intake && intake.updatedAt ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                Last changed by {who} on {fmtDay(intake.updatedAt)}. Only they can change it — you
                cannot, deliberately, because an intake a coach can edit is not a disclosure.
              </Text>
            ) : null}
          </>
        )}

        {!unasked && ci.state !== 'unknown' && intake ? (
          <>
            {/* ── readiness ─────────────────────────────────────────────
                First, because it is the part that can change whether the rest
                of the conversation happens at all — and flat, because ranking
                these would be an opinion this app does not have. */}
            <Rule />
            <Section>
              <SectionHead title="Readiness" />
              <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
                {readinessNote(disclosed, unanswered, who)}
              </Text>

              {disclosed.length > 0 ? (
                <View style={{ marginTop: sp.lg }}>
                  {disclosed.map((d, i) => (
                    <View key={d.id} style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{d.prompt}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>Answered yes</Text>
                      {d.note ? (
                        <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>“{d.note}”</Text>
                      ) : null}
                    </View>
                  ))}
                  {/* The whole of what a yes produces. Deliberately the app's
                      calmest component and not a warning: this is a referral,
                      not a verdict, and a red banner would be the app forming a
                      clinical opinion about somebody's heart. */}
                  <Notice tone={t.s5} kicker="What this means" title="A conversation with a doctor, not a decision about training"
                    note={READINESS_SEE_A_DOCTOR} />
                </View>
              ) : null}

              {unanswered.length > 0 ? (
                <View style={{ marginTop: sp.lg }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Not answered</Text>
                  {unanswered.map((q) => (
                    <Text key={q.id} style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{q.prompt}</Text>
                  ))}
                </View>
              ) : null}
            </Section>

            {/* ── what they want ───────────────────────────────────────── */}
            <Rule />
            <Section>
              <SectionHead title="What They Want" />
              <Line label="In their words" value={intake.want.headline} />
              <Line label="By when" value={intake.want.by} />
              <Line label="Why now" value={intake.want.why} />
              {!intake.want.headline.trim() ? (
                <Text style={{ ...ty.body, color: t.ink2 }}>{who} has not answered this part yet.</Text>
              ) : null}
            </Section>

            {/* ── history ──────────────────────────────────────────────── */}
            <Rule />
            <Section>
              <SectionHead title="What They Have Done" />
              <Line label="Training behind them" value={labelOf(TRAINING_YEARS, intake.history.years)} />
              <Line label="Kinds"
                value={intake.history.kinds.length
                  ? intake.history.kinds.map((k) => labelOf(TRAINING_KINDS, k)).filter(Boolean).join(', ')
                  : null} />
              <Line label="Doing at the moment" value={intake.history.doingNow} />
              <Line label="Coached before"
                value={intake.history.coachedBefore == null ? null : intake.history.coachedBefore === 'yes' ? 'Yes' : 'No'} />
            </Section>

            {/* ── what they have tried ─────────────────────────────────── */}
            <Rule />
            <Section>
              <SectionHead title="What They Have Tried" />
              <Line label="Worked" value={intake.tried.worked} />
              <Line label="Did not" value={intake.tried.didnt} />
              <Line label="Will not do again" value={intake.tried.wont} />
              {intake.tried.wont.trim() ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                  Worth taking literally. Somebody who says this and then finds it in week one of
                  their programme is somebody who stops turning up in week three.
                </Text>
              ) : null}
            </Section>

            {/* ── availability ─────────────────────────────────────────── */}
            <Rule />
            <Section>
              <SectionHead title="When They Can Train" />
              <Line label="Days a week"
                value={intake.availability.daysPerWeek == null ? null : String(intake.availability.daysPerWeek)} />
              <Line label="Session length"
                value={intake.availability.sessionMins == null ? null : `${intake.availability.sessionMins} minutes`} />
              <Line label="Times that suit"
                value={intake.availability.times.length
                  ? intake.availability.times.map((w) => labelOf(TIME_WINDOWS, w)).filter(Boolean).join(', ')
                  : null} />
              <Line label="Where" value={labelOf(TRAINING_PLACES, intake.availability.place)} />
              <Line label="Equipment they can reach" value={intake.availability.equipment} />
            </Section>

            {/* ── the rest of their week ───────────────────────────────── */}
            <Rule />
            <Section>
              <SectionHead title="Their Week" />
              <Line label="Their days" value={labelOf(WORK_KINDS, intake.practical.work)} />
              <Line label="Sleep"
                value={intake.practical.sleepHours == null ? null : `About ${intake.practical.sleepHours} hours`} />
              <Line label="Anything else" value={intake.practical.anythingElse} />
            </Section>

            {/* ── emergency contact ────────────────────────────────────── */}
            <Rule />
            <Section>
              <SectionHead title="Who To Call" />
              <Line label="Name" value={intake.emergency.name} />
              {/* ── the one line on this screen that gets read in a hurry ──
                  This was a `<Line>`: a number in a Text node, four taps deep,
                  on a screen a coach opens BEFORE a first session and not
                  during an incident. In the situation this number exists for,
                  the coach is holding a phone and cannot copy a string out of
                  a paragraph. An enquiry from a stranger has been one tap away
                  on app/(trainer)/leads.tsx all along.

                  Offered as a call ONLY when it is dialable. A number that is
                  not one falls back to the plain line rather than to a tap that
                  opens nothing — the coach would find that out afterwards. */}
              {dialEmergency ? (
                <Pressable onPress={callEmergency} accessibilityRole="button"
                  accessibilityLabel={`Call ${intake.emergency.name.trim() || 'the emergency contact'} on ${intake.emergency.phone.trim()}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>Number</Text>
                    <Text style={{ ...ty.body, color: t.brand, marginTop: sp.xs }}>{intake.emergency.phone.trim()}</Text>
                  </View>
                  <Text style={{ ...ty.body, fontWeight: '600', color: t.brand }}>Call</Text>
                </Pressable>
              ) : (
                <Line label="Number" value={intake.emergency.phone} />
              )}
              <Line label="Relationship" value={intake.emergency.relation} />
              {!intake.emergency.name.trim() || !intake.emergency.phone.trim() ? (
                <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>
                  {who} has not given an emergency contact. Ask before you train them in person.
                </Text>
              ) : null}
            </Section>

            <Rule />
            <Section>
              <Text style={{ ...ty.caption, color: t.ink3 }}>{READINESS_NOT_ADVICE}</Text>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
