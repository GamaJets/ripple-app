// One row that says what the screen you are on is showing you.
//
//   "There is a lot of information being presented and if users don't know what
//    they are looking at or how to understand it, they will simply find it too
//    complicated and not use the app."
//
// The words are in src/lib/screenHelp.ts and the rules are tested there. This
// file reads the preference, draws the row, and writes back that it is done
// with.
//
// ── What it costs the screen ───────────────────────────────────────────────
//
// One row, shut. That is the whole budget, and it is deliberate: the report is
// about volume, so an explanation that arrives as a paragraph is the disease
// wearing the cure's coat. Tapping it opens three lines in place; "Got It"
// removes it for good.
//
// ── Nothing until we know ──────────────────────────────────────────────────
//
// Renders null while the preference is still being read. A card that appears
// for one frame and vanishes is worse than one that never appeared: the reader
// saw something move, went looking for it, and it is not there.
import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from './components';
import { Icon } from './Icon';
import { Ghost } from './kit';
import { sp, radius, hairline, type as ty, grown } from '../theme/scale';
import {
  SCREEN_HELP, dismissedFrom, isDismissed, withDismissed, type ScreenHelpKey,
} from '../lib/screenHelp';
import { FORWARD_ICON, turn } from './direction';

const KEY = 'repple.screenHelp.dismissed';

export function ScreenHelp({ screen }: { screen: ScreenHelpKey }) {
  const t = useTheme();
  const help = SCREEN_HELP[screen];
  // null until the read finishes. See the header — no flash.
  const [dismissed, setDismissed] = useState<ScreenHelpKey[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      let list: ScreenHelpKey[] = [];
      try {
        const raw = await AsyncStorage.getItem(KEY);
        // A preference written by an older build, or corrupted, must not crash
        // a tab. dismissedFrom keeps every key it still recognises — see its
        // own header for why that direction is the safe one here.
        if (raw) list = dismissedFrom(JSON.parse(raw));
      } catch { /* nothing dismissed yet, which shows the row */ }
      if (live) setDismissed(list);
    })();
    return () => { live = false; };
  }, []);

  const close = () => {
    const next = withDismissed(dismissed ?? [], screen);
    setDismissed(next);
    setOpen(false);
    // Best effort. A dismissal we could not write costs one row on the next
    // launch; failing the tap would cost the reader the screen.
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  };

  if (dismissed == null || isDismissed(dismissed, screen)) return null;

  return (
    <View style={{
      backgroundColor: t.surface2, borderRadius: radius.sm,
      borderWidth: hairline, borderColor: t.ring,
      paddingHorizontal: sp.lg, paddingVertical: sp.md, marginTop: sp.lg,
    }}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? `${help.title}. Collapse` : `${help.title}. Expand`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}
      >
        <Icon name="info" size={16} color={t.brand} />
        <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{help.title}</Text>
        {/* The chevron turns when the card is open. It did not: the row kept
            drawing a forward chevron while three paragraphs sat underneath it,
            so the one visible affordance said "there is more over there" about
            content that was already on screen — and nothing said the tap that
            would put it away. `accessibilityState` had been telling a screen
            reader all along; this is the same fact for the eye, in the house
            form used by every other disclosure in the app. */}
        <View style={{ transform: [{ rotate: turn(open ? 90 : 0) }] }}>
          <Icon name={FORWARD_ICON} size={14} color={t.ink3} />
        </View>
      </Pressable>

      {open ? (
        <View style={{ marginTop: sp.md, gap: sp.sm }}>
          {help.lines.map((l) => (
            // One text node, not two: the term and its explanation are one
            // sentence and wrap as one. Split across two <Text> they hang the
            // explanation under a heading and the row becomes three rows.
            // `grown(18)`, not a raw 18. `ty.caption` already carries a line
            // height that tracks the reader's text size; pinning one here puts
            // back the exact defect src/lib/typeScale.ts was written to end —
            // React Native scales fontSize and never lineHeight, so at 235%
            // text these are 28pt glyphs laid out in an 18pt line. This card is
            // the app's own explanation of the screen you are on, so the reader
            // who turned their text up is the reader it clips.
            <Text key={l.term} style={{ ...ty.caption, color: t.ink3, lineHeight: grown(18) }}>
              <Text style={{ color: t.ink2, fontWeight: '600' }}>{l.term}</Text>
              {' — '}{l.means}
            </Text>
          ))}
          <View style={{ flexDirection: 'row', marginTop: sp.sm }}>
            <Ghost label="Got It" onPress={close} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
