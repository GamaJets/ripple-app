// Client · Account & Sign-in. The two things a member could not do to their
// own account: change the password, and change the email address on it.
//
// app/(client)/settings.tsx offered sign-out and account deletion and nothing
// in between. Supabase auth has supported both of these from the start
// (`updateUser`); nothing in the app reached them, so a member who had reason
// to distrust their password had exactly one route — trigger a "forgotten
// password" email for a password they had not forgotten, leave the app, find
// the mail, and come back through a deep link. And there was no route at all
// to a new email address: somebody changing jobs or leaving a provider simply
// lost the account, because the reset email is the only way back in and it
// goes to the address they no longer have.
//
// ── Two screens' worth of care, for two different reasons ──────────────────
//
// The PASSWORD form asks for the current password even though Supabase does
// not require it. See the long note in src/lib/accountSecurity.ts: without it,
// an unlocked unattended phone is enough to lock somebody out of their own
// account for good.
//
// The EMAIL form never says "changed" until it has read back that it changed.
// `updateUser({ email })` resolves identically whether the address moved or a
// confirmation link went out, and which of those happened depends on a project
// setting this app cannot see — one that is deliberately OFF until launch and
// will be ON afterwards. So the outcome is read from the server and the screen
// has three sentences, not one. A member told "your email has been changed"
// who then cannot sign in tomorrow has been given the single most expensive
// wrong sentence this app is capable of.
//
// Nothing here holds a password anywhere but in the form state it is typed
// into, and every field is cleared on success. No password reaches
// reportError, AsyncStorage, or a log line.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Flag, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useAuth } from '../../src/ui/auth';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import {
  MIN_PASSWORD, changeEmail, changePassword, emailProblem, passwordProblem, pendingEmail,
} from '../../src/lib/accountSecurity';

/** Have we read the account's own state, and what did it say. `'failed'` is
 *  kept apart from `null` for the reason settings.tsx keeps them apart: a read
 *  that did not land must never render as "nothing outstanding". */
type PendingState = { email: string | null } | 'failed' | null;

export default function Account() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const email = auth.user?.email || '';

  const inp = {
    ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
    paddingHorizontal: sp.md, paddingVertical: 10, marginTop: sp.sm,
  } as const;

  /* ── an outstanding email change, read on mount ─────────────────────────── */

  const [pending, setPending] = useState<PendingState>(null);
  const loadPending = useCallback(async () => {
    if (!USE_SUPABASE) { setPending({ email: null }); return; }
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) { reportError('account.pendingEmail', error); setPending('failed'); return; }
      setPending({ email: pendingEmail(data?.user ?? null) });
    } catch (e) { reportError('account.pendingEmail', e); setPending('failed'); }
  }, []);
  useEffect(() => { void loadPending(); }, [loadPending]);

  /* ── the password form ──────────────────────────────────────────────────── */

  // These three live for exactly as long as the form does. Nothing outside this
  // component ever sees them, and they are wiped the moment the change lands.
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNote, setPwNote] = useState<string | null>(null);

  const wipePassword = () => { setCurrent(''); setNext(''); setConfirm(''); };

  const submitPassword = async () => {
    if (pwBusy) return;
    const problem = passwordProblem(next, confirm, current);
    if (problem) { setPwNote(problem); return; }
    if (!USE_SUPABASE) { setPwNote('This build has no backend connected, so there is no password to change.'); return; }
    setPwBusy(true);
    setPwNote(null);
    try {
      const res = await changePassword(supabase.auth, email, current, next);
      if (!res.ok) {
        // The note is a sentence. The values that produced it are not attached
        // to anything, here or in accountSecurity.ts.
        setPwNote(res.note);
        // Keep the new-password boxes so a typo in the CURRENT one does not
        // cost them the password they had just composed.
        if (res.field === 'current') setCurrent('');
        return;
      }
      wipePassword();
      setPwNote(null);
      Alert.alert('Password changed',
        'Your new password is in place. You are still signed in on this phone; anywhere else you are signed in stays signed in until that session expires.');
    } finally { setPwBusy(false); }
  };

  /* ── the email form ─────────────────────────────────────────────────────── */

  const [newEmail, setNewEmail] = useState('');
  const [emBusy, setEmBusy] = useState(false);
  const [emNote, setEmNote] = useState<string | null>(null);

  const submitEmail = async () => {
    if (emBusy) return;
    const problem = emailProblem(newEmail, email);
    if (problem) { setEmNote(problem); return; }
    if (!USE_SUPABASE) { setEmNote('This build has no backend connected, so there is no address to change.'); return; }
    setEmBusy(true);
    setEmNote(null);
    try {
      const res = await changeEmail(supabase.auth, newEmail);
      if (!res.ok) { setEmNote(res.note); return; }
      setNewEmail('');
      // Whatever happened, re-read: what the screen shows next comes from the
      // account, not from the fact that a call returned.
      await loadPending();
      if (res.outcome === 'changed') {
        Alert.alert('Email changed',
          `Your account now uses ${res.requested}. That is the address to sign in with from now on, and the one a password reset will go to.`);
        return;
      }
      if (res.outcome === 'pending') {
        Alert.alert('Check your inbox — nothing has changed yet',
          `We have sent a confirmation to ${res.requested}. Your account still uses ${fig(email)} and will keep using it until you open that link.\n\n`
          + 'If the link is never opened, nothing happens and your old address goes on working.');
        return;
      }
      // 'unknown'. Said plainly rather than rounded to either neighbour.
      Alert.alert('We could not confirm what happened',
        `Your request went in, but we could not read your account back to see whether the address changed straight away or a confirmation was sent to ${res.requested}.\n\n`
        + `Check that inbox, and sign in with ${fig(email)} until you know otherwise. Nothing has been lost either way.`);
    } finally { setEmBusy(false); }
  };

  const label = (s: string) => <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>{s}</Text>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Settings</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Account & Sign-in</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          The password you sign in with, and the address a reset would go to
        </Text>

        <Rule />

        {/* ── email ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Email Address" />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingBottom: sp.md, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
            <Text style={{ ...ty.label, color: t.ink3 }}>On your account</Text>
            <Text style={{ ...ty.body, color: t.ink, flex: 1, textAlign: 'right' }} numberOfLines={1}>
              {auth.loading ? 'Checking…' : fig(email)}
            </Text>
          </View>

          {/* The four states of "is there a change outstanding", kept apart.
              'failed' is not folded into "none" — telling somebody there is no
              pending change when we could not look is how they type the same
              address again and get a rate-limit error they cannot explain. */}
          {pending === null ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Checking for an outstanding change…</Text>
          ) : pending === 'failed' ? (
            <View style={{ marginTop: sp.md, flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <Flag tone={t.warn} style={{ flex: 1 }}>
                We couldn’t check whether you already have an address change waiting to be confirmed. That is a read that failed, not an answer.
              </Flag>
              <Pressable onPress={() => { void loadPending(); }} hitSlop={8} accessibilityRole="button"
                accessibilityLabel="Check again for an outstanding email change"
                style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Try again</Text>
              </Pressable>
            </View>
          ) : pending.email ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              {`A change to ${pending.email} is waiting to be confirmed. Until the link in that inbox is opened, your account still uses ${fig(email)} and that is what you sign in with.`}
            </Flag>
          ) : null}

          {label('New email address')}
          <TextInput value={newEmail} onChangeText={(v) => { setNewEmail(v); setEmNote(null); }}
            placeholder="you@example.com" placeholderTextColor={t.ink3}
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress"
            accessibilityLabel="New email address" style={inp} />
          {emNote ? <Flag tone={t.crit} style={{ marginTop: sp.md }}>{emNote}</Flag> : null}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Your gym sees the name on your profile, not this. This is the address you sign in with and the only place a password reset can be sent — so keep it one you can open.
          </Text>
          <View style={{ height: sp.md }} />
          <Cta label={emBusy ? 'Sending…' : 'Change Email Address'} wide disabled={emBusy} onPress={() => { void submitEmail(); }} />
        </Section>

        <Rule />

        {/* ── password ───────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Password" />
          {label('Current password')}
          <TextInput value={current} onChangeText={(v) => { setCurrent(v); setPwNote(null); }}
            secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password"
            placeholder="The one you use now" placeholderTextColor={t.ink3}
            accessibilityLabel="Current password" style={inp} />

          {label('New password')}
          <TextInput value={next} onChangeText={(v) => { setNext(v); setPwNote(null); }}
            secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword"
            placeholder={`At least ${MIN_PASSWORD} characters`} placeholderTextColor={t.ink3}
            accessibilityLabel="New password" style={inp} />

          {label('New password again')}
          <TextInput value={confirm} onChangeText={(v) => { setConfirm(v); setPwNote(null); }}
            secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword"
            placeholder="Type it a second time" placeholderTextColor={t.ink3}
            accessibilityLabel="Confirm new password" style={inp} />

          {pwNote ? <Flag tone={t.crit} style={{ marginTop: sp.md }}>{pwNote}</Flag> : null}

          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            We ask for your current password so that a phone left unlocked on a bench can’t be used to lock you out of your own account.
          </Text>
          <View style={{ height: sp.md }} />
          <Cta label={pwBusy ? 'Changing…' : 'Change Password'} wide disabled={pwBusy} onPress={() => { void submitPassword(); }} />
        </Section>

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            Forgotten the current one? Sign out and use “Forgot password” on the sign-in screen — that sends a link to {fig(email)}.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
