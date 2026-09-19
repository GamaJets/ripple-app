// The Repple mark from the approved redesign: a bold P with two signal bars
// rising off its bowl. One vector, drawn here for the apps and carried as the
// same path in web/index.html and assets/repple-icon-*.svg, so the door, the
// icon and the website cannot drift apart.
//
// `ink` is the P; the bars are the accent unless a caller says otherwise — on
// the brand's own plate they stay the family green, and on a white-label
// install they follow the stored accent like every other mark.
import Svg, { Path } from 'react-native-svg';
import { useTheme } from './components';

export const BRAND_MARK_P = 'M3 4h24c8 0 12 3 12 9s-4 9-12 9H14v12H3V4Zm11 8v3h13c1 0 2-.5 2-1.5S28 12 27 12H14Z';
export const BRAND_MARK_SIGNAL = 'm33 4 18 0-7 8H29l4-8Zm-5 18h15l-7 8H24l4-8Z';

export function BrandMark({ size = 28, ink, signal }: { size?: number; ink?: string; signal?: string }) {
  const t = useTheme();
  const h = Math.round(size * (38 / 54));
  return (
    <Svg width={size} height={h} viewBox="0 0 54 38"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={BRAND_MARK_P} fill={ink ?? t.ink} />
      <Path d={BRAND_MARK_SIGNAL} fill={signal ?? t.brand} />
    </Svg>
  );
}
