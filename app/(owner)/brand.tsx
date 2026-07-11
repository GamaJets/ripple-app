import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
const COLORS = ['#2dd4bf', '#f59e0b', '#a855f7', '#ef4444', '#3b82f6', '#ec4899', '#84cc16'];
export default function OwnerBrand() {
  const t = useTheme();
  const [name, setName] = useState('Repple');
  const [color, setColor] = useState('#2dd4bf');
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 } as const;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>White-label studio</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Rebrand the whole app — each trainer can inherit or set their own</Text>
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>App name</Text>
          <TextInput value={name} onChangeText={setName} style={[inp, { marginBottom: 14 }]} />
          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Primary colour</Text>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (<Pressable key={c} onPress={() => setColor(c)} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c, borderWidth: color === c ? 3 : 0, borderColor: t.ink }} />))}
          </View>
        </View>
        <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Live preview</Text>
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: t.surface2, borderBottomWidth: 1, borderBottomColor: t.ring }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} /></View>
            </View>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{name}</Text>
          </View>
          <View style={{ padding: 16 }}>
            <View style={{ backgroundColor: t.surface2, borderRadius: 12, padding: 14, marginBottom: 12 }}><Text style={{ color: t.ink3, fontSize: 12 }}>Daily target</Text><Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', textTransform: 'capitalize' }}>1,980<Text style={{ fontSize: 12, color: t.ink3 }}> kcal</Text></Text></View>
            <View style={{ backgroundColor: color, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}><Text style={{ color: '#04211d', fontWeight: '800' }}>Start today's workout</Text></View>
          </View>
        </View>
        <Text style={{ color: t.ink3, fontSize: 12, marginTop: 14 }}>On Studio plans each trainer gets this panel for their own client app — their logo, colours, and domain. You keep the platform fee.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
