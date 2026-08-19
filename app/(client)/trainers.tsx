// Find a Trainer — client-side marketplace. Browse coaches who have opted in to
// the public directory, view a profile, and send a real coaching request.
//
// This screen previously rendered five hardcoded fictional coaches ("Sam
// Rivera", "Maya Chen", …) with invented star ratings and review counts, and a
// "Request coaching" button that wrote nothing anywhere while telling the
// client the coach would "confirm shortly". Everything here now comes from
// Supabase: `trainers.listed = true` (opt-in, set by the trainer themselves)
// and a real row in `coach_requests` that the trainer sees on their dashboard.
// Ratings and review counts are gone — there is no review system to feed them.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero (a directory has no single live number), a
// hairline-separated directory instead of a stack of bordered cards, and a
// <Notice> for the one thing that needs a decision — an invitation. Every
// query, conditional and route above is untouched.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useInvites } from '../../src/ui/invites';
import { notifySuccess } from '../../src/ui/haptics';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';

type Mode = 'online' | 'inperson';
interface Coach {
  id: string;
  name: string;
  tagline: string;
  specialties: string[];
  sessionFee: number;
  bio: string;
}

export default function FindTrainer() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const { received, acceptInvite, declineInvite } = useInvites();
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Coach | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});

  const acceptCoach = async (id: string, coachName: string | null, mode: string) => {
    const m = await acceptInvite(id);
    cd.setCoachingMode(m);
    notifySuccess();
    Alert.alert('You are connected', (coachName || 'Your coach') + ' is now your ' + (m === 'inperson' ? 'in-person' : 'online') + ' coach. Their plan, feedback and messaging are now on your app.', [{ text: 'Great' }]);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!USE_SUPABASE) { setLoading(false); return; }
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id ?? null;

        const { data: rows } = await supabase
          .from('trainers')
          .select('id, bio, tagline, specialties, session_fee')
          .eq('listed', true);
        if (cancelled) return;

        const ids = (rows ?? []).map((r: any) => r.id).filter((id: string) => id !== uid);
        if (ids.length === 0) { setCoaches([]); setLoading(false); return; }

        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        if (cancelled) return;
        const nameById = new Map<string, string>((profs ?? []).map((p: any) => [p.id, p.full_name]));

        const list: Coach[] = (rows ?? [])
          .filter((r: any) => ids.includes(r.id))
          .map((r: any) => ({
            id: r.id,
            name: (nameById.get(r.id) || '').trim(),
            tagline: typeof r.tagline === 'string' ? r.tagline : '',
            specialties: Array.isArray(r.specialties) ? r.specialties : [],
            sessionFee: r.session_fee != null && !Number.isNaN(Number(r.session_fee)) ? Number(r.session_fee) : 0,
            bio: typeof r.bio === 'string' ? r.bio : '',
          }))
          // A coach with no name has not set up a profile — don't show a blank card.
          .filter((c) => c.name.length > 0);

        // Also hide any trainer this client already has a pending request with.
        if (uid) {
          const { data: reqs } = await supabase
            .from('coach_requests')
            .select('trainer_id')
            .eq('client_id', uid)
            .eq('status', 'pending');
          if (!cancelled && reqs) setSent(Object.fromEntries(reqs.map((r: any) => [r.trainer_id, true])));
        }

        if (!cancelled) setCoaches(list);
      } catch (e) {
        reportError('findTrainer.load', e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const request = useCallback(async (coach: Coach, mode: Mode) => {
    setSel(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) { Alert.alert('Sign in required', 'Sign in to Repple to request coaching.'); return; }
      const { error } = await supabase.from('coach_requests').insert({
        client_id: uid, trainer_id: coach.id, mode, status: 'pending',
      });
      if (error && !/duplicate|unique/i.test(error.message)) {
        Alert.alert('Could not send request', error.message);
        return;
      }
      setSent((s) => ({ ...s, [coach.id]: true }));
      notifySuccess();
      Alert.alert(
        'Request sent',
        `${coach.name} will see your ${mode === 'inperson' ? 'in-person' : 'online'} coaching request on their dashboard. You'll be connected once they accept — nothing changes on your app until then.`,
        [{ text: 'Got it' }]
      );
    } catch (e) {
      reportError('findTrainer.request', e);
      Alert.alert('Could not send request', 'Check your connection and try again.');
    }
  }, []);

  const G = layout.gutter;
  const initials = (n: string) => n.split(' ').map((x) => x[0]).join('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Connect</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Find a trainer</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Browse coaches on Repple and start online or in-person.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* ── invitations: the one thing that needs a decision ────────────── */}
        {received.length > 0 ? (
          <View style={{ marginTop: sp.lg }}>
            {received.map((iv) => (
              <Notice key={iv.id} tone={t.brand}
                kicker={`Coaching invitation${iv.demo ? ' · sample' : ''}`}
                title={`${iv.coachName || 'A coach'} invited you`}
                note={`${iv.mode === 'inperson' ? 'In-person' : 'Online'} coaching. Accept to connect — their program, feedback and messaging turn on for you.`}>
                <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                  <View style={{ flex: 1 }}><Ghost label="Decline" onPress={() => declineInvite(iv.id)} /></View>
                  <View style={{ flex: 2 }}><Cta label="Accept invitation" wide onPress={() => acceptCoach(iv.id, iv.coachName, iv.mode)} /></View>
                </View>
              </Notice>
            ))}
          </View>
        ) : null}

        <Rule />

        {/* ── the directory ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Coaches on Repple" note={!loading && coaches.length > 0 ? String(coaches.length) : undefined} />

          {loading ? (
            <View style={{ paddingVertical: sp.huge, alignItems: 'center' }}><ActivityIndicator color={t.brand} /></View>
          ) : coaches.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
              <View style={{ width: 52, height: 52, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: sp.md }}>
                <Icon name="people" size={24} color={t.ink3} />
              </View>
              <Text style={{ ...ty.head, color: t.ink, textAlign: 'center' }}>No coaches listed yet</Text>
              <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: 6, maxWidth: 300 }}>Trainers appear here once they publish their profile to the directory. If a coach has invited you directly, their invitation shows above.</Text>
            </View>
          ) : coaches.map((c, i) => (
            <View key={c.id}>
              {i > 0 ? <Rule inset={46} /> : null}
              <Pressable onPress={() => setSel(c)} accessibilityRole="button" accessibilityLabel={c.name}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ ...value(13), color: t.brand }}>{initials(c.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.name}</Text>
                  {c.tagline ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={1}>{c.tagline}</Text> : null}
                  {c.specialties.length > 0 || sent[c.id] ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 7, flexWrap: 'wrap' }}>
                      {sent[c.id] ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
                          <Text style={{ ...ty.caption, color: t.ink2 }}>Request pending</Text>
                        </View>
                      ) : null}
                      {c.specialties.slice(0, 3).map((sx) => (
                        <View key={sx} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.sm, paddingVertical: 3 }}>
                          <Text style={{ ...ty.caption, color: t.ink3 }}>{sx}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
                {c.sessionFee > 0 ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ ...value(17), color: t.ink }}>${c.sessionFee}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>/ session</Text>
                  </View>
                ) : null}
                <Icon name="chevron" size={16} color={t.ink3} />
              </Pressable>
            </View>
          ))}
        </Section>
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, maxHeight: '86%', ...elevation.e2 }}>
          {sel && (
            <ScrollView contentContainerStyle={{ padding: G, paddingBottom: sp.xxl }} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.lg }}>
                <View style={{ width: 58, height: 58, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ ...value(20), color: t.brand }}>{initials(sel.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.title, color: t.ink }}>{sel.name}</Text>
                  {sel.tagline ? <Text style={{ ...ty.label, color: t.ink3, marginTop: 2 }}>{sel.tagline}</Text> : null}
                </View>
              </View>

              {sel.sessionFee > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: sp.lg }}>
                  <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>Session fee</Text>
                  <Text style={{ ...value(20), color: t.ink }}>${sel.sessionFee}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginLeft: 4 }}>/ session</Text>
                </View>
              ) : null}

              {sel.bio ? <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>{sel.bio}</Text> : null}

              {sel.specialties.length > 0 ? (<>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Specialties</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: sp.xl }}>
                  {sel.specialties.map((sx) => (
                    <View key={sx} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                      <Text style={{ ...ty.caption, color: t.ink2 }}>{sx}</Text>
                    </View>
                  ))}
                </View>
              </>) : null}

              {sent[sel.id] ? (
                <View style={{ backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.lg, marginBottom: sp.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Request pending</Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{sel.name} has your request. You'll be connected when they accept.</Text>
                </View>
              ) : (<>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Start coaching</Text>
                {(['online', 'inperson'] as Mode[]).map((m) => (
                  <View key={m} style={{ marginBottom: 9 }}>
                    <Cta label={`Request ${m === 'inperson' ? 'in-person' : 'online'} coaching`} wide onPress={() => request(sel, m)} />
                  </View>
                ))}
              </>)}

              <View style={{ marginTop: sp.sm }}>
                <Ghost label="Close" onPress={() => setSel(null)} />
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
