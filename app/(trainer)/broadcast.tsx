// Trainer · Broadcast. Message a whole segment of clients at once — everyone, or
// a specific tag. Inserts into each client's thread and sends a push. OTA-safe.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero — a composer has no live number to lead with, so
// the segment, the recipient list and the message are three hairline-separated
// sections and the Georgia serif title is gone. Same segment logic, same insert,
// same push, same route.
//
// One claim removed: the confirmation said "Message delivered to N clients"
// while the insert's error was swallowed and the push is a best-effort no-op on
// builds without notifications — a delivery receipt the app never receives. It
// now reports what it can actually see (the rows written to the threads) and
// says so plainly when the write fails.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useClientTags } from '../../src/ui/clientTags';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { sendPush } from '../../src/ui/pushNotifications';

export default function Broadcast() {
  const t = useTheme();
  const router = useRouter();
  const { roster } = useRoster();
  const { allTags, tagsFor } = useClientTags();
  const [seg, setSeg] = useState<string | null>(null); // null = all
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const recipients = useMemo(() => roster.filter((c) => seg === null || tagsFor(c.id).includes(seg)), [roster, seg, tagsFor]);

  const send = async () => {
    const b = body.trim();
    if (!b || !recipients.length || busy) return;
    setBusy(true);
    try {
      if (USE_SUPABASE) {
        const { error } = await supabase.from('messages').insert(recipients.map((c) => ({ client_id: c.id, sender: 'coach', body: b })));
        if (error) { Alert.alert('Not sent', 'The message could not be written to your clients’ threads. Check your connection and try again.'); return; }
        sendPush(recipients.map((c) => c.id), 'Message from your coach', b, { route: '/(client)/messages' });
      }
      setBody('');
      Alert.alert('Sent', `Added to ${recipients.length} client thread${recipients.length === 1 ? '' : 's'}${seg ? ' in “' + seg + '”' : ''}.`);
    } catch {
      Alert.alert('Not sent', 'The message could not be written to your clients’ threads. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }}
      style={{ paddingHorizontal: sp.md + 2, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: active ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: '500', color: active ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your clients</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Broadcast</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Send one message to a whole segment of your clients.</Text>

        {/* ── the segment ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Send to" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }}>
            {chip('All clients', seg === null, () => setSeg(null))}
            {allTags.map((tg) => chip(tg, seg === tg, () => setSeg(tg === seg ? null : tg)))}
          </ScrollView>
        </Section>

        <Rule />

        {/* ── who that is ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Recipients" note={recipients.length ? `${recipients.length}` : undefined} />
          {recipients.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No clients in this segment.</Text>
          ) : (
            <Text style={{ ...ty.body, color: t.ink2 }} numberOfLines={2}>{recipients.map((c) => c.name).join(', ')}</Text>
          )}
        </Section>

        <Rule />

        {/* ── the message ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Message" />
          <TextInput value={body} onChangeText={setBody} placeholder="Your message…" placeholderTextColor={t.ink3} multiline
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 120, textAlignVertical: 'top', marginBottom: sp.lg }} />
          <Cta label={busy ? 'Sending…' : `Send to ${recipients.length}`} wide
            disabled={!body.trim() || !recipients.length || busy} onPress={send} />
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
