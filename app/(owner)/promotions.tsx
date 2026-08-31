// Owner · Promotions. Create a promotion and push it to every member. Uses the
// promos store for the code + a member-wide push (all_member_ids RPC, owner-only).
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: the live code
// count became the screen's one hero figure, the two bordered boxes became
// hairline-separated sections, and the Georgia serif header is gone.
//
// The redemption count is real again, and the history is worth keeping. Each
// row once printed "· {p.redeemed} redeemed" against a `promos.redeemed`
// column nothing incremented — a permanent zero presented as a tracked metric —
// so it was removed rather than faked. Part 104 then made redemption an EVENT:
// a row per member per code in `promo_redemptions`, counted from rows and never
// from a stored counter, which cannot lose a write under concurrency the way
// `set redeemed = redeemed + 1` can. The count below is that, and a dash where
// the count itself could not be read.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { usePromos } from '../../src/ui/promos';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { sendPushChecked } from '../../src/ui/pushNotifications';

export default function Promotions() {
  const t = useTheme();
  const router = useRouter();
  const { promos, status, addPromo, removePromo } = usePromos();
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [disc, setDisc] = useState(20);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Returns what actually happened, not how many member rows exist. This used
  // to return ids.length and report it as "Sent to N members" while sendPush
  // swallowed every failure — so an undeployed function, or members with no
  // push token, still read as N delivered.
  const pushToMembers = async (body: string): Promise<{ ok: boolean; queued: number; error?: string }> => {
    if (!USE_SUPABASE) return { ok: false, queued: 0, error: 'Not connected to the server.' };
    try {
      // `error` is read, not just `data`. supabase-js resolves on a database
      // error, so an RLS refusal or a missing function arrived here as
      // `data: null`, collapsed to an empty id list, and came back out as "No
      // members to push to yet." — the same false statement the note above
      // describes, reached by a different route. The owner is told their gym
      // has no members rather than that the call was refused, so they stop
      // pushing offers instead of fixing the permission.
      const { data, error } = await supabase.rpc('all_member_ids');
      if (error) return { ok: false, queued: 0, error: error.message };
      // all_member_ids() is `returns setof uuid` live, so PostgREST hands back
      // a plain array of id strings. Reading .user_id off a string gave
      // undefined for every member, filtered the list to nothing, and told the
      // owner "No members to push to yet" every single time — a push that could
      // never be sent, blamed on having no members. Both shapes are accepted
      // because an earlier deployment of this function returned table(user_id).
      const ids = Array.isArray(data)
        ? data.map((r: any) => (typeof r === 'string' ? r : r?.user_id)).filter(Boolean)
        : [];
      if (!ids.length) return { ok: false, queued: 0, error: 'No members to push to yet.' };
      const res = await sendPushChecked(ids, title.trim() || 'A new offer', body, { route: '/(client)/explore' });
      return { ok: res.ok, queued: ids.length, error: res.error };
    } catch (e: any) { return { ok: false, queued: 0, error: e?.message || 'Could not reach the server.' }; }
  };

  const create = async (push: boolean) => {
    const c = code.trim().toUpperCase();
    if (!title.trim() || !c || busy) { Alert.alert('Add details', 'Enter a title and a promo code.'); return; }
    setBusy(true);
    try {
      const res = await addPromo(c, disc);
      if (!res.ok) { Alert.alert('Could not create', res.reason || 'Try a different code.'); return; }
      const body = (msg.trim() || `${disc}% off with code ${c}`);
      const pushRes = push ? await pushToMembers(body) : null;
      setTitle(''); setCode(''); setMsg('');
      Alert.alert('Promotion created',
        !pushRes ? `“${c}” created. Push it to members any time.`
          : pushRes.ok ? `“${c}” created and queued to ${pushRes.queued} member${pushRes.queued === 1 ? '' : 's'}. Only members on a push-enabled build with notifications on will receive it.`
          : `“${c}” created, but the push did not go out: ${pushRes.error || 'unknown error'}. You can push it again from the list below.`);
    } finally { setBusy(false); }
  };

  const G = layout.gutter;
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your members</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Promotions</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* ── the hero ───────────────────────────────────────────────────── */}
        <Hero
          label="Live Codes"
          figure={fig(promos.length)}
          unit={promos.length === 1 ? 'code' : 'codes'}
          note={promos.length
            ? 'Push any code to every member. Delivery depends on their notification settings, so treat it as queued rather than guaranteed.'
            : 'Create an offer and push it straight to your members.'}
        />

        <Rule />

        {/* ── new promotion ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="New Promotion" />
          <TextInput value={title} onChangeText={setTitle} placeholder="Title — e.g. Summer Special" placeholderTextColor={t.ink3} style={inp} />
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
            <TextInput value={code} onChangeText={setCode} placeholder="CODE" autoCapitalize="characters" placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} />
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface2, borderRadius: radius.sm }}>
              <Pressable onPress={() => setDisc((d) => Math.max(5, d - 5))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Lower the discount"
                style={{ paddingHorizontal: 13, paddingVertical: 11 }}>
                <Icon name="minus" size={16} color={t.ink2} />
              </Pressable>
              <Text style={{ ...value(15), color: t.ink, minWidth: 42, textAlign: 'center' }}>{disc}%</Text>
              <Pressable onPress={() => setDisc((d) => Math.min(80, d + 5))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Raise the discount"
                style={{ paddingHorizontal: 13, paddingVertical: 11 }}>
                <Icon name="plus" size={16} color={t.ink2} />
              </Pressable>
            </View>
          </View>
          <View style={{ height: sp.sm }} />
          <TextInput value={msg} onChangeText={setMsg} placeholder="Push message (optional)" placeholderTextColor={t.ink3} style={inp} />
          <View style={{ height: sp.lg }} />
          {/* `disabled={busy}` on the old buttons, preserved: the kit's Cta/Ghost
              take no disabled prop, so the pair is gated as a group. */}
          <View pointerEvents={busy ? 'none' : 'auto'} style={{ opacity: busy ? 0.6 : 1 }}>
            <Cta label={busy ? 'Working…' : 'Create & push to members'} wide onPress={() => create(true)} />
            <View style={{ height: sp.sm }} />
            <Ghost label="Save Without Pushing" onPress={() => create(false)} />
          </View>
        </Section>

        <Rule />

        {/* ── active promotions ──────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Active Promotions" note={promos.length ? String(promos.length) : undefined} />
          {status === 'error' ? (
            // An empty list under 'error' is unknown, not "no promotions" —
            // and offering to create the first code to somebody who may
            // already have six is how a gym ends up with two of everything.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Your promotions could not be read just now. This is not a statement that you have none.
            </Text>
          ) : promos.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {status === 'loading' ? 'Loading.' : 'No promotions yet. Create a code above and it appears here, ready to push to every member.'}
            </Text>
          ) : promos.map((p, i) => (
            <View key={p.id} style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: sp.md,
              borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink, letterSpacing: 1 }}>{p.code}</Text>
                {/* The count is rows in promo_redemptions, not a stored
                    counter — so a 0 here means nobody has used it, and -1
                    means the count itself could not be read, which renders as
                    a dash rather than as nobody. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {p.discountPct}% off · {p.redeemed < 0 ? '—' : p.redeemed} used
                </Text>
              </View>
              <Ghost label="Push" onPress={() => { const body = `${p.discountPct}% off with code ${p.code}`; pushToMembers(body).then((r) => Alert.alert(r.ok ? 'Queued' : 'Not sent', r.ok ? `Queued to ${r.queued} member${r.queued === 1 ? '' : 's'}.` : (r.error || 'The push did not go out.'))); }} />
              {/* The boolean was discarded here too: a code the server refused
                  to delete vanished from the list and stayed redeemable. */}
              <Pressable onPress={async () => { if (!await removePromo(p.id)) Alert.alert('Not deleted', `“${p.code}” could not be deleted, so it is still live and can still be redeemed.`); }} hitSlop={6} accessibilityRole="button" accessibilityLabel={'Remove ' + p.code}>
                <Icon name="minus" size={16} color={t.ink3} />
              </Pressable>
            </View>
          ))}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
