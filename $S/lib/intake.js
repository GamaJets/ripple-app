"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTAKE_SECTIONS = exports.WORK_KINDS = exports.TIME_WINDOWS = exports.TRAINING_PLACES = exports.TRAINING_KINDS = exports.TRAINING_YEARS = exports.READINESS_SEE_A_DOCTOR = exports.READINESS_NOT_ADVICE = exports.READINESS_QUESTIONS = exports.INTAKE_VERSION = void 0;
exports.emptyIntake = emptyIntake;
exports.parseIntake = parseIntake;
exports.intakeProgress = intakeProgress;
exports.intakeState = intakeState;
exports.intakeLine = intakeLine;
exports.intakePrompt = intakePrompt;
exports.askIntakeMessage = askIntakeMessage;
exports.readinessDisclosed = readinessDisclosed;
exports.readinessUnanswered = readinessUnanswered;
exports.readinessNote = readinessNote;
exports.intakeOwnership = intakeOwnership;
/** Bumped when a field changes meaning, never when one is added. `parseIntake`
 *  fills in what an older document does not carry. */
exports.INTAKE_VERSION = 1;
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
exports.READINESS_QUESTIONS = [
    { id: 'heart', prompt: 'Has a doctor ever told you that you have a heart condition, or that you should only exercise under medical supervision?' },
    { id: 'chest_effort', prompt: 'Do you get pain or tightness in your chest when you exert yourself?' },
    { id: 'chest_rest', prompt: 'In the last month, have you had chest pain while you were resting?' },
    { id: 'faint', prompt: 'Do you ever lose your balance from dizziness, or lose consciousness?' },
    { id: 'joints', prompt: 'Do you have a bone or joint problem that could be made worse by exercise?' },
    { id: 'medication', prompt: 'Are you currently taking prescribed medication for blood pressure or for your heart?' },
    { id: 'other', prompt: 'Is there any other reason you know of why exercise might not be safe for you right now?' },
];
/**
 * What the readiness screen is, said in full, wherever an answer is shown.
 *
 * Kept as one constant rather than typed into two screens, because the version
 * on the coach's side and the version on the client's side disagreeing about
 * what this form is would be worse than either of them alone.
 */
exports.READINESS_NOT_ADVICE = 'This is a readiness questionnaire, not an assessment. Repple does not score it, does not interpret it, and has not looked at it. It is what this person answered, in their words.';
/**
 * The standing instruction a readiness questionnaire carries, and the only
 * thing anybody is entitled to conclude from a "yes".
 *
 * It is not a warning, not a flag, and not addressed to the coach's judgement
 * about training. It is the referral the form exists to produce.
 */
exports.READINESS_SEE_A_DOCTOR = 'Where any answer here is yes, the standard guidance is the same one it has always been: speak to a doctor or another qualified health professional before starting or increasing exercise. That is a conversation for them to have, not a verdict on their training.';
exports.TRAINING_YEARS = [
    { id: 'none', label: 'Never really' },
    { id: 'under1', label: 'Under a year' },
    { id: 'oneToThree', label: '1–3 years' },
    { id: 'threeToTen', label: '3–10 years' },
    { id: 'overTen', label: '10 years or more' },
];
exports.TRAINING_KINDS = [
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
exports.TRAINING_PLACES = [
    { id: 'gym', label: 'A gym' },
    { id: 'studio', label: 'Your studio' },
    { id: 'home', label: 'At home' },
    { id: 'outdoors', label: 'Outdoors' },
];
exports.TIME_WINDOWS = [
    { id: 'earlyAm', label: 'Before work' },
    { id: 'midday', label: 'Middle of the day' },
    { id: 'evening', label: 'Evenings' },
    { id: 'weekend', label: 'Weekends' },
];
exports.WORK_KINDS = [
    { id: 'desk', label: 'Sitting most of the day' },
    { id: 'onFeet', label: 'On my feet most of the day' },
    { id: 'manual', label: 'Physical or manual work' },
    { id: 'shifts', label: 'Shift work' },
    { id: 'mixed', label: 'A bit of everything' },
];
/* ── reading one back ───────────────────────────────────────────────────── */
const str = (v) => (typeof v === 'string' ? v : '');
const has = (s) => s.trim().length > 0;
const numOrNull = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const strList = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
const oneOf = (v, allowed) => typeof v === 'string' && allowed.includes(v) ? v : null;
/** A document nobody has started. Every field is empty rather than plausible:
 *  a default that looks like an answer is an answer nobody gave. */
function emptyIntake(nowISO) {
    return {
        version: exports.INTAKE_VERSION,
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
function parseIntake(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const o = raw;
    const base = emptyIntake(str(o.updatedAt));
    const readiness = {};
    const rd = o.readiness;
    if (rd && typeof rd === 'object' && !Array.isArray(rd)) {
        for (const q of exports.READINESS_QUESTIONS) {
            const a = rd[q.id];
            if (!a || typeof a !== 'object')
                continue;
            const answer = oneOf(a.answer, ['yes', 'no']);
            if (!answer)
                continue;
            const note = str(a.note);
            readiness[q.id] = has(note) ? { answer, note } : { answer };
        }
    }
    const h = (o.history ?? {});
    const w = (o.want ?? {});
    const tr = (o.tried ?? {});
    const av = (o.availability ?? {});
    const pr = (o.practical ?? {});
    const em = (o.emergency ?? {});
    return {
        version: numOrNull(o.version) ?? exports.INTAKE_VERSION,
        updatedAt: base.updatedAt,
        readiness,
        history: {
            years: oneOf(h.years, exports.TRAINING_YEARS.map((y) => y.id)),
            doingNow: str(h.doingNow),
            kinds: strList(h.kinds),
            coachedBefore: oneOf(h.coachedBefore, ['yes', 'no']),
        },
        want: { headline: str(w.headline), by: str(w.by), why: str(w.why) },
        tried: { worked: str(tr.worked), didnt: str(tr.didnt), wont: str(tr.wont) },
        availability: {
            daysPerWeek: numOrNull(av.daysPerWeek),
            sessionMins: numOrNull(av.sessionMins),
            times: strList(av.times),
            place: oneOf(av.place, exports.TRAINING_PLACES.map((p) => p.id)),
            equipment: str(av.equipment),
        },
        practical: {
            work: oneOf(pr.work, exports.WORK_KINDS.map((k) => k.id)),
            sleepHours: numOrNull(pr.sleepHours),
            anythingElse: str(pr.anythingElse),
        },
        emergency: { name: str(em.name), phone: str(em.phone), relation: str(em.relation) },
    };
}
/**
 * The seven parts, in the order they are asked and in the order they are read
 * back on the coach's side.
 *
 * Readiness is first because it is the one that can change whether the rest of
 * the conversation happens at all. The emergency contact is last because it is
 * the easiest, and a form whose last question is easy gets finished.
 */
exports.INTAKE_SECTIONS = [
    {
        id: 'readiness',
        title: 'Before you start',
        why: 'Seven standard questions every trainer asks before a first session.',
        done: (i) => exports.READINESS_QUESTIONS.every((q) => !!i.readiness[q.id]),
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
function intakeProgress(i) {
    const sections = exports.INTAKE_SECTIONS.map((s) => ({
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
function intakeState(status, intake) {
    if (status !== 'ready')
        return 'unknown';
    if (!intake)
        return 'none';
    return intakeProgress(intake).complete ? 'complete' : 'started';
}
/* ── what the coach's screen says ───────────────────────────────────────── */
/**
 * The line under the row on the client's page.
 *
 * Every branch is a different sentence including the one that says we could not
 * find out, and none of them says anything about the person under 'unknown'.
 */
function intakeLine(state, progress, who) {
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
function intakePrompt(state, progress, who) {
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
function askIntakeMessage(state, progress) {
    const lines = [];
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
function readinessDisclosed(intake) {
    if (!intake)
        return [];
    const out = [];
    for (const q of exports.READINESS_QUESTIONS) {
        const a = intake.readiness[q.id];
        if (a?.answer !== 'yes')
            continue;
        const note = a.note && has(a.note) ? a.note.trim() : null;
        out.push({ id: q.id, prompt: q.prompt, note });
    }
    return out;
}
/** The questions with no answer at all, in the order they were asked. An
 *  unanswered question is not a "no" and is never counted as one. */
function readinessUnanswered(intake) {
    if (!intake)
        return exports.READINESS_QUESTIONS.slice();
    return exports.READINESS_QUESTIONS.filter((q) => !intake.readiness[q.id]);
}
/**
 * The sentence that goes above the answers on the coach's side.
 *
 * It states what was answered and then gets out of the way. There is no verdict
 * in it, no adjective about the answers, and no number derived from them beyond
 * how many questions were asked — because a count of yeses read as a score the
 * moment it was printed next to a person's name, whatever the label said.
 */
function readinessNote(disclosed, unanswered, who) {
    const parts = [];
    if (disclosed.length === 0 && unanswered.length === 0) {
        parts.push(`${who} answered no to every readiness question.`);
    }
    else if (disclosed.length === 0) {
        parts.push(`${who} answered no to the readiness questions they have answered so far.`);
    }
    else {
        parts.push(`${who} answered yes to the following. Their words are underneath each one.`);
    }
    if (unanswered.length > 0) {
        parts.push(`${unanswered.length} of the ${exports.READINESS_QUESTIONS.length} questions ${unanswered.length === 1 ? 'is' : 'are'} still unanswered. An unanswered question is not a no.`);
    }
    parts.push(exports.READINESS_NOT_ADVICE);
    if (disclosed.length > 0)
        parts.push(exports.READINESS_SEE_A_DOCTOR);
    return parts.join(' ');
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
function intakeOwnership(viewerId, subjectId) {
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
