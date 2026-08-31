// Client · Exercise library — the how-to clips the client's coach has uploaded.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same provider, same hooks in the same order, same modal.
// No hero: a searchable list has no live number to lead with, so the field sits
// under the title and each clip is a `<ListRow>` instead of its own box.
//
// ── Four answers where there used to be two ─────────────────────────────────
//
// `videos: []` meant both "your coach has not uploaded anything" and "we could
// not reach the server", and this screen asserted the first one in both cases:
// a client whose read had failed was told, in those words, that their coach had
// recorded nothing. `status` from useExerciseVideos separates them, so the
// screen now says which of loading / unreadable / genuinely empty / filtered-to-
// nothing it is actually looking at.
//
// ── The player is a player now ──────────────────────────────────────────────
//
// The 180px box with a play triangle drawn inside it was not a player: tapping
// it called Linking.openURL and the client left the app for the browser mid-
// session. The bucket is private, so the clip plays inline through
// <ExerciseVideo>, which mints the signed URL and reports its own failure. The
// web search survives as the fallback for the case where there genuinely is no
// clip — that one is a real answer, and it is the thing the old copy got right.
//
// ── Tapping an exercise records it now (TF-27) ──────────────────────────────
//
// A list of exercises, and the one thing you could not do to any of them was
// log it. Tapping opened the clip and the footer sent you to Train, where you
// then had to find the same movement again in a plan that may not contain it at
// all — the library holds everything a coach has ever filmed, today's programme
// holds six lifts. So somebody who did an extra set of face pulls after their
// session had nowhere to put it from the screen they were already looking at.
//
// The sheet logs it here instead: reps and weight, added set by set, written
// through <WorkoutLogProvider> like every other entry so it lands in the same
// `workouts` rows the calendar, the streak, records and the coach all read. The
// write resolves true only once the server has it, and the sheet says so when
// it does not, rather than closing on a set that exists on this phone alone.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Linking, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useBackFromHub } from '../../src/ui/backTo';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { ExerciseVideo } from '../../src/ui/ExerciseVideo';
import { useExerciseVideos, type VideoItem } from '../../src/ui/exerciseVideos';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { tapLight, notifySuccess } from '../../src/ui/haptics';
import { Rule, Section, SectionHead, ListRow, Notice, Cta, Ghost, PartialRead, Field } from '../../src/ui/kit';
import { useExerciseCatalogue } from '../../src/ui/exerciseDetail';
import { catalogueValue as cap, num } from '../../src/lib/format';
import { Image as ExpoImage } from 'expo-image';
import { sp, layout, radius, elevation, type as ty, numeric } from '../../src/theme/scale';
import { useSettings } from '../../src/ui/settings';
import { liftLabel, readLift } from '../../src/lib/units';
import { frameUrls } from '../../src/lib/exerciseMedia';
import { signMedia, needsSigning } from '../../src/ui/signedMedia';

export default function Library() {
 // The unit this member reads a LIFTED load in. Chosen if they have chosen,
 // otherwise read off the phone's region and said so in Settings — see
 // src/lib/unitPreference.ts. Never a 'kg' typed after a figure.
 const wu = useSettings().weightUnit;
 const t = useTheme();
 const router = useRouter();
 const goBack = useBackFromHub('(client)');
 const [q, setQ] = useState('');
 const [group, setGroup] = useState('All');
 const { videos, status, reload } = useExerciseVideos();
 // The catalogue, which is a different thing from the clips and was never on
 // this screen. 917 movements exist; nought clips do. A screen called Exercise
 // Library that could only ever show the second was empty for every client on
 // the platform, and said "No clips yet" as though that were the whole story.
 const cat = useExerciseCatalogue();
 // Rendered in pages. 917 <ListRow>s mounted at once is a visibly janky scroll
 // on an older phone, and nobody reads past the first screenful anyway.
 const [catShown, setCatShown] = useState(50);
 const [open, setOpen] = useState<VideoItem | null>(null);
 // Set when the player reports that the clip it was handed cannot be resolved —
 // a share the coach revoked, or a file the signing call could not reach. That
 // is a different sentence from "your coach never recorded one", so the web
 // search is only offered once the player has actually come back empty.
 const [unplayable, setUnplayable] = useState(false);

 // The chips are whatever the library actually holds. The hardcoded six were
 // matched with `v.group === group` against a field the trainer typed by hand,
 // so a clip filed under "legs", "Glutes", or the "Uncategorised" default sat in
 // the list under "All" and under nothing else — invisible to the one control on
 // the screen whose job is finding it.
 //
 // Drawn from the catalogue as well as the clips. Derived from clips alone the
 // row was a single 'All' chip, because there are no clips — so the twelve
 // muscle groups the catalogue is organised by could not be selected at all.
 const groups = useMemo(() => {
  const seen = new Map<string, string>(); // lowercased key → the spelling to show
  for (const v of videos) {
   const g = (v.group || '').trim();
   if (g && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
  }
  for (const e of cat.rows) {
   const g = (e.group || '').trim();
   if (g && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
  }
  return ['All', ...[...seen.values()].sort((a, b) => a.localeCompare(b))];
 }, [videos, cat.rows]);

 // A derived chip can vanish underneath the selection — the coach deletes their
 // only Hamstrings clip while the client is standing on that chip. Left alone,
 // the screen would show an empty list under a chip that is no longer drawn.
 useEffect(() => {
  if (group !== 'All' && !groups.some((g) => g.toLowerCase() === group.toLowerCase())) setGroup('All');
 }, [groups, group]);

 const term = q.trim().toLowerCase();
 const list = videos.filter((v) =>
  (group === 'All' || (v.group || '').trim().toLowerCase() === group.toLowerCase()) &&
  (term === '' || v.name.toLowerCase().includes(term))
 );
 const filtering = term !== '' || group !== 'All';
 // The same search box and the same chips drive both lists, so a client typing
 // 'squat' filters what we can show them AND what they can read about, rather
 // than filtering one and leaving the other showing everything.
 const catList = cat.rows.filter((e) =>
  (group === 'All' || (e.group || '').trim().toLowerCase() === group.toLowerCase()) &&
  (term === '' || e.name.toLowerCase().includes(term))
 );
 useEffect(() => { setCatShown(50); }, [term, group]);

 // Thumbnails for the page on screen, signed in ONE request.
 //
 // The stills are in our own private bucket, so a path is not a URL. Signing
 // each row on its own would be fifty round trips to draw one screen; the
 // cache in signedMedia means paging back and forth after that costs nothing.
 const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
 const visiblePaths = catList.slice(0, catShown).map((e) => e.thumbPath).filter((p): p is string => !!p && needsSigning(p));
 const visibleKey = visiblePaths.join('|');
 useEffect(() => {
  let cancelled = false;
  if (!visiblePaths.length) return;
  (async () => {
   const signed = await signMedia(visiblePaths);
   // Merged rather than replaced: a later page must not blank the rows above
   // it, which is what a scroll back up would then show.
   if (!cancelled) setThumbs((prev) => new Map([...prev, ...signed]));
  })();
  return () => { cancelled = true; };
 }, [visibleKey]);

 // Whose clip it is, in the same words <ExerciseVideoBlock> uses on the workout
 // screen: one clip described two ways on two screens reads as two facts. A null
 // trainerId is a platform clip belonging to no gym; anything else is here
 // because a coach chose to share it with this client.
 const source = (v: VideoItem) => (v.trainerId ? 'Recorded by your coach' : 'From the Repple library');
 // `dur` is not a duration and never was — it holds the literal word "clip" or
 // "link", which is how the client came to be reading "Legs · clip". What they
 // can use is whose demonstration it is and whether there is one to play at all.
 const rowNote = (v: VideoItem) => `${v.group} · ${v.uploaded ? source(v) : 'No clip yet'}`;

 // ── logging what you just did, from the list you are already looking at ──
 const { addWorkout } = useWorkoutLog();
 const [reps, setReps] = useState('');
 const [kg, setKg] = useState('');
 // Sets banked in the sheet but not yet written. Held here rather than sent one
 // row at a time because a `workouts` row IS an exercise with its sets — three
 // separate rows for three sets of the same lift would read as three exercises
 // in the calendar and count triple towards the day.
 const [banked, setBanked] = useState<[number, number][]>([]);
 const [saving, setSaving] = useState(false);
 const addSet = () => {
  const r = parseInt(reps, 10) || 0;
  if (r <= 0) { Alert.alert('How many reps?', 'A set needs a rep count. The weight can be left blank for a bodyweight movement.'); return; }
  // Blank weight is 0 and stays 0 — that is a bodyweight set, which is a real
  // set, and the log already renders a 0 kg set as bodyweight rather than as a
  // missing figure.
  //
  // `readLift` and not `parseFloat`. The box was read as KILOGRAMS whatever the
  // member reads in and was labelled "KG" for everybody, so a member in pounds
  // typed 225 and 225 kilograms — 496 lb — went into their training log, their
  // volume, their estimated 1RM and next session's target. The chip beside the
  // box made it visible and nobody read it that way: it printed the stored
  // kilograms back through `liftLabel`, so 225 typed came straight back as
  // "496 lb". This is the same defect app/(client)/scan-machine.tsx documents
  // having fixed, on the same control, in the same words.
  //
  // It also refuses text that is not a number instead of silently making it a
  // bodyweight set, and states its bound in the unit on screen.
  const load = readLift(kg, wu);
  if (!load.ok) { Alert.alert('Check that load', load.reason); return; }
  setBanked((p) => [...p, [r, load.kg ?? 0]]);
  setReps(''); setKg('');
  tapLight();
 };
 const logIt = async () => {
  if (!open || saving) return;
  // Whatever is still in the fields counts — asking somebody to press "add set"
  // and then "log" for a single set is how a set gets lost between the two.
  // The unread field goes through `readLift` too. A load that only ever reached
  // the log by this path would otherwise have been the one set in the session
  // stored in the wrong unit — the hardest kind of wrong figure to ever notice.
  const trailing = readLift(kg, wu);
  if (!trailing.ok) { Alert.alert('Check that load', trailing.reason); return; }
  const pending = (parseInt(reps, 10) || 0) > 0 ? [...banked, [parseInt(reps, 10), trailing.kg ?? 0] as [number, number]] : banked;
  if (!pending.length) { Alert.alert('Nothing to log', 'Add a set first — reps, and the weight if there was one.'); return; }
  setSaving(true);
  // No `kcal`. Train derives an energy estimate across a whole session's work;
  // one set logged on its own has no session around it to derive from, and the
  // log renders an absent figure as a dash rather than as a zero somebody could
  // read as "this burned nothing".
  const saved = await addWorkout({ t: new Date().toISOString(), exercise: open.name, sets: pending });
  setSaving(false);
  if (!saved) {
   Alert.alert('Not logged', `${open.name} did not reach your training log. It is showing on this phone, but it has not been recorded and will be gone when you next open the app.`);
   return;
  }
  notifySuccess();
  const total = pending.length;
  Alert.alert('Logged', `${num(total)} set${total === 1 ? '' : 's'} of ${open.name} added to today.`);
  setBanked([]); setReps(''); setKg('');
  close();
 };

 const G = layout.gutter;
 const show = (v: VideoItem) => { setUnplayable(false); setBanked([]); setReps(''); setKg(''); setOpen(v); };
 const close = () => { setOpen(null); setUnplayable(false); };
 const searchWeb = () => {
  if (!open) return;
  Linking.openURL('https://www.youtube.com/results?search_query=' + encodeURIComponent(open.name + ' proper form technique')).catch(() => {});
 };

 return (
  <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
   <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
     <Ghost icon="back" onPress={goBack} />
     <View style={{ flex: 1 }}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>How-to clips from your coach</Text>
      <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Exercise Library</Text>
     </View>
    </View>

    {/* ── the field is the screen ────────────────────────────────────── */}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, marginTop: sp.lg }}>
     <Icon name="search" size={16} color={t.ink3} />
     <TextInput value={q} onChangeText={setQ} placeholder="Search exercises…" placeholderTextColor={t.ink3}
      style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
     {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={{ ...ty.head, color: t.ink3 }}>×</Text></Pressable> : null}
    </View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: sp.md }} contentContainerStyle={{ gap: sp.sm, paddingVertical: sp.xs }}>
     {groups.map((g) => {
      const on = group.toLowerCase() === g.toLowerCase();
      return (
       <Pressable key={g} onPress={() => setGroup(g)} accessibilityRole="button" accessibilityLabel={g === 'All' ? 'Show every muscle group' : `Show ${g} only`} accessibilityState={{ selected: on }}
        style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
        <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{g}</Text>
       </Pressable>
      );
     })}
    </ScrollView>

    <Section>
     {/* Named for what it holds — the clips this member's coach has filmed —
         and not "All Exercises", which is the heading of the OTHER section
         sixty lines down. With no clips uploaded anywhere yet, the two put
         "ALL EXERCISES / No clips yet" directly above "ALL EXERCISES · 604 of
         604" and 604 rows: the same heading twice, saying opposite things. A
         reader resolves that by believing the list, and concludes the sentence
         is broken rather than that it is about something else. */}
     <SectionHead title={group === 'All' ? 'Clips from Your Coach' : `${group} Clips`}
      note={status === 'ready' && list.length ? `${list.length} clip${list.length === 1 ? '' : 's'}` : undefined} />
     {status === 'ready' && list.length ? (
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xs }}>Tap one to watch it — and to log the sets you just did.</Text>
     ) : null}

     {/* The read failed, so nothing below this line is a statement about what
         the coach has uploaded. Anything the phone already had is still shown
         underneath — it is real — but the gap is named rather than papered over. */}
     {status === 'error' ? (
      <Notice tone={t.warn} kicker="Library" title="We couldn’t load your clips"
       note="This is our end, not your coach's. Until the library loads we can't tell you what they have uploaded.">
       <View style={{ marginTop: sp.lg }}>
        <Cta label="Try Again" wide onPress={() => { reload(); }} />
       </View>
      </Notice>
     ) : null}

     {status === 'loading' && videos.length === 0 ? (
      <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
       <Icon name="video" size={26} color={t.ink3} />
       <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>Loading your coach's clips…</Text>
      </View>
     ) : list.length === 0 ? (
      // On 'error' the notice above has already said why the list is empty;
      // repeating it here as "no clips yet" would be the old lie again.
      status === 'error' ? null : (
       <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
        <Icon name="video" size={26} color={t.ink3} />
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>
         {videos.length === 0
          ? 'No clips yet — they appear here as your coach uploads them.'
          : term && group !== 'All' ? `No clip in ${group} matches “${q.trim()}”.`
          : term ? `No clip matches “${q.trim()}”.`
          : `No clips filed under ${group}. Every ${group} movement we know is listed further down.`}
        </Text>
        {videos.length > 0 && filtering ? (
         <View style={{ marginTop: sp.md }}>
          <Ghost label="Clear Filters" onPress={() => { setQ(''); setGroup('All'); }} />
         </View>
        ) : null}
       </View>
      )
     ) : list.map((v, i) => (
      <View key={v.id}>
       {i > 0 ? <Rule /> : null}
       <ListRow icon="video" title={v.name} note={rowNote(v)} onPress={() => show(v)} />
      </View>
     ))}
    </Section>

    {/* ── every movement we know, clip or no clip ────────────────────────── */}
    <Rule />
    <Section>
     <SectionHead
      title="All Exercises"
      // 'partial' was opted IN to this figure, and loadStatus.ts is explicit
              // that it must not be: under truncation `cat.rows.length` is exactly
              // the cap, so "50 of 1,000" reads as the size of the catalogue. The
              // PartialRead banner below already says the list is not all of it;
              // this is the figure it was warning about.
              note={cat.status === 'ready' ? `${catList.length} of ${cat.rows.length}` : undefined}
     />
     {cat.status === 'loading' ? (
      <Text style={{ ...ty.label, color: t.ink3 }}>Reading the exercise catalogue…</Text>
     ) : cat.status === 'error' ? (
      // Not "no exercises". We have 917 of them; we could not read them.
      <Notice tone={t.warn} kicker="Catalogue" title="The exercise list could not be read"
       note="This is our end, not yours — the movements are still there. Try again once you have signal." />
     ) : catList.length === 0 ? (
      <Text style={{ ...ty.label, color: t.ink3 }}>
       {filtering ? `No movement matches ${term ? `“${q.trim()}”` : `${group}`}.` : 'The catalogue is empty.'}
      </Text>
     ) : (
      <>
       {cat.status === 'partial' ? <PartialRead what="exercises" shown={cat.rows.length} /> : null}
       {catList.slice(0, catShown).map((e, i) => {
        // The picture of the movement, not a generic glyph. A list of 601 rows
        // reading "Cable Bent-Over Row · Back" over and over is a list nobody
        // scans; the illustration is what makes one row findable among the
        // others. One image per row and never the second — a thumbnail has no
        // use for the peak position.
        // Ours if it is in our bucket, the vendor CDN otherwise — the two
        // catalogues are still mixed while the machine rows have no picture.
        const thumb = e.thumbPath && needsSigning(e.thumbPath)
          ? (thumbs.get(e.thumbPath) ?? null)
          : (frameUrls(e.thumbPath ? [e.thumbPath] : null, e.source)[0] ?? null);
        return (
        <View key={e.id}>
         {i > 0 ? <Rule /> : null}
         <Pressable
          onPress={() => router.push({ pathname: '/(client)/exercise', params: { name: e.name, from: 'clientLibrary' } })}
          accessibilityRole="button"
          accessibilityLabel={e.name}
          style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}
         >
          <View style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: t.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
           {thumb ? (
            <ExpoImage source={{ uri: thumb }} contentFit="contain" cachePolicy="disk"
             style={{ width: '100%', height: '100%' }} />
           ) : (
            // No picture is said with the generic glyph rather than an empty
            // square, which reads as an image that failed to load.
            <Icon name="dumbbell" size={18} color={t.ink3} />
           )}
          </View>
          <View style={{ flex: 1 }}>
           <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{e.name}</Text>
           <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={1}>
            {[e.group, e.equipment ? cap(e.equipment) : null].filter(Boolean).join(' · ')}
           </Text>
          </View>
          <Icon name="chevron" size={15} color={t.ink3} />
         </Pressable>
        </View>
        );
       })}
       {catList.length > catShown ? (
        <View style={{ marginTop: sp.md }}>
         {/* A count, not a bare "Show more". The number is the point: it says
             how much of the catalogue is still below, which is the thing a
             client scrolling a list of names actually wants to know. */}
         <Ghost label={`Show ${Math.min(50, catList.length - catShown)} more of ${catList.length - catShown}`}
          onPress={() => setCatShown((n) => n + 50)} />
        </View>
       ) : null}
      </>
     )}
    </Section>

   </ScrollView>

   {/* ── the clip, playing here rather than in the browser ───────────────── */}
   <Modal visible={!!open} transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={close}
     accessibilityRole="button" accessibilityLabel="Close the clip" />
    <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, maxHeight: '90%', ...elevation.e2 }}>
     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
      <Text style={{ ...ty.title, color: t.ink, flex: 1 }} numberOfLines={1}>{open?.name}</Text>
      <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
       <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Close</Text>
      </Pressable>
     </View>

     {/* Scrolls, because the sheet now carries a player AND a form: on a small
         phone the "Log to today" button was below the fold and unreachable. */}
     <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
     {open && open.uploaded ? (
      <View>
       <ExerciseVideo video={open} exerciseName={open.name} onUnavailable={() => setUnplayable(true)} />
       <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{open.group} · {source(open)}</Text>
      </View>
     ) : (
      <Text style={{ ...ty.label, color: t.ink2 }}>
       {open ? `${open.name} is in your library, but no clip has been recorded for it yet.` : ''}
      </Text>
     )}

     {/* Offered only when there is nothing to watch here — either the entry has
         no clip at all, or the player could not resolve the one it has. With a
         clip playing, sending the client to YouTube would be sending them away
         from the better answer. */}
     {open && (!open.uploaded || unplayable) ? (
      <View style={{ marginTop: sp.lg }}>
       <Cta label="Look It Up on the Web" wide onPress={searchWeb} />
       <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Opens a YouTube search for {open.name}.</Text>
      </View>
     ) : null}

     {/* ── log it, from here ────────────────────────────────────────────── */}
     <Rule />
     <View>
      <SectionHead title="Log This Exercise" note={banked.length ? `${banked.length} set${banked.length === 1 ? '' : 's'} ready` : undefined} />
      {banked.length ? (
       <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: sp.md, alignItems: 'center' }}>
        {banked.map((s, i) => (
         <Pressable key={i} onPress={() => setBanked((p) => p.filter((_, k) => k !== i))} hitSlop={6}
          accessibilityRole="button" accessibilityLabel={`Remove set ${i + 1}, ${s[0]} reps at ${s[1] > 0 ? liftLabel(s[1], wu) : 'bodyweight'}`}
          style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {/* 0 kg is a bodyweight set, not a missing weight — so it is named
              rather than printed as "0kg", which reads like a lost figure.
              The load itself reads in the member's own unit: it is typed into
              the box below THROUGH `readLift`, which stores kilograms, and
              printing those kilograms straight back handed a pounds member a
              different number from the one they had just typed. For a while
              this comment was the only true half of that sentence — the chip
              converted and the box did not, so the two disagreed by a factor
              of 2.2 and the chip was reporting the bug every time. */}
          <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{s[0]}×{s[1] > 0 ? liftLabel(s[1], wu) : 'bodyweight'}</Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>×</Text>
         </Pressable>
        ))}
       </View>
      ) : null}
      {/* The unit lived in the placeholder, so it was gone the moment either
          box had a number in it — and a bare pair of numerals either side of a
          × is exactly how somebody types pounds into a kilogram field. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.sm }}>
       <Field label="Reps">
        <TextInput value={reps} onChangeText={setReps} keyboardType="numeric"
         style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10 }} />
       </Field>
       <Text style={{ ...ty.caption, color: t.ink3, paddingBottom: 12 }}>×</Text>
       {/* The member's own unit, not a fixed "KG" — the label and the
           conversion move together, and this is the box where they did not. */}
       <Field label={wu.toUpperCase()} a11y={`Load in ${wu === 'kg' ? 'kilograms' : 'pounds'}, blank for a bodyweight set`}>
        <TextInput value={kg} onChangeText={setKg} keyboardType="numeric"
         style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10 }} />
       </Field>
       <Pressable onPress={addSet} accessibilityRole="button" accessibilityLabel="Add another set"
        style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }}>
        <Icon name="plus" size={16} color={t.ink2} />
       </Pressable>
      </View>
      <View style={{ marginTop: sp.md }}>
       <Cta label={saving ? 'Logging…' : 'Log to Today'} wide disabled={saving} onPress={logIt} />
      </View>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
       Goes into today's log alongside your programme, so your calendar, streak and records all count it. Leave the weight blank for a bodyweight set.
      </Text>
     </View>

     <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.lg }}>
      The clip plays here rather than in the browser, so a set you have already typed is still there when you go back. If a lift bothers you, use “Swap” on the workout screen for an alternative.
     </Text>
     </ScrollView>
    </View>
    </KeyboardAvoidingView>
   </Modal>
  </SafeAreaView>
 );
}
