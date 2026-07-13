// Trainer · Profile — the coach's public identity: photo, tagline, bio, specialties,
// what they offer, and session fee. A live preview shows how clients see it.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Image, Alert } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useCoachProfile } from '../../src/ui/coachProfile';

function Field({ t, label, value, onChangeText, placeholder, multiline, keyboardType }: { t: Theme; label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'numeric' }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.ink3}
        multiline={multiline}
        keyboardType={keyboardType}
        style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: multiline ? 96 : undefined, textAlignVertical: multiline ? 'top' : 'center' }}
      />
    </View>
  );
}

function ChipEditor({ t, items, onAdd, onRemove, value, setValue, placeholder }: { t: Theme; items: string[]; onAdd: () => void; onRemove: (i: number) => void; value: string; setValue: (v: string) => void; placeholder: string }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {items.map((it, i) => (
          <Pressable key={i} onPress={() => onRemove(i)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>{it}</Text>
            <Text style={{ color: t.ink3, fontSize: 14 }}>×</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={value} onChangeText={setValue} placeholder={placeholder} placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14 }} />
        <Pressable onPress={onAdd} style={{ backgroundColor: t.brand, borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Add</Text></Pressable>
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 44 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <View>
            <Text style={{ color: t.ink3, fontSize: 14 }}>Your Profile</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>How Clients See You</Text>
          </View>
          <Pressable onPress={() => router.push('/')} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 12 }}>Switch role</Text>
          </Pressable>
        </View>

        {/* Live preview */}
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            {p.photo ? (
              <Image source={{ uri: p.photo }} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: t.surface2 }} />
            ) : (
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.ring }}>
                <Text style={{ color: t.brand, fontWeight: '800', fontSize: 24 }}>{initials}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontSize: 19, fontWeight: '800' }}>{p.name}</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2 }}>{p.tagline}</Text>
            </View>
          </View>
          {p.specialties.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
              {p.specialties.map((s, i) => (
                <View key={i} style={{ backgroundColor: 'rgba(45,212,191,0.12)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ color: t.brand, fontWeight: '700', fontSize: 12 }}>{s}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 20, marginTop: 14 }}>{p.bio}</Text>
          {p.offers.length > 0 && (
            <View style={{ marginTop: 14 }}>
              <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>What I Offer</Text>
              {p.offers.map((o, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Icon name="check" size={14} color={t.brand} />
                  <Text style={{ color: t.ink, fontSize: 14 }}>{o}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.ring }}>
            <Text style={{ color: t.ink3, fontSize: 13 }}>Session rate</Text>
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>${p.sessionFee}<Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}> / session</Text></Text>
          </View>
        </View>

        {/* Editors */}
        <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, marginBottom: 12 }}>Edit Profile</Text>

        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Photo</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          <Pressable accessibilityLabel="Add profile photo from library" accessibilityRole="button" onPress={() => pickPhoto(false)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 4 }}><Icon name="plus" size={20} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Upload</Text></Pressable>
          <Pressable accessibilityLabel="Take a profile photo" accessibilityRole="button" onPress={() => pickPhoto(true)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 4 }}><Icon name="camera" size={20} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Take Photo</Text></Pressable>
          {p.photo ? <Pressable accessibilityLabel="Remove profile photo" accessibilityRole="button" onPress={() => p.setPhoto(null)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 4 }}><Icon name="minus" size={20} color={t.ink3} /><Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Remove</Text></Pressable> : null}
        </View>

        <Field t={t} label="Name" value={p.name} onChangeText={p.setName} placeholder="Coach name" />
        <Field t={t} label="Tagline" value={p.tagline} onChangeText={p.setTagline} placeholder="One line on what you do" />
        <Field t={t} label="Bio" value={p.bio} onChangeText={p.setBio} placeholder="Tell clients about your experience and approach" multiline />

        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Specialties</Text>
        <View style={{ marginBottom: 16 }}>
          <ChipEditor t={t} items={p.specialties} onAdd={addSpec} onRemove={(i) => p.setSpecialties(p.specialties.filter((_, x) => x !== i))} value={newSpec} setValue={setNewSpec} placeholder="e.g. Mobility" />
        </View>

        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>What You Offer</Text>
        <View style={{ marginBottom: 16 }}>
          <ChipEditor t={t} items={p.offers} onAdd={addOffer} onRemove={(i) => p.setOffers(p.offers.filter((_, x) => x !== i))} value={newOffer} setValue={setNewOffer} placeholder="e.g. Nutrition coaching" />
        </View>

        <Field t={t} label="Session Rate ($)" value={String(p.sessionFee)} onChangeText={(v) => p.setSessionFee(parseInt(v.replace(/[^0-9]/g, ''), 10) || 0)} placeholder="75" keyboardType="numeric" />

        <Pressable onPress={() => router.push('/(trainer)/payments')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, padding: 15, marginTop: 6, marginBottom: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="people" size={19} color={t.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Payments</Text>
            <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>Get paid by clients — memberships & packs</Text>
          </View>
          <Text style={{ color: t.brand, fontWeight: '800', fontSize: 16 }}>›</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/(trainer)/billing')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, padding: 15, marginTop: 6, marginBottom: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="chart" size={19} color={t.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Billing & subscription</Text>
            <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>Your plan, payment method & invoices</Text>
          </View>
          <Text style={{ color: t.brand, fontWeight: '800', fontSize: 16 }}>›</Text>
        </Pressable>

        <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 14, marginTop: 4 }}>
          <Text style={{ color: t.ink3, fontSize: 12, lineHeight: 18 }}>Changes save automatically and appear on your clients' booking screen. Tap a chip to remove it.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
