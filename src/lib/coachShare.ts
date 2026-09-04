// What leaves the phone when a member talks to the AI Coach, and who decides.
//
// ── What was actually happening ────────────────────────────────────────────
//
// app/(client)/coach.tsx assembled a `context` object and handed it to the
// `coach-chat` edge function, which builds a system prompt from it and posts it
// to api.anthropic.com. That object carried the member's NAME, their weight,
// their body fat percentage, their skeletal muscle mass, their sleep — hours,
// how many nights, and how many of them a device measured — their readiness
// score, the focus areas read off their progress photographs, and
// `injurySummary(cd.injuries)`, which is "Left Knee (moderate, <the note>)".
//
// Nothing on that screen said any of this. There was no consent line, no "not
// medical advice", and no way to use the coach without sending all of it. The
// Injuries screen and the Injury Document screen both carry a disclaimer; the
// screen that actually transmits the injuries carried nothing.
//
// ── The injury note is the part that breaks a written rule ─────────────────
//
// `candidateNote` in src/lib/injuryExtract.ts seeds a proposed injury's note
// with `c.evidence` — THE LINE OFF THE DOCUMENT. A member who photographs a
// physiotherapy report, taps Add This, and never edits the note has the
// report's own words stored in `clients.injuries[].note`. That is intended for
// the coach, who the member chose. It was then also being posted to a language
// model, which they did not, and src/ui/injuryDocs.ts states the rule it
// breaks: the coach sees the extracted injury, never the document.
//
// So the injury summary sent to a model is area and severity and nothing else.
// `sharedInjuries` below is that summary. There is no toggle for the note; it
// simply does not go.
//
// ── The shape of the fix, and why it is an ALLOWLIST ───────────────────────
//
// Four things, and the fourth is what makes the other three hold:
//
//   1. SEND LESS. The name goes entirely. The model never needed it — the
//      screen greets the member by name locally and always did — and a body
//      composition, a sleep record and an injury list with a name on them are a
//      different object from the same figures without one.
//   2. ASK, ONCE, WITH A REAL EXPLANATION. Health details do not go until the
//      member has read what they are and said yes. Nothing is sent at all until
//      they have answered.
//   3. LET THEM TURN IT OFF, AND SAY WHAT IS LOST. `WITHHELD_NOTE` is the
//      sentence for that, and it is specific rather than reassuring: a coach
//      that cannot see an injury will program through it.
//   4. The partition is an ALLOWLIST of keys, not a list of keys to strip.
//      A denylist is wrong the first time somebody adds a field to the context
//      object and forgets this file, and the field they add will be the next
//      `name`. Anything not named in FITNESS_KEYS or HEALTH_KEYS is dropped,
//      so the default for a new field is "not sent" and the failure mode of
//      forgetting is a coach that knows slightly less.
//
// Pure, so all of it is assertable under `npm test` with no device, no store
// and no network. The React half is src/ui/coachShare.tsx; the second lock is
// in src/lib/coach.ts, which will not call the function without an answer.

import { activeInjuries, areaLabel, type Injury } from './injuries';

/**
 * Has this member agreed to send their health details to the model?
 *
 * Four states, and the two that are not yes-or-no are both load-bearing:
 *
 *   'unknown'  nobody in this process has read the stored answer yet. The
 *              answer lives in AsyncStorage, which is asynchronous, so there is
 *              a real window at launch in which this is the truth. A boolean
 *              cannot say it, and either default is a lie — see the same
 *              argument at length in src/lib/pushConsent.ts.
 *   'unasked'  the read COMPLETED and this member has never answered. Distinct
 *              from 'no': 'no' is somebody declining, 'unasked' is a question
 *              still to put. The screen shows the explanation for one and not
 *              the other, and neither sends anything.
 */
export type ShareConsent = 'yes' | 'no' | 'unasked' | 'unknown';

/** The key AsyncStorage holds the answer under. Its own key rather than a field
 *  in the 'repple.settings' blob: that blob is device-local settings, and this
 *  is a consent — mixing them would make a settings migration able to silently
 *  clear an answer about somebody's medical data. */
export const COACH_SHARE_KEY = 'repple.coachShare';

/**
 * What the persisted answer says.
 *
 * Pure, so the rule is assertable without a store. `raw` is exactly what
 * AsyncStorage handed back — null when nothing has ever been written.
 *
 * Never returns 'unknown': this is only ever called on a read that COMPLETED,
 * and a completed read always yields an answer. 'unknown' describes the window
 * before the read finishes, which is a fact about time and not about the blob.
 *
 * Anything that is not one of the two written values is 'unasked'. A corrupt
 * blob, a blob from a version that stored something else, a blob holding the
 * string "true" — none of those is somebody's answer about their own medical
 * data, and the only safe reading of damage is that the question is still open.
 * Note which way that falls: `consentFromStored` in pushConsent.ts defaults a
 * corrupt blob to YES, because the product default for notifications is on.
 * Here the default is to ask, because nothing may be assumed about this.
 */
export function consentFromStored(raw: string | null | undefined): 'yes' | 'no' | 'unasked' {
  if (raw == null) return 'unasked';
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return 'unasked'; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'unasked';
  const v = (parsed as Record<string, unknown>).shareHealth;
  if (typeof v !== 'boolean') return 'unasked';
  return v ? 'yes' : 'no';
}

/** What is written back. A shape rather than a bare boolean so a later field —
 *  the date they answered, say — can be added without invalidating the answer
 *  already on every device. */
export function storedConsent(answer: 'yes' | 'no'): string {
  return JSON.stringify({ shareHealth: answer === 'yes' });
}

/**
 * The context fields that go whenever the coach is used at all.
 *
 * These are what makes it a coach rather than a chatbot: what they are training
 * for, the program they are on, who is coaching them and when, what they have
 * eaten against their targets today, and what to load next. A member who
 * declines the health tier still gets a coach that can answer "what should I
 * eat post-workout" and "am I on track".
 *
 * `weightKg` is NOT here, though a lifting answer would be better for it. It is
 * a body measurement, the member may consider it the most sensitive number they
 * have, and `nextLift` already carries the load in their own unit.
 */
export const FITNESS_KEYS = [
  'coaching', 'goal', 'diet', 'mealsPerDay',
  'kcal', 'protein', 'carbs', 'fat',
  'programTitle', 'programFocus',
  'eatenToday', 'streak', 'lastTrained', 'nextLift',
  // The dates a weekly summary covers — "Aug 27 – Sep 2".
  //
  // Declared because app/(client)/report.tsx has put it in the context object
  // since the screen was written, and an undeclared key is dropped in SILENCE.
  // That is the safe direction and it is still a cost: the summary keeps being
  // written, the model is never told which seven days it is describing, it
  // writes "this week" over a report the member may open on a Thursday three
  // weeks later, and nothing anywhere says a field went missing. This is the
  // one field where paying that cost buys nothing at all.
  //
  // FITNESS rather than HEALTH, and not a close call: a pair of calendar dates
  // is not a measurement of a person. It is the same string for everybody who
  // opens the screen on the same day, it says nothing about a body, and
  // withholding it from a member who declined would make their summary vaguer
  // without making it more private.
  'week',
] as const;

/**
 * The context fields that go ONLY after the member has said yes.
 *
 * Body composition, sleep, recovery, injuries, and the focus areas read off
 * their progress photographs. Every one of them is a health measurement about a
 * person, and three of them (`readiness`, `readinessGaps`, `sleep`) are derived
 * from a wearable that measures them while they are asleep.
 *
 * `injuries` is in here AND is redacted before it arrives — see
 * `sharedInjuries`. Consent gates whether the injury goes at all; it does not
 * unlock the note, which never goes.
 */
export const HEALTH_KEYS = [
  'weightKg', 'bodyFatPct', 'muscleKg',
  'readiness', 'readinessGaps', 'sleep',
  'injuries', 'focusAreas',
] as const;

export type FitnessKey = typeof FITNESS_KEYS[number];
export type HealthKey = typeof HEALTH_KEYS[number];

/**
 * The injury list as a model may see it: area and severity, no note.
 *
 * '' — not "none disclosed" — when there is nothing active, so the caller can
 * decide what an empty list means in its own sentence. `injurySummary` in
 * src/lib/injuries.ts is the unredacted version and stays exactly as it is: the
 * coach and the plan are entitled to the note, because the member wrote it for
 * them. This is the version for a third party.
 *
 * The severity word is passed through rather than title-cased, matching
 * `injurySummary`'s own format, because the two are read by the same prompt and
 * a difference between them would be a difference nobody intended.
 */
export function sharedInjuries(injs: Injury[] = []): string {
  return sharedAreas(activeInjuries(injs));
}

/**
 * The same redaction over a list that is ALREADY active.
 *
 * The roster carries a trimmed disclosure — area, severity, note — with the
 * recovered ones kept in a separate field, so it has no `status` for
 * `activeInjuries` to filter on. Rather than let the coach screens assemble the
 * string themselves (which is how the note gets back in), the redaction is one
 * function and `sharedInjuries` delegates to it.
 */
export function sharedAreas(list: readonly { area: string; severity: string }[] = []): string {
  if (!list.length) return '';
  return list.map((i) => `${areaLabel(i.area)} (${i.severity})`).join('; ');
}

/**
 * The object that actually goes to the edge function, or null when nothing may.
 *
 * Null for 'unknown' and for 'unasked', and those are the same refusal for
 * different reasons: in one we have not read the answer, in the other there is
 * no answer. Sending on either would be sending before being allowed to, which
 * is the whole defect.
 *
 * Everything else is picked BY NAME. A key in neither list is dropped however
 * it got into the object — that is how `name` is prevented from coming back,
 * and it is the only mechanism here that survives somebody editing the screen
 * without reading this file.
 *
 * `undefined` values are dropped rather than sent as null, because the edge
 * function's prompt already has a sentence for an absent field ("unknown",
 * "n/a") and a literal null would print as one more thing the model treats as
 * data about the member.
 */
export function shareableContext(
  full: Record<string, unknown>,
  consent: ShareConsent,
): Record<string, unknown> | null {
  if (consent !== 'yes' && consent !== 'no') return null;
  const keys: readonly string[] = consent === 'yes'
    ? [...FITNESS_KEYS, ...HEALTH_KEYS]
    : FITNESS_KEYS;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = full[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * What the model is told when the member declined, so it does not fill the gap.
 *
 * A summariser handed a short list of facts and asked for warm prose will write
 * the sentence it expects to be there — "and the weight is heading the right
 * way" — from nothing at all. The unread-read lines in report.tsx already
 * proved that: the fix for a failed training read was not to send less, it was
 * to SAY, in as many words, what must not be claimed. This is the same
 * sentence for a member who withheld rather than for a read that failed.
 *
 * It does disclose one thing: that this person declined. That is a fact about a
 * choice rather than about a body, it names no measurement, and the alternative
 * is a model inventing the measurements themselves and writing them back to the
 * member in the second person as their own figures.
 */
export const FACTS_WITHHELD_LINE =
  'Their body, sleep, tape and scan figures were not shared with you. Do not mention weight, body fat, muscle, measurements, sleep, recovery or a check-in, do not guess at any of them, and do not remark on their absence.';

/**
 * The same partition as `shareableContext`, for facts written as PROSE.
 *
 * ── Why this exists at all, when there is already an allowlist ─────────────
 *
 * `shareableContext` filters a context OBJECT by key, and that is the whole of
 * the protection on app/(client)/coach.tsx because every figure that screen
 * sends is a field of that object. app/(client)/report.tsx is not shaped like
 * that and cannot be: a weekly summary is written from a list of sentences —
 * "Waist 84 cm (down 1 cm since the previous tape reading)" — and the edge
 * function's system prompt has no template for a tape reading, a check-in or a
 * body-composition movement. Those facts travel in the MESSAGE, which the
 * allowlist never sees.
 *
 * So without this function the screen would assemble one string and hand it to
 * `askCoachForMember`, whose filter would faithfully strip a context object
 * that carries nothing sensitive while the member's body composition went out
 * in the prompt underneath it. The gate has to be where the prose is built.
 *
 * ── Why two arrays rather than one and a predicate ─────────────────────────
 *
 * Same argument as the allowlist, pointed at sentences instead of keys: the
 * caller states which pile a line belongs to at the point of writing it, and
 * the next person to add a fact to this screen has to choose. The failure this
 * prevents is a health figure appended to the training list and posted to
 * api.anthropic.com for a member who answered no — and it is prevented by the
 * signature, because a screen holding two arrays cannot produce the joined
 * string without coming through here.
 *
 * Null on 'unknown' and on 'unasked', for exactly the reasons
 * `shareableContext` returns null on them: one is a read that has not landed
 * and the other is a question nobody has put, and neither is permission. A
 * caller that gets null must send NOTHING — not the training half.
 *
 * Empty strings are dropped rather than joined, because the callers build these
 * lists with conditional expressions that yield '' for a fact they do not have,
 * and a blank line in a fact list reads to a model as a fact it failed to
 * parse.
 */
export function shareableFacts(
  fitness: readonly string[],
  health: readonly string[],
  consent: ShareConsent,
): string | null {
  if (consent !== 'yes' && consent !== 'no') return null;
  const lines = [...fitness.filter(Boolean)];
  if (consent === 'yes') lines.push(...health.filter(Boolean));
  else lines.push(FACTS_WITHHELD_LINE);
  return lines.join('\n');
}

/* ── what the member is shown, in their words ─────────────────────────────── */

/**
 * The three lists, written to be read rather than to be legally sufficient.
 *
 * Sentence case: these are prose, not labels. They are exported from here
 * rather than typed into the screen so that the assertion tying them to
 * FITNESS_KEYS and HEALTH_KEYS can exist — a list that drifts from what the
 * code actually sends is worse than no list, because somebody has now been told
 * something false and shown a tick box under it.
 */
// These lists describe the AI coach as a FEATURE, not one screen of it: they
// are rendered on the chat and on the Weekly Report, and both ask the same
// model through the same edge function. So each line says the most that can go
// from anywhere, not the least that goes from wherever the member happens to be
// standing. A per-screen list would be shorter and would be the wrong shape of
// true — somebody who read it on the chat and agreed there has agreed for the
// report as well, and must have been told what that covers.
export const ALWAYS_SENT: string[] = [
  'what you type in the coach chat, and the replies so far',
  'your goal, your diet style and how many meals a day you eat',
  'your daily calorie and macro targets, and what you have eaten today',
  'the program you are on and what it focuses on',
  'whether anyone is coaching you, and whether they are in the room',
  'your training streak, what you trained last, and what to lift next',
  'the week your report covers, and the sessions, days and volume in it',
];

export const SENT_WITH_PERMISSION: string[] = [
  'your weight, body fat and skeletal muscle',
  'your sleep — the hours, how many nights, and how many a device measured',
  'your readiness score and what it could not see',
  'your injuries, as the area and how bad it is',
  'the focus areas read off your progress photos',
  'your tape measurements, and how they have changed',
  'your check-in answers — energy, sleep, mood and how well you stuck to it',
  'what your body scans show moving, and what they show worth watching',
];

export const NEVER_SENT: string[] = [
  'your name, your email or anything else that says who you are',
  'the words of an injury note, or anything from a document you uploaded',
  'your photos, your documents and your messages with your coach',
];

/** Where it goes. Named plainly: "a language model" is a category, and the
 *  member is entitled to know it is a third party and which one. */
export const WHERE_IT_GOES =
  'It is sent to Anthropic’s Claude, through this app’s own server, so that it can answer you. It is not used to train a model and it is not sent to your gym.';

export const CONSENT_TITLE = 'Before your coach can use your numbers';

export const CONSENT_BODY =
  'The AI coach answers better when it knows your body, your sleep and your injuries. That is health information, so it does not go anywhere until you say it can. You can change this at any time, and either answer lets you use the coach.';

/**
 * What the coach loses when the answer is no. Specific, and not softened.
 *
 * "Some answers may be less personalised" is the sentence that gets written
 * here by default and it is not true enough to be useful. The one consequence
 * that matters is the injury one, because a coach that cannot see an injury
 * does not train around it, and the member needs to know that before choosing.
 */
export const WITHHELD_NOTE =
  'Your coach will not know your weight, your body fat, your sleep or your recovery, so it cannot tell you to train lighter on a bad night or judge whether your targets still fit you. It will not know about your injuries either, so it may suggest a movement that loads one — check anything it gives you against your own limitations, or turn this back on.';

/** The same disclaimer the Injuries and Injury Document screens carry, in the
 *  same words, on the screen that actually sends the injuries somewhere. */
export const NOT_MEDICAL_ADVICE =
  'For pain, a new injury, or a diagnosis, see a doctor or physio before training.';

/* ══════════════════════════════════════════════════════════════════════════
 * THE COACH'S SIDE OF THE SAME DOOR
 *
 * Everything above is about a MEMBER asking about themselves. This half is
 * about a COACH asking about somebody else, and it is the same defect wearing
 * a different hat — with one difference that makes it worse rather than
 * better.
 *
 * ── What was already going out ────────────────────────────────────────────
 *
 * Two coach screens call `askCoach`, the unfiltered door, and both of them
 * name the client:
 *
 *   app/(trainer)/dashboard.tsx · draftNudge   { name, goal, adherence, reason }
 *   app/(trainer)/dashboard.tsx · genSummary   { name, goal, adherence,
 *                                                recentMeals, composition }
 *
 * `composition` is `visceralFat`, `inbodyScore`, `leanMassKg`, `fatMassKg` and
 * a left/right limb imbalance — a body-composition scan — and `recentMeals` is
 * a list of what a named person ate. Nothing on either screen said any of this
 * was leaving the phone. The member answered a consent question about their own
 * coach chat, on their own device, and it has never governed this path.
 *
 * ── The difference, and why it decides the design ─────────────────────────
 *
 * On the member's side there is somebody in the room who can answer. Here there
 * is not. The coach can consent to sending THEIR OWN figures — their takings,
 * their session count, how many clients are drifting — because those are facts
 * about the coach. They cannot consent on behalf of the person the question is
 * about, and `COACH_SHARE_KEY` lives in that person's AsyncStorage on that
 * person's handset, which this app cannot read from here.
 *
 * So the coach's ask carries the FITNESS tier about a client and never the
 * health tier. Not because health data is categorically unsendable — the member
 * can send their own, and does — but because the only person entitled to answer
 * is not being asked. If the answer is ever moved to a column both sides can
 * read, `clientAskContext` gains a consent parameter and `COACH_CLIENT_HEALTH`
 * below becomes reachable; until then it is documented and unused, which is a
 * better record of the decision than an absent list.
 *
 * ── And the name does not go at all, in any state ─────────────────────────
 *
 * Same argument as `name` above, and it survives the strongest objection to it:
 * "but the reply has to greet them". It does not. The reply comes back with the
 * literal placeholder `{name}` in it and the SCREEN substitutes — the coach is
 * looking at their own client list and knows perfectly well who they asked
 * about. `fillName` is that substitution and it is the same one the message
 * templates use, so there is one placeholder convention in the coach app rather
 * than two.
 *
 * The injury NOTE does not go either, by the same rule and for the stronger
 * reason: `candidateNote` seeds it with the line off the member's uploaded
 * document, and src/ui/injuryDocs.ts states the rule — the coach sees the
 * extracted injury, never the document. A coach forwarding that to a model is
 * the document leaving by a second door.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The coach's own business figures. No person is named by any of them.
 *
 * An allowlist even though every one of these is the coach's own data about
 * themselves, for the reason the header of this file gives about denylists: the
 * next field somebody adds to an analytics digest will be a list of client
 * names, and the default for a field nobody has thought about has to be "not
 * sent".
 *
 * `currency` is in, and it matters: the digest prompt tells the model which ISO
 * code the amounts are in so it does not write dollars at a coach in Dubai.
 * Amounts with no currency are passed as the string the screen composes
 * ("unknown — the gym has not set one"), never as a bare number.
 */
export const COACH_BUSINESS_KEYS = [
  'sessionsDeliveredThisMonth', 'revenueAtOwnRate', 'currency',
  'clients', 'avgAdherence', 'atRiskClients', 'onTrack', 'watch', 'atRiskLow',
  'newClientsThisMonth', 'endedThisMonth', 'unreadThreads',
] as const;

/**
 * What may travel about ONE client, with nothing on it that says who.
 *
 * Every one of these is a training fact the coach was given in order to coach:
 * what they are working towards, how they are delivered, whether they are
 * turning up, what they are on and what is next. The list is deliberately the
 * coach-side echo of `FITNESS_KEYS` rather than a second vocabulary — a coach
 * and a member asking the same question about the same training should be
 * sending the same shape.
 *
 * `injuryAreas` is here and is the redacted form: `sharedInjuries` output, area
 * and severity, no note, ever. It is in the fitness tier rather than the health
 * one because a coach asking "what should they train next" and getting an
 * answer that loads an injured knee is the failure this whole feature would be
 * judged on — and the AREA is what stops it. The note adds nothing to that
 * decision and is the part that came off a medical document.
 */
export const COACH_CLIENT_KEYS = [
  'goal', 'coachedMode', 'adherence', 'lastActive', 'joinedMonthsAgo',
  'programTitle', 'programFocus', 'nextLift', 'lastTrained', 'streak',
  'sessionsLast30', 'unread', 'injuryAreas', 'reason',
  'kcal', 'protein', 'carbs', 'fat', 'eatenToday', 'mealsLoggedCount', 'diet',
] as const;

/**
 * The health tier for a client, documented and NOT SENT.
 *
 * Exported so that the assertion tying it to `clientAskContext` can exist: the
 * test states that none of these ever survives the filter, which is a much
 * stronger statement than the absence of a list would be, and it fails the day
 * somebody adds one of them to `COACH_CLIENT_KEYS` without reading the header.
 *
 * `focusAreas` is in here rather than merely absent because it is the least
 * obvious of them: it reads as a training field and it is derived from the
 * member's progress PHOTOGRAPHS.
 */
export const COACH_CLIENT_HEALTH = [
  'weightKg', 'bodyFatPct', 'muscleKg', 'visceralFat', 'inbodyScore',
  'leanMassKg', 'fatMassKg', 'limbImbalance',
  'readiness', 'readinessGaps', 'sleep', 'focusAreas',
  'injuries', 'injuryNote', 'recentMeals',
] as const;

export type CoachBusinessKey = typeof COACH_BUSINESS_KEYS[number];
export type CoachClientKey = typeof COACH_CLIENT_KEYS[number];

/** Pick by name and drop `undefined`. The one mechanism both filters share, so
 *  there is a single place that decides what "not sent" means. */
function pick(full: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = full[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * The coach's own numbers, filtered.
 *
 * Never null: there is no consent question here, because the subject and the
 * asker are the same person. A field not in `COACH_BUSINESS_KEYS` is dropped
 * however it got into the object.
 */
export function businessAskContext(full: Record<string, unknown>): Record<string, unknown> {
  return pick(full, COACH_BUSINESS_KEYS);
}

/**
 * One client, filtered, with no identity on it.
 *
 * The returned object is what a coach may ask a third party about somebody else
 * without that person having been asked. It carries no name, no email, no
 * photograph, no measurement, no note and nothing off a document.
 *
 * A caller may pass the whole client record; that is the point of doing this
 * here rather than at the screen. Screens get edited by people who have not
 * read this file, and `askAboutClient` in src/lib/coach.ts cannot be called
 * without going past this function.
 */
export function clientAskContext(full: Record<string, unknown>): Record<string, unknown> {
  return pick(full, COACH_CLIENT_KEYS);
}

/**
 * The placeholder a reply refers to the client by, and how it comes back.
 *
 * One convention for the whole coach app: `{name}` is the client's first name
 * and `{coach}` is the coach's. The model is told to write the placeholder; the
 * screen substitutes before anybody reads it. The same two are what
 * src/lib/messageTemplates.ts fills, so a coach who has learned the convention
 * from a template recognises it in an AI draft.
 */
export const NAME_TOKEN = '{name}';

/**
 * Substitute the tokens, and leave an unfilled one visible.
 *
 * An unknown name yields the literal `{name}` rather than a blank or a guess —
 * a draft reading "Hey {name}" is obviously unfinished and gets fixed, and a
 * draft reading "Hey ," is sent.
 */
export function fillName(text: string, name: string | null | undefined, coach?: string | null): string {
  let out = String(text ?? '');
  const first = (name || '').trim().split(/\s+/)[0];
  if (first) out = out.split(NAME_TOKEN).join(first);
  const c = (coach || '').trim().split(/\s+/)[0];
  if (c) out = out.split('{coach}').join(c);
  return out;
}

/** What the coach is told about their assistant, on the screen. Sentence case;
 *  it is prose under a heading. */
export const COACH_ASK_WHAT_GOES =
  'Your own figures go — sessions, clients, adherence, takings and the currency they are in. When you ask about one client, what goes is their goal, how they are coached, whether they are turning up, what they are training and which areas they have flagged as injured.';

export const COACH_ASK_WHAT_NEVER_GOES =
  'No name, no email and nothing that says who anybody is. No weight, body fat, scan, sleep or recovery figure. Nothing written in an injury note or read off a document, and nothing from your messages. Replies come back saying {name} and this screen fills it in.';

export const COACH_ASK_NOT_ADVICE =
  'It answers from the figures it is given and nothing else. It has not met your clients, it cannot see their form, and it is not a substitute for asking them.';
