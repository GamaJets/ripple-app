// Trainer · Program Templates. The coach's saved weekly programs — build once,
// assign to many. Tap a template to bulk-assign it to any selection of clients
// (each gets it on their Train tab), open it in the builder, or delete it.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramTemplates, type ProgramTemplate } from '../../src/ui/programTemplates';
import { notifySuccess } from '../../src/ui/haptics';

export default function Templates() {
  const t = useTheme();
  const router = useRouter();
  const { templates, removeTemplate } = useProgramTemplates();
  const { roster } = useRoster();
  const { assignProgram } = useAssignedPrograms();
  const [assignTpl, setAssignTpl] = useState<ProgramTemplate | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const openAssign = (tpl: ProgramTemplate) => { setPicked({}); setAssignTpl(tpl); };
  const pickedIds = Object.keys(picked).filter((k) => picked[k]);
  const doAssign = () => {
    if (!assignTpl || pickedIds.length === 0) return;
    pickedIds.forEach((id) => assignProgram(id, assignTpl.program));
    notifySuccess();
    const tpl = assignTpl; const n = pickedIds.length;
    setAssignTpl(null);
    Alert.alert('Assigned', `“${tpl.name}” assigned to ${n} client${n > 1 ? 's' : ''}. They'll see it on their Train tab.`);
  };

  const dayCount = (tpl: ProgramTemplate) => tpl.program.days.length;
  const exCount = (tpl: ProgramTemplate) => tpl.program.days.reduce((a, d) => a + d.exercises.length, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Program templates</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Build once, assign to many. Save any program from the builder.</Text>

        <Pressable onPress={() => router.push('/(trainer)/builder')} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.brand, borderStyle: 'dashed', paddingVertical: 14, alignItems: 'center', marginBottom: 18, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          <Icon name="plus" size={16} color={t.brand} />
          <Text style={{ color: t.brand, fontWeight: '800', fontSize: 14 }}>Build a new program</Text>
        </Pressable>

        {templates.map((tpl) => (
          <View key={tpl.id} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="grid" size={20} color={t.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{tpl.name}</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{dayCount(tpl)} days · {exCount(tpl)} exercises{tpl.id.startsWith('seed_') ? ' · starter' : ''}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Pressable onPress={() => openAssign(tpl)} style={{ flex: 1, backgroundColor: t.brand, borderRadius: 11, paddingVertical: 11, alignItems: 'center' }}>
                <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Assign to clients</Text>
              </Pressable>
              <Pressable onPress={() => router.push({ pathname: '/(trainer)/builder', params: { templateId: tpl.id } })} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 11, paddingHorizontal: 14, justifyContent: 'center' }}>
                <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>Edit</Text>
              </Pressable>
              {!tpl.id.startsWith('seed_') ? (
                <Pressable onPress={() => Alert.alert('Delete template?', `Remove “${tpl.name}”?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => removeTemplate(tpl.id) }])} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, justifyContent: 'center' }}>
                  <Icon name="minus" size={16} color={t.ink3} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Bulk-assign sheet */}
      <Modal visible={!!assignTpl} transparent animationType="slide" onRequestClose={() => setAssignTpl(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAssignTpl(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '80%' }}>
          {assignTpl && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
              <Text style={{ color: t.ink, fontSize: 21, fontWeight: '700', fontFamily: 'Georgia', marginBottom: 2 }}>Assign “{assignTpl.name}”</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 16 }}>Pick the clients who should get this program.</Text>
              {roster.map((c) => {
                const on = !!picked[c.id];
                return (
                  <Pressable key={c.id} onPress={() => setPicked((p) => ({ ...p, [c.id]: !p[c.id] }))} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                    <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: on ? t.brand : t.ring, backgroundColor: on ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {on ? <Icon name="check" size={14} color={t.brandInk} /> : null}
                    </View>
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>{c.name}</Text>
                      <Text style={{ color: t.ink3, fontSize: 12 }}>{c.goal}</Text>
                    </View>
                  </Pressable>
                );
              })}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                <Pressable onPress={() => setPicked(Object.fromEntries(roster.map((c) => [c.id, true])))} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, justifyContent: 'center' }}>
                  <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>Select all</Text>
                </Pressable>
                <Pressable onPress={doAssign} disabled={pickedIds.length === 0} style={{ flex: 1, backgroundColor: pickedIds.length ? t.brand : t.surface2, borderColor: pickedIds.length ? t.brand : t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
                  <Text style={{ color: pickedIds.length ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 14 }}>Assign to {pickedIds.length || 0} client{pickedIds.length === 1 ? '' : 's'}</Text>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
