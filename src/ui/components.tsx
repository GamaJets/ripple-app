// Shared UI primitives + the live theme. The theme is one of 10 palettes
// (Elevated Teal default), selectable by client & trainer. An optional accent
// override sits on top for owner white-labelling. Both persist.
import { ReactNode, createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, Pressable, TextInput, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  paletteByKey, paletteForScheme, highContrast, brandInkFor,
  DEFAULT_PALETTE, PALETTES, teal, type Theme, type PaletteMeta,
} from '../theme/tokens';
import { VARIANT, VARIANT_ACCENT } from '../lib/variant';
import { Icon } from './Icon';
import { passwordRules } from '../lib/passwordRules';
import { reportError } from '../lib/reportError';

interface ThemeControls {
  /** The palette the member CHOSE. Not necessarily the one on screen — see
   *  `shownPalette`, which is what the follow resolves it to. */
  palette: string; setPalette: (k: string) => void;
  accent: string | null; setAccent: (c: string | null) => void;
  /** Follow the phone between light and dark. */
  follow: boolean; setFollow: (v: boolean) => void;
  /** Bring the two quiet inks up to the two loudest. See `highContrast`. */
  contrast: boolean; setContrast: (v: boolean) => void;
  /** What the phone says right now, or null when it will not say. */
  scheme: 'light' | 'dark' | null;
  /** The palette actually being drawn, once the follow has had its say. */
  shownPalette: string;
  palettes: PaletteMeta[]; theme: Theme;
}
const ThemeCtx = createContext<ThemeControls | null>(null);

/**
 * The live theme.
 *
 * ── What this used to do, and why it was a defect ─────────────────────────
 *
 * It started at a fixed DEFAULT_PALETTE — a dark one — and stayed there
 * forever. `useColorScheme` appeared nowhere in the app, and `app.json`'s
 * `userInterfaceStyle: automatic` governs native chrome only, so a member
 * whose phone had been in Light Mode since the day they bought it opened this
 * app into a dark screen and had no way to change that except knowing that
 * Appearance existed and that three of its ten hues happened to be light.
 * Appearance was the one screen a person visits BECAUSE something is hard to
 * read, and all it changed was hue.
 *
 * ── The three settings and how they compose ───────────────────────────────
 *
 *   follow      derives the palette from the phone's scheme, through the
 *               counterpart mapping in tokens.ts. The member's stored choice
 *               is never rewritten, so going light and back is lossless.
 *   accent      an explicit brand colour, white-label. Wins over the variant.
 *   contrast    applied LAST, and only to the inks, so it cannot undo the
 *               measured ink-on-brand decision `brandInkFor` just made.
 *
 * ── What "not chosen" defaults to ─────────────────────────────────────────
 *
 * Follow is ON for anybody who has never picked a palette, and OFF the moment
 * they do — picking Sunset means you want Sunset, not "surprise me twice a
 * day". Both are stored, so a member who wants the follow back gets it by
 * choosing Match System in Appearance.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [palette, setPaletteState] = useState<string>(DEFAULT_PALETTE);
  const [accent, setAccentState] = useState<string | null>(null);
  const [follow, setFollowState] = useState<boolean>(true);
  const [contrast, setContrastState] = useState<boolean>(false);
  // Re-renders on its own when the phone flips, including while the app is in
  // the foreground, which is the whole point: the member changes the setting
  // from Control Centre and comes back to an app that has already followed.
  // `ColorSchemeName` is 'light' | 'dark' | 'unspecified' | null | undefined,
  // and 'unspecified' means the platform declined to say. It is narrowed to
  // null here rather than treated as light: an unanswered question is not an
  // answer, and `paletteForScheme` leaves the member's own palette alone for it.
  const raw = useColorScheme();
  const scheme: 'light' | 'dark' | null = raw === 'light' || raw === 'dark' ? raw : null;

  useEffect(() => { (async () => {
    try {
      const p = await AsyncStorage.getItem('repple.palette');
      const a = await AsyncStorage.getItem('repple.accent.v2');
      const f = await AsyncStorage.getItem('repple.theme.follow');
      const c = await AsyncStorage.getItem('repple.theme.contrast');
      if (p) setPaletteState(p);
      if (a) setAccentState(a);
      // A member with a stored palette and no stored follow chose that palette
      // before this setting existed. Honouring it is the only reading of their
      // choice that does not change the app under them on upgrade.
      setFollowState(f != null ? f === '1' : p == null);
      setContrastState(c === '1');
    } catch (e) {
      // Four preferences, and a read that fails leaves all four at the values
      // above: the default palette, the accent the build ships with, follow-
      // the-system on, and high contrast OFF. That last one is the reason this
      // is reported rather than left silent. A member who turned high contrast
      // on did so because they could not read the app without it, and this is
      // the one failure here that hands them back the version they could not
      // read — with no error to explain it, because there is no honest one to
      // show: the app cannot say "your settings are missing" when it does not
      // know whether any were stored.
      //
      // Nothing is written back on this path. The setters below only run when a
      // member changes a setting, so an unreadable store is never overwritten
      // with these defaults, and the next launch reads the real values again.
      reportError('theme.prefs', e);
    }
  })(); }, []);

  const setPalette = (k: string) => {
    setPaletteState(k); setAccentState(null); setFollowState(false);
    AsyncStorage.setItem('repple.palette', k).catch(() => {});
    AsyncStorage.setItem('repple.theme.follow', '0').catch(() => {});
    AsyncStorage.removeItem('repple.accent.v2').catch(() => {});
  };
  const setAccent = (c: string | null) => {
    setAccentState(c);
    if (c) AsyncStorage.setItem('repple.accent.v2', c).catch(() => {});
    else AsyncStorage.removeItem('repple.accent.v2').catch(() => {});
  };
  const setFollow = (v: boolean) => {
    setFollowState(v);
    AsyncStorage.setItem('repple.theme.follow', v ? '1' : '0').catch(() => {});
  };
  const setContrast = (v: boolean) => {
    setContrastState(v);
    AsyncStorage.setItem('repple.theme.contrast', v ? '1' : '0').catch(() => {});
  };

  const shownPalette = follow ? paletteForScheme(palette, scheme) : palette;
  const base = paletteByKey(shownPalette);

  // Each app is drawn in its own colour. Applied only to the DEFAULT palette:
  // if somebody has deliberately chosen midnight or cream, that is their choice
  // and this must not quietly override it. An explicit accent still wins over
  // both, which is the white-label case a gym uses for its own branding.
  //
  // The test is on the CHOSEN palette, not the shown one. A member on the
  // default who is following their phone into Clinical Light has still not
  // chosen a palette, and the variant colour is still the right mark for their
  // app; `brandInkFor` measures the label against it either way, so the light
  // ground does not cost them a readable button.
  const withVariant: Theme = palette === DEFAULT_PALETTE
    ? { ...base, brand: VARIANT_ACCENT[VARIANT], brandInk: brandInkFor(VARIANT_ACCENT[VARIANT]) }
    : base;

  const branded: Theme = accent
    ? { ...withVariant, brand: accent, brandInk: brandInkFor(accent) }
    : withVariant;
  // ── Why the theme and the four setters are held still ─────────────────────
  //
  // `theme` is built out of spreads, so it used to be a NEW object on every
  // render of this provider — and `useTheme()` is called by very nearly every
  // component in all three apps, most of which build their styles in a
  // `useMemo` keyed on it. A fresh theme is a fresh everything, downstream, for
  // a colour nobody changed. The four setters were plain arrows, so the context
  // value was new on every render too; see src/ui/roster.tsx for what a
  // consumer that keys an effect on such a value ends up doing.
  //
  // The setters go through a ref rather than being frozen in place, because
  // `setPalette` and the rest read this render's state. Freezing them would
  // freeze that state with them, which is the same defect one level down.
  const theme = useMemo<Theme>(() => (contrast ? highContrast(branded) : branded), [contrast, shownPalette, palette, accent]); // eslint-disable-line react-hooks/exhaustive-deps -- `branded` is a pure function of exactly these four
  const impl = useRef({ setPalette, setAccent, setFollow, setContrast });
  impl.current = { setPalette, setAccent, setFollow, setContrast };
  const setPaletteStable = useCallback((...a: Parameters<typeof setPalette>) => impl.current.setPalette(...a), []);
  const setAccentStable = useCallback((...a: Parameters<typeof setAccent>) => impl.current.setAccent(...a), []);
  const setFollowStable = useCallback((...a: Parameters<typeof setFollow>) => impl.current.setFollow(...a), []);
  const setContrastStable = useCallback((...a: Parameters<typeof setContrast>) => impl.current.setContrast(...a), []);
  const value = useMemo<ThemeControls>(() => ({
    palette, setPalette: setPaletteStable, accent, setAccent: setAccentStable,
    follow, setFollow: setFollowStable, contrast, setContrast: setContrastStable,
    scheme, shownPalette, palettes: PALETTES, theme,
  }), [palette, setPaletteStable, accent, setAccentStable, follow, setFollowStable, contrast, setContrastStable, scheme, shownPalette, theme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Theme {
  const c = useContext(ThemeCtx);
  return c ? c.theme : teal;
}
export function useThemeControls(): ThemeControls {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error('useThemeControls must be used inside <AppThemeProvider>');
  return c;
}

/* ── Screen / Card / Tile / Row / Btn used to live here ────────────────────
 *
 * They were this file's original primitives and src/ui/kit.tsx superseded every
 * one of them — Section, ListRow, KpiRow, Ghost and the rest, which 142 files
 * import. Nothing had imported the five since, and `scripts/check-dead-exports.mjs`
 * is what noticed: five exported components in src/ui that no non-test file
 * mentioned. They are deleted rather than kept "in case", because a second set
 * of primitives with the same names as the real ones is how a screen ends up
 * drawn half in each.
 *
 * The `s` StyleSheet went with them — card/tile/row/btn were its only four
 * entries — and so did the whole `../theme/scale` import, whose six names were
 * used by nothing else in this file.
 */

// Password input with a tappable eye toggle so people can check what they
// typed before submitting. `style` should be the same object used for
// sibling TextInputs (e.g. the local `inp` style) — its marginBottom (if any)
// is lifted onto the wrapping View so the eye button stays vertically
// centered on the input itself, not the input+margin box.
export function PasswordField({
  value, onChangeText, placeholder, style, accessibilityLabel, autoFocus,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  style?: Record<string, any>;
  accessibilityLabel?: string;
  autoFocus?: boolean;
}) {
  const t = useTheme();
  const [visible, setVisible] = useState(false);
  const { marginBottom, ...fieldStyle } = style || {};
  return (
    <View style={{ marginBottom: marginBottom ?? 0 }}>
      <View style={{ position: 'relative', justifyContent: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.ink3}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          style={[fieldStyle, { paddingEnd: 44 }]}
          accessibilityLabel={accessibilityLabel}
          autoFocus={autoFocus}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          hitSlop={10}
          style={{ position: 'absolute', end: 12, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={20} color={t.ink3} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The password rules, shown while somebody types rather than after they are
 * refused.
 *
 * Every rule is listed from the start, greyed until met, so the requirement is
 * knowable before the first attempt. The alternative — and what this replaces —
 * was a placeholder claiming "min 6 characters" and a server that refused six
 * characters, then refused again for a missing uppercase, then again for a
 * missing symbol. Three round trips to learn one rule.
 *
 * `note` deliberately stops short of promising acceptance: Supabase also checks
 * the password against a public breach corpus, which cannot be evaluated here.
 */
export function PasswordRules({ value }: { value: string }) {
  const t = useTheme();
  const rules = passwordRules(value);
  const started = (value || '').length > 0;
  return (
    <View style={{ marginTop: 8, marginBottom: 4 }} accessibilityRole="summary"
      accessibilityLabel={`Password needs ${rules.filter((r) => !r.met).map((r) => r.label).join(', ') || 'nothing further'}`}>
      <Text style={{ fontSize: 12, color: t.ink3, marginBottom: 4 }}>Needs:</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {rules.map((r) => (
          <View key={r.label} style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
            backgroundColor: r.met ? (t.good || t.brand) + '22' : t.surface2,
          }}>
            {/* The glyph itself is the channel — a tick or a bullet — and the
                pill behind it still carries the good tint. The 11pt character
                takes ink, because good as text does not clear 4.5:1. */}
            <Text style={{ fontSize: 11, color: r.met ? t.ink2 : t.ink3 }}>
              {r.met ? '✓' : '•'}
            </Text>
            <Text style={{ fontSize: 12, color: r.met ? t.ink2 : t.ink3 }}>{r.label}</Text>
          </View>
        ))}
      </View>
      {started && rules.every((r) => r.met) ? (
        <Text style={{ fontSize: 12, color: t.ink3, marginTop: 6 }}>
          This should be accepted. Passwords found in public data breaches are refused, which we can only check when you continue.
        </Text>
      ) : null}
    </View>
  );
}
