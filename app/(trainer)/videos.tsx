// Trainer · Videos — exercise library the client app pulls from. Upload your own.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional, modal and route from the
// previous version is preserved — only the presentation changed: the library
// count became the screen's one hero figure, the bordered clip boxes became a
// hairline-divided list, and the Georgia serif header is gone.
//
// Also removed: the row subtitle printed `v.dur`, a duration field that was
// invented and has since been blanked — a clip now says what it is and whether
// it is recorded, and nothing it cannot know.
//
// ── What the private bucket changed here ───────────────────────────────────
//
// An uploaded clip is now a storage path, and the URL to play it is minted per
// viewer at play time. Three things followed from that, and this screen had all
// three wrong:
//
//   · it passed the upload result to addVideo as `url`. Since that result is
//     now a path, the row's `url` column held "<uid>/1724692000000.mp4" — not a
//     link any player could open, and not `video_path` either, so the signer
//     never saw it. The file sat in the bucket with nothing pointing at it.
//   · the play button was Linking.openURL, which cannot open a private object
//     at all, and which walked the trainer out of the app to try. A trainer
//     could not check their own clip. The row now expands into a real player.
//   · visibility had no control anywhere, so every clip took the 'clients'
//     default. A trainer wanting a private working copy, or a clip the whole
//     gym could use, had no way to say so — the permission model existed only
//     in the database. It is on the row now, and on the sheet that names a
//     newly recorded clip.
//
// And `removeVideo` is async and can fail. It used to be called for its side
// effect and the row vanished either way, so a delete the server refused looked
// exactly like one it accepted — right up until the next reload brought the
// clip back.
//
// ── One clip, one person ───────────────────────────────────────────────────
//
// The four levels are the common cases, and for a while they were all this
// screen could say. What the owner asked for was "whoever the trainer gives
// permissions to", and that is the case the levels do not cover: handing a
// single clip to a single named person without opening it to everyone you
// coach. That list lives in `exercise_video_grants`, and it reaches a clip
// whatever its visibility says — including one set to "Only me". That is the
// whole point of it and the part nobody guesses, so the panel says it out loud.
//
// Two things the "Shared with" control refuses to fake:
//
//   · the people it offers come from `clients`, never from useRoster(). The
//     roster merges `clients` with `coach_clients` — people a coach typed in by
//     hand, who have no auth account — and a grant's client_id is a foreign key
//     to profiles(id). A coach_clients id is a perfectly good uuid that is in
//     no profile, so granting to one comes back 23503 and there is nothing the
//     trainer can do about it. That same merge already cost broadcast.tsx an
//     entire broadcast, because one hand-added client failed the insert for
//     everybody. Hand-added people are counted here and named as unreachable,
//     which is a worse-looking list and a truthful one.
//   · `listGrants` returns null when the list could not be read, and null is
//     not "nobody". Drawing every toggle off over a failed read invites a
//     trainer to share a clip a second time, or to swear they never shared one
//     they did — so a failed read draws no toggles at all, and says why.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import { useTheme } from '../../src/ui/components';
import { useRouter } from 'expo-router';
import { Rule, Section, SectionHead, Hero, ListRow, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useExerciseVideos, uploadExerciseVideo, videoUploadAvailable, type VideoItem, type Visibility } from '../../src/ui/exerciseVideos';
import { ExerciseVideo } from '../../src/ui/ExerciseVideo';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { useAuth } from '../../src/ui/auth';
import { coverageFor, coverageLine } from '../../src/lib/videoCoverage';
import { isAcademyClip } from '../../src/lib/exerciseId';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';

/**
 * The four sharing levels in the trainer's words rather than the column's.
 *
 * `chip` is the version that rides on a list row, where "Everyone at the gym"
 * would wrap or truncate; `label` is what the picker and every spoken label
 * say, because a truncated permission is worse than none.
 */
const VIS: { key: Visibility; label: string; chip: string; note: string }[] = [
  { key: 'private', label: 'Only me', chip: 'Only me', note: 'Nobody else sees this clip. Useful for a take you are still working on.' },
  { key: 'clients', label: 'My clients', chip: 'My clients', note: 'Everyone you coach sees it in their program, on any device.' },
  { key: 'gym', label: 'Everyone at the gym', chip: 'The gym', note: 'Anyone training at your gym can watch it, whether or not you coach them.' },
  { key: 'public', label: 'Anyone on Repple', chip: 'Anyone', note: 'Anyone on Repple can watch it. Only choose this for a clip you are happy to publish.' },
];
const visOf = (v: Visibility) => VIS.find((c) => c.key === v) ?? VIS[1];

/** The picker itself — a row of chips, used on a library row and on the sheet
 *  that names a newly recorded clip so both offer the same four words. */
function VisibilityChoice({ value, onChange, subject, disabled }: {
  value: Visibility; onChange: (v: Visibility) => void; subject: string; disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, opacity: disabled ? 0.5 : 1 }}>
      {VIS.map((c) => {
        const on = c.key === value;
        return (
          <Pressable key={c.key} onPress={() => onChange(c.key)} disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: !!disabled }}
            accessibilityLabel={`Set who can see ${subject} to: ${c.label}`}
            style={{
              paddingVertical: sp.sm, paddingHorizontal: sp.md, borderRadius: radius.pill,
              backgroundColor: on ? t.brand : t.surface2,
            }}>
            <Text style={{ ...ty.caption, fontWeight: on ? '600' : '400', color: on ? t.brandInk : t.ink2 }}>{c.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One person a grant can actually name: an id that is also a profiles row. */
type Grantee = { id: string; name: string };

type PeopleStatus = 'idle' | 'loading' | 'ready' | 'error';

/** What we know about one clip's named list. 'error' is a real state and not a
 *  synonym for an empty `ids` — see the header. */
type GrantState = { status: 'loading' | 'error' | 'ready'; ids: string[] };

/**
 * The people this trainer can hand a clip to, read straight from `clients`.
 *
 * `clients` is keyed on the client's auth id, which is the id
 * exercise_video_grants.client_id points at. useRoster() is the wrong source
 * here however convenient it looks: it merges these rows with `coach_clients`,
 * and a coach_clients id names somebody with no auth account, so every grant to
 * one fails 23503 in a way the trainer cannot fix. They are counted instead, so
 * the screen can admit they are missing rather than list them and fail.
 *
 * `error` is checked on each call rather than destructured away. supabase-js
 * resolves with `{ data: null, error }` instead of throwing, so an unread error
 * turns into an empty array — and an empty array here reads as "you coach
 * nobody", which is exactly the silent-failure shape that once let this whole
 * library save nothing while saying "Added".
 */
function useGrantableClients(enabled: boolean) {
  const [status, setStatus] = useState<PeopleStatus>('idle');
  const [people, setPeople] = useState<Grantee[]>([]);
  const [handAdded, setHandAdded] = useState(0);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setPeople([]); setHandAdded(0); setStatus('ready'); return; }
    setStatus('loading');
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) { setStatus('error'); return; }

      const { data: cls, error } = await supabase.from('clients').select('id').eq('trainer_id', uid);
      if (error) { setStatus('error'); return; }
      const ids: string[] = (cls ?? []).map((r: any) => r.id).filter(Boolean);

      // Names come from profiles, keyed on the same id. A list of uuids is not
      // a list a trainer can pick a person out of, so a failed name read is a
      // failed read of the whole control, not a cosmetic loss.
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: profs, error: nameErr } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        if (nameErr) { setStatus('error'); return; }
        (profs ?? []).forEach((p: any) => names.set(p.id, (p.full_name || '').trim()));
      }

      // Hand-added people: counted, never listed. If this read fails we simply
      // make no claim about them — a wrong count is worse than no sentence.
      try {
        const { data: manual, error: manualErr } = await supabase.from('coach_clients').select('id').eq('trainer_id', uid);
        setHandAdded(manualErr ? 0 : (manual ?? []).length);
      } catch { setHandAdded(0); }

      setPeople(
        ids
          .map((id) => ({ id, name: names.get(id) || 'Client' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setStatus('ready');
    } catch { setStatus('error'); }
  }, []);

  // Lazy on purpose: a library of thirty clips must not cost a roster read on
  // mount for the twenty-nine nobody opened.
  useEffect(() => { if (enabled && status === 'idle') load(); }, [enabled, status, load]);

  return { status, people, handAdded, reload: load };
}

/**
 * The named-person list for one clip — every client who could hold a grant,
 * lit against what the server actually says.
 *
 * Nothing here is drawn from a guess. No client list means no list; no readable
 * grants means no toggles at all, because an unlit toggle is a claim that this
 * person cannot watch the clip, and we would not know that.
 */
function SharedWith({ video, people, peopleStatus, handAdded, grants, busyKey, onToggle, onRetryPeople, onRetryGrants }: {
  video: VideoItem;
  people: Grantee[];
  peopleStatus: PeopleStatus;
  handAdded: number;
  grants: GrantState | undefined;
  busyKey: string | null;
  onToggle: (p: Grantee) => void;
  onRetryPeople: () => void;
  onRetryGrants: () => void;
}) {
  const t = useTheme();
  const reading = peopleStatus === 'idle' || peopleStatus === 'loading' || !grants || grants.status === 'loading';
  const shared = grants?.status === 'ready' ? grants.ids : [];
  const listable = peopleStatus === 'ready' && grants?.status === 'ready';

  return (
    <View style={{ marginTop: sp.lg }}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>Shared with</Text>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.md }}>
        Anyone you name here can watch this clip whatever the setting above says — a name reaches even a clip set to “Only me”.
      </Text>

      {reading && peopleStatus !== 'error' ? (
        <Text style={{ ...ty.label, color: t.ink3 }}>Reading who this is shared with…</Text>
      ) : null}

      {peopleStatus === 'error' ? (
        <View>
          <Text style={{ ...ty.label, color: t.ink2 }}>
            Your client list could not be read, so there is nobody to show here. Anyone you have already shared this clip with still has it.
          </Text>
          <View style={{ height: sp.md }} />
          <Ghost label="Try Again" a11yLabel="Try reading your client list again" onPress={onRetryPeople} />
        </View>
      ) : null}

      {peopleStatus === 'ready' && grants?.status === 'error' ? (
        <View>
          <Text style={{ ...ty.label, color: t.ink2 }}>
            We could not read who “{video.name}” is shared with, so we are not going to show you a list. This is not a list of nobody — check before you share it again.
          </Text>
          <View style={{ height: sp.md }} />
          <Ghost label="Try Again" a11yLabel={`Try reading who ${video.name} is shared with again`} onPress={onRetryGrants} />
        </View>
      ) : null}

      {listable && people.length === 0 ? (
        <Text style={{ ...ty.label, color: t.ink3 }}>
          None of your clients has a Repple account yet, so there is nobody to hand this clip to by name.
        </Text>
      ) : null}

      {listable && people.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {people.map((p) => {
            const on = shared.includes(p.id);
            const busy = busyKey === `${video.id}:${p.id}`;
            return (
              <Pressable key={p.id} onPress={() => onToggle(p)} disabled={!!busyKey}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: !!busyKey }}
                accessibilityLabel={on
                  ? `${p.name} can watch ${video.name}. Stop sharing it with them`
                  : `Share ${video.name} with ${p.name}`}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 5,
                  paddingVertical: sp.sm, paddingHorizontal: sp.md, borderRadius: radius.pill,
                  backgroundColor: on ? t.brand : t.surface2,
                  opacity: busyKey && !busy ? 0.5 : 1,
                }}>
                {busy ? <ActivityIndicator size="small" color={on ? t.brandInk : t.ink3} />
                  : on ? <Icon name="check" size={13} color={t.brandInk} /> : null}
                <Text style={{ ...ty.caption, fontWeight: on ? '600' : '400', color: on ? t.brandInk : t.ink2 }} numberOfLines={1}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {peopleStatus === 'ready' && handAdded > 0 ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          {handAdded === 1
            ? 'One person on your roster was added by hand and has'
            : `${handAdded} people on your roster were added by hand and have`} no Repple account, so they are not listed — there is no account for the clip to reach.
        </Text>
      ) : null}
    </View>
  );
}

export default function TrainerVideos() {
  const t = useTheme();
  const { videos: vids, status, addVideo, removeVideo, setVisibility, grantTo, revokeFrom, listGrants, reload } = useExerciseVideos();
  const router = useRouter();
  const auth = useAuth();
  const { templates } = useProgramTemplates();
  // Every movement this coach has written into a template, however they spelt
  // it. Null while the library has not been read: a coverage claim built on a
  // failed read would tell a coach they have nothing filmed when they may have
  // filmed everything.
  const coverage = status === 'error' || status === 'loading' ? null : coverageFor(
    templates.flatMap((tpl) => tpl.program.days.flatMap((d) => d.exercises.map((e) => e.name))),
    vids,
    auth.user?.id ?? null,
  );
  const [linkOpen, setLinkOpen] = useState(false);
  const [lName, setLName] = useState('');
  const [lGroup, setLGroup] = useState('');
  const [lUrl, setLUrl] = useState('');
  const [pendUri, setPendUri] = useState<string | null>(null);
  const [upName, setUpName] = useState('');
  const [upGroup, setUpGroup] = useState('');
  const [upVis, setUpVis] = useState<Visibility>('clients');
  const [upBusy, setUpBusy] = useState(false);
  // Exactly one row plays at a time. Thirty mounted players would each hold a
  // decoder and each mint its own signed URL on render, for clips nobody asked
  // to watch.
  const [openId, setOpenId] = useState<string | null>(null);
  const [visBusy, setVisBusy] = useState<string | null>(null);
  // Named grants, per clip, read only for the row that is open. `grantsAsked`
  // is what stops the effect below from re-reading on every render — it cannot
  // key off `grants` itself, because writing the 'loading' entry would retrigger
  // it and cancel the read it just started.
  const [grants, setGrants] = useState<Record<string, GrantState>>({});
  const [grantBusy, setGrantBusy] = useState<string | null>(null);
  const grantsAsked = useRef<Set<string>>(new Set());
  const openIsHosted = !!openId && openId.startsWith('db');
  const clients = useGrantableClients(openIsHosted);

  const loadGrants = async (id: string) => {
    grantsAsked.current.add(id);
    setGrants((p) => ({ ...p, [id]: { status: 'loading', ids: [] } }));
    const ids = await listGrants(id);
    // null means the read failed. It is kept apart from an empty list all the
    // way to the UI, because "we don't know" and "nobody" send a trainer in
    // opposite directions.
    setGrants((p) => ({ ...p, [id]: ids === null ? { status: 'error', ids: [] } : { status: 'ready', ids } }));
  };

  useEffect(() => {
    if (openId && openId.startsWith('db') && !grantsAsked.current.has(openId)) loadGrants(openId);
    // loadGrants is a fresh closure each render; listing it here would re-run
    // this on every render. The ref above is the guard that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  /**
   * Hand this clip to one person, or take it back.
   *
   * The lit state is only moved after the server agreed. A toggle that flips
   * optimistically and then fails is the delete bug in miniature: the trainer
   * walks away believing a client can watch something they cannot, or the other
   * way round, and nothing on screen disagrees with them.
   */
  const toggleGrant = async (v: VideoItem, person: Grantee) => {
    const g = grants[v.id];
    if (!g || g.status !== 'ready' || grantBusy) return;
    const on = g.ids.includes(person.id);
    setGrantBusy(`${v.id}:${person.id}`);
    const ok = on ? await revokeFrom(v.id, person.id) : await grantTo(v.id, person.id);
    setGrantBusy(null);
    if (!ok) {
      Alert.alert(
        on ? 'Not removed' : 'Not shared',
        on
          ? `${person.name} can still watch “${v.name}”. The change did not reach the server — check your connection and try again.`
          : `“${v.name}” has not been shared with ${person.name}. The change did not reach the server — check your connection and try again.`,
      );
      return;
    }
    setGrants((p) => {
      const cur = p[v.id];
      if (!cur || cur.status !== 'ready') return p;
      return { ...p, [v.id]: { status: 'ready', ids: on ? cur.ids.filter((x) => x !== person.id) : [...cur.ids, person.id] } };
    });
  };

  const upload = async (fromCamera: boolean, prefill?: { name?: string; group?: string }) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'add a video'))) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 60 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (!res.canceled && res.assets && res.assets[0]) {
      // Open the naming sheet; pre-fill from the tapped exercise when there is one.
      setUpName(prefill?.name || ''); setUpGroup(prefill?.group || ''); setUpVis('clients'); setPendUri(res.assets[0].uri);
    }
  };

  const saveUpload = async () => {
    if (!pendUri || upBusy) return;
    setUpBusy(true);
    // The upload hands back a storage path, not a link. It goes to `path`; the
    // `url` field is for a coach who pointed at a video hosted somewhere else.
    let path: string | null = null;
    if (videoUploadAvailable()) {
      path = await uploadExerciseVideo(pendUri);
      if (!path) { setUpBusy(false); Alert.alert('Upload failed', 'Could not upload the clip right now. Check your connection and try again, or add it as a link.'); return; }
    }
    const chosen = upVis;
    const where = await addVideo({ name: upName.trim() || 'Exercise clip', group: upGroup.trim() || 'Uncategorised', path: path || undefined, visibility: chosen });
    setUpBusy(false); setPendUri(null);
    Alert.alert('Clip added', where === 'remote'
      ? `Uploaded. ${visOf(chosen).note} You can change that any time from the clip's row.`
      : 'Saved to your library on this device only. It did not reach the server, so nobody else can see it yet — try again when you have a connection.');
  };

  // Tap a recorded clip to watch it right here; tap a not-yet-recorded exercise
  // to add one.
  const tapRow = (v: VideoItem) => {
    if (v.uploaded) { setOpenId(openId === v.id ? null : v.id); return; }
    Alert.alert(v.name, 'No video yet for this exercise — add one now:', [
      { text: 'Record', onPress: () => upload(true, { name: v.name, group: v.group }) },
      { text: 'Upload from library', onPress: () => upload(false, { name: v.name, group: v.group }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // A refused change must not leave the chip showing the level the trainer
  // picked — that is a clip they believe is private and is not.
  const changeVisibility = async (v: VideoItem, next: Visibility) => {
    if (v.visibility === next || visBusy) return;
    setVisBusy(v.id);
    const ok = await setVisibility(v.id, next);
    setVisBusy(null);
    if (!ok) {
      Alert.alert('Not changed', `“${v.name}” is still set to “${visOf(v.visibility).label}”. The change did not reach the server — check your connection and try again.`);
    }
  };

  // Guard removal — a hosted clip disappears for every client, so confirm
  // first, and then say so if the server refused. Dropping the row optimistically
  // meant a failed delete looked identical to a successful one until the clip
  // reappeared on the next load.
  const confirmRemove = (v: VideoItem) => {
    const hosted = v.id.startsWith('db');
    Alert.alert(
      'Remove ' + v.name + '?',
      hosted ? 'This deletes the clip for you and everyone you shared it with. This cannot be undone.' : 'This removes it from your library.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            const ok = await removeVideo(v.id);
            if (!ok) { Alert.alert('Not removed', `“${v.name}” is still in your library — the delete did not reach the server. Anyone you shared it with can still watch it. Try again when you have a connection.`); return; }
            if (openId === v.id) setOpenId(null);
          },
        },
      ],
    );
  };

  // `vids` is a count of what we could read. When the read failed it is the
  // local-only leftovers and nothing else, so it is not the size of the library
  // and must not be printed as though it were.
  const known = status === 'ready';
  const done = vids.filter((v) => v.uploaded).length;
  const G = layout.gutter;
  const sheet = { backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: 30, ...elevation.e2 };
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md, marginBottom: sp.md };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>You choose who sees these</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Exercise videos</Text>
        </View>

        {/* ── the hero ───────────────────────────────────────────────────── */}
        <Hero
          label="In your library"
          figure={known ? fig(vids.length) : fig(null)}
          unit={known ? (vids.length === 1 ? 'clip' : 'clips') : undefined}
          note={
            status === 'loading' ? 'Reading your library…'
              : status === 'error' ? 'Your library could not be read, so we cannot tell you what is in it.'
                : vids.length ? `${done} of ${vids.length} recorded · shared with whoever you chose`
                  : 'Record a clip or paste a link, then choose who gets to watch it.'
          }
        />

        <Rule />

        {/* ── what you programme but nobody has filmed ────────────────────
            The library answers "what have I recorded". This answers the more
            useful question: what am I asking people to do that they have never
            seen done. Scoped to the movements in this coach's own templates,
            not the whole 56-row catalogue — a list of everything is a chore
            nobody starts. */}
        {coverage && coverageLine(coverage) ? (
          <>
            <Section>
              <SectionHead title="What your programmes need"
                note={coverage.missing.length ? `${coverage.missing.length} to film` : undefined} />
              <Text style={{ ...ty.label, color: t.ink2 }}>{coverageLine(coverage)}</Text>

              {coverage.missing.length ? (
                <View style={{ marginTop: sp.md }}>
                  {coverage.missing.slice(0, 8).map((nm, i) => (
                    <View key={nm} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm,
                      paddingVertical: sp.sm, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                      <Text style={{ ...ty.body, color: t.ink, flex: 1 }}>{nm}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>no clip</Text>
                    </View>
                  ))}
                  {coverage.missing.length > 8 ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                      …and {coverage.missing.length - 8} more.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {coverage.academyOnly.length ? (
                <View style={{ marginTop: sp.lg }}>
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
                    Showing the Academy clip — record your own and yours is what your clients see instead.
                  </Text>
                  {coverage.academyOnly.slice(0, 6).map((nm, i) => (
                    <View key={nm} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm,
                      paddingVertical: sp.sm, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
                      <Text style={{ ...ty.body, color: t.ink, flex: 1 }}>{nm}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>Academy</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Section>

            <Rule />
          </>
        ) : null}

        {/* ── add a clip: the primary action ─────────────────────────────── */}
        <Section>
          <SectionHead title="Add a clip" />
          <Cta label="Record" wide onPress={() => upload(true)} />
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
            <View style={{ flex: 1 }}><Ghost label="Upload" icon="plus" onPress={() => upload(false)} /></View>
            <View style={{ flex: 1 }}><Ghost label="Add Link" icon="share" onPress={() => { setLName(''); setLGroup(''); setLUrl(''); setLinkOpen(true); }} /></View>
          </View>
        </Section>

        <Rule />

        <Section>
          <ListRow icon="share" title="Broadcast a session to social" note="Share a session from your library"
            onPress={() => router.push('/(trainer)/broadcast-session')} />
        </Section>

        <Rule />

        {/* ── the library ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Library" note={known && vids.length ? `${vids.length} clip${vids.length === 1 ? '' : 's'}` : undefined} />

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your library…</Text>
          ) : null}

          {status === 'error' ? (
            <View style={{ marginBottom: vids.length ? sp.lg : 0 }}>
              <Text style={{ ...ty.label, color: t.ink2 }}>
                Your library could not be read. Whatever you have uploaded is still there — it is missing from this list, not deleted.
                {vids.length ? ' What follows is only what is saved on this phone.' : ''}
              </Text>
              <View style={{ height: sp.md }} />
              <Ghost label="Try Again" onPress={() => { reload(); }} />
            </View>
          ) : null}

          {known && vids.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No clips yet. Record one, upload one from your library, or paste a hosted link — then say who gets to watch it.
            </Text>
          ) : null}

          {vids.map((v, i) => {
            // Only a clip that reached the server has a sharing setting to
            // change: `setVisibility` writes a row, and there is no row behind a
            // local-only entry or a clip that ships with the app.
            const mine = v.id.startsWith('db');
            const localOnly = v.id.startsWith('vx');
            const open = openId === v.id;
            const busy = visBusy === v.id;
            const vis = visOf(v.visibility);
            return (
              <View key={v.id} style={{ borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <Pressable onPress={() => tapRow(v)} hitSlop={6} accessibilityRole="button"
                    accessibilityLabel={v.uploaded ? (open ? `Stop watching ${v.name}` : `Play ${v.name}`) : `Add a clip for ${v.name}`}
                    style={({ pressed }) => ({ width: 46, height: 36, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                    {v.uploaded ? <Icon name={open ? 'minus' : 'play'} size={17} color={t.brand} /> : <Icon name="plus" size={17} color={t.ink3} />}
                  </Pressable>

                  <Pressable onPress={() => tapRow(v)} style={{ flex: 1 }} accessibilityRole="button"
                    accessibilityLabel={`${v.name}, ${v.group}. ${v.uploaded ? (mine ? `Seen by: ${vis.label}` : 'Recorded') : 'Not recorded yet'}`}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{v.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={1}>
                      {v.group}{v.uploaded ? '' : ' · not recorded yet'}{localOnly ? ' · this phone only' : ''}
                    </Text>
                  </Pressable>

                  {mine ? (
                    <Pressable onPress={() => setOpenId(open ? null : v.id)} hitSlop={6} accessibilityRole="button"
                      accessibilityLabel={`Who can see ${v.name}: ${vis.label}. Change this`}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: sp.xs, paddingHorizontal: sp.sm, borderRadius: radius.pill, backgroundColor: t.surface2 }}>
                      {busy ? <ActivityIndicator size="small" color={t.ink3} /> : <Icon name={v.visibility === 'private' ? 'eye-off' : 'eye'} size={13} color={t.ink3} />}
                      <Text style={{ ...ty.caption, color: t.ink2 }} numberOfLines={1}>{vis.chip}</Text>
                    </Pressable>
                  ) : null}

                  {mine || localOnly ? (
                    <Pressable onPress={() => confirmRemove(v)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + v.name}>
                      <Icon name="minus" size={16} color={t.ink3} />
                    </Pressable>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: v.uploaded ? t.brand : t.s3 }} />
                      <Text style={{ ...ty.caption, color: t.ink2 }}>{v.uploaded ? 'Live' : 'To do'}</Text>
                    </View>
                  )}
                </View>

                {open ? (
                  <View style={{ paddingBottom: sp.lg }}>
                    {v.uploaded ? <ExerciseVideo video={v} exerciseName={v.name} /> : null}
                    {mine ? (
                      <View style={{ marginTop: sp.md }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>Who can see this</Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.md }}>{vis.note}</Text>
                        <VisibilityChoice value={v.visibility} disabled={busy} subject={v.name} onChange={(next) => changeVisibility(v, next)} />

                        {/* The named list sits under the four levels because it
                            is the exception to them, not a fifth one. */}
                        <SharedWith
                          video={v}
                          people={clients.people}
                          peopleStatus={clients.status}
                          handAdded={clients.handAdded}
                          grants={grants[v.id]}
                          busyKey={grantBusy}
                          onToggle={(p) => toggleGrant(v, p)}
                          onRetryPeople={clients.reload}
                          onRetryGrants={() => loadGrants(v.id)}
                        />
                      </View>
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                        {localOnly
                          ? 'This clip only exists on this phone, so there is nobody to share it with. Remove it and add it again when you have a connection.'
                          : 'A clip that ships with Repple, not one of yours — everyone you coach can already watch it.'}
                      </Text>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </Section>
      </ScrollView>

      {/* ── add by link ──────────────────────────────────────────────────── */}
      <Modal visible={linkOpen} transparent animationType="slide" onRequestClose={() => setLinkOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setLinkOpen(false)}
          accessibilityRole="button" accessibilityLabel="Close, without adding a video" />
        <View style={sheet}>
          <Text style={{ ...ty.title, color: t.ink }}>Add a video by link</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>Paste a hosted link (YouTube, Vimeo…). Clients watch it in their library.</Text>
          <TextInput value={lName} onChangeText={setLName} placeholder="Exercise name (e.g. Front Squat)" placeholderTextColor={t.ink3} style={input} />
          <TextInput value={lGroup} onChangeText={setLGroup} placeholder="Muscle group (e.g. Legs)" placeholderTextColor={t.ink3} style={input} />
          <TextInput value={lUrl} onChangeText={setLUrl} placeholder="https://…" placeholderTextColor={t.ink3} autoCapitalize="none" keyboardType="url" style={[input, { marginBottom: sp.lg }]} />
          <Cta label="Add to Library" wide onPress={() => { if (!lName.trim()) { Alert.alert('Name needed', 'Give the exercise a name.'); return; } addVideo({ name: lName, group: lGroup, url: lUrl }); setLinkOpen(false); Alert.alert('Added', lName + ' is in the exercise library.'); }} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => setLinkOpen(false)} />
        </View>
              </KeyboardAvoidingView>
      </Modal>

      {/* ── name a recorded / picked clip ────────────────────────────────── */}
      <Modal visible={!!pendUri} transparent animationType="slide" onRequestClose={() => { if (!upBusy) setPendUri(null); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => { if (!upBusy) setPendUri(null); }}
          accessibilityRole="button" accessibilityLabel="Close, without saving this clip" />
        <View style={sheet}>
          <Text style={{ ...ty.title, color: t.ink }}>Name this clip</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>{videoUploadAvailable() ? 'It uploads to your library, and only the people you choose below can watch it.' : 'Saved to this device — turn on the backend to share it with anyone.'}</Text>
          <TextInput value={upName} onChangeText={setUpName} editable={!upBusy} placeholder="Exercise name (e.g. Front Squat)" placeholderTextColor={t.ink3} style={input} />
          <TextInput value={upGroup} onChangeText={setUpGroup} editable={!upBusy} placeholder="Muscle group (e.g. Legs)" placeholderTextColor={t.ink3} style={input} />

          {/* Asked here rather than after the fact, because the upload is the
              moment the clip becomes visible to somebody. */}
          <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xs }}>Who can see it</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.md }}>{visOf(upVis).note}</Text>
          <View style={{ marginBottom: sp.lg }}>
            <VisibilityChoice value={upVis} disabled={upBusy} subject="this clip" onChange={setUpVis} />
          </View>

          <Pressable onPress={saveUpload} disabled={upBusy}
            accessibilityRole="button" accessibilityState={{ disabled: upBusy }}
            accessibilityLabel={upBusy ? 'Uploading the clip' : (videoUploadAvailable() ? `Upload to library, seen by: ${visOf(upVis).label}` : 'Save clip to this device')}
            style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: sp.sm, opacity: upBusy ? 0.7 : 1 }}>
            {upBusy ? <ActivityIndicator color={t.brandInk} /> : null}
            <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>{upBusy ? 'Uploading…' : (videoUploadAvailable() ? 'Upload to library' : 'Save clip')}</Text>
          </Pressable>
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => { if (!upBusy) setPendUri(null); }} />
        </View>
              </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
