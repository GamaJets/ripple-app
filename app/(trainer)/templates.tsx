// Trainer · Program Templates. The coach's saved weekly programs — build once,
// assign to many. Tap a template to bulk-assign it to any selection of clients
// (each gets it on their Train tab), open it in the builder, or delete it.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional, modal and route from
// the previous version is preserved — only the presentation changed: the bordered
// template cards and the dashed "build" button became hairline-separated rows and
// a single primary action, and the Georgia serif headers are gone.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
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

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your library</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Program templates</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Build once, assign to many. Save any program from the builder.
        </Text>

        <Section>
          <Cta label="Build a new program" wide onPress={() => router.push('/(trainer)/builder')} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Templates" note={templates.length ? String(templates.length) : undefined} />
          {templates.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No templates yet — build a program above and save it here.</Text>
          ) : null}
          {templates.map((tpl, i) => (
            <View key={tpl.id} style={{ paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <View style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="grid" size={18} color={t.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{tpl.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{dayCount(tpl)} days · {exCount(tpl)} exercises{tpl.id.startsWith('seed_') ? ' · starter' : ''}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
                <View style={{ flex: 1 }}><Cta label="Assign to clients" wide onPress={() => openAssign(tpl)} /></View>
                <Ghost label="Edit" onPress={() => router.push({ pathname: '/(trainer)/builder', params: { templateId: tpl.id } })} />
                {!tpl.id.startsWith('seed_') ? (
                  <Pressable onPress={() => Alert.alert('Delete template?', `Remove “${tpl.name}”?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => removeTemplate(tpl.id) }])}
                    hitSlop={8} accessibilityRole="button" accessibilityLabel={'Delete ' + tpl.name} style={{ padding: 8 }}>
                    <Icon name="minus" size={17} color={t.ink3} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </Section>

      </ScrollView>

      {/* ── bulk-assign sheet ────────────────────────────────────────────── */}
      <Modal visible={!!assignTpl} transparent animationType="slide" onRequestClose={() => setAssignTpl(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAssignTpl(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '80%', ...elevation.e2 }}>
          {assignTpl && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
              <Text style={{ ...ty.title, color: t.ink }}>Assign “{assignTpl.name}”</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>Pick the clients who should get this program.</Text>
              {roster.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>No clients yet — add or invite a client first.</Text>
              ) : null}
              {roster.map((c, i) => {
                const on = !!picked[c.id];
                return (
                  <Pressable key={c.id} onPress={() => setPicked((p) => ({ ...p, [c.id]: !p[c.id] }))}
                    accessibilityRole="button" accessibilityLabel={c.name}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: on ? t.brand : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      {on ? <Icon name="check" size={14} color={t.brandInk} /> : null}
                    </View>
                    <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.goal}</Text>
                    </View>
                  </Pressable>
                );
              })}
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
                <Ghost label="Select all" onPress={() => setPicked(Object.fromEntries(roster.map((c) => [c.id, true])))} />
                <View style={{ flex: 1 }}>
                  <Cta label={`Assign to ${pickedIds.length || 0} client${pickedIds.length === 1 ? '' : 's'}`} wide
                    disabled={pickedIds.length === 0} onPress={doAssign} />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
