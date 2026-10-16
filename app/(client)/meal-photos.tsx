// Client · Meal Photos. Snap a plate, add a note or macros if you like, and
// your coach sees it — nobody else (part 3560). Their comments land here.
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { Section, PageHead, Cta, Ghost, Segmented } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { MealPhotoFeed } from '../../src/ui/MealPhotoFeed';
import { pickMealPhoto, saveMealPhoto, type MealSlot } from '../../src/ui/mealSnaps';
import { Image } from 'react-native';

const num = (s: string) => { const v = Number(s.replace(',', '.')); return s.trim() && Number.isFinite(v) && v >= 0 ? v : null; };

export default function MealPhotos() {
  const t = useTheme();
  const [uid, setUid] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [meal, setMeal] = useState<MealSlot | 'none'>('none');
  const [note, setNote] = useState('');
  const [kcal, setKcal] = useState(''); const [p, setP] = useState(''); const [c, setC] = useState(''); const [f, setF] = useState('');
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let live = true;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (error) reportError('mealPhotos.screenAuth', error);
      if (live) setUid(data?.user?.id ?? null);
    });
    return () => { live = false; };
  }, []);

  const pick = async (src: 'camera' | 'library') => {
    const r = await pickMealPhoto(src);
    if (r.error) Alert.alert('Camera Unavailable', r.error);
    if (r.uri) setUri(r.uri);
  };
  const save = async () => {
    if (!uid || !uri || busy) return;
    setBusy(true);
    const err = await saveMealPhoto(uid, uri, {
      meal: meal === 'none' ? null : meal, note,
      kcal: num(kcal) != null ? Math.round(num(kcal)!) : null, protein: num(p), carbs: num(c), fat: num(f),
    });
    setBusy(false);
    if (err) { Alert.alert('Not Saved', err); return; }
    setUri(null); setNote(''); setKcal(''); setP(''); setC(''); setF(''); setMeal('none'); setRev((x) => x + 1);
  };
  const box = { ...ty.label, color: t.ink, paddingVertical: sp.sm, paddingHorizontal: sp.md, borderRadius: radius.md, backgroundColor: t.surface2 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <PageHead title="Meal Photos" subtitle="Seen by you and your coach only" />
        <Section>
          {uri ? (
            <View style={{ gap: sp.md }}>
              <Image source={{ uri }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: t.surface2 }} resizeMode="cover" accessibilityLabel="The photo you are about to share" />
              <Segmented value={meal} onChange={setMeal} options={[
                { key: 'none', label: 'Any' }, { key: 'breakfast', label: 'Breakfast' }, { key: 'lunch', label: 'Lunch' },
                { key: 'dinner', label: 'Dinner' }, { key: 'snack', label: 'Snack' },
              ]} scroll />
              <TextInput value={note} onChangeText={setNote} placeholder="Add a note (optional)" placeholderTextColor={t.ink3} maxLength={500} multiline style={box} accessibilityLabel="Note" />
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <TextInput value={kcal} onChangeText={setKcal} placeholder="kcal" placeholderTextColor={t.ink3} keyboardType="numeric" style={{ ...box, flex: 1 }} accessibilityLabel="Calories" />
                <TextInput value={p} onChangeText={setP} placeholder="Protein g" placeholderTextColor={t.ink3} keyboardType="numeric" style={{ ...box, flex: 1 }} accessibilityLabel="Protein in grams" />
                <TextInput value={c} onChangeText={setC} placeholder="Carbs g" placeholderTextColor={t.ink3} keyboardType="numeric" style={{ ...box, flex: 1 }} accessibilityLabel="Carbs in grams" />
                <TextInput value={f} onChangeText={setF} placeholder="Fat g" placeholderTextColor={t.ink3} keyboardType="numeric" style={{ ...box, flex: 1 }} accessibilityLabel="Fat in grams" />
              </View>
              <Cta label={busy ? 'Saving…' : 'Share with Your Coach'} wide onPress={() => { void save(); }} />
              <Ghost label="Discard" onPress={() => setUri(null)} />
            </View>
          ) : (
            <View style={{ gap: sp.sm }}>
              <Cta label="Photograph a Meal" wide onPress={() => { void pick('camera'); }} />
              <Ghost label="Choose from Your Library" onPress={() => { void pick('library'); }} />
              <Text style={{ ...ty.caption, color: t.ink3 }}>Photos are stored privately. Only you and your coach can open them, and you can delete any of them.</Text>
            </View>
          )}
        </Section>
        <MealPhotoFeed clientId={uid} role="client" refreshKey={rev} title="Your Meals" />
      </ScrollView>
    </SafeAreaView>
  );
}
