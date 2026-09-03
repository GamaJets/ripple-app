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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { BRAND } from '../../src/lib/brands';
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
// 44pt. Every answer on this form is a tap target and they sit in rows — see
// the note on `Pill`.
import { MIN_TARGET } from '../../src/lib/a11y';
import { useMyIntake } from '../../src/ui/intake';
import { useReachability } from '../../src/ui/reachability';
import { retryLine } from '../../src/lib/reachability';
import { draftDecision } from '../../src/lib/intakeDraft';
// Whether the document on screen may be re-seeded, and whether it may be sent.
// The two questions the pull-to-refresh used to answer wrongly at the same
// moment — see the long note at the top of the module.
import {
  intakeBanner, intakeSaveAllowed, intakeSeedAction, type IntakeSource,
} from '../../src/lib/intakeSeed';
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

/**
 * One answer on this form.
 *
 * ── The height, which was 34pt ────────────────────────────────────────────
 *
 * `sp.sm` above and below a `ty.label` line draws about 34 points — ten short
 * of the 44 in src/lib/a11y.ts. These are not decorative chips: they are the
 * ANSWERS to a health-history form, sat in rows of five or seven, and the
 * screens they are on are filled in by somebody new to the gym, often standing
 * up, often on a phone they are holding in one hand. Two wrong taps in a row of
 * "1 2 3 4 5" is a different training age, a different injury history and a
 * different starting programme, and nothing on the form says which answer was
 * meant.
 *
 * `minHeight` rather than `hitSlop`, deliberately, and it is the opposite of
 * what a11y.ts's own note recommends for an icon button: these pills sit
 * SHOULDER TO SHOULDER in a wrapping row, so slop on each one would overlap its
 * neighbour and the overlap goes to whichever renders last — which is the same
 * mis-tap, minus the honesty of it being visible. Growing the box moves the
 * boundary and the drawing together, and the row simply gets taller.
 */
function Pill({ t, label, on, onPress }: { t: Theme; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{
        paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.sm,
        minHeight: MIN_TARGET, justifyContent: 'center',
        backgroundColor: on ? t.brand : t.surface2,
      }}>
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

  // The draft is seeded ONCE the read has landed one way or the other, and only
  // then. Seeding an empty document first and letting the answers arrive over
  // the top would let somebody start typing into a form that is about to be
  // replaced under them.
  //
  // Where it is seeded FROM is the new part, and it is decided by
  // src/lib/intakeDraft.ts rather than here.
  const [draft, setDraft] = useState<Intake | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const reach = useReachability();
  // The form on the server, read again. This is not a pure form: what is shown
  // is whatever the member has already answered, and a failed read leaves the
  // screen saying so with nothing to press. The local draft survives the
  // re-read — see `useMyIntake`.
  const pull = usePullToRefresh(useCallback(() => { m.reload(); }, [m.reload]));
  // Which document is on screen, and how it got there.
  //
  //   'server'   the read landed and this is what came back.
  //   'restored' what was typed on this phone, put back without asking because
  //              there was nothing on the server to lose or because it was
  //              built from this exact document.
  //   'local'    the read FAILED and this is a phone-only form. Nothing may be
  //              sent from here; see the notice, and the header above.
  //
  // Null until something has been seeded, which is a third answer and not a
  // shade of 'server': under a failed first read the screen used to call an
  // unseeded form "server" and draw the crit Flag over it. See
  // src/lib/intakeSeed.ts.
  const [source, setSource] = useState<IntakeSource | null>(null);
  // The same value, readable inside the seeding effect without listing it as a
  // dependency — the effect must re-run on the reads, not on its own decision.
  const sourceRef = useRef<IntakeSource | null>(null);
  const setSeeded = useCallback((s: IntakeSource) => { sourceRef.current = s; setSource(s); }, []);
  // Set only in the one case src/lib/intakeDraft.ts refuses to decide: a draft
  // started from a blank, and a server document that turns out to hold real
  // answers. Two accounts of one person, and the app does not get to pick.
  const [choose, setChoose] = useState(false);

  // Seeded once — with one exception, and that exception is the whole of
  // src/lib/intakeSeed.ts. Every keystroke writes a draft, which changes
  // `m.draft`, which re-runs this effect, and without a latch the second run
  // would re-derive "restored" from a draft the member had just typed and put a
  // banner about recovering their answers over a form they never left.
  //
  // The exception: a document seeded because the read FAILED is a stand-in, and
  // it is replaced the moment the read succeeds. Latching on it is what let a
  // pull-to-refresh bring the member's real answers into the provider, remove
  // the warning, unlock Save — and leave the blank on screen for Save to write.
  useEffect(() => {
    const action = intakeSeedAction(m.status, sourceRef.current);
    if (action !== 'seed') return;
    // The read failed. This used to be the end of it: `status` stayed 'error',
    // `canSave` was false, and the screen drew a Flag where the form should be
    // — so a member in a gym reception with no signal could not start the form,
    // let alone keep it. What is on the phone goes on screen instead, and where
    // there is nothing on the phone it is a blank marked as one.
    if (m.status === 'error') {
      setDraft(m.draft?.intake ?? emptyIntake(new Date().toISOString()));
      setSeeded('local');
      return;
    }
    // Re-seeding over a stand-in, `draftDecision` is what stops the blank —
    // or anything typed into it, which carries `basedOn: null` — being treated
    // as a continuation of the document that has just arrived. Where the two
    // disagree the member is asked, and Save stays withheld until they answer.
    const decision = draftDecision(m.draft, m.intake);
    setDraft(decision === 'restore' ? m.draft!.intake : (m.intake ?? emptyIntake(new Date().toISOString())));
    setSeeded(decision === 'restore' ? 'restored' : 'server');
    if (decision === 'ask') setChoose(true);
  }, [m.status, m.intake, m.draft, setSeeded]);

  const banner = intakeBanner(m.status, source);
  const progress = intakeProgress(draft);
  const yeses = readinessDisclosed(draft);
  // Withheld under anything but a finished read, and under an unknown owner.
  // Both would end with somebody's real answers replaced by an empty form.
  // Unchanged, and deliberately. The screen's own header says it: "It must not
  // save over a document it could not read." A draft on the phone is a
  // different act from a write to the server, and keeping one buys nothing that
  // would justify softening this. Also withheld while the member still has the
  // two-documents choice in front of them.
  //
  // `intakeSaveAllowed` asks the status AND where the document on screen came
  // from, because those are two different claims: a 'ready' status says the
  // server answered, not that this is what it answered with. The frame between
  // a successful re-read and the effect above re-seeding is exactly a document
  // the server did not supply under a status saying it did.
  const canSave = !!draft && intakeSaveAllowed(m.status, source) && m.mayEdit && !saving && !choose;

  const edit = (fn: (d: Intake) => Intake) => {
    setSaved(false);
    setDraft((d) => {
      if (!d) return d;
      const next = fn({ ...d });
      // Kept on the phone as it is typed. `basedOn` is null whenever the server
      // document is not what this was typed on top of, which is exactly the
      // offline case — and it is what stops the draft ever being restored over
      // a disclosure it never saw. See src/lib/intakeDraft.ts.
      m.keepDraft(next, source === 'local' ? null : (m.intake?.updatedAt ?? null));
      return next;
    });
  };

  const save = async () => {
    if (!draft || !canSave) return;
    setSaving(true);
    const ok = await m.save(draft);
    setSaving(false);
    setSaved(ok);
    if (!ok) {
      // "Check your connection and try again" whatever happened is the sentence
      // src/lib/reachability.ts exists to replace: one of the two things that
      // happened is the server having read the request and declined it, and
      // sending that person to their wifi settings hides the actual answer.
      // The draft is on the phone either way now, which is what lets the second
      // half of this be true rather than hopeful.
      Alert.alert(
        'Not saved',
        `Your answers are kept on this phone and are not on the server, so your coach cannot see them yet. ${retryLine(reach)}`,
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
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>

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
        {banner === 'loading' ? (
          <View style={{ marginTop: sp.lg }}>
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading what you have already answered…</Text>
          </View>
        ) : banner === 'unread' ? (
          <View style={{ marginTop: sp.lg }}>
            <Flag tone={t.crit}>
              Your intake could not be read, so this is not your form. It is what is on this phone,
              standing in for one that may already be full. Everything you type is kept here and
              nothing is sent, because saving now could replace answers you have already given.
              {' '}{retryLine(reach)}
            </Flag>
          </View>
        ) : banner === 'stale' ? (
          /* A different failure and a different sentence. The re-read failed,
             but an earlier one landed and what is on screen is what it
             returned — so "this is not your form" would be false of it. Save is
             still withheld: nothing is written over a document whose current
             state is unknown. */
          <View style={{ marginTop: sp.lg }}>
            <Flag tone={t.warn}>
              These are your answers as they were read a moment ago. Asking the server again did not
              work, so nothing can be saved until it does — what you type is kept on this phone.
              {' '}{retryLine(reach)}
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

        {/* The one case src/lib/intakeDraft.ts refuses to decide for anybody: a
            form typed on this phone with nothing on the server to type it on
            top of, and a server document that turns out to hold real answers.
            Both are shown as what they are and the member picks. Save is
            withheld until they have. */}
        {choose && m.draft ? (
          <View style={{ marginTop: sp.md }}>
            <Notice tone={t.warn} kicker="Two versions" title="You have answers on this phone that were never sent"
              note="Your saved intake also has answers in it, and these were not typed on top of it. Nothing has been changed. Choose which one you want to carry on from.">
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}>
                  <Ghost label="Keep Saved" onPress={() => {
                    setDraft(m.intake ?? emptyIntake(new Date().toISOString()));
                    m.discardDraft();
                    setSource('server');
                    setChoose(false);
                  }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Cta label="Use This Phone" wide onPress={() => {
                    setDraft(m.draft!.intake);
                    setSource('restored');
                    setChoose(false);
                  }} />
                </View>
              </View>
            </Notice>
          </View>
        ) : null}

        {source === 'restored' && !choose ? (
          <View style={{ marginTop: sp.md }}>
            <Flag tone={t.warn}>
              Answers you typed on this phone and never sent have been put back. They are still only
              on this phone. Press Save when you can, and your coach will see them.
            </Flag>
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
                  note={`${BRAND.label} does not score them and does not interpret them. Your coach sees what you answered, in your words.`} />
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
                rather than nothing at all. Anything you type is kept on this phone as you go, so
                closing this screen never loses it. {READINESS_NOT_ADVICE}
              </Text>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
