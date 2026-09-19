// The Repple wordmark, as the approved mockup board draws it: R≡PPLE, a heavy
// squared sans in ink with the first E drawn as three leaning signal bars.
//
// The owner chose this over the logo pack's angular mark on 19 Sep 2026 — the
// board is what they approved, and the board's splash screens, headers and
// footer all carry this word. There is no vector of it anywhere in the
// handoff, so it is constructed here: every letter is a 24-unit stroke on a
// 100-unit cap height with round joins (which is where the board's softened
// corners come from), the R's leg and the three bars are filled shapes.
//
// Two drawings of one geometry, so they cannot drift:
//   BrandWordmark  the whole word — the door, launch screen, anywhere with room
//   BrandMark      "R≡" — the app icons' drawing and any square-ish slot
//
// Ink comes from the theme unless the caller is on a fixed ground (the dark
// door plate); the bars are the accent, so a white-label tenant's door carries
// their colour in the bars and their name under the word, not Repple's green.
import Svg, { G, Path } from 'react-native-svg';
import { useTheme } from './components';

/** One squared bowl-and-stem: the P, and the R before its leg. */
export const WORDMARK_P = 'M12 100V12H76a20 20 0 0 1 20 20V42a20 20 0 0 1-20 20H12';
export const WORDMARK_R_LEG = 'M38 62H70L112 100H78Z';
export const WORDMARK_L = 'M12 0V88H100';
export const WORDMARK_E = 'M100 12H12V88H100M12 50H84';
/** The signal E: three bars leaning the way the board's lean, the middle one short. */
export const WORDMARK_BARS = ['M20 0H116L104 24H8Z', 'M34 38H96L84 62H22Z', 'M12 76H108L96 100H0Z'] as const;

const WORD_W = 716;   // R 0 · ≡ 124 · P 252 · P 372 · L 492 · E 604 (+112)
const MARK_W = 240;   // R 0 · ≡ 124 (+116)
const CAP = 100;

function Letters({ ink, signal, word }: { ink: string; signal: string; word: boolean }) {
  return (
    <>
      <G fill="none" stroke={ink} strokeWidth={24} strokeLinejoin="round">
        <Path d={WORDMARK_P} />
        {word ? (
          <>
            <Path d={WORDMARK_P} transform="translate(252 0)" />
            <Path d={WORDMARK_P} transform="translate(372 0)" />
            <Path d={WORDMARK_L} transform="translate(492 0)" />
            <Path d={WORDMARK_E} transform="translate(604 0)" />
          </>
        ) : null}
      </G>
      <Path d={WORDMARK_R_LEG} fill={ink} />
      <G fill={signal} transform="translate(124 0)">
        {WORDMARK_BARS.map((d) => <Path key={d} d={d} />)}
      </G>
    </>
  );
}

/** The whole word. `width` is the drawn width; the height follows the artwork. */
export function BrandWordmark({ width = 200, ink, signal }: { width?: number; ink?: string; signal?: string }) {
  const t = useTheme();
  return (
    <Svg width={width} height={Math.round(width * (CAP / WORD_W))} viewBox={`0 0 ${WORD_W} ${CAP}`}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Letters ink={ink ?? t.ink} signal={signal ?? t.brand} word />
    </Svg>
  );
}

/** "R≡" — the icon's drawing. `size` is the drawn width. */
export function BrandMark({ size = 28, ink, signal }: { size?: number; ink?: string; signal?: string }) {
  const t = useTheme();
  return (
    <Svg width={size} height={Math.round(size * (CAP / MARK_W))} viewBox={`0 0 ${MARK_W} ${CAP}`}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Letters ink={ink ?? t.ink} signal={signal ?? t.brand} word={false} />
    </Svg>
  );
}
