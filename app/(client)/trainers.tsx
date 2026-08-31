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
import { View, Text, Pressable, ScrollView, Modal, Alert, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useInvites } from '../../src/ui/invites';
import { joinByCode } from '../../src/ui/joinCode';
import { isPlausibleCode, normaliseCode, CODE_LENGTH } from '../../src/lib/joinCode';
import { peekJoinCode, clearJoinCode } from '../../src/ui/pendingJoinCode';
import { notifySuccess } from '../../src/ui/haptics';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { COACHED_MODES, COACHED_MODE_SHORT, COACHING_MODE_NOTE, type CoachedMode } from '../../src/lib/types';
// Who coaches you, asked the way the database asks it — BOTH links, so this
// screen and the photo-sharing screen can never disagree about whether somebody
// is your coach.
import { fetchMyCoach, type CoachRef } from '../../src/lib/photoShare';
import { endCoaching, leaveCoachPrompt, leaveOutcome, coachLabel } from '../../src/lib/endCoaching';

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
  // Three answers where there were two. `coaches: []` meant both "no trainer has
  // published a profile" and "we never got an answer from the server", and this
  // screen asserted the first in both cases — a client read "No coaches listed
  // yet" off a directory that was full, and concluded there was nobody on
  // Repple to hire. `status` is what the empty state is now gated on.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [sel, setSel] = useState<Coach | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  // Set only when the pending-requests read itself failed. Absence of a request
  // and an unreadable list of requests are different things: the first means
  // "ask this coach", the second means "we don't know whether you already did".
  const [pendingUnknown, setPendingUnknown] = useState(false);
  // The direct path. The directory below is opt-in — a coach who has not
  // published a profile cannot be found in it at all — and the email invite
  // only arrives if the coach spelled the address exactly as the client did.
  // A code the coach hands over depends on neither.
  const [code, setCode] = useState('');
  // Filled from the link they arrived on, if there was one. A coach's bio link
  // carries their code through the install and lands here already typed, which
  // is the difference between an audience and a client: the alternative was
  // asking somebody to memorise six characters across an App Store visit, and
  // whoever forgets them joins attributed to nothing at all.
  //
  // Not consumed on arrival. Somebody who taps a link, gets distracted and comes
  // back tomorrow should still find it waiting — it is spent when the request is
  // actually sent, not when it is shown. And it never overwrites something they
  // have started typing themselves.
  const [fromLink, setFromLink] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await peekJoinCode();
      if (cancelled || !pending) return;
      setCode((cur) => (cur ? cur : pending));
      setFromLink(true);
    })();
    return () => { cancelled = true; };
  }, []);
  const [codeBusy, setCodeBusy] = useState(false);
  // ── The way out ────────────────────────────────────────────────────────────
  //
  // This screen has always been able to START a coaching relationship — an
  // invitation, a code, a directory request — and until now nothing anywhere in
  // the product could end one. A client who wanted to leave had no way to, and
  // their coach kept reading every workout, scan, measurement, check-in and
  // message indefinitely. It belongs here because this is where every other
  // transition of the relationship already lives.
  //
  // Three states again, and for the same reason as the directory below: `coach
  // === null` must mean "nobody coaches you", never "we could not find out".
  // Getting that wrong here would hide the Leave control from somebody who is
  // being coached and wants out, which is the worst direction to fail in.
  const [coach, setCoach] = useState<CoachRef | null>(null);
  const [coachStatus, setCoachStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [leaving, setLeaving] = useState(false);

  const submitCode = async () => {
    if (codeBusy || !isPlausibleCode(code)) return;
    setCodeBusy(true);
    // Their own answer to how they are coached, not an assumption. 'solo'
    // means they had no coach until now, and asking for one online is the
    // safer default — a wrong 'inperson' puts them on a roster for sessions
    // nobody is going to run. 'hybrid' passes straight through; joinByCode
    // narrows it for the RPC and says why.
    const r = await joinByCode(code, cd.coachingMode === 'solo' ? 'online' : cd.coachingMode);
    setCodeBusy(false);
    if (!r.ok) { Alert.alert('That code didn’t work', r.reason); return; }
    // Spent, so it does not come back next time. Only now — not when it was
    // shown — because a code that was merely displayed has not done its job.
    setCode('');
    setFromLink(false);
    void clearJoinCode();
    // `already` is a real outcome, not a failure: they had asked before, or are
    // already coached by this person. Saying "request sent" again would have
    // them waiting on a second answer that is never coming.
    Alert.alert(
      r.already ? 'You’ve already asked ' + r.trainerName : 'Request sent to ' + r.trainerName,
      r.already
        ? 'Nothing new was sent. ' + r.trainerName + ' has your earlier request, or already coaches you.'
        : r.trainerName + ' sees your request in their app and adds you once they accept. Not who you expected? Check the code with them before they do.',
      [{ text: 'OK' }],
    );
  };

  // Who coaches you. A separate effect from the directory below because the two
  // answers are independent: the directory failing must not hide your own coach,
  // and not knowing your coach must not empty the directory.
  //
  // `fetchMyCoach()` THROWS on a read failure rather than returning null, which
  // is the whole reason it can be trusted here — "you have no coach" is a real
  // state with a real screen behind it and must never be manufactured out of a
  // refused query.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!USE_SUPABASE) { setCoachStatus('ready'); return; }
      setCoachStatus('loading');
      try {
        // Signed out is a true answer, not a failed check — and fetchMyCoach()
        // throws when there is no session, which would land in the catch below
        // and report an error to somebody who is simply not signed in.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setCoach(null); setCoachStatus('ready'); return; }
        const mine = await fetchMyCoach();
        if (cancelled) return;
        setCoach(mine);
        setCoachStatus('ready');

        // ── and then the name ──────────────────────────────────────────────
        //
        // fetchMyCoach() reads the name straight off `profiles`, and a client
        // cannot read that row. Every SELECT policy on `profiles` runs the
        // other way — coach → client, owner → tenant — except
        // profiles_public_directory_r, which shows `trainers.listed = true`
        // to everybody and is the only reason this ever appeared to work.
        // `listed` defaults to FALSE, so for a coach who got their first
        // client by handing over a join code rather than by publishing a
        // directory profile — which is every new independent coach — the read
        // matches no row and the card above renders their coach as "—", above
        // a button offering to "Leave your coach". Confirmed on the live
        // database against a freshly provisioned coach and client.
        //
        // my_coach() is the answer the rest of the app already uses for this
        // (supabase/parts/67, extended by 115; src/ui/messaging.ts calls it for
        // the thread header). It is SECURITY DEFINER, takes no argument — so
        // there is no id to probe with and no coach but your own can be named
        // — and it names the two columns it returns rather than handing over a
        // whole profiles row.
        //
        // Asked SECOND, and only to fill a blank. fetchMyCoach() stays the
        // authority on WHETHER somebody coaches you, so this screen and the
        // photo-sharing screen still cannot disagree about that; all that is
        // taken from here is the label. A refusal leaves the dash exactly
        // where it already was.
        if (mine && !(mine.name || '').trim()) {
          const { data: named, error: namedErr } = await supabase.rpc('my_coach');
          if (cancelled) return;
          if (namedErr) {
            reportError('findTrainer.coachName', namedErr);
          } else {
            const row = Array.isArray(named) ? named[0] : named;
            const n = typeof row?.coach_name === 'string' ? row.coach_name.trim() : '';
            // Only when it is the same coach. The two reads are a moment
            // apart and a link that changed in between must not put one
            // coach's name against another's id.
            if (n && row?.coach_id === mine.id) setCoach({ ...mine, name: n });
          }
        }
      } catch (e) {
        reportError('findTrainer.myCoach', e);
        if (!cancelled) setCoachStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  // Ask first, in plain words about what actually changes. The copy is built in
  // src/lib/endCoaching.ts and asserted on in endCoaching.test.ts rather than
  // written inline, because the sentence that must never appear — "you have
  // left" over a call the server refused — is not something a screen can be
  // trusted to keep out of itself.
  const confirmLeave = () => {
    if (!coach || leaving) return;
    const p = leaveCoachPrompt(coach.name);
    Alert.alert(p.title, p.body, [
      { text: p.cancelLabel, style: 'cancel' },
      { text: p.confirmLabel, style: 'destructive', onPress: () => { void leaveCoach(); } },
    ]);
  };

  const leaveCoach = async () => {
    if (!coach) return;
    setLeaving(true);
    const result = await endCoaching(coach.id);
    setLeaving(false);
    // Nothing on this screen changes until the server has said what happened.
    // `ok` covers both true outcomes — the link was ended, or there was never
    // one to end — and in both the server is certain there is no live link, so
    // the coach comes off the screen. A refusal changes nothing at all.
    if (result.ok) {
      setCoach(null);
      // Their own answer to how they are coached, kept in step. It was set when
      // they accepted an invitation (`acceptCoach` below); leaving is the same
      // fact in reverse, and without this the AI coach would go on being told
      // there is somebody in the room for their booked sessions.
      cd.setCoachingMode('solo');
      // Re-read the pending-request list: leaving does not create one, but the
      // screen below is now the screen of somebody looking for a coach.
      setAttempt((n) => n + 1);
    }
    const said = leaveOutcome(result, coach.name);
    Alert.alert(said.title, said.body, [{ text: 'OK' }]);
  };

  const acceptCoach = async (id: string, coachName: string | null, mode: string) => {
    // "You are connected" used to be said whether or not the link was made. The
    // accept RPC resolves on refusal rather than throwing, so a failed accept
    // told the client they had a coach, switched their coaching mode, and left
    // the coach with no client — and neither side had anything to look at that
    // would explain it.
    const { mode: m, ok } = await acceptInvite(id);
    if (!ok) {
      Alert.alert(
        'Not connected yet',
        'We could not link you to ' + (coachName || 'your coach') + '. Your invitation is still here — try accepting it again in a moment.',
      );
      return;
    }
    cd.setCoachingMode(m);
    notifySuccess();
    Alert.alert('You are connected', (coachName || 'Your coach') + ' is now your ' + COACHED_MODE_SHORT[m].toLowerCase() + ' coach. Their plan, feedback and messaging are now on your app.', [{ text: 'Great' }]);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!USE_SUPABASE) { setStatus('ready'); return; }
      setStatus('loading');
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id ?? null;

        // supabase-js resolves; it does not throw. An RLS refusal or a dead
        // connection arrives as `error` set and `data` null, so a query read for
        // its `data` alone degrades into an empty directory that looks exactly
        // like an honest one. Every read below now checks `error` first.
        const { data: rows, error: rowsErr } = await supabase
          .from('trainers')
          .select('id, bio, tagline, specialties, session_fee')
          .eq('listed', true);
        if (cancelled) return;
        if (rowsErr) throw rowsErr;

        const ids = (rows ?? []).map((r: any) => r.id).filter((id: string) => id !== uid);
        if (ids.length === 0) { setCoaches([]); setStatus('ready'); return; }

        const { data: profs, error: profsErr } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        if (cancelled) return;
        // Names live in `profiles`, not in `trainers`, and a coach we cannot name
        // is dropped below as an unfinished profile. So a failure here does not
        // thin the directory, it empties it: every listing we just read
        // successfully would vanish and the screen would report a working
        // directory as "No coaches listed yet". Having listings we cannot put a
        // name to is a failed load, and it is reported as one.
        if (profsErr) throw profsErr;
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
        // Worth its own branch rather than the outer catch: the directory we
        // just loaded is real and useful on its own, so losing this read should
        // caveat the request buttons, not throw away the list of coaches.
        if (uid) {
          const { data: reqs, error: reqsErr } = await supabase
            .from('coach_requests')
            .select('trainer_id')
            .eq('client_id', uid)
            .eq('status', 'pending');
          if (cancelled) return;
          if (reqsErr) {
            reportError('findTrainer.pending', reqsErr);
            setPendingUnknown(true);
          } else {
            setSent(Object.fromEntries((reqs ?? []).map((r: any) => [r.trainer_id, true])));
            setPendingUnknown(false);
          }
        }

        if (!cancelled) { setCoaches(list); setStatus('ready'); }
      } catch (e) {
        reportError('findTrainer.load', e);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const request = useCallback(async (coach: Coach, mode: CoachedMode) => {
    setSel(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) { Alert.alert('Sign in required', 'Sign in to Repple to request coaching.'); return; }
      // `source` is what makes the coach's attribution add up. The column and
      // its check constraint have allowed 'directory' since part 56 and nothing
      // ever wrote it: this insert left it null, so a client who found their
      // coach by browsing was indistinguishable from a row created before the
      // column existed, and the coach's "where did people come from?" had one
      // real bucket and one permanently empty one.
      const { error } = await supabase.from('coach_requests').insert({
        client_id: uid, trainer_id: coach.id, mode, status: 'pending', source: 'directory',
      });
      if (error && !/duplicate|unique/i.test(error.message)) {
        Alert.alert('Could not send request', error.message);
        return;
      }
      setSent((s) => ({ ...s, [coach.id]: true }));
      notifySuccess();
      Alert.alert(
        'Request sent',
        `${coach.name} will see your ${COACHED_MODE_SHORT[mode].toLowerCase()} coaching request on their dashboard. You'll be connected once they accept — nothing changes on your app until then.`,
        [{ text: 'Got it' }]
      );
    } catch (e) {
      reportError('findTrainer.request', e);
      Alert.alert('Could not send request', 'Check your connection and try again.');
    }
  }, []);

  const G = layout.gutter;
  // `n.split(' ').map((x) => x[0]).join('')` is the obvious version and it is
  // the `String(null)` mistake in another costume: any run of two spaces yields
  // an empty part, `''[0]` is undefined, and `join` spells that out — so
  // "Sam  Rivera" was drawn on the avatar as "SundefinedR". Dropping the empty
  // parts is the fix; a name that leaves nothing falls back to a dash.
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((x) => x[0].toUpperCase()).join('') || '—';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Connect</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Find a Trainer</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Enter your coach's code, or browse everyone coaching on Repple.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* ── your coach, and the way out ─────────────────────────────────
            Above the invitations and the directory because it is the fact the
            rest of this screen is relative to: what a client can usefully do
            here depends on whether somebody is already coaching them. */}
        {coachStatus === 'loading' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingTop: sp.lg }}>
            <ActivityIndicator color={t.brand} size="small" />
            <Text style={{ ...ty.caption, color: t.ink3 }}>Checking who coaches you…</Text>
          </View>
        ) : coachStatus === 'error' ? (
          <View style={{ marginTop: sp.lg }}>
            {/* Not "you have no coach". The read failed, and a client who IS
                being coached must not read this as confirmation that nobody
                is — that is the state in which they would stop asking to
                leave. */}
            <Notice tone={t.warn} kicker="Your coach" title="We couldn’t check who coaches you"
              note="This is our end, not an answer about you. Until it loads we can’t show you your coach or let you leave them, so don’t read this as nobody coaching you.">
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={() => setAttempt((n) => n + 1)} />
              </View>
            </Notice>
          </View>
        ) : coach ? (
          <Section>
            <SectionHead title="Your Coach" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                {/* A coach who has not set a name is a real state — part 67
                    returns a row with a null name for exactly that — and a dash
                    is what the record supports. Never a placeholder that reads
                    like a name. */}
                <Text style={{ ...value(13), color: t.brand }}>{coach.name?.trim() ? initials(coach.name) : '—'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{coach.name?.trim() || '—'}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  Sees your workouts, measurements, check-ins, scans and anything you send them.
                </Text>
              </View>
            </View>
            <View style={{ marginTop: sp.lg }}>
              {/* Ghost rather than a brand Cta: leaving is not the action this
                  screen is encouraging, and it asks before it does anything. */}
              <Ghost label={leaving ? 'Leaving…' : `Leave ${coachLabel(coach.name)}`} onPress={confirmLeave} />
            </View>
          </Section>
        ) : null}

        {/* ── invitations: the one thing that needs a decision ────────────── */}
        {received.length > 0 ? (
          <View style={{ marginTop: sp.lg }}>
            {received.map((iv) => (
              <Notice key={iv.id} tone={t.brand}
                kicker="Coaching invitation"
                title={`${iv.coachName || 'A Coach'} invited you`}
                note={`${COACHED_MODE_SHORT[iv.mode]} coaching. ${COACHING_MODE_NOTE[iv.mode]} Accept to connect — their program, feedback and messaging turn on for you.`}>
                <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                  <View style={{ flex: 1 }}><Ghost label="Decline" onPress={() => declineInvite(iv.id)} /></View>
                  <View style={{ flex: 2 }}><Cta label="Accept Invitation" wide onPress={() => acceptCoach(iv.id, iv.coachName, iv.mode)} /></View>
                </View>
              </Notice>
            ))}
          </View>
        ) : null}

        <Rule />

        {/* ── the direct path ────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Have a code from your coach?" />
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
            {fromLink
              ? 'Your coach’s code came in with the link you tapped, so it is already filled in below. Send it when you are ready — they see the request and add you once they accept.'
              : 'Ask them for their coaching code — it’s six characters, in their app under Clients › Add a client. This works even if they aren’t listed in the directory below.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(normaliseCode(v))}
              placeholder="ABC123"
              placeholderTextColor={t.ink3}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={CODE_LENGTH}
              returnKeyType="go"
              onSubmitEditing={submitCode}
              accessibilityLabel="Your coach’s six-character code"
              style={{
                flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm,
                paddingHorizontal: sp.lg, paddingVertical: 13,
                ...ty.body, color: t.ink, letterSpacing: 4,
              }}
            />
            <View style={{ flex: 1 }}>
              {/* Disabled until it could actually be a code, so the failure a
                  half-typed code produces is never reached. */}
              <Cta label={codeBusy ? 'Checking…' : 'Join'} wide
                disabled={codeBusy || !isPlausibleCode(code)}
                onPress={submitCode} />
            </View>
          </View>
        </Section>

        <Rule />

        {/* ── the directory ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Coaches on Repple" note={status === 'ready' && coaches.length > 0 ? String(coaches.length) : undefined} />

          {/* The read failed, so nothing below this line is a statement about who
              is coaching on Repple. Naming the gap is the whole point: the old
              screen turned this into "No coaches listed yet", which a client has
              no way to tell apart from the truth. */}
          {status === 'error' ? (
            <Notice tone={t.warn} kicker="Directory" title="We couldn’t load the directory"
              note="This is our end, not an empty directory. Until it loads we can't tell you who is coaching on Repple.">
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={() => setAttempt((n) => n + 1)} />
              </View>
            </Notice>
          ) : null}

          {status === 'loading' ? (
            <View style={{ paddingVertical: sp.huge, alignItems: 'center' }}><ActivityIndicator color={t.brand} /></View>
          ) : status === 'error' ? null : coaches.length === 0 ? (
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
                {/* Without the pending-requests read, the absence of a "Request
                    pending" badge is not evidence that none is outstanding —
                    it's evidence we couldn't look. Sending again is harmless
                    (the insert is deduplicated), but the client should know
                    they may be asking twice rather than for the first time. */}
                {pendingUnknown ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                    We couldn’t check your existing requests, so we can’t tell whether you’ve already asked {sel.name}. Sending again won’t create a second request.
                  </Text>
                ) : null}
                {/* Three buttons, each with the line that says what it changes.
                    "Hybrid" is a word until it is spelled out, and the same is
                    true of the two that were already here — a client picking
                    between them had nothing to pick on. */}
                {COACHED_MODES.map((m) => (
                  <View key={m} style={{ marginBottom: sp.md }}>
                    <Cta label={`Request ${COACHED_MODE_SHORT[m].toLowerCase()} coaching`} wide onPress={() => request(sel, m)} />
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5, textAlign: 'center' }}>{COACHING_MODE_NOTE[m]}</Text>
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
