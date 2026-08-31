// The form a coach takes before they train somebody, and what may be said
// about it afterwards.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// `app/(client)/onboarding.tsx` asks a goal, a height, a diet and a list of
// allergens. That is a meal-plan questionnaire. A coach standing in front of a
// stranger on day one needs to know whether they should be exercising at all,
// what they have already done, what they have already tried and given up on,
// which days they can actually turn up, and who to ring if something happens.
// None of that existed anywhere in the product, so every coach on Repple was
// doing it on paper and typing nothing back in.
//
// ── The rule this file exists to hold ──────────────────────────────────────
//
// A readiness questionnaire is a REFERRAL instrument. Its output is "see a
// doctor before you start", and that is the whole of its output. It does not
// grade people, it does not rank its own questions, and a "yes" to the cardiac
// one is not more alarming than a "yes" to the joint one in any sense this app
// is entitled to have an opinion about.
//
// So there is deliberately no score in this file, no severity, no ordering by
// how bad an answer sounds, and no branch anywhere that reads one question id
// and not the others. `readinessDisclosed` returns what was answered yes, in
// the order it was asked, with the client's own note attached, and
// `readinessNote` wraps it in a sentence that says what it is and says it is
// not medical advice. Everything downstream renders that and stops. The house
// rule against inventing clinical judgement is not decoration here: the app
// telling a coach that somebody is "high risk" would be a clinical claim made
// by a fitness app about a person it has never met.
//
// ── And the ownership rule ─────────────────────────────────────────────────
//
// The document belongs to the person who answered it. The database enforces
// that — `clients_intake_guard`, supabase/parts/127 — and `intakeOwnership`
// below is the app-side statement of the same rule, so a screen never offers a
// control the server is going to refuse. The database is the enforcement; this
// is the sentence explaining it.
import type { LoadStatus } from '../ui/loadStatus';

/** Bumped when a field changes meaning, never when one is added. `parseIntake`
 *  fills in what an older document does not carry. */
export const INTAKE_VERSION = 1;

export type YesNo = 'yes' | 'no';

/* ── readiness ──────────────────────────────────────────────────────────── */

export interface ReadinessQuestion {
  id: string;
  /** Asked in the second person, because the client is the one answering. */
  prompt: string;
}

/**
 * Seven questions, in the order they are asked.
 *
 * These are Repple's own wording of the seven topics every pre-exercise
 * readiness screen has covered for forty years — heart condition, chest pain
 * under exertion, chest pain at rest, dizziness or fainting, a joint problem
 * exertion could worsen, blood-pressure or cardiac medication, and anything
 * else the person themselves knows of. The topics are the standard; the
 * sentences are ours, written to be answerable by somebody who has never seen
 * a form like this.
 *
 * The order is the order. It is not a priority list and nothing sorts it.
 */
export const READINESS_QUESTIONS: ReadinessQuestion[] = [
  { id: 'heart', prompt: 'Has a doctor ever told you that you have a heart condition, or that you should only exercise under medical supervision?' },
  { id: 'chest_effort', prompt: 'Do you get pain or tightness in your chest when you exert yourself?' },
  { id: 'chest_rest', prompt: 'In the last month, have you had chest pain while you were resting?' },
  { id: 'faint', prompt: 'Do you ever lose your balance from dizziness, or lose consciousness?' },
  { id: 'joints', prompt: 'Do you have a bone or joint problem that could be made worse by exercise?' },
  { id: 'medication', prompt: 'Are you currently taking prescribed medication for blood pressure or for your heart?' },
  { id: 'other', prompt: 'Is there any other reason you know of why exercise might not be safe for you right now?' },
];

export interface ReadinessAnswer {
  answer: YesNo;
  /** The client's own words. Optional, and offered on every answer rather than
   *  only on a yes — somebody explaining a "no" is telling the coach something
   *  too. */
  note?: string;
}

/** One question the client answered yes to, and what they said about it. */
export interface ReadinessDisclosure {
  id: string;
  prompt: string;
  note: string | null;
}

/**
 * What the readiness screen is, said in full, wherever an answer is shown.
 *
 * Kept as one constant rather than typed into two screens, because the version
 * on the coach's side and the version on the client's side disagreeing about
 * what this form is would be worse than either of them alone.
 */
export const READINESS_NOT_ADVICE =
  'This is a readiness questionnaire, not an assessment. Repple does not score it, does not interpret it, and has not looked at it. It is what this person answered, in their words.';

/**
 * The standing instruction a readiness questionnaire carries, and the only
 * thing anybody is entitled to conclude from a "yes".
 *
 * It is not a warning, not a flag, and not addressed to the coach's judgement
 * about training. It is the referral the form exists to produce.
 */
export const READINESS_SEE_A_DOCTOR =
  'Where any answer here is yes, the standard guidance is the same one it has always been: speak to a doctor or another qualified health professional before starting or increasing exercise. That is a conversation for them to have, not a verdict on their training.';

/* ── the rest of the document ───────────────────────────────────────────── */

export type TrainingYears = 'none' | 'under1' | 'oneToThree' | 'threeToTen' | 'overTen';

export const TRAINING_YEARS: { id: TrainingYears; label: string }[] = [
  { id: 'none', label: 'Never really' },
  { id: 'under1', label: 'Under a year' },
  { id: 'oneToThree', label: '1–3 years' },
  { id: 'threeToTen', label: '3–10 years' },
  { id: 'overTen', label: '10 years or more' },
];

export const TRAINING_KINDS: { id: string; label: string }[] = [
  { id: 'weights', label: 'Weights' },
  { id: 'classes', label: 'Classes' },
  { id: 'running', label: 'Running' },
  { id: 'cycling', label: 'Cycling' },
  { id: 'swimming', label: 'Swimming' },
  { id: 'sport', label: 'A team sport' },
  { id: 'martial', label: 'Martial arts' },
  { id: 'yoga', label: 'Yoga or pilates' },
  { id: 'walking', label: 'Walking' },
];

export type TrainingPlace = 'gym' | 'home' | 'outdoors' | 'studio';

export const TRAINING_PLACES: { id: TrainingPlace; label: string }[] = [
  { id: 'gym', label: 'A gym' },
  { id: 'studio', label: 'Your studio' },
  { id: 'home', label: 'At home' },
  { id: 'outdoors', label: 'Outdoors' },
];

export const TIME_WINDOWS: { id: string; label: string }[] = [
  { id: 'earlyAm', label: 'Before work' },
  { id: 'midday', label: 'Middle of the day' },
  { id: 'evening', label: 'Evenings' },
  { id: 'weekend', label: 'Weekends' },
];

export type WorkKind = 'desk' | 'onFeet' | 'manual' | 'shifts' | 'mixed';

export const WORK_KINDS: { id: WorkKind; label: string }[] = [
  { id: 'desk', label: 'Sitting most of the day' },
  { id: 'onFeet', label: 'On my feet most of the day' },
  { id: 'manual', label: 'Physical or manual work' },
  { id: 'shifts', label: 'Shift work' },
  { id: 'mixed', label: 'A bit of everything' },
];

export interface IntakeHistory {
  years: TrainingYears | null;
  /** What they are doing at the moment, in their own words. */
  doingNow: string;
  kinds: string[];
  coachedBefore: YesNo | null;
}

export interface IntakeWant {
  /** What they want, in their own words. The single most useful line in the
   *  whole document and the one a coach reads first. */
  headline: string;
  /** A date, an event, a holiday — free text, because "my sister's wedding"
   *  is a better answer than a date picker can take. */
  by: string;
  why: string;
}

export interface IntakeTried {
  worked: string;
  didnt: string;
  /** What they will not do again. A coach who programmes it anyway has lost
   *  them by week three. */
  wont: string;
}

export interface IntakeAvailability {
  daysPerWeek: number | null;
  sessionMins: number | null;
  times: string[];
  place: TrainingPlace | null;
  equipment: string;
}

export interface IntakePractical {
  work: WorkKind | null;
  sleepHours: number | null;
  anythingElse: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
}

export interface Intake {
  version: number;
  /** ISO. The document's own timestamp — there is deliberately no second
   *  column beside it on the row for the two to disagree. */
  updatedAt: string;
  readiness: Record<string, ReadinessAnswer>;
  history: IntakeHistory;
  want: IntakeWant;
  tried: IntakeTried;
  availability: IntakeAvailability;
  practical: IntakePractical;
  emergency: EmergencyContact;
}

/* ── reading one back ───────────────────────────────────────────────────── */

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const has = (s: string): boolean => s.trim().length > 0;
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/** A document nobody has started. Every field is empty rather than plausible:
 *  a default that looks like an answer is an answer nobody gave. */
export function emptyIntake(nowISO: string): Intake {
  return {
    version: INTAKE_VERSION,
    updatedAt: nowISO,
    readiness: {},
    history: { years: null, doingNow: '', kinds: [], coachedBefore: null },
    want: { headline: '', by: '', why: '' },
    tried: { worked: '', didnt: '', wont: '' },
    availability: { daysPerWeek: null, sessionMins: null, times: [], place: null, equipment: '' },
    practical: { work: null, sleepHours: null, anythingElse: '' },
    emergency: { name: '', phone: '', relation: '' },
  };
}

/**
 * Read the jsonb column back into a document.
 *
 * Tolerant on purpose. A document written by an older build has to keep
 * opening, and the alternative — a strict parse that returns null on an
 * unexpected field — would present somebody who HAS filled this in as somebody
 * who has not, which is the exact failure the whole screen is built to avoid.
 *
 * Null is returned only for a genuinely absent document. `{}` is a client who
 * opened the form and saved nothing, and that is a different fact.
 */
export function parseIntake(raw: unknown): Intake | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const base = emptyIntake(str(o.updatedAt));

  const readiness: Record<string, ReadinessAnswer> = {};
  const rd = o.readiness;
  if (rd && typeof rd === 'object' && !Array.isArray(rd)) {
    for (const q of READINESS_QUESTIONS) {
      const a = (rd as Record<string, unknown>)[q.id];
      if (!a || typeof a !== 'object') continue;
      const answer = oneOf((a as Record<string, unknown>).answer, ['yes', 'no'] as const);
      if (!answer) continue;
      const note = str((a as Record<string, unknown>).note);
      readiness[q.id] = has(note) ? { answer, note } : { answer };
    }
  }

  const h = (o.history ?? {}) as Record<string, unknown>;
  const w = (o.want ?? {}) as Record<string, unknown>;
  const tr = (o.tried ?? {}) as Record<string, unknown>;
  const av = (o.availability ?? {}) as Record<string, unknown>;
  const pr = (o.practical ?? {}) as Record<string, unknown>;
  const em = (o.emergency ?? {}) as Record<string, unknown>;

  return {
    version: numOrNull(o.version) ?? INTAKE_VERSION,
    updatedAt: base.updatedAt,
    readiness,
    history: {
      years: oneOf(h.years, TRAINING_YEARS.map((y) => y.id)),
      doingNow: str(h.doingNow),
      kinds: strList(h.kinds),
      coachedBefore: oneOf(h.coachedBefore, ['yes', 'no'] as const),
    },
    want: { headline: str(w.headline), by: str(w.by), why: str(w.why) },
    tried: { worked: str(tr.worked), didnt: str(tr.didnt), wont: str(tr.wont) },
    availability: {
      daysPerWeek: numOrNull(av.daysPerWeek),
      sessionMins: numOrNull(av.sessionMins),
      times: strList(av.times),
      place: oneOf(av.place, TRAINING_PLACES.map((p) => p.id)),
      equipment: str(av.equipment),
    },
    practical: {
      work: oneOf(pr.work, WORK_KINDS.map((k) => k.id)),
      sleepHours: numOrNull(pr.sleepHours),
      anythingElse: str(pr.anythingElse),
    },
    emergency: { name: str(em.name), phone: str(em.phone), relation: str(em.relation) },
  };
}

/* ── how far through it they are ────────────────────────────────────────── */

export interface IntakeSection {
  id: string;
  title: string;
  /** One line saying why a coach wants it, shown above the questions. The
   *  completion rate on a form nobody explains is the reason this field is
   *  here rather than in a comment. */
  why: string;
  done: (i: Intake) => boolean;
}

/**
 * The seven parts, in the order they are asked and in the order they are read
 * back on the coach's side.
 *
 * Readiness is first because it is the one that can change whether the rest of
 * the conversation happens at all. The emergency contact is last because it is
 * the easiest, and a form whose last question is easy gets finished.
 */
export const INTAKE_SECTIONS: IntakeSection[] = [
  {
    id: 'readiness',
    title: 'Before you start',
    why: 'Seven standard questions every trainer asks before a first session.',
    done: (i) => READINESS_QUESTIONS.every((q) => !!i.readiness[q.id]),
  },
  {
    id: 'history',
    title: 'What you have done',
    why: 'So your coach starts where you actually are, not where a beginner is.',
    done: (i) => i.history.years !== null && has(i.history.doingNow),
  },
  {
    id: 'want',
    title: 'What you want',
    why: 'In your words. This is the line your coach reads first.',
    done: (i) => has(i.want.headline),
  },
  {
    id: 'tried',
    title: 'What you have tried',
    why: 'What worked, what did not, and what you will not do again.',
    done: (i) => has(i.tried.worked) || has(i.tried.didnt) || has(i.tried.wont),
  },
  {
    id: 'availability',
    title: 'When you can train',
    why: 'A plan built for four days a week is no plan at all if you have two.',
    done: (i) => i.availability.daysPerWeek !== null
      && i.availability.sessionMins !== null
      && i.availability.place !== null,
  },
  {
    id: 'practical',
    title: 'Your week',
    why: 'What your days are like outside the gym changes what belongs in it.',
    done: (i) => i.practical.work !== null,
  },
  {
    id: 'emergency',
    title: 'Who to call',
    why: 'If something happens while you are training, your coach needs a name.',
    done: (i) => has(i.emergency.name) && has(i.emergency.phone),
  },
];

export interface IntakeProgress {
  sections: { id: string; title: string; done: boolean }[];
  /** How many are finished. `of` rather than `total` because it is read as
   *  "4 of 7" everywhere it is printed. */
  done: number;
  of: number;
  complete: boolean;
  /** The next unfinished section, so a screen can offer "carry on" rather than
   *  making somebody find their place. Null once it is all done. */
  nextId: string | null;
}

export function intakeProgress(i: Intake | null): IntakeProgress {
  const sections = INTAKE_SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
    done: i ? s.done(i) : false,
  }));
  const done = sections.filter((s) => s.done).length;
  return {
    sections,
    done,
    of: sections.length,
    complete: done === sections.length,
    nextId: sections.find((s) => !s.done)?.id ?? null,
  };
}

/**
 * What is known about somebody's intake, from a read that may not have landed.
 *
 * Written the same way as `ackState` in injuryGate.ts, for the same reason: an
 * absent document and a refused read produce the identical empty object, and a
 * coach's screen saying "they have not filled it in" over a failed read would
 * be an accusation about a person, generated by a network error.
 *
 *   'unknown'  — the read did not finish, or was refused, or was truncated.
 *   'none'     — the read landed and there is no document at all.
 *   'started'  — a document exists with sections still unanswered.
 *   'complete' — every section is answered.
 */
export type IntakeState = 'unknown' | 'none' | 'started' | 'complete';

export function intakeState(status: LoadStatus, intake: Intake | null): IntakeState {
  if (status !== 'ready') return 'unknown';
  if (!intake) return 'none';
  return intakeProgress(intake).complete ? 'complete' : 'started';
}

/* ── what the coach's screen says ───────────────────────────────────────── */

/**
 * The line under the row on the client's page.
 *
 * Every branch is a different sentence including the one that says we could not
 * find out, and none of them says anything about the person under 'unknown'.
 */
export function intakeLine(state: IntakeState, progress: IntakeProgress, who: string): string {
  switch (state) {
    case 'unknown':
      return `Their intake could not be read, so whether ${who} has filled it in is unknown. This is not a statement that they have not.`;
    case 'none':
      return `${who} has not started their intake. Nothing about their readiness, their history or when they can train has been asked yet.`;
    case 'started':
      return `${progress.done} of ${progress.of} parts answered. What is missing is missing — it has not been read and stored somewhere else.`;
    case 'complete':
      return `All ${progress.of} parts answered. Their readiness answers, history, goals and availability, in their own words.`;
  }
}

/**
 * The nudge, or null when there is nothing to nudge about.
 *
 * Null under 'unknown' as well as under 'complete', and that is deliberate:
 * "chase your client" is an instruction, and an instruction generated by a
 * failed read is one the coach acts on and then finds out was wrong.
 */
export function intakePrompt(state: IntakeState, progress: IntakeProgress, who: string): string | null {
  if (state === 'none') {
    return `${who} has not filled in their intake. You cannot fill it in for them — it has to come from them — so ask, and it lands here the moment they finish.`;
  }
  if (state === 'started') {
    const missing = progress.sections.filter((s) => !s.done).map((s) => s.title.toLowerCase());
    return `${who} has ${progress.of - progress.done} part${progress.of - progress.done === 1 ? '' : 's'} of their intake left: ${missing.join(', ')}. Ask them to finish it before you build anything around a half-answered form.`;
  }
  return null;
}

/** What the client reads when their coach asks them to finish it.
 *
 *  Says the coach cannot do it for them, for the same reason `askMessage` in
 *  src/ui/injuryAsk.ts does: without that sentence the request reads as
 *  paperwork, and the honest answer — that this has to come from them — is also
 *  the reason it is worth doing. */
export function askIntakeMessage(state: IntakeState, progress: IntakeProgress): string {
  const lines: string[] = [];
  lines.push(state === 'started'
    ? `Could you finish your intake form when you get a minute? You have ${progress.done} of ${progress.of} parts done.`
    : 'Could you fill in your intake form before we train? It is the readiness questions, a bit of history, and when you can train.');
  lines.push('I can’t fill it in for you — it has to come from you — and it is what I build your training around.');
  return lines.join('\n\n');
}

/* ── the readiness answers, and nothing added to them ───────────────────── */

/**
 * The questions answered yes, in the order they were asked.
 *
 * Not sorted, not ranked, not grouped, and not filtered by which question it
 * was. A screen that put the cardiac answer at the top would be ranking these
 * by how dangerous it thought they were, which is a clinical judgement this
 * app does not have and is not allowed to imply.
 */
export function readinessDisclosed(intake: Intake | null): ReadinessDisclosure[] {
  if (!intake) return [];
  const out: ReadinessDisclosure[] = [];
  for (const q of READINESS_QUESTIONS) {
    const a = intake.readiness[q.id];
    if (a?.answer !== 'yes') continue;
    const note = a.note && has(a.note) ? a.note.trim() : null;
    out.push({ id: q.id, prompt: q.prompt, note });
  }
  return out;
}

/** The questions with no answer at all, in the order they were asked. An
 *  unanswered question is not a "no" and is never counted as one. */
export function readinessUnanswered(intake: Intake | null): ReadinessQuestion[] {
  if (!intake) return READINESS_QUESTIONS.slice();
  return READINESS_QUESTIONS.filter((q) => !intake.readiness[q.id]);
}

/**
 * The sentence that goes above the answers on the coach's side.
 *
 * It states what was answered and then gets out of the way. There is no verdict
 * in it, no adjective about the answers, and no number derived from them beyond
 * how many questions were asked — because a count of yeses read as a score the
 * moment it was printed next to a person's name, whatever the label said.
 */
export function readinessNote(
  disclosed: ReadinessDisclosure[],
  unanswered: ReadinessQuestion[],
  who: string,
): string {
  const parts: string[] = [];
  if (disclosed.length === 0 && unanswered.length === 0) {
    parts.push(`${who} answered no to every readiness question.`);
  } else if (disclosed.length === 0) {
    parts.push(`${who} answered no to the readiness questions they have answered so far.`);
  } else {
    parts.push(`${who} answered yes to the following. Their words are underneath each one.`);
  }
  if (unanswered.length > 0) {
    parts.push(`${unanswered.length} of the ${READINESS_QUESTIONS.length} questions ${unanswered.length === 1 ? 'is' : 'are'} still unanswered. An unanswered question is not a no.`);
  }
  parts.push(READINESS_NOT_ADVICE);
  if (disclosed.length > 0) parts.push(READINESS_SEE_A_DOCTOR);
  return parts.join(' ');
}

/* ── who may write it ───────────────────────────────────────────────────── */

export interface IntakeOwnership {
  mayEdit: boolean;
  /** Why not, addressed to whoever is looking at the screen. Null when they
   *  may. */
  reason: string | null;
}

/**
 * May the person holding this screen change this intake?
 *
 * Only the person it is about, and only when both ids are actually known. This
 * is the app-side statement of `clients_intake_guard` (supabase/parts/127): the
 * database is what enforces it and will answer a coach with 42501 whatever this
 * function returns, but a screen that offered the control anyway would be
 * inviting somebody to do something that is going to fail — and worse, would
 * let a coach believe for a moment that an intake is theirs to correct.
 *
 * A missing id is refused rather than waved through. Two nulls are not a match:
 * an unread viewer editing an unread subject is the shape every "logged out
 * user edits everything" bug has.
 */
export function intakeOwnership(viewerId: string | null, subjectId: string | null): IntakeOwnership {
  if (!viewerId || !subjectId) {
    return {
      mayEdit: false,
      reason: 'We could not tell whose intake this is, so nothing here can be changed. Open it again in a moment.',
    };
  }
  if (viewerId !== subjectId) {
    return {
      mayEdit: false,
      reason: 'An intake belongs to the person who answered it. Only they can change it — the database refuses anybody else, including their coach, which is what makes it worth reading.',
    };
  }
  return { mayEdit: true, reason: null };
}
