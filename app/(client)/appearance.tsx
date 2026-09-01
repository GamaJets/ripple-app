// Appearance — how this app looks, and how much of that the phone decides.
//
// ── What this screen used to be, and why that was the defect ──────────────
//
// Ten palettes and nothing else. `useColorScheme` appeared nowhere in the app,
// so a member whose phone had been in Light Mode for two years opened Repple
// into a dark screen and stayed there; `app.json`'s `userInterfaceStyle:
// automatic` governs native chrome and nothing this app draws. There was no
// higher-contrast option and nothing about text size. Which matters because of
// WHY people come here: Appearance is the screen somebody opens when something
// is hard to read, and the only thing it could offer them was a different hue.
//
// It now carries the three things a person actually came for, in the order
// they matter:
//
//   Match System   the phone decides light or dark, and the palette follows
//                  through the counterpart mapping in src/theme/tokens.ts.
//   Higher Contrast  the two quiet inks come up to the two loudest. No colour
//                  is invented — see `highContrast` in tokens.ts for why that
//                  is the whole point.
//   Text Size      REPORTED, not offered. The phone already has this setting
//                  and the app already follows it; what was missing was any
//                  acknowledgement that it does, and any admission of the one
//                  place it cannot follow all the way.
//
// The palette list stays where it was, below all three, because a hue is a
// preference and the three above it are legibility.
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme, useThemeControls } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, fontScale } from '../../src/theme/scale';
import { metaByKey, paletteForScheme, type Theme } from '../../src/theme/tokens';
import { fontScaleNote } from '../../src/lib/typeScale';
import { switchLabel } from '../../src/lib/a11y';

/**
 * A real switch, announced as one. Copied in shape from the Toggle on
 * app/(client)/settings.tsx and for the same reason it exists there: a
 * coloured pill with a dot on one side carries its entire state in colour and
 * position, which is nothing a screen reader can read. 48 × 28 is under 44 on
 * both axes, and the slop moves the boundary without moving the drawing.
 */
function Toggle({ t, on, onPress, label }: { t: Theme; on: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={switchLabel(label, on)}
      hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
      style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface3, justifyContent: 'center', padding: 3 }}>
      <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: on ? 'flex-end' : 'flex-start' }} />
    </Pressable>
  );
}

/** The little two-tone theme swatch, at whichever palette it is showing. */
function Swatch({ th }: { th: Theme }) {
  return (
    <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: th.bg, borderWidth: hairline, borderColor: th.ring, overflow: 'hidden', flexDirection: 'row', alignItems: 'flex-end' }}>
      <View style={{ flex: 1, height: '55%', backgroundColor: th.surface }} />
      <View style={{ width: 16, height: 16, borderRadius: radius.pill, backgroundColor: th.brand, margin: 5 }} />
    </View>
  );
}

function SettingRow({
  t, title, note, right, first, onPress, a11y,
}: {
  t: Theme; title: string; note?: string; right?: React.ReactNode; first?: boolean;
  onPress?: () => void; a11y?: string;
}) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{title}</Text>
        {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{note}</Text> : null}
      </View>
      {right}
    </View>
  );
  return onPress
    ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y || title}>{body}</Pressable>
    : body;
}

export default function Appearance() {
  const t = useTheme();
  const router = useRouter();
  const { palette, setPalette, palettes, follow, setFollow, contrast, setContrast, scheme, shownPalette } = useThemeControls();

  // What Match System would show right now. Read even when the follow is off,
  // because the row that offers it should say what it is offering rather than
  // making somebody turn it on to find out.
  const wouldShow = metaByKey(paletteForScheme(palette, scheme));
  const sizeNote = fontScaleNote(fontScale);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Account</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Appearance</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>How this app looks, and how much of it your phone decides. Everything here applies instantly.</Text>

        <Rule />

        <Section>
          <SectionHead title="Reading" />

          <SettingRow
            t={t} first
            title="Match System"
            note={scheme
              ? `Your phone is in ${scheme} mode, so this shows ${wouldShow.name}.`
              : 'Your phone has not said whether it is in light or dark mode, so nothing changes until it does.'}
            right={<Toggle t={t} on={follow} onPress={() => setFollow(!follow)} label="Match system" />}
          />

          <SettingRow
            t={t}
            title="Higher Contrast"
            note="Quiet text, the captions and units and section titles, is drawn in the strongest ink this palette has instead of its faintest."
            right={<Toggle t={t} on={contrast} onPress={() => setContrast(!contrast)} label="Higher contrast" />}
          />

          {/* Text size is REPORTED. The phone owns it, this app follows it, and
              offering a second slider here would mean a member who had already
              set their text size once for every app they own having to find and
              set it again for this one. What was missing was never a control,
              it was the app saying anything at all about the setting. */}
          <SettingRow
            t={t}
            title="Text Size"
            note={sizeNote
              ? `${sizeNote} Everything on every screen is laid out around it.`
              : `Text follows your phone's setting. Change it in ${Platform.OS === 'ios' ? 'Settings, then Display & Brightness, then Text Size' : 'Settings, then Display, then Font size'} and this app follows.`}
          />
          {/* The one place the app cannot follow all the way, said here rather
              than found as a row of ellipses along the bottom of the screen. */}
          <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
            The five tab names along the bottom share the width of the phone, so at the largest text sizes they shorten. Their icons do not change, and neither does what each one says out loud.
          </Flag>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Palette" note={String(palettes.length)} />
          {follow ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
              Match System is on, so the app is showing {metaByKey(shownPalette).name} right now. Picking one below turns the matching off and keeps that palette in both modes.
            </Text>
          ) : null}
          {palettes.map((p, i) => {
            // The tick marks what is CHOSEN, not what is drawn. Under Match
            // System those differ, and marking the drawn one would tell a
            // member they had picked Clinical Light when they had picked
            // Elevated Teal and their phone had picked the rest.
            const on = p.key === palette;
            const th = p.theme;
            return (
              <Pressable key={p.key} onPress={() => setPalette(p.key)} accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.light ? 'light' : 'dark'} theme`} accessibilityState={{ selected: on }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <Swatch th={th} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: on ? '600' : '500', color: t.ink }}>{p.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 1 }}>
                    {p.light ? 'Light theme' : 'Dark theme'}
                    {follow && on && p.key !== shownPalette ? ` · showing ${metaByKey(shownPalette).name}` : ''}
                  </Text>
                </View>
                {on ? <Icon name="check" size={19} color={t.brand} /> : null}
              </Pressable>
            );
          })}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
