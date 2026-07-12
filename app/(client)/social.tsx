// Share & Social — connect Instagram / TikTok and share progress cards.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';

const NETWORKS = [
 { id: 'instagram', name: 'Instagram', ico: 'IG', note: 'Share to your Story or feed' },
 { id: 'tiktok', name: 'TikTok', ico: 'TT', note: 'Post progress clips' },
 { id: 'facebook', name: 'Facebook', ico: 'f', note: 'Share to timeline' },
 { id: 'x', name: 'X', ico: 'X', note: 'Post an update' },
];

export default function Social() {
 const t = useTheme();
 const router = useRouter();
 const cd = useClientData();
 const [conn, setConn] = useState<Record<string, boolean>>({ instagram: false, tiktok: false, facebook: false, x: false });

 const first = cd.scans[0];
 const latest = cd.scans[cd.scans.length - 1];
 const bfDrop = first && latest ? Math.round((first.bodyFatPct - latest.bodyFatPct) * 10) / 10 : 0;
 const wtDrop = first && latest ? Math.round((first.weightKg - latest.weightKg) * 10) / 10 : 0;

 const share = async () => {
 const msg = `My Repple progress — down ${Math.abs(wtDrop)} kg and ${Math.abs(bfDrop)}% body fat so far. Every rep ripples out.`;
 try { await Share.share({ message: msg }); } catch {}
 };

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.back()} style={{ marginBottom: 8 }}><Text style={{ color: t.ink3, fontSize: 15 }}>‹ Back</Text></Pressable>
 <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', textTransform: 'capitalize' }}>Share & Social</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Connect your accounts and share your story — you’re always in control of what goes out.</Text>

 <View style={{ backgroundColor: t.brand, borderRadius: 20, padding: 20, marginBottom: 18 }}>
 <Text style={{ color: t.brandInk, fontSize: 13, fontWeight: '700', opacity: 0.85 }}>MY PROGRESS · REPPLE</Text>
 <View style={{ flexDirection: 'row', gap: 24, marginTop: 14 }}>
 <View><Text style={{ color: t.brandInk, fontSize: 30, fontWeight: '900' }}>-{wtDrop}<Text style={{ fontSize: 15 }}> kg</Text></Text><Text style={{ color: t.brandInk, opacity: 0.8, fontSize: 12, marginTop: 2 }}>Weight</Text></View>
 <View><Text style={{ color: t.brandInk, fontSize: 30, fontWeight: '900' }}>-{bfDrop}<Text style={{ fontSize: 15 }}> %</Text></Text><Text style={{ color: t.brandInk, opacity: 0.8, fontSize: 12, marginTop: 2 }}>Body fat</Text></View>
 </View>
 <Text style={{ color: t.brandInk, opacity: 0.8, fontSize: 12, marginTop: 14 }}>Every rep ripples out. </Text>
 </View>

 <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 10 }}>Connected accounts</Text>
 <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, overflow: 'hidden', marginBottom: 18 }}>
 {NETWORKS.map((n, i) => (
 <View key={n.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.ring }}>
 <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.brand, fontSize: 15, fontWeight: '800' }}>{n.ico}</Text></View>
 <View style={{ flex: 1 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>{n.name}</Text>
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{n.note}</Text>
 </View>
 <Pressable onPress={() => setConn((p) => ({ ...p, [n.id]: !p[n.id] }))}
 style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, backgroundColor: conn[n.id] ? t.surface2 : t.brand, borderWidth: 1, borderColor: conn[n.id] ? t.ring : t.brand }}>
 <Text style={{ color: conn[n.id] ? t.ink : t.brandInk, fontWeight: '700', fontSize: 13 }}>{conn[n.id] ? 'Connected' : 'Connect'}</Text>
 </Pressable>
 </View>
 ))}
 </View>

 <Pressable onPress={share} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
 <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Share my progress card</Text>
 </Pressable>
 <Text style={{ color: t.ink3, fontSize: 12, textAlign: 'center', marginTop: 10 }}>Nothing is ever posted automatically. You approve every share.</Text>
 </ScrollView>
 </SafeAreaView>
 );
}
