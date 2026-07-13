// Client · Injuries & limitations. Disclose injuries so the AI coach, your
// trainer, and the Train tab train AROUND them (safer swaps, cautions). Add an
// area, severity and note; mark recovered when you heal; delete anytime. Stored
// in the shared client profile (persisted). Guidance only — not medical advice.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Icon } from '../../src/ui/Icon';
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

  const Row = ({ id, areaId, severity, status, note: nt }: { id: string; areaId: string; severity: InjurySeverity; status: string; note?: string }) => (
    <View style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: status === 'active' ? sevColor(severity) : t.ink3 }} />
        <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, flex: 1 }}>{areaLabel(areaId)}</Text>
        <View style={{ backgroundColor: t.surface2, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: t.ring }}>
          <Text style={{ color: status === 'active' ? sevColor(severity) : t.ink3, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' }}>{status === 'active' ? severity : 'recovered'}</Text>
        </View>
      </View>
      {nt ? <Text style={{ color: t.ink3, fontSize: 13, marginTop: 8 }}>{nt}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        {status === 'active' ? (
          <Pressable onPress={() => c.updateInjury(id, { status: 'recovered' })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Icon name="check" size={14} color={t.brand} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Mark recovered</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => c.updateInjury(id, { status: 'active' })} style={{ backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Reactivate</Text>
          </Pressable>
        )}
        <Pressable onPress={() => c.removeInjury(id)} style={{ backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Icon name="back" size={22} color={t.ink2} />
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Injuries & limitations</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 14 }}>Your coach and your plan train around these — flagging and swapping risky moves.</Text>

        <View style={{ backgroundColor: 'rgba(201,133,0,0.12)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(201,133,0,0.35)', padding: 12, marginBottom: 18, flexDirection: 'row', gap: 8 }}>
          <Icon name="heart" size={15} color={t.s3} />
          <Text style={{ color: t.ink2, fontSize: 12.5, flex: 1, lineHeight: 18 }}>Guidance only, not medical advice. For pain, a new injury, or a diagnosis, see a doctor or physio before training.</Text>
        </View>

        <Pressable onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.brand, borderRadius: 14, paddingVertical: 14, marginBottom: 20 }}>
          <Icon name="plus" size={16} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Disclose an injury</Text>
        </Pressable>

        {active.length > 0 ? <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Active</Text> : null}
        {active.map((i) => <Row key={i.id} id={i.id} areaId={i.area} severity={i.severity} status={i.status} note={i.note} />)}

        {past.length > 0 ? <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 10 }}>Recovered</Text> : null}
        {past.map((i) => <Row key={i.id} id={i.id} areaId={i.area} severity={i.severity} status={i.status} note={i.note} />)}

        {c.injuries.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Icon name="check" size={30} color={t.ink3} />
            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 15, marginTop: 10 }}>No injuries disclosed</Text>
            <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 4, maxWidth: 260 }}>If something's bothering you, add it here so your plan can adapt.</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30, maxHeight: '88%' }}>
          <ScrollView>
            <Text style={{ color: t.ink, fontSize: 21, fontWeight: '700', fontFamily: 'Georgia', marginBottom: 16 }}>Disclose an injury</Text>
            <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Area</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
              {INJURY_AREAS.map((a) => { const on = area === a.id; return (
                <Pressable key={a.id} onPress={() => setArea(a.id)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                  <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{a.label}</Text>
                </Pressable>); })}
            </View>
            <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Severity</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
              {SEVS.map((sv) => { const on = sev === sv.id; return (
                <Pressable key={sv.id} onPress={() => setSev(sv.id)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                  <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 14 }}>{sv.label}</Text>
                </Pressable>); })}
            </View>
            <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Note (optional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="e.g. sharp on deep squats; cleared for light work" placeholderTextColor={t.ink3} multiline style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 64, marginBottom: 18, textAlignVertical: 'top' }} />
            <Pressable onPress={save} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Save</Text>
            </Pressable>
            <Pressable onPress={() => setOpen(false)} style={{ paddingVertical: 14, alignItems: 'center' }}>
              <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 14 }}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
