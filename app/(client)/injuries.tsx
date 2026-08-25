// Client · Injuries & limitations. Disclose injuries so the AI coach, your
// trainer, and the Train tab train AROUND them (safer swaps, cautions). Add an
// area, severity and note; mark recovered when you heal; delete anytime. Stored
// in the shared client profile (persisted). Guidance only — not medical advice.
//
// Re-skinned onto the kit (`src/ui/kit`) + scale (`src/theme/scale`): the
// per-injury bordered boxes became hairline-separated rows, the disclaimer
// became the screen's one <Notice>, and severity is a coloured dot beside ink
// text rather than coloured text. Every route, hook and branch is unchanged.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { INJURY_AREAS, areaLabel, newInjuryId, type InjurySeverity } from '../../src/lib/injuries';

const SEVS: { id: InjurySeverity; label: string }[] = [
  { id: 'mild', label: 'Mild' }, { id: 'moderate', label: 'Moderate' }, { id: 'severe', label: 'Severe' },
];

export default function Injuries() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState('knee');
  const [sev, setSev] = useState<InjurySeverity>('moderate');
  const [note, setNote] = useState('');

  const active = c.injuries.filter((i) => i.status === 'active');
  const past = c.injuries.filter((i) => i.status === 'recovered');
  const sevColor = (s: InjurySeverity) => (s === 'severe' ? t.crit : s === 'moderate' ? t.s3 : t.ink3);

  const save = () => {
    c.addInjury({ id: newInjuryId(), area, severity: sev, status: 'active', note: note.trim() || undefined, at: new Date().toISOString() });
    setNote(''); setSev('moderate'); setArea('knee'); setOpen(false);
  };

  // One injury: a status dot, the area, its severity as ink text, and its two
  // actions. Divided by a hairline rather than boxed.
  const Row = ({ id, areaId, severity, status, note: nt, first }: { id: string; areaId: string; severity: InjurySeverity; status: string; note?: string; first?: boolean }) => (
    <View style={{ paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: status === 'active' ? sevColor(severity) : t.ink3 }} />
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{areaLabel(areaId)}</Text>
        <Text style={{ ...ty.caption, color: t.ink2, textTransform: 'capitalize' }}>{status === 'active' ? severity : 'recovered'}</Text>
      </View>
      {nt ? <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{nt}</Text> : null}
      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
        {status === 'active' ? (
          <Ghost label="Mark recovered" icon="check" onPress={() => c.updateInjury(id, { status: 'recovered' })} />
        ) : (
          <Ghost label="Reactivate" onPress={() => c.updateInjury(id, { status: 'active' })} />
        )}
        <Ghost label="Delete" onPress={() => c.removeInjury(id)} />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Training</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Injuries & limitations</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }}>Your coach and your plan train around these — flagging and swapping risky moves.</Text>

        <Notice tone={t.s3} kicker="Guidance only" title="Not medical advice"
          note="For pain, a new injury, or a diagnosis, see a doctor or physio before training." />

        <View style={{ marginTop: sp.md }}>
          <Cta label="Disclose an injury" onPress={() => setOpen(true)} wide />
        </View>

        {active.length > 0 ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Active" note={String(active.length)} />
              {active.map((i, idx) => <Row key={i.id} id={i.id} areaId={i.area} severity={i.severity} status={i.status} note={i.note} first={idx === 0} />)}
            </Section>
          </View>
        ) : null}

        {past.length > 0 ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Recovered" note={String(past.length)} />
              {past.map((i, idx) => <Row key={i.id} id={i.id} areaId={i.area} severity={i.severity} status={i.status} note={i.note} first={idx === 0} />)}
            </Section>
          </View>
        ) : null}

        {c.injuries.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
            <Icon name="check" size={30} color={t.ink3} />
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2, marginTop: sp.md }}>No injuries disclosed</Text>
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs, maxWidth: 260 }}>If something's bothering you, add it here so your plan can adapt.</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: layout.gutter, paddingBottom: sp.xxl, maxHeight: '88%', ...elevation.e2 }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Disclose an injury</Text>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Area</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.lg }}>
              {INJURY_AREAS.map((a) => { const on = area === a.id; return (
                <Pressable key={a.id} onPress={() => setArea(a.id)} style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{a.label}</Text>
                </Pressable>); })}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Severity</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              {SEVS.map((sv) => { const on = sev === sv.id; return (
                <Pressable key={sv.id} onPress={() => setSev(sv.id)} style={{ flex: 1, paddingVertical: sp.md, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{sv.label}</Text>
                </Pressable>); })}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Note (optional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="e.g. sharp on deep squats; cleared for light work" placeholderTextColor={t.ink3} multiline
              style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 64, marginBottom: sp.lg, textAlignVertical: 'top' }} />

            <Cta label="Save" onPress={save} wide />
            <Pressable onPress={() => setOpen(false)} style={{ paddingVertical: sp.lg, alignItems: 'center' }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
              </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
