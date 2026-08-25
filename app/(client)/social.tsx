// Client · Share & social — share real progress from the client's own scans.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero was forced anywhere it didn't belong: the change
// since the first scan *is* the live figure, so it leads.
//
// Removed as fabricated state: a `NETWORKS` list (Instagram, TikTok, Facebook,
// X) whose "Connect" button flipped a local boolean and relabelled itself
// "Connected". Nothing was linked, no token was stored, nothing else in the app
// read the flag, and it reset on relaunch — an account connection the client
// never made. Sharing has always gone through the OS share sheet, which is what
// the screen now says.
//
// Two further corrections:
//  · with fewer than two scans the card printed "−0 kg / −0 %" — a zero
//    pretending to be data. It now says there is nothing to show yet.
//  · the share text said "down X kg" even when the client had gained; the
//    direction is now taken from the sign instead of being assumed.
import { View, Text, ScrollView, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, type as ty } from '../../src/theme/scale';

export default function Social() {
 const t = useTheme();
 const router = useRouter();
 const cd = useClientData();

 const first = cd.scans[0];
 const latest = cd.scans[cd.scans.length - 1];
 const bfDrop = first && latest ? Math.round((first.bodyFatPct - latest.bodyFatPct) * 10) / 10 : 0;
 const wtDrop = first && latest ? Math.round((first.weightKg - latest.weightKg) * 10) / 10 : 0;
 // Two scans are the minimum that can describe a change. One (or none) is not
 // progress, and printing a zero here would read as one.
 const measured = cd.scans.length >= 2;

 const share = async () => {
 const msg = measured
 ? `My Repple progress — ${wtDrop >= 0 ? 'down' : 'up'} ${Math.abs(wtDrop)} kg and ${bfDrop >= 0 ? 'down' : 'up'} ${Math.abs(bfDrop)}% body fat so far. Every rep ripples out.`
 : 'I train with Repple. Every rep ripples out.';
 try { await Share.share({ message: msg }); } catch {}
 };

 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
 <Ghost icon="back" onPress={() => router.back()} />
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>Your story, your call</Text>
 <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Share</Text>
 </View>
 </View>

 {measured ? (
 <Hero
 label={wtDrop >= 0 ? 'Weight down' : 'Weight up'}
 figure={Math.abs(wtDrop).toString()}
 unit="kg"
 note={`Body fat ${bfDrop >= 0 ? 'down' : 'up'} ${Math.abs(bfDrop)}% across ${cd.scans.length} scans`}
 />
 ) : (
 <View style={{ paddingTop: sp.xxl, paddingBottom: sp.xl }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>Your progress</Text>
 <Text style={{ ...ty.head, color: t.ink, marginTop: sp.sm }}>Nothing to show yet</Text>
 <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
 Log a second body scan and the change between your first and your latest appears here — and in anything you share.
 </Text>
 </View>
 )}

 <Rule />

 {measured ? (<>
 <Section>
 <SectionHead title="Since your first scan" />
 <KpiRow items={[
 { label: 'Weight', value: `${wtDrop >= 0 ? '−' : '+'}${Math.abs(wtDrop)}`, unit: 'kg' },
 { label: 'Body fat', value: `${bfDrop >= 0 ? '−' : '+'}${Math.abs(bfDrop)}`, unit: '%' },
 { label: 'Scans', value: fig(cd.scans.length) },
 ]} />
 </Section>
 <Rule />
 </>) : null}

 <Section>
 <SectionHead title="How sharing works" />
 <Text style={{ ...ty.body, color: t.ink2 }}>
 Sharing opens your phone's own share sheet, so it goes wherever you send it — a story, a post, a message to one person. Repple has no posting access to any account: nothing is ever posted automatically, and you approve every share.
 </Text>
 </Section>

 <Rule />

 <Section>
 <Cta label={measured ? 'Share my progress' : 'Share Repple'} wide onPress={share} />
 </Section>

 </ScrollView>
 </SafeAreaView>
 );
}
