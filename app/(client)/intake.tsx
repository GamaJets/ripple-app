// Client · the form your coach takes before they train you.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// It did not. `onboarding.tsx` asks a goal, a height, a diet and a list of
// allergens, which is enough to build a meal plan and nothing like enough to
// start training somebody. No readiness questions, no history, no account of
// what has already been tried, no idea which days of the week are actually
// available. Every coach on the platform was taking this on paper and typing
// none of it back in, which meant the app's own programme builder — the thing
// that gates on injuries — was working from less than the coach knew.
//
// ── Why it is all one screen ───────────────────────────────────────────────
//
// A seven-step wizard is seven places to abandon it. Everything is here, the
// progress line at the top says how far through it is, and Save works at any
// point: a half-finished intake is worth more to a coach than a blank one, and
// the coach's side is built to say "4 of 7 answered" rather than treating
// anything short of complete as nothing.
//
// ── The two things this screen must not do ─────────────────────────────────
//
// It must not judge the readiness answers. There is no banner, no colour, no
// score, and no different treatment for the cardiac question than for the joint
// one — see the long note at the top of src/lib/intake.ts. What a yes produces
// is the sentence a readiness questionnaire has always produced: speak to a
// doctor before you start.
//
// And it must not save over a document it could not read. If the read failed,
// what is on screen is an empty form standing in for one that may be full, and
// saving it would replace a real disclosure with a blank. The Save control is
// withheld and says why — the same gesture as src/lib/overwriteGuard.ts.
import { useEffect, useState, type ReactNode } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useMyIntake } from '../../src/ui/intake';
import {
  INTAKE_SECTIONS, READINESS_QUESTIONS, READINESS_NOT_ADVICE, READINESS_SEE_A_DOCTOR,
  TIME_WINDOWS, TRAINING_KINDS, TRAINING_PLACES, TRAINING_YEARS, WORK_KINDS,
  emptyIntake, intakeProgress, readinessDisclosed,
  type Intake, type TrainingPlace, type TrainingYears, type WorkKind, type YesNo,
} from '../../src/lib/intake';

const DAYS = [1, 2, 3, 4, 5, 6, 7];
const MINS = [30, 45, 60, 75, 90];
const SLEEP = [5, 6, 7, 8, 9];

/* ── the three pieces this form is made of ────────────────────────────────
    Declared at module scope, not inside the screen, and the theme is a prop
    for the same reason the Chip in app/(trainer)/client.tsx takes one. A
    component defined inside a render is a NEW component type on every render,
    so React unmounts the old tree and mounts a fresh one — which on a screen
    made of text fields means the keyboard dismisses and the caret jumps to the
    end after every single character typed. It is the kind of thing that only
    shows up on a device, and it makes a form of this length unusable. */

function Pill({ t, label, on, onPress }: { t: Theme; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
}

function Field({ t, label, value, onChangeText, placeholder, multiline, keyboardType }: {
  t: Theme; label: string; value: string; onChangeText: (v: string) => void; placeholder: string;
  multiline?: boolean; keyboardType?: 'default' | 'phone-pad';
}) {
  return (
    <View style={{ marginTop: sp.lg }}>
      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={t.ink3} multiline={multiline} keyboardType={keyboardType ?? 'default'}
        style={{
          ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring,
          borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg,
          paddingVertical: sp.md, minHeight: multiline ? 64 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
        }} />
    </View>
  );
}

function Row({ t, label, children }: { t: Theme; label: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: sp.lg }}>
      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>{children}</View>
    </View>
  );
}

/** A section's title and the one line saying why a coach wants it. The "why"
 *  is not decoration: the completion rate on a form nobody explains is the
 *  reason those sentences exist in src/lib/intake.ts at all. */
function Head({ t, id, done }: { t: Theme; id: string; done: boolean }) {
  const s = INTAKE_SECTIONS.find((x) => x.id === id);
  if (!s) return null;
  return (
    <>
      <SectionHead title={s.title} note={done ? 'Answered' : undefined} />
      <Text style={{ ...ty.label, color: t.ink3 }}>{s.why}</Text>
    </>
  );
}

export default function IntakeScreen() {
  const t = useTheme();
  const router = useRouter();
  const m = useMyIntake();

  // The draft is seeded from the server's copy ONCE the read lands, and only
  // then. Seeding an empty document first and letting the answers arrive over
  // the top would let somebody start typing into a form that is about to be
  // replaced under them.
  const [draft, setDraft] = useState<Intake | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (m.status !== 'ready') return;
    setDraft((d) => d ?? (m.intake ?? emptyIntake(new Date().toISOString())));
  }, [m.status, m.intake]);

  const progress = intakeProgress(draft);
  const yeses = readinessDisclosed(draft);
  // Withheld under anything but a finished read, and under an unknown owner.
  // Both would end with somebody's real answers replaced by an empty form.
  const canSave = !!draft && m.status === 'ready' && m.mayEdit && !saving;

  const edit = (fn: (d: Intake) => Intake) => {
    setSaved(false);
    setDraft((d) => (d ? fn({ ...d }) : d));
  };

  const save = async () => {
    if (!draft || !canSave) return;
    setSaving(true);
    const ok = await m.save(draft);
    setSaving(false);
    setSaved(ok);
    if (!ok) {
      Alert.alert(
        'Not saved',
        'Your answers are still on this screen and are not on the server, so your coach cannot see them. Check your connection and press Save again.',
        [{ text: 'OK' }],
      );
    }
  };

  const sectionDone = (id: string) => progress.sections.find((s) => s.id === id)?.done ?? false;

  /* ── the screen ────────────────────────────────────────────────────── */

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      {/* No KeyboardAvoidingView. This screen is registered `href: null` in the
          client tabs, so it draws BELOW a navigator header, and that is exactly
          the case KeyboardAvoidingView gets wrong: it subtracts the keyboard's
          window-absolute top edge from its own parent-relative layout, so it
          under-lifts by the header's height. There is no docked bar here to
          lift — every field is in this ScrollView — so the whole job is the
          ScrollView's own `automaticallyAdjustKeyboardInsets`, which iOS
          computes in window coordinates and therefore gets right under a header
          of any height, in either orientation. See src/ui/keyboardLift.ts. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Before you start</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Your Intake</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          What your coach needs before your first session. Your answers are yours — only you can
          change them, and your coach cannot edit a word of it.
        </Text>

        {/* ── whether what is on screen is really yours ────────────────── */}
        {m.status === 'loading' ? (
          <View style={{ marginTop: sp.lg }}>
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading what you have already answered…</Text>
          </View>
        ) : m.status === 'error' ? (
          <View style={{ marginTop: sp.lg }}>
            <Flag tone={t.crit}>
              Your intake could not be read, so this is not your form — it is a blank one standing in
              for it. Anything typed here now could replace answers you have already given, so saving
              is held until it loads. Close this and open it again in a moment.
            </Flag>
          </View>
        ) : (
          <View style={{ marginTop: sp.lg, flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
            <Text style={{ ...ty.label, color: t.ink2 }}>
              {progress.done} of {progress.of} parts answered
            </Text>
            {progress.complete ? <Icon name="check" size={16} color={t.good} /> : null}
          </View>
        )}

        {/* Owning it is the whole point, so it is said once, plainly, rather
            than being a thing somebody would only find out by a coach trying. */}
        {!m.mayEdit && m.status === 'ready' ? (
          <View style={{ marginTop: sp.md }}>
            <Flag tone={t.warn}>{m.cannotEditBecause}</Flag>
          </View>
        ) : null}

        {m.saveFailed ? (
          <View style={{ marginTop: sp.md }}>
            <Flag tone={t.crit}>
              Your last save did not reach the server, so your coach is not seeing what is on this
              screen. Press Save again before you rely on it.
            </Flag>
          </View>
        ) : null}

        {draft ? (
          <>
            {/* ── 1 · readiness ──────────────────────────────────────── */}
            <Rule />
            <Section>
              <Head t={t} id="readiness" done={sectionDone('readiness')} />

              <View style={{ marginTop: sp.md }}>
                <Notice tone={t.s3} kicker="Not medical advice" title="These are screening questions"
                  note="Repple does not score them and does not interpret them. Your coach sees what you answered, in your words." />
              </View>

              {READINESS_QUESTIONS.map((q, i) => {
                const a = draft.readiness[q.id];
                return (
                  <View key={q.id} style={{ paddingTop: sp.lg, marginTop: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                    <Text style={{ ...ty.body, color: t.ink }}>{q.prompt}</Text>
                    <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                      {(['no', 'yes'] as YesNo[]).map((v) => (
                        <Pill t={t} key={v} label={v === 'yes' ? 'Yes' : 'No'} on={a?.answer === v}
                          onPress={() => edit((d) => ({
                            ...d,
                            readiness: { ...d.readiness, [q.id]: { ...(d.readiness[q.id] ?? {}), answer: v } },
                          }))} />
                      ))}
                    </View>
                    {/* Offered on either answer. Somebody explaining a "no" is
                        telling their coach something too, and a note box that
                        only appeared on a yes would make typing one feel like
                        an admission. */}
                    {a ? (
                      <TextInput
                        value={a.note ?? ''}
                        onChangeText={(v) => edit((d) => ({
                          ...d,
                          readiness: { ...d.readiness, [q.id]: { answer: a.answer, note: v } },
                        }))}
                        placeholder="Anything you want to add (optional)"
                        placeholderTextColor={t.ink3} multiline
                        style={{
                          ...ty.label, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring,
                          borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg,
                          paddingVertical: sp.md, minHeight: 48, marginTop: sp.md, textAlignVertical: 'top',
                        }} />
                    ) : null}
                  </View>
                );
              })}

              {/* The referral, and the whole of what a yes produces here. Not a
                  banner, not a colour, not a count — the sentence a readiness
                  questionnaire has carried for forty years. */}
              {yeses.length > 0 ? (
                <View style={{ marginTop: sp.lg }}>
                  <Notice tone={t.s5} kicker="Worth a conversation" title="Speak to a doctor before you start"
                    note={READINESS_SEE_A_DOCTOR} />
                </View>
              ) : null}
            </Section>

            {/* ── 2 · history ────────────────────────────────────────── */}
            <Rule />
            <Section>
              <Head t={t} id="history" done={sectionDone('history')} />
              <Row t={t} label="How long have you trained?">
                {TRAINING_YEARS.map((y) => (
                  <Pill t={t} key={y.id} label={y.label} on={draft.history.years === y.id}
                    onPress={() => edit((d) => ({ ...d, history: { ...d.history, years: y.id as TrainingYears } }))} />
                ))}
              </Row>
              <Row t={t} label="What have you done? Pick any">
                {TRAINING_KINDS.map((k) => {
                  const on = draft.history.kinds.includes(k.id);
                  return (
                    <Pill t={t} key={k.id} label={k.label} on={on}
                      onPress={() => edit((d) => ({
                        ...d,
                        history: {
                          ...d.history,
                          kinds: on ? d.history.kinds.filter((x) => x !== k.id) : [...d.history.kinds, k.id],
                        },
                      }))} />
                  );
                })}
              </Row>
              <Field t={t} label="What are you doing at the moment?" multiline
                value={draft.history.doingNow}
                placeholder="e.g. nothing since March; I walk the dog twice a day"
                onChangeText={(v) => edit((d) => ({ ...d, history: { ...d.history, doingNow: v } }))} />
              <Row t={t} label="Have you worked with a trainer before?">
                {(['yes', 'no'] as YesNo[]).map((v) => (
                  <Pill t={t} key={v} label={v === 'yes' ? 'Yes' : 'No'} on={draft.history.coachedBefore === v}
                    onPress={() => edit((d) => ({ ...d, history: { ...d.history, coachedBefore: v } }))} />
                ))}
              </Row>
            </Section>

            {/* ── 3 · what they want ─────────────────────────────────── */}
            <Rule />
            <Section>
              <Head t={t} id="want" done={sectionDone('want')} />
              <Field t={t} label="What do you want out of this?" multiline
                value={draft.want.headline}
                placeholder="In your own words"
                onChangeText={(v) => edit((d) => ({ ...d, want: { ...d.want, headline: v } }))} />
              <Field t={t} label="By when, if there is a when?"
                value={draft.want.by}
                placeholder="e.g. my sister's wedding in June"
                onChangeText={(v) => edit((d) => ({ ...d, want: { ...d.want, by: v } }))} />
              <Field t={t} label="Why now?" multiline
                value={draft.want.why}
                placeholder="Optional, and often the most useful answer on the page"
                onChangeText={(v) => edit((d) => ({ ...d, want: { ...d.want, why: v } }))} />
            </Section>

            {/* ── 4 · what they have tried ───────────────────────────── */}
            <Rule />
            <Section>
              <Head t={t} id="tried" done={sectionDone('tried')} />
              <Field t={t} label="What has worked before?" multiline
                value={draft.tried.worked} placeholder="Even a little, even a while ago"
                onChangeText={(v) => edit((d) => ({ ...d, tried: { ...d.tried, worked: v } }))} />
              <Field t={t} label="What has not?" multiline
                value={draft.tried.didnt} placeholder="And what happened"
                onChangeText={(v) => edit((d) => ({ ...d, tried: { ...d.tried, didnt: v } }))} />
              <Field t={t} label="What will you not do again?" multiline
                value={draft.tried.wont} placeholder="Say it here and your coach will not programme it"
                onChangeText={(v) => edit((d) => ({ ...d, tried: { ...d.tried, wont: v } }))} />
            </Section>

            {/* ── 5 · availability ───────────────────────────────────── */}
            <Rule />
            <Section>
              <Head t={t} id="availability" done={sectionDone('availability')} />
              <Row t={t} label="Days a week you can train">
                {DAYS.map((n) => (
                  <Pill t={t} key={n} label={String(n)} on={draft.availability.daysPerWeek === n}
                    onPress={() => edit((d) => ({ ...d, availability: { ...d.availability, daysPerWeek: n } }))} />
                ))}
              </Row>
              <Row t={t} label="How long have you got?">
                {MINS.map((n) => (
                  <Pill t={t} key={n} label={`${n} min`} on={draft.availability.sessionMins === n}
                    onPress={() => edit((d) => ({ ...d, availability: { ...d.availability, sessionMins: n } }))} />
                ))}
              </Row>
              <Row t={t} label="When suits? Pick any">
                {TIME_WINDOWS.map((w) => {
                  const on = draft.availability.times.includes(w.id);
                  return (
                    <Pill t={t} key={w.id} label={w.label} on={on}
                      onPress={() => edit((d) => ({
                        ...d,
                        availability: {
                          ...d.availability,
                          times: on ? d.availability.times.filter((x) => x !== w.id) : [...d.availability.times, w.id],
                        },
                      }))} />
                  );
                })}
              </Row>
              <Row t={t} label="Where will you be training?">
                {TRAINING_PLACES.map((p) => (
                  <Pill t={t} key={p.id} label={p.label} on={draft.availability.place === p.id}
                    onPress={() => edit((d) => ({ ...d, availability: { ...d.availability, place: p.id as TrainingPlace } }))} />
                ))}
              </Row>
              <Field t={t} label="What equipment can you get to?" multiline
                value={draft.availability.equipment}
                placeholder="e.g. full gym; or a pair of 8 kg dumbbells and a mat"
                onChangeText={(v) => edit((d) => ({ ...d, availability: { ...d.availability, equipment: v } }))} />
            </Section>

            {/* ── 6 · the rest of their week ─────────────────────────── */}
            <Rule />
            <Section>
              <Head t={t} id="practical" done={sectionDone('practical')} />
              <Row t={t} label="What are your days like?">
                {WORK_KINDS.map((k) => (
                  <Pill t={t} key={k.id} label={k.label} on={draft.practical.work === k.id}
                    onPress={() => edit((d) => ({ ...d, practical: { ...d.practical, work: k.id as WorkKind } }))} />
                ))}
              </Row>
              <Row t={t} label="Roughly how much sleep do you get?">
                {SLEEP.map((n) => (
                  <Pill t={t} key={n} label={`${n} hr`} on={draft.practical.sleepHours === n}
                    onPress={() => edit((d) => ({ ...d, practical: { ...d.practical, sleepHours: n } }))} />
                ))}
              </Row>
              <Field t={t} label="Anything else your coach should know?" multiline
                value={draft.practical.anythingElse}
                placeholder="Optional"
                onChangeText={(v) => edit((d) => ({ ...d, practical: { ...d.practical, anythingElse: v } }))} />
            </Section>

            {/* ── 7 · emergency contact ──────────────────────────────── */}
            <Rule />
            <Section>
              <Head t={t} id="emergency" done={sectionDone('emergency')} />
              <Field t={t} label="Their name" value={draft.emergency.name} placeholder="Who to call"
                onChangeText={(v) => edit((d) => ({ ...d, emergency: { ...d.emergency, name: v } }))} />
              <Field t={t} label="Their number" value={draft.emergency.phone} placeholder="Phone number" keyboardType="phone-pad"
                onChangeText={(v) => edit((d) => ({ ...d, emergency: { ...d.emergency, phone: v } }))} />
              <Field t={t} label="How do you know them?" value={draft.emergency.relation} placeholder="e.g. partner, sister, flatmate"
                onChangeText={(v) => edit((d) => ({ ...d, emergency: { ...d.emergency, relation: v } }))} />
            </Section>

            {/* ── saving ─────────────────────────────────────────────── */}
            <Rule />
            <Section>
              <Cta label={saving ? 'Saving…' : progress.complete ? 'Save' : `Save ${progress.done} of ${progress.of}`}
                onPress={() => { void save(); }} wide disabled={!canSave} />
              {saved ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
                  <Icon name="check" size={16} color={t.good} />
                  <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>
                    Saved. Your coach can see this now.
                  </Text>
                </View>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                You can save a half-finished form and come back — your coach is shown how far you got
                rather than nothing at all. {READINESS_NOT_ADVICE}
              </Text>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
