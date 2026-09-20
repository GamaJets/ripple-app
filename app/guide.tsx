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
import type { Theme } from '../src/theme/tokens';
import { Section, Ghost, PageHead, HeroCard, Expandable, IconPlate, type Tone } from '../src/ui/kit';
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

/**
 * One section, whichever list it came from. The two are rendered identically on
 * purpose — the difference between them is where they sit and what the kicker
 * above them says, not how important they are.
 *
 * A module-scope PLAIN FUNCTION, called as `{block(s, t)}`, and not a component
 * written as `<Block s={s} />`. Declared inside the screen body it was a new
 * function object on every render, so React saw a different element TYPE each
 * time and threw away every section of the guide rather than updating it. This
 * screen is static reference text and re-renders rarely, so what that cost was
 * work and a subtree that could hold no scroll or animation state — not a lost
 * caret and not a wrong figure. The rule is the one stated at
 * app/(client)/report.tsx:475 and enforced by scripts/check-remount.mjs.
 *
 * At module scope because it closes over nothing from the render body: the
 * sections come in as an argument and the theme is passed.
 *
 * The `key` is on the View this RETURNS. It used to sit on `<Block key={s.title}
 * …/>`; a plain call cannot carry one, and dropping it would cost React the
 * identity of both lists — a quieter bug than the one being fixed here.
 */
// Folded now: the title and its one-line summary are the row, and the points
// open under it on toned plates. Six tabs and every cross-app topic, all open,
// was a wall a reader had to scroll to find one thing in; this is a list they
// can scan. The kit's `Expandable` keeps its own open state, which is exactly
// what the remount bug above would have thrown away on every render.
const block = (s: GuideSection, t: Theme, tone: Tone) => (
  <Expandable key={s.title} title={s.title} note={s.summary}>
    {s.points.map((p, i) => (
      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: i === s.points.length - 1 ? 0 : sp.md }}>
        <IconPlate icon="check" tone={tone} size={32} />
        <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{p}</Text>
      </View>
    ))}
  </Expandable>
);

export default function Guide() {
  const t = useTheme();
  const router = useRouter();
  const tabs = tabsFor(VARIANT);
  const topics = topicsFor(VARIANT);

  // Opening it is reading it, as far as the checklist is concerned. Anything
  // finer — scrolled to the end, spent thirty seconds — would be measuring
  // attention, which this app has no business doing and no way to do honestly.
  useEffect(() => { AsyncStorage.setItem(GUIDE_SEEN_KEY, '1').catch(() => {}); }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 48 }}>
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
        {/* The kit's pushed-page head — the round back control on the
            leading edge — and then the night hero that says whose guide this
            is, with the app's own introduction as its one line. */}
        <PageHead title="User Guide" />
        <HeroCard eyebrow="USER GUIDE" title={VARIANT_LABEL[VARIANT]} meta={GUIDE_INTRO[VARIANT]} />


        {/* marginTop to match "Across the app" below. Without it this kicker
            sat hard against the rule above it and read as part of the header
            paragraph rather than as the label on the list under it. */}
        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>The tabs</Text>
        {tabs.map((s) => block(s, t, 'brand'))}

        {topics.length ? (
          <>
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Across the app</Text>
            {topics.map((s) => block(s, t, 'blue'))}
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
