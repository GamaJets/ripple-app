// Client · Music — link a music service and build a workout-matched playlist.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same Spotify OAuth, same generator, same routes and the
// same conditional branches — the three bordered panels became hairline
// -separated sections. No hero: this screen has no live number to lead with.
//
// Removed as fabricated state: tapping "Connect" on the Apple Music row used to
// flip a local boolean and relabel the button "Connected" while nothing at all
// was linked — there is no MusicKit code in the app. It now says so and stays
// disconnected. Spotify's connect is real (`src/lib/spotify`) and is untouched.
//
// Also corrected: the copy claimed "the AI matches track tempo and energy".
// `generatePlaylist` is a deterministic tempo/energy matcher over a curated pool
// — real songs with real BPMs, no model involved — so the copy now says that.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Linking, ActivityIndicator } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { generatePlaylist, spotifyQuerySeeds, type Service, type GenParams, type Playlist } from '../../src/lib/music';
import { connectSpotify, spotifyStatus, spotifyDisconnect, createSpotifyPlaylist, spotifySearchTracks } from '../../src/lib/spotify';
import { Rule, Section, SectionHead, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';

const SERVICES: { id: Service; name: string; ico: string; note: string }[] = [
 { id: 'apple', name: 'Apple Music', ico: '', note: 'Linking arrives with MusicKit' },
 { id: 'spotify', name: 'Spotify', ico: '', note: 'Playback control needs Spotify Premium' },
];
const MODES: { id: GenParams['mode']; label: string; ico: string }[] = [
 { id: 'strength', label: 'Strength', ico: '' },
 { id: 'cardio', label: 'Cardio', ico: '' },
 { id: 'hiit', label: 'HIIT', ico: '' },
 { id: 'mobility', label: 'Mobility', ico: '' },
];
const INTENSITY: { v: 1 | 2 | 3; label: string }[] = [
 { v: 1, label: 'Easy' }, { v: 2, label: 'Moderate' }, { v: 3, label: 'Hard' },
];
const DURATIONS = [20, 30, 45, 60];

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
 useEffect(() => { (async () => { const st = await spotifyStatus(); if (st.connected) { setConn((p) => ({ ...p, spotify: true })); setSpotifyName(st.name); } })(); }, []);
 const toggleService = async (id: Service) => {
   // Apple Music has no linking code behind it — say so rather than showing a
   // "Connected" badge for a connection that was never made.
   if (id !== 'spotify') { Alert.alert('Apple Music', 'Apple Music linking uses MusicKit, which arrives with the Apple Music connect. Nothing was linked. Tap any track to open it, or connect Spotify to save a playlist.'); return; }
   if (conn.spotify) { await spotifyDisconnect(); setConn((p) => ({ ...p, spotify: false })); setSpotifyName(undefined); return; }
   setSpotifyBusy(true);
   try { const r = await connectSpotify(); setConn((p) => ({ ...p, spotify: true })); setSpotifyName(r.name); }
   catch (e: any) { Alert.alert('Spotify', (e && e.message) || 'Could not connect.'); }
   finally { setSpotifyBusy(false); }
 };

 const anyConnected = conn.apple || conn.spotify;
 const openInSpotify = (q: string) => { Linking.openURL('https://open.spotify.com/search/' + encodeURIComponent(q)).catch(() => Alert.alert('Open Spotify', 'Install the Spotify app, then search "' + q + '".')); };

 // When a playlist is on screen, changing mode/intensity/length re-matches it live.
 useEffect(() => { setPl((cur) => cur ? generatePlaylist({ mode, intensity, minutes }, salt) : cur); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode, intensity, minutes]);
 const generate = async (nextSalt = salt, nextIntensity = intensity) => {
 setSalt(nextSalt);
 const base = generatePlaylist({ mode, intensity: nextIntensity, minutes }, nextSalt);
 if (conn.spotify) {
 setGenBusy(true);
 try {
 const found = await spotifySearchTracks(spotifyQuerySeeds(mode, nextIntensity), base.tracks.length, nextSalt);
 if (found.length >= 4) {
 const energy = base.tracks[0]?.energy ?? 3;
 setPl({ ...base, subtitle: base.subtitle + ' · from your Spotify', tracks: found.map((f) => ({ title: f.title, artist: f.artist, bpm: 0, energy, genre: 'Spotify' })) });
 setGenBusy(false); return;
 }
 } catch { /* fall back to curated */ }
 setGenBusy(false);
 }
 setPl(base);
 };

 const push = async () => {
 if (!pl) return;
 if (conn.spotify) {
   setSpotifyBusy(true);
   try {
     const url = await createSpotifyPlaylist(pl.title, pl.tracks.map((tr) => ({ title: tr.title, artist: tr.artist })));
     Alert.alert('Saved to Spotify', pl.title + ' is in your Spotify library.', [{ text: 'Open', onPress: () => Linking.openURL(url).catch(() => {}) }, { text: 'Done' }]);
   } catch (e: any) { Alert.alert('Spotify', (e && e.message) || 'Could not save the playlist.'); }
   finally { setSpotifyBusy(false); }
   return;
 }
 if (conn.apple) { Alert.alert('Apple Music', 'Apple Music saving uses MusicKit, which arrives with the Apple Music connect. For now, tap a track to open it.'); return; }
 Alert.alert('Connect a service', 'Connect Spotify above to save this playlist to your account.');
 };

 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
 <Ghost icon="back" onPress={() => router.back()} />
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>Your session soundtrack</Text>
 <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Music</Text>
 </View>
 </View>

 <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>
 Link your music and build a playlist matched to the session — tempo and energy picked for the work, not for the mood.
 </Text>

 <Rule />

 {/* ── services ───────────────────────────────────────────────────── */}
 <Section>
 <SectionHead title="Your music" note={anyConnected ? 'Connected' : undefined} />
 {SERVICES.map((s, i) => (
 <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
 <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
 <Icon name="play" size={17} color={t.brand} />
 </View>
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{s.name}</Text>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.note}</Text>
 </View>
 <Pressable onPress={() => toggleService(s.id)} disabled={s.id === 'spotify' && spotifyBusy}
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

 {/* ── what to build ──────────────────────────────────────────────── */}
 <Section>
 <SectionHead title="Build for" note={`${minutes} min`} />
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
 <Pressable onPress={() => generate(salt + 1)} disabled={genBusy} accessibilityRole="button"
 style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginTop: sp.xl, opacity: genBusy ? 0.7 : 1, flexDirection: 'row', justifyContent: 'center', gap: sp.sm }}>
 {genBusy ? <ActivityIndicator color={t.brandInk} size="small" /> : null}
 <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>{genBusy ? 'Finding songs…' : pl ? 'Regenerate playlist' : 'Generate workout playlist'}</Text>
 </Pressable>
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
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={1}>{tr.artist}</Text>
 </View>
 <View style={{ alignItems: 'flex-end' }}>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{tr.bpm > 0 ? tr.bpm + ' bpm' : (tr.genre || '')}</Text>
 <Text style={{ ...ty.micro, color: t.ink3, letterSpacing: 1.4 }}>{tr.bpm > 0 ? '●'.repeat(tr.energy) : ''}</Text>
 </View>
 <Icon name="play" size={15} color={t.ink3} />
 </Pressable>
 ))}
 <View style={{ marginTop: sp.xl }}>
 <Cta label="Play in Spotify" wide onPress={() => pl.tracks[0] && openInSpotify(`${pl.tracks[0].title} ${pl.tracks[0].artist}`)} />
 </View>
 <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
 <View style={{ flex: 1 }}><Ghost label="Save to account" onPress={push} /></View>
 <Ghost label="Harder" onPress={() => { const ni = (intensity < 3 ? intensity + 1 : intensity) as 1 | 2 | 3; setIntensity(ni); generate(salt + 1, ni); }} />
 </View>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
 Tap any track to open it in Spotify. Connect Spotify above and Save adds the whole playlist to your account.
 </Text>
 </>
 ) : (
 <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
 <Icon name="play" size={26} color={t.ink3} />
 <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>
 No playlist yet. Pick a session type and tap Generate — tracks are matched on tempo and energy.
 </Text>
 </View>
 )}
 </Section>

 </ScrollView>
 </SafeAreaView>
 );
}
