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
//   askCoach            the older, unfiltered call. Its remaining callers are
//                       the coach's own screens — app/(trainer)/dashboard.tsx
//                       and app/(trainer)/analytics.tsx, where the subject is a
//                       client the coach already has the record of.
import { supabase } from './supabase';
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

/** AI features are on once the vision flag is set (same backend). */
export function coachAvailable(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_VISION === '1';
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

/**
 * The unfiltered call. See the header for who still uses it and why.
 *
 * Unchanged in signature and behaviour on purpose: two coach screens outside
 * this change call it, and breaking them to make a point would be a worse
 * outcome than leaving them to their own lane. Its client-side caller —
 * app/(client)/report.tsx — is gone: it now goes through `askAboutMyWeek`.
 */
export async function askCoach(messages: ChatMsg[], context: Record<string, unknown>): Promise<string | null> {
  if (!coachAvailable()) return null;
  return invoke(messages, context);
}

/* ── the coach's own doors ─────────────────────────────────────────────────
 *
 * `askCoach` above is the unfiltered call and its remaining callers are coach
 * screens. That was defensible for the digest, which is aggregate, and it was
 * never defensible for the two that pass a client: `draftNudge` and
 * `genSummary` in app/(trainer)/dashboard.tsx post a named person's adherence,
 * their body-composition scan and a list of what they have eaten to
 * api.anthropic.com. The member consented to their COACH seeing all of that.
 * Nobody asked them about a model, and nobody in the room can answer for them.
 *
 * So the two functions below are the coach's versions of `askCoachForMember`,
 * and they exist for the same reason it does: the filter is applied HERE, so a
 * screen cannot skip it and a field added to a context object without anybody
 * reading src/lib/coachShare.ts is simply not transmitted.
 *
 * `askCoach` is deliberately left in place and unchanged. Its remaining callers
 * are two coach screens belonging to a different change; changing its signature
 * to make a point about screens it does not belong to would cost more than it
 * is worth.
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
