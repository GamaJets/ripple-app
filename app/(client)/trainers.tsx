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
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useClientData } from '../../src/ui/clientData';
import { useInvites } from '../../src/ui/invites';
import { notifySuccess } from '../../src/ui/haptics';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';

const SERIF = 'Georgia';
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={{ marginBottom: 8 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: SERIF }}>Find a trainer</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 14 }}>Browse coaches on Repple and start online or in-person.</Text>

        {received.length > 0 ? (
          <View style={{ marginBottom: 16 }}>
            {received.map((iv) => (
              <View key={iv.id} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.brand, padding: 15, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Icon name="sparkle" size={15} color={t.brand} />
                  <Text style={{ color: t.brand, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>Coaching invitation{iv.demo ? ' · sample' : ''}</Text>
                </View>
                <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>{iv.coachName || 'A coach'} invited you</Text>
                <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 12 }}>{iv.mode === 'inperson' ? 'In-person' : 'Online'} coaching. Accept to connect — their program, feedback and messaging turn on for you.</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable onPress={() => declineInvite(iv.id)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.ink2, fontWeight: '800' }}>Decline</Text></Pressable>
                  <Pressable onPress={() => acceptCoach(iv.id, iv.coachName, iv.mode)} style={{ flex: 2, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: t.brand }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Accept invitation</Text></Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={t.brand} /></View>
        ) : coaches.length === 0 ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 22, alignItems: 'center' }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><Icon name="people" size={24} color={t.ink3} /></View>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>No coaches listed yet</Text>
            <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>Trainers appear here once they publish their profile to the directory. If a coach has invited you directly, their invitation shows above.</Text>
          </View>
        ) : coaches.map((c) => (
          <Pressable key={c.id} onPress={() => setSel(c)} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.brand, fontWeight: '800', fontSize: 16 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{c.name}</Text>
                {c.tagline ? <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 1 }}>{c.tagline}</Text> : null}
              </View>
              {c.sessionFee > 0 ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>${c.sessionFee}</Text>
                  <Text style={{ color: t.ink3, fontSize: 10 }}>/ session</Text>
                </View>
              ) : null}
            </View>
            {c.specialties.length > 0 || sent[c.id] ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {sent[c.id] ? <Text style={{ color: t.brand, fontSize: 12, fontWeight: '800' }}>Request pending</Text> : null}
                <View style={{ flex: 1 }} />
                {c.specialties.slice(0, 3).map((sp) => (
                  <View key={sp} style={{ borderWidth: 1, borderColor: t.ring, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '700' }}>{sp}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '86%' }}>
          {sel && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: t.brand, fontWeight: '800', fontSize: 20 }}>{sel.name.split(' ').map((x) => x[0]).join('')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontSize: 21, fontWeight: '700', fontFamily: SERIF }}>{sel.name}</Text>
                  {sel.tagline ? <Text style={{ color: t.ink3, fontSize: 13, marginTop: 1 }}>{sel.tagline}</Text> : null}
                </View>
              </View>

              {sel.sessionFee > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                  <View style={{ flex: 1 }} />
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>${sel.sessionFee}<Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}> / session</Text></Text>
                </View>
              ) : null}

              {sel.bio ? <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 21, marginBottom: 16 }}>{sel.bio}</Text> : null}

              {sel.specialties.length > 0 ? (<>
                <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Specialties</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
                  {sel.specialties.map((sp) => (
                    <View key={sp} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 }}>
                      <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700' }}>{sp}</Text>
                    </View>
                  ))}
                </View>
              </>) : null}

              {sent[sel.id] ? (
                <View style={{ backgroundColor: t.surface2, borderColor: t.brand, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Request pending</Text>
                  <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>{sel.name} has your request. You'll be connected when they accept.</Text>
                </View>
              ) : (<>
                <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Start coaching</Text>
                {(['online', 'inperson'] as Mode[]).map((m) => (
                  <Pressable key={m} onPress={() => request(sel, m)} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 9, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                    <Icon name={m === 'inperson' ? 'people' : 'video'} size={16} color={t.brandInk} />
                    <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Request {m === 'inperson' ? 'in-person' : 'online'} coaching</Text>
                  </Pressable>
                ))}
              </>)}

              <Pressable onPress={() => setSel(null)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 8 }}>
                <Text style={{ color: t.ink, fontWeight: '700' }}>Close</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
