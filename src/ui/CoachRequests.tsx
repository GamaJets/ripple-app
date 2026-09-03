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
// ── The other half of the request ─────────────────────────────────────────
//
// app/(client)/trainers.tsx pushes the coach the moment somebody asks. Nothing
// pushed the client when the coach answered, and nothing wrote them a row
// either: `coach_requests_notify_trainer` (supabase/parts/158) is `after
// insert` only, and its header says why — "the client's side of that answer is
// a separate decision about wording that has not been taken."
//
// So Accept rewrote the client's roster membership, their `clients.trainer_id`
// and the request's status in one tap, told the coach "Client added", and told
// the person it was about nothing at all. Decline is the half that matters
// more: an accepted client eventually notices their Coach screen has filled
// in, while a declined one sees exactly what they saw yesterday — a request
// they believe is still pending — because `coach_requests` is not rendered on
// the client side once the row leaves 'pending'.
//
// The wording is in src/lib/notifyCopy.ts with the rest of it, and pure.
import { coachAnswerConfirmation, coachAnswerNotification } from '../lib/notifyCopy';
import { sendPushChecked } from './pushNotifications';

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
        // NO roster write here, and its absence is the fix.
        //
        // This used to upsert `coach_clients` right after the RPC, and it was
        // the line that broke Accept:
        //
        //     Could not accept
        //     new row violates row-level security policy (USING expression)
        //     for table "coach_clients"
        //
        // `coach_clients` is keyed on the CLIENT's id alone. So when somebody
        // already on another coach's roster is accepted, the upsert finds that
        // row and becomes an UPDATE — and an UPDATE is checked against the
        // EXISTING row's USING expression, `trainer_id = auth.uid()`. The row
        // belongs to the previous coach, so this coach is refused. Correctly:
        // they were asking to write another coach's roster row.
        //
        // supabase/parts/155 moved the write INSIDE `link_coaching`, where it
        // runs as the definer and may retire the old coach's row — something no
        // coach may do themselves. The SQL landed and this caller did not, so
        // the app went on making the refused write after the RPC had already
        // made the correct one. `link_coaching` also takes the name from the
        // profile rather than the caller, so a coach cannot file somebody under
        // a name of their choosing.
        //
        // If a roster row is ever missing after an accept, the bug is in that
        // function and belongs there — not in a second write from here.
      }
      // `.eq('status', 'pending')` and `.select('id')`, and both are load-bearing
      // now that an answer sends a notification.
      //
      // The update used to be keyed on the id alone, so answering a request that
      // had already been answered — a second tap, a second handset, the same
      // card left open on a tablet — succeeded silently and restamped
      // `responded_at`. That was harmless while nothing followed it. It is not
      // harmless now: it would tell the client a second time, and the second
      // time could say the opposite of the first.
      //
      // So the write is only a write if it MOVED the row out of 'pending', and
      // the notification hangs off the row coming back rather than off the
      // absence of an error. An empty answer is somebody else having got there
      // first, which is not a failure and is not a reason to send anything.
      const { data: answered, error: uErr } = await supabase.from('coach_requests')
        .update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
        .eq('id', r.id)
        .eq('status', 'pending')
        .select('id');
      if (uErr) { Alert.alert('Could not update the request', uErr.message); setBusy(null); return; }
      setReqs((p) => p.filter((x) => x.id !== r.id));
      if (!(answered ?? []).length) {
        // Not an error, and not a send. The accept branch's `link_coaching`
        // above is idempotent, so the roster is right either way; what is wrong
        // is claiming to have just done something somebody else already did.
        Alert.alert('Already answered',
          `${r.name}'s request had already been answered — from another device, or a second tap. Nothing has changed and they have not been told twice.`);
        setBusy(null); return;
      }

      // The coach's own name, for the client's sentence. Read rather than
      // assumed: this notification is read on a lock screen by somebody who may
      // have asked two coaches, so the subject is never dropped.
      // no-error-ok: a name that could not be read becomes "The coach you
      // asked" in coachAnswerNotification — the answer itself is already
      // written at this point, so a failure here costs a name and nothing else.
      const { data: mine, error: mineErr } = await supabase
        .from('profiles').select('full_name').eq('id', uid).maybeSingle();
      const myName = mineErr ? '' : (mine?.full_name || '').trim();

      // No channel. The six in COACH_CHANNELS are a COACH's switches and this
      // is addressed to a client, who has never been shown one — passing a
      // channel name here would filter the send against a preference they could
      // not have set.
      const note = coachAnswerNotification(accept, myName);
      const told = await sendPushChecked([r.clientId], note.title, note.body, { route: note.route });

      if (accept) notifySuccess();
      // One sentence for both branches, and it says which of the two things
      // actually happened rather than claiming a send either way.
      Alert.alert(accept ? 'Client added' : 'Request declined',
        coachAnswerConfirmation(accept, r.name, told));
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
