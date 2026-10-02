// The coach's own check-in questions, where they are written.
//
// It sits on app/(trainer)/checkins.tsx — the queue they already open to read
// what came back — rather than on a settings screen of its own. A question is
// written while reading the answers to the last one, which is the moment
// somebody realises they are asking the wrong thing.
//
// Everything about what may be asked is src/lib/checkinQuestions.ts; the reads
// and writes are src/ui/checkinQuestions.ts. This file draws them.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Alert } from 'react-native';
import { useTheme } from '../components';
import { Ghost, Notice, Section, SectionHead, Segmented, TonedChip } from '../kit';
import { MIN_TARGET, hitSlopFor } from '../../lib/a11y';
import { hairline, sp, radius, type as ty, font } from '../../theme/scale';
import { isWhole, type LoadStatus } from '../loadStatus';
import { num } from '../../lib/format';
import {
  liveQuestions, questionRefusal, questionsNote, PROMPT_MAX, UNIT_MAX,
  type Question, type QuestionKind,
} from '../../lib/checkinQuestions';
import { addQuestion, retireQuestion } from '../checkinQuestions';

const KIND_LABEL: Record<QuestionKind, string> = {
  rating: 'A Rating',
  number: 'A Figure',
  text: 'A Sentence',
};

/** What each kind actually asks somebody for, in their words rather than in a
 *  type name. Drawn under the control, because "number" and "a waist in
 *  centimetres" are the same choice described at two different distances. */
const KIND_NOTE: Record<QuestionKind, string> = {
  rating: 'They answer 1 to 5, the same scale as the four questions everybody answers.',
  number: 'They type a figure. Name what it is in (cm, kg, days) and it is shown beside every answer.',
  text: 'They write a sentence. Useful to ask, harder to compare week to week.',
};

export function CheckinQuestionEditor({ questions, status, onChanged }: {
  questions: Question[];
  status: LoadStatus;
  onChanged: () => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<QuestionKind>('rating');
  const [unit, setUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const live = liveQuestions(questions);
  const refusal = questionRefusal({ prompt, live: live.length });
  const known = isWhole(status);

  const add = async () => {
    if (busy || refusal) { if (refusal) setSaid(refusal); return; }
    setBusy(true); setSaid(null);
    const ok = await addQuestion({ prompt, kind, unit, position: live.length });
    setBusy(false);
    if (!ok) { setSaid('That question was not saved, so your clients are not being asked it yet. Try again once you have signal.'); return; }
    setPrompt(''); setUnit(''); setOpen(false);
    onChanged();
  };

  const retire = (q: Question) => {
    Alert.alert(
      'Stop Asking This?',
      'It comes off the form your clients fill in. Every answer they have already given stays, and so does the question beside them, so their history still reads.',
      [
        { text: 'Keep Asking', style: 'cancel' },
        {
          text: 'Stop Asking',
          style: 'destructive',
          onPress: async () => {
            const ok = await retireQuestion(q.id);
            if (!ok) { setSaid('That was not changed, so they are still being asked it.'); return; }
            onChanged();
          },
        },
      ],
    );
  };

  return (
    <Section>
      <SectionHead title="Your Own Questions"
        note={known && live.length ? `${num(live.length)}` : undefined} />

      {!known ? (
        <Notice tone={t.warn} kicker="Your Questions" title="These could not be read"
          note="Your clients are still being asked whatever you have set. This is a failed read on this screen and not a change to their form." />
      ) : (
        <>
          <Text style={{ ...ty.label, color: t.ink2 }}>
            {live.length === 0
              ? 'Everybody answers the same six: weight, energy, sleep, mood, how closely they stuck to the plan, and a note. Add your own underneath.'
              : questionsNote(live.length)}
          </Text>

          {live.map((q, i) => (
            <View key={q.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, color: t.ink }}>{q.prompt}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {q.kind === 'number' && q.unit ? `${KIND_LABEL[q.kind]} · ${q.unit}` : KIND_LABEL[q.kind]}
                </Text>
              </View>
              <Pressable onPress={() => retire(q)} accessibilityRole="button"
                accessibilityLabel={`Stop asking: ${q.prompt}. Every answer already given stays`}
                hitSlop={hitSlopFor(MIN_TARGET)}
                style={{ minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: sp.sm }}>
                <Text style={{ ...ty.label, ...font('600'), color: t.ink3 }}>Stop</Text>
              </Pressable>
            </View>
          ))}

          {open ? (
            <View style={{ marginTop: sp.md }}>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.xs }}>The Question</Text>
              <TextInput
                value={prompt}
                onChangeText={(v: string) => { setPrompt(v); if (said) setSaid(null); }}
                placeholder="How did the knee feel on squats?"
                placeholderTextColor={t.ink3}
                maxLength={PROMPT_MAX}
                accessibilityLabel="The question your clients will answer"
                style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
                         paddingHorizontal: sp.md, paddingVertical: sp.sm, minHeight: MIN_TARGET }} />

              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md, marginBottom: sp.xs }}>How They Answer</Text>
              <Segmented value={kind} onChange={setKind}
                options={[
                  { key: 'rating', label: KIND_LABEL.rating },
                  { key: 'number', label: KIND_LABEL.number },
                  { key: 'text', label: KIND_LABEL.text },
                ] as const} />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{KIND_NOTE[kind]}</Text>

              {kind === 'number' ? (
                <>
                  <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md, marginBottom: sp.xs }}>What It Is In</Text>
                  <TextInput
                    value={unit} onChangeText={setUnit}
                    placeholder="cm" placeholderTextColor={t.ink3}
                    maxLength={UNIT_MAX} autoCapitalize="none"
                    accessibilityLabel="What the figure is measured in"
                    style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
                             paddingHorizontal: sp.md, paddingVertical: sp.sm, minHeight: MIN_TARGET }} />
                </>
              ) : null}

              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg, alignItems: 'center' }}>
                <Ghost label={busy ? 'Saving…' : 'Ask This'} icon="check"
                  a11yLabel={refusal ?? 'Add this question to your clients’ check-in'}
                  onPress={() => { void add(); }} />
                <Ghost label="Cancel" onPress={() => { setOpen(false); setPrompt(''); setUnit(''); setSaid(null); }} />
              </View>
            </View>
          ) : (
            <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
              <Ghost label="Add a Question" icon="plus"
                a11yLabel="Add a question of your own to your clients’ check-in"
                onPress={() => setOpen(true)} />
            </View>
          )}

          {said ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{said}</Text> : null}

          {/* Said once, under the control rather than inside the confirm: a
              coach deciding whether to ask a ninth question needs to know the
              limit before they have written it. */}
          {live.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
              <TonedChip label={`${num(live.length)} Asked`} tone="brand" />
            </View>
          ) : null}
        </>
      )}
    </Section>
  );
}
