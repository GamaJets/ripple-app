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
import { Rule, Section, SectionHead, Cta, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useClientTags } from '../../src/ui/clientTags';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { sendPush } from '../../src/ui/pushNotifications';

export default function Broadcast() {
  const t = useTheme();
  const router = useRouter();
  const { roster, status: rosterStatus } = useRoster();
  const { allTags, tagsFor, status: tagStatus } = useClientTags();
  const [seg, setSeg] = useState<string | null>(null); // null = all
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const recipients = useMemo(() => roster.filter((c) => seg === null || tagsFor(c.id).includes(seg)), [roster, seg, tagsFor]);

  // Whether the LIST is trustworthy, as distinct from whether the send worked.
  // This screen was careful about the write — it counts the rows it managed to
  // insert and says "Partly sent" — and never asked whether the roster it was
  // addressing was the whole roster. A refused read leaves it empty and a
  // truncated one leaves it short, and in both cases a coach is composing to a
  // list the app cannot vouch for. Since reads are capped now, the short case
  // is the realistic one: broadcast to the first thousand of twelve hundred and
  // be told "Sent to 1000 client threads", which sounds complete.
  const bookUnread = rosterStatus === 'error';
  const bookShort = rosterStatus === 'partial';
  // Segments are only as good as the tags behind them. With tags unread, every
  // tagsFor() comes back empty and a chosen segment matches nobody — which
  // renders identically to a segment that genuinely has nobody in it.
  const segUnreliable = seg !== null && (tagStatus === 'error' || tagStatus === 'partial');

  const send = async () => {
    const b = body.trim();
    if (!b || !recipients.length || busy) return;
    // Refuse rather than warn. A broadcast cannot be taken back, and "send to
    // everybody" written against a list we could not read is not a smaller
    // version of the thing the coach asked for.
    if (bookUnread) {
      Alert.alert('Your client list could not be read',
        'Nothing was sent. Sending now would go to whoever happens to be loaded rather than to your book — reopen this once you are connected.');
      return;
    }
    setBusy(true);
    try {
      let delivered = recipients.length;
      if (USE_SUPABASE) {
        // One insert per recipient, not one statement covering all of them.
        // The roster merges real `clients` with coach-added `coach_clients`,
        // whose ids have no clients row behind them — and messages.client_id is
        // a foreign key to clients(id). A multi-row insert is a single
        // statement, so one client added by hand made Postgres reject the whole
        // broadcast and nobody heard from their coach. dashboard.tsx sends one
        // at a time for exactly this reason; this is the same treatment.
        const results = await Promise.all(recipients.map(async (c) => {
          const { error } = await supabase.from('messages').insert({ client_id: c.id, sender: 'coach', body: b });
          return error ? null : c.id;
        }));
        const ok = results.filter((id): id is string => !!id);
        if (!ok.length) { Alert.alert('Not sent', 'The message could not be written to your clients’ threads. Check your connection and try again.'); return; }
        delivered = ok.length;
        sendPush(ok, 'Message from your coach', b, { route: '/(client)/messages' });
      }
      setBody('');
      const where = seg ? ' in “' + seg + '”' : '';
      // Partial delivery is reported as partial. Saying "Sent" for a broadcast
      // that reached two thirds of the segment is the failure this screen keeps
      // making in a different way.
      // Two different incompletenesses, and they need saying separately: some
      // recipients have no account to write to, and — if the roster came back
      // short — there are people who were never in the list at all.
      const shortNote = bookShort
        ? '\n\nYour roster came back short, so this went to the clients that were loaded and not necessarily to everyone on your book.'
        : '';
      Alert.alert(
        delivered === recipients.length && !bookShort ? 'Sent' : 'Partly sent',
        (delivered === recipients.length
          ? `Added to ${delivered} client thread${delivered === 1 ? '' : 's'}${where}.`
          : `Added to ${delivered} of ${recipients.length} client threads${where}. The rest were added by hand and have no client account to message yet.`) + shortNote,
      );
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
          <SectionHead title="Recipients" note={recipients.length && !bookUnread ? `${recipients.length}` : undefined} />
          {bookUnread ? (
            <Notice tone={t.warn} kicker="Roster" title="Your client list could not be read"
              note="Nobody is listed below because the roster did not come back. This is not an empty book, and nothing can be sent until it loads." />
          ) : bookShort ? (
            <Notice tone={t.warn} kicker="Roster" title="This is part of your book"
              note="Your roster came back short, so anyone past the point it stopped is not in this list and would not receive the message." />
          ) : segUnreliable ? (
            <Notice tone={t.warn} kicker="Tags" title="This segment may be incomplete"
              note="Your client tags could not be read in full, so somebody in this segment may be missing from the list below." />
          ) : null}
          {recipients.length === 0 && !bookUnread ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No clients in this segment.</Text>
          ) : recipients.length === 0 ? null : (
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
