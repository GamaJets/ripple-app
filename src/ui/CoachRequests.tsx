// Inbound coaching requests — clients who found this trainer in the public
// directory and asked to be coached. Renders nothing at all when there are
// none, so it costs no space on the dashboard.
//
// Accepting links the client via `coach_clients` and marks the request
// accepted; declining just marks it declined. Both are real writes — the
// client's "Request pending" state on their side reflects this row.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { Icon } from './Icon';
import { useTheme } from './components';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { notifySuccess } from './haptics';

interface Req { id: string; clientId: string; name: string; mode: 'online' | 'inperson'; at: string }

export function CoachRequests() {
  const t = useTheme();
  const [reqs, setReqs] = useState<Req[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) return;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;
      const { data: rows } = await supabase
        .from('coach_requests')
        .select('id, client_id, mode, created_at')
        .eq('trainer_id', uid)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      const ids = (rows ?? []).map((r: any) => r.client_id);
      if (ids.length === 0) { setReqs([]); return; }
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      const nameById = new Map<string, string>((profs ?? []).map((p: any) => [p.id, p.full_name]));
      setReqs((rows ?? []).map((r: any) => ({
        id: r.id,
        clientId: r.client_id,
        name: (nameById.get(r.client_id) || 'A client').trim() || 'A client',
        mode: r.mode === 'inperson' ? 'inperson' : 'online',
        at: r.created_at,
      })));
    } catch (e) { reportError('coachRequests.load', e); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const respond = useCallback(async (r: Req, accept: boolean) => {
    setBusy(r.id);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;
      if (accept) {
        // coach_clients is keyed on the client's own id; name and mode are NOT NULL.
        const { error } = await supabase.from('coach_clients').upsert(
          { id: r.clientId, trainer_id: uid, name: r.name, mode: r.mode },
          { onConflict: 'id' },
        );
        if (error) { Alert.alert('Could not accept', error.message); setBusy(null); return; }
      }
      const { error: uErr } = await supabase.from('coach_requests')
        .update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
        .eq('id', r.id);
      if (uErr) { Alert.alert('Could not update the request', uErr.message); setBusy(null); return; }
      setReqs((p) => p.filter((x) => x.id !== r.id));
      if (accept) { notifySuccess(); Alert.alert('Client added', `${r.name} is now on your roster.`); }
    } catch (e) {
      reportError('coachRequests.respond', e);
      Alert.alert('Something went wrong', 'Check your connection and try again.');
    }
    setBusy(null);
  }, []);

  if (reqs.length === 0) return null;

  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.brand, padding: 16, marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon name="people" size={15} color={t.brand} />
        <Text style={{ color: t.brand, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Coaching request{reqs.length > 1 ? 's' : ''} · {reqs.length}
        </Text>
      </View>
      {reqs.map((r) => (
        <View key={r.id} style={{ paddingTop: 8 }}>
          <Text style={{ color: t.ink, fontSize: 15, fontWeight: '800' }}>{r.name}</Text>
          <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 2, marginBottom: 10 }}>
            Asked for {r.mode === 'inperson' ? 'in-person' : 'online'} coaching. Accepting adds them to your roster.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 6 }}>
            <Pressable disabled={busy === r.id} onPress={() => respond(r, false)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, opacity: busy === r.id ? 0.5 : 1 }}>
              <Text style={{ color: t.ink2, fontWeight: '800' }}>Decline</Text>
            </Pressable>
            <Pressable disabled={busy === r.id} onPress={() => respond(r, true)} style={{ flex: 2, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: t.brand, opacity: busy === r.id ? 0.5 : 1 }}>
              <Text style={{ color: t.brandInk, fontWeight: '800' }}>Accept</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}
