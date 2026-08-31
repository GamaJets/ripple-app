// Six digits, wherever they came from.
//
// Lifted verbatim out of app/phone-signin.tsx, which had the only version of
// this gesture in the app and had already solved the parts that are easy to get
// wrong. Email confirmation needs exactly the same gesture, and a second
// hand-written set of boxes would drift from the first the day either one is
// touched — different spacing, a different countdown, a different sentence for
// "that code was not right". One component, two doors.
//
// What it keeps from the phone screen, and why:
//
//   • ONE real input behind six painted boxes. iOS autofills a code into a
//     single field; six separate inputs break that, which is the thing that
//     makes the flow quick.
//   • Submit on the sixth digit. A button after the last digit is a step with
//     no decision in it.
//   • A countdown before "send a new code" is offered. A dead Resend that
//     silently does nothing until the server's window passes teaches people to
//     tap it repeatedly and then hit the rate limit — a worse failure than
//     waiting, and one they cannot see the cause of.
//
// What it adds: a resend says what happened. Both outcomes. A send that was
// throttled or refused says so in the same card an error uses, and a send that
// went says it went — never both, and never neither.
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useTheme } from './components';
import { Ghost, Card } from './kit';
import { sp, radius, hairline, type as ty, value } from '../theme/scale';
import { digitsOnly } from '../lib/phone';
import type { OtpOutcome } from './emailOtp';

/** Seconds before a new code may be requested. Matches Supabase's own default. */
export const RESEND_AFTER = 60;

export interface OtpCodeEntryProps {
  /** The heading. */
  title: string;
  /** Where the code went, in the reader's own terms — masked number, address. */
  sentTo: string;
  /** How many digits. Supabase issues six; it is not ours to choose. */
  length?: number;
  /**
   * Which door this is.
   *
   * Only the autofill hint depends on it: Android can read a code out of an
   * arriving SMS (`sms-otp`) and cannot read one out of an inbox, so an emailed
   * code asks for the iOS keyboard suggestion (`one-time-code`) and nothing
   * more. Claiming SMS autofill for an emailed code would promise a fill that
   * never comes.
   */
  channel: 'sms' | 'email';
  /** Check a complete code. Only `ok: true` means they are in. */
  onVerify: (code: string) => Promise<OtpOutcome>;
  /** Where to go once onVerify has said ok — and not one moment before. */
  onVerified: () => void | Promise<void>;
  /** Ask for another. Its `reason` is shown as-is when it fails. */
  onResend: () => Promise<OtpOutcome>;
  /** The way back to the field they typed: "Wrong number? Change it". */
  changeLabel: string;
  onChange: () => void;
  /** Anything else worth saying under the resend row. */
  note?: string;
}

export function OtpCodeEntry({
  title, sentTo, length = 6, channel,
  onVerify, onVerified, onResend, changeLabel, onChange, note,
}: OtpCodeEntryProps) {
  const t = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  // Starts counting on mount, because mounting IS the moment a code was sent —
  // every caller gets here by having just sent one.
  const [left, setLeft] = useState(RESEND_AFTER);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [left]);

  const submit = async (submitted: string) => {
    if (busy) return;
    setBusy(true); setError(null); setSent(null);
    const r = await onVerify(digitsOnly(submitted));
    setBusy(false);
    // Clearing the boxes on failure is deliberate: the next thing they do is
    // type six digits, and a half-cleared field takes longer to fix than an
    // empty one.
    if (!r.ok) { setError(r.reason); setCode(''); return; }
    await onVerified();
  };

  const resend = async () => {
    if (busy) return;
    setBusy(true); setError(null); setSent(null);
    const r = await onResend();
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setCode('');
    setLeft(RESEND_AFTER);
    setSent(`A new code is on its way to ${sentTo}. The older one no longer works.`);
    setTimeout(() => codeRef.current?.focus(), 250);
  };

  return (
    <>
      <Text style={{ ...ty.title, color: t.ink }}>{title}</Text>
      <Text style={{ ...ty.label, color: t.ink3, marginTop: 6, marginBottom: sp.xxl }}>
        Sent to {sentTo}.
      </Text>

      <Pressable onPress={() => codeRef.current?.focus()} accessibilityRole="button"
        accessibilityLabel={`Enter the ${length}-digit code`}>
        <View style={{ flexDirection: 'row', gap: sp.sm }}>
          {Array.from({ length }).map((_, i) => {
            const ch = digitsOnly(code)[i];
            const active = digitsOnly(code).length === i;
            return (
              <View key={i} style={{
                flex: 1, aspectRatio: 0.82, borderRadius: radius.sm,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: t.surface2,
                borderWidth: active ? 2 : hairline,
                borderColor: active ? t.brand : t.ring,
              }}>
                <Text style={{ ...value(26), color: t.ink }}>{ch ?? ''}</Text>
              </View>
            );
          })}
        </View>
      </Pressable>
      <TextInput
        ref={codeRef}
        value={code}
        onChangeText={(v) => {
          const d = digitsOnly(v).slice(0, length);
          setCode(d); setError(null); setSent(null);
          if (d.length === length) void submit(d);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={channel === 'sms' ? 'sms-otp' : 'one-time-code'}
        maxLength={length}
        autoFocus
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />

      {error ? (
        <Card tone={t.warn} style={{ marginTop: sp.xl }}>
          <Text style={{ ...ty.label, color: t.ink2 }}>{error}</Text>
        </Card>
      ) : null}
      {sent && !error ? (
        <Card tone={t.brand} style={{ marginTop: sp.xl }}>
          <Text style={{ ...ty.label, color: t.ink2 }}>{sent}</Text>
        </Card>
      ) : null}

      <View style={{ alignItems: 'center', marginTop: sp.xxl }}>
        {left > 0 ? (
          <Text style={{ ...ty.label, color: t.ink3 }}>
            Resend a new code in {String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}
          </Text>
        ) : (
          <Ghost label={busy ? 'Sending…' : 'Send a New Code'} onPress={resend} />
        )}
      </View>

      {note ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, textAlign: 'center' }}>{note}</Text>
      ) : null}

      <Pressable onPress={onChange} hitSlop={8} style={{ paddingVertical: sp.xl, alignItems: 'center' }}>
        <Text style={{ ...ty.label, color: t.ink2 }}>{changeLabel}</Text>
      </Pressable>
    </>
  );
}
