// Coach · Account & Sign-in. The two things a coach could not do to their own
// account: change the password, and change the email address on it.
//
// ── The half of the feature that never shipped ─────────────────────────────
//
// src/lib/accountSecurity.ts is written, tested and framework-free:
// `passwordProblem`, `changePassword`, `endOtherSessions`, `emailProblem`,
// `changeEmail`, `pendingEmail`, and a long argument about why the current
// password is asked for even though Supabase does not require it. It has
// exactly one importer, `app/(client)/account.tsx`, and app/(trainer)/ had no
// route to any of it.
//
// So a coach who had reason to distrust their password had one option — sign
// out, trigger a "forgotten password" email for a password they had not
// forgotten, leave the app, find the mail, and come back through a deep link —
// and no option at all for a new address. That is worse for a coach than for a
// member and not better: their account holds their clients' disclosures, their
// clients' messages, their invoice book and their payout details, and the
// address on it is the only route back in if they lose the password.
//
// ── Nothing here is a second implementation ────────────────────────────────
//
// Every rule, every sentence and every failure branch comes from
// src/lib/accountSecurity.ts. Two implementations of "what counts as a weak
// password" or "did the address actually change" is how the two sides of one
// app come to disagree about somebody's own account. What differs from the
// member's screen is the wording around the forms, because what is at stake
// differs: a coach signing somebody out of a device is signing them out of
// other people's records.
//
// The EMAIL form never says "changed" until it has read back that it changed.
// `updateUser({ email })` resolves identically whether the address moved or a
// confirmation link went out, and which of those happened depends on a project
// setting this app cannot see. A coach told "your email has been changed" who
// then cannot sign in tomorrow has been given the single most expensive wrong
// sentence this app is capable of.
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
  MIN_PASSWORD, changeEmail, changePassword, emailProblem, endOtherSessions, passwordProblem, pendingEmail,
} from '../../src/lib/accountSecurity';
import { END_ALIGN } from '../../src/ui/direction';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';

/** Have we read the account's own state, and what did it say. `'failed'` is
 *  kept apart from `null` for the reason settings.tsx keeps them apart: a read
 *  that did not land must never render as "nothing outstanding". */
type PendingState = { email: string | null } | 'failed' | null;

/**
 * The address on the account for use INSIDE a sentence, or a description of it
 * when it could not be read.
 *
 * `fig()` is right for the value slot at the top of the screen, where a dash
 * under a label means "not read". Inside a sentence it is wrong, and here it
 * would not even draw a dash: `email` is `auth.user?.email || ''`, and `fig('')`
 * is the empty string — leaving a hole where the object of the sentence should
 * be, which reads as the screen having broken rather than as a fact nobody has.
 */
function signInAddress(email: string): string {
  return email.trim() || 'the address you have been using';
}

export default function CoachAccount() {
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
      if (error) { reportError('coachAccount.pendingEmail', error); setPending('failed'); return; }
      setPending({ email: pendingEmail(data?.user ?? null) });
    } catch (e) { reportError('coachAccount.pendingEmail', e); setPending('failed'); }
  }, []);
  useEffect(() => { void loadPending(); }, [loadPending]);
  // The one server read on this screen. A coach who requested an email change
  // and confirmed it in their mail client has no other way to see the pending
  // line clear without leaving and coming back.
  const pull = usePullToRefresh(loadPending);

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
      // ── the offer, and why it matters more on this side ────────────────
      //
      // A password change evicts nobody. Supabase issues a refresh token per
      // session and `updateUser({ password })` leaves the others alone, so a
      // device somebody else is holding stays signed in to this account until
      // that session's own token expires. On a coach's account that device can
      // read every client's disclosures, every thread, and the whole invoice
      // book — so the sentence saying so is not a footnote here.
      //
      // Offered rather than done. Most password changes are housekeeping, and
      // signing a coach out of the gym's iPad mid-session is its own harm.
      // `endOtherSessions` keeps THIS session — see the note on it.
      Alert.alert('Password changed',
        'Your new password is in place. Anywhere else you are signed in stays signed in until that session expires — including any phone or tablet you no longer have, and anything signed in to your account can read your clients’ records.',
        [
          { text: 'Leave them', style: 'cancel' },
          {
            text: 'Sign out everywhere else',
            onPress: async () => {
              const out = await endOtherSessions(supabase.auth);
              // Both outcomes are said. "We could not do it" is the one that
              // matters: a coach who believes they have evicted somebody and
              // has not is worse off than one who knows they must ring support.
              Alert.alert(
                out.ok ? 'Signed out everywhere else' : 'Still signed in elsewhere',
                out.ok
                  ? 'Every other phone, tablet and browser signed in to this account has been signed out. This phone stays signed in, and your new password is what gets any of them back.'
                  : `${out.note} Your password HAS been changed, so nothing new can sign in — but a device already signed in may still be. Try again in a moment.`,
              );
            },
          },
        ]);
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
          `We have sent a confirmation to ${res.requested}. Your account still uses ${signInAddress(email)} and will keep using it until you open that link.\n\n`
          + 'If the link is never opened, nothing happens and your old address goes on working.');
        return;
      }
      // 'unknown'. Said plainly rather than rounded to either neighbour.
      Alert.alert('We could not confirm what happened',
        `Your request went in, but we could not read your account back to see whether the address changed straight away or a confirmation was sent to ${res.requested}.\n\n`
        + `Check that inbox, and sign in with ${signInAddress(email)} until you know otherwise. Nothing has been lost either way.`);
    } finally { setEmBusy(false); }
  };

  const label = (s: string) => <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>{s}</Text>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          220 rather than 40 because the password fields are the LAST thing on this screen and
          the button under them has to come up with them. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 220 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Settings</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Account &amp; Sign-in</Text>
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
            <Text style={{ ...ty.body, color: t.ink, flex: 1, textAlign: END_ALIGN }} numberOfLines={1}>
              {/* `|| null` and not the empty string `email` already is: `fig('')`
                  is the empty string, so an unread address would leave this slot
                  blank under its label — indistinguishable from an account with
                  no email at all. The dash is how the rest of the app says
                  "not read". */}
              {auth.loading ? 'Checking…' : fig(email || null)}
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
                <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Try Again</Text>
              </Pressable>
            </View>
          ) : pending.email ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              {`A change to ${pending.email} is waiting to be confirmed. Until the link in that inbox is opened, your account still uses ${signInAddress(email)} and that is what you sign in with.`}
            </Flag>
          ) : null}

          {label('New email address')}
          <TextInput value={newEmail} onChangeText={(v) => { setNewEmail(v); setEmNote(null); }}
            placeholder="you@example.com" placeholderTextColor={t.ink3}
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress"
            accessibilityLabel="New email address" style={inp} />
          {emNote ? <Flag tone={t.crit} style={{ marginTop: sp.md }}>{emNote}</Flag> : null}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Your clients see the name and photo on your coaching profile, not this. This is the address you sign in with and the only place a password reset can be sent — so keep it one you can open.
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
            We ask for your current password so that a phone left unlocked on the gym floor can’t be used to lock you out of your own account — and out of every client record on it.
          </Text>
          <View style={{ height: sp.md }} />
          <Cta label={pwBusy ? 'Changing…' : 'Change Password'} wide disabled={pwBusy} onPress={() => { void submitPassword(); }} />
        </Section>

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            Forgotten the current one? Sign out and use “Forgot password” on the sign-in screen — that sends a link to {signInAddress(email)}.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
