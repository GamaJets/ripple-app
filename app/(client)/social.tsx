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
//  · TF-37: the weight change was announced in kilograms — on the screen and,
//    worse, in the text the client sends to their friends, who will read it in
//    whatever unit they think in and have no settings screen to consult. It now
//    goes out in the unit the client reads. The body-fat figure beside it stays
//    a percentage, because that is what it is in any unit system.
import { View, Text, ScrollView, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightDeltaIn } from '../../src/lib/units';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, Notice, fig } from '../../src/ui/kit';
import { isWhole } from '../../src/ui/loadStatus';
import { sp, layout, type as ty } from '../../src/theme/scale';

export default function Social() {
 const t = useTheme();
 const router = useRouter();
 const cd = useClientData();
 const wu = useSettings().weightUnit;

 // `cd.scansStatus`, which this screen ignored entirely. It matters more here
 // than anywhere else in the app: every figure below leaves the phone. Under
 // 'error' `cd.scans` is empty and the screen said "Nothing to show yet · Log a
 // second body scan" to somebody with twenty; under 'partial' `scans[0]` is not
 // the member's FIRST scan, it is the oldest one that fitted in the read — and
 // the whole premise of this screen, stated in its own heading, is "Since Your
 // First Scan". A wrong figure in a share is not a display bug: it is posted,
 // and it stays posted.
 const scansWhole = isWhole(cd.scansStatus);
 const first = cd.scans[0];
 const latest = cd.scans[cd.scans.length - 1];
 const bfDrop = first && latest ? Math.round((first.bodyFatPct - latest.bodyFatPct) * 10) / 10 : 0;
 const wtDrop = first && latest ? Math.round((first.weightKg - latest.weightKg) * 10) / 10 : 0;
 // The change read out in the client's unit. It is converted as one span and
 // rounded once at the end — rounding the first and latest scans into pounds
 // and subtracting those would let half a pound of rounding on each end turn a
 // real 0.4 kg loss into nothing, or into two pounds.
 // Always finite here, so the null branch of weightDeltaIn is unreachable.
 const wtDropShown = weightDeltaIn(wtDrop, wu) ?? 0;
 // Two scans are the minimum that can describe a change. One (or none) is not
 // progress, and printing a zero here would read as one.
 const measured = scansWhole && cd.scans.length >= 2;

 const share = async () => {
 const msg = measured
 ? `My Repple progress — ${wtDropShown >= 0 ? 'down' : 'up'} ${Math.abs(wtDropShown)} ${wu} and ${bfDrop >= 0 ? 'down' : 'up'} ${Math.abs(bfDrop)}% body fat so far. Every rep ripples out.`
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
 label={wtDropShown >= 0 ? 'Weight Down' : 'Weight Up'}
 figure={Math.abs(wtDropShown).toString()}
 unit={wu}
 note={`Body fat ${bfDrop >= 0 ? 'down' : 'up'} ${Math.abs(bfDrop)}% across ${cd.scans.length} scans`}
 />
 ) : (
 !scansWhole && cd.scansStatus !== 'loading' ? (
 <View style={{ marginTop: sp.lg }}>
  <Notice tone={t.warn} kicker="Your progress"
   title={cd.scansStatus === 'error' ? 'We couldn’t read your scans' : 'Not all of your scans could be read'}
   note={cd.scansStatus === 'error'
    ? 'There is nothing to share from this screen right now, and that is a fault here rather than an absence in your record. Your scans are safe.'
    : 'You have more scans on record than can be read in one go, and "since your first scan" means the first one — which may not be among them. A figure that would go into a post has to be the right one, so none is offered.'} />
 </View>
 ) : (
 <View style={{ paddingTop: sp.xxl, paddingBottom: sp.xl }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>Your progress</Text>
 <Text style={{ ...ty.head, color: t.ink, marginTop: sp.sm }}>
  {cd.scansStatus === 'loading' ? 'Reading your scans…' : 'Nothing to show yet'}
 </Text>
 <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
 Log a second body scan and the change between your first and your latest appears here — and in anything you share.
 </Text>
 </View>
 )
 )}

 <Rule />

 {measured ? (<>
 <Section>
 <SectionHead title="Since Your First Scan" />
 <KpiRow items={[
 { label: 'Weight', value: `${wtDropShown >= 0 ? '−' : '+'}${Math.abs(wtDropShown)}`, unit: wu },
 { label: 'Body Fat', value: `${bfDrop >= 0 ? '−' : '+'}${Math.abs(bfDrop)}`, unit: '%' },
 { label: 'Scans', value: fig(cd.scans.length) },
 ]} />
 </Section>
 <Rule />
 </>) : null}

 <Section>
 <SectionHead title="How Sharing Works" />
 <Text style={{ ...ty.body, color: t.ink2 }}>
 Sharing opens your phone's own share sheet, so it goes wherever you send it — a story, a post, a message to one person. Repple has no posting access to any account: nothing is ever posted automatically, and you approve every share.
 </Text>
 </Section>

 <Rule />

 <Section>
 <Cta label={measured ? 'Share My Progress' : 'Share Repple'} wide onPress={share} />
 </Section>

 </ScrollView>
 </SafeAreaView>
 );
}
