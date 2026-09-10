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
import { MIN_OTP_SUBMIT, MAX_OTP_ENTRY } from './emailOtp';
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
  // Draw the length this project issues, or the length actually in hand when
  // that is longer. A code the screen is holding but not showing is the same
  // defect as one it truncated — the member cannot see what is about to be
  // submitted for them.
  const boxes = Math.max(length, digitsOnly(code).length);

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

      {/* ── the boxes, and the one field that actually holds the code ──────
          The field is laid OVER the boxes at full size rather than parked
          off-screen, and this is the whole reason the keyboard's "tap to fill"
          suggestion appears at all.

          It used to be `{ position: 'absolute', opacity: 0, height: 1, width: 1 }`
          — a real input, correctly marked `oneTimeCode`, that iOS would never
          offer a code to. UIKit does not put a one-time-code suggestion above
          the keyboard for a field it considers invisible, and a transparent
          one-pixel box is invisible by both tests it applies: zero alpha, and
          no area to attach the suggestion to. Every other ingredient was
          already right, which is why this looked like it worked.

          So: full width and height of the boxes, opaque to UIKit, and unseen by
          the reader because the TEXT is transparent and the caret is hidden.
          The painted boxes underneath remain the only thing anybody sees, and
          a tap anywhere on them now lands on the field itself, which is what
          focuses it — the Pressable that used to do that by hand is gone. */}
      <View>
        <View style={{ flexDirection: 'row', gap: sp.sm }}>
          {Array.from({ length: boxes }).map((_, i) => {
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
        <TextInput
          ref={codeRef}
          value={code}
          onChangeText={(v) => {
            // Held to MAX_OTP_ENTRY, not to the number of boxes drawn. Slicing
            // to `length` here is what turned an eight-digit code into a
            // six-digit one and then submitted it — see MAX_OTP_ENTRY for why
            // that is autofill's failure in particular rather than a typist's.
            const d = digitsOnly(v).slice(0, MAX_OTP_ENTRY);
            setCode(d); setError(null); setSent(null);
            // At or PAST the expected length, so the common path needs no
            // button press either way: six typed digits go at six, and a code
            // that arrives whole from the keyboard goes at whatever length it
            // actually is. Shorter codes are not refused — they wait for
            // Confirm below. MIN_OTP_SUBMIT in src/ui/emailOtp.ts argues why
            // this screen must not be the thing that decides a code is wrong.
            if (d.length >= length) void submit(d);
          }}
          keyboardType="number-pad"
          // The two halves of "offer me the code". `textContentType` is what
          // puts it in the iOS QuickType bar — from an SMS, and from Mail on
          // iOS 17 and later, which is the door this screen uses.
          textContentType="oneTimeCode"
          // Android reads a code out of an ARRIVING SMS and cannot read one out
          // of an inbox, so an emailed code asks for the keyboard suggestion
          // and nothing more. Claiming `sms-otp` for an emailed code would
          // promise a fill that never comes.
          autoComplete={channel === 'sms' ? 'sms-otp' : 'one-time-code'}
          maxLength={MAX_OTP_ENTRY}
          autoFocus
          caretHidden
          selectionColor="transparent"
          accessibilityLabel={`Enter the ${length}-digit code`}
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            // Transparent TEXT over painted boxes — not a transparent FIELD.
            // The distinction is the fix: the reader sees the boxes, and iOS
            // sees a full-size field worth offering a code to.
            color: 'transparent', backgroundColor: 'transparent',
            textAlign: 'center', fontSize: 26, padding: 0,
          }}
        />
      </View>

      {/* Confirm, for a code that is not the length these boxes were drawn at.
          The auto-submit above still handles the ordinary case, so this is
          usually never pressed — it exists because the code length is a server
          setting that can move without a release, and a screen that refuses to
          TRY a six-digit code because it drew eight boxes is broken in exactly
          the way the eight-digit code broke it in the first place. Only
          Supabase can say whether a code is right; this button lets it. */}
      {digitsOnly(code).length >= MIN_OTP_SUBMIT && digitsOnly(code).length !== length ? (
        <View style={{ alignItems: 'center', marginTop: sp.xl }}>
          <Ghost
            label={busy ? 'Checking…' : `Confirm ${digitsOnly(code).length} digits`}
            onPress={() => { if (!busy) void submit(digitsOnly(code)); }}
          />
        </View>
      ) : null}

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
