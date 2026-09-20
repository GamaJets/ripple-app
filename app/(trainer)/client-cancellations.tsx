// Coach · Sessions they cancelled. The record of one client's bookings that
// stopped being theirs — who ended each one, and how close to the hour.
//
// ── Why this screen exists, and why it is here rather than anywhere else ───
//
// `public.session_cancellations` (supabase/parts/380) has recorded every
// cancellation since the day that part was applied and was read by nothing.
// Both people were already permitted to see it. So the position was that the
// database knew who cancelled, when, and how much notice there was, and the
// coach deciding whether somebody is worth holding a Tuesday evening for could
// not look at any of it — which is the exact conversation part 380's own header
// says the record exists to make possible: "a client who books and cancels four
// times a month is a conversation, and today it leaves no trace to have it
// about."
//
// ── Why it hangs off app/(trainer)/client.tsx ─────────────────────────────
//
// Three screens were candidates and two of them are the wrong shape:
//
//   · app/(trainer)/sessions.tsx is the MARKING QUEUE. Its own header says so —
//     past sessions whose outcome nobody has recorded, and it empties itself as
//     the coach works, "which is the opposite of a record". A cancelled booking
//     never enters that queue at all: the slot was recycled, so there is no row
//     left holding an outcome for anybody to mark. Putting a history on a
//     screen whose entire job is to become empty would bury it.
//   · app/(trainer)/calendar.tsx is about HOURS, not people. It is the screen
//     where a coach gives a slot away and it already runs to four and a half
//     thousand lines across a month grid, a day sheet, availability ranges,
//     recurring series and a cancel flow. "How often does this person cancel"
//     is not a question about next Tuesday, and the answer would arrive as a
//     seventh panel on the most crowded screen in the app.
//   · app/(trainer)/client.tsx is where a coach thinks about ONE PERSON. Every
//     other per-client record already hangs off its "Open" section — their
//     goals, their body composition, what they have actually done, their week,
//     their attendance — and this is the same kind of thing: a record about
//     somebody, read before a conversation with them. It goes in beside "What
//     They've Actually Done", because these two are the same question asked
//     from either end: the hours that happened and the hours that did not.
//
// Like app/(trainer)/client-attendance.tsx it also accepts NO client and falls
// back to its own roster picker, which is what makes it safe to list in search.
//
// ── What this screen refuses to say ───────────────────────────────────────
//
// All four refusals are argued at length in src/lib/sessionCancellations.ts and
// none of them is decided here. In summary, on screen:
//
//   · NO RATE. `NO_RATE_NOTE` is printed above the figures, not buried under
//     them, because the number a coach expects to find on a page like this is
//     a percentage and the honest answer is that it cannot exist.
//   · WHO CANCELLED IS NAMED, OR ITS ABSENCE IS. `cancelled_by` may be the
//     client, the coach, the front desk or nobody, and the split is on the face
//     of the screen rather than folded into one total. A coach must never read
//     "4 cancellations" about a client they themselves stood up twice.
//   · ONE ACTION IS ONE ROW. A paused fortnight is four hours removed by one
//     decision and is drawn as one entry with the hours inside it.
//   · THREE SENTENCES FOR AN EMPTY LIST. Loading, failed and genuinely empty
//     are different, and only the third may say that nothing was cancelled.
//     `emptyCancellationsLine` holds that where a test can reach it.
//   · AND A FOURTH EMPTY, WHICH IS NOT ON THAT LIST. A client the coach typed
//     into Add Client is a `coach_clients` row with no account, and
//     `sessions.client_id` references `clients(id)` — so they cannot be booked
//     and cannot be cancelled. The read ran for them anyway, because
//     `coach_clients.id` is `uuid DEFAULT gen_random_uuid()` and passes every
//     shape test, and returned zero rows with no error. The screen printed
//     `emptyCancellationsLine`'s 'ready' branch: "No session of theirs with you
//     has been cancelled since this record began" — a reassurance about
//     somebody's reliability, invented out of the absence of an account, on the
//     screen a coach reads to decide whether to keep holding their slot. It is
//     a THIRD kind of answer and it does not go through that function: see
//     `askable` below and src/lib/clientRecord.ts.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { useTheme } from '../../src/ui/components';
import { isWhole } from '../../src/ui/loadStatus';
import { Rule, Section, SectionHead, PageHead, Ghost, Notice, PartialRead, Donut, Legend, Meter, Expandable, fig, type Slice } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric, value, font } from '../../src/theme/scale';
import { MIN_TARGET } from '../../src/lib/a11y';
import { num } from '../../src/lib/format';
import { appLocale } from '../../src/lib/locale';
import { subjectOf, subjectChange, type RouteParam } from '../../src/lib/routeSubject';
import { useAuth } from '../../src/ui/auth';
import { useRoster } from '../../src/ui/roster';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useClientCancellations } from '../../src/ui/cancellations';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import {
  actorOf, actorLine, actionLine, noticeLine, noticeWords, emptyCancellationsLine,
  NO_RATE_NOTE, BEST_EFFORT_NOTE, RECORD_START_NOTE, ENDED_SERIES_NOTE,
  COACH_SCOPE_NOTE, NOT_A_VERDICT_NOTE,
  type CancelAction, type Cancellation,
} from '../../src/lib/sessionCancellations';

/** A timestamp as the day it happened, on the coach's own clock — the same call
 *  app/(trainer)/client-attendance.tsx makes and for the same reason: the
 *  reader is the coach, and a PT session is routinely at no gym at all, so
 *  there is frequently no `tenants.timezone` to prefer. Through `appLocale()`,
 *  never a hardcoded tag, which is what `check:locale` refuses. */
function dayLabel(iso: string | null): string {
  if (!iso) return fig(null);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fig(null);
  return d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** The time of day, in whichever clock the reader's phone is set to. Empty for
 *  an instant that will not parse, so nothing renders "Invalid Date" beside a
 *  real date — which this codebase has shipped before. */
function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' });
}

export default function ClientCancellationsScreen() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  const uid = useAuth().user?.id ?? null;

  // Arrives from the client screen so a coach already looking at somebody lands
  // on that person rather than on a picker. With no param this is the picker,
  // which is what makes the route safe to list in search — see the exclusion
  // rule at the top of src/lib/features.ts.
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  // Seeded once, and this screen never unmounts — it is registered `href: null`
  // inside <Tabs> (app/(trainer)/_layout.tsx), so a `useState` initialiser runs
  // for the FIRST client a coach opens it for and for nobody after. Opening it
  // for Ben used to draw Amy on every screen shaped like this. `subjectChange`
  // is the rule, with the reasoning and the string[] hazard in
  // src/lib/routeSubject.ts; it is applied during render rather than in an
  // effect so the wrong person is never painted, not even for one frame.
  const [picked, setPicked] = useState<string | null>(subjectOf(clientId));
  const [seenParam, setSeenParam] = useState<RouteParam>(clientId);
  const moved = subjectChange(seenParam, clientId);
  if (moved) { setSeenParam(clientId); setPicked(moved.subject); }

  const client = useMemo(() => r.roster.find((x) => x.id === picked) ?? null, [r.roster, picked]);

  /**
   * Whether the server may be asked about this person at all.
   *
   * A client the coach typed into Add Client is a `coach_clients` row with no
   * account behind it, and `sessions.client_id` references `clients(id)` — so
   * such a person cannot be booked, cannot therefore be cancelled, and has no
   * row in `session_cancellations` that could ever exist. The read ran anyway
   * (`coach_clients.id` is `uuid DEFAULT gen_random_uuid()`, so the id passes
   * every shape test there is), came back with zero rows and no error, and the
   * screen printed the fourth branch of `emptyCancellationsLine`: "Nothing on
   * record. No session of theirs with you has been cancelled since this record
   * began." That is a sentence of reassurance about somebody's reliability,
   * assembled out of the absence of an account, on the screen a coach reads to
   * decide whether to keep holding a Tuesday evening for them.
   *
   * Computed at render rather than inside the hook, so a roster that arrives
   * AFTER the read and says this row was typed in by hand withdraws the answer
   * rather than leaving it standing. `handAdded` undefined is "the roster has
   * not said", which goes on asking — only an explicit true withholds. See
   * src/lib/clientRecord.ts.
   */
  const askable = clientIsQueryable(picked, client?.handAdded);

  // Null, not `picked`, when there is nothing to ask about. The `!askable`
  // branch below takes the whole page before any of this is drawn, so nothing
  // reads the hook's cleared state as an answer about the person.
  const c = useClientCancellations(uid, askable ? picked : null);
  // The word the sentences about this person are built round. A first name
  // where the roster gave one, and a plain pronoun otherwise — never `fig()`,
  // because these strings are running prose and a dash as the subject of a
  // sentence reads as the screen having broken. That is the rule
  // scripts/check-prose.mjs exists for.
  const who = client?.name?.trim().split(/\s+/)[0] || 'They';

  const pull = usePullToRefresh(useCallback(
    () => Promise.all([c.reload(), r.refresh()]),
    [c, r],
  ));

  // `isWhole`, not `!== 'error'`. Every figure below is a COUNT, and 'partial'
  // means the read stopped at PostgREST's row ceiling, so a count over it is a
  // subtotal printed as a total. 'loading' is worse still: it would print a
  // confident zero to a coach whose read has not come back. Three states, one
  // gate, and it is the gate scripts/check-whole.mjs exists to keep.
  const countable = isWhole(c.status);
  const tally = c.tally;
  // Who ended them, as the donut's slices and its legend. The client amber
  // (their diary slipping), the coach blue, anybody else purple, and the hours
  // nobody was signed in for grey.
  const whoSlices: Slice[] = [
    { label: who, value: tally.byClient, tone: 'amber', shown: num(tally.byClient) },
    { label: 'You', value: tally.byCoach, tone: 'blue', shown: num(tally.byCoach) },
    { label: 'Somebody Else', value: tally.byOther, tone: 'purple', shown: num(tally.byOther) },
    { label: 'Not Recorded', value: tally.unattributed, tone: 'neutral', shown: num(tally.unattributed) },
  ];

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
      {/* `isWhole`, not `!== 'error'`. The failed read is announced by the
          Notice above it, so what this gate would otherwise admit is 'loading'
          — and "Nobody is on your book yet" is a claim about a coach's own
          livelihood made before anything has been read. */}
      {r.roster.length === 0 && isWhole(r.status) ? (
        <EmptyRoster lacks="there is no record to open" />
      ) : r.roster.length === 0 && r.status === 'loading' ? (
        <Text style={{ ...ty.body, color: t.ink3 }}>Reading your clients…</Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {r.roster.map((x) => (
            <Pressable key={x.id} onPress={() => setPicked(x.id === picked ? null : x.id)}
              accessibilityRole="button" accessibilityState={{ selected: picked === x.id }}
              accessibilityLabel={x.name} style={chip(picked === x.id)}>
              <Text style={{ ...ty.micro, color: picked === x.id ? t.brandInk : t.ink2 }}>{x.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Section>
  );

  /** One hour, inside the action that removed it. */
  const hourRow = (row: Cancellation, first: boolean) => {
    const when = `${dayLabel(row.startsAt)}${timeLabel(row.startsAt) ? ` · ${timeLabel(row.startsAt)}` : ''}`;
    const notice = noticeLine(row);
    return (
      <View key={row.id}>
        {!first ? <Rule inset={sp.lg} /> : null}
        {/* Grouped and spoken whole: the hour, the notice, and whether it was a
            standing appointment are one fact about one booking, and a screen
            reader meeting them as three elements has to assemble that itself. */}
        <View accessible accessibilityRole="text"
          accessibilityLabel={[when, notice, row.wasSeries ? 'This hour was part of a standing appointment.' : '']
            .filter(Boolean).join(' ')}
          style={{ paddingVertical: sp.md, paddingStart: sp.lg }}>
          <Text style={{ ...ty.body, ...numeric, color: t.ink }}>{when}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{notice}</Text>
          {row.wasSeries ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
              This hour was part of a standing appointment.
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  /** One decision, with every hour it removed underneath it. */
  const actionBlock = (a: CancelAction, first: boolean) => {
    const actor = actorOf(a.rows[0]);
    const said = actorLine(actor, 'coach', who);
    const together = actionLine(a);
    // The dot is the actor said in colour, and colour is the one thing a screen
    // reader cannot read — so it is repeated in the label above. Neutral ink for
    // a cancellation by either of the two people in the arrangement: it is a
    // thing that happened, not a fault. `warn` is reserved for the one state
    // that asks somebody to look, which here is a cancellation nobody is
    // recorded against.
    const tone = actor === 'unattributed' ? t.warn : t.ink3;
    return (
      <View key={a.key}>
        {!first ? <Rule /> : null}
        <View style={{ paddingTop: sp.lg }}>
          <View accessible accessibilityRole="text"
            accessibilityLabel={[`Cancelled ${dayLabel(a.cancelledAt)}`, said, together ?? ''].filter(Boolean).join(' ')}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, marginTop: 6, backgroundColor: tone }} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, ...numeric, color: t.ink3 }}>
                {dayLabel(a.cancelledAt)}{timeLabel(a.cancelledAt) ? ` · ${timeLabel(a.cancelledAt)}` : ''}
              </Text>
              <Text style={{ ...ty.body, ...font('500'), color: t.ink, marginTop: 3 }}>{said}</Text>
              {together ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{together}</Text>
              ) : null}
            </View>
          </View>
          <View style={{ marginTop: sp.sm }}>
            {a.rows.map((row, i) => hourRow(row, i === 0))}
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
        <PageHead title="Cancellations" subtitle={client?.name || undefined} />

        {/* ── who ──────────────────────────────────────────────────────────── */}
        {r.status === 'error' ? (
          <Section>
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="This is not an empty book. Nobody is listed below because the list did not come back — go back and open this again once you are connected." />
          </Section>
        ) : null}

        {!picked ? picker : null}

        {!picked ? (
          <>
            <Rule />
            <Section>
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Pick somebody to see what has been cancelled between you.
              </Text>
            </Section>
          </>
        ) : !askable ? (
          /* ── the third answer ────────────────────────────────────────────
             Not "nothing of theirs has been cancelled" and not "the read
             failed". This person is a name the coach typed into their own book:
             a `coach_clients` row with no account behind it, and
             `sessions.client_id` references `clients(id)` — so there has never
             been an hour of theirs to cancel. Nothing was refused, because
             nothing was ever entitled to be asked.

             The whole record takes this branch rather than one section of it.
             The three tallies and the list are the same claim said twice, and
             a page of them under one notice still reads as a person with a
             clean record.

             The same distinction `wellnessPanel`'s `not-asked` kind keeps apart
             from `unreadable` in src/lib/coachWellness.ts. */
          <>
            <Rule />
            <Section>
              <Notice kicker="No account" title={`${client?.name ?? 'This client'} has no Repple account`}
                note={`You added ${who === 'They' ? 'them' : who} to your book by hand, so there is no account to book an hour against and nothing of theirs has ever been in your calendar. This is not a clean cancellation record and it is not a failed read — there is nothing here to have a record of. Invite them from your client list and this screen starts from the day they join.`} />
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

            {/* Signed out, or an auth read that has not resolved. Said rather
                than rendered as an empty record: the read is scoped by the
                coach's own id, so without one there is nothing to scope it by
                and an empty list would be a claim nobody can stand behind. */}
            {!uid ? (
              <Section>
                <Notice tone={t.warn} kicker="Not read" title="We could not tell which account you are signed in as"
                  note="This record is read against your own coach account, so without it there is nothing below — that is a gap in what we could ask for, not a client with nothing on record." />
              </Section>
            ) : null}

            {c.status === 'error' ? (
              <Section>
                <Notice tone={t.crit} kicker="Not read" title="Their cancellations could not be read"
                  note={c.rows.length
                    ? 'What is below is what we had before the read failed. It is not confirmed current, and there may be more that is missing from it.'
                    : 'This is NOT a record of them never cancelling — it is a record we could not open.'}>
                  <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={() => { void c.reload(); }} /></View>
                </Notice>
              </Section>
            ) : null}

            {c.status === 'partial' ? (
              <Section><PartialRead what="cancellations" shown={c.rows.length} onPress={() => { void c.reload(); }} /></Section>
            ) : null}

            {/* ── the figures, and the one that cannot exist ────────────────
                The board's figure card: the count of cancellations is the
                headline, at the board's figure size, with the hours it
                removed beside it in the head. The middle notice keeps its
                smaller figure under it — a second hero is no hero. */}
            <Section>
              <SectionHead title="Cancellations"
                note={countable ? `${num(tally.sessions)} ${tally.sessions === 1 ? 'hour' : 'hours'}` : undefined} />

              {c.status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Reading their cancellations…</Text>
              ) : (
                <>
                  <Text style={{ ...ty.hero, color: t.ink }}>
                    {countable ? num(tally.actions) : fig(null)}
                  </Text>

                  {/* Directly under the figure rather than in a footnote. The
                      number a coach arrives on this page looking for is a
                      percentage, and it has to be refused before they have
                      finished reading the figure — not afterwards. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{NO_RATE_NOTE}</Text>

                  <View style={{ marginTop: sp.lg }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>Middle Notice</Text>
                    <Text style={{ ...ty.head, ...numeric, color: t.ink, marginTop: 2 }}>
                      {countable && tally.medianNoticeMin != null
                        ? noticeWords(tally.medianNoticeMin) : fig(null)}
                    </Text>
                  </View>

                  {!countable ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                      No figures while the record is incomplete. A count over part of it is a subtotal printed as a total.
                    </Text>
                  ) : (
                  <Expandable title="Hours and the Middle Notice">
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {tally.sessions === tally.actions
                        ? 'One hour per cancellation — nothing here removed several at once. The middle notice is the middle of them, not the average: one cancellation made months ahead would drag an average past every real value in this list.'
                        : 'Hours and cancellations differ because one decision can remove several hours at once — pausing a standing appointment for a fortnight is one action. Each is counted once below.'}
                  </Text>
                  </Expandable>
                  )}

                  {/* ── who, split four ways and never added up ───────────── */}
                  <View style={{ marginTop: sp.xl }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>Who Ended Them</Text>
                    {/* The split as a donut, and ONLY under a whole read: a
                        slice is a share of a total, and a total over a
                        truncated page is the subtotal this screen refuses
                        everywhere else. The hole holds the hours figure the
                        card's head already prints, not a new sum. Each slice
                        keeps its own count beside its name, so the picture
                        never stands in for the four numbers. */}
                    {countable ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg, marginTop: sp.md }}>
                        <Donut slices={whoSlices} centre={num(tally.sessions)} sub={tally.sessions === 1 ? 'hour' : 'hours'}
                          spoken={`Hours cancelled, by who ended them: ${whoSlices.map((x) => `${x.label} ${x.shown}`).join(', ')}`} />
                        <Legend items={whoSlices} />
                      </View>
                    ) : (
                      <Text style={{ ...ty.body, color: t.ink, marginTop: sp.sm }}>{fig(null)}</Text>
                    )}
                    <Expandable title="Why It Is Split">
                    <Text style={{ ...ty.caption, color: t.ink3 }}>
                      Hours, split by who performed the cancellation. It is on the face of this page and
                      not added into one number because the one number is the one that misleads: a total
                      says nothing about whose diary changed.
                      {countable && tally.unattributed > 0
                        ? ' Where it says not recorded, nobody was signed in when it happened — a job or the gym’s own system — so it is not known which of you it was.'
                        : ''}
                    </Text>
                    </Expandable>
                  </View>

                  {/* ── how close to the hour ─────────────────────────────── */}
                  <View style={{ marginTop: sp.xl }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>How Much Notice</Text>
                    {/* Parts of the whole as meters, each against the hours
                        cancelled; green is notice given, amber is short, red
                        is after the hour began. The words carry it — the
                        colour is not a verdict on a fee, see below. */}
                    {countable ? (
                      <>
                        <Meter label="A Day or More" tone="brand" val={tally.over24h} target={tally.sessions} note={num(tally.over24h)} />
                        <Meter label="Under a Day" tone="amber" val={tally.under24h} target={tally.sessions} note={num(tally.under24h)} />
                        <Meter label="After It Started" tone="red" val={tally.after} target={tally.sessions} note={num(tally.after)} />
                        {tally.noticeUnknown ? <Meter label="Not Known" tone="neutral" val={tally.noticeUnknown} target={tally.sessions} note={num(tally.noticeUnknown)} /> : null}
                      </>
                    ) : (
                      <Text style={{ ...ty.body, color: t.ink, marginTop: sp.sm }}>{fig(null)}</Text>
                    )}
                    <Expandable title="What This Does Not Judge">
                    <Text style={{ ...ty.caption, color: t.ink3 }}>
                      Measured between the two times on the record and nothing else. Whether any of these
                      was inside your notice period, and whether a fee was charged, is on the charge
                      itself — your notice period today is not the one that priced a cancellation last
                      spring, and this page will not judge one against the other.
                    </Text>
                    </Expandable>
                  </View>
                </>
              )}
            </Section>

            <Rule />

            {/* ── the record itself ───────────────────────────────────────── */}
            <Section>
              <SectionHead
                title={client ? `${client.name} · every cancellation` : 'Every cancellation'}
                note={countable && c.actions.length ? num(c.actions.length) : undefined}
              />

              {c.status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Reading their cancellations…</Text>
              ) : c.actions.length === 0 ? (
                // Four statuses, four sentences, and only 'ready' may state
                // that nothing was cancelled. Held in the module so a test can
                // reach it — a failed read telling a coach that somebody has
                // never cancelled is the app inventing a reassurance on the
                // screen where it would be acted on.
                <Text style={{ ...ty.label, color: t.ink3 }}>{emptyCancellationsLine(c.status, 'coach')}</Text>
              ) : (
                c.actions.map((a, i) => actionBlock(a, i === 0))
              )}
            </Section>

            <Rule />

            {/* ── what this record is not ─────────────────────────────────── */}
            <Section>
              <Text style={{ ...ty.caption, color: t.ink3 }}>{COACH_SCOPE_NOTE}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{ENDED_SERIES_NOTE}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{RECORD_START_NOTE}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{BEST_EFFORT_NOTE}</Text>
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
          Hours that were booked with you and then were not, newest first — who ended each one, and
          how long before it was due to start. {NOT_A_VERDICT_NOTE}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
