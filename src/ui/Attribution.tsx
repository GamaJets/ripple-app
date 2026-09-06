// The RepDB credit, in all three apps.
//
// ── Why this is a component and not a line of text ─────────────────────────
//
// The exercise catalogue — every description, every illustration, the naming
// itself — is licensed from RepDB. It arrived under a free tier whose single
// condition is a visible credit; the catalogue and the artwork we ship today
// come from the Standard tier, which downgrades attribution from a condition to
// a request. We render it either way. Under the free tier it was the entire
// price of an illustrated catalogue; under Standard it is simply true, and the
// muscle heatmap under assets/muscle-heatmap is 76 more pieces of their work.
//
// Which licence governs which file is written down in data/repdb-PROVENANCE.md,
// because the two archives ship byte-identical-looking WebPs under different
// terms — and because Standard v1.2 excludes white-label builds, which is
// Repple's second axis. That one is a purchase decision, not a code one.
//
// A credit works only if somebody can find it, so this is deliberately NOT a
// grey footnote at the bottom of a settings list. It has its own card, its own
// heading, the name set in the app's own body size rather than in caption grey,
// and it is tappable through to repdb.co. Made "as distinct as possible" on
// purpose.
//
// It is also a component rather than three pasted strings so that
// scripts/check-attribution.mjs can prove every app that ships RepDB content
// actually renders it. A licence term honoured by everyone remembering is a
// licence term that lapses the first time somebody rewrites a settings screen.
import { View, Text, Pressable, Linking } from 'react-native';
import { BRAND } from '../lib/brands';
import { useTheme } from './components';
import { Icon } from './Icon';
import { sp, radius, type as ty } from '../theme/scale';
import { reportError } from '../lib/reportError';

/** The exact string the licence asks for. Not paraphrased, not abbreviated. */
export const REPDB_CREDIT = 'Exercise data by RepDB (repdb.co)';
export const REPDB_URL = 'https://repdb.co';

/**
 * The full credit card. Belongs on an about/credits surface in every app that
 * ships the exercise catalogue.
 */
export function RepdbAttribution() {
  const t = useTheme();
  const open = () => {
    Linking.openURL(REPDB_URL).catch((e) => reportError('attribution.open', e));
  };
  return (
    <Pressable
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={`${REPDB_CREDIT}. Opens repdb.co`}
      style={{
        backgroundColor: t.surface2,
        borderRadius: radius.md,
        padding: sp.lg,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
        <Icon name="dumbbell" size={16} color={t.brand} />
        <Text style={{ ...ty.label, fontWeight: '700', color: t.brand, letterSpacing: 0.4 }}>
          EXERCISE LIBRARY
        </Text>
      </View>
      {/* Body size, not caption grey. A credit nobody can read is not a credit. */}
      <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>{REPDB_CREDIT}</Text>
      <Text style={{ ...ty.caption, color: t.ink2 }}>
        Exercise descriptions, illustrations and muscle data across {BRAND.label} come from RepDB.
        Tap to visit repdb.co.
      </Text>
    </Pressable>
  );
}

/**
 * The same credit at the point of use — under an illustration, where somebody
 * looking at the artwork can see whose it is.
 *
 * The licence asks for one visible credit and this is not it; the card above is.
 * This is here because a credit beside the thing it credits is worth more than a
 * credit two screens away, and it costs a line.
 */
export function RepdbInlineCredit() {
  const t = useTheme();
  return (
    <Text
      accessibilityLabel={REPDB_CREDIT}
      style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}
    >
      Illustration by RepDB · repdb.co
    </Text>
  );
}
