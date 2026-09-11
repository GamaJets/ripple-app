// The one place that decides WHICH AI provider Repple spends, and in WHICH
// wire format it is spoken to.
//
// ── why this is a module and not three lines in three files ───────────────
//
// Three edge functions call a large language model, and until this file they
// each carried their own copy of the same four decisions — the URL, the auth
// header, the request shape, and how to read a reply out of the response:
//
//   coach-chat       — the in-app AI coach.
//   nutrition-parse  — "chicken burrito and a coke" into itemised macros.
//   vision-analyze   — a meal photo, a physique photo, a gym machine, and an
//                      InBody body-composition sheet, read as JSON.
//
// That is the shape `sharedSecret.ts` argues about at length: a rule written
// three times is a rule that drifts, and the copy that drifts is not reliably
// the copy that matters least. `vision-analyze` had already drifted — it pinned
// `claude-3-5-sonnet-latest` while the other two defaulted to `claude-sonnet-5`
// — and the drift was invisible because nothing compared them.
//
// ── this is a leaf, deliberately ──────────────────────────────────────────
//
// Three edge functions import this, so it may have NO relative imports of its
// own: Deno resolves a specifier literally and an extensionless one throws on
// the function's first request. See scripts/check-functions.mjs, which walks
// out of the functions into here to enforce exactly that.
//
// It also does NO I/O. It builds a request and reads a response; the `fetch` in
// between stays in the function. That is what lets the decisions below be
// asserted by src/lib/llmGateway.test.ts under plain node, which is where every
// other rule in this directory is proved.

/** The two providers this codebase can spend. */
export type Provider = 'cheaper-inference' | 'anthropic';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** A base64 image and the media type it actually is. */
export type ImagePart = { base64: string; mediaType: string };

export type Ask = {
  system?: string;
  messages: ChatMessage[];
  /** Present only on the vision path. */
  image?: ImagePart;
  maxTokens: number;
  model: string;
};

/** Everything a caller needs to make the request, and nothing it can get wrong. */
export type Call = { url: string; headers: Record<string, string>; body: string };

/**
 * A reply, or the NAMED reason there isn't one.
 *
 * Deliberately not `string | null`. The three callers used to collapse every
 * failure into one fallback — coach-chat answered "I couldn't come up with a
 * reply — try again?" to a truncation, which reads to a member as the model
 * having nothing to say when in fact the answer was cut in half and thrown
 * away. A member acting on half of a training instruction is the failure this
 * distinction exists to prevent.
 */
export type Reply =
  | { ok: true; text: string }
  | { ok: false; why: 'truncated' | 'empty' | 'unreadable' };

/* ── which provider ────────────────────────────────────────────────────── */

/**
 * Cheaper Inference when its key is set, Anthropic otherwise, and null when
 * neither is.
 *
 * The order is what makes this deployable without a flag day: an environment
 * that has only ever had ANTHROPIC_API_KEY keeps behaving exactly as it did,
 * and setting CHEAPER_INFERENCE_API_KEY is the whole of the switch. Unsetting
 * it is the whole of the rollback, which matters more — the gateway is one more
 * party between Repple and a reply, and the way back has to be a secret rather
 * than a deploy.
 */
export const providerFor = (
  gatewayKey: string | null | undefined,
  anthropicKey: string | null | undefined,
): Provider | null => {
  if (typeof gatewayKey === 'string' && gatewayKey.length > 0) return 'cheaper-inference';
  if (typeof anthropicKey === 'string' && anthropicKey.length > 0) return 'anthropic';
  return null;
};

/**
 * The default models, per provider and per job.
 *
 * ── why the gateway does not simply keep the Anthropic names ─────────────
 *
 * Because two of them are not offered there, and the failure is quiet in both
 * directions. `claude-3-5-sonnet-latest`, which vision-analyze pinned, is not
 * in the catalogue at all. `claude-sonnet-5` IS, and the catalogue marks it
 * `vision: false` — so the one model both text functions default to cannot be
 * the vision default, and pointing the InBody reader at it would produce a
 * confident answer about a photograph nothing had looked at.
 *
 * `claude-haiku-4.5` is the vision default because it was MEASURED rather than
 * assumed. Against a rendered InBody sheet, using this repo's own `inbody`
 * prompt, it returned all seventeen fields correctly on three runs out of
 * three, spending exactly 249 output tokens each time and no reasoning tokens
 * at all — the same answer, at the same price, every time. It also reads the
 * day/month date trap the prompt warns about correctly (05/07/2026 as 5 July).
 *
 * Cheaper alternatives exist and were tried. `glm-5.3-flash` also scored 17/17
 * but spent between 182 and 448 output tokens across three identical runs, and
 * routes a person's body-composition sheet to a different vendor than the rest
 * of this product does — a bigger decision than choosing a model, and not one
 * to make by default. `gemini-3.1-pro` is not usable here at all: see the note
 * on thinking blocks below.
 */
export const DEFAULT_MODELS: Record<Provider, { text: string; vision: string }> = {
  'cheaper-inference': { text: 'claude-sonnet-5', vision: 'claude-haiku-4.5' },
  anthropic: { text: 'claude-sonnet-5', vision: 'claude-3-5-sonnet-latest' },
};

/**
 * The model to ask, given an operator override.
 *
 * An override applies to whichever provider is live, because it is set as one
 * secret by somebody who knows which one they are running. A blank or unset
 * override is the default, not an empty model name.
 */
export const modelFor = (
  provider: Provider,
  job: 'text' | 'vision',
  override?: string | null,
): string => {
  const named = typeof override === 'string' ? override.trim() : '';
  return named.length > 0 ? named : DEFAULT_MODELS[provider][job];
};

/* ── how many tokens ───────────────────────────────────────────────────── */

/**
 * The floor the gateway path is given, whatever the caller asked for.
 *
 * ── the trap this exists because of ──────────────────────────────────────
 *
 * Most models the gateway offers are reasoning models, and a reasoning model
 * spends `max_tokens` on THINKING BEFORE it spends any on the answer. The
 * budget is not a length limit on the reply; it is a limit on the reply plus
 * everything the model did to get there.
 *
 * Measured, on this gateway, with this repo's own `inbody` prompt and a
 * rendered sheet: gemini-3.7-flash spent 639 tokens reasoning and 836 in total.
 * qwen3-6-35b-a3b spent 2510. `vision-analyze` asked for 400. Both would have
 * been cut off mid-JSON — and the first symptom is not an error, it is
 * `extractJson` throwing on a half-written object, or worse, a shorter object
 * that parses and is missing fields nobody notices are missing.
 *
 * The two defaults above spend NO reasoning tokens, so this floor costs a
 * default deploy nothing: max_tokens is a ceiling, not a target, and the
 * prompts are what keep the replies short. What it buys is that an operator who
 * points ANTHROPIC_MODEL at a reasoning model gets a right answer instead of a
 * quietly truncated one.
 *
 * Anthropic direct keeps exactly the number it is given. Existing deploys do
 * not change behaviour because this file was added.
 */
export const REASONING_FLOOR = 3000;

export const budgetFor = (provider: Provider, want: number): number => {
  const asked = Number.isFinite(want) && want > 0 ? Math.floor(want) : 1;
  return provider === 'cheaper-inference' ? Math.max(asked, REASONING_FLOOR) : asked;
};

/* ── building the request ──────────────────────────────────────────────── */

/**
 * Where each provider is spoken to.
 *
 * ── the gateway must NOT be given the Anthropic path ─────────────────────
 *
 * api.cheaperinference.com answers on /v1/messages, in Anthropic's own request
 * and response shape, with HTTP 200 and a well-formed body. It is a trap, and
 * the reason this constant is not configurable per function.
 *
 * Its Anthropic compatibility layer DROPS IMAGE BLOCKS SILENTLY. Measured with
 * one solid red PNG and the question "what colour is this image": over
 * /v1/chat/completions the request bills 95 prompt tokens and the answer is
 * "Red"; over /v1/messages the identical image bills 28 prompt tokens and the
 * model replies that no image was attached. Same key, same model, same picture.
 *
 * What that would have done to this product is worse than an outage. The reply
 * is a 200 holding valid JSON, so `vision-analyze` would have returned macros
 * for a meal nothing had seen and body-fat figures for a sheet nothing had
 * read, straight into a member's health record, with no error anywhere.
 *
 * So every provider gets the endpoint its images actually arrive on, and for
 * the gateway that is the OpenAI-shaped one — which is also the endpoint every
 * model in its own catalogue names.
 */
export const ENDPOINTS: Record<Provider, string> = {
  'cheaper-inference': 'https://api.cheaperinference.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
};

/** The image types the vision paths accept, and the only ones that may be sent. */
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export const mediaTypeOr = (offered: unknown, fallback = 'image/jpeg'): string =>
  typeof offered === 'string' && MEDIA_TYPES.indexOf(offered) !== -1 ? offered : fallback;

/**
 * Build the call. One shape in, one provider's shape out.
 *
 * The two wire formats differ in every part a hand-written copy would get
 * subtly wrong: the auth header, where the system prompt goes (a top-level
 * field for Anthropic, a first message for OpenAI), and how an image is
 * attached (a typed source object, versus a data URI).
 */
export const buildCall = (provider: Provider, key: string, ask: Ask): Call => {
  const maxTokens = budgetFor(provider, ask.maxTokens);
  const turns = ask.messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? ''),
  }));

  if (provider === 'anthropic') {
    const last = turns.length - 1;
    const body: Record<string, unknown> = { model: ask.model, max_tokens: maxTokens };
    if (ask.system) body.system = ask.system;
    body.messages = ask.image
      ? turns.map((t, i) => (i !== last ? t : {
          role: t.role,
          content: [
            { type: 'image', source: { type: 'base64', media_type: ask.image!.mediaType, data: ask.image!.base64 } },
            { type: 'text', text: t.content },
          ],
        }))
      : turns;
    return {
      url: ENDPOINTS.anthropic,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  const last = turns.length - 1;
  const withImage = ask.image
    ? turns.map((t, i) => (i !== last ? t : {
        role: t.role,
        content: [
          { type: 'image_url', image_url: { url: `data:${ask.image!.mediaType};base64,${ask.image!.base64}` } },
          { type: 'text', text: t.content },
        ] as unknown as string,
      }))
    : turns;
  const messages = ask.system ? [{ role: 'system', content: ask.system }, ...withImage] : withImage;
  return {
    url: ENDPOINTS['cheaper-inference'],
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: ask.model, max_tokens: maxTokens, messages }),
  };
};

/* ── reading the reply ─────────────────────────────────────────────────── */

/**
 * Remove a chain-of-thought block a model printed into its own answer.
 *
 * ── measured, not defensive ──────────────────────────────────────────────
 *
 * gemini-3.1-pro on this gateway returns its reasoning inside `content`, as a
 * literal `<think>` block ahead of the JSON, on three runs out of three. The
 * JSON extraction every caller here uses takes everything between the first `{`
 * and the last `}` — so a thinking block containing a single brace, which this
 * one does, swallows the real answer and the parse fails.
 *
 * Stripping it in one place is the point of this module. An unterminated block
 * — the shape a truncated reasoning model produces — leaves nothing behind
 * rather than leaving half a thought, so it is reported as empty by the reader
 * below instead of being handed on as an answer.
 */
export const stripThinking = (text: string): string => {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const open = out.search(/<think>/i);
  if (open !== -1) out = out.slice(0, open);
  return out.trim();
};

/**
 * Pull the reply text out of either provider's parsed response body.
 *
 * A truncation is named as one. Both providers say so in their own vocabulary —
 * `stop_reason: 'max_tokens'` and `finish_reason: 'length'` — and both are the
 * same fact: the answer below is not the whole answer, and no caller should
 * treat it as one.
 */
export const readReply = (provider: Provider, parsed: unknown): Reply => {
  const body = (parsed ?? {}) as Record<string, any>;

  let raw: unknown;
  let cut = false;
  if (provider === 'anthropic') {
    const block = Array.isArray(body.content) ? body.content[0] : undefined;
    raw = block && typeof block === 'object' ? (block as Record<string, unknown>).text : undefined;
    cut = body.stop_reason === 'max_tokens';
  } else {
    const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
    const message = choice && typeof choice === 'object' ? (choice as Record<string, any>).message : undefined;
    raw = message && typeof message === 'object' ? message.content : undefined;
    cut = Boolean(choice && (choice as Record<string, unknown>).finish_reason === 'length');
  }

  if (typeof raw !== 'string') return { ok: false, why: cut ? 'truncated' : 'unreadable' };
  const text = stripThinking(raw);
  // Order matters. A truncated reply that still carries text is a truncation,
  // not an answer — and a truncated reply that carries none is still a
  // truncation, which tells an operator to raise the budget rather than sending
  // them looking for a model that has gone quiet.
  if (cut) return { ok: false, why: 'truncated' };
  if (!text) return { ok: false, why: 'empty' };
  return { ok: true, text };
};

/**
 * What a caller says out loud when there is no reply.
 *
 * One sentence per named reason, in the app's voice, because all three callers
 * face the same three failures and previously invented their own words for a
 * subset of them.
 */
export const replyProblem = (why: 'truncated' | 'empty' | 'unreadable'): string =>
  why === 'truncated'
    ? 'The answer was cut off before it finished. Try a shorter question.'
    : why === 'empty'
      ? 'The model returned an empty answer. Try again.'
      : 'The model returned something this app could not read. Try again.';
