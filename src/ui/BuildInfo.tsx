// Which bundle is this phone actually running?
//
// Publishing an OTA prints "Published!" whether or not a single device is
// subscribed to that branch, and the app gave no way to tell what it was
// running. A production build was pointed at the `preview` channel, so
// `eas update --branch production` published successfully and reached nothing —
// and several "shipped" fixes were debugged as code bugs when the code had
// simply never arrived. This makes that readable in five seconds.
//
// Tap to share, so it can be pasted into a bug report. Uses React Native's
// built-in Share rather than expo-clipboard, which is not a dependency here.
import { useState } from 'react';
import { View, Text, Pressable, Share } from 'react-native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { useTheme } from './components';
import { sp, radius, hairline, type as ty, numeric } from '../theme/scale';

/** Short form of an update UUID — enough to match against `eas update:list`. */
const shortId = (id: string | null): string => (id ? id.slice(0, 8) : '—');

export function BuildInfo() {
  const t = useTheme();
  const [copied, setCopied] = useState(false);

  const appVersion = Constants.expoConfig?.version ?? '—';
  // In development (and in Expo Go) there is no embedded update to report.
  const embedded = Updates.isEmbeddedLaunch;
  const rows: [string, string][] = [
    ['App version', appVersion],
    ['Runtime', Updates.runtimeVersion ?? '—'],
    ['Channel', Updates.channel ?? 'none (dev build)'],
    ['Update', embedded ? 'embedded (no OTA applied)' : shortId(Updates.updateId)],
    ['Published', Updates.createdAt ? Updates.createdAt.toLocaleString() : '—'],
  ];

  const share = async () => {
    const text = 'Repple build\n' + rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    try { await Share.share({ message: text }); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <Pressable onPress={share} accessibilityRole="button" accessibilityLabel="Share build info"
      style={{ backgroundColor: t.surface, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.sm }}>
      {rows.map(([k, v], i) => (
        <View key={k} style={{
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          paddingVertical: 9, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
        }}>
          <Text style={{ ...ty.label, color: t.ink2 }}>{k}</Text>
          <Text style={{ ...ty.label, ...numeric, color: t.ink, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>{v}</Text>
        </View>
      ))}
      <Text style={{ ...ty.caption, color: copied ? t.brand : t.ink3, paddingVertical: sp.sm }}>
        {copied ? 'Shared' : 'Tap to share'}
      </Text>
    </Pressable>
  );
}
