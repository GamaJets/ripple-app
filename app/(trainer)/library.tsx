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
// ── Why the clip column is three-valued and sometimes silent ───────────────
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
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useBackFromHub } from '../../src/ui/backTo';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, Notice, Ghost, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useExerciseCatalogue, type CatalogueRow } from '../../src/ui/exerciseDetail';
import { useCatalogueThumbs } from '../../src/ui/useCatalogueThumbs';
import { ExerciseThumb } from '../../src/ui/ExerciseDemo';
import { useExerciseVideos } from '../../src/ui/exerciseVideos';
import { useAuth } from '../../src/ui/auth';
import { exerciseSlug } from '../../src/lib/exerciseId';
import { catalogueValue as cap, num } from '../../src/lib/format';

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

function Chips({ options, value, onChange }: {
  options: string[]; value: string; onChange: (v: string) => void;
}) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingVertical: sp.xs }}>
      {options.map((o) => {
        const on = value.toLowerCase() === o.toLowerCase();
        return (
          <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="button"
            accessibilityLabel={o === ALL ? 'Show every muscle group' : `Show ${o} only`}
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
 *  fourth case and the important one: we do not know, and must not guess. */
type Clip = 'mine' | 'academy' | 'none' | null;

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
  // Paged. Six hundred rows mounted at once is a visibly janky scroll on an
  // older phone, and nobody reads past the first screenful.
  const [shown, setShown] = useState(PAGE);

  const groups = useMemo(() => muscleGroups(rows), [rows]);

  // A chip can vanish underneath the selection — a reload that comes back
  // without the row the chip was derived from. Left alone the screen would
  // show an empty list under a chip it is no longer drawing.
  useEffect(() => {
    if (!groups.some((g) => g.toLowerCase() === group.toLowerCase())) setGroup(ALL);
  }, [groups, group]);

  // The two slug sets the clip column is read from. Built with the same rule
  // the player uses (exerciseId.ts) so what this screen promises and what the
  // client is actually served cannot disagree. `exerciseId` when the clip
  // reached the server, the slugged name as the bridge for rows written before
  // there was an exercise_id to write.
  const { mine, academy } = useMemo(() => {
    const m = new Set<string>();
    const a = new Set<string>();
    for (const v of videos) {
      const slug = v.exerciseId || exerciseSlug(v.name);
      if (!slug) continue;
      if (coachId && v.trainerId === coachId) m.add(slug);
      // Belongs to no coach: the platform clip every client falls back to.
      else if (v.trainerId == null) a.add(slug);
    }
    return { mine: m, academy: a };
  }, [videos, coachId]);

  // Signed in one request rather than one per row — see useCatalogueThumbs.
  const term = q.trim().toLowerCase();
  const list = useMemo(
    () => rows.filter((r) => inGroup(r.group, group) && (term === '' || r.name.toLowerCase().includes(term))),
    [rows, group, term],
  );
  useEffect(() => { setShown(PAGE); }, [term, group]);
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
    return clipsKnown ? 'none' : null;
  };

  // Signed out, every clip belongs to somebody else as far as this screen can
  // tell, and "you have not filmed this" would be true of all 604 movements
  // for the wrong reason.
  const ownershipKnown = coachId != null;

  // "No clip" was reported from the screenshot as reading like a contradiction,
  // and it was one. Every row already draws a picture — the catalogue's own
  // demonstration still, which 601 of the 604 movements have — so a badge
  // saying "No clip" sits directly beside visible proof that there is
  // something to show. The badge was never about that picture: it is about
  // whether a COACH has filmed this movement, which is what the section above
  // it is titled. So it now says that, and stops denying the thumbnail.
  const clipNote = (c: Clip) =>
    c === 'mine' ? 'Your clip'
      : c === 'academy' ? 'Academy clip'
        : c === 'none' ? 'Not filmed'
          : null;

  // Every figure here is a count over the rows we hold. Under 'partial' those
  // rows are a prefix of the catalogue, so a count would be a subtotal printed
  // as a total. A dash is the honest answer and PartialRead says why.
  const countable = status === 'ready';
  const filmed = rows.filter((r) => mine.has(exerciseSlug(r.name))).length;
  const covered = rows.filter((r) => {
    const slug = exerciseSlug(r.name);
    return mine.has(slug) || academy.has(slug);
  }).length;
  // Counted directly rather than as covered − filmed. A movement can carry
  // both an Academy clip and one of yours, and the subtraction would drop
  // every one of those from the Academy figure.
  const academyFilmed = rows.filter((r) => academy.has(exerciseSlug(r.name))).length;
  // Both clip figures need BOTH reads whole: a catalogue prefix undercounts
  // the movements, and a clip-library prefix undercounts the matches.
  const clipCountable = countable && clipsKnown && ownershipKnown;

  const filtering = term !== '' || group !== ALL;
  const emptyLine = () => {
    if (!filtering) return 'The catalogue is empty.';
    const bits: string[] = [];
    if (term) bits.push(`“${q.trim()}”`);
    if (group !== ALL) bits.push(group);
    return `No movement matches ${bits.join(' · ')}.`;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={goBack} />
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
              with no coach clip — and 601 of the 604 carry a demonstration
              animation the client can already watch, so there is something to
              show for nearly all of them. Renamed to what it actually counts. */}
          <KpiRow items={[
            { label: 'Your Clips', value: clipCountable ? num(filmed) : '—' },
            { label: 'Academy Clips', value: clipCountable ? num(academyFilmed) : '—' },
            { label: 'Not Filmed', value: clipCountable ? num(rows.length - covered) : '—' },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {clipCountable
              ? 'These count coaching clips, not whether a movement can be demonstrated — every exercise here already shows your client how it is done. Not Filmed means neither you nor the Academy has recorded one; record yours on the Videos screen and yours is what they see.'
              : 'These stay blank until both the catalogue and your clip library have been read in full, rather than reporting a figure computed from part of them.'}
          </Text>
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

        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>MUSCLE GROUP</Text>
        <Chips options={groups} value={group} onChange={setGroup} />

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
                      <Ghost label="Clear Filters" onPress={() => { setQ(''); setGroup(ALL); }} />
                    </View>
                  ) : null}
                </View>
              ) : (
                <>
                  {page.map((r, i) => {
                    const c = clipFor(r);
                    const note = clipNote(c);
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
                          accessibilityLabel={[r.name, r.group ? cap(r.group) : null, note].filter(Boolean).join('. ')}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                          <ExerciseThumb uri={thumbFor(r)} t={t} size={44} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.name}</Text>
                            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                              {r.group ? cap(r.group) : 'Muscle group not recorded'}
                            </Text>
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
                              }} />
                              <Text style={{ ...ty.caption, color: t.ink2 }}>{note}</Text>
                            </View>
                          ) : null}
                          <Icon name="chevron" size={16} color={t.ink3} />
                        </Pressable>
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
