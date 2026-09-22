// The brand mark for each wearable provider, on the brand's own plate — what
// the approved board draws beside every row of Connected Apps (client page 17:
// Apple Health's white plate, Fitbit's teal, MyFitnessPal's blue, Strava's
// orange). The catalogue in src/lib/wearables/registry.ts used to carry an
// emoji per provider and the row drew that; two watches and a red circle
// were not marks anybody recognised.
//
// ── the colours are hardcoded here, and that is the one place they may be ──
//
// This file is the exception to "no hardcoded colours; theme tokens only".
// A third party's brand colour is IDENTITY DATA, not theme: Fitbit is teal on
// every phone in every palette, the way a client's name is their name. The
// values are the ones Simple Icons publishes for each brand and they are not
// tinted, dimmed or swapped for a token in dark mode. Everything that is
// ours — the plate's hairline, the ink of the drawn Apple mark — still comes
// from the theme.
//
// ── where each mark came from ───────────────────────────────────────────────
//
//   Simple Icons (CC0 1.0, https://simpleicons.org — no attribution owed,
//   recorded anyway because the paths are copied verbatim from
//   simple-icons/icons/<slug>.svg and a reader should know they are not ours):
//     garmin     the delta above the wordmark's "i", cropped out of the full
//                path — the whole wordmark is 24 units wide and illegible on
//                a 40pt plate
//     fitbit     the dotted diamond
//     googlefit  the two-tone heart, drawn in one colour
//
//   Drawn here, because Simple Icons has no mark for them and drawing a
//   geometric stand-in is honest where copying a logo we have no source for
//   would not be:
//     whoop      a rounded band with its sensor pod — the strap is the product
//     oura       a ring
//     apple      a watch — rounded face, two strap stubs, a heart on the dial.
//                NOT the Apple logo and NOT the Health app's icon: Apple's
//                trademark guidelines forbid reproducing either inside a
//                third-party app, so the heart stands in for Health and the
//                watch for the device. The board's white plate is the theme's
//                surface — white in light mode, and a plate that stays white
//                in dark mode would hide token ink drawn on it.
//
// Plates are the board's 10pt-radius squares (a quarter of the plate's size,
// so a 40pt plate rounds at 10). The mark fills 60% of the plate, which is
// the 24pt these paths were drawn at when the plate is 40. The plate is
// decorative — the row's text names the app — so the whole thing is hidden
// from assistive tech, the way the emoji circle it replaces was.
import { View } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { useTheme } from '../components';
import { hairline } from '../../theme/scale';
import type { ProviderId } from '../../lib/wearables/types';

// Simple Icons brand hex per slug — see the header for why these are literals.
const PLATE: Record<Exclude<ProviderId, 'apple'>, string> = {
  garmin: '#000000',
  fitbit: '#00B0B9',
  googlefit: '#4285F4',
  // Simple Icons carries neither; both brands set their marks white on black.
  whoop: '#000000',
  oura: '#000000',
};
// Every mark on a coloured plate is white. The plate is the brand's colour,
// the glyph is the negative space cut out of it, which is how each of these
// brands draws itself on its own app icon.
const ON_PLATE = '#FFFFFF';

// Simple Icons: fitbit.svg — CC0 1.0.
const FITBIT = 'M13.298 1.825c0 .976-.81 1.785-1.786 1.785-.972 0-1.784-.81-1.784-1.785 0-.973.813-1.785 1.784-1.785.976 0 1.786.813 1.786 1.785zm-1.786 3.243c-1.052 0-1.863.81-1.863 1.866 0 1.053.81 1.865 1.865 1.865 1.053 0 1.865-.811 1.865-1.865s-.825-1.866-1.875-1.866h.008zm0 5.029c-1.052 0-1.945.891-1.945 1.945s.894 1.945 1.947 1.945 1.946-.891 1.946-1.945-.894-1.945-1.946-1.945h-.002zm0 5.107c-1.052 0-1.863.81-1.863 1.864s.81 1.866 1.865 1.866c1.053 0 1.865-.811 1.865-1.866 0-.972-.825-1.864-1.875-1.864h.008zm0 5.191c-.972 0-1.784.809-1.784 1.784 0 .97.813 1.781 1.784 1.781.977 0 1.786-.809 1.786-1.784 0-.973-.81-1.781-1.786-1.781zM16.46 4.823c-1.136 0-2.108.977-2.108 2.111 0 1.134.973 2.107 2.108 2.107 1.135 0 2.106-.975 2.106-2.107 0-1.135-.972-2.109-2.106-2.109v-.002zm0 5.03c-1.216 0-2.19.973-2.19 2.19 0 1.216.975 2.187 2.19 2.187 1.215 0 2.189-.971 2.189-2.189 0-1.216-.974-2.188-2.189-2.188zm0 5.108c-1.136 0-2.108.976-2.108 2.107 0 1.135.973 2.109 2.108 2.109 1.135 0 2.106-.976 2.106-2.109s-.971-2.107-2.106-2.107zm5.106-5.353c-1.296 0-2.43 1.055-2.43 2.434 0 1.297 1.051 2.433 2.43 2.433 1.381 0 2.434-1.065 2.434-2.444-.082-1.382-1.135-2.431-2.434-2.431v.008zM6.486 5.312c-.892 0-1.62.73-1.62 1.623 0 .891.729 1.62 1.62 1.62.893 0 1.619-.729 1.619-1.62 0-.893-.727-1.62-1.619-1.62v-.003zm0 5.027c-.973 0-1.703.729-1.703 1.703 0 .975.721 1.703 1.695 1.703s1.695-.73 1.695-1.703c0-.975-.735-1.703-1.71-1.703h.023zm0 5.107c-.892 0-1.62.731-1.62 1.62 0 .895.729 1.623 1.62 1.623.893 0 1.619-.735 1.619-1.635s-.727-1.62-1.619-1.62v.012zm-5.025-4.863c-.813 0-1.461.646-1.461 1.459 0 .81.648 1.459 1.46 1.459.81 0 1.459-.648 1.459-1.459s-.648-1.459-1.458-1.459z';

// Simple Icons: googlefit.svg — CC0 1.0.
const GOOGLEFIT = 'M23.218 4.868c-1.235-2.194-3.927-3.356-6.378-2.843-1.11.243-2.173.774-2.979 1.583-.622.613-1.242 1.229-1.864 1.841-.915-.91-1.788-1.937-2.882-2.648a5.98 5.98 0 0 0-3.904-.845c-4.757.578-6.936 6.346-3.615 9.85 3.481 3.418 6.937 6.863 10.413 10.288 3.291-3.251 6.573-6.51 9.871-9.752 2.132-1.831 2.8-5.026 1.338-7.474zM6.162 11.223c-.692-.755-1.511-1.404-2.141-2.208-.821-1.218-.158-3.012 1.26-3.397.781-.256 1.683-.031 2.279.527.627.609 1.236 1.237 1.866 1.843l.005.006a414.706 414.706 0 0 0-3.269 3.229zm5.846 5.758a3300.079 3300.079 0 0 1-3.255-3.22c2.555-2.516 5.103-5.042 7.65-7.566.393-.394.93-.646 1.487-.673 2.086-.154 3.285 2.372 1.801 3.866-2.549 2.542-5.121 5.062-7.683 7.593z';

// Simple Icons: garmin.svg — CC0 1.0. One subpath of the full wordmark: the
// delta over the "i", which is the mark Garmin puts on its own app icon. The
// viewBox below is cropped to it; the coordinates are untouched.
const GARMIN_DELTA = 'M22.134 11.051h-2.165c-.079 0-.148-.039-.187-.108s-.039-.146 0-.215l1.084-1.874a.21.21 0 0 1 .187-.108.21.21 0 0 1 .187.108l1.084 1.874a.203.203 0 0 1 0 .215.22.22 0 0 1-.19.108z';
const GARMIN_BOX = '19.4 8.35 3.25 3.25';

// The heart on the drawn watch's dial. Ours, on a 24-unit grid.
const HEART = 'M12 15.6l-.6-.55C9.3 13.15 8 12 8 10.55 8 9.4 8.9 8.5 10.05 8.5c.65 0 1.3.3 1.7.8.4-.5 1.05-.8 1.7-.8 1.15 0 2.05.9 2.05 2.05 0 1.45-1.3 2.6-3.4 4.5l-.1.55z';

function Mark({ id, size, ink }: { id: ProviderId; size: number; ink: string }) {
  switch (id) {
    case 'fitbit':
      return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={FITBIT} fill={ON_PLATE} /></Svg>;
    case 'googlefit':
      return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={GOOGLEFIT} fill={ON_PLATE} /></Svg>;
    case 'garmin':
      return <Svg width={size} height={size} viewBox={GARMIN_BOX}><Path d={GARMIN_DELTA} fill={ON_PLATE} /></Svg>;
    case 'whoop':
      // The band, seen edge-on: a rounded loop with the sensor pod sitting on
      // it. Stroke widths are in the 24-unit grid so they scale with the mark.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x={3} y={7} width={18} height={10} rx={5} stroke={ON_PLATE} strokeWidth={2.2} fill="none" />
          <Rect x={8.5} y={9.5} width={7} height={5} rx={1.5} fill={ON_PLATE} />
        </Svg>
      );
    case 'oura':
      // A ring, thicker at the bottom where the sensors sit — one stroked
      // circle over a slightly heavier arc would over-draw it; one circle is
      // the whole idea.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={7.5} stroke={ON_PLATE} strokeWidth={3.2} fill="none" />
        </Svg>
      );
    case 'apple':
      // A watch: rounded face, a strap stub above and below, the heart on the
      // dial. Ink from the theme, because the plate under it is the theme's
      // surface. See the header for why this is not Apple's own mark.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x={8.5} y={1.5} width={7} height={4} rx={1.5} fill={ink} />
          <Rect x={8.5} y={18.5} width={7} height={4} rx={1.5} fill={ink} />
          <Rect x={5} y={4.5} width={14} height={15} rx={4} stroke={ink} strokeWidth={2} fill="none" />
          <Path d={HEART} fill={ink} />
        </Svg>
      );
  }
}

export function ProviderMark({ id, size = 40 }: { id: ProviderId; size?: number }) {
  const t = useTheme();
  const plate = id === 'apple' ? t.surface : PLATE[id];
  return (
    <View
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{
        width: size, height: size, borderRadius: Math.round(size / 4),
        backgroundColor: plate,
        // The hairline is what keeps a black plate visible on a dark surface
        // and the white one visible on a white card; on every other pairing it
        // is invisible, which is the point of a hairline.
        borderWidth: hairline, borderColor: t.ring,
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
      <Mark id={id} size={Math.round(size * 0.6)} ink={t.ink} />
    </View>
  );
}
