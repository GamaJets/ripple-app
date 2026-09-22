// Client wrapper for the coach-chat edge function (Repple's AI coach).
//
// ── What actually happens to what is passed in here ────────────────────────
//
// `supabase.functions.invoke('coach-chat', …)` posts the messages and the
// context object to the edge function in supabase/functions/coach-chat. That
// function builds a system prompt out of the context — field by field, in the
// second person — and posts it, with the message history, to
// api.anthropic.com. So every field of `context` is read by a third party, and
// this file is the door it goes through.
//
// ── one qualification, since the gateway was wired in ─────────────────────
//
// "api.anthropic.com" above is true of a deploy that has ANTHROPIC_API_KEY set
// and nothing else, which is every deploy today. src/lib/llmGateway.ts adds a
// second possible destination, reached by setting CHEAPER_INFERENCE_API_KEY,
// and the sentence stops being true the moment somebody does. The copy in this
// file names ONE company, so that secret must not be set until this file has
// been rewritten to name whichever company is actually receiving the data.
//
// Two doors, in fact, and the difference is who the data is about:
//
//   askCoachForMember   the member's own AI Coach chat. The member is the
//                       subject, they are the one at risk, and the health half
//                       of the context does not go until they have said it may.
//                       See src/lib/coachShare.ts for the whole argument.
//   askAboutMyWeek      the Weekly Report's summary paragraph. Same subject and
//                       the same gate; it takes fact LINES rather than a
//                       context object because that screen's sensitive half is
//                       prose in the message. It used to be an `askCoach` call
//                       carrying `{ week, name }` and the whole fact list, with
//                       no consent question anywhere on the screen.
//   askAboutMyBusiness  the coach's own aggregate question. Filtered here.
//   askAboutClient      the coach's question about one client. Filtered here.
//
// There is no unfiltered door. There WAS — `askCoach`, taking a free-form
// context object and no consent argument — and it was kept "for its remaining
// callers" long after it had none: app/(trainer)/dashboard.tsx and
// analytics.tsx moved to the two filtered doors above and name the old one
// only to say they are not it. An exported function that reaches
// api.anthropic.com with anything a caller hands it, sitting under a comment
// saying consent is handled on that path, is a fourth caller waiting to be
// added in good faith. It is deleted. Anything new goes through a door that
// takes a consent answer or a filter, and adding one back means writing the
// filter first.
import { supabase } from './supabase';
import { visionAvailable } from './vision';
import { shareableContext, weeklyFacts, businessAskContext, clientAskContext, type ShareConsent } from './coachShare';

export type ChatMsg = { role: 'user' | 'assistant'; content: string };

/**
 * What came back, and why not when nothing did.
 *
 * Three failures rather than one null, because the screen has a different
 * sentence for each and a single null makes them indistinguishable: a member
 * who has not been asked for consent yet would otherwise be told the coach
 * service was having a moment, which is both false and unactionable.
 *
 * 'no-consent' should never reach a member — the screen does not offer a
 * composer until the question is answered — and it exists precisely because
 * "should never" is not a mechanism.
 */
export type CoachAnswer =
  | { ok: true; reply: string }
  | { ok: false; reason: 'no-consent' | 'unavailable' | 'failed' };

/** AI features are on once the vision flag is set (same backend).
 *
 *  Delegated to `visionAvailable` rather than re-reading the environment here,
 *  because two copies of the condition is how the photograph path came to be
 *  open on builds where this one was off. One answer. */
export function coachAvailable(): boolean {
  return visionAvailable();
}

/** The transport, and nothing else. Both doors below go through it so there is
 *  one place that knows how the edge function is called and what a malformed
 *  reply looks like. */
async function invoke(messages: ChatMsg[], context: Record<string, unknown>): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('coach-chat', { body: { messages, context } });
    if (error || !data || (data as any).error) return null;
    const reply = (data as any).reply;
    return typeof reply === 'string' && reply ? reply : null;
  } catch {
    return null;
  }
}

/**
 * Ask the coach on the member's own behalf, with the member's own answer in
 * hand.
 *
 * `consent` is REQUIRED and has no default. A default would be a decision about
 * somebody's medical data made by a function signature, which is the kind of
 * decision this whole change exists to move to the person it is about.
 *
 * `context` is the FULL object the screen assembled. It is filtered here, by
 * allowlist, and only the filtered copy is sent — so the caller never has to
 * remember to strip anything, and a field added to the screen's object without
 * being added to coachShare.ts is simply not transmitted. That is the point of
 * doing it at this end rather than at the screen's: screens get edited by
 * people who have not read coachShare.ts, and this function cannot be called
 * without going past it.
 */
export async function askCoachForMember(
  messages: ChatMsg[],
  context: Record<string, unknown>,
  consent: ShareConsent,
): Promise<CoachAnswer> {
  const body = shareableContext(context, consent);
  // Null means the member has not answered, or this process has not yet read
  // their answer. Neither is permission, and telling those two apart is the
  // screen's business rather than this function's.
  if (!body) return { ok: false, reason: 'no-consent' };
  if (!coachAvailable()) return { ok: false, reason: 'unavailable' };
  const reply = await invoke(messages, body);
  return reply == null ? { ok: false, reason: 'failed' } : { ok: true, reply };
}

/** The instruction the weekly summary is written under. Here rather than in the
 *  screen so that what is asked of a third party about a member is in the file
 *  that owns what reaches one. */
export const WEEKLY_SUMMARY_PROMPT =
  'Write a warm, concise 2-3 sentence weekly summary for this person from the facts below. '
  + 'Speak directly to them ("you"), name the biggest win and one focus for next week. '
  + 'No preamble, no lists. Do not invent anything the facts do not state.';

/**
 * The Weekly Report's summary paragraph.
 *
 * `consent` is REQUIRED and has no default, for the reason `askCoachForMember`
 * gives: a default would be a decision about somebody's medical data taken by a
 * function signature.
 *
 * NO NAME, and no context object at all. app/(client)/coach.tsx removed `name`
 * from its payload because "the model was told 'Name: Sarah Whitfield' and then
 * handed her weight, her body fat, her sleep"; the Weekly Report was passing it
 * as the second field of `{ week, name }` while posting the same figures. The
 * week's date range travels as a fact line instead, where it belongs and where
 * it identifies nobody.
 *
 * The two fact lists are kept apart by the CALLER and merged here, so a line
 * added to the health list cannot reach the model without going past
 * `weeklyFacts` — the same reason the context filter lives at this end rather
 * than at the screen's.
 */
export async function askAboutMyWeek(
  facts: { fitness: readonly string[]; health: readonly string[] },
  consent: ShareConsent,
): Promise<CoachAnswer> {
  const lines = weeklyFacts(facts.fitness, facts.health, consent);
  // Null means the member has not answered, or this process has not read their
  // answer yet. Neither is permission.
  if (!lines) return { ok: false, reason: 'no-consent' };
  if (!coachAvailable()) return { ok: false, reason: 'unavailable' };
  // A summary written from nothing would be invented, so it is not asked for.
  if (!lines.length) return { ok: false, reason: 'failed' };
  const reply = await invoke(
    [{ role: 'user', content: `${WEEKLY_SUMMARY_PROMPT}\n\n${lines.join('\n')}` }],
    {},
  );
  return reply == null ? { ok: false, reason: 'failed' } : { ok: true, reply };
}

/* ── the coach's own doors ─────────────────────────────────────────────────
 *
 * There used to be an unfiltered call here, and coach screens used it. That
 * was defensible for the digest, which is aggregate, and it was never
 * defensible for the two that pass a client: `draftNudge` and `genSummary` in
 * app/(trainer)/dashboard.tsx posted a named person's adherence, their
 * body-composition scan and a list of what they have eaten to
 * api.anthropic.com. The member consented to their COACH seeing all of that.
 * Nobody asked them about a model, and nobody in the room can answer for them.
 *
 * So the two functions below are the coach's versions of `askCoachForMember`,
 * and they exist for the same reason it does: the filter is applied HERE, so a
 * screen cannot skip it and a field added to a context object without anybody
 * reading src/lib/coachShare.ts is simply not transmitted.
 *
 * The unfiltered door is gone rather than deprecated. A deprecated export is
 * still an export, and this one had three comments around the tree telling the
 * next reader its callers were fine.
 */

/**
 * A question about the coach's own business.
 *
 * Nothing here names a person, and the filter is what keeps it that way when
 * somebody adds `atRiskNames` to the digest context six months from now.
 */
export async function askAboutMyBusiness(messages: ChatMsg[], context: Record<string, unknown>): Promise<CoachAnswer> {
  if (!coachAvailable()) return { ok: false, reason: 'unavailable' };
  const reply = await invoke(messages, businessAskContext(context));
  return reply == null ? { ok: false, reason: 'failed' } : { ok: true, reply };
}

/**
 * A question about one client.
 *
 * The context that goes carries no name, no measurement and nothing off a
 * document — see the second half of src/lib/coachShare.ts for the whole
 * argument, including why there is no consent parameter here and what would
 * have to change for one to exist.
 *
 * The reply comes back with `{name}` where the client's first name belongs and
 * the CALLER substitutes, with `fillName`. That is not a nicety: it is what
 * makes "the name never goes" survive contact with a feature whose whole output
 * is a message addressed to somebody.
 */
export async function askAboutClient(messages: ChatMsg[], context: Record<string, unknown>): Promise<CoachAnswer> {
  if (!coachAvailable()) return { ok: false, reason: 'unavailable' };
  const reply = await invoke(messages, clientAskContext(context));
  return reply == null ? { ok: false, reason: 'failed' } : { ok: true, reply };
}
