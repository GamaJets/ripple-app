// Trainer · Profile — the coach's public identity: photo, tagline, bio, specialties,
// what they offer, and session fee. A live preview shows how clients see it.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: no hero (a profile has
// no single live number to lead with), hairline-separated sections instead of
// five stacked bordered boxes, and `<ListRow>` for the navigational rows.
//
// The Find a Trainer directory opt-in keeps its switch affordance and its
// explanatory copy verbatim — only its styling moved onto the scale.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Image, Alert } from 'react-native';
import { Icon, type IconName } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Card, ListRow, QuickRow, Cta } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, value } from '../../src/theme/scale';
import { useCoachProfile } from '../../src/ui/coachProfile';

function Field({ t, label, value: val, onChangeText, placeholder, multiline, keyboardType }: { t: Theme; label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'numeric' }) {
  return (
    <View style={{ marginBottom: sp.lg }}>
      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{label}</Text>
      <TextInput
        value={val}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.ink3}
        multiline={multiline}
        keyboardType={keyboardType}
        style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: multiline ? 96 : undefined, textAlignVertical: multiline ? 'top' : 'center' }}
      />
    </View>
  );
}

function ChipEditor({ t, items, onAdd, onRemove, value: val, setValue, placeholder }: { t: Theme; items: string[]; onAdd: () => void; onRemove: (i: number) => void; value: string; setValue: (v: string) => void; placeholder: string }) {
  return (
    <View>
      {items.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.md }}>
          {items.map((it, i) => (
            <Pressable key={i} onPress={() => onRemove(i)} accessibilityRole="button" accessibilityLabel={'Remove ' + it}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{it}</Text>
              <Icon name="minus" size={12} color={t.ink3} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: sp.sm }}>
        <TextInput value={val} onChangeText={setValue} placeholder={placeholder} placeholderTextColor={t.ink3}
          style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
        <Cta label="Add" onPress={onAdd} />
      </View>
    </View>
  );
}

export default function CoachProfile() {
  const t = useTheme();
  const router = useRouter();
  const p = useCoachProfile();
  const [newOffer, setNewOffer] = useState('');
  const [newSpec, setNewSpec] = useState('');
  const initials = p.name.replace('Coach ', '').split(' ').map((x) => x[0]).join('').slice(0, 2);

  const pickPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow ' + (fromCamera ? 'camera' : 'photo library') + ' access to set your profile photo.'); return; }
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (!res.canceled && res.assets && res.assets[0]) p.setPhoto(res.assets[0].uri);
  };
  const addOffer = () => { const v = newOffer.trim(); if (v) { p.setOffers([...p.offers, v]); setNewOffer(''); } };
  const addSpec = () => { const v = newSpec.trim(); if (v) { p.setSpecialties([...p.specialties, v]); setNewSpec(''); } };

  // Upload / Take Photo, plus Remove only when there is a photo to remove.
  const photoActions: { icon: IconName; label: string; onPress: () => void }[] = [
    { icon: 'plus', label: 'Upload', onPress: () => pickPhoto(false) },
    { icon: 'camera', label: 'Take Photo', onPress: () => pickPhoto(true) },
  ];
  if (p.photo) photoActions.push({ icon: 'minus', label: 'Remove', onPress: () => p.setPhoto(null) });

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 44 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* ── header. No hero — a profile has no single live number ───────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, paddingBottom: sp.lg }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your profile</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>How clients see you</Text>
          </View>
        </View>

        {/* ── live preview: the one surface on this screen that groups ────── */}
        <Card style={{ marginBottom: sp.lg }}>
          <View style={{ flexDirection: 'row', gap: sp.lg, alignItems: 'center' }}>
            {p.photo ? (
              <Image source={{ uri: p.photo }} style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: t.surface2 }} />
            ) : (
              <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...value(20), color: t.brand }}>{initials}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.head, color: t.ink }} numberOfLines={1}>{p.name || 'Your name'}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{p.tagline || 'No tagline yet'}</Text>
            </View>
          </View>

          {p.specialties.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: sp.lg }}>
              {p.specialties.map((s, i) => (
                <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                  <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2 }}>{s}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={{ ...ty.body, color: p.bio ? t.ink2 : t.ink3, marginTop: sp.lg }}>{p.bio || 'No bio yet — clients read this first.'}</Text>

          {p.offers.length > 0 && (
            <View style={{ marginTop: sp.lg }}>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>What I Offer</Text>
              {p.offers.map((o, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: 6 }}>
                  <Icon name="check" size={14} color={t.brand} />
                  <Text style={{ ...ty.label, color: t.ink }}>{o}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: sp.lg, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>Session rate</Text>
            <Text style={{ ...value(20), color: t.ink }}>${p.sessionFee}<Text style={{ ...ty.caption, color: t.ink3 }}> / session</Text></Text>
          </View>
        </Card>

        <Rule />

        {/* ── photo ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Photo" />
          <QuickRow items={photoActions} />
        </Section>

        <Rule />

        {/* ── who you are ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Details" />
          <Field t={t} label="Name" value={p.name} onChangeText={p.setName} placeholder="Coach name" />
          <Field t={t} label="Tagline" value={p.tagline} onChangeText={p.setTagline} placeholder="One line on what you do" />
          <Field t={t} label="Bio" value={p.bio} onChangeText={p.setBio} placeholder="Tell clients about your experience and approach" multiline />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Specialties" note="Tap a chip to remove" />
          <ChipEditor t={t} items={p.specialties} onAdd={addSpec} onRemove={(i) => p.setSpecialties(p.specialties.filter((_, x) => x !== i))} value={newSpec} setValue={setNewSpec} placeholder="e.g. Mobility" />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="What you offer" note="Tap a chip to remove" />
          <ChipEditor t={t} items={p.offers} onAdd={addOffer} onRemove={(i) => p.setOffers(p.offers.filter((_, x) => x !== i))} value={newOffer} setValue={setNewOffer} placeholder="e.g. Nutrition coaching" />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Session rate" />
          <Field t={t} label="Session Rate ($)" value={String(p.sessionFee)} onChangeText={(v) => p.setSessionFee(parseInt(v.replace(/[^0-9]/g, ''), 10) || 0)} placeholder="75" keyboardType="numeric" />
        </Section>

        <Rule />

        {/* Public directory opt-in. Off by default and never set on the
            trainer's behalf — clients only see coaches who switched this on. */}
        <Section>
          <SectionHead title="Find a Trainer directory" />
          <Pressable
            onPress={() => p.setListed(!p.listed)}
            accessibilityRole="switch"
            accessibilityState={{ checked: p.listed }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.md,
              backgroundColor: t.surface, borderRadius: radius.md, padding: sp.lg, ...elevation.e1,
              ...(p.listed ? { borderWidth: hairline, borderColor: t.brand } : null),
            }}
          >
            <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="search" size={17} color={p.listed ? t.brand : t.ink3} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>List me in Find a Trainer</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{p.listed ? 'Clients browsing Repple can see your name, tagline, bio, specialties and rate, and can request coaching.' : 'Off — you are not visible to clients browsing for a coach.'}</Text>
            </View>
            <View style={{ width: 46, height: 27, borderRadius: radius.pill, backgroundColor: p.listed ? t.brand : t.surface3, borderWidth: hairline, borderColor: p.listed ? t.brand : t.ring, justifyContent: 'center', paddingHorizontal: 3 }}>
              <View style={{ width: 21, height: 21, borderRadius: radius.pill, backgroundColor: p.listed ? t.brandInk : t.ink3, alignSelf: p.listed ? 'flex-end' : 'flex-start' }} />
            </View>
          </Pressable>
        </Section>

        <Rule />

        {/* ── money ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Money" />
          <ListRow icon="search" title="User guide" note="What each tab does, any time"
            onPress={() => router.push('/guide')} />
          <ListRow icon="people" title="Payments" note="Get paid by clients — memberships & packs"
            onPress={() => router.push('/(trainer)/payments')} />
          <ListRow icon="chart" title="Billing & subscription" note="Your plan, payment method & invoices"
            onPress={() => router.push('/(trainer)/billing')} />
        </Section>

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>Changes save automatically and appear on your clients' booking screen. Tap a chip to remove it.</Text>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
