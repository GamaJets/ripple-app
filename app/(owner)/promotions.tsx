// Owner · Promotions. Create a promotion and push it to every member. Uses the
// promos store for the code + a member-wide push (all_member_ids RPC, owner-only).
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: the live code
// count became the screen's one hero figure, the two bordered boxes became
// hairline-separated sections, and the Georgia serif header is gone.
//
// ── "Live" meant "exists" ─────────────────────────────────────────────────
//
// The hero read "Live Codes" over `promos.length`, and the list below it was
// headed "Active Promotions" with the same figure. `promos.length` is every
// code this gym has ever made. `p.active` — the column the Growth screen's
// toggle writes, and the one `redeem_promo` checks — was not read on this
// screen at all. So a code the owner had deliberately switched off was counted
// as live, listed under Active, and could still be pushed to every member from
// the button beside it; the only way to stop that was to DELETE the code, which
// also destroys the record of a promotion the gym ran.
//
// Both figures now count `p.active`, the list says which each row is and can
// switch it, and Push is not offered on a code nobody could redeem. The
// switched-off codes are still listed — a promotion that ended is a thing that
// happened, and hiding it is how an owner recreates it by accident.
//
// The redemption count is real again, and the history is worth keeping. Each
// row once printed "· {p.redeemed} redeemed" against a `promos.redeemed`
// column nothing incremented — a permanent zero presented as a tracked metric —
// so it was removed rather than faked. Part 104 then made redemption an EVENT:
// a row per member per code in `promo_redemptions`, counted from rows and never
// from a stored counter, which cannot lose a write under concurrency the way
// `set redeemed = redeemed + 1` can. The count below is that, and a dash where
// the count itself could not be read.
import { useEffect, useState, useCallback } from 'react';
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
import { Fetched } from '../../src/ui/fetched';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isWhole } from '../../src/ui/loadStatus';

export default function Promotions() {
  const t = useTheme();
  const router = useRouter();
  const { promos, status, addPromo, toggleActive, removePromo, refresh } = usePromos();
  /* ── When the codes were last read ───────────────────────────────────
     The provider carries no stamp, so the screen keeps one: the moment
     `status` last settled on a read that came back. 'error' does NOT move it —
     the codes on screen are still the earlier read's. */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  useEffect(() => {
    if (status === 'ready' || status === 'partial') setFetchedAt(Date.now());
  }, [status]);
  // The codes are the whole of this screen's server state — the hero counts
  // them and the list below is them.
  const pull = usePullToRefresh(useCallback(() => { void refresh(); }, [refresh]));
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

  // Whether the list on screen is the WHOLE list, which is the only condition
  // under which anything here may be counted.
  //
  // ── Why 'partial' no longer counts ────────────────────────────────────────
  //
  // This was `status !== 'loading' && status !== 'error'`, so it counted under
  // 'partial' and appended "this may be short" to the hero note. That reads like
  // a stated exception rather than an oversight, and it was defended as one —
  // but it only ever caveated ONE of the four figures this screen states, and
  // the three it missed are the ones that do damage:
  //
  //   · the `live === 0` branch says "Nothing is redeemable right now" with no
  //     caveat at all. Under a truncated read, every live code can be past the
  //     cut — so the sentence is not short, it is the opposite of true, and it
  //     ends with "create a new offer", which is how a gym gets two of
  //     everything;
  //   · `off` — "3 codes are switched off below" — is a count over the same
  //     unknown fraction and was never caveated;
  //   · the section heading's "N live of M" states both numbers bare.
  //
  // Once all four need the clause, the clause is not the answer. src/ui/
  // loadStatus.ts already gives it: under 'partial' "the list may be shown. A
  // total, a count, a sum or an average over it may NOT — it is a figure
  // computed from an unknown fraction of the set." The list below still renders,
  // which is the whole point of 'partial'; the numerals over it do not.
  //
  // The cost is real and is worth naming: `usePromos` reports 'partial' both
  // when the CODES read was truncated and when only the REDEMPTION counts
  // failed, and in the second case the code list is whole and `live` would have
  // been exact. This screen cannot tell those two apart — the provider collapses
  // them into one status — so it takes the safe half of an ambiguity rather than
  // printing a hero figure it can only sometimes stand behind. Separating them
  // belongs in src/ui/promos.tsx, and would give this screen its figure back.
  const countable = isWhole(status);
  const live = countable ? promos.filter((p) => p.active).length : null;
  /** Null wherever `live` is null, so a branch added later cannot state a count
   *  the screen has not earned. Read only inside branches already past the
   *  status gate below, where it is a number. */
  const off = live == null ? null : promos.length - live;

  const G = layout.gutter;
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your members</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Promotions</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* When the codes were read, whether this phone is reaching us, and a
            way to ask again. The hero below is a count over them. */}
        <Fetched at={fetchedAt} onRefresh={() => { void refresh(); }} busy={status === 'loading'} />

        {/* ── the hero ───────────────────────────────────────────────────── */}
        {/* `promos.length` was every code the gym had ever made, under the word
            "Live". This counts the ones a member could actually redeem. */}
        <Hero
          label="Live Codes"
          figure={fig(live)}
          unit={live === 1 ? 'code' : 'codes'}
          note={status === 'loading' ? 'Reading your codes…'
            : status === 'error' ? 'Your codes could not be read — this is not a gym with none.'
            : !countable
            // 'partial'. The codes below are real; how many of them there are is
            // not known, so no numeral is offered — including the one that would
            // otherwise read "nothing is redeemable right now".
            ? 'Your codes are listed below, but the read did not come back whole, so this cannot say how many are live. A count over part of a list is not a smaller number, it is a wrong one. Pull down to read them again.'
            : live === 0
              ? (off ?? 0) > 0
                ? `Nothing is redeemable right now. ${off} code${off === 1 ? ' is' : 's are'} switched off below — switch one back on, or create a new offer.`
                : 'Create an offer and push it straight to your members.'
              : `${(off ?? 0) > 0 ? `${off} more switched off. ` : ''}Push a live code to every member. Delivery depends on their notification settings, so treat it as queued rather than guaranteed.`}
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
          {/* `disabled={busy}` on the old buttons, preserved: `Ghost` takes no
              disabled prop, so the pair is gated as a group rather than one of
              them being live while the other is not. */}
          <View pointerEvents={busy ? 'none' : 'auto'} style={{ opacity: busy ? 0.6 : 1 }}>
            <Cta label={busy ? 'Working…' : 'Create & push to members'} wide onPress={() => create(true)} />
            <View style={{ height: sp.sm }} />
            <Ghost label="Save Without Pushing" onPress={() => create(false)} />
          </View>
        </Section>

        <Rule />

        {/* ── active promotions ──────────────────────────────────────────── */}
        <Section>
          {/* "Active Promotions" over a count of every code ever made. The
              switched-off ones belong in this list — a promotion the gym ran
              and ended is a thing that happened — but the heading may not call
              them active, and each row says which it is. */}
          <SectionHead title="Your Codes" note={countable && promos.length ? `${live} live of ${promos.length}` : undefined} />
          {status === 'error' ? (
            // An empty list under 'error' is unknown, not "no promotions" —
            // and offering to create the first code to somebody who may
            // already have six is how a gym ends up with two of everything.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Your promotions could not be read just now. This is not a statement that you have none.
            </Text>
          ) : promos.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {status === 'loading' ? 'Loading.' : 'No promotions yet. Create a code above and it appears here, live and ready to push to every member.'}
            </Text>
          ) : promos.map((p, i) => (
            <View key={p.id} style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: sp.md,
              borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: p.active ? t.ink : t.ink3, letterSpacing: 1 }}>{p.code}</Text>
                {/* The count is rows in promo_redemptions, not a stored
                    counter — so a 0 here means nobody has used it, and -1
                    means the count itself could not be read, which renders as
                    a dash rather than as nobody. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {p.discountPct}% off · {p.redeemed < 0 ? '—' : p.redeemed} used
                  {p.active ? '' : ' · switched off, nobody can redeem it'}
                </Text>
              </View>
              {/* The switch this screen did not have. Without it the only way to
                  stop a code was the × beside it, which deletes the promotion
                  and the evidence that the gym ever ran it. Awaited and checked:
                  `toggleActive` counts the rows it changed, so a refused update
                  says so rather than flipping the dot on a screen the server
                  never agreed with. */}
              <Pressable
                onPress={async () => { if (!await toggleActive(p.id)) Alert.alert('Not changed', `“${p.code}” could not be switched ${p.active ? 'off' : 'on'}, so it is still ${p.active ? 'live' : 'off'}.`); }}
                accessibilityRole="button"
                accessibilityLabel={`${p.code} is ${p.active ? 'live' : 'off'} — switch it ${p.active ? 'off' : 'on'}`}
                hitSlop={6}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 6 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: p.active ? t.brand : t.ink3 }} />
                <Text style={{ ...ty.caption, color: t.ink2 }}>{p.active ? 'Live' : 'Off'}</Text>
              </Pressable>
              {/* Push is offered on a code a member could actually redeem, and
                  on no other. Pushing a switched-off code sends every member to
                  an offer `redeem_promo` will refuse, which is worse than not
                  telling them about it. */}
              {p.active ? (
                <Ghost label="Push" onPress={() => { const body = `${p.discountPct}% off with code ${p.code}`; pushToMembers(body).then((r) => Alert.alert(r.ok ? 'Queued' : 'Not sent', r.ok ? `Queued to ${r.queued} member${r.queued === 1 ? '' : 's'}.` : (r.error || 'The push did not go out.'))); }} />
              ) : null}
              {/* The boolean was discarded here too: a code the server refused
                  to delete vanished from the list and stayed redeemable. */}
              <Pressable onPress={async () => { if (!await removePromo(p.id)) Alert.alert('Not deleted', `“${p.code}” could not be deleted, so it is still there and, if it is live, can still be redeemed.`); }} hitSlop={6} accessibilityRole="button" accessibilityLabel={'Remove ' + p.code}>
                <Icon name="minus" size={16} color={t.ink3} />
              </Pressable>
            </View>
          ))}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
