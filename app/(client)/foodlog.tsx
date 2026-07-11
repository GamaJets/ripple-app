import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { macrosFor } from '../../src/lib/nutrition';
import { useClientData } from '../../src/ui/clientData';

type Food = { n: string; k: number; p: number; c: number; f: number };
const FOOD_DB: Food[] = [
  { n: 'Chicken breast (150g)', k: 250, p: 47, c: 0, f: 5 }, { n: 'Greek yogurt (200g)', k: 130, p: 20, c: 9, f: 4 },
  { n: 'Banana', k: 105, p: 1, c: 27, f: 0 }, { n: 'Oats (60g)', k: 230, p: 8, c: 40, f: 5 },
  { n: 'Salmon fillet (160g)', k: 300, p: 34, c: 0, f: 18 }, { n: 'White rice (1 cup)', k: 205, p: 4, c: 45, f: 0 },
  { n: 'Whey shake', k: 160, p: 30, c: 5, f: 2 }, { n: 'Avocado (half)', k: 160, p: 2, c: 9, f: 15 },
  { n: 'Eggs (2)', k: 140, p: 12, c: 1, f: 10 }, { n: 'Almonds (30g)', k: 175, p: 6, c: 6, f: 15 },
  { n: 'Sweet potato (200g)', k: 180, p: 4, c: 41, f: 0 }, { n: 'Broccoli (150g)', k: 51, p: 4, c: 10, f: 0 },
];
const BARCODE = { n: 'Protein bar (barcode)', k: 210, p: 20, c: 21, f: 7 };
const PHOTO = { n: 'Chicken & quinoa bowl (photo)', k: 520, p: 46, c: 48, f: 14 };

export default function FoodLog() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const target = macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet });
  const [log, setLog] = useState<(Food & { via: string })[]>([{ ...FOOD_DB[1], via: 'search' }, { ...PHOTO, via: 'photo' }]);
  const [q, setQ] = useState('');
  const results = q ? FOOD_DB.filter((f) => f.n.toLowerCase().includes(q.toLowerCase())) : [];
  const add = (f: Food, via: string) => setLog([...log, { ...f, via }]);
  const remove = (i: number) => setLog(log.filter((_, x) => x !== i));
  const tot = log.reduce((a, f) => ({ k: a.k + f.k, p: a.p + f.p, c: a.c + f.c, f: a.f + f.f }), { k: 0, p: 0, c: 0, f: 0 });
  const bar = (v: number, tg: number, col: string) => (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surface3, marginTop: 4, overflow: 'hidden' }}><View style={{ height: 8, borderRadius: 4, backgroundColor: col, width: Math.min(100, Math.round((v / tg) * 100)) + '%' }} /></View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.push('/(client)/profile')} style={{ marginBottom: 8 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Food log</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Log by search, barcode, or photo — macros update live</Text>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 16 }}>Today vs target</Text><Text style={{ color: t.brand, fontWeight: '800', fontSize: 18 }}>{tot.k}<Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}>/{target.kcal} kcal</Text></Text></View>
          {[['Protein', tot.p, target.protein, t.brand], ['Carbs', tot.c, target.carbs, t.s1], ['Fat', tot.f, target.fat, t.s3]].map(([k, v, tg, col]) => (
            <View key={k as string} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{k as string}</Text><Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>{v as number}/{tg as number}g</Text></View>
              {bar(v as number, tg as number, col as string)}
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          <Pressable onPress={() => { add(BARCODE, 'barcode'); Alert.alert('Barcode scanned', BARCODE.n + ' added.'); }} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 4 }}><Text style={{ fontSize: 20 }}>📷</Text><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>Barcode</Text></Pressable>
          <Pressable onPress={() => { add(PHOTO, 'photo'); Alert.alert('Photo analysed', PHOTO.n + ' added (AI estimate).'); }} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 4 }}><Text style={{ fontSize: 20 }}>🍽️</Text><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>Photo</Text></Pressable>
        </View>
        <TextInput value={q} onChangeText={setQ} placeholder="Search foods…" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 8 }} />
        {results.map((f) => (
          <Pressable key={f.n} onPress={() => { add(f, 'search'); setQ(''); }} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 6, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: t.ink, fontSize: 14 }}>{f.n}</Text><Text style={{ color: t.ink3, fontSize: 13 }}>{f.k} kcal · +</Text>
          </Pressable>
        ))}

        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginTop: 10, marginBottom: 8 }}>Logged today</Text>
        {log.map((f, i) => (
          <View key={i} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}><Text style={{ color: t.ink, fontSize: 14, fontWeight: '600' }}>{f.n}</Text><Text style={{ color: t.ink3, fontSize: 12 }}>{f.k} kcal · P{f.p} C{f.c} F{f.f}</Text></View>
            <Pressable onPress={() => remove(i)} style={{ padding: 6 }}><Text style={{ color: t.ink3, fontSize: 16 }}>✕</Text></Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
