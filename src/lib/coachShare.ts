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
// An injury note can contain the words off a member's medical document, and for
// a long time it did so BY DEFAULT: `candidateNote` in src/lib/injuryExtract.ts
// seeded a proposed injury's note with `c.evidence`, the line lifted off the
// document, so a member who photographed a physiotherapy report, tapped Add
// This and never touched the field had the report's own words stored in
// `clients.injuries[].note`. That default is gone — `candidateNote` returns ''
// and argues at length why — but the FIELD has not changed: the evidence is
// still printed above it on app/(client)/injury-doc.tsx, because the member is
// being asked to agree with a reading of their own document and must see the
// reading, and copying any of it across is one gesture away.
//
// So a note is still the one part of an injury that may carry a clinician's
// sentence, and it is now there because the member PUT it there — for their
// coach, who they chose. Posting it to a language model is still the same
// breach of the same written rule, and src/ui/injuryDocs.ts states it: the
// coach sees the extracted injury, never the document. The note not going is
// not contingent on what `candidateNote` happens to return this month.
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

/**
 * What never reaches the model, and the scope of that word.
 *
 * "Never sent" here means never sent TO THE AI COACH, which is what this whole
 * module is about and what the screen printing this list is asking permission
 * for. It is true: `shareableContext` builds from the allowlists above and no
 * branch of it can reach a document, a photograph or a printout.
 *
 * It is NOT a claim about the app as a whole, and for a while the app made it
 * read like one. There are four other doors, each with a different recipient, a
 * different purpose and therefore a question of its own — and every one of them
 * had none until somebody went looking:
 *
 *   an uploaded injury document  → OCR.space   src/lib/injuryDocConsent.ts
 *   a photo of a gym machine     → Anthropic   src/lib/photoAI.ts
 *   a photo of a meal            → Anthropic   src/lib/photoAI.ts
 *   a body-composition printout  → both        src/lib/scanSheetConsent.ts
 *
 * Until each had a consent question of its own, a member could reasonably have
 * taken this line as covering it. They all have one now, asked before anything
 * leaves. None of those answers is this one and this one is none of theirs.
 *
 * The wording stays as it is because it is accurate about the thing it is
 * printed under. Anything added here must be true of THIS destination and must
 * not be worded so that it sounds like a promise about every destination.
 */
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

/* ── the Weekly Report's half of the same door ─────────────────────────────
 *
 * app/(client)/report.tsx posted the week's fact list to the model with
 * `{ week: range, name: c.name }` beside it and no consent question anywhere on
 * the screen. It was a step WORSE than the coach screen had been: the name had
 * already been taken out of the AI Coach payload, precisely because "the model
 * was told 'Name: Sarah Whitfield' and then handed her weight, her body fat,
 * her sleep", and this call put it back as the second field.
 *
 * The allowlist above cannot reach it, because the sensitive half of that
 * screen is not a context object — it is prose, in the message itself: "Weight
 * 82.4 kg (down 1.2 kg overall), body fat 19%, muscle 34.1 kg." So the
 * partition for this screen is over the FACT LINES, and the screen hands them
 * over already sorted into the two piles.
 *
 * Same shape as `shareableContext` and the same refusals: null on 'unknown' and
 * on 'unasked', because in one we have not read the answer and in the other
 * there is no answer, and sending on either is sending before being allowed to.
 */

/**
 * The fact lines a weekly summary may be written from.
 *
 * Null when nothing may be sent at all. `fitness` is the training half —
 * counts, volume, streak — and `health` is everything measured about the
 * member's body: weight, body fat, muscle, girths, sleep, recovery.
 *
 * Blank lines are dropped here rather than by the caller. The screen builds its
 * list with `cond ? line : ''` throughout, and an empty string reaching the
 * model as a fact line is a blank fact.
 */
export function weeklyFacts(
  fitness: readonly string[],
  health: readonly string[],
  consent: ShareConsent,
): string[] | null {
  if (consent !== 'yes' && consent !== 'no') return null;
  const lines = consent === 'yes' ? [...fitness, ...health] : [...fitness];
  return lines.map((l) => String(l ?? '').trim()).filter(Boolean);
}

/** What the member is told the weekly summary loses when the answer is no.
 *  Specific, like `WITHHELD_NOTE`: the report is still written, from the
 *  training half, and saying so is the difference between a feature that is off
 *  and a feature that appears broken. */
export const REPORT_WITHHELD_NOTE =
  'Your summary is written from your training only. It will not mention your weight, your body fat, your muscle, your measurements or your check-ins, because those are not being sent. Every figure on this screen is still yours to read.';

/** The heading over the consent question on the Weekly Report. Its own sentence
 *  rather than `CONSENT_TITLE`, because that one is about a conversation and
 *  this screen has none — somebody opened it to read a summary. */
export const REPORT_CONSENT_TITLE = 'Before we write your summary';

export const REPORT_CONSENT_BODY =
  'The paragraph at the top of this report is written by a language model from the figures below it. Your body measurements, your sleep and your check-ins are health information, so they do not go anywhere until you say they can. Either answer still gets you a summary, and every figure on this screen is yours to read whatever you choose.';

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
 * Two places on app/(trainer)/dashboard.tsx CALLED `askCoach` — the unfiltered
 * door, which took a free-form context object and no consent argument — and
 * both of them named the client:
 *
 *   draftNudge   { name, goal, adherence, reason }
 *   genSummary   { name, goal, adherence, recentMeals, composition }
 *
 * `composition` was `visceralFat`, `inbodyScore`, `leanMassKg`, `fatMassKg` and
 * a left/right limb imbalance — a body-composition scan — and `recentMeals` was
 * a list of what a named person ate. Nothing on either screen said any of this
 * was leaving the phone. The member answered a consent question about their own
 * coach chat, on their own device, and it never governed this path.
 *
 * `askCoach` NO LONGER EXISTS. It was deleted rather than left in place for
 * some future caller, and src/lib/coach.ts says why at length: a door with no
 * filter and no consent parameter, kept "for its remaining callers", is a
 * fourth caller waiting to be written. Both call sites now go through
 * `askAboutClient`, which cannot be reached except through `clientAskContext`
 * below — so the name, the composition and the meal list are dropped by an
 * allowlist rather than by whoever last edited the screen.
 *
 * The rest of this half is therefore a description of the RULE, not of a
 * defect still standing. It is kept because the rule is the thing that is easy
 * to undo, and the argument for it is the only reason not to.
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
 * below becomes reachable; until then it is NEVER SENT and exists only to be
 * asserted against, which is a better record of the decision than an absent
 * list. src/lib/coachAsk.test.ts states that every key in it survives no filter
 * — a much stronger claim than silence, and one that fails the day somebody
 * adds one of them to `COACH_CLIENT_KEYS` without reading this header.
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
 * reason: a note may carry the line off the member's uploaded document — no
 * longer as a default, since `candidateNote` returns '', but because the
 * evidence is shown beside the field and copying it across is one gesture — and
 * src/ui/injuryDocs.ts states the rule, that the coach sees the extracted
 * injury and never the document. A coach forwarding that to a model is the
 * document leaving by a second door.
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
 *
 * ── Three fields the prompt was written around and never received ─────────
 *
 * An allowlist has one failure mode and this was it: the Monday digest on
 * app/(trainer)/analytics.tsx composed `takenThisMonth`, `sessionsStillUnmarked`
 * and `howTheyCoach`, wrote three sentences of prompt rules about them, and
 * none of the three was declared here — so `businessAskContext` dropped all
 * three on the way out and the model was asked to quote a figure it had never
 * been given.
 *
 * That is not a harmless omission in either direction. The rule about
 * `sessionsStillUnmarked` exists so a coach with nine unrecorded sessions is
 * not congratulated on a quiet month; with the field gone the rule could never
 * fire. The rule about `howTheyCoach` says not to suggest anything needing a
 * room to a coach who works entirely online; same. And the digest was told to
 * lead on takings for an online coach while the takings were not in the object.
 * A model given a rule about an absent field does not decline — it writes
 * around the gap, in prose, where no formatter and no dash can catch it.
 *
 * All three are facts about the coach's own business and none of them names,
 * counts or characterises any individual client:
 *
 *   takenThisMonth        a formatted amount in the coach's own currency, or
 *                         the LEDGER'S OWN reason there is no figure —
 *                         `ledger()` composes that sentence out of strand
 *                         labels ("sales", "renewals"), never out of a payer.
 *   sessionsStillUnmarked a count of the coach's own hours.
 *   howTheyCoach          'entirely online' or 'in person, or both in person
 *                         and remotely'. The coach's delivery model, off their
 *                         own settings.
 *
 * The two clients-shaped counts already here — `clients`, `atRiskClients` — are
 * the precedent and the boundary: a count of people is the coach's business, a
 * list of them is not, and `COACH_CLIENT_HEALTH` is asserted against this list
 * so nothing about one person can be added to it by accident.
 */
export const COACH_BUSINESS_KEYS = [
  'sessionsDeliveredThisMonth', 'sessionsStillUnmarked', 'revenueAtOwnRate',
  'takenThisMonth', 'currency',
  'clients', 'avgAdherence', 'atRiskClients', 'onTrack', 'watch', 'atRiskLow',
  'newClientsThisMonth', 'endedThisMonth', 'unreadThreads', 'howTheyCoach',
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
