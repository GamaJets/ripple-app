// Music & Playlists — connect Spotify / Apple Music and let the AI build a
// workout-matched playlist. Live OAuth/MusicKit linking lands in the backend
// phase; this builds the list and (then) pushes it to the client's service.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { generatePlaylist, type Service, type GenParams, type Playlist } from '../../src/lib/music';

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

 const anyConnected = conn.apple || conn.spotify;
 const openInSpotify = (q: string) => { Linking.openURL('https://open.spotify.com/search/' + encodeURIComponent(q)).catch(() => Alert.alert('Open Spotify', 'Install the Spotify app, then search "' + q + '".')); };

 const generate = (nextSalt = salt) => {
 setSalt(nextSalt);
 setPl(generatePlaylist({ mode, intensity, minutes }, nextSalt));
 };

 const push = () => {
 const to = SERVICES.filter((s) => conn[s.id]).map((s) => s.name);
 if (!to.length) { Alert.alert('Connect a service', 'Turn on Apple Music or Spotify above to save this playlist.'); return; }
 Alert.alert('Playlist ready', `Saving "${pl?.title}" to ${to.join(' & ')}.\n\nLive linking to your ${to.join('/')} account arrives with the backend rollout — the list is built and ready to push.`);
 };

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.push('/(client)/profile')} style={{ marginBottom: 8 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
 <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Music &amp; Playlists</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Link your music and let the AI build a playlist matched to your workout — the right energy for every set.</Text>

 <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 10, textTransform: 'capitalize' }}>Your Music</Text>
 <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, overflow: 'hidden', marginBottom: 20 }}>
 {SERVICES.map((s, i) => (
 <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.ring }}>
 <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 20 }}>{s.ico}</Text></View>
 <View style={{ flex: 1 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{s.name}</Text>
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{s.note}</Text>
 </View>
 <Pressable onPress={() => setConn((p) => ({ ...p, [s.id]: !p[s.id] }))}
 style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, backgroundColor: conn[s.id] ? t.surface2 : t.brand, borderWidth: 1, borderColor: conn[s.id] ? t.ring : t.brand }}>
 <Text style={{ color: conn[s.id] ? t.ink : t.brandInk, fontWeight: '700', fontSize: 13 }}>{conn[s.id] ? 'Connected' : 'Connect'}</Text>
 </Pressable>
 </View>
 ))}
 </View>

 <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 10, textTransform: 'capitalize' }}>Build For</Text>
 <Seg>{MODES.map((m) => <Chip key={m.id} on={mode === m.id} label={`${m.ico} ${m.label}`} onPress={() => setMode(m.id)} t={t} />)}</Seg>
 <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Intensity</Text>
 <Seg>{INTENSITY.map((x) => <Chip key={x.v} on={intensity === x.v} label={x.label} onPress={() => setIntensity(x.v)} t={t} />)}</Seg>
 <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Length</Text>
 <Seg>{DURATIONS.map((d) => <Chip key={d} on={minutes === d} label={`${d} min`} onPress={() => setMinutes(d)} t={t} />)}</Seg>

 <Pressable onPress={() => generate(salt + 1)} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 18 }}>
 <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>{pl ? '↻ Regenerate playlist' : ' Generate workout playlist'}</Text>
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
 <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '600' }}>{tr.bpm} bpm</Text>
 <Text style={{ color: t.ink3, fontSize: 11 }}>{''.repeat(tr.energy)}</Text>
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
 <Pressable onPress={() => { setIntensity((v) => (v < 3 ? ((v + 1) as 1 | 2 | 3) : v)); generate(salt + 1); }} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Harder </Text>
 </Pressable>
 </View>
 <Text style={{ color: t.ink3, fontSize: 11, textAlign: 'center', marginTop: 10 }}>Tap any track to play it in Spotify. Saving the full playlist to your account arrives with the Spotify connect.</Text>
 </View>
 ) : (
 <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 24, alignItems: 'center' }}>
 <Text style={{ fontSize: 34 }}></Text>
 <Text style={{ color: t.ink3, fontSize: 13, marginTop: 8, textAlign: 'center' }}>Pick a workout type and tap Generate — the AI matches track tempo and energy to your session.</Text>
 </View>
 )}
 </ScrollView>
 </SafeAreaView>
 );
}
