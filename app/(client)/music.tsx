// Client · Music — link a music service, browse your own playlists, and build a
// workout-matched one.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero: this screen has no live number to lead with.
//
// Removed as fabricated state, in order of when each was found:
//
//   · Tapping "Connect" on the Apple Music row used to flip a local boolean and
//     relabel the button "Connected" while nothing at all was linked — there is
//     no MusicKit code in the app. It says so and stays disconnected.
//   · The copy claimed "the AI matches track tempo and energy".
//     `generatePlaylist` is a deterministic tempo/energy matcher over a curated
//     pool — real songs, hand-entered BPMs, no model involved.
//   · A generated list whose Spotify search had failed was still labelled
//     "from your Spotify". That is TF-35's complaint and it was true: the
//     search threw, the catch was empty, and 106 hard-coded songs went out
//     under the person's own account name. A failed search now says what
//     failed, and the built-in list is labelled as the built-in list.
//
// New here: the account's real playlists (TF-35, `spotifyMyPlaylists`) and the
// in-session transport (TF-36, `SessionMusicBar`), which is mounted here as
// well as in a session so the two agree about what "connected" means.
import { useState, useEffect, useCallback } from 'react';
import { BRAND } from '../../src/lib/brands';
import { View, Text, Pressable, ScrollView, Alert, Linking, ActivityIndicator, Image } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { generatePlaylist, spotifyQuerySeeds, CURATED_POOL_SIZE, type Service, type GenParams, type Playlist } from '../../src/lib/music';
import {
  connectSpotify, spotifyStatus, spotifyDisconnect, createSpotifyPlaylist, spotifySearchTracks,
  spotifyMyPlaylists, spotifyPlay, spotifyDevices, spotifyTransfer, SpotifyError,
  type PlaylistRef, type SpotifyDevice,
} from '../../src/lib/spotify';
import { playlistLine, playlistSavedLine } from '../../src/lib/spotifyPlayback';
import { reportError } from '../../src/lib/reportError';
import { SessionMusicBar } from '../../src/ui/SessionMusicBar';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Rule, Section, SectionHead, Cta, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { BACK_ICON } from '../../src/ui/direction';

// ── Apple Music is not a connectable service, and no longer pretends to be ──
//
// It had a Connect row whose only behaviour was an alert saying linking
// "arrives with MusicKit" and that nothing was linked. That is the same shape
// as Studio's "Connect Accounting" — a control that exists to explain that it
// does not work — and it is worse than no control, because it is
// indistinguishable from one that is merely misconfigured. Somebody taps it,
// reads a sentence about a library they have never heard of, and goes looking
// for a setting.
//
// What Apple Music genuinely does here still works and is untouched: tapping a
// track opens it. That needs no account, no link and no MusicKit, so it is
// described where it happens rather than sold as a connection.
//
// When MusicKit is actually built, this list is where it comes back.
const SERVICES: { id: Service; name: string; note: string }[] = [
 { id: 'spotify', name: 'Spotify', note: 'Playback control needs Spotify Premium' },
];
const MODES: { id: GenParams['mode']; label: string }[] = [
 { id: 'strength', label: 'Strength' },
 { id: 'cardio', label: 'Cardio' },
 { id: 'hiit', label: 'HIIT' },
 { id: 'mobility', label: 'Mobility' },
];
const INTENSITY: { v: 1 | 2 | 3; label: string }[] = [
 { v: 1, label: 'Easy' }, { v: 2, label: 'Moderate' }, { v: 3, label: 'Hard' },
];
const DURATIONS = [20, 30, 45, 60];

/** Every message shown to a person about Spotify comes through here, so a
 *  classified failure keeps its wording instead of being flattened to
 *  "Could not connect" — which is what TF-34 looked like from the outside. */
function spotifyMessage(e: unknown, fallback: string): string {
  if (e instanceof SpotifyError) return e.message;
  if (e && typeof (e as any).message === 'string') return (e as any).message;
  return fallback;
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
 const t = useTheme();
 return (
 <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
 style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
 <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
 </Pressable>
 );
}

export default function Music() {
 const t = useTheme();
 const router = useRouter();
 const [conn, setConn] = useState<Record<Service, boolean>>({ apple: false, spotify: false });
 const [mode, setMode] = useState<GenParams['mode']>('strength');
 const [intensity, setIntensity] = useState<1 | 2 | 3>(2);
 const [minutes, setMinutes] = useState(45);
 const [salt, setSalt] = useState(0);
 const [pl, setPl] = useState<Playlist | null>(null);
 const [spotifyBusy, setSpotifyBusy] = useState(false);
 const [genBusy, setGenBusy] = useState(false);
 const [spotifyName, setSpotifyName] = useState<string | undefined>(undefined);
 const [needsReconnect, setNeedsReconnect] = useState(false);

 // The account's own playlists. `mine === null` means "not read yet"; an empty
 // array means Spotify answered and this account genuinely has none. The two
 // are different sentences and are never merged into one.
 const [mine, setMine] = useState<PlaylistRef[] | null>(null);
 const [mineBusy, setMineBusy] = useState(false);
 const [mineProblem, setMineProblem] = useState<string | null>(null);

 const loadMine = useCallback(async () => {
   setMineBusy(true); setMineProblem(null);
   try { setMine(await spotifyMyPlaylists()); }
   catch (e) { setMine(null); setMineProblem(spotifyMessage(e, 'Could not read your playlists.')); }
   finally { setMineBusy(false); }
 }, []);

 // The connection itself is a read, and so is the account's playlist list
 // behind it. Split out of the effect so the gesture and the mount run the
 // same thing rather than two versions of it.
 const readSpotify = useCallback(async () => {
   const st = await spotifyStatus();
   if (!st.connected) return;
   setConn((p) => ({ ...p, spotify: true }));
   setSpotifyName(st.name);
   setNeedsReconnect(st.needsReconnect);
   if (!st.needsReconnect) await loadMine();
 }, [loadMine]);

 useEffect(() => { void readSpotify(); }, [readSpotify]);

 // A token that expired, or a playlist saved on the desktop app: both show up
 // only on a re-read, and the screen's own "Could not read your playlists"
 // had nothing to press.
 const pull = usePullToRefresh(readSpotify);

 const toggleService = async (id: Service) => {
   // Only Spotify is offered now, so this is the whole of the list. Kept as a
   // guard rather than removed: `Service` still has two members because the
   // track-opening code uses them, and a silent no-op would be worse than a
   // guard that can no longer be reached from the UI.
   if (id !== 'spotify') return;
   if (conn.spotify) {
     await spotifyDisconnect();
     setConn((p) => ({ ...p, spotify: false })); setSpotifyName(undefined);
     setNeedsReconnect(false); setMine(null); setMineProblem(null);
     return;
   }
   setSpotifyBusy(true);
   try {
     const r = await connectSpotify();
     setConn((p) => ({ ...p, spotify: true })); setSpotifyName(r.name); setNeedsReconnect(false);
     loadMine();
   }
   catch (e) { Alert.alert('Spotify', spotifyMessage(e, 'Could not connect.')); }
   finally { setSpotifyBusy(false); }
 };

 // Apple Music was counted here, and `conn.apple` can never become true — it
 // had no linking code to set it. Spotify is the only thing that can be
 // connected, so it is the only thing that can make this true.
 const anyConnected = conn.spotify;
 const openInSpotify = (q: string) => { Linking.openURL('https://open.spotify.com/search/' + encodeURIComponent(q)).catch(() => Alert.alert('Open Spotify', 'Install the Spotify app, then search "' + q + '".')); };

 /**
  * ── "No Spotify device is playing" was a dead end ────────────────────────
  *
  * Every play path on this screen ended at that sentence: leave this app, start
  * a track somewhere else, come back. `spotifyDevices` and `spotifyTransfer`
  * have been in src/lib/spotify.ts the whole time — the second one's own
  * comment says it exists "so 'no active device' is recoverable in-app" — and
  * nothing called either. So a Premium member with a phone, a laptop and a
  * speaker all signed in was told to go away.
  *
  * `recoverNoDevice` is that recovery, and it is only ever reached from the
  * failure Spotify itself classified: a 404 NO_ACTIVE_DEVICE. Anything else
  * keeps the message it already had.
  *
  * The list is the account's OWN devices as Spotify reports them, so nothing is
  * invented; an empty list is a real answer and says so rather than looping
  * back to the same alert.
  */
 const recoverNoDevice = async (title: string, retry: () => Promise<void>) => {
   let devices: SpotifyDevice[] = [];
   try { devices = await spotifyDevices(); }
   catch (e) { Alert.alert(title, spotifyMessage(e, 'Your Spotify devices could not be read.')); return; }
   const usable = devices.filter((d): d is SpotifyDevice & { id: string } => !!d.id);
   if (!usable.length) {
     Alert.alert(
       title,
       'Spotify is not reporting any device for your account — not even this phone. Open the Spotify app once so it registers, then try again.',
     );
     return;
   }
   Alert.alert(
     'Play it where?',
     'Spotify plays on a device rather than inside this app. Pick one and it starts there.',
     [
       ...usable.slice(0, 4).map((d) => ({
         text: d.name + (d.type ? ` · ${d.type.toLowerCase()}` : ''),
         onPress: async () => {
           try {
             await spotifyTransfer(d.id, true);
             await retry();
           } catch (e) {
             // The transfer or the retry. Either way nothing is playing, and
             // saying "playing on your laptop" over a refusal is the failure
             // this whole screen keeps being fixed for.
             Alert.alert(title, spotifyMessage(e, `Spotify would not start playback on ${d.name}.`));
           }
         },
       })),
       { text: 'Cancel', style: 'cancel' as const },
     ],
   );
 };

 /** Play a whole playlist on the account's active device, or fall back to
  *  opening it. A refused command says why rather than doing nothing. */
 const playPlaylist = async (p: PlaylistRef) => {
   if (!p.uri) { if (p.url) Linking.openURL(p.url).catch(() => {}); return; }
   try { await spotifyPlay({ contextUri: p.uri }); }
   catch (e) {
     // The one failure this app can actually fix, fixed rather than reported.
     if (e instanceof SpotifyError && e.kind === 'no_device') {
       await recoverNoDevice(p.name, async () => { await spotifyPlay({ contextUri: p.uri as string }); });
       return;
     }
     Alert.alert(p.name, spotifyMessage(e, 'Spotify refused that.'), p.url
       ? [{ text: 'Open in Spotify', onPress: () => Linking.openURL(p.url as string).catch(() => {}) }, { text: 'Done' }]
       : [{ text: 'Done' }]);
   }
 };

 // When a playlist is on screen, changing mode/intensity/length re-matches it live.
 // ── Two lines of copy that promised something this screen stopped doing ──
 //
 // Both said tracks are "matched on tempo and energy". That is true of the
 // BUILT-IN list, which carries a bpm and an energy figure per track. It is not
 // true of the path a connected member takes: `generate` below searches
 // Spotify by keyword and sets `bpm: null, energy: null`, because Spotify's
 // Audio Features endpoint is closed to development-mode apps — the code says
 // so in as many words, three lines from where the tracks are built. So the
 // headline of the screen advertised a mechanism that had been removed from
 // the path most people are on. The per-list caption underneath already names
 // which list is which honestly, and is where that distinction belongs.
 useEffect(() => { setPl((cur) => cur ? generatePlaylist({ mode, intensity, minutes }, salt) : cur); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode, intensity, minutes]);

 const generate = async (nextSalt = salt, nextIntensity = intensity) => {
   setSalt(nextSalt);
   const base = generatePlaylist({ mode, intensity: nextIntensity, minutes }, nextSalt);
   if (!conn.spotify || needsReconnect) { setPl(base); return; }

   setGenBusy(true);
   try {
     const found = await spotifySearchTracks(spotifyQuerySeeds(mode, nextIntensity), base.tracks.length, nextSalt);
     if (found.length >= 4) {
       setPl({
         ...base,
         source: 'spotify',
         subtitle: `${found.length} tracks · from Spotify’s catalogue`,
         // No bpm and no energy: Spotify's Audio Features endpoint is closed to
         // development-mode apps, so those two figures are genuinely unknown
         // here and render as dashes rather than as the curated list's numbers.
         tracks: found.map((f) => ({ title: f.title, artist: f.artist, bpm: null, energy: null, genre: null, uri: f.uri })),
       });
       return;
     }
     // A search that returned almost nothing is not a failure, but it is also
     // not "your Spotify" — say which list this actually is.
     setPl({ ...base, subtitle: base.subtitle + ' · built-in list; Spotify matched too few tracks' });
   } catch (e) {
     // No alert. The generate succeeded — `base` is a real playlist from the
     // built-in list and it is on screen — so a modal saying "Spotify returned
     // 400" over a working result reads as a failure when nothing failed for
     // the person reading it. Reported exactly that way: an error box on top of
     // a playlist that had just been built.
     //
     // The subtitle already carries it, in the one place somebody looking at
     // this playlist will read: which list these tracks came from, and that
     // Spotify was tried. That is the whole of what they can act on. The detail
     // goes to reportError, where it is useful to us and not to them.
     reportError('music.spotifySearch', e);
     setPl({ ...base, subtitle: base.subtitle + ' · built-in list; Spotify search failed' });
   } finally {
     setGenBusy(false);
   }
 };

 const push = async () => {
   if (!pl) return;
   if (conn.spotify && !needsReconnect) {
     setSpotifyBusy(true);
     try {
       // `tr.uri` is passed rather than dropped. A Spotify-sourced playlist
       // already holds the exact track for every row on screen, and the write
       // used to throw all of them away and re-search by title and artist text
       // — which is how a twenty-track list could land with eleven tracks in it,
       // some of them different recordings, announced as saved.
       const saved = await createSpotifyPlaylist(pl.title, pl.tracks.map((tr) => ({ title: tr.title, artist: tr.artist, uri: tr.uri })));
       Alert.alert('Saved to Spotify', playlistSavedLine(pl.title, saved), [{ text: 'Open', onPress: () => Linking.openURL(saved.url).catch(() => {}) }, { text: 'Done' }]);
       loadMine();
     } catch (e) { Alert.alert('Spotify', spotifyMessage(e, 'Could not save the playlist.')); }
     finally { setSpotifyBusy(false); }
     return;
   }
   // `conn.apple` was tested here and is unreachable — nothing ever set it.
   //
   // The second sentence used to read "Every track here opens in Apple Music on
   // a tap, which needs nothing." Nothing on this screen has ever opened Apple
   // Music: the only track handler in this file is `openInSpotify`, which builds
   // an open.spotify.com search and otherwise offers to install Spotify. So the
   // one sentence whose job was telling somebody what they could do WITHOUT
   // connecting described a feature the header of this file records as never
   // having existed — and it was read by exactly the person it was worst for,
   // an Apple Music subscriber with no Spotify account.
   Alert.alert('Connect Spotify', 'Saving a playlist to an account needs Spotify. Without it you can still use the list here — tapping a track searches for it in Spotify, and the titles are ordinary ones you can find in whatever you listen on.');
 };

 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
 <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>Your session soundtrack</Text>
 <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Music</Text>
 </View>
 </View>

 <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>
 Play your own playlists, or build one for the session — picked for the work, not for the mood.
 </Text>

 <Rule />

 {/* ── what is playing, and the same transport a session gets ─────── */}
 <Section>
 <SectionHead title="Now Playing" />
 <SessionMusicBar />
 </Section>

 <Rule />

 {/* ── what to build ──────────────────────────────────────────────────
     Reported as "I'm trying to build a playlist for the work out and it is
     only showing playlists I have already made — it doesn't give me an
     option to generate a new playlist."

     The generator was here the whole time, under a heading that named a
     SETTING rather than the action. "Build For" reads as a filter over the
     list above it, and it sat below that list, so somebody looking for a way
     to make a playlist scrolled past their own playlists, found a row of
     chips, and reasonably concluded there was not one.

     The heading now says what pressing on produces, and its note carries the
     whole spec — "45 min · Lifting · Hard" — so the section states its output
     before anything is tapped, rather than making the reader assemble that
     from three rows of chips. */}
 <Section>
 <SectionHead title="Build a Workout Playlist"
 note={`${minutes} min · ${MODES.find((m) => m.id === mode)?.label ?? ''} · ${INTENSITY.find((x) => x.v === intensity)?.label ?? ''}`} />
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: -2, marginBottom: sp.lg }}>
 Pick the work, how hard it is and how long you have. Nothing reaches your account until you save it.
 </Text>
 <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
 {MODES.map((m) => <Chip key={m.id} on={mode === m.id} label={m.label} onPress={() => setMode(m.id)} />)}
 </View>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Intensity</Text>
 <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
 {INTENSITY.map((x) => <Chip key={x.v} on={intensity === x.v} label={x.label} onPress={() => setIntensity(x.v)} />)}
 </View>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Length</Text>
 <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
 {DURATIONS.map((d) => <Chip key={d} on={minutes === d} label={`${d} min`} onPress={() => setMinutes(d)} />)}
 </View>
 <Pressable onPress={() => generate(salt + 1)} disabled={genBusy} accessibilityState={{ disabled: genBusy, busy: genBusy }} accessibilityRole="button"
 style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginTop: sp.xl, opacity: genBusy ? 0.7 : 1, flexDirection: 'row', justifyContent: 'center', gap: sp.sm }}>
 {genBusy ? <ActivityIndicator color={t.brandInk} size="small" /> : null}
 <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>{genBusy ? 'Finding songs…' : pl ? 'Regenerate Playlist' : 'Generate Workout Playlist'}</Text>
 </Pressable>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
 {conn.spotify && !needsReconnect
 ? 'Searches Spotify’s catalogue. If that fails, you get the built-in list of ' + CURATED_POOL_SIZE + ' songs and it says so.'
 : 'Without Spotify connected this uses the built-in list of ' + CURATED_POOL_SIZE + ' songs — not your library.'}
 </Text>
 </Section>

 <Rule />

 {/* ── the playlist, or an honest empty state ─────────────────────── */}
 <Section>
 {pl ? (
 <>
 <Text style={{ ...ty.head, color: t.ink }}>{pl.title}</Text>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.md }}>{pl.subtitle}</Text>
 {pl.tracks.map((tr, i) => (
 <Pressable key={i} onPress={() => openInSpotify(`${tr.title} ${tr.artist}`)} accessibilityRole="button" accessibilityLabel={`${tr.title} by ${tr.artist}`}
 style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3, width: 18 }}>{i + 1}</Text>
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{tr.title}</Text>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={1}>{tr.artist || '—'}</Text>
 </View>
 <View style={{ alignItems: 'flex-end' }}>
 {/* A Spotify row has no BPM and no energy the app is allowed to know,
     so it shows a dash rather than borrowing the curated list's numbers. */}
 <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{tr.bpm !== null ? tr.bpm + ' bpm' : '—'}</Text>
 <Text style={{ ...ty.micro, color: t.ink3, letterSpacing: 1.4 }}>{tr.energy !== null ? '●'.repeat(tr.energy) : ''}</Text>
 </View>
 <Icon name="play" size={15} color={t.ink3} />
 </Pressable>
 ))}
 <View style={{ marginTop: sp.xl }}>
 <Cta label="Play in Spotify" wide onPress={async () => {
   const uris = pl.tracks.map((tr) => tr.uri).filter((u): u is string => !!u);
   // Real URIs mean the whole list can start on the person's own device.
   // Without them all we can honestly do is open a search for track one.
   if (uris.length && conn.spotify && !needsReconnect) {
     try { await spotifyPlay({ uris }); return; }
     catch (e) {
       if (e instanceof SpotifyError && e.kind === 'no_device') {
         await recoverNoDevice('Spotify', async () => { await spotifyPlay({ uris }); });
         return;
       }
       Alert.alert('Spotify', spotifyMessage(e, 'Spotify refused that.')); return;
     }
   }
   if (pl.tracks[0]) openInSpotify(`${pl.tracks[0].title} ${pl.tracks[0].artist}`);
 }} />
 </View>
 <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
 <View style={{ flex: 1 }}><Ghost label="Save to Account" onPress={push} /></View>
 <Ghost label="Harder" onPress={() => { const ni = (intensity < 3 ? intensity + 1 : intensity) as 1 | 2 | 3; setIntensity(ni); generate(salt + 1, ni); }} />
 </View>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
 {pl.source === 'spotify'
 ? 'These came from Spotify’s catalogue. Save adds them to your account as a playlist.'
 : `These are ${BRAND.label}’s built-in list, not your library. Tap any track to find it in Spotify.`}
 </Text>
 </>
 ) : (
 <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
 <Icon name="play" size={26} color={t.ink3} />
 <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>
 No playlist yet. Pick a session type and tap Generate.
 </Text>
 </View>
 )}
 </Section>

 <Rule />

 {/* ── services ───────────────────────────────────────────────────── */}
 <Section>
 <SectionHead title="Your Music" note={anyConnected ? 'Connected' : undefined} />
 {needsReconnect ? (
 <Notice kicker="Spotify" title="Reconnect to Finish This"
 note="Your Spotify sign-in predates playlist and playback permission, and Spotify cannot add permissions to a token that already exists. Disconnect and connect again — it takes one tap each." />
 ) : null}
 {SERVICES.map((s, i) => (
 <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
 <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
 <Icon name="play" size={17} color={t.brand} />
 </View>
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{s.name}</Text>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.note}</Text>
 </View>
 <Pressable onPress={() => toggleService(s.id)} disabled={s.id === 'spotify' && spotifyBusy} accessibilityState={{ disabled: !!(s.id === 'spotify' && spotifyBusy), busy: !!(s.id === 'spotify' && spotifyBusy) }}
 accessibilityRole="button" accessibilityLabel={(conn[s.id] ? 'Disconnect ' : 'Connect ') + s.name}
 style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.sm, minWidth: 92, alignItems: 'center', backgroundColor: conn[s.id] ? t.surface2 : (s.id === 'spotify' ? t.brand : t.surface2) }}>
 {s.id === 'spotify' && spotifyBusy
 ? <ActivityIndicator color={t.brandInk} size="small" />
 : <Text numberOfLines={1} style={{ ...ty.label, fontWeight: '500', color: conn[s.id] || s.id !== 'spotify' ? t.ink : t.brandInk }}>
 {conn[s.id] ? ((s.id === 'spotify' && spotifyName) ? spotifyName : 'Connected') : (s.id === 'spotify' ? 'Connect' : 'Not yet')}
 </Text>}
 </Pressable>
 </View>
 ))}
 </Section>


 <Rule />

 {/* ── the account's own playlists ────────────────────────────────── */}
 {conn.spotify && !needsReconnect ? (
 <>
 <Rule />
 <Section>
 <SectionHead title="Your Playlists" note={mine ? String(mine.length) : undefined} onPress={loadMine} />
 {mineBusy ? (
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: sp.md }}>
 <ActivityIndicator size="small" color={t.ink3} />
 <Text style={{ ...ty.label, color: t.ink3 }}>Reading your Spotify…</Text>
 </View>
 ) : mineProblem ? (
 <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-start', paddingVertical: sp.md }}>
 <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, marginTop: 6 }} />
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.label, color: t.ink2 }}>{mineProblem}</Text>
 <Pressable onPress={loadMine} accessibilityRole="button" style={{ marginTop: sp.sm }}>
 <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Try Again</Text>
 </Pressable>
 </View>
 </View>
 ) : mine && mine.length === 0 ? (
 <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.md }}>
 This Spotify account has no playlists yet. Build one above and save it.
 </Text>
 ) : (mine ?? []).map((p, i) => (
 <Pressable key={p.id} onPress={() => playPlaylist(p)} accessibilityRole="button" accessibilityLabel={'Play ' + p.name}
 style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
 {p.artUrl
 ? <Image source={{ uri: p.artUrl }} style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: t.surface2 }} />
 : <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
 <Icon name="play" size={16} color={t.ink3} />
 </View>}
 <View style={{ flex: 1 }}>
 <Text numberOfLines={1} style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{p.name}</Text>
 <Text numberOfLines={1} style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{playlistLine(p)}</Text>
 </View>
 <Icon name="play" size={15} color={t.ink3} />
 </Pressable>
 ))}
 </Section>
 </>
 ) : null}

 </ScrollView>
 </SafeAreaView>
 );
}
