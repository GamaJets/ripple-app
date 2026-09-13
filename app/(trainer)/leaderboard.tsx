// Trainer · Leaderboard. Orders the roster by the one figure on it that is a
// stated measurement, and shows everything else beside that figure rather than
// inside it. Reached from Analytics.
//
// ── THE COMPOSITE THAT USED TO BE HERE ────────────────────────────────────
//
// `Math.round(adherence + Math.max(0, prog ?? 0) * 4)`, where `adherence` is
// 0–100 and `prog` is a weight delta in KILOGRAMS. Four points per kilogram,
// added to a percentage. The coefficient was written nowhere, derived from
// nothing, and could not be — there is no exchange rate between a kilogram and
// a percentage point, so the number it produced was not a quantity of anything.
// It was then rendered as `score / maxScore` under a progress bar, which reads
// as a proportion of something achievable, and printed at the end of the row in
// the same weight this app prints real figures in.
//
// Two clients could not be compared by it either. A client who lost 3 kg toward
// a fat-loss goal scored twelve points above one who lost none, and a client
// working on strength who GAINED 3 kg scored the same twelve — for the opposite
// movement, because `goalScore` flips the sign. That is defensible as a
// direction and indefensible as an addend: it means the board's order changed
// by an amount nobody chose, in units that do not exist, on a screen a coach
// uses to decide who to ring.
//
// So there is no composite. The order is the client's own most recent check-in
// rating and nothing else, the bar is that rating against its own scale rather
// than against the top of the board, and the weight movement is a fact printed
// beside the name rather than a term in a sum. Nothing here invents a number.
//
// ── AND THE ROW WENT NOWHERE ──────────────────────────────────────────────
//
// Every ranked row pushed `/(trainer)/analytics` — the same screen for every
// client on the board — so a coach who spotted somebody sliding down it tapped
// their name and landed on a page that says nothing about that person. The
// unranked rows below already opened that client's own thread. Both do now.
//
// ── AND THE FIVE FACTS THE ROW WAS ALREADY HOLDING ────────────────────────
//
// Having refused to invent a figure, this screen then printed one twentieth of
// what it knew. `useRoster` puts `joinedAt`, `lastActive`, `unread`, `injuries`
// (each flagged when it was disclosed inside the last fortnight) and the latest
// scan's `metrics` on every row before the board renders, and the board drew
// none of them. Nothing here is a new read: it is the same rows, said out loud.
//
// It matters most exactly where this screen is weakest. The order is one
// self-reported rating, and a rating is only legible against how long somebody
// has been doing this: 60% from a client on day nine is a normal first
// fortnight, and 60% from a client of two years who has not been seen in a
// month with a message waiting is the call to make this morning. Same number,
// opposite meanings, and the row had the join date in hand for both.
//
// The words are all in src/lib/leaderboardFacts.ts with their own test, for the
// reason that module's header sets out: four of these five fields have an
// absent state that a zero or a blank would misreport, and `unread` has the
// expensive one — null means the count could not be read, 0 means nobody is
// waiting, and a leaderboard that prints those alike tells a coach nobody has
// messaged them on the one screen that exists to say who has. None of it is
// folded into the order. They are facts printed beside the name, on exactly the
// terms the weight delta has always been printed on.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, value } from '../../src/theme/scale';
import { useSettings } from '../../src/ui/settings';
import { weightDeltaIn } from '../../src/lib/units';
import { deltaLabel } from '../../src/lib/deltaLabel';
import { useRoster } from '../../src/ui/roster';
import { useToday } from '../../src/ui/today';
import { rowFacts, rowSpoken, unreadMark, injuryMark } from '../../src/lib/leaderboardFacts';
import { isWhole } from '../../src/ui/loadStatus';
import { useCallback } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { BACK_ICON } from '../../src/ui/direction';

export default function Leaderboard() {
  // The COACH's unit, not the client's. This screen is read by the coach.
  const wu = useSettings().weightUnit;
  const t = useTheme();
  const router = useRouter();
  const { roster, status, refresh } = useRoster();
  // The reader's own calendar day, re-settled at midnight by the provider
  // rather than frozen at mount — a tenure computed from the day this screen
  // happened to open is wrong for every coach who leaves the app running.
  const today = useToday();
  // The roster is the whole of this screen. Every figure ranked here —
  // adherence, weight change — arrives on the roster rows themselves, and
  // they move when a client checks in on their own phone.
  const pull = usePullToRefresh(useCallback(() => refresh(), [refresh]));

  // ── Who can be ranked at all ──────────────────────────────────────────────
  //
  // `adherence` is null when a client has never submitted a check-in, and
  // `weightDelta` is null when they have never been scanned. This screen used
  // to score those as `adherence ?? 0`, which reads as a real measurement: a
  // client nobody has heard from ranked last, below everybody, indistinguishable
  // from one who checks in every week and reports zero. The comment defending it
  // argued against the OTHER default — an earlier version handed them 100, so
  // strangers outranked people who were training — and both are the same
  // mistake pointing in opposite directions.
  //
  // A ranking is a comparison, so it needs something measured to compare. With
  // no adherence on record there is nothing, and the honest answer is that this
  // client cannot be placed rather than that they came last. They are listed
  // below the board instead, with what is missing, which is also the more
  // useful thing for a coach to see: it names who to chase for a check-in.
  /**
   * Which way this client's weight moving counts as progress — a DIRECTION,
   * never a quantity.
   *
   * True for a fat-loss or toning goal and false otherwise, so a client working
   * on strength who has gained is going the way they meant to. It words the
   * line under the name and draws nothing else: the kilograms it describes are
   * not added to anything, because there is no rate at which a kilogram becomes
   * a percentage point.
   */
  const wantsLoss = (c: (typeof roster)[number]) => /fat|tone/i.test(c.goal);

  /**
   * The board, ordered on the client's own last check-in rating.
   *
   * `roster.adherence` is that rating and nothing more: the client picked 1 to
   * 5 on their most recent check-in and `useRoster` scales it to a percentage
   * because every trainer surface renders it as one. It is a self-report about
   * one day, it is the only figure on this row two clients can be compared by,
   * and the header says both of those things rather than letting the word
   * "leaderboard" imply a measurement nobody took.
   *
   * The tie-break is the name, so two clients on the same rating hold a stable
   * order between renders. Without one the board reshuffles people who have
   * done nothing, which reads as movement.
   */
  const scored = roster
    .filter((c) => c.adherence != null)
    .map((c) => ({ c, rating: c.adherence as number, scanned: c.weightDelta != null }))
    .sort((a, b) => b.rating - a.rating || a.c.name.localeCompare(b.c.name));

  // Everyone the board cannot place. Not a failure state and not a ranking —
  // a list of people nothing has been recorded about yet.
  //
  // ── And the third answer, which used to be folded into this one ──────────
  //
  // A client the coach typed into Add Client is a `coach_clients` row with no
  // account behind it. `useRoster` cannot give such a row an `adherence` — there
  // is no `clients` row for the check-in read to reach, and every policy that
  // read passes through resolves `is_my_client()`, an EXISTS over `clients` — so
  // it arrives here as null for a reason that has nothing to do with the person.
  //
  // They then landed in `unplaced`, under the heading "Not enough recorded to
  // rank" and the sentence "These clients have never submitted a check-in", with
  // "no check-ins · no scans yet" on the row and "Message {name}, who has not
  // checked in" spoken to a screen reader. Every one of those is a statement
  // about somebody's diligence, manufactured out of the absence of an account.
  //
  // `handAdded` is the only thing that can tell the two apart — the id cannot,
  // because `coach_clients.id` is `uuid DEFAULT gen_random_uuid()`. Only an
  // explicit `true` moves a row, which is the rule `clientIsQueryable` states:
  // `undefined` is "the roster has not said yet" and stays where it was rather
  // than accusing a real client of not having an account. No read is withheld
  // here and none was ever made — this screen reads nothing but the roster. What
  // changes is which of three sentences a row is listed under.
  const unplaced = roster.filter((c) => c.adherence == null && c.handAdded !== true);
  const noAccount = roster.filter((c) => c.handAdded === true);

  /** That client's own thread. The same destination the unranked rows below
   *  have always used, and the one thing a coach who has just spotted somebody
   *  sliding down the board actually wants. */
  const openClient = (c: (typeof roster)[number]) =>
    router.push({ pathname: '/(trainer)/chat', params: { clientId: c.id, name: c.name } });

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* Back leads the row and carries a label. Seen on an iPhone 17 Pro:
            it trailed, which put the one control that leaves this screen in the
            top-RIGHT corner — where iOS has never put it and where the rest of
            this app does not put it — and without `a11yLabel` a screen reader
            announced it as "button". The house form is in
            src/ui/FeedbackScreen.tsx, which carries the whole argument. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your roster</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Leaderboard</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Ordered by the last check-in rating each client gave themselves</Text>

        <Rule />

        <Section>
          {/* `isWhole`, like the empty state below. A board read short is
              still worth showing — the people on it are real — but how many
              were ranked is a figure over an unknown fraction. */}
          <SectionHead title="Ranking"
            note={isWhole(status) && scored.length ? `${scored.length} client${scored.length === 1 ? '' : 's'}` : undefined} />
          {/* What the order is, said before anybody reads it as a score. There
              is no composite behind this board and nothing on it was measured
              by the app: it is what each client last said about themselves, and
              a coach ringing somebody at the bottom of it is entitled to know
              that is what they are ringing about. */}
          {scored.length ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
              This is each client’s own rating from their most recent check-in, out of five and shown
              as a percentage. It is what they said about one day rather than something this app
              measured, and nothing else is folded into it. Weight movement is printed beside the
              name and is deliberately not added to it. Nor is anything on the second line — how long
              they have been with you, when they were last seen, their last scan score — or the
              injury and unread marks under it. Those are what the rating is read against, and none
              of them moves anybody’s place.
            </Text>
          ) : null}

          {/* An unread roster is not an empty one. Without this the screen tells
              a coach with a full book that they have no clients, which is the
              most expensive sentence it can say. */}
          {status === 'error' ? (
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="Nothing is ranked below because the roster did not come back — it does not mean nobody is on your book." />
          ) : status === 'partial' ? (
            <Notice tone={t.warn} kicker="Roster" title="This board is built from part of your book"
              note="Your roster came back short, so the ranking below leaves people out and the order is not final." />
          ) : status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : null}

          {/* `isWhole`, not `!== 'error'`. `useRoster` starts as `[]` under
              'loading' and stays there through five-plus sequential round
              trips, so for the whole of every normal open this screen greeted a
              coach with "No clients yet" before it had asked — and under
              'partial' it would have said the same about a book that came back
              short. analytics.tsx gates the identical sentence on the identical
              provider with `rosterWhole`; this is that. */}
          {/* `noAccount` counts here too. A coach whose whole book is people
              they typed in has clients — they are listed further down — and
              "No clients yet" over them is the roster's own rows being denied. */}
          {scored.length === 0 && unplaced.length === 0 && noAccount.length === 0 && isWhole(status) ? (
            <View>
              <Text style={{ ...ty.label, color: t.ink3 }}>
                No clients yet — your leaderboard fills in as clients join and log their workouts.
              </Text>
              {/* The sentence waits for clients to join and, until now, gave a
                  coach nothing to do about it. Same destination and same words
                  as src/ui/EmptyRoster.tsx, which the eleven per-client screens
                  use — this screen's own sentence is kept because it explains
                  what fills the board, which "there is no X" does not. */}
              <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                <Ghost label="Invite a Client" a11yLabel="Invite a client, on the Clients screen"
                  onPress={() => router.push('/(trainer)/dashboard?start=invite')} />
              </View>
            </View>
          ) : null}

          {/* Said only of people who COULD have checked in. With `noAccount` in
              the count this sentence told a coach whose book is two typed-in
              names that nobody had checked in, which is true of nobody: not one
              of them has an app to check in from. */}
          {scored.length === 0 && unplaced.length > 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nobody has checked in yet, so there is nothing to rank on. Everyone on your book is
              listed below.
            </Text>
          ) : scored.length === 0 && noAccount.length > 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              There is nothing to rank on yet. Everyone on your book was added by hand, so none of
              them has an app to check in from — they are listed below.
            </Text>
          ) : null}

          {scored.map(({ c, rating, scanned }, i) => {
            // Decided in src/lib/leaderboardFacts.ts, not here. Each of these is
            // null when there is nothing honest to say, so the row draws or
            // omits whole elements rather than printing a dash into a sentence.
            const facts = rowFacts(c, today);
            const injury = injuryMark(c.injuries);
            const unread = unreadMark(c.unread);
            return (
            <Pressable key={c.id} onPress={() => openClient(c)}
              accessibilityRole="button"
              // Spoken in full. The badges below are a colour and a numeral,
              // which are the two things a screen reader cannot read, and the
              // sentence comes from the same rules that draw them so the two
              // cannot drift apart.
              accessibilityLabel={`${c.name}, rank ${i + 1}, last check-in rating ${rating} per cent. ${rowSpoken(c, today)} Opens their messages.`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <Text style={{ ...value(15), color: i === 0 ? t.brand : t.ink3, width: 20, textAlign: 'center' }}>{i + 1}</Text>
              <View style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                {/* The coach's own unit, not the client's — this row is read by
                    the coach, and app/(trainer)/client-training.tsx already
                    draws that distinction. The delta is stored in kilograms and
                    is converted as a SPAN through `weightDeltaIn`, so a genuine
                    0.4 kg move does not alternate between "0 lb" and "1 lb"
                    week to week off the back of nothing the client did. */}
                {/* Three facts, kept as three. Which direction counts as
                    progress depends on the goal and is said in words, because
                    it cannot honestly be said in a number. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.goal} · {`${rating}% last check-in`} · {scanned ? `${deltaLabel(weightDeltaIn(c.weightDelta as number, wu), { since: null, unit: wu, noChange: 'no change', noBaseline: 'no change' })}${wantsLoss(c) ? ', aiming down' : ', aiming up'}` : 'never scanned'}</Text>
                {/* The roster's own fields, on the row that already had them.
                    Deliberately a SECOND line rather than more clauses on the
                    first: the line above is what the order is made of, and
                    these are the context it is read inside. */}
                {facts.length ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{facts.join(' · ')}</Text>
                ) : null}
                {injury || unread ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: 5 }}>
                    {/* Amber only for a disclosure made inside the last
                        fortnight — the ones a coach has probably not seen. An
                        injury they have already talked about is a fact about
                        the client, not an alert, and a row of permanent amber
                        teaches a coach to read past the one that is new. */}
                    {injury ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        {/* A DOT in the status colour, with the words in ink. `warn` is
                            tuned to the 3:1 a mark needs and not the 4.5:1 text needs
                            (scripts/check-contrast.mjs), and the badge already says the
                            word "New" — colour is never the only channel carrying it. */}
                        {injury.isNew ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} /> : null}
                        <Text style={{ ...ty.micro, color: injury.isNew ? t.ink2 : t.ink3 }}>{injury.text}</Text>
                      </View>
                    ) : null}
                    {/* `unread.known` false is the dash: the count could not be
                        read. It is ink3 and never the brand colour, because an
                        unknown must not wear the badge that means somebody is
                        waiting — and a zero draws nothing at all, which is the
                        state this pair exists to keep distinct. */}
                    {unread ? (
                      <Text style={{ ...ty.micro, color: unread.known ? t.brand : t.ink3 }}>{unread.text}</Text>
                    ) : null}
                  </View>
                ) : null}
                {/* The bar is the rating against its own scale — a hundred is a
                    five out of five — and never against the top of the board. A
                    bar drawn as a fraction of whoever happens to lead reads as a
                    gap to close, and it moves for everybody the moment one
                    person's figure changes. */}
                <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, overflow: 'hidden', marginTop: 7 }}>
                  <View style={{ height: 3, borderRadius: 2, backgroundColor: t.brand, width: `${Math.max(0, Math.min(100, rating))}%` }} />
                </View>
              </View>
              <Text style={{ ...value(18), color: t.ink }}>{rating}%</Text>
            </Pressable>
            );
          })}
        </Section>

        {unplaced.length > 0 ? (
          <View>
            <Rule />
            <Section>
              {/* The damaging one. "Not enough recorded to rank: 3" on a book
                  of twenty-five, read short at twelve, tells a coach that
                  twenty-two people are checking in — and finding who is NOT on
                  the board is the whole point of a leaderboard. */}
              <SectionHead title="Not enough recorded to rank"
                note={isWhole(status) ? `${unplaced.length}` : undefined} />
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                These clients have never submitted a check-in, so there is no adherence to compare.
                That is not a low score — it is no score.
              </Text>
              {/* The same five facts, and this is the half of the screen they
                  are worth most on. Every row here says the identical thing
                  about the ranking — there is nothing to rank on — so without
                  them a coach cannot tell the client who joined on Friday from
                  the one who has been on the book two years and stopped
                  answering, and those are opposite phone calls. */}
              {unplaced.map((c, i) => {
                const facts = rowFacts(c, today);
                const injury = injuryMark(c.injuries);
                const unread = unreadMark(c.unread);
                return (
                <Pressable key={c.id} onPress={() => router.push({ pathname: '/(trainer)/chat', params: { clientId: c.id, name: c.name } })}
                  accessibilityRole="button" accessibilityLabel={`Message ${c.name}, who has not checked in. ${rowSpoken(c, today)}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ ...ty.label, fontWeight: '600', color: t.ink3 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2, textTransform: 'capitalize' }}>{c.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {c.goal} · no check-ins{c.weightDelta == null ? ' · no scans yet' : ''}
                    </Text>
                    {facts.length ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{facts.join(' · ')}</Text>
                    ) : null}
                    {injury || unread ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: 5 }}>
                        {injury ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            {/* A DOT in the status colour, with the words in ink. `warn` is
                                tuned to the 3:1 a mark needs and not the 4.5:1 text needs
                                (scripts/check-contrast.mjs), and the badge already says the
                                word "New" — colour is never the only channel carrying it. */}
                            {injury.isNew ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} /> : null}
                            <Text style={{ ...ty.micro, color: injury.isNew ? t.ink2 : t.ink3 }}>{injury.text}</Text>
                          </View>
                        ) : null}
                        {unread ? (
                          <Text style={{ ...ty.micro, color: unread.known ? t.brand : t.ink3 }}>{unread.text}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>—</Text>
                </Pressable>
                );
              })}
            </Section>
          </View>
        ) : null}

        {/* ── the third answer ──────────────────────────────────────────────
            Not "they are ranked" and not "they have never checked in". These
            are names the coach typed into their own book: a `coach_clients`
            row, no account, no app, and therefore no check-in that could ever
            have been submitted and no scan that could ever have been taken.

            They are listed rather than dropped, because a coach's book is who
            is in it — but under their own heading, with their own sentence, and
            with no per-row "no check-ins · no scans yet" underneath. The row
            opens their client screen rather than a message thread: there is
            nobody on the other end of the thread, and the one useful action is
            to invite them, which is on that screen.

            The same distinction `wellnessPanel`'s `not-asked` kind keeps apart
            from `unreadable` in src/lib/coachWellness.ts. */}
        {noAccount.length > 0 ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Added by hand — no account yet"
                note={isWhole(status) ? `${noAccount.length}` : undefined} />
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                You added these clients to your book yourself, so they have no Repple account and
                nothing of theirs reaches this board. That is not a missing check-in and not a low
                score — there is no app for them to check in from yet. Send them your coaching code
                and they start appearing above from the day they join.
              </Text>
              {noAccount.map((c, i) => (
                <Pressable key={c.id}
                  onPress={() => router.push({ pathname: '/(trainer)/client', params: { clientId: c.id, name: c.name } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name}, added by hand and has no Repple account yet. Opens their client screen.`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ ...ty.label, fontWeight: '600', color: t.ink3 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2, textTransform: 'capitalize' }}>{c.name}</Text>
                    {/* The goal is the one thing on this row that IS known: the
                        coach typed it in themselves. Nothing else is said,
                        because nothing else was ever read. */}
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.goal}</Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>—</Text>
                </Pressable>
              ))}
            </Section>
          </View>
        ) : null}

        <Rule />

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Use the Broadcast button on Clients to celebrate the top of the board.
        </Text>

        {/* The board orders on what a client SAID about one day. What the gym
            RECORDED about them turning up is a different record, kept honestly
            in src/lib/attendance.ts, and a coach reading a low rating is one tap
            from the question of whether the person has actually stopped coming.
            Deliberately a link and not a column on the row: an unticked register
            is not an absence, so there is no attendance figure that could be
            ranked beside these without inventing one. */}
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          A rating is what somebody said about a day. Whether they have actually been in is a
          separate record, and it does not belong in this order.
        </Text>
        <View style={{ marginTop: sp.md }}>
          <Ghost label="Their Attendance" onPress={() => router.push('/(trainer)/client-attendance')} />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
