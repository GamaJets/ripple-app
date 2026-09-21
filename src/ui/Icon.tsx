// Repple icon set — clean line/solid icons built on react-native-svg (already a
// dependency). Replaces emoji app-wide. Usage: <Icon name="home" size={22}
// color={t.brand} />. `filled` swaps stroke for fill on icons that support it.
import { View, type ColorValue } from 'react-native';
import Svg, { Path, Circle, Rect, Polyline, Line } from 'react-native-svg';

export type IconName =
  | 'home' | 'train' | 'meals' | 'progress' | 'me'
  | 'grid' | 'people' | 'palette' | 'trending' | 'wrench'
  | 'play' | 'plus' | 'minus' | 'calendar' | 'video' | 'chart' | 'chevron' | 'back'
  | 'pencil' | 'search' | 'swap' | 'camera' | 'flame' | 'bell' | 'check' | 'lock'
  | 'water' | 'moon' | 'sun' | 'target' | 'trophy' | 'clock' | 'message'
  | 'ruler' | 'scale' | 'heart' | 'share' | 'settings' | 'sparkle' | 'dumbbell' | 'chat'
  | 'eye' | 'eye-off' | 'info';

/**
 * `duo`: the approved tab bar style (option C, owner 21 Sep 2026). The same
 * glyph drawn twice, a soft fill of its closed shapes at 22% under the line, so
 * every tab icon carries colour rather than a bare outline. `layer` is internal:
 * it is how `duo` draws that fill pass.
 */
export function Icon({ name, size = 22, color = '#fff', filled = false, strokeWidth = 2, duo = false, layer }: {
  // ColorValue, not string: expo-router's tabBarIcon hands its render callback a
  // ColorValue (string | OpaqueColorValue, the latter covering PlatformColor and
  // DynamicColorIOS). Narrowing to string here would push a cast onto all 16 tab
  // call sites to paper over a type that is genuinely wider than we declared.
  // react-native-svg's stroke and fill take ColorValue too, so nothing downstream
  // has to change.
  name: IconName; size?: number; color?: ColorValue; filled?: boolean; strokeWidth?: number;
  duo?: boolean; layer?: 'fill';
}) {
  if (duo && !layer) {
    return (
      <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={{ position: 'absolute' }}><Icon name={name} size={size} color={color} layer="fill" /></View>
        <Icon name={name} size={size} color={color} strokeWidth={strokeWidth} filled={filled} />
      </View>
    );
  }
  // The fill pass paints every closed shape and no line; an open stroke (the
  // bar of a dumbbell) has no area and simply draws nothing here.
  const common = layer === 'fill'
    ? { stroke: 'none', strokeWidth: 0, fill: color, fillOpacity: 0.22 }
    : { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  // An icon in this app is never the meaning on its own — it sits inside a
  // button, a row or a chip that carries the label. Left visible to the
  // accessibility tree it is one more unnamed stop between the reader and the
  // thing they wanted; on Android react-native-svg's shapes can surface as
  // separate nodes, so a single Icon becomes four. It has no text to lose.
  //
  // The one thing this must NOT do is hide an icon that is the only content of
  // a control — but a control like that is already broken, because an <Svg>
  // announces nothing either way. The fix there is a label on the control, which
  // is what Ghost's ICON_NAMES table does.
  const S = (children: React.ReactNode) => (
    <Svg
      width={size} height={size} viewBox="0 0 24 24"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    >{children}</Svg>
  );
  switch (name) {
    case 'home':
      return S(<Path d="M4 10.3 12 3.8l8 6.5v8.7a1.5 1.5 0 0 1-1.5 1.5H15v-5.2a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5.2H5.5A1.5 1.5 0 0 1 4 19z" {...common} {...(filled && layer !== 'fill' ? { fill: color, stroke: 'none' } : null)} />);
    case 'train':
    case 'dumbbell':
      return S(<><Rect x="2" y="8.8" width="3.2" height="6.4" rx="1.4" {...common} /><Rect x="18.8" y="8.8" width="3.2" height="6.4" rx="1.4" {...common} /><Rect x="5.9" y="6" width="3.4" height="12" rx="1.6" {...common} /><Rect x="14.7" y="6" width="3.4" height="12" rx="1.6" {...common} /><Path d="M9.3 12h5.4" {...common} /></>);
    case 'meals':
      return S(<><Path d="M3.5 11.5h17a8.5 7.5 0 0 1-17 0z" {...common} /><Path d="M9 3.5c-.9 1.1.9 2.1 0 3.2M12.5 3.5c-.9 1.1.9 2.1 0 3.2M16 3.5c-.9 1.1.9 2.1 0 3.2" {...common} {...(layer === 'fill' ? { fill: 'none' } : null)} /></>);
    case 'progress':
      // A rising line, not a bar chart: `chart` keeps the bars for screens
      // that mean a chart.
      return S(<><Path d="M3.5 17.5 9 12l3.8 3.2L20 7.5" {...common} {...(layer === 'fill' ? { fill: 'none' } : null)} /><Path d="M15 7.5h5v5" {...common} {...(layer === 'fill' ? { fill: 'none' } : null)} /></>);
    case 'chart':
      return S(<Path d="M5 20V12M12 20V5M19 20v-6" {...common} />);
    case 'me':
      return S(<><Circle cx="12" cy="8" r="3.8" {...common} /><Path d="M4.5 20.5c.8-3.9 3.8-6 7.5-6s6.7 2.1 7.5 6" {...common} /></>);
    case 'people':
      // Redrawn with the tab set (owner, 21 Sep 2026): closed shoulders so the
      // duotone fill reads, a second figure half behind the first.
      return S(<><Circle cx="16.8" cy="8.6" r="2.7" {...common} /><Path d="M16.3 14.2c3.1.1 5.2 2.3 5.2 5.8h-3.6" {...common} {...(layer === 'fill' ? { fill: 'none' } : null)} /><Circle cx="9" cy="7.8" r="3.6" {...common} /><Path d="M2.5 20.2c0-3.9 2.9-6.2 6.5-6.2s6.5 2.3 6.5 6.2z" {...common} /></>);
    case 'grid':
      // A dashboard, not four equal squares: tiles of different heights.
      return S(<><Rect x="3" y="3" width="8" height="10" rx="2.2" {...common} /><Rect x="13" y="3" width="8" height="6" rx="2.2" {...common} /><Rect x="13" y="11" width="8" height="10" rx="2.2" {...common} /><Rect x="3" y="15" width="8" height="6" rx="2.2" {...common} /></>);
    case 'palette':
      return S(<><Path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.6 0 2.2-1.2 1.5-2.2-.8-1.1-.2-2.6 1.2-2.6h2.4a3.9 3.9 0 0 0 3.9-3.9c0-5-4.1-8.9-9-8.9z" {...common} />{layer === 'fill' ? null : <><Circle cx="7.6" cy="12.2" r="1.35" fill={color} stroke="none" /><Circle cx="9.6" cy="8" r="1.35" fill={color} stroke="none" /><Circle cx="14.4" cy="7.8" r="1.35" fill={color} stroke="none" /><Circle cx="17.3" cy="11.4" r="1.35" fill={color} stroke="none" /></>}</>);
    case 'trending':
      // Rising line over a shaded area and a baseline: the area is the
      // duotone fill's alone.
      return S(<><Path d="M3 16.5 9 10.5l4 3.5 8-8V20.5H3z" {...common} {...(layer === 'fill' ? null : { stroke: 'none' })} /><Path d="M3 16.5 9 10.5l4 3.5 8-8" {...common} {...(layer === 'fill' ? { fill: 'none' } : null)} /><Path d="M16 6h5v5" {...common} {...(layer === 'fill' ? { fill: 'none' } : null)} /><Path d="M3 20.5h18" {...common} {...(layer === 'fill' ? { fill: 'none' } : null)} /></>);
    case 'wrench':
      return S(<Path d="M14.6 3.6a4.8 4.8 0 0 1 3.6.3l-3 3 .6 2.3 2.3.6 3-3a4.8 4.8 0 0 1-6.1 6.4l-7 7a2.1 2.1 0 0 1-3-3l7-7a4.8 4.8 0 0 1 2.6-6.6z" {...common} />);
    case 'play':
      return S(<Path d="M7 5v14l12-7z" fill={color} stroke="none" />);
    case 'plus':
      return S(<Path d="M12 5v14M5 12h14" {...common} />);
    case 'minus':
      return S(<Path d="M5 12h14" {...common} />);
    case 'calendar':
      // Rounded page, a header band and the days as dots.
      return S(<><Rect x="3" y="4.5" width="18" height="16.5" rx="3" {...common} /><Path d="M3 9.5h18M8 2.8v3.4M16 2.8v3.4" {...common} {...(layer === 'fill' ? { fill: 'none' } : null)} />{layer === 'fill' ? null : <><Rect x="6.6" y="12.3" width="2.4" height="2.4" rx="0.7" fill={color} stroke="none" /><Rect x="10.8" y="12.3" width="2.4" height="2.4" rx="0.7" fill={color} stroke="none" /><Rect x="15" y="12.3" width="2.4" height="2.4" rx="0.7" fill={color} stroke="none" /><Rect x="6.6" y="16.2" width="2.4" height="2.4" rx="0.7" fill={color} stroke="none" /><Rect x="10.8" y="16.2" width="2.4" height="2.4" rx="0.7" fill={color} stroke="none" /></>}</>);
    case 'video':
      return S(<><Rect x="2" y="6" width="14" height="12" rx="2" {...common} /><Path d="M16 10l6-3v10l-6-3z" {...common} /></>);
    case 'chevron':
      return S(<Path d="M9 6l6 6-6 6" {...common} />);
    case 'lock':
      return S(<><Path d="M6 10.5h12v9H6z" {...common} /><Path d="M8.5 10.5V7.5a3.5 3.5 0 017 0v3" {...common} /></>);
    case 'back':
      return S(<Path d="M15 6l-6 6 6 6" {...common} />);
    case 'pencil':
      return S(<><Path d="M4 20h4L18 10l-4-4L4 16z" {...common} /><Path d="M13.5 6.5l4 4" {...common} /></>);
    case 'search':
      return S(<><Circle cx="11" cy="11" r="7" {...common} /><Path d="M20 20l-3.5-3.5" {...common} /></>);
    case 'swap':
      return S(<Path d="M4 8h13l-3-3M20 16H7l3 3" {...common} />);
    case 'camera':
      return S(<><Rect x="3" y="6" width="18" height="14" rx="2" {...common} /><Circle cx="12" cy="13" r="3.5" {...common} /><Path d="M8 6l1.5-2h5L16 6" {...common} /></>);
    case 'flame':
      return S(<Path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1.5.7-2.3 1.4-3C10 9 11 7 12 3z" fill={filled ? color : 'none'} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />);
    case 'bell':
      return S(<Path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0" {...common} />);
    case 'check':
      return S(<Path d="M5 12l4 4L19 6" {...common} />);
    case 'water':
      return S(<Path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" {...common} />);
    case 'moon':
      return S(<Path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z" {...common} />);
    case 'sun':
      return S(<><Circle cx="12" cy="12" r="4" {...common} /><Path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" {...common} /></>);
    case 'target':
      return S(<><Circle cx="12" cy="12" r="8" {...common} /><Circle cx="12" cy="12" r="3.5" {...common} /></>);
    case 'trophy':
      return S(<><Path d="M7 4h10v4a5 5 0 0 1-10 0z" {...common} /><Path d="M7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3M9 13v3h6v-3M8 20h8" {...common} /></>);
    case 'clock':
      return S(<><Circle cx="12" cy="12" r="8.5" {...common} /><Path d="M12 7v5l3.5 2" {...common} /></>);
    case 'message':
    case 'chat':
      return S(<Path d="M4 5h16v11H9l-4 4V5z" {...common} />);
    case 'eye':
      return S(<><Circle cx="12" cy="12" r="3" {...common} /><Path d="M2 12c2-4 6-6 10-6s8 2 10 6-4 6-10 6-8-2-10-6z" {...common} /></>);
    case 'eye-off':
      return S(<><Path d="M12 3c5.3 0 9.3 3.5 10.5 6-.9 1.8-2.4 3.4-4.2 4.5M2 12c1.2-2.5 5.2-6 10-6m3 9l2 2m-15-2l-2 2M9 9l6 6" {...common} /></>);
    case 'ruler':
      return S(<><Rect x="2.5" y="7" width="19" height="10" rx="1.5" transform="rotate(0 12 12)" {...common} /><Path d="M7 7v3M12 7v4M17 7v3" {...common} /></>);
    case 'scale':
      return S(<><Rect x="3" y="5" width="18" height="16" rx="3" {...common} /><Path d="M9 9a3 3 0 0 1 6 0" {...common} /></>);
    case 'heart':
      return S(<Path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.5 12 20 12 20z" fill={filled ? color : 'none'} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />);
    case 'share':
      return S(<><Circle cx="18" cy="5" r="2.5" {...common} /><Circle cx="6" cy="12" r="2.5" {...common} /><Circle cx="18" cy="19" r="2.5" {...common} /><Path d="M8.2 10.8 15.8 6.2M8.2 13.2 15.8 17.8" {...common} /></>);
    case 'settings':
      return S(<><Circle cx="12" cy="12" r="3" {...common} /><Path d="M12 2v3M12 19v3M4.2 4.2l2 2M17.8 17.8l2 2M2 12h3M19 12h3M4.2 19.8l2-2M17.8 6.2l2-2" {...common} /></>);
    case 'info':
      // A drawn glyph rather than the letter "i" in a <Text>: the micro type
      // style is uppercase, so the letter rendered as a capital I — reported
      // as "needs to be a lower case i or a better info icon". A letter also
      // has to be re-centred by eye inside its circle at every size, which is
      // what the old inline version was doing.
      return S(
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Circle cx="12" cy="7.6" r={strokeWidth * 0.6} fill={color} stroke="none" />
          <Path d="M12 11v5.6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </>,
      );
    case 'sparkle':
      return S(<Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill={filled ? color : 'none'} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />);
    default:
      return S(<Circle cx="12" cy="12" r="8" {...common} />);
  }
}
