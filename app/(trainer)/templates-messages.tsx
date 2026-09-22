// Trainer · Saved Messages — the library behind the picker in a chat thread.
//
// Named `templates-messages` and not `templates`, because `templates` is
// already the PROGRAM template library and expo-router has one flat namespace
// per group. Two screens called Templates in one coach app would be a coin toss
// every time somebody navigated, and the route is the part a person cannot
// disambiguate from the label.
//
// ── Why editing is here and not in the thread ─────────────────────────────
//
// The picker in app/(trainer)/chat.tsx offers the messages and nothing else. A
// coach standing in front of a client wants the message; an editor inside a
// chat is where somebody edits a template by accident while meaning to edit the
// message they are about to send, and the template is the one of the two that
// is silently reused thirty more times.
//
// ── The starters are offered, never inserted ──────────────────────────────
//
// A library that silently acquired six rows the coach did not write is a
// library they cannot tell their own work from. `startersToOffer` drops any
// whose title the coach already has, so a coach who has written their own
// Welcome is not offered a second one, and each is added by a tap.
import { useCallback, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, TextInput, ScrollView, Pressable, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, Cta, Ghost, Flag, PageHead, FigureCard, IconPlate, Expandable } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useMyTemplates, saveTemplate, deleteTemplate } from '../../src/ui/messageTemplates';
import {
  orderTemplates, startersToOffer, templateBlockers, templatesEmptyLine,
  nextPosition, TOKENS, MAX_TEMPLATE_BODY,
  type MessageTemplate,
} from '../../src/lib/messageTemplates';

export default function SavedMessages() {
  const t = useTheme();
  const router = useRouter();
  const lib = useMyTemplates();
  // One read. Under 'error' the library renders empty, which is
  // indistinguishable from a coach who has saved nothing — and the offer to
  // install the six starters is withheld for exactly that reason, so a
  // refused read left the screen with nothing on it and nothing to do.
  const pull = usePullToRefresh(useCallback(() => lib.reload(), [lib]));

  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = orderTemplates(lib.rows);
  // Only offered under a WHOLE read. Under 'error' the library is empty because
  // the read failed, and offering six starters over the top of a library the
  // coach already has is how somebody ends up with two Welcome messages in a
  // list they pick from at speed.
  const offers = lib.status === 'ready' ? startersToOffer(rows) : [];

  const open = (tpl: MessageTemplate | null) => {
    setEditing(tpl ?? { id: null, title: '', body: '', position: nextPosition(rows) });
    setTitle(tpl?.title ?? '');
    setBody(tpl?.body ?? '');
  };

  const save = async (override?: MessageTemplate) => {
    const draft = override ?? { id: editing?.id ?? null, title, body, position: editing?.position ?? nextPosition(rows) };
    const blockers = templateBlockers(draft);
    if (blockers.length) { Alert.alert('Not Saved', blockers.join('\n\n')); return; }
    if (busy) return;
    setBusy(true);
    const res = await saveTemplate(draft);
    setBusy(false);
    // The result is read rather than assumed. A template editor that cannot say
    // "not saved" will say "saved", and the coach finds out in front of a
    // client.
    if (!res.ok) { Alert.alert('Not Saved', `${res.error} Nothing has changed, and what you typed is still here.`); return; }
    setEditing(null);
    await lib.reload();
  };

  const remove = (tpl: MessageTemplate) => {
    if (!tpl.id) return;
    Alert.alert('Delete This Message?', `“${tpl.title}” goes for good. Nothing you have already sent is affected. This is the template, not the messages written from it.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void (async () => {
        const ok = await deleteTemplate(tpl.id as string);
        if (!ok) { Alert.alert('Not Deleted', 'The server did not remove it, so it is still in your library. Try again once you have signal.'); return; }
        await lib.reload();
      })(); } },
    ]);
  };

  const G = layout.gutter;
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* Back leads the row and carries a label. Seen on an iPhone 17 Pro:
            it trailed, which put the one control that leaves this screen in the
            top-RIGHT corner — where iOS has never put it and where the rest of
            this app does not put it — and without `a11yLabel` a screen reader
            announced it as "button". The house form is in
            src/ui/FeedbackScreen.tsx, which carries the whole argument. */}
        <PageHead title="Saved Messages" subtitle="Your own words, kept" />

        {/* The page opens on its figure: how many messages are in the library.
            Under a read that did not come back it is the dash and the read's
            own sentence, never a nought, because an unread library is not an
            empty one. The one action sits in the same card. */}
        <FigureCard title="In Your Library"
          figure={lib.status === 'ready' ? String(rows.length) : null}
          unit={lib.status === 'ready' ? (rows.length === 1 ? 'message' : 'messages') : undefined}
          // The failed read's sentence is the red flag in the list below; said
          // once, there, in the tone it needs.
          detail={lib.status === 'ready' || lib.status === 'error' ? undefined : templatesEmptyLine(lib.status)}>
          <View style={{ marginTop: sp.lg }}>
            <Cta label="Write a New One" wide onPress={() => open(null)} />
          </View>
        </FigureCard>

        <Section>
          <SectionHead title="Your Messages" />
          {rows.length === 0 ? (
            lib.status === 'error'
              ? <Flag tone={t.crit}>{templatesEmptyLine(lib.status)}</Flag>
              : <Text style={{ ...ty.label, color: t.ink3 }}>{templatesEmptyLine(lib.status)}</Text>
          ) : rows.map((tpl, i) => (
            <View key={tpl.id ?? tpl.title} style={{ flexDirection: 'row', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <IconPlate icon="message" tone="blue" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ ...ty.head, color: t.ink }}>{tpl.title}</Text>
                <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{tpl.body}</Text>
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                  <Ghost label="Edit" onPress={() => open(tpl)} />
                  <Ghost label="Delete" onPress={() => remove(tpl)} />
                </View>
              </View>
            </View>
          ))}
        </Section>

        {offers.length ? (<>
          <Section>
            <SectionHead title="Ones to Start From" note="Not Yours Until You Add One" />
            {offers.map((tpl, i) => (
              <View key={tpl.title} style={{ flexDirection: 'row', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <IconPlate icon="sparkle" tone="purple" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ ...ty.head, color: t.ink }}>{tpl.title}</Text>
                  <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{tpl.body}</Text>
                  <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                    <Ghost label="Add It" onPress={() => { void save({ id: null, title: tpl.title, body: tpl.body, position: nextPosition(rows) }); }} />
                    <Ghost label="Edit First" onPress={() => open({ ...tpl, position: nextPosition(rows) })} />
                  </View>
                </View>
              </View>
            ))}
          </Section>
        </>) : null}


        {/* The two explanations, behind folds. The first was the paragraph
            that opened the page; the second was a notice at its foot. Neither
            is a figure, a caveat about money or a safety fact, so neither is
            owed a place above the library itself. */}
        <Expandable title="How Saved Messages Work">
          <Text style={{ ...ty.label, color: t.ink2 }}>
            The messages you type every week. Pick one in any thread and it lands in your box with the client’s name filled in. Nothing is ever sent for you. The ones to start from are meant to be rewritten in your own voice, and only the ones you do not already have are offered.
          </Text>
        </Expandable>
        <Expandable title="Placeholders" note="Two words the app fills in">
          <Text style={{ ...ty.label, color: t.ink2 }}>
            {TOKENS.map((x) => `${x.token} becomes ${x.means}`).join('. ') + '. Anything else in curly brackets is sent to your client exactly as you typed it, so it is worth checking before you send.'}
          </Text>
        </Expandable>

      </ScrollView>

      {/* ── the editor ────────────────────────────────────────────────────── */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setEditing(null)}
            accessibilityRole="button" accessibilityLabel="Close" />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingBottom: 30, maxHeight: '90%' }}>
            {/* The message box alone is 120pt, and Save sits under it. Writing into
                that box is exactly when the keyboard is up, and that is exactly when
                Save was off the bottom of the window with no way to reach it. */}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>
                {editing?.id ? 'Edit This Message' : 'A New Saved Message'}
              </Text>
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>What to Call It</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder="Welcome" placeholderTextColor={t.ink3}
                style={{ ...inp, marginBottom: sp.md }} />
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>The Message</Text>
              <TextInput value={body} onChangeText={setBody} multiline maxLength={MAX_TEMPLATE_BODY}
                placeholder="Hey {name}, " placeholderTextColor={t.ink3}
                style={{ ...inp, minHeight: 120, textAlignVertical: 'top', marginBottom: sp.sm }} />
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>
                {TOKENS.map((x) => `${x.token} becomes ${x.means}`).join('. ')}.
              </Text>
              <Cta label={busy ? 'Saving…' : 'Save'} wide onPress={() => { void save(); }} disabled={busy} />
              <View style={{ height: sp.sm }} />
              <Ghost label="Cancel" onPress={() => setEditing(null)} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
