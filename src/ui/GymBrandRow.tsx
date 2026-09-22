// The gym's own mark on a member's Home: its logo and name, above the
// greeting. Drawn only when the gym has uploaded a logo (the owner's Brand
// screen, part 3270) and it could be read; otherwise nothing, so a gym without
// one sees Home exactly as before rather than an empty plate.
import { View, Text, Image } from 'react-native';
import { useTheme } from './components';
import { useTenant } from './tenant';
import { useGymLogo } from './gymLogo';
import { sp, type as ty, font } from '../theme/scale';

export function GymBrandRow() {
  const t = useTheme();
  const { tenant } = useTenant();
  const logo = useGymLogo(tenant?.id);
  if (!logo.dataUri) return null;
  const name = (tenant?.name ?? '').trim();
  return (
    <View accessible accessibilityLabel={name ? `${name} logo` : 'Your gym’s logo'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
      <Image source={{ uri: logo.dataUri }} style={{ width: 28, height: 28, borderRadius: 6 }} resizeMode="contain" />
      {name ? <Text numberOfLines={1} style={{ ...ty.label, ...font('600'), color: t.ink2, flexShrink: 1 }}>{name}</Text> : null}
    </View>
  );
}
