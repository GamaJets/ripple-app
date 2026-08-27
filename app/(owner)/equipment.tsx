// Owner · Equipment register. What the gym owns, what is down, and what is
// about to need a service.
//
// The rules behind this screen already shipped in src/lib/gymEquipment.ts with
// tests; until now nothing rendered them. Everything here is a view onto that
// library — no maths lives in this file.
//
// Two distinctions the screen is careful to preserve, because collapsing them
// is what makes a maintenance list useless:
//
//  · "unscheduled" and "unrecorded" are different. The first means the gym
//    decided this kit needs no service schedule. The second means it set one
//    and never logged a service — that is the row worth chasing, and merging
//    them into "no service due" would hide it.
//
//  · A register with nothing in it does not mean a gym with no equipment. Any
//    count derived from an empty register renders as a dash and a prompt to
//    add the kit, never as a confident zero.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import {
  fetchEquipment, addEquipment, setStatus, recordService,
  summariseRegister, needsAttention, serviceState, nextServiceDue,
  type Equipment, type ServiceState,
} from '../../src/lib/gymEquipment';

const todayIso = () => new Date().toISOString().slice(0, 10);

const STATE_LABEL: Record<ServiceState, string> = {
  overdue: 'Overdue',
  due: 'Due',
  unrecorded: 'Never serviced',
  ok: 'In date',
  unscheduled: 'No schedule',
};

function toneFor(t: Theme, s: ServiceState): string {
  if (s === 'overdue') return t.crit;
  if (s === 'due') return t.s3;
  if (s === 'unrecorded') return t.ink3;
  if (s === 'ok') return t.brand;
  return t.ink3;
}

function Pill({ t, state }: { t: Theme; state: ServiceState }) {
  const c = toneFor(t, state);
  return (
    <View style={{ borderWidth: hairline, borderColor: c, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2 }}>
      <Text style={{ ...ty.micro, color: c }}>{STATE_LABEL[state]}</Text>
    </View>
  );
}

export default function OwnerEquipment() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useTenant();

  const [items, setItems] = useState<Equipment[] | null>(null);   // null = not loaded yet
  const [failed, setFailed] = useState(false);                    // the register read itself failed
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [qty, setQty] = useState('1');
  const [interval, setInterval] = useState('');

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    try {
      setItems(await fetchEquipment(supabase, tenant.id));
      setFailed(false);
    } catch (e) {
      reportError('equipment.fetch', e);
      // NOT `setItems([])`. An empty array here would have made a read that
      // never came back render as the register the header comment promises it
      // will not invent: "Nothing recorded yet", nothing needing attention,
      // and every count sitting at a dash for the wrong reason. An owner
      // checking whether anything is due a service would have been shown a
      // clean board by a query that failed, and walked past a treadmill that
      // was overdue. Null keeps it "not known" and `failed` says which.
      setItems(null);
      setFailed(true);
    }
  }, [tenant?.id]);

  useEffect(() => { void load(); }, [load]);

  const today = todayIso();
  const loaded = items !== null;
  const list = items ?? [];
  const sum = loaded ? summariseRegister(list, today) : null;
  const queue = loaded ? needsAttention(list, today) : [];

  const commitAdd = async () => {
    const n = name.trim();
    if (!n || !tenant?.id) return;
    const quantity = parseInt(qty, 10);
    const days = parseInt(interval, 10);
    setBusy(true);
    try {
      await addEquipment(supabase, tenant.id, {
        name: n,
        category: category.trim() || null,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        // Blank means "this kit needs no schedule" — a decision, not a gap.
        serviceIntervalDays: Number.isFinite(days) && days > 0 ? days : null,
      });
      setAddOpen(false);
      setName(''); setCategory(''); setQty('1'); setInterval('');
      await load();
    } catch (e) {
      reportError('equipment.add', e);
      Alert.alert('Could not add that', 'The item was not saved. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  const markServiced = (e: Equipment) => {
    Alert.alert('Serviced today?', `${e.name} will be recorded as serviced on ${today}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Record', onPress: async () => {
        try { await recordService(supabase, e.id, today); await load(); }
        catch (err) { reportError('equipment.service', err); }
      } },
    ]);
  };

  const toggleStatus = (e: Equipment) => {
    const next = e.status === 'in_service' ? 'out_of_service' : 'in_service';
    const verb = next === 'out_of_service' ? 'Take out of service' : 'Put back in service';
    Alert.alert(verb + '?', `${e.name}${e.quantity > 1 ? ` (${e.quantity} units)` : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: verb, style: next === 'out_of_service' ? 'destructive' : 'default', onPress: async () => {
        try { await setStatus(supabase, e.id, next); await load(); }
        catch (err) { reportError('equipment.status', err); }
      } },
    ]);
  };

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12 } as const;
  const lab = { ...ty.caption, color: t.ink2, marginBottom: 6 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg, marginBottom: sp.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="chevron" size={20} color={t.ink3} />
          </Pressable>
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }}>Equipment</Text>
        </View>

        <Hero
          label="Needing attention"
          figure={!loaded ? '—' : String(queue.length)}
          note={failed
            ? 'The register could not be read, so nothing here is known — that is a failed read, not an all-clear.'
            : !loaded
            ? 'Reading the register…'
            : list.length === 0
              ? 'Nothing on the register yet — add your kit and this becomes the maintenance list.'
              : queue.length === 0
                ? 'Every scheduled item is in date.'
                : `${sum?.overdue ?? 0} overdue · ${sum?.due ?? 0} due · ${sum?.unrecorded ?? 0} never serviced`}
        />

        <Rule />

        <Section>
          <SectionHead title="The register" />
          <KpiRow items={[
            { label: 'Items', value: !loaded || list.length === 0 ? '—' : String(sum!.items) },
            { label: 'Usable units', value: !loaded || list.length === 0 ? '—' : String(sum!.usableUnits) },
            { label: 'Out of service', value: !loaded || list.length === 0 ? '—' : String(sum!.downUnits) },
          ]} />
          {failed ? (
            <Flag tone={t.crit} style={{ marginTop: sp.md }}>
              These are blank because the read failed, not because the register is empty. Check
              your connection and pull the screen again before assuming nothing is due.
            </Flag>
          ) : loaded && list.length === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              An empty register is not an empty gym. These stay blank until the kit is entered,
              rather than reporting a confident zero.
            </Text>
          ) : null}
        </Section>

        <Rule />

        {queue.length > 0 ? (
          <>
            <Section>
              <SectionHead title="Needs attention" />
              {queue.map(({ item, state }, i) => (
                <View key={item.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{item.name}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {item.category || 'Uncategorised'}
                        {item.quantity > 1 ? ` · ${item.quantity} units` : ''}
                        {state === 'unrecorded'
                          ? ' · schedule set, never logged'
                          : nextServiceDue(item) ? ` · due ${nextServiceDue(item)}` : ''}
                      </Text>
                    </View>
                    <Pill t={t} state={state} />
                    <Pressable onPress={() => markServiced(item)} hitSlop={8}
                      accessibilityRole="button" accessibilityLabel={`Record service for ${item.name}`}
                      style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                      <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Serviced</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </Section>
            <Rule />
          </>
        ) : null}

        <Section>
          <SectionHead title={loaded && list.length ? `All kit · ${list.length}` : 'All kit'} />
          {failed ? (
            <Flag tone={t.crit}>
              The register could not be read. This is not a list of your kit — it is nothing at
              all. Check your connection and try again.
            </Flag>
          ) : !loaded ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Loading…</Text>
          ) : list.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nothing recorded yet. Add a treadmill, a rack, a set of bikes — anything you would
              notice missing.
            </Text>
          ) : list.map((e, i) => {
            const st = serviceState(e, today);
            const retired = e.status === 'retired';
            const down = e.status === 'out_of_service';
            return (
              <View key={e.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, opacity: retired ? 0.5 : 1 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{e.name}</Text>
                      {e.identifier ? <Text style={{ ...ty.micro, ...numeric, color: t.ink3 }}>{e.identifier}</Text> : null}
                    </View>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {e.category || 'Uncategorised'}
                      {e.quantity > 1 ? ` · ${e.quantity} units` : ''}
                      {down ? ' · out of service' : retired ? ' · retired' : ''}
                    </Text>
                  </View>
                  {!retired ? <Pill t={t} state={st} /> : null}
                  {!retired ? (
                    <Pressable onPress={() => toggleStatus(e)} hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${down ? 'Put back in service' : 'Take out of service'}: ${e.name}`}
                      style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface2, borderRadius: radius.sm }}>
                      <Icon name={down ? 'check' : 'wrench'} size={15} color={down ? t.brand : t.ink2} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Section>

        <View style={{ marginTop: sp.lg }}>
          <Cta label="Add equipment" wide onPress={() => setAddOpen(true)} />
        </View>
      </ScrollView>

      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)} />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter }}>
            <Text style={{ ...ty.head, color: t.ink }}>Add equipment</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
              One row per kind of kit. Use quantity for identical units.
            </Text>

            <Text style={lab}>Name</Text>
            <TextInput value={name} onChangeText={setName} autoFocus placeholder="e.g. Concept2 rower"
              placeholderTextColor={t.ink3} returnKeyType="next" style={inp} accessibilityLabel="Equipment name" />

            <Text style={{ ...lab, marginTop: sp.md }}>Category</Text>
            <TextInput value={category} onChangeText={setCategory} placeholder="e.g. Cardio — used by the class capacity check"
              placeholderTextColor={t.ink3} style={inp} accessibilityLabel="Category" />

            <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.md }}>
              <View style={{ flex: 1 }}>
                <Text style={lab}>Quantity</Text>
                <TextInput value={qty} onChangeText={setQty} keyboardType="numeric" style={inp} accessibilityLabel="Quantity" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={lab}>Service every (days)</Text>
                <TextInput value={interval} onChangeText={setInterval} keyboardType="numeric"
                  placeholder="Optional" placeholderTextColor={t.ink3} returnKeyType="done"
                  onSubmitEditing={() => { void commitAdd(); }} style={inp} accessibilityLabel="Service interval in days" />
              </View>
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }}>
              Leave the interval blank for kit that needs no schedule. That is recorded as a
              decision, not as a missing service.
            </Text>

            <Pressable disabled={!name.trim() || busy} onPress={commitAdd}
              style={{ backgroundColor: name.trim() && !busy ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginBottom: sp.sm }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: name.trim() && !busy ? t.brandInk : t.ink3 }}>
                {busy ? 'Adding…' : 'Add to the register'}
              </Text>
            </Pressable>
            <Ghost label="Cancel" onPress={() => setAddOpen(false)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
