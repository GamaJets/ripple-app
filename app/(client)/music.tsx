// Music & Playlists — connect Spotify / Apple Music and let the AI build a
// workout-matched playlist. Live OAuth/MusicKit linking lands in the backend
// phase; this builds the list and (then) pushes it to the client's service.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Linking, ActivityIndicator } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { generatePlaylist, spotifyQuerySeeds, type Service, type GenParams, type Playlist } from '../../src/lib/music';
import { connectSpotify, spotifyStatus, spotifyDisconnect, createSpotifyPlaylist, spotifySearchTracks } from '../../src/lib/spotify';

const SERVICES: { id: Service; name: string; ico: string; note: string }[] = [
 { id: 'apple', name: 'Apple Music', ico: '', note: 'Plays natively on your iPhone' },
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

function Seg({ children }: { children: React.ReactNode }) {
 const t = useTheme();
 return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>{children}</View>;
}
function Chip({ on, label, onPress, t }: { on: boolean; label: string; onPress: () => void; t: Theme }) {
 return (
 <Pressable onPress={onPress} style={{ paddingHorizontal: 15, paddingVertical: 9, borderRadius: 20, backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
 <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
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
   if (id !== 'spotify') { setConn((p) => ({ ...p, apple: !p.apple })); return; }
   if (conn.spotify) { await spotifyDisconnect(); setConn((p) => ({ ...p, spotify: false })); setSpotifyName(undefined); return; }
   setSpotifyBusy(true);
   try { const r = await connectSpotify(); setConn((p) => ({ ...p, spotify: true })); setSpotifyName(r.name); }
   catch (e) { Alert.alert('Spotify', (e && e.message) || 'Could not connect.'); }
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
 setPl({ ...base, subtitle: base.subtitle + ' \u00b7 from your Spotify', tracks: found.map((f) => ({ title: f.title, artist: f.artist, bpm: 0, energy, genre: 'Spotify' })) });
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
   } catch (e) { Alert.alert('Spotify', (e && e.message) || 'Could not save the playlist.'); }
   finally { setSpotifyBusy(false); }
   return;
 }
 if (conn.apple) { Alert.alert('Apple Music', 'Apple Music saving uses MusicKit, which arrives with the Apple Music connect. For now, tap a track to open it.'); return; }
 Alert.alert('Connect a service', 'Connect Spotify above to save this playlist to your account.');
 };

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.back()} style={{ marginBottom: 8 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
 <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Music &amp; Playlists</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Link your music and let the AI build a playlist matched to your workout — the right energy for every set.</Text>

 <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 10, textTransform: 'capitalize' }}>Your Music</Text>
 <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, overflow: 'hidden', marginBottom: 20 }}>
 {SERVICES.map((s, i) => (
 <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.ring }}>
 <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="play" size={18} color={t.brand} /></View>
 <View style={{ flex: 1 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{s.name}</Text>
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{s.note}</Text>
 </View>
 <Pressable onPress={() => toggleService(s.id)} disabled={s.id === 'spotify' && spotifyBusy}
 style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, minWidth: 96, alignItems: 'center', backgroundColor: conn[s.id] ? t.surface2 : t.brand, borderWidth: 1, borderColor: conn[s.id] ? t.ring : t.brand }}>
 {s.id === 'spotify' && spotifyBusy ? <ActivityIndicator color={t.brandInk} size="small" /> : <Text numberOfLines={1} style={{ color: conn[s.id] ? t.ink : t.brandInk, fontWeight: '700', fontSize: 13 }}>{conn[s.id] ? ((s.id === 'spotify' && spotifyName) ? spotifyName : 'Connected') : 'Connect'}</Text>}
 </Pressable>
 </View>
 ))}
 </View>

 <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 10, textTransform: 'capitalize' }}>Build For</Text>
 <Seg>{MODES.map((m) => <Chip key={m.id} on={mode === m.id} label={m.label} onPress={() => setMode(m.id)} t={t} />)}</Seg>
 <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Intensity</Text>
 <Seg>{INTENSITY.map((x) => <Chip key={x.v} on={intensity === x.v} label={x.label} onPress={() => setIntensity(x.v)} t={t} />)}</Seg>
 <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Length</Text>
 <Seg>{DURATIONS.map((d) => <Chip key={d} on={minutes === d} label={`${d} min`} onPress={() => setMinutes(d)} t={t} />)}</Seg>

 <Pressable onPress={() => generate(salt + 1)} disabled={genBusy} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 18, opacity: genBusy ? 0.7 : 1, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
 {genBusy ? <ActivityIndicator color={t.brandInk} size="small" /> : null}
 <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>{genBusy ? 'Finding songs…' : pl ? '↻ Regenerate playlist' : ' Generate workout playlist'}</Text>
 </Pressable>

 {pl ? (
 <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 18 }}>
 <Text style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>{pl.title}</Text>
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2, marginBottom: 14 }}>{pl.subtitle}</Text>
 {pl.tracks.map((tr, i) => (
 <Pressable key={i} onPress={() => openInSpotify(`${tr.title} ${tr.artist}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.ring }}>
 <Text style={{ color: t.ink3, fontSize: 12, width: 20, fontVariant: ['tabular-nums'] }}>{i + 1}</Text>
 <View style={{ flex: 1 }}>
 <Text style={{ color: t.ink, fontWeight: '600', fontSize: 14 }}>{tr.title}</Text>
 <Text style={{ color: t.ink3, fontSize: 12 }}>{tr.artist}</Text>
 </View>
 <View style={{ alignItems: 'flex-end' }}>
 <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '600' }}>{tr.bpm > 0 ? tr.bpm + ' bpm' : (tr.genre || '')}</Text>
 <Text style={{ color: t.brand, fontSize: 10, letterSpacing: 1 }}>{tr.bpm > 0 ? '\u25cf'.repeat(tr.energy) : ''}</Text>
 </View>
 <Text style={{ color: t.brand, fontSize: 15 }}>▶</Text>
 </Pressable>
 ))}
 <Pressable onPress={() => pl.tracks[0] && openInSpotify(`${pl.tracks[0].title} ${pl.tracks[0].artist}`)} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 }}>
 <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>▶ Play In Spotify</Text>
 </Pressable>
 <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
 <Pressable onPress={push} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}> Save To Account</Text>
 </Pressable>
 <Pressable onPress={() => { const ni = (intensity < 3 ? intensity + 1 : intensity) as 1 | 2 | 3; setIntensity(ni); generate(salt + 1, ni); }} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Harder </Text>
 </Pressable>
 </View>
 <Text style={{ color: t.ink3, fontSize: 11, textAlign: 'center', marginTop: 10 }}>Tap any track to play it in Spotify. Connect Spotify above, then Save adds the whole playlist to your account.</Text>
 </View>
 ) : (
 <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 24, alignItems: 'center' }}>
 <Icon name="play" size={34} color={t.ink3} />
 <Text style={{ color: t.ink3, fontSize: 13, marginTop: 8, textAlign: 'center' }}>Pick a workout type and tap Generate — the AI matches track tempo and energy to your session.</Text>
 </View>
 )}
 </ScrollView>
 </SafeAreaView>
 );
}
