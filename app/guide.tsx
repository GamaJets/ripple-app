// In-app user guide — the reference version of the first-run tour.
//
// Testers asked for two different things and this is the second: "a user guide
// built so it is in the app so users can reference it in the future." The tour
// runs once; this stays.
//
// Both still read from one source (src/lib/guideContent.ts), so the guide can
// never describe the app differently from the tour. What differs is how much of
// it each one shows: the tour takes the tabs, trimmed; this screen shows every
// point of every tab and then the sections that are not a tab at all — the ones
// somebody actually opens a guide to look up.
//
// The two lists are separated by a heading rather than run together, because a
// section headed "Injuries" sitting in a list of tab names reads as a tab that
// has gone missing from the bar.
//
// The tour is reopened from the foot of this screen, which is where its own
// closing sentence has always said it would be.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../src/ui/components';
import { Rule, Section, SectionHead, Ghost } from '../src/ui/kit';
import { sp, layout, type as ty } from '../src/theme/scale';
import { VARIANT, VARIANT_LABEL } from '../src/lib/variant';
import { tabsFor, topicsFor, GUIDE_INTRO, type GuideSection } from '../src/lib/guideContent';

/**
 * That this screen has been opened. Read by app/(client)/getting-started.tsx,
 * which lists reading the guide as one of the things worth doing and has to be
 * able to tick it off.
 *
 * Device-local, like every other mark in that list that is not on the account.
 * A member who reads the guide on their phone and then signs in on a tablet is
 * offered it again there, which costs one row and is the right way round: the
 * alternative is a column on `clients` for whether somebody read a help screen.
 */
export const GUIDE_SEEN_KEY = 'repple.guide.seen';

export default function Guide() {
  const t = useTheme();
  const router = useRouter();
  const tabs = tabsFor(VARIANT);
  const topics = topicsFor(VARIANT);

  // Opening it is reading it, as far as the checklist is concerned. Anything
  // finer — scrolled to the end, spent thirty seconds — would be measuring
  // attention, which this app has no business doing and no way to do honestly.
  useEffect(() => { AsyncStorage.setItem(GUIDE_SEEN_KEY, '1').catch(() => {}); }, []);

  // One section, whichever list it came from. The two are rendered identically
  // on purpose — the difference between them is where they sit and what the
  // kicker above them says, not how important they are.
  const Block = ({ s }: { s: GuideSection }) => (
    <View>
      <Section>
        <SectionHead title={s.title} />
        <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.md }}>{s.summary}</Text>
        {s.points.map((p, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.sm }}>
            <Text style={{ ...ty.body, color: t.brand }}>•</Text>
            <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{p}</Text>
          </View>
        ))}
      </Section>
      <Rule />
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: 48 }}>
        {/* ── the way out ──────────────────────────────────────────────────
            Seen on an iPhone 17 Pro: this screen had no back control at all.
            It is pushed from the Profile tab, it hides the tab bar, and the
            only control that leaves it was the "Done" ghost at the foot of a
            scroll that is six tab sections plus every cross-app topic long. A
            reader who opened the guide to look one thing up had to scroll past
            the whole of it to get out of it, or kill the app.

            Leading edge with an a11yLabel, which is the house form — see
            src/ui/FeedbackScreen.tsx for the argument. "Done" stays where it
            is: somebody who read to the end should not have to scroll back. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>User guide</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 2 }}>{VARIANT_LABEL[VARIANT]}</Text>
          </View>
        </View>
        {/* marginBottom, not nothing. The rule below sat on the last line of
            this paragraph — a hairline touching descenders reads as an
            underline on the sentence rather than as the end of the header. */}
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }}>{GUIDE_INTRO[VARIANT]}</Text>

        <Rule />

        {/* marginTop to match "Across the app" below. Without it this kicker
            sat hard against the rule above it and read as part of the header
            paragraph rather than as the label on the list under it. */}
        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>The tabs</Text>
        {tabs.map((s) => <Block key={s.title} s={s} />)}

        {topics.length ? (
          <>
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Across the app</Text>
            {topics.map((s) => <Block key={s.title} s={s} />)}
          </>
        ) : null}

        {/* The tour's own last card says "You can reopen this any time from the
            user guide." Nothing here offered that: /tour was reachable only from
            app/index.tsx on the first launch of an install, so the sentence was
            false the moment somebody went looking for it. This is the control it
            was promising. */}
        <Section style={{ alignItems: 'center', gap: sp.sm }}>
          <Ghost label="Take the Tour Again" onPress={() => router.push('/tour')} />
          <Ghost label="Done" onPress={() => router.back()} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
