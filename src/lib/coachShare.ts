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
  const act = activeInjuries(injs);
  if (!act.length) return '';
  return act.map((i) => `${areaLabel(i.area)} (${i.severity})`).join('; ');
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
export const ALWAYS_SENT: string[] = [
  'what you type, and the replies so far in this conversation',
  'your goal, your diet style and how many meals a day you eat',
  'your daily calorie and macro targets, and what you have eaten today',
  'the program you are on and what it focuses on',
  'whether anyone is coaching you, and whether they are in the room',
  'your training streak, what you trained last, and what to lift next',
];

export const SENT_WITH_PERMISSION: string[] = [
  'your weight, body fat and skeletal muscle',
  'your sleep — the hours, how many nights, and how many a device measured',
  'your readiness score and what it could not see',
  'your injuries, as the area and how bad it is',
  'the focus areas read off your progress photos',
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
