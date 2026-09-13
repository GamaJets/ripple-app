// Coach · Exercise Library — what you can programme, and whether you have filmed it.
//
// The catalogue was reachable from exactly one place in the coach app: the
// "Add Exercise" sheet inside the Program Builder. So a coach could only look
// a movement up while mid-build, from a modal, with a half-written programme
// underneath it. Wanting to check what a cable pullover looks like, or what
// the client will actually see when they tap a row, meant starting a programme
// you did not want in order to open a picker you did not want to use.
//
// ── Why this is not the owner's library with a different header ────────────
//
// An owner reads this list to answer "does this assume kit we do not own", so
// equipment leads their row and is their filter. A client reads it to answer
// "how do I do this". Neither is the coach's question, which is:
//
//     what can I put in a programme, and have I filmed it?
//
// Both halves matter and only the first one existed anywhere. A coach's clip
// is the thing their client sees under load; the catalogue's own artwork is
// the fallback. So every row says which of the two a client would get, and the
// filters are muscle groups, because that is the axis a coach builds a split
// on — push day, pull day, legs.
//
// ── Why the clip column is four-valued and sometimes silent ────────────────
//
// "You have not filmed this" is a claim, and it is only true if we managed to
// read the clip library. `useExerciseVideos` reports 'error' when it could not
// and 'partial' when it read a prefix of the list, and under either of those a
// row with no match may simply be a row whose clip we did not see. A coach who
// re-films forty movements they already had is a coach this screen lied to.
//
// So a POSITIVE match is safe under any status — we found the clip, it exists.
// A negative is only stated under 'ready'. Otherwise the column says nothing
// at all and a notice above the list explains why it is blank.
//
// The fourth value is 'local', and it was missing rather than deliberate.
// `useExerciseVideos` returns `[...remote, ...added]`; an `added` row is a clip
// the coach saved when the insert was refused, minted with `trainerId: null` —
// the same shape a platform clip has. Classifying on that field alone therefore
// reported every offline save as an Academy clip, so a movement whose only
// demonstration is on the coach's own handset was drawn as one their client is
// already watching, and counted into the Academy figure. `clipOwner` reads the
// id prefix, which is the only thing that tells the two apart.
//
// ── Why matching is exact ──────────────────────────────────────────────────
//
// The old video library matched clips to exercises with a bidirectional
// substring test (`vn.includes(n) || n.includes(vn)`), which is why "Squat"
// resolved to whichever of Back Squat, Front Squat and Goblet Squat sorted
// first, and why "Row" could return a rowing machine. The whole of
// src/lib/exerciseId.ts exists to replace it: one slug rule, exact equality,
// no fuzzy fallback. Here a near-miss would tell a coach they have filmed a
// movement they have not — so the slug set below is tested with Set.has and
// never with a scan for containment.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useBackFromHub } from '../../src/ui/backTo';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, Notice, Ghost, PartialRead, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useExerciseCatalogue, type CatalogueRow } from '../../src/ui/exerciseDetail';
import { useCatalogueThumbs } from '../../src/ui/useCatalogueThumbs';
import { matchesSearch, matchedSynonym, fallbackTag } from '../../src/lib/catalogueLocale';
import { ExerciseThumb } from '../../src/ui/ExerciseDemo';
import { useExerciseVideos } from '../../src/ui/exerciseVideos';
import { useAuth } from '../../src/ui/auth';
import { exerciseSlug } from '../../src/lib/exerciseId';
import { clipOwner } from '../../src/lib/clipOwner';
import { catalogueValue as cap, num } from '../../src/lib/format';
// ── the question that gets BETTER as a coach gets busier ───────────────────
//
// One client's history of one movement has been readable since
// src/lib/exerciseHistory.ts landed, and app/(trainer)/exercise.tsx draws it.
// "Who is stalled on bench across my roster" was answerable only by opening
// forty screens, so nobody did — which meant the one coaching insight that
// scales with the size of a book was the one the app withheld from a busy
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
// ── programming for the floor the client is actually standing on ───────────
//
// A coach writing a week for somebody in a hotel gym, or in a garage with a
// barbell and nothing else, was choosing from six hundred movements with no way
// to exclude the ones that assume a cable stack. The column has been on the row
// all along — the owner's library has filtered on it since it shipped — and the
// coach, who is the person actually writing the programme, could not.
//
// The rule lives in src/lib/equipmentFacet.ts rather than here because it is
// the SAME rule that screen uses, and a second hand-written case-insensitive
// compare is how two screens come to disagree about what "barbell" matches.
// Its header carries the live count that shapes it: 190 of 615 rows record no
// equipment at all, which is why a null is a chip of its own and why a lit kit
// chip has to say how many rows it could not place.
import {
  ALL_KIT, UNRECORDED_KIT, equipmentChips, matchesEquipment, unplacedByEquipment, equipmentGapNote,
} from '../../src/lib/equipmentFacet';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { isStarterId } from '../../src/lib/templateLibrary';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { BACK_ICON, FORWARD_ICON } from '../../src/ui/direction';


const ALL = 'All';

/** Distinct muscle groups in the spelling the catalogue uses, matched
 *  case-insensitively. `muscle_group` is free text on the row, so 'Back' and
 *  'back' are one split and must not become two chips. */
function muscleGroups(rows: CatalogueRow[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const v = (r.group || '').trim();
    if (!v) continue;
    if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), cap(v));
  }
  return [ALL, ...[...seen.values()].sort((a, b) => a.localeCompare(b))];
}

const inGroup = (field: string | null, chip: string) =>
  chip === ALL || (field || '').trim().toLowerCase() === chip.toLowerCase();

/** What the row says the movement is performed on.
 *
 *  Says so even when the answer is "we do not know", and always, rather than
 *  leaving the slot blank on the 190 rows that hold no equipment. A blank there
 *  reads as "needs nothing", which is how a cable fly ends up in a programme
 *  written for somebody with a pair of dumbbells and a doorway. The same
 *  sentence app/(owner)/library.tsx puts on its rows, word for word, because a
 *  coach and an owner looking at the same movement must not be told two
 *  different things about it. */
const kitLabel = (r: CatalogueRow) => (r.equipment ? cap(r.equipment) : 'Equipment not recorded');

function Chips({ options, value, onChange, a11y }: {
  options: string[]; value: string; onChange: (v: string) => void;
  /** What a screen reader says the chip will DO. Passed in because this row is
   *  now drawn twice over two different columns, and "Show Cable only" read
   *  out as a muscle group is worse than no label — the two rows look the same
   *  and only the spoken name tells them apart. */
  a11y: (v: string) => string;
}) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingVertical: sp.xs }}>
      {options.map((o) => {
        const on = value.toLowerCase() === o.toLowerCase();
        return (
          <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="button"
            accessibilityLabel={a11y(o)}
            accessibilityState={{ selected: on }}
            style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
            <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{o}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** What a client would actually be shown for this movement. `null` is the
 *  case that matters most: we do not know, and must not guess.
 *
 *  'local' is the one that was missing. `useExerciseVideos` hands back
 *  `[...remote, ...added]`, and an `added` row is a clip the coach saved when
 *  the insert was refused — minted with `trainerId: null`, which is character
 *  for character the shape of a platform clip. So every offline save was
 *  reported here as "Academy clip": a movement whose only demonstration sits on
 *  the coach's own handset was drawn as one their client is already watching,
 *  and counted into the Academy figure above. The id prefix is what tells them
 *  apart, and src/lib/clipOwner.ts is where that is written down. */
type Clip = 'mine' | 'academy' | 'local' | 'none' | null;

const PAGE = 50;

export default function TrainerLibrary() {
  const t = useTheme();
  const router = useRouter();
  const goBack = useBackFromHub('(trainer)');
  const { rows, status, reload } = useExerciseCatalogue();
  const { videos, status: vidStatus, reload: reloadVideos } = useExerciseVideos();
  const auth = useAuth();
  const coachId = auth.user?.id ?? null;

  const [q, setQ] = useState('');
  const [group, setGroup] = useState(ALL);
  // The kit chip. `ALL_KIT` and `ALL` are the same string, and deliberately so
  // — this state is compared by matchesEquipment(), which owns the meaning of
  // every chip value including that one, so it is spelled the way that module
  // spells it rather than reusing this file's constant and hoping they agree.
  const [kit, setKit] = useState(ALL_KIT);
  // Paged. Six hundred rows mounted at once is a visibly janky scroll on an
  // older phone, and nobody reads past the first screenful.
  const [shown, setShown] = useState(PAGE);

  /* ── one movement, across the whole book ────────────────────────────────
     Asked on demand rather than for every row of the catalogue: this is one
     aggregate per movement, and running it for four hundred exercises the
     moment the screen opens would be four hundred round trips in service of a
     question the coach has not asked. So the row carries a control and the
     answer opens under it.

     `rosterStatus` and the aggregate's own status are held separately and
     BOTH gate every figure — a coach told "3 of 40 are stalled" off a roster
     that came back short is acting on a denominator that is not their book. */
  const { roster, status: rosterStatus, refresh: refreshRoster } = useRoster();
  // Three reads: the movement catalogue, the clips attached to it, and the
  // roster the per-client grant lines are written from. The clip column is a
  // statement ABOUT a catalogue row, so refreshing one without the other
  // could say "no clip of yours" against a row read at a different moment.
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([reload(), reloadVideos(), refreshRoster()]),
    [reload, reloadVideos, refreshRoster],
  ));
  const coachUnit = useSettings().weightUnit;
  const [askedFor, setAskedFor] = useState<string | null>(null);
  const [rosterRows, setRosterRows] = useState<RosterExerciseRow[] | null>(null);
  const [rosterAsk, setRosterAsk] = useState<LoadStatus>('ready');
  // The movement whose answer is allowed to reach the screen. Tapping through
  // several movements starts a read per tap and they do not come back in order,
  // so without this a slow answer for the squat lands under the heading for the
  // bench press — one movement's roster attributed to another. The same guard
  // client-training.tsx and client-body.tsx use.
  const wantedMovement = useRef<string | null>(null);

  const askRoster = async (name: string) => {
    if (askedFor === name) { setAskedFor(null); return; }
    setAskedFor(name);
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

  const groups = useMemo(() => muscleGroups(rows), [rows]);
  // Derived from the WHOLE catalogue, not from the rows the search and the
  // group chip have already selected: chips that reshuffled as you typed would
  // move the kit you were reaching for out from under your thumb, and a kit
  // that disappeared because of the search could not be used to widen it again.
  const kits = useMemo(() => equipmentChips(rows.map((r) => r.equipment)), [rows]);

  // A chip can vanish underneath the selection — a reload that comes back
  // without the row the chip was derived from. Left alone the screen would
  // show an empty list under a chip it is no longer drawing.
  useEffect(() => {
    if (!groups.some((g) => g.toLowerCase() === group.toLowerCase())) setGroup(ALL);
  }, [groups, group]);
  useEffect(() => {
    // Only once rows have actually landed. While the catalogue is in flight or
    // failed, `kits` is just [All] and clearing on that would wipe the coach's
    // filter every time they pulled to refresh.
    if (!rows.length) return;
    if (!kits.some((k) => k.toLowerCase() === kit.toLowerCase())) setKit(ALL_KIT);
  }, [kits, kit, rows.length]);

  // The two slug sets the clip column is read from. Built with the same rule
  // the player uses (exerciseId.ts) so what this screen promises and what the
  // client is actually served cannot disagree. `exerciseId` when the clip
  // reached the server, the slugged name as the bridge for rows written before
  // there was an exercise_id to write.
  const { mine, academy, local } = useMemo(() => {
    const m = new Set<string>();
    const a = new Set<string>();
    const l = new Set<string>();
    for (const v of videos) {
      const slug = v.exerciseId || exerciseSlug(v.name);
      if (!slug) continue;
      // `clipOwner` and not a `trainerId == null` test written here. That test
      // reads a clip saved on this phone — no row, so `trainerId: null` — as a
      // platform clip, and the two have opposite meanings for a client: one is
      // a demonstration everybody gets, the other is a demonstration nobody
      // outside this handset can reach.
      switch (clipOwner(v, coachId)) {
        case 'mine': m.add(slug); break;
        // Belongs to no coach: the platform clip every client falls back to.
        case 'platform': a.add(slug); break;
        case 'local': l.add(slug); break;
        // Another coach's, visible because their gym shares it. Not served to
        // THIS coach's clients, so it is not cover on this screen.
        case 'other': break;
      }
    }
    return { mine: m, academy: a, local: l };
  }, [videos, coachId]);

  /* ── the forty movements a coach actually uses ──────────────────────────
   *
   * Six hundred rows, two facets, and neither of them is the cut every other
   * coaching product of this kind offers: the coach's OWN working set. TrueCoach
   * and Trainerize both put "my exercises" / recently used in front of the
   * catalogue, because a coach writes the same thirty or forty movements over
   * and over and the other five hundred and seventy are noise they scroll past
   * on the way.
   *
   * Built from what the coach has already written rather than from a starred
   * list they would have to maintain — the same argument src/lib/segments.ts
   * makes about a computed segment against a tag, and it costs no new table,
   * no new column and no new read: `useProgramTemplates` is mounted at the root
   * layout and app/(trainer)/videos.tsx already counts across exactly these
   * rows for its coverage figure.
   *
   * NULL under anything but a whole read, for the reason that screen states at
   * length: the provider seeds three built-in starter programmes, so the list is
   * never empty and a coach who has saved nothing would be shown the movements
   * of three demonstrations as their own work — and `readLibrary` answers
   * 'partial' at the row ceiling, under which this set is a PREFIX and the
   * filter would hide movements the coach does programme. Null means the control
   * is not offered at all.
   */
  const { templates, status: tplStatus } = useProgramTemplates();
  const programmed = useMemo(() => {
    if (!isWhole(tplStatus)) return null;
    const s = new Set<string>();
    for (const tpl of templates) {
      if (isStarterId(tpl.id)) continue;
      for (const d of tpl.program.days) {
        for (const e of d.exercises) {
          const slug = exerciseSlug(e.name);
          if (slug) s.add(slug);
        }
      }
    }
    return s;
  }, [tplStatus, templates]);
  const [mineOnly, setMineOnly] = useState(false);
  /** How many rows of the catalogue the coach's own programmes name. Only a
   *  count under a whole catalogue read, like every other figure here. */
  const programmedHere = useMemo(
    () => (programmed == null ? 0 : rows.filter((r) => programmed.has(exerciseSlug(r.name))).length),
    [programmed, rows],
  );
  const canScopeToMine = programmed != null && programmedHere > 0;
  // The control can vanish underneath the selection — a refresh whose template
  // read comes back short, or a coach who has just deleted their last
  // programme. Left alone the filter would keep excluding rows with nothing on
  // screen saying it was on, which is the shorter-list-as-a-complete-one shape
  // the kit gap note exists for.
  useEffect(() => { if (!canScopeToMine && mineOnly) setMineOnly(false); }, [canScopeToMine, mineOnly]);

  // Signed in one request rather than one per row — see useCatalogueThumbs.
  const term = q.trim().toLowerCase();
  // The search and the muscle group alone. Held apart from the kit filter so
  // the "could not place these" sentence is counted over the same rows the kit
  // filter is applied to, rather than over the whole catalogue — a coach who
  // has narrowed to Chest and is looking at eleven rows must not be told about
  // 190 unlabelled ones, 180 of which are not on this screen either way.
  const scoped = useMemo(
    // Both names, and the catalogue's synonyms — see matchesSearch() in
    // src/lib/catalogueLocale.ts. A coach who learned the movement in English
    // and a coach reading the German library must find the same row from the
    // same box; so must a coach who has only ever called it "butt kicks", which
    // is what the synonym list is for.
    () => rows.filter((r) => inGroup(r.group, group)
      && matchesSearch(term, r.name, r.display, r.synonyms)
      // The working-set cut. `programmed` is null under anything but a whole
      // read of the coach's template library, and the toggle above cannot be
      // on while it is — see the effect below.
      && (!mineOnly || !!programmed?.has(exerciseSlug(r.name)))),
    [rows, group, term, mineOnly, programmed],
  );
  const list = useMemo(() => scoped.filter((r) => matchesEquipment(r.equipment, kit)), [scoped, kit]);
  // Rows the search and the group DID select and the kit chip could not judge:
  // the catalogue never recorded what they are performed on, so they are absent
  // from the list below and it is not because they failed the test. Said on the
  // screen, because a filter that silently drops a third of the catalogue is a
  // shorter list presented as a complete one.
  const unplacedByKit = unplacedByEquipment(scoped.map((r) => r.equipment), kit);
  const kitGap = equipmentGapNote(unplacedByKit, kit, isWhole(status));
  useEffect(() => { setShown(PAGE); }, [term, group, kit, mineOnly]);
  const page = list.slice(0, shown);
  const thumbFor = useCatalogueThumbs(page);

  // Whether the clip library can be spoken about at all. A negative — "no clip
  // of yours" — is a statement about the whole library, so it needs the whole
  // library. A positive needs only the row we found, so it survives 'partial'.
  const clipsKnown = vidStatus === 'ready';
  // 'private' and a named-grant list still reach a client, so ownership is the
  // only thing being asserted here, never reach.
  const clipFor = (r: CatalogueRow): Clip => {
    const slug = exerciseSlug(r.name);
    if (!slug) return null;
    if (mine.has(slug)) return 'mine';
    if (academy.has(slug)) return 'academy';
    // Last of the three positives, because a clip that reached the server wins
    // over one that did not: a coach with both has clients who can watch it,
    // and the phone copy is not the fact worth putting on the row.
    if (local.has(slug)) return 'local';
    return clipsKnown ? 'none' : null;
  };

  // Signed out, every clip belongs to somebody else as far as this screen can
  // tell, and "you have not filmed this" would be true of every movement in
  // the catalogue
  // for the wrong reason.
  const ownershipKnown = coachId != null;

  // "No clip" was reported from the screenshot as reading like a contradiction,
  // and it was one. Every row already draws a picture — the catalogue's own
  // demonstration still, which nearly every movement has (counted against the
  // live table on 13 Sep 2026: 608 of 615 rows carry stills, and 7 carry
  // neither stills nor an animation) — so a badge saying "No clip" sits
  // directly beside visible proof that there is
  // something to show. The badge was never about that picture: it is about
  // whether a COACH has filmed this movement, which is what the section above
  // it is titled. So it now says that, and stops denying the thumbnail.
  const clipNote = (c: Clip) =>
    c === 'mine' ? 'Your clip'
      : c === 'academy' ? 'Academy clip'
        // Not "Your clip". The coach filmed it and their client cannot watch
        // it, and a row that says only "Your clip" is the screen agreeing with
        // the belief that put it there.
        : c === 'local' ? 'On this phone only'
          : c === 'none' ? 'Not filmed'
            : null;

  // Every figure here is a count over the rows we hold. Under 'partial' those
  // rows are a prefix of the catalogue, so a count would be a subtotal printed
  // as a total. A dash is the honest answer and PartialRead says why.
  const countable = status === 'ready';
  const filmed = rows.filter((r) => mine.has(exerciseSlug(r.name))).length;
  // What a CLIENT would be served — which is what "Not Filmed" is the
  // complement of. A clip saved on this phone is deliberately not in here: it
  // is not cover, because nobody outside this handset can reach it.
  const covered = rows.filter((r) => {
    const slug = exerciseSlug(r.name);
    return mine.has(slug) || academy.has(slug);
  }).length;
  // Counted directly rather than as covered − filmed. A movement can carry
  // both an Academy clip and one of yours, and the subtraction would drop
  // every one of those from the Academy figure.
  const academyFilmed = rows.filter((r) => academy.has(exerciseSlug(r.name))).length;
  // Movements whose ONLY clip never reached the server. Counted apart from all
  // three figures above and said in its own sentence, because it is the one
  // number here that contradicts something the coach believes: they filmed it,
  // it is in their clip library list, and no client has it.
  const strandedOnPhone = rows.filter((r) => {
    const slug = exerciseSlug(r.name);
    return local.has(slug) && !mine.has(slug) && !academy.has(slug);
  }).length;
  // Both clip figures need BOTH reads whole: a catalogue prefix undercounts
  // the movements, and a clip-library prefix undercounts the matches.
  const clipCountable = countable && clipsKnown && ownershipKnown;

  const filtering = term !== '' || group !== ALL || kit !== ALL_KIT || mineOnly;
  const clearFilters = () => { setQ(''); setGroup(ALL); setKit(ALL_KIT); setMineOnly(false); };
  const emptyLine = () => {
    if (!filtering) return 'The catalogue is empty.';
    const bits: string[] = [];
    if (term) bits.push(`“${q.trim()}”`);
    if (group !== ALL) bits.push(group);
    // Named as the state it is, not as the chip's label: "No movement matches
    // Chest · Not recorded" reads as a kit called Not Recorded.
    if (kit !== ALL_KIT) bits.push(kit === UNRECORDED_KIT ? 'no recorded equipment' : kit);
    // Named as the cut it is. "No movement matches Chest · In your programmes"
    // would read as a muscle group somebody had invented.
    if (mineOnly) bits.push('movements you have programmed');
    return `No movement matches ${bits.join(' · ')}.`;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={goBack} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Everything you can put in a programme</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Exercise Library</Text>
          </View>
        </View>

        <Hero
          label="Movements You Can Programme"
          figure={countable ? num(rows.length) : '—'}
          note={
            status === 'loading' ? 'Reading the catalogue…'
              : status === 'error' ? 'The catalogue could not be read, so this is unknown — not zero.'
                : status === 'partial' ? 'More movements than fit in one read. The figure would be a subtotal, so it is not shown.'
                  : rows.length === 0 ? 'The catalogue came back empty.'
                    : 'Every one of them can go into a programme, and your clients see the same list.'
          }
        />

        <Rule />

        <Section>
          <SectionHead title="What You Have Filmed" />
          {/* "Nothing to Show" was wrong, not just blunt. It counted movements
              with no coach clip — and nearly every one of them carries a demonstration
              animation the client can already watch, so there is something to
              show for nearly all of them. Renamed to what it actually counts. */}
          <KpiRow items={[
            { label: 'Your Clips', value: clipCountable ? num(filmed) : '—' },
            { label: 'Academy Clips', value: clipCountable ? num(academyFilmed) : '—' },
            { label: 'Not Filmed', value: clipCountable ? num(rows.length - covered) : '—' },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {clipCountable
              ? 'These count movements a coaching clip reaches, not whether a movement can be demonstrated — nearly every exercise here already shows your client how it is done. Not Filmed means nothing your clients can watch has been recorded for it; record yours on the Videos screen and yours is what they see.'
              : 'These stay blank until both the catalogue and your clip library have been read in full, rather than reporting a figure computed from part of them.'}
          </Text>
          {/* The correction to the line above, and only when there is something
              to correct. A clip that never reached the server counts in none of
              the three figures — it is not yours as far as a client is
              concerned, it is certainly not the Academy's, and calling the
              movement Not Filmed is the screen agreeing with a coach who
              believes they have already done it. */}
          {clipCountable && strandedOnPhone > 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              {strandedOnPhone === 1
                ? '1 of those counted as Not Filmed does have a clip of yours — saved on this phone only, because it never reached the server, so no client can watch it. Add it again from Videos.'
                : `${num(strandedOnPhone)} of those counted as Not Filmed do have clips of yours — saved on this phone only, because they never reached the server, so no client can watch them. Add them again from Videos.`}
            </Text>
          ) : null}
        </Section>

        <Rule />

        {/* ── finding one ────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md }}>
          <Icon name="search" size={16} color={t.ink3} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search exercises…" placeholderTextColor={t.ink3}
            accessibilityLabel="Search exercises"
            style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
          {q ? (
            <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
              <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── the coach's own working set ──────────────────────────────────
            Above the two facets because it is the coarsest cut and the one a
            coach reaches for first: thirty or forty movements they actually
            write, out of six hundred. Offered only when there are some — an
            unread template library, or a coach who has saved no programmes,
            gets no control rather than one that selects nothing.

            The count is on the control, and it is only a count because both
            reads behind it are whole: `programmed` is null under anything but a
            whole template read, and `countable` guards the catalogue half. */}
        {canScopeToMine ? (
          <Pressable onPress={() => setMineOnly((v) => !v)} accessibilityRole="button"
            accessibilityState={{ selected: mineOnly }}
            accessibilityLabel={mineOnly
              ? 'Showing only movements you have programmed. Show the whole catalogue'
              : 'Show only the movements you have programmed'}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.sm, alignSelf: 'flex-start',
              marginTop: sp.md, paddingHorizontal: sp.md, paddingVertical: sp.sm,
              borderRadius: radius.pill, backgroundColor: mineOnly ? t.brand : t.surface2,
            }}>
            <Icon name={mineOnly ? 'check' : 'grid'} size={13} color={mineOnly ? t.brandInk : t.ink3} />
            <Text style={{ ...ty.label, fontWeight: mineOnly ? '600' : '500', color: mineOnly ? t.brandInk : t.ink2 }}>
              {countable ? `In your programmes · ${num(programmedHere)}` : 'In your programmes'}
            </Text>
          </Pressable>
        ) : null}

        {/* Directly under the control, and only while it is on. A coach looking
            at thirty rows has to be able to tell "this is your working set"
            from "the catalogue is small", and the sentence names where the set
            came from so a movement they expected and cannot find has an
            explanation they can act on. */}
        {mineOnly ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Every movement you have written into one of your saved programmes. Built from your own programmes,
            not from a list you keep up to date — the three starters Repple ships with are not counted.
          </Text>
        ) : null}

        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>Muscle group</Text>
        <Chips options={groups} value={group} onChange={setGroup}
          a11y={(g) => (g === ALL ? 'Show every muscle group' : `Show ${g} only`)} />

        {/* Only once there are kits to offer. On an unread catalogue this row
            is [All] alone — a filter with one option, which is not a filter and
            reads as a control that has broken. */}
        {kits.length > 1 ? (
          <>
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>Equipment</Text>
            <Chips options={kits} value={kit} onChange={setKit}
              a11y={(k) => (k === ALL_KIT ? 'Show every kind of equipment'
                : k === UNRECORDED_KIT ? 'Show movements whose equipment the catalogue does not record'
                  : `Show ${k} movements only`)} />
          </>
        ) : null}

        {/* Directly under the control that causes it, not buried by the list.
            A coach who narrows to Dumbbell and reads "142 of 615" has no way to
            know that 190 movements were never tested against that chip because
            nobody recorded what they use. */}
        {kitGap ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{kitGap}</Text>
        ) : null}

        <Section>
          <SectionHead
            title={group === ALL ? 'All Exercises' : group}
            // Only when the read is whole, for the same reason the KPIs are.
            note={countable ? `${num(list.length)} of ${num(rows.length)}` : undefined}
          />

          {/* Why the clip column can be blank. Said once, above the rows, so a
              coach reading a row with nothing in its clip position knows it is
              a gap in what we could read and not a gap in what they filmed. */}
          {status !== 'error' && !clipsKnown ? (
            vidStatus === 'error' ? (
              <Notice tone={t.warn} kicker="Your Clips" title="Your clip library could not be read"
                note="The movements below are real. What is missing is whether you have filmed each one — so that column is blank rather than telling you that you have not.">
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Try Again" a11yLabel="Try reading your clip library again" onPress={() => { reloadVideos(); }} />
                </View>
              </Notice>
            ) : vidStatus === 'partial' ? (
              <Notice tone={t.warn} kicker="Your Clips" title="Only part of your clip library was read"
                note="A movement marked as yours is definitely yours. One marked with nothing may still have a clip we did not reach in this read, so no row claims you have not filmed it.">
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Try Again" a11yLabel="Try reading your clip library again" onPress={() => { reloadVideos(); }} />
                </View>
              </Notice>
            ) : null
          ) : null}

          {/* Signed out, or a session still resolving: every clip's owner is
              unknown, so none can be called yours. */}
          {status !== 'error' && clipsKnown && !ownershipKnown ? (
            <Notice tone={t.warn} kicker="Your Clips" title="We cannot tell which clips are yours"
              note="Nobody is signed in on this device, so the clip column says nothing rather than crediting your own filming to somebody else." />
          ) : null}

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.lg }}>Reading the exercise catalogue…</Text>
          ) : status === 'error' ? (
            // Not "no exercises". The catalogue is there and we could not read
            // it, and a coach shown an empty list would conclude there is
            // nothing to programme.
            <Notice tone={t.warn} kicker="Catalogue" title="The exercise list could not be read"
              note="This is our end, not yours — the movements are still there. Nothing below this line is a statement about what you can programme.">
              <View style={{ marginTop: sp.lg }}>
                <Ghost label="Try Again" onPress={() => { reload(); }} />
              </View>
            </Notice>
          ) : (
            <>
              {status === 'partial' ? <PartialRead what="exercises" shown={rows.length} onPress={reload} /> : null}
              {list.length === 0 ? (
                <View style={{ paddingVertical: sp.lg }}>
                  <Text style={{ ...ty.label, color: t.ink3 }}>{emptyLine()}</Text>
                  {filtering ? (
                    <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                      <Ghost label="Clear Filters" onPress={clearFilters} />
                    </View>
                  ) : null}
                </View>
              ) : (
                <>
                  {page.map((r, i) => {
                    const c = clipFor(r);
                    const note = clipNote(c);
                    // Why this row is in the results when its title does not
                    // say so. Null unless a synonym, and nothing else, matched.
                    const via = matchedSynonym(term, r.name, r.display, r.synonyms);
                    return (
                      <View key={r.id}>
                        {i > 0 ? <Rule /> : null}
                        {/* Not kit.ListRow: that row leads with an icon, and
                            here the picture of the movement is the thing a
                            coach scans by — choosing between Hip Thrust and
                            Barbell Glute Bridge is choosing between two
                            pictures, not two strings. */}
                        <Pressable
                          onPress={() => router.push({ pathname: '/(trainer)/exercise', params: { name: r.name, from: 'trainerLibrary' } })}
                          accessibilityRole="button"
                          accessibilityLabel={[r.display.text, via ? `matched ${via}` : null, r.group ? cap(r.group) : null, kitLabel(r), note].filter(Boolean).join('. ')}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                          <ExerciseThumb uri={thumbFor(r)} t={t} size={44} />
                          <View style={{ flex: 1 }}>
                            {/* `r.name` stays the identity — it is what this
                                row navigates by and what a programme stores.
                                Only the label moves. */}
                            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.display.text}</Text>
                            {/* The kit sits AFTER the muscle group, not before
                                it. The owner's library leads with equipment
                                because "does this assume kit we do not own" is
                                the question that screen is open to answer; a
                                coach builds a split by muscle group and reaches
                                for equipment second. But it has to be on the
                                row at all now that it is a filter: with Dumbbell
                                lit and no kit on the line there is nothing
                                saying WHY these rows and not the others, and a
                                row that says nothing is indistinguishable from
                                one the catalogue never labelled. */}
                            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                              {[r.group ? cap(r.group) : 'Muscle group not recorded', kitLabel(r), fallbackTag(r.display)].filter(Boolean).join(' · ')}
                            </Text>
                            {/* Its own line, and only when the title cannot
                                explain itself: a search for "butt kicks" that
                                answers with Heel Flicks has to say which of the
                                movement's names it matched, or it reads as the
                                search having ignored what was typed. */}
                            {via ? (
                              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Matched “{via}”</Text>
                            ) : null}
                          </View>
                          {note ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              {/* A coloured mark beside ink text, never
                                  coloured text: scale.ts reserves the status
                                  palette for marks because it fails AA as
                                  type on every one of the ten themes. */}
                              <View style={{
                                width: 6, height: 6, borderRadius: 3,
                                backgroundColor: c === 'mine' ? t.brand : c === 'academy' ? t.ink3 : t.warn,
                                // 'local' and 'none' both land on t.warn, and
                                // both are work outstanding — one of them is
                                // work the coach has already done once.
                              }} />
                              <Text style={{ ...ty.caption, color: t.ink2 }}>{note}</Text>
                            </View>
                          ) : null}
                          <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
                        </Pressable>

                        {/* ── who on the book is stalled on this one ────────
                            Asked per movement, on a tap, because it is one
                            aggregate per movement and running it for every row
                            of the catalogue at open would be four hundred round
                            trips for a question nobody asked. */}
                        <View style={{ flexDirection: 'row', marginBottom: sp.md }}>
                          <Ghost
                            label={askedFor === r.name ? 'Hide Your Roster' : 'Across Your Roster'}
                            a11yLabel={`Show every client on your book against ${r.display.text}`}
                            onPress={() => { void askRoster(r.name); }} />
                        </View>

                        {askedFor === r.name ? (
                          <View style={{ marginBottom: sp.lg }}>
                            <Text style={{ ...ty.caption, color: t.ink3 }}>
                              {/* The sentence names the movement, so it names
                                  it the way this row does — `r.name` is still
                                  what the ask is keyed on above. */}
                              {rosterExerciseLine(rosterAsk, rosterStatus, rosterJudged, r.display.text)}
                            </Text>
                            {/* The judgement is named and so is its evidence.
                                "Stalled" means one thing — logged in both halves
                                of the window and no heavier in the second — and
                                a coach who disagrees can point at the row rather
                                than at a verdict. */}
                            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                              Compared over {ROSTER_WINDOW_DAYS} days, split in half: the heaviest set logged
                              in the recent half against the heaviest in the earlier one. It is a claim about the
                              record and nothing else — reps added at the same weight are progress and do not show here.
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
                                <Text style={{ ...ty.micro, color: t.ink3 }}>{LEVEL_TITLE[band.level]}</Text>
                                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                                  {`${band.rows.length === 1 ? 'This client ' : 'These clients '}${LEVEL_NOTE[band.level]}.`}
                                </Text>
                                {band.rows.map((c) => {
                                  // Printed in the COACH's unit, which is the
                                  // one this app is certain of on this device.
                                  // Unlike the client-training screen — a
                                  // transcript of one person's session, printed
                                  // in theirs — this is a list of forty people
                                  // and forty units would be unreadable.
                                  const top = c.topKg == null ? null : liftIn(c.topKg, coachUnit);
                                  // Through `deltaLabel`, never a sign written
                                  // here: scripts/check-deltas.mjs exists
                                  // because twenty-five screens each wrote
                                  // their own and a change of nothing took
                                  // whichever arm its author reached for first.
                                  // `since: null` because the window is stated
                                  // once above the whole list rather than
                                  // repeated on forty rows.
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
                                Any one-rep max behind these figures is an ESTIMATE off logged sets. Nobody in this app
                                has tested one, and the same arithmetic is what a client's own progression screen uses.
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {list.length > shown ? (
                    <View style={{ marginTop: sp.md }}>
                      {/* A count, not a bare "Show more". The number is the
                          point: it says how much is still below. */}
                      <Ghost label={`Show ${num(Math.min(PAGE, list.length - shown))} more of ${num(list.length - shown)}`}
                        onPress={() => setShown((n) => n + PAGE)} />
                    </View>
                  ) : null}
                </>
              )}
            </>
          )}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
