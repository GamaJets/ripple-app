// Coach · Their checklists. The daily lines this coach puts on one client's list.
//
// ── Why this screen exists ──────────────────────────────────────────────────
//
// TF-31 asked what generates the client's daily checklist. The honest answer
// was "a five-element array literal compiled into the app" — the same
// "10,000 steps" and "Sleep 7h+" for every account on the platform, which no
// coach and no client could change. The client's list is derived from their own
// plan and targets now, and the answer to the feedback included "as well as the
// ones set by the coach".
//
// `coach_checklist_items` (supabase/parts/58) is where those live and the
// client's app already reads them. The console has the same editor at
// /coach/checklists; this is it on the phone, which is where coaches actually
// are between sessions.
//
// ── Every write is believed only when the server confirms it ───────────────
//
// Each mutation selects the rows it touched and counts them. A PostgREST update
// or delete matching NOTHING succeeds having changed zero rows, so an item RLS
// refused to touch would otherwise disappear from this screen, look saved, and
// come back at the next launch. That is the single most-reported shape of bug
// in this product and it is not repeated here.
//
// ── What this screen deliberately cannot do ────────────────────────────────
//
// Tick anything. There is no `done` column on the table and there must not be
// one: the tick belongs to the client, in `habit_logs`, under their own policy.
// A coach marking their client's habit complete would be a second answer to a
// question only one person can answer.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import type { LoadStatus } from '../../src/ui/loadStatus';

interface Item { id: string; label: string; icon: string; active: boolean; sort: number }

/** The bound the column carries (part 58: `length(label) <= 80`). Checked here
 *  so a coach is told before the write rather than by a refused one. */
const LABEL_MAX = 80;

const COLS = 'id, label, icon, active, sort';

export default function CoachChecklists() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();

  const [picked, setPicked] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('ready');
  const [uid, setUid] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setUid(data?.user?.id ?? null);
      } catch { if (!cancelled) setUid(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async (coachId: string, clientId: string) => {
    setStatus('loading');
    const { data, error } = await supabase
      .from('coach_checklist_items')
      .select(COLS)
      .eq('coach_id', coachId)
      .eq('client_id', clientId)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      // Null, not []. An empty list under a failed read tells the coach they
      // have set nothing for this person, which is a claim about them.
      reportError('coachChecklists.load', error);
      setItems(null); setStatus('error'); return;
    }
    setItems((data ?? []) as unknown as Item[]);
    setStatus('ready');
  }, []);

  useEffect(() => {
    if (uid && picked) void load(uid, picked);
    else setItems(null);
  }, [uid, picked, load]);

  const shown = useMemo(() => (items ? [...items].sort((a, b) => a.sort - b.sort) : null), [items]);
  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);

  const add = async () => {
    if (!uid || !picked || busy) return;
    const label = draft.trim();
    if (!label) { Alert.alert('Nothing to add', 'Type the line you want on their list.'); return; }
    if (label.length > LABEL_MAX) {
      Alert.alert('Too long', `That is ${label.length} characters. A checklist line has to fit on one row of a phone — ${LABEL_MAX} at most.`);
      return;
    }
    setBusy(true);
    // Appended rather than inserted first: the order is the coach's, and a new
    // item silently taking the top would reshuffle a list the client has been
    // reading in the same shape every morning.
    const nextSort = (items ?? []).reduce((m, i) => Math.max(m, i.sort), 0) + 1;
    const { data, error } = await supabase
      .from('coach_checklist_items')
      .insert({ coach_id: uid, client_id: picked, label, icon: icon.trim(), sort: nextSort })
      .select(COLS).single();
    setBusy(false);
    if (error || !data) {
      reportError('coachChecklists.add', error);
      Alert.alert('Not saved', 'That line is not on their list. Check your connection and try again.');
      return;
    }
    setItems((p) => [...(p ?? []), data as unknown as Item]);
    setDraft(''); setIcon('');
  };

  const setActive = async (it: Item, active: boolean) => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase
      .from('coach_checklist_items').update({ active }).eq('id', it.id).select(COLS);
    setBusy(false);
    // Counting rows is the point: an update that matched nothing is not an
    // error, it is a success that changed nothing.
    if (error || !data || !data.length) {
      reportError('coachChecklists.setActive', error);
      Alert.alert('Not saved', 'Their list is unchanged.');
      return;
    }
    setItems((p) => (p ?? []).map((x) => (x.id === it.id ? { ...x, active } : x)));
  };

  const remove = (it: Item) => {
    Alert.alert(
      'Delete this line?',
      `"${it.label}" goes for good, and their past ticks for it stop being readable. Turning it off keeps the record.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Turn off', onPress: () => setActive(it, false) },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          setBusy(true);
          const { data, error } = await supabase
            .from('coach_checklist_items').delete().eq('id', it.id).select('id');
          setBusy(false);
          if (error || !data || !data.length) {
            reportError('coachChecklists.remove', error);
            Alert.alert('Not removed', 'It is still on their list.');
            return;
          }
          setItems((p) => (p ?? []).filter((x) => x.id !== it.id));
        } },
      ],
    );
  };

  const move = async (it: Item, dir: -1 | 1) => {
    if (busy || !shown) return;
    const i = shown.findIndex((x) => x.id === it.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= shown.length) return;
    const other = shown[j];
    setBusy(true);
    const [a, b] = await Promise.all([
      supabase.from('coach_checklist_items').update({ sort: other.sort }).eq('id', it.id).select('id'),
      supabase.from('coach_checklist_items').update({ sort: it.sort }).eq('id', other.id).select('id'),
    ]);
    setBusy(false);
    if (a.error || b.error || !a.data?.length || !b.data?.length) {
      // One half may have landed. Re-reading is the only way to show what the
      // server holds rather than what this phone hoped it would.
      reportError('coachChecklists.move', a.error ?? b.error);
      Alert.alert('Order not saved', 'Reloading their list so you can see what actually stored.');
      if (uid && picked) void load(uid, picked);
      return;
    }
    setItems((p) => (p ?? []).map((x) =>
      x.id === it.id ? { ...x, sort: other.sort } : x.id === other.id ? { ...x, sort: it.sort } : x));
  };

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Their checklists</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Lines you add appear on that client&rsquo;s daily list, marked as set by you, beside the
          ones worked out from their own plan and targets. You can&rsquo;t tick them — that stays
          with them.
        </Text>

        {r.status === 'error' ? (
          <Section>
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="This is not an empty book. Nobody is listed below because the list did not come back — pull back and open this again once you are connected." />
          </Section>
        ) : null}

        <Section>
          <SectionHead title="Client" />
          {r.roster.length === 0 && r.status !== 'error' ? (
            <Text style={{ ...ty.body, color: t.ink3 }}>
              Nobody is on your book yet, so there is no list to add to.
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {r.roster.map((c) => (
                <Pressable key={c.id} onPress={() => setPicked(c.id === picked ? null : c.id)}
                  accessibilityRole="button" accessibilityState={{ selected: picked === c.id }}
                  accessibilityLabel={c.name} style={chip(picked === c.id)}>
                  <Text style={{ ...ty.micro, color: picked === c.id ? t.brandInk : t.ink2 }}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Section>

        {picked ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title={client?.name ?? 'Their list'} note={shown ? `${shown.filter((i) => i.active).length} showing` : undefined} />

              {status === 'error' ? (
                <Notice tone={t.warn} kicker="Not loaded" title="Their list could not be read"
                  note="Nothing is shown below because nothing came back — it does not mean you have set nothing for them." />
              ) : status === 'loading' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>Reading their list…</Text>
              ) : shown && shown.length === 0 ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  You haven&rsquo;t set anything for them. Their list still shows the lines worked
                  out from their own plan and targets.
                </Text>
              ) : shown ? shown.map((it, i) => (
                <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring, opacity: it.active ? 1 : 0.5 }}>
                  <Text style={{ ...ty.body }}>{it.icon || '•'}</Text>
                  <Text style={{ flex: 1, ...ty.body, color: t.ink2 }}>{it.label}</Text>
                  <Pressable onPress={() => move(it, -1)} disabled={busy || i === 0} accessibilityRole="button" accessibilityLabel={`Move ${it.label} up`}
                    style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, opacity: i === 0 ? 0.3 : 1 }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>↑</Text>
                  </Pressable>
                  <Pressable onPress={() => move(it, 1)} disabled={busy || i === shown.length - 1} accessibilityRole="button" accessibilityLabel={`Move ${it.label} down`}
                    style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, opacity: i === shown.length - 1 ? 0.3 : 1 }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>↓</Text>
                  </Pressable>
                  <Pressable onPress={() => setActive(it, !it.active)} disabled={busy} accessibilityRole="button"
                    accessibilityLabel={it.active ? `Take ${it.label} off their list` : `Put ${it.label} back on their list`}
                    style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                    <Text style={{ ...ty.micro, color: t.ink2 }}>{it.active ? 'On' : 'Off'}</Text>
                  </Pressable>
                  <Pressable onPress={() => remove(it)} disabled={busy} accessibilityRole="button" accessibilityLabel={`Remove ${it.label}`}
                    style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>✕</Text>
                  </Pressable>
                </View>
              )) : null}
            </Section>

            <Rule />

            <Section>
              <SectionHead title="Add a line" note={`${draft.length}/${LABEL_MAX}`} />
              <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
                <TextInput value={icon} onChangeText={setIcon} placeholder="🥗" placeholderTextColor={t.ink3}
                  accessibilityLabel="Icon, optional" maxLength={8}
                  style={{ width: 56, textAlign: 'center', ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingVertical: sp.md }} />
                <TextInput value={draft} onChangeText={setDraft} placeholder="e.g. Ten minutes of hip mobility before bed"
                  placeholderTextColor={t.ink3} accessibilityLabel="What to add to their list" maxLength={LABEL_MAX}
                  style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
              </View>
              <View style={{ marginTop: sp.md }}>
                <Cta label={busy ? 'Saving…' : 'Add to their list'} wide disabled={busy} onPress={add} />
              </View>
            </Section>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
