// "Did you know…" — one tip, occasionally, from the guide.
//
// Asked for by a member who liked the first-run tour and wanted it spread out
// rather than delivered all at once. The rules live in src/lib/tips.ts and are
// tested there; this file only reads the preference, renders the card, and
// writes back that the tip was shown.
//
// RENDERS NOTHING most of the time. That is the feature. A card that appears
// on every visit is an interruption, and the request was explicitly "once a
// workout session or once few days" — so the default window is twenty hours
// and the common case is null.
//
// Dismissable, and dismissing counts as shown. Somebody who closes a tip has
// engaged with it as much as they intend to; making them close the same one
// tomorrow is how a helpful feature turns into a nuisance.
import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from './components';
import { Icon } from './Icon';
import { sp, radius, hairline, type as ty } from '../theme/scale';
import { VARIANT } from '../lib/variant';
import {
  tipToShow, tipsFor, markShown, EMPTY_TIP_STATE, type Tip, type TipState,
} from '../lib/tips';

const KEY = `repple.tips.${VARIANT}`;

export function DidYouKnow() {
  const t = useTheme();
  const [tip, setTip] = useState<Tip | null>(null);
  const [state, setState] = useState<TipState | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      let s: TipState = EMPTY_TIP_STATE;
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          // Defensive: a preference written by an older build, or corrupted,
          // must not crash the Train tab. Worst case the rotation restarts.
          if (Array.isArray(parsed?.seen)) s = { seen: parsed.seen, lastShownAt: parsed.lastShownAt ?? null };
        }
      } catch { /* start fresh */ }
      if (!live) return;
      setState(s);
      setTip(tipToShow(VARIANT, s));
    })();
    return () => { live = false; };
  }, []);

  /** Shown and dismissed are the same event as far as the rotation cares. */
  const close = () => {
    if (tip && state) {
      const next = markShown(state, tip, tipsFor(VARIANT).length, new Date().toISOString());
      setState(next);
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
    }
    setTip(null);
  };

  if (!tip) return null;

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Did you know: ${tip.text}`}
      style={{
        flexDirection: 'row', gap: sp.md, alignItems: 'flex-start',
        backgroundColor: t.surface2, borderRadius: radius.sm,
        borderWidth: hairline, borderColor: t.ring,
        padding: sp.lg, marginBottom: sp.lg,
      }}
    >
      <View style={{ marginTop: 2 }}>
        <Icon name="sparkle" size={16} color={t.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.micro, color: t.ink3, letterSpacing: 1 }}>
          DID YOU KNOW · {tip.tab.toUpperCase()}
        </Text>
        <Text style={{ ...ty.body, color: t.ink2, marginTop: 5 }}>{tip.text}</Text>
      </View>
      <Pressable
        onPress={close}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss this tip"
        style={{ padding: 2 }}
      >
        <Icon name="minus" size={15} color={t.ink3} />
      </Pressable>
    </View>
  );
}
