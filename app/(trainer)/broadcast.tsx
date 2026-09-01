// Trainer · Broadcast. Message a whole segment of clients at once — everyone, or
// a specific tag. Writes one real message into each client's own thread and
// sends a push. OTA-safe.
//
// ── It is N messages, and it is the coach's words ──────────────────────────
//
// There is no broadcast object anywhere behind this screen and there will not
// be one. Each client gets an ordinary `messages` row they can reply to, in the
// thread that already holds everything else their coach has said to them, and
// nothing is added to the words the coach typed. Both halves are the same rule:
// a message must never be composed under somebody else's name, which is written
// out in src/lib/nudge.ts and supabase/parts/140 and was earned — `messages
// .sender` once came from the caller's own request, so a client could post into
// their own thread as 'coach'. The fan-out lives in `sendCoachMessages`
// (src/ui/messaging.ts); what the coach is told before they send is
// `bulkThreadNote` (src/lib/bulkActions.ts), which explains why nothing is
// appended rather than appending it.
//
// ── "Everyone" over a roster that came back short ──────────────────────────
//
// This screen already refused to send over a FAILED roster read and merely
// warned about a TRUNCATED one — it sent, and reported "Partly sent" with a
// note. That was the wrong side of the line. A segment is a claim about a
// category: the number on the button was the size of the page rather than the
// size of the segment, the message read as complete to everyone who got it, and
// nothing afterwards said which of the coach's clients had been left out.
// `guardRecipients` refuses both now, for the same reason `guardOverwrite`
// refuses rather than annotating: a banner does not stop a thumb.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero — a composer has no live number to lead with, so
// the segment, the recipient list and the message are three hairline-separated
// sections and the Georgia serif title is gone. Same segment logic, same insert,
// same push, same route.
//
// One claim removed: the confirmation said "Message delivered to N clients"
// while the insert's error was swallowed and the push is a best-effort no-op on
// builds without notifications — a delivery receipt the app never receives. It
// now reports what it can actually see (the rows written to the threads) and
// says so plainly when the write fails.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useClientTags } from '../../src/ui/clientTags';
import { sendCoachMessages } from '../../src/ui/messaging';
import { guardRecipients, bulkReport, bulkThreadNote, type WriteOutcome } from '../../src/lib/bulkActions';
import { listNames } from '../../src/lib/groupProgram';

export default function Broadcast() {
  const t = useTheme();
  const router = useRouter();
  const { roster, status: rosterStatus } = useRoster();
  const { allTags, tagsFor, status: tagStatus } = useClientTags();
  const [seg, setSeg] = useState<string | null>(null); // null = all
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  // The clients this screen tried to write to and could not. Held so the
  // recipient list can name them and the retry can go to exactly them — a coach
  // told "8 of 12 went through" and nothing else has no way to reach the four.
  const [failed, setFailed] = useState<string[]>([]);

  const recipients = useMemo(() => roster.filter((c) => seg === null || tagsFor(c.id).includes(seg)), [roster, seg, tagsFor]);
  // Reads as the object of a sentence, because it is one: the guard writes
  // "Only part of … came back". "all of your clients" turns that into "part of
  // all of your clients", which is a sentence nobody would say out loud.
  const segmentLabel = seg ? `the “${seg}” segment` : 'your client list';
  // Whether the LIST is trustworthy, as distinct from whether the send worked.
  //
  // Two reads, and both are load-bearing. The roster says who exists; the tags
  // say who is in the segment, and with tags unread every `tagsFor()` comes back
  // empty so a chosen tag matches nobody — which renders identically to a tag
  // that genuinely has nobody in it. `guardRecipients` takes the worse of the
  // two and refuses on anything but a whole read of both.
  const claim = guardRecipients(rosterStatus, seg === null ? 'ready' : tagStatus, segmentLabel);
  // The count the coach reads on the button. It is only a count when the read
  // behind it was whole — under any other status the button is withheld anyway,
  // and this is what stops the number being rendered as a fact in the meantime.
  const countable = claim.allowed;
  const bookUnread = rosterStatus === 'error';
  const bookShort = rosterStatus === 'partial';
  const segUnreliable = seg !== null && (tagStatus === 'error' || tagStatus === 'partial');
  const nameOf = (id: string) => roster.find((c) => c.id === id)?.name.split(' ')[0] ?? 'A client';

  /**
   * Write the message into every recipient's own thread.
   *
   * `ids` is passed in rather than read from `recipients` so that RETRY sends to
   * exactly the threads that failed, and not to the segment all over again —
   * re-sending to the eight who already got it would put the same words in
   * their thread twice and look, from their side, like their coach repeating
   * themselves.
   */
  const deliver = async (ids: string[]) => {
    const b = body.trim();
    if (!b || !ids.length || busy) return;
    // Refuse rather than warn. A message cannot be taken back, and "send to
    // everybody" written against a list we could not read whole is not a
    // smaller version of the thing the coach asked for.
    if (!claim.allowed) { Alert.alert(claim.label as string, claim.reason as string); return; }
    setBusy(true);
    try {
      const results = await sendCoachMessages(ids, b);
      const outcomes: WriteOutcome[] = results.map((r) => ({
        clientId: r.clientId, name: nameOf(r.clientId), ok: r.ok, why: r.why,
      }));
      const report = bulkReport('message', outcomes);
      setFailed(report.retry);
      // The composer is only cleared when there is nothing left to send. A
      // coach whose message half-landed needs the words still in the box —
      // retyping them is how the second attempt ends up differently worded from
      // the first, in the threads of the people who got both.
      if (!report.retry.length) setBody('');
      Alert.alert(report.title, report.body);
    } catch {
      Alert.alert('Not Sent', 'The message could not be written to your clients’ threads. Nothing was sent. Check your connection and try again.');
    } finally { setBusy(false); }
  };
  const send = () => deliver(recipients.map((c) => c.id));

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }}
      style={{ paddingHorizontal: sp.md + 2, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: active ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: '500', color: active ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your clients</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Broadcast</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Send one message to a whole segment of your clients.</Text>

        {/* ── the segment ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Send To" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }}>
            {chip('All clients', seg === null, () => setSeg(null))}
            {allTags.map((tg) => chip(tg, seg === tg, () => setSeg(tg === seg ? null : tg)))}
          </ScrollView>
        </Section>

        <Rule />

        {/* ── who that is ────────────────────────────────────────────────── */}
        <Section>
          {/* The count is a count, so it waits for a whole read of both the
              roster and the tags. Under anything else it is the size of what
              loaded, and printing it beside the word "Recipients" is what made
              a send to two thirds of a segment look complete. */}
          <SectionHead title="Recipients" note={countable && recipients.length ? `${recipients.length}` : undefined} />
          {bookUnread ? (
            <Notice tone={t.warn} kicker="Roster" title="Your client list could not be read"
              note="Nobody is listed below because the roster did not come back. This is not an empty book, and nothing can be sent until it loads." />
          ) : bookShort ? (
            <Notice tone={t.warn} kicker="Roster" title="This is part of your book"
              note="Your roster came back at its row limit, so anyone past the point it stopped is not in this list and would not receive the message. The send is held rather than going to the part that loaded — a message cannot be taken back, and nothing afterwards would say who had been left out." />
          ) : segUnreliable ? (
            <Notice tone={t.warn} kicker="Tags" title="This segment could not be read in full"
              note="Your client tags did not all come back, so somebody in this segment may be missing from the list below and the send is held until they load." />
          ) : null}
          {/* Every name, not the first two. This list is the last thing between
              the coach and N irreversible writes, and the `numberOfLines={2}`
              that used to be on it cut the list off at exactly the point where
              the count and the visible names stop agreeing — which is where
              somebody checks whether a specific person is in it. */}
          {recipients.length === 0 && !bookUnread ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No clients in this segment.</Text>
          ) : recipients.length === 0 ? null : (
            <Text style={{ ...ty.body, color: t.ink2 }}>{recipients.map((c) => c.name).join(', ')}</Text>
          )}

          {/* Who it did not reach last time. Named, and still here, so the retry
              below is about people rather than about a number. */}
          {failed.length ? (
            <Notice tone={t.warn} kicker="Not delivered" title={`${failed.length} did not get the last one`}
              note={`${listNames(failed.map(nameOf))} — nothing was written to their thread. Clients you added by hand have no account to message until they join.`} />
          ) : null}
        </Section>

        <Rule />

        {/* ── the message ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Message" />
          <TextInput value={body} onChangeText={setBody} placeholder="Your message…" placeholderTextColor={t.ink3} multiline
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 120, textAlignVertical: 'top', marginBottom: sp.md }} />

          {/* What the client will actually see, said to the coach and not added
              to the message. The full argument is on `bulkThreadNote`: appending
              "sent to 12 clients" to the body would put words the coach did not
              write into a message signed by the coach, and a badge outside it
              would need a column this app cannot keep honest — a coach pasting
              the same words into twelve threads by hand produces twelve
              unbadged messages, so an absent badge would come to mean "written
              for you". The coach is the only person who can decide whether
              these words should say they went to everyone, and the box above is
              where they say it. */}
          {claim.allowed && bulkThreadNote(recipients.length) ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{bulkThreadNote(recipients.length)}</Text>
          ) : null}
          {!claim.allowed && claim.reason ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{claim.reason}</Text>
          ) : null}

          {/* Withheld, not warned about. The count on this button is the whole
              of what the coach is consenting to, so it is only allowed to be a
              number when the reads behind it came back whole. */}
          <View style={{ opacity: claim.allowed ? 1 : 0.4 }} pointerEvents={claim.allowed ? 'auto' : 'none'}>
            <Cta label={busy ? 'Sending…' : claim.label ?? `Send to ${recipients.length}`} wide
              disabled={!body.trim() || !recipients.length || busy || !claim.allowed} onPress={send} />
          </View>

          {/* Retry goes to the threads that failed and to no others. Sending to
              the segment again would put the same words a second time in the
              thread of everybody it already reached. */}
          {failed.length && !busy ? (
            <View style={{ marginTop: sp.md }}>
              <Ghost label={`Try the ${failed.length} That Failed Again`} onPress={() => deliver(failed)} />
            </View>
          ) : null}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
