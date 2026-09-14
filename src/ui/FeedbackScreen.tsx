// Shared "Send Feedback" screen used by the client & trainer portals. Rating +
// category + note -> saved to Supabase (owner reads it in their portal).
//
// On the scale (`src/theme/scale`) and the kit's controls: the Georgia serif
// title and the 700/800 weights are gone, the uppercase field labels are the
// scale's `micro`, and the submit button is the kit's `Cta`. Every handler,
// route and piece of copy is unchanged — this is a re-skin.
import { useState } from 'react';
import { BRAND } from '../lib/brands';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from './components';
import { Cta, Ghost } from './kit';
import { sp, layout, radius, hairline, type as ty } from '../theme/scale';
import { MIN_TARGET, hitSlopFor } from '../lib/a11y';
import { submitAppFeedback } from './appFeedback';
import { feedbackNote } from '../lib/feedbackSend';
import { notifySuccess } from './haptics';
import { BACK_ICON } from './direction';

const CATS = ['Bug', 'Confusing', 'Idea', 'Praise'];

/** The type chips' drawn height, from the two numbers that actually make it:
 *  the label's line box and the padding either side of it. Written as the sum
 *  rather than as a hand-counted `36` so it follows `ty.label` when the reader
 *  turns their text size up, and so `hitSlopFor` is given the real figure. */
const CHIP_HEIGHT = ty.label.lineHeight + 9 * 2;

/**
 * What somebody reads when the send did not land now lives in
 * src/lib/feedbackSend.ts, one sentence per fate, and the reason it moved is
 * the sentence that used to be here.
 *
 * This screen held a single `NOT_SENT_BODY` that had to be true of every
 * failure at once, because `submitAppFeedback` collapsed them all into one
 * `ok: false` with a message beside it. It said the three things that WERE
 * true of all of them — nothing is queued, nobody has seen it, trying again
 * may not help — and stopped short of saying which, because this screen
 * genuinely could not tell a refusal from a dropped connection without
 * sniffing the message text, which is not a discrimination.
 *
 * It hands back the fate now. So the third fact splits in two, which is the
 * whole point: a refusal will answer the same way every time, and a dropped
 * connection is the one case where "try again" is honest advice. The first two
 * facts are unchanged and are still said outright on every failure — in
 * particular that NOTHING IS QUEUED, because this app marks writes "waiting to
 * send from this phone" all over the place (src/lib/threadOutbox.ts) and there
 * is no outbox behind this one. `unsent`, in the sense src/lib/offlineQueue.ts
 * means it, remains the state this screen can never be in; `feedbackSend.ts`
 * has no member for it, so the copy cannot quietly start implying it.
 */

export default function FeedbackScreen({ audience }: { audience: string }) {
  const t = useTheme();
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [cat, setCat] = useState('Idea');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!body.trim()) { Alert.alert('Add a note', 'Tell us what worked or what to improve.'); return; }
    setBusy(true);
    // `rating` was passed as `rating || 0` and the `|| 0` was inert: the state
    // is `useState(0)`, so it is already `number` and 0 is the only falsy value
    // it can hold. Four characters that read like a guard against an unknown
    // and guard nothing — and this file is otherwise careful that an unrated
    // send stores null rather than a 0 nobody gave.
    const fate = await submitAppFeedback(rating, cat, body);
    setBusy(false);
    // The failure branch used to read "Saved - Thanks, your feedback was
    // recorded." It was not recorded: anything but 'sent' means no signed-in
    // user, a rejected insert, a connection that never got there, or a thrown
    // error. The text was discarded and the screen popped, so it never reached
    // the owner's Feedback inbox.
    //
    // The note is null for exactly one fate, so there is no second condition
    // here deciding whether this was a success: the module decides, and the
    // two branches below cannot disagree about it.
    const note = feedbackNote(fate);
    if (note) {
      // Say what actually went wrong — the right one of four sentences, chosen
      // from the fate rather than from the error's text. This blamed the
      // connection for every failure once, and then blamed nothing in
      // particular for any of them; in between it printed the raw Postgres
      // refusal at a member, which is neither.
      Alert.alert('Not sent', note);
      return;
    }
    notifySuccess();
    // Emptied BEFORE the alert, not in the Done handler. `router.back()` hangs
    // off one button, and an alert dismissed any other way — the Android back
    // gesture, a tap outside — never runs it. That left somebody on this screen
    // with the note they had just successfully sent still sitting in the box and
    // a Send button under it, which is how the owner's inbox gets the same
    // paragraph twice. The row is on the server; the form should say so.
    setBody(''); setRating(0); setCat('Idea');
    Alert.alert('Thank you', `Your feedback went to the ${BRAND.label} team.`, [{ text: 'Done', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* No KeyboardAvoidingView. This one component is mounted under a
          navigator header in the client portal and with no header at all in the
          trainer portal, so the offset KeyboardAvoidingView needs is not the
          same in the two places it renders — it mixes its own parent-relative
          layout with the keyboard's window-absolute top edge, and under the
          client header it under-lifted by the height of that header. The
          "Details" box is the last field on the screen, so that is the one the
          keyboard covered. `automaticallyAdjustKeyboardInsets` is measured by
          iOS in window coordinates and is right in both mountings; there is no
          docked bar here that would need src/ui/keyboardLift.ts instead. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>
        {/* Back leads the row rather than trailing it. It trailed here, which
            put the one control that leaves the screen at the far RIGHT — where
            iOS has never put it, and where the rest of this app does not put it
            either (see the Money screen, which reads back-then-title). A coach
            reaching for the top-left corner found nothing there. The a11yLabel
            is not decoration: without one the button is announced as "button"
            and there is no other back affordance on this screen. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Feedback</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Send Feedback</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>{audience}. Tell us what to fix, what is confusing, or what you would love to see.</Text>

        {/* The five buttons carried a trophy each and nothing else. Unrated,
            that is five IDENTICAL grey glyphs: nothing on the row says it is a
            scale, nothing says which end is good, and a trophy means "you won"
            rather than "this was fine" — the one question the row is asking.
            Seen on an iPhone 17 Pro at the default text size.

            The digit is the fix rather than a star because there is no star in
            src/ui/Icon.tsx and inventing one to carry this meaning is a larger
            change than the defect. A number needs no legend, scales with the
            text size, and is read out as itself. The fill-to-N behaviour is
            unchanged — tapping 3 lights 1, 2 and 3 — so the row still reads as
            a magnitude and not five separate choices, and the end labels say
            which direction that magnitude runs in. */}
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>How is the experience?</Text>
        {/* `selected` carries the VALUE, not the fill. It was `rating >= n`,
            which is the right test for the ink and the wrong one for the ear: a
            rating of 3 announced 1, 2 AND 3 as "selected", so a VoiceOver user
            swiping this row was told three different numbers were the current
            one, with nothing to say which. The fill-to-N drawing is unchanged —
            it is a magnitude and still reads as one — but exactly one of the
            five is the answer, and that is the one that says so. */}
        <View style={{ flexDirection: 'row', gap: sp.sm }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Rate ${n} out of 5`}
                accessibilityState={{ selected: rating === n }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TARGET, paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: rating >= n ? t.brand : t.surface2, borderWidth: hairline, borderColor: rating >= n ? t.brand : t.ring }}>
              <Text style={{ ...ty.body, fontWeight: '600', color: rating >= n ? t.brandInk : t.ink3 }}>{n}</Text>
            </Pressable>
          ))}
        </View>
        {/* Which way the row runs, said once and quietly. Without it a 1 is as
            likely to be read as "first place" as "worst". */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.xs, marginBottom: sp.xl }}>
          <Text style={{ ...ty.caption, color: t.ink3 }}>Poor</Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>Great</Text>
        </View>

        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Type</Text>
        {/* Four chips that were four bare Pressables. No role, so a screen
            reader announced "Bug" as if it were a word on the page rather than
            a control; no `accessibilityState`, so which of the four was CHOSEN
            was carried by the brand fill and by nothing else — and a fill is
            exactly what a reader does not have. The rating row above had both
            all along, which is how this was missed: the two rows look like a
            pair and only one of them was named.

            The label spells out what the chip is FOR. "Bug" alone is the noun;
            "Type: Bug" is what the control does, and it is what the sighted
            reader gets from the "Type" heading four points above it — a heading
            that is a separate Text and so reaches the ear nowhere near it.

            hitSlop rather than a minHeight: the chip is a deliberate size and
            growing it to 44 would push the row onto two lines on a narrow
            handset. `hitSlopFor` leaves the drawing alone and moves only the
            boundary the finger has to find — 4pt here, which does not reach the
            neighbouring chip across an 8pt gap. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.xl }}>
          {CATS.map((c) => (
            <Pressable key={c} onPress={() => setCat(c)}
                accessibilityRole="button"
                accessibilityLabel={`Type: ${c}`}
                accessibilityState={{ selected: cat === c }}
                hitSlop={hitSlopFor(CHIP_HEIGHT)}
                style={{ paddingHorizontal: sp.lg, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: cat === c ? t.brand : t.surface2, borderWidth: hairline, borderColor: cat === c ? t.brand : t.ring }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: cat === c ? t.brandInk : t.ink2 }}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Details</Text>
        <TextInput value={body} onChangeText={setBody} placeholder="What happened, or what would make this better?" placeholderTextColor={t.ink3} multiline style={{ ...ty.body, color: t.ink, backgroundColor: t.surface, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 120, textAlignVertical: 'top', marginBottom: sp.xl }} />

        <Cta label={busy ? 'Sending…' : 'Send Feedback'} onPress={submit} disabled={busy} wide />
      </ScrollView>
    </SafeAreaView>
  );
}
