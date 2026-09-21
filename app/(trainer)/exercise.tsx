// Trainer · One exercise, exactly as the client will see it.
//
// A coach picking exercises in the builder had no way to look at one. 601
// catalogue movements, most of them illustrated and every RepDB row carrying a
// description, and the only surfaces that rendered any of it were the client
// app and the owner's. So the person CHOOSING the lift was the one person who
// could not see it, and the realistic failure is not exotic: a coach writes
// "Zottman Curl" into a beginner's Thursday because the name sounded like a
// curl, and finds out what it actually is when the client asks.
//
// Deliberately the same screen as app/(client)/exercise.tsx: same illustration
// renderer (src/ui/ExerciseDemo), same precedence, same chips, same "Muscles
// worked" and the same steps (titled Instructions here, as board page 5 titles
// them), same words for a movement we have no picture of.
// The whole value of this screen is that it is a preview, and a preview built
// from a second visual language is a preview of a page that does not exist.
//
// ── What is different, and why ─────────────────────────────────────────────
//
// The clip preference. The client screen prefers their OWN coach's clip; here
// the coach's own id is what is preferred, because on this app the signed-in
// user IS the trainer. That matters at a gym: the video read is not filtered by
// trainer — RLS decides what this person may see, which includes colleagues'
// clips — so without an explicit preference a coach previewing what THEIR
// client sees could be shown another coach's demonstration as though it were
// the one that will play.
//
// And the closing action. A client with no demonstration is told to ask their
// coach; the coach is the person who can fix it, so they are sent to Videos.
//
// And "Across Your Roster", which a client has no equivalent of. It used to be
// a control under every row of the coach's library; board page 6 draws that
// list as picture, name and chevron, so the question moved to the page that is
// about one movement. Same read (supabase/parts/178), same gates.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useBackTo } from '../../src/ui/backTo';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, Notice, Ghost, PageHead, Flag, TonedChip, Donut, Legend, type Tone } from '../../src/ui/kit';
import { groupTone } from '../../src/ui/coach/ProgramBuilderFlow';
import { sp, layout, radius, elevation, type as ty, font } from '../../src/theme/scale';
import { useExerciseDetail } from '../../src/ui/exerciseDetail';
import { ExerciseMuscles } from '../../src/ui/ExerciseMuscles';
import { useExerciseVideos } from '../../src/ui/exerciseVideos';
import { ExerciseVideo } from '../../src/ui/ExerciseVideo';
import { DemoAnimation, FrameLoop } from '../../src/ui/ExerciseDemo';
import { videoForExercise } from '../../src/lib/exerciseId';
// ── which demonstration, out of the several this movement may have ─────────
//
// This screen renders the winner of a four-way order and said nothing about the
// losers, which is right for the client it previews and wrong for the coach
// reading it. Two coaches reported the same shape from opposite ends: one had
// filmed a movement twice and could not tell which take their clients were
// getting, and one spent an evening filming a lift a colleague at the same gym
// had already covered. Both facts were in `videos` the whole time.
import { clipSources, clipSourceLine } from '../../src/lib/clipSources';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { catalogueValue as cap, num } from '../../src/lib/format';
import { FRAMES_ARE_UNHOSTED, demoCaption } from '../../src/lib/exerciseMedia';
import { useExerciseMedia } from '../../src/ui/useExerciseMedia';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/ui/auth';
import { RepdbInlineCredit } from '../../src/ui/Attribution';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
// ── the question that gets BETTER as a coach gets busier ───────────────────
//
// One client's history of one movement has been readable since
// src/lib/exerciseHistory.ts landed, and the coach's client-training screen
// draws it. "Who is stalled on bench across my roster" was answerable only by
// opening forty screens, so nobody did — which meant the one coaching insight
// that scales with the size of a book was the one the app withheld from a busy
// coach. The two blockers were the flat row cap and an `exercise` column that
// is free text; both are answered in supabase/parts/178, which aggregates in
// the database so the answer is one row per client and can never be truncated.
import { useRoster } from '../../src/ui/roster';
import { useSettings } from '../../src/ui/settings';
import { readRosterExercise } from '../../src/ui/rosterExercise';
import {
  LEVEL_NOTE, LEVEL_TITLE, ROSTER_WINDOW_DAYS, rankRosterExercise, rosterExerciseLine,
  type RosterExerciseClient, type RosterExerciseRow, type StalledLevel,
} from '../../src/lib/rosterExercise';
import { liftIn } from '../../src/lib/units';
import { deltaLabel } from '../../src/lib/deltaLabel';


/** A band's colour, for its slice of the ring and the chip over its list. The
 *  three verdicts take the app's three state colours — going up is fine,
 *  not moving is slipping, going backwards needs the coach — and the three
 *  that are NOT verdicts take hues that say nothing: nobody is doing badly by
 *  being too new to judge. */
const LEVEL_TONE: Record<StalledLevel, Tone> = {
  climbing: 'brand', holding: 'amber', dropping: 'red',
  new: 'blue', 'no-load': 'purple', unseen: 'neutral',
};

export default function TrainerExercise() {
  const t = useTheme();
  const router = useRouter();
  const { name: raw, from } = useLocalSearchParams<{ name?: string; from?: string }>();
  const goBack = useBackTo(from);
  const name = (raw || '').trim();
  const { detail, display, status, signedOut, reload: reloadDetail } = useExerciseDetail(name);
  // `status` as well as the clips. It was destructured away, and the negative
  // this screen prints — "Nobody has filmed this movement" — is a claim about
  // the WHOLE library, so it needs the whole library. Under 'error' the list is
  // `[]` because the read was refused, and the screen told a coach nobody had
  // filmed a movement they had filmed themselves, then offered them the button
  // to do it again. app/(trainer)/library.tsx :253 gates the same negative on
  // `clipsKnown` and its comment says why: a POSITIVE needs only the row we
  // found and survives 'partial', a NEGATIVE needs everything.
  const { videos, status: vidStatus, reload: reloadVideos } = useExerciseVideos();
  const clipsKnown = vidStatus === 'ready';
  const { user } = useAuth();

  // `trainers.id` references `profiles.id`, so on the coach app the signed-in
  // user's auth id IS their trainer id. Passing it is what makes this a preview
  // of their own client's screen rather than of somebody else's.
  const clip = useMemo(
    () => videoForExercise(name, videos, user?.id ?? null),
    [name, videos, user?.id],
  );

  // Gated on the licence recorded against the row, not on anything this screen
  // knows: an evaluation asset from a CC BY-NC preview bundle renders while
  // somebody is deciding whether to buy the pack, and never in a build that
  // reaches a real person. __DEV__ is the only thing that distinguishes them,
  // and it is the one flag that cannot be wrong in a release binary.
  // The same hook the client screen uses. Three apps showing the same
  // movement must resolve its pictures the same way, and a picture that fails
  // to resolve is a silent empty box rather than an error anybody sees.
  const { frames, animUrl, animCacheKey } = useExerciseMedia(detail);
  const caption = demoCaption(detail?.source, frames.length);

  /* ── one movement, across the whole book ────────────────────────────────
     Asked on demand rather than the moment the screen opens: it is one
     aggregate over the whole roster, and a coach who opened this page to
     check what a Zottman curl looks like has not asked it. So the section
     carries a control and the answer opens under it.

     `rosterStatus` and the aggregate's own status are held separately and
     BOTH gate every figure — a coach told "3 of 40 are stalled" off a roster
     that came back short is acting on a denominator that is not their book. */
  const { roster, status: rosterStatus, refresh: refreshRoster } = useRoster();
  // Three reads: the catalogue row this movement is drawn from, the clips the
  // coach or their gym has attached to it, and the roster the per-client
  // lines below are written from. Together, because this screen is a preview
  // of what the client sees and the clip is chosen against the movement —
  // refreshing one alone could show a coach a clip matched to the row they
  // had before.
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([reloadDetail(), reloadVideos(), refreshRoster()]),
    [reloadDetail, reloadVideos, refreshRoster],
  ));
  const coachUnit = useSettings().weightUnit;
  const [askedRoster, setAskedRoster] = useState(false);
  const [rosterRows, setRosterRows] = useState<RosterExerciseRow[] | null>(null);
  const [rosterAsk, setRosterAsk] = useState<LoadStatus>('ready');
  // The movement whose answer is allowed to reach the screen. This page is
  // opened by name, and a second push with a different name while a read is
  // in flight would land the squat's roster under the bench press's heading —
  // one movement's roster attributed to another. The same guard
  // client-training.tsx and client-body.tsx use.
  const wantedMovement = useRef<string | null>(null);

  const askRoster = async () => {
    if (askedRoster) { setAskedRoster(false); return; }
    setAskedRoster(true);
    wantedMovement.current = name;
    setRosterRows(null); setRosterAsk('loading');
    const res = await readRosterExercise(name);
    if (wantedMovement.current !== name) return;
    setRosterRows(res.rows); setRosterAsk(res.status);
  };

  /** Every client on the BOOK, judged — not every client the aggregate had
   *  something to say about. Somebody who has never touched the movement
   *  produces no row at all and is the most interesting person on this list;
   *  building it from the answer would silently only answer for the people who
   *  already do the exercise. */
  const rosterJudged: RosterExerciseClient[] = useMemo(
    () => (rosterRows == null ? [] : rankRosterExercise(roster.map((c) => c.id), rosterRows)),
    [rosterRows, roster],
  );
  const clientName = (id: string) => roster.find((c) => c.id === id)?.name ?? 'One client';

  /** The bands, in the order `rankRosterExercise` already put them in, so the
   *  headings follow the list rather than imposing a second order on it. */
  const rosterBands = useMemo(() => {
    const out: { level: StalledLevel; rows: RosterExerciseClient[] }[] = [];
    for (const c of rosterJudged) {
      const last = out[out.length - 1];
      if (last && last.level === c.level) last.rows.push(c);
      else out.push({ level: c.level, rows: [c] });
    }
    return out;
  }, [rosterJudged]);

  // Everything held for this movement, and which of it is on screen. Built from
  // the SAME values the branches below render — `animUrl` and `frames` after
  // signing and after the licence gate, not from the raw columns — so the note
  // cannot say the catalogue animation is available on a build that will not
  // play it.
  const sources = useMemo(
    () => clipSources(name, videos, user?.id ?? null, { animation: animUrl != null, frames: frames.length > 0 }),
    [name, videos, user?.id, animUrl, frames.length],
  );
  // 'partial' is not 'ready': a clip we matched is a fact, but "these are all of
  // them" is a claim about a library we only read a prefix of.
  const sourceNote = clipSourceLine(sources, isWhole(vidStatus));

  const chips = [detail?.equipment, detail?.level, detail?.mechanic, detail?.force]
    .filter((x): x is string => !!x)
    .map(cap);

  // The demonstration as the page's hero: the large radius and the hero
  // shadow. Two views because a shadow and a clip cannot share one — the
  // `overflow: 'hidden'` that rounds the picture also cuts the shadow off.
  const hero = { borderRadius: radius.xl, backgroundColor: t.surface, ...elevation.hero };
  const heroClip = { borderRadius: radius.xl, overflow: 'hidden' as const };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>
        {/* ── the head, the board's way (client page 5) ────────────────────
            Back at the leading edge and "Exercise Demo" centred between it
            and a spacer the width of the button; under that the movement's
            name at the leading edge with one line about it. The board's line
            is a prescription — "3 sets × 10 reps" — which this page has none
            of: it is opened from the library, not from a day, so the line is
            what the catalogue records about the movement instead, and nothing
            where it records nothing. */}
        <PageHead title="Exercise Demo" onBack={goBack} />
        <View style={{ marginTop: sp.lg, marginBottom: sp.lg }}>
          {/* What the client sees, in the language they see it in — this
              screen's whole claim is that it shows their view, and it was
              showing the English name to a German coach whose German client
              reads the translated one. `display.note` says when the
              catalogue has no translation, so an English name is never
              passed off as a German one. The identity is still `name`. */}
          <Text style={{ ...ty.title, color: t.ink }}>{display?.name.text || detail?.name || name || 'Exercise'}</Text>
          {/* The group in its own colour — the one its chip has in the
              library and its bar has in the builder — and the kit beside it. */}
          {detail && (detail.group || detail.equipment) ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: sp.sm, rowGap: 2, marginTop: 6 }}>
              {detail.group ? <TonedChip tone={groupTone(detail.group)} label={cap(detail.group)} /> : null}
              {detail.equipment ? <Text style={{ ...ty.caption, color: t.ink3 }}>{cap(detail.equipment)}</Text> : null}
            </View>
          ) : null}
          {display?.note ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{display.note}</Text>
          ) : null}
        </View>

        {/* ── the demonstration ─────────────────────────────────────────── */}
        {status === 'loading' ? (
          <View style={{ paddingVertical: sp.xl, alignItems: 'center' }}>
            <ActivityIndicator />
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>Looking this movement up…</Text>
          </View>
        ) : status === 'error' ? (
          <Notice tone={t.warn} kicker="Exercise" title="This Could Not Be Read"
            note="Nothing below is missing because it does not exist. We could not reach the catalogue. Try again once you have signal." />
        ) : clip ? (
          <View style={hero}><View style={heroClip}><ExerciseVideo video={clip} exerciseName={detail?.name || name} /></View></View>
        ) : animUrl ? (
          <>
            <View style={hero}><View style={heroClip}>
            <DemoAnimation uri={animUrl} label={detail?.name || name}
              // The stills, so the box is never empty while 1.6 MB of clip is on
              // its way, and so a clip that never arrives lands on the picture we
              // already had rather than on a hole.
              stillUrls={frames} cacheKey={animCacheKey ?? undefined} />
            </View></View>
            {detail?.demoLicence !== 'commercial' ? (
              <View style={{ marginTop: sp.sm }}>
                <Flag tone={t.warn}>Evaluation asset: licensed for review only, never for release.</Flag>
              </View>
            ) : null}
          </>
        ) : frames.length ? (
          <>
            <View style={hero}><View style={heroClip}><FrameLoop urls={frames} label={detail?.name || name} /></View></View>
            {caption ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{caption}</Text> : null}
            {/* Beside the artwork, not two screens away. The licence asks for
                one visible credit and the Credits card on Profile is it; this
                costs a line and is worth more where somebody is looking. */}
            {detail?.source === 'repdb' ? <RepdbInlineCredit /> : null}
          </>
        ) : (
          // No clip, no animation and no frames. Said plainly, with the action
          // that actually changes it — this reader is the person who can film
          // one — rather than a grey silhouette implying a demonstration we do
          // not have.
          <Notice tone={detail && !clipsKnown ? t.warn : t.ink3} kicker="Demonstration"
            title={detail
              ? clipsKnown ? 'No Demonstration Yet' : 'Your Clips Could Not Be Read'
              : signedOut ? 'Sign In to See This' : 'Not in the Catalogue'}
            note={detail
              // "Nobody has filmed this" is a statement about the whole clip
              // library, and under 'error' or 'partial' the library is not what
              // we hold. The catalogue half of the sentence is still true and
              // still said — it came off `detail`, which was read — but the
              // half about the coach's own filming is withheld rather than
              // guessed at, and the Record button below is not offered as the
              // fix for a problem that may not exist.
              ? clipsKnown
                ? 'Nobody has filmed this movement and the catalogue has no illustration for it, so your client sees its name, its muscles and the written steps. Record a clip from Videos and it appears here for them.'
                : vidStatus === 'error'
                  ? 'The catalogue has no illustration for this movement, and your clip library could not be read, so whether you or your gym have already filmed it is unknown rather than no. Try again, and record one only if there is nothing there.'
                  : vidStatus === 'partial'
                    ? 'The catalogue has no illustration for this movement, and only part of your clip library came back, so a clip of this may be on the other side of that limit. Nothing here says you have not filmed it.'
                    : 'The catalogue has no illustration for this movement. Your clip library is still being read, so whether one of yours covers it is not known yet.'
              // See the matching note on the client screen. Saying "no
              // catalogue entry" while signed out told a coach exploring the
              // demo that Back Squat is not in a catalogue that contains it.
              : signedOut
                ? 'The exercise catalogue is only available once you are signed in, so this screen could not look this movement up. Sign in and its illustration, muscles and steps appear here.'
                : 'This movement has no catalogue entry, so there is no illustration, description or muscle data for it. You can still put it in a program. Your client sees the name you typed and whatever you write in the note.'} />
        )}

        {/* Directly under the thing it is about. Gated on the catalogue read
            having landed for the same reason the media above is: under 'error'
            none of those branches ran, so "your client sees your own clip" would
            describe a screen nobody is looking at. Null on the ordinary case —
            one demonstration, and it is the one playing — so this is silent on
            most movements and worth reading when it is not.

            The condition is deliberately the one the media block above is drawn
            under, character for character, so the caption and the thing it
            describes appear and disappear together. `isWhole` here would leave
            a picture on screen with nothing saying which of four it is. Every
            claim in the caption that depends on having read the whole clip
            library is gated where it is built, on `isWhole(vidStatus)`. */}
        {/* "What your client sees" was the eyebrow over the title. It is the
            caption under the picture now — the picture is the thing the
            sentence is about — and shares the line with the source note when
            there is one. Under 'error' no picture was drawn, so it is not
            said. */}
        {/*
          * whole-ok: `status` here is useExerciseDetail's, and that provider
          * fetches ONE ROW by name. There is no page to truncate, so 'partial'
          * is not among the answers it can give — and were it ever made
          * pageable, this caption would still have to appear under exactly the
          * conditions the picture it describes appears under.
          */}
        {status !== 'loading' && status !== 'error' ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            {sourceNote ? `What your client sees. ${sourceNote}` : 'What your client sees.'}
          </Text>
        ) : null}

        {FRAMES_ARE_UNHOSTED && frames.length ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.warn}>Illustrations are served from the source dataset, not for release.</Flag>
          </View>
        ) : null}

        {detail ? (
          <>
            {/* ── Instructions, directly under the picture ─────────────────
                Board page 5 puts the steps straight after the demonstration,
                under that word. They sat fourth, after the description, the
                chips and the muscles, which is the order a catalogue lists
                things in and not the order somebody about to coach a lift
                reads them in. Same steps, same count, same sentence for a row
                that has none. */}
            {detail.instructions.length ? (
              <>
                <Section>
                  <SectionHead title="Instructions" note={`${detail.instructions.length} Steps`} />
                  {detail.instructions.map((step, n) => (
                    <View key={n} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
                      {/* The mockups' numbered plate: a Sora numeral on the
                          accent's soft plate. A grey "1" at label size beside
                          a paragraph was a list with its numbers missing. */}
                      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ ...ty.label, ...font('700', 'display'), color: t.brandText }}>{n + 1}</Text>
                      </View>
                      <Text style={{ ...ty.body, color: t.ink2, flex: 1, paddingTop: 3 }}>{step}</Text>
                    </View>
                  ))}
                </Section>
              </>
            ) : status === 'ready' ? (
              <>
                <Section>
                  <SectionHead title="Instructions" />
                  {/* Some rows carry no instructions because nobody has
                      confirmed which catalogue movement they are. Saying so is
                      the point — an empty section would read as an app that
                      forgot to render, not as a gap we know about. Gated on the
                      read having finished, so a row still arriving is never
                      described as having no steps. */}
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    No written steps for this one yet. Your client sees no instructions, so put the cue in the program note.
                  </Text>
                </Section>
              </>
            ) : null}

            {/* ── what it is ───────────────────────────────────────────── */}
            {/* The field the RepDB catalogue was adopted for: it says what a
                movement IS, where `instructions` say how to perform it, and a
                coach deciding whether to assign it is asking the first
                question. Rows imported before RepDB carry no description and
                show nothing here — never a filler sentence, because an invented
                description is an invented fact about somebody's training. */}
            {detail.description ? (
              <>
                <Section>
                  <Text style={{ ...ty.body, color: t.ink }}>{detail.description}</Text>
                </Section>
              </>
            ) : null}

            <Section>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {detail.group ? <TonedChip tone={groupTone(detail.group)} label={detail.group} /> : null}
                {chips.map((c) => <TonedChip key={c} tone="neutral" label={c} />)}
              </View>
              {/* A coach programming for somebody training at home needs to know
                  what the lift is performed on. An absent equipment column is a
                  gap in the catalogue and says so — it is not a claim that the
                  exercise needs no kit, which is the reading that puts a cable
                  fly in a bodyweight program. */}
              {!detail.equipment ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  The catalogue does not record what this one is performed on.
                </Text>
              ) : null}
            </Section>

            {/* ── the muscles, on the body ─────────────────────────────────
                The same figure the client's screen draws, so a coach previewing
                what their client sees is looking at the picture the client
                gets. The words are under it, not replaced by it — see
                src/ui/ExerciseMuscles.tsx on why the body is a two-band picture
                with its own key. Gated on the catalogue naming something: a row
                that names no muscles is a gap, not a movement that works
                nothing. */}
            {detail.primaryMuscles.length || detail.secondaryMuscles.length ? (
              <>
                <Section>
                  <SectionHead title="Muscles Worked" />
                  <ExerciseMuscles primary={detail.primaryMuscles} secondary={detail.secondaryMuscles} status={status} />
                </Section>
              </>
            ) : null}

          </>
        ) : null}

        {/* ── Tips, which this screen was rendering nowhere ──────────────────
            The catalogue carries them — counted against the live table on 13 Sep
            2026, 604 of 615 rows have at least one —
            and the client's own exercise screen has shown them all along. A
            coach opening the same movement got the description and the steps
            and then nothing, so the cues they might pass on in a session were
            visible to everybody except the person doing the coaching. */}
        {detail && detail.tips.length ? (
          <>
            <Section>
              <SectionHead title="Tips" note={`${detail.tips.length}`} />
              {detail.tips.map((tip, n) => (
                <View key={n} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.sm }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand, marginTop: 9 }} />
                  <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{tip}</Text>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        {/* What the movement is for and how it is filed — the same block the
            client screen ends on, and useful to a coach deciding whether it
            belongs in somebody's week. */}
        {detail && (detail.goals.length || detail.tags.length) ? (
          <>
            <Section>
              {detail.goals.length ? (
                <>
                  <SectionHead title="Good For" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: detail.tags.length ? sp.lg : 0 }}>
                    {detail.goals.map((g) => (
                      <View key={g} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ ...ty.caption, color: t.ink2 }}>{g}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
              {detail.tags.length ? (
                <>
                  <SectionHead title="Filed Under" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {detail.tags.map((g) => (
                      <View key={g} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ ...ty.caption, color: t.ink2 }}>{g}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
            </Section>
          </>
        ) : null}

        {/* ── who on the book is stalled on this one ──────────────────────
            Asked on a tap, because it is one aggregate over the whole roster
            and a coach who came to look at the picture has not asked it. Only
            once the catalogue read has landed: the question is about a named
            movement, and a name the catalogue could not find is one the
            aggregate matches by free text — still a fair question, so `detail`
            is not required, only that the screen has stopped loading. */}
        {status !== 'loading' ? (
          <>
            <Section>
              <SectionHead title="Across Your Roster" />
              <View style={{ flexDirection: 'row' }}>
                <Ghost
                  label={askedRoster ? 'Hide Your Roster' : 'Show Your Roster'}
                  a11yLabel={`Show every client on your book against ${display?.name.text || detail?.name || name}`}
                  onPress={() => { void askRoster(); }} />
              </View>

              {askedRoster ? (
                <View style={{ marginTop: sp.lg }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {/* The sentence names the movement, so it names it the way
                        this page does — `name` is still what the ask is keyed
                        on above. */}
                    {rosterExerciseLine(rosterAsk, rosterStatus, rosterJudged, display?.name.text || detail?.name || name)}
                  </Text>
                  {/* The judgement is named and so is its evidence. "Stalled"
                      means one thing — logged in both halves of the window and
                      no heavier in the second — and a coach who disagrees can
                      point at the row rather than at a verdict. */}
                  {/* ── the book against this movement, as one ring ──────────
                      Only when BOTH reads are whole — the aggregate and the
                      book it is judged against. Under anything less the
                      sentence above says why and there is no ring: a share of
                      a book that did not load is a share of nothing anybody
                      can name. The legend carries every count in words, and
                      green, amber and red mean here what they mean on every
                      other screen: fine, slipping, needs you. */}
                  {isWhole(rosterAsk) && isWhole(rosterStatus) && rosterJudged.length ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg, marginTop: sp.lg }}>
                      <Donut centre={num(rosterJudged.length)} sub={rosterJudged.length === 1 ? 'client' : 'clients'}
                        slices={rosterBands.map((b) => ({ label: LEVEL_TITLE[b.level], value: b.rows.length, tone: LEVEL_TONE[b.level], shown: num(b.rows.length) }))}
                        spoken={`${num(rosterJudged.length)} on your book. ${rosterBands.map((b) => `${LEVEL_TITLE[b.level]}, ${num(b.rows.length)}`).join('. ')}.`} />
                      <Legend items={rosterBands.map((b) => ({ label: LEVEL_TITLE[b.level], value: b.rows.length, tone: LEVEL_TONE[b.level], shown: num(b.rows.length) }))} />
                    </View>
                  ) : null}
                  {/* The judgement is defined in one line where it was three:
                      what is compared, and the one thing it cannot see. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                    {`Heaviest set, recent half of ${ROSTER_WINDOW_DAYS} days against the earlier half. Reps added at the same weight do not show.`}
                  </Text>
                  {rosterAsk === 'error' ? (
                    <View style={{ marginTop: sp.md }}>
                      <Flag tone={t.warn}>
                        Nothing below is a statement about your clients. Hand-added clients have no account for
                        workouts to belong to, and they read the same way from here.
                      </Flag>
                    </View>
                  ) : null}
                  {rosterAsk === 'ready' ? rosterBands.map((band) => (
                    <View key={band.level} style={{ marginTop: sp.md }}>
                      <TonedChip tone={LEVEL_TONE[band.level]} label={LEVEL_TITLE[band.level]} />
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {`${band.rows.length === 1 ? 'This client ' : 'These clients '}${LEVEL_NOTE[band.level]}.`}
                      </Text>
                      {band.rows.map((c) => {
                        // Printed in the COACH's unit, which is the one this
                        // app is certain of on this device. Unlike the
                        // client-training screen — a transcript of one
                        // person's session, printed in theirs — this is a
                        // list of forty people and forty units would be
                        // unreadable.
                        const top = c.topKg == null ? null : liftIn(c.topKg, coachUnit);
                        // Through `deltaLabel`, never a sign written here:
                        // scripts/check-deltas.mjs exists because twenty-five
                        // screens each wrote their own and a change of nothing
                        // took whichever arm its author reached for first.
                        // `since: null` because the window is stated once
                        // above the whole list rather than repeated on forty
                        // rows.
                        const d = c.changePct == null ? null
                          : deltaLabel(c.changePct, { since: null, unit: '%', noChange: 'no change' });
                        return (
                          <View key={c.clientId} style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm, marginTop: 4 }}>
                            <Text style={{ ...ty.label, color: t.ink, flex: 1 }}>{clientName(c.clientId)}</Text>
                            <Text style={{ ...ty.caption, color: t.ink3 }}>
                              {top == null ? 'no load recorded' : `${num(top)} ${coachUnit}`}
                            </Text>
                            {d ? <Text style={{ ...ty.caption, color: t.ink3 }}>{d}</Text> : null}
                          </View>
                        );
                      })}
                    </View>
                  )) : null}
                  {rosterAsk === 'ready' && rosterJudged.some((c) => c.e1rmKg != null) ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                      Any one-rep max behind these is an estimate off logged sets. Nobody has tested one.
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Section>
          </>
        ) : null}

        <Section>
          {/* "Record a clip for this movement" is the same negative in
              imperative form — it tells the coach there is nothing there. With
              the library unread it is the library's own screen they want, not a
              camera, so the button says so instead of sending them to film a
              second copy of something they may already have.

              ── and it now carries the movement with it ───────────────────
              The button said "Record a clip for this movement" and then pushed
              a bare route. The coach arrived at a screen that did not know which
              movement, filmed, and was handed an empty "Name This Clip" box —
              so the name was retyped from memory, and a clip is matched to a
              catalogue row by the slug of that name (src/lib/exerciseId.ts,
              exact equality, no fuzzy fallback). "Bent Over Row" for
              "Bent-Over Row" is a clip that resolves to nothing: it sits in the
              library looking filmed, and the client it was filmed for never
              sees it. The name is passed instead, verbatim as the catalogue
              spells it, so the slug cannot be a near miss.

              `name` and not `display.name.text`: the identity is the English
              catalogue name everywhere in this app, and the translated label is
              only ever what a row says out loud.

              Carried whenever this coach has no clip of their OWN that reached
              the server — `sources.mine`, not `clip`. A clip saved on this
              phone plays here and reaches nobody, and an Academy clip is
              somebody else's; in both cases filming their own is still the
              thing they came to do. It is an OFFER and not a claim: the Videos
              screen checks for itself whether the movement is already covered
              and drops the prompt when it is. */}
          <Ghost label={clip || !clipsKnown ? 'Your Clip Library' : 'Record a Clip for This Movement'} icon="video"
            onPress={() => {
              if (clipsKnown && sources.mine === 0) {
                router.push({
                  pathname: '/(trainer)/videos',
                  params: { record: detail?.name || name, group: detail?.group || '' },
                });
                return;
              }
              router.push('/(trainer)/videos');
            }} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
