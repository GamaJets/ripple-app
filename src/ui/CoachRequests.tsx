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
import { Card, PartialRead } from './kit';
import { sp, radius, hairline, type as ty } from '../theme/scale';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { notifySuccess } from './haptics';
import { readCoachedMode, COACHED_MODE_SHORT, type CoachedMode } from '../lib/types';
import { capLimit, capped } from '../lib/rowCap';

interface Req { id: string; clientId: string; name: string; mode: CoachedMode; at: string }

export function CoachRequests() {
  const t = useTheme();
  const [reqs, setReqs] = useState<Req[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  /** The request list could not be read. Not the same as having none. */
  const [unread, setUnread] = useState(false);
  /** The list was read and there are more requests than are on screen. Not the
   *  same as having failed to read it, and not the same as having them all. */
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) return;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;
      const { data: rows, error } = await supabase
        .from('coach_requests')
        .select('id, client_id, mode, created_at')
        .eq('trainer_id', uid)
        .eq('status', 'pending')
        // Newest first, capped. Pending requests only ever accumulate when a
        // coach stops answering them, which is precisely the coach who has more
        // than a thousand — and the oldest of those are the ones the client has
        // long since given up on.
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(capLimit());
      // A refused read used to leave this list empty, which renders as nothing
      // at all — no pending requests. This is the join flow: a client asks to
      // be coached, the coach never learns they asked, and both sides wait on
      // the other. Silence is the one outcome this component must not invent.
      if (error) { reportError('coachRequests.load', error); setUnread(true); return; }
      setUnread(false);
      const page = capped(rows);
      setTruncated(page.truncated);
      const ids = page.rows.map((r: any) => r.client_id);
      if (ids.length === 0) { setReqs([]); return; }
      // Bounded by `ids`, which the cap above holds at ROW_CAP or fewer.
      // no-error-ok: a name we cannot read falls back to 'A client'; the request is still shown and actionable
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids).limit(capLimit());
      const nameById = new Map<string, string>((profs ?? []).map((p: any) => [p.id, p.full_name]));
      setReqs(page.rows.map((r: any) => ({
        id: r.id,
        clientId: r.client_id,
        name: (nameById.get(r.client_id) || 'A client').trim() || 'A client',
        mode: readCoachedMode(r.mode),
        at: r.created_at,
      })));
    } catch (e) { reportError('coachRequests.load', e); setUnread(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const respond = useCallback(async (r: Req, accept: boolean) => {
    setBusy(r.id);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;
      if (accept) {
        // link_coaching FIRST, and this ordering is the fix rather than a
        // detail. Accepting used to write only coach_clients, which is a
        // roster and nothing more. Every log a coach actually wants —
        // workouts, measurements, check_ins, habit_logs — is gated by RLS on
        // `clients.trainer_id = auth.uid()` (19-trainer-read-access.sql), and
        // nothing here ever set that column. So the client appeared on the
        // roster, the app said "is now on your roster", and the coach could
        // read none of their logs. That is the "my coach cannot see my logs"
        // report.
        //
        // link_coaching is SECURITY DEFINER, writes coaching_relationships AND
        // clients.trainer_id, and since 38-tenant-isolation.sql it authorises
        // when auth.uid() = p_coach — which is exactly this call.
        const { error: linkErr } = await supabase.rpc('link_coaching', {
          p_coach: uid, p_client: r.clientId, p_mode: r.mode,
        });
        if (linkErr) {
          // Stop here. Writing the roster row after this failed is what
          // produced a coach who could see a name and nothing behind it.
          reportError('coachRequests.link', linkErr);
          Alert.alert('Could not accept', `${r.name} was not added. ${linkErr.message}`);
          setBusy(null); return;
        }
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

  // Nothing pending renders nothing — correct, and the reason the failed-read
  // case had to be given a shape of its own. An invisible component cannot say
  // "I could not check", and that is precisely what a coach needs to know.
  if (reqs.length === 0) {
    if (!unread) return null;
    return (
      <Card tone={t.warn} style={{ marginBottom: sp.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
          <Icon name="people" size={15} color={t.warn} />
          <Text style={{ ...ty.micro, color: t.ink3 }}>Coaching requests</Text>
        </View>
        <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>
          We couldn’t check whether anyone has asked to be coached by you. Pull down to try again —
          if a client is waiting, they can’t tell the difference between you declining and this.
        </Text>
      </Card>
    );
  }

  return (
    <Card tone={t.brand} style={{ marginBottom: sp.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.sm }}>
        <Icon name="people" size={15} color={t.brand} />
        {/* The count is dropped when the read was truncated. `reqs.length` is
            the size of the page, not the size of the queue, and printing it
            here would tell a coach with 1,400 people waiting that 1,000 are —
            a number they would then work through and believe they had cleared. */}
        <Text style={{ ...ty.micro, color: t.ink3 }}>
          Coaching request{reqs.length > 1 ? 's' : ''}{truncated ? '' : ` · ${reqs.length}`}
        </Text>
      </View>
      {truncated ? <PartialRead what="people waiting on you" shown={reqs.length} onPress={() => { load(); }} /> : null}
      {reqs.map((r) => (
        <View key={r.id} style={{ paddingTop: sp.sm }}>
          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.name}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2, marginBottom: sp.md }}>
            Asked for {COACHED_MODE_SHORT[r.mode].toLowerCase()} coaching. Accepting adds them to your roster.
          </Text>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: 6 }}>
            <Pressable disabled={busy === r.id} onPress={() => respond(r, false)} style={{ flex: 1, paddingVertical: 11, borderRadius: radius.sm, alignItems: 'center', backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.ring, opacity: busy === r.id ? 0.5 : 1 }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Decline</Text>
            </Pressable>
            <Pressable disabled={busy === r.id} onPress={() => respond(r, true)} style={{ flex: 2, paddingVertical: 11, borderRadius: radius.sm, alignItems: 'center', backgroundColor: t.brand, opacity: busy === r.id ? 0.5 : 1 }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Accept</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </Card>
  );
}
