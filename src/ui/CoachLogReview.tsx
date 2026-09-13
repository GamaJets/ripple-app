// The strip under a session somebody else put in your log: who wrote it, where
// it stands, and the two things you are allowed to say back.
//
// ── what was here before ──────────────────────────────────────────────────
//
// One caption, six words, and nothing to press:
//
//     attributionLine(l, null, true)      → "Logged by your coach"
//
// A coach can write a session into a member's own `workouts` rows
// (supabase/parts/53). The member's only sight of it was that line, with the
// coach's NAME hard-coded to `null` and no control beside it — so the app could
// not tell the member who had recorded it, and the member could not tell the app
// they disagreed. src/lib/upcomingWindow.ts names the consequence of exactly
// that arrangement: "the member cannot see what their coach recorded and cannot
// dispute it. Their silence is then read as approval."
//
// ── the three verbs, and why the destructive one is not new ───────────────
//
// AMEND is the existing pencil. It rewrites the figures and the trigger stamps
// `amended_at`, so the change is visible to both sides. Right when the member
// knows what the correct figures are.
//
// QUERY is the new one, and it is the answer for the member who does not — "I
// was not in the gym on Tuesday" is not a set count. It writes a dated mark and
// an optional sentence onto the row the coach already reads, changes no figure
// and deletes nothing.
//
// DELETE is deliberately NOT offered from this strip even though policy permits
// it. Removing the coach's account of a session to object to it destroys the
// thing under discussion; the query exists so that objecting no longer costs the
// record. The delete control stays where it was, on the row itself, for the
// member who wants the entry gone for its own sake.
//
// All the rules live in src/lib/coachLogReview.ts and are asserted under plain
// node. This file is the pixels and the failure states.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Icon } from './Icon';
import { Flag, Scrim } from './kit';
import { sp, radius, layout, elevation, type as ty } from '../theme/scale';
import type { Theme } from '../theme/tokens';
import { attributionLine } from '../lib/workoutAttribution';
import { cleanQueryNote, QUERY_NOTE_MAX, type AttributedEntry, type Review, type WorkoutQuery } from '../lib/coachLogReview';

export function CoachLogReviewStrip({ t, entry, movement, review, query, onQuery, onWithdraw, onAmend }: {
  t: Theme;
  entry: AttributedEntry;
  /** The movement's name, in the reader's own catalogue language. Every spoken
   *  label below is built from it — a screen reader meeting "This is not right"
   *  three times in one day has no way to tell which session is which. */
  movement: string;
  review: Review;
  /** The standing query, when there is one and it was read. */
  query: WorkoutQuery | null;
  /** Raise one. Resolves FALSE when the server did not take it — see the note
   *  on the failure line below. */
  onQuery: (note: string | null) => Promise<boolean>;
  onWithdraw: () => Promise<boolean>;
  onAmend: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // What to say when a write did not land. Held rather than thrown away,
  // because the failure a member needs told about is the silent one: the query
  // looked sent, the coach never saw it, and the member goes on believing they
  // have objected. Cleared on the next attempt, never on a timer.
  const [failed, setFailed] = useState<string | null>(null);

  // Nothing at all for a session the member logged themselves, which is almost
  // all of them. The strip appears only when it has something to say.
  if (review.own) return null;
  const caption = attributionLine(entry, review.coachName, true);

  const send = async () => {
    setBusy(true);
    setFailed(null);
    const ok = await onQuery(cleanQueryNote(text));
    setBusy(false);
    if (ok) { setComposing(false); setText(''); return; }
    setFailed('That did not save, so your query has NOT been recorded and your coach cannot see it. Try again when you have signal.');
  };

  const take = async () => {
    setBusy(true);
    setFailed(null);
    const ok = await onWithdraw();
    setBusy(false);
    if (!ok) setFailed('That did not save, so your query is still standing.');
  };

  return (
    <View style={{ marginTop: sp.md, padding: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm }}>
      {caption ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: query?.queriedAt ? t.warn : t.brand }} />
          <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>{caption}</Text>
        </View>
      ) : null}
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{review.line}</Text>
      {/* The member's own words, quoted back. A query with a sentence on it that
          the member cannot re-read is a sentence they cannot check before their
          coach answers it. */}
      {query?.note ? (
        <Text style={{ ...ty.caption, color: t.ink2, marginTop: 6, fontStyle: 'italic' }}>“{query.note}”</Text>
      ) : null}
      {/* The dot carries the tone and the words carry the meaning. A status
          colour is tuned to the 3:1 a MARK needs, not the 4.5:1 text needs —
          and a failure a member must act on is the last sentence in this app
          that may be legible only to somebody who sees red. */}
      {failed ? <Flag style={{ marginTop: sp.sm }}>{failed}</Flag> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
        {review.actions.query ? (
          <Pressable
            onPress={() => { setFailed(null); setComposing(true); }}
            accessibilityRole="button"
            accessibilityLabel={'Query the ' + movement + ' your coach logged'}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 9 }}
          >
            <Icon name="info" size={13} color={t.warn} />
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>This is not right</Text>
          </Pressable>
        ) : null}
        {review.actions.withdraw ? (
          <Pressable
            onPress={() => { void take(); }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            accessibilityLabel={'Withdraw your query on the ' + movement + ' your coach logged'}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 9, opacity: busy ? 0.5 : 1 }}
          >
            <Icon name="check" size={13} color={t.good} />
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{busy ? 'Withdrawing…' : 'Withdraw query'}</Text>
          </Pressable>
        ) : null}
        {review.actions.amend ? (
          <Pressable
            onPress={onAmend}
            accessibilityRole="button"
            accessibilityLabel={'Amend the ' + movement + ' your coach logged'}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 9 }}
          >
            <Icon name="pencil" size={13} color={t.ink2} />
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Correct the figures</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal visible={composing} transparent animationType="slide" onRequestClose={() => setComposing(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Scrim onPress={() => setComposing(false)} label="Close without querying" />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 34, ...elevation.e2 }}>
            <Text style={{ ...ty.head, color: t.ink, textTransform: 'capitalize' }} numberOfLines={1}>{movement}</Text>
            {/* Said before the box, not after it. What a member most needs to know
                before objecting is what objecting DOES — and the two things it
                does not do are the ones they are most likely to fear. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
              Your coach will see that you have queried this, and what you write. The entry stays exactly as they logged it — querying it changes no figure and deletes nothing.
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              maxLength={QUERY_NOTE_MAX}
              placeholder="What was wrong? (optional)"
              placeholderTextColor={t.ink3}
              accessibilityLabel={'What was wrong with the ' + movement + ' your coach logged'}
              style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12, marginTop: sp.lg, minHeight: 88, textAlignVertical: 'top' }}
            />
            {/* Optional, and said so. A member who cannot put words to what was
                wrong still gets to mark that it was — the mark is the part that
                stops their silence being counted as agreement. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              You can send this without writing anything.
            </Text>
            {failed ? <Flag style={{ marginTop: sp.md }}>{failed}</Flag> : null}
            <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
              <Pressable
                onPress={() => setComposing(false)}
                accessibilityRole="button"
                accessibilityLabel={'Close without querying the ' + movement}
                style={{ flex: 1, alignItems: 'center', backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: 13 }}
              >
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2 }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => { void send(); }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                accessibilityLabel={'Send your query on the ' + movement + ' your coach logged'}
                style={{ flex: 1, alignItems: 'center', backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 13, opacity: busy ? 0.5 : 1 }}
              >
                <Text style={{ ...ty.body, fontWeight: '600', color: t.brandInk }}>{busy ? 'Sending…' : 'Send query'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
