// KG or LB, switched where the number is typed.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// The weight unit is an account setting and it was reachable from exactly one
// place: Me → Settings → Units. That is the right home for it, and it is the
// wrong place to have to go from the middle of a set. Somebody mid-session
// looking at a box labelled LB when they think in kilos has to leave the
// session, cross two tabs, change a setting and come back — so in practice they
// type the number they have and the log is wrong.
//
// ── Why it changes the ACCOUNT setting rather than just this box ───────────
//
// A per-box unit would be a second opinion about the same fact, and this app
// has a standing rule against those. Every load in the app is STORED in
// kilograms and converted for display (src/lib/units.ts), so the unit is purely
// how a number is written down and read back — which means switching it here is
// safe, is not a conversion of any stored figure, and should agree with every
// other screen the moment it changes. A set logged as 225 LB reads as 102 KG
// afterwards because it is the same lift, and that is the behaviour somebody
// tapping this expects.
import { View, Text, Pressable } from 'react-native';
import { useTheme } from './components';
import { useSettings } from './settings';
import { sp, radius, type as ty } from '../theme/scale';
import type { WeightUnit } from '../lib/units';

const UNITS: readonly WeightUnit[] = ['kg', 'lb'];

/**
 * The two units, side by side, with the live one lit.
 *
 * Rendered at the size of a field label because that is what it replaces. Both
 * halves are always present — a single control that toggles between two states
 * makes somebody read the label to work out whether it is showing what they
 * have or what they would get, and half of them guess wrong.
 */
export function WeightUnitToggle({ compact }: { compact?: boolean }) {
  const t = useTheme();
  const st = useSettings();
  const unit = st.weightUnit;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Weight unit"
      style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}
    >
      {UNITS.map((u) => {
        const on = u === unit;
        return (
          <Pressable
            key={u}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
            // The tap target is the label plus slop rather than a taller pill,
            // because this sits on the baseline of a field label and anything
            // with real height here pushes the input box down by that much on
            // every screen it appears on.
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            onPress={() => { if (!on) st.set({ weightUnit: u }); }}
            style={{
              paddingHorizontal: compact ? 4 : 6,
              paddingVertical: 1,
              borderRadius: radius.sm,
              backgroundColor: on ? t.surface2 : 'transparent',
            }}
          >
            <Text style={{ ...ty.micro, color: on ? t.ink : t.ink3 }}>{u.toUpperCase()}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The gap this control wants between itself and whatever labels it. */
export const UNIT_TOGGLE_GAP = sp.sm;
