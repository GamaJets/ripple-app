// Client · Me → one group.
//
// The second level of the Me hub. Me is six cards; this is what is inside one
// of them. It holds no list of its own: it reads `meGroup` out of
// src/lib/features.ts, which is the only place the client app's screens are
// written down, so a screen added to the index appears here, in Explore and on
// the Me card's count in the same commit.
//
// That is the whole point of the change this file is part of. The Me hub used
// to be a second hand-written list (HUB_GROUPS in app/(client)/profile.tsx) and
// twice a screen ended up in neither list and became unreachable from anywhere
// in the app — ten the first time, eight the second, including the screen that
// changes a member's password. The header of src/lib/features.ts is the
// write-up; scripts/check-client-index.mjs is the gate.
//
// ── The missing param ──────────────────────────────────────────────────────
//
// `g` names the group. With no `g`, or an unknown one, this does NOT guess: it
// shows the six groups, which is the screen the member was on. A wrong guess
// here would be a screen confidently titled "Money" listing somebody's
// injuries.
import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useClientData } from '../../src/ui/clientData';
import { ME_GROUPS, meGroupFeatures, type MeGroupKey } from '../../src/lib/features';
import { Section, ListRow, PageHead, toneOf } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric } from '../../src/theme/scale';
import { FORWARD_ICON } from '../../src/ui/direction';

export default function MeGroup() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const { g } = useLocalSearchParams<{ g?: string }>();

  const solo = cd.coachingMode === 'solo';
  const group = ME_GROUPS.find((x) => x.key === g);
  const items = useMemo(
    () => (group ? meGroupFeatures(group.key as MeGroupKey).filter((f) => !(solo && f.soloHide)) : []),
    [group, solo],
  );
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <PageHead title={group ? group.title : 'Profile'} subtitle={group ? group.note : 'Pick a group'} />

        {group ? (
          <Section style={{ marginTop: sp.lg }}>
            {items.map((f) => (
              <ListRow key={f.route} icon={f.icon} tone={group.tone} title={f.label} note={f.note}
                onPress={() => router.push(f.route as any)} />
            ))}
          </Section>
        ) : (
          // No group named, so nothing is asserted about which one was meant.
          // The same six cards Me draws, so a member who arrived here by a
          // stale link is one tap from where they were going.
          <View style={{ gap: sp.sm, marginTop: sp.lg }}>
            {ME_GROUPS.map((x) => (
              <Pressable key={x.key} onPress={() => router.setParams({ g: x.key })}
                accessibilityRole="button" accessibilityLabel={`${x.title}. ${x.note}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, backgroundColor: t.surface, borderRadius: radius.lg, padding: sp.lg, borderStartWidth: 4, borderStartColor: toneOf(t, x.tone).mark, ...elevation.card }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ ...ty.head, color: t.ink }}>{x.title}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{x.note}</Text>
                </View>
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{meGroupFeatures(x.key).length}</Text>
                <Icon name={FORWARD_ICON} size={18} color={t.ink3} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
