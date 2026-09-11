// The provider choice, the two wire formats, and the three ways a reply can be
// absent.
//
// The cases that matter most are the ones a hand-written copy in each edge
// function got wrong or would have: that the gateway is never handed Anthropic's
// /v1/messages path (it answers 200 there and drops the image), that a
// truncation is named rather than returned as an answer, and that an unset
// gateway key leaves an Anthropic deploy exactly as it was.
import {
  providerFor, modelFor, budgetFor, buildCall, readReply, stripThinking,
  replyProblem, mediaTypeOr, DEFAULT_MODELS, ENDPOINTS, REASONING_FLOOR,
} from './llmGateway';

process.exitCode = 1;
const errors: string[] = [];

const ok = (cond: boolean, what: string) => { if (!cond) errors.push(what); };
const eq = (a: unknown, b: unknown, what: string) => {
  if (a !== b) errors.push(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

/* ── which provider ─────────────────────────────────────────────────────── */

eq(providerFor('ci_live_x', 'sk-ant-x'), 'cheaper-inference', 'the gateway key wins when both are set');
eq(providerFor(null, 'sk-ant-x'), 'anthropic', 'no gateway key leaves Anthropic in place');
eq(providerFor('', 'sk-ant-x'), 'anthropic', 'an empty gateway key is not a configured gateway');
eq(providerFor(undefined, undefined), null, 'neither key configured is not a provider');
eq(providerFor('', ''), null, 'two empty strings are not a provider');

// The rollback path, stated as a test: unsetting one secret restores the
// previous provider without a deploy.
eq(providerFor(undefined, 'sk-ant-x'), 'anthropic', 'unsetting the gateway key is the rollback');

/* ── which model ────────────────────────────────────────────────────────── */

eq(modelFor('anthropic', 'text'), 'claude-sonnet-5', 'Anthropic text default is unchanged');
eq(modelFor('anthropic', 'vision'), 'claude-3-5-sonnet-latest', 'Anthropic vision default is unchanged');
eq(modelFor('cheaper-inference', 'text'), 'claude-sonnet-5', 'the gateway text default');

// Not the text default. `claude-sonnet-5` is marked vision:false in the
// gateway's own catalogue, so sharing one default across both jobs would send
// an InBody sheet to a model that cannot see it.
eq(modelFor('cheaper-inference', 'vision'), 'claude-haiku-4.5', 'the gateway vision default can actually see');
ok(DEFAULT_MODELS['cheaper-inference'].vision !== DEFAULT_MODELS['cheaper-inference'].text,
  'the gateway vision default is not the text default');

eq(modelFor('cheaper-inference', 'text', 'gpt-5.5'), 'gpt-5.5', 'an override is used');
eq(modelFor('cheaper-inference', 'text', '  '), 'claude-sonnet-5', 'a blank override is not a model name');
eq(modelFor('cheaper-inference', 'text', ''), 'claude-sonnet-5', 'an empty override is not a model name');
eq(modelFor('anthropic', 'vision', null), 'claude-3-5-sonnet-latest', 'a null override is the default');
eq(modelFor('cheaper-inference', 'vision', ' gpt-5.5 '), 'gpt-5.5', 'an override is trimmed');

/* ── the token budget ───────────────────────────────────────────────────── */
//
// A reasoning model spends max_tokens on thinking before it spends any on the
// answer. Measured on the gateway with this repo's own inbody prompt:
// gemini-3.7-flash spent 639 tokens reasoning, qwen3-6-35b-a3b spent 2510 in
// total, and vision-analyze asked for 400.

eq(budgetFor('cheaper-inference', 400), REASONING_FLOOR, 'the vision budget is lifted off 400');
eq(budgetFor('cheaper-inference', 500), REASONING_FLOOR, 'the text budget is lifted off 500');
ok(REASONING_FLOOR > 2510, 'the floor clears the largest reasoning spend measured');
eq(budgetFor('cheaper-inference', 9000), 9000, 'a caller asking for more than the floor keeps it');

// And the half that keeps an existing deploy identical.
eq(budgetFor('anthropic', 400), 400, 'Anthropic keeps the number it was given');
eq(budgetFor('anthropic', 500), 500, 'Anthropic is not lifted to the floor');

/* ── the endpoint the gateway must never be given ───────────────────────── */
//
// api.cheaperinference.com answers on /v1/messages with HTTP 200 in Anthropic's
// own shape — and drops image blocks silently while doing it. Measured with one
// solid red PNG: 95 prompt tokens and "Red" over chat/completions, 28 prompt
// tokens and "no image was attached" over messages. A vision function pointed
// there returns confident macros for a photograph nothing looked at.

ok(ENDPOINTS['cheaper-inference'].endsWith('/chat/completions'), 'the gateway gets the OpenAI-shaped path');
ok(!ENDPOINTS['cheaper-inference'].endsWith('/v1/messages'), 'the gateway never gets the Anthropic path');
ok(ENDPOINTS.anthropic.endsWith('/v1/messages'), 'Anthropic keeps its own path');

/* ── building a text call ───────────────────────────────────────────────── */

const textAsk = {
  system: 'You are a coach.',
  messages: [{ role: 'user' as const, content: 'Should I train legs?' }],
  maxTokens: 500,
  model: 'claude-sonnet-5',
};

const aText = buildCall('anthropic', 'sk-ant-x', textAsk);
const aTextBody = JSON.parse(aText.body);
eq(aText.url, ENDPOINTS.anthropic, 'Anthropic text goes to the messages endpoint');
eq(aText.headers['x-api-key'], 'sk-ant-x', 'Anthropic authenticates with x-api-key');
eq(aText.headers['anthropic-version'], '2023-06-01', 'Anthropic is sent its version header');
eq(aTextBody.system, 'You are a coach.', 'Anthropic takes the system prompt as a field');
eq(aTextBody.messages.length, 1, 'Anthropic gets one message');
eq(aTextBody.max_tokens, 500, 'Anthropic gets the budget it was asked for');

const gText = buildCall('cheaper-inference', 'ci_live_x', textAsk);
const gTextBody = JSON.parse(gText.body);
eq(gText.url, ENDPOINTS['cheaper-inference'], 'the gateway text goes to chat/completions');
eq(gText.headers.authorization, 'Bearer ci_live_x', 'the gateway authenticates with a bearer token');
eq(gText.headers['x-api-key'], undefined, 'the gateway is not sent an x-api-key header');
eq(gTextBody.system, undefined, 'the gateway takes no top-level system field');
eq(gTextBody.messages[0].role, 'system', 'the gateway takes the system prompt as a first message');
eq(gTextBody.messages[0].content, 'You are a coach.', 'and it carries the prompt');
eq(gTextBody.messages[1].content, 'Should I train legs?', 'the user turn follows it');
eq(gTextBody.max_tokens, REASONING_FLOOR, 'the gateway budget is lifted');

// A key is never in a URL, on either provider.
ok(!gText.url.includes('ci_live_x') && !aText.url.includes('sk-ant-x'), 'no key is placed in a URL');

/* ── building a vision call ─────────────────────────────────────────────── */

const visionAsk = {
  messages: [{ role: 'user' as const, content: 'Read this sheet.' }],
  image: { base64: 'QUJD', mediaType: 'image/png' },
  maxTokens: 400,
  model: 'claude-haiku-4.5',
};

const aVision = JSON.parse(buildCall('anthropic', 'sk-ant-x', visionAsk).body);
const aParts = aVision.messages[0].content;
eq(Array.isArray(aParts), true, 'Anthropic vision sends content parts');
eq(aParts[0].type, 'image', 'the image goes first, as it did before');
eq(aParts[0].source.type, 'base64', 'Anthropic takes a typed base64 source');
eq(aParts[0].source.media_type, 'image/png', 'and the media type it was given');
eq(aParts[0].source.data, 'QUJD', 'and the image data');
eq(aParts[1].text, 'Read this sheet.', 'the prompt follows the image');

const gVision = JSON.parse(buildCall('cheaper-inference', 'ci_live_x', visionAsk).body);
const gParts = gVision.messages[0].content;
eq(gParts[0].type, 'image_url', 'the gateway takes an image_url part');
eq(gParts[0].image_url.url, 'data:image/png;base64,QUJD', 'the gateway takes a data URI');
eq(gParts[1].text, 'Read this sheet.', 'the prompt follows the image');
eq(gVision.max_tokens, REASONING_FLOOR, 'the vision budget is lifted off 400');

// The image rides the LAST turn. coach-chat sends up to twelve, and an image
// attached to the first would be describing a question asked ten turns ago.
const manyTurns = buildCall('cheaper-inference', 'k', {
  messages: [
    { role: 'user' as const, content: 'first' },
    { role: 'assistant' as const, content: 'reply' },
    { role: 'user' as const, content: 'look at this' },
  ],
  image: { base64: 'QUJD', mediaType: 'image/jpeg' },
  maxTokens: 400,
  model: 'm',
});
const manyBody = JSON.parse(manyTurns.body);
eq(manyBody.messages[0].content, 'first', 'an earlier turn is left alone');
eq(Array.isArray(manyBody.messages[2].content), true, 'the image is attached to the last turn');

/* ── media types are named, not passed through ──────────────────────────── */

eq(mediaTypeOr('image/png'), 'image/png', 'a known media type is kept');
eq(mediaTypeOr('image/svg+xml'), 'image/jpeg', 'an unknown media type falls back');
eq(mediaTypeOr(undefined), 'image/jpeg', 'a missing media type falls back');
eq(mediaTypeOr(''), 'image/jpeg', 'an empty media type falls back');
eq(mediaTypeOr({ toString: () => 'image/png' }), 'image/jpeg', 'an object is not a media type');

/* ── reading a reply ────────────────────────────────────────────────────── */

const anthropicOk = { content: [{ type: 'text', text: 'Train legs.' }], stop_reason: 'end_turn' };
eq(readReply('anthropic', anthropicOk).ok, true, 'an Anthropic reply reads');
eq((readReply('anthropic', anthropicOk) as { text: string }).text, 'Train legs.', 'and carries its text');

const gatewayOk = { choices: [{ message: { content: 'Train legs.' }, finish_reason: 'stop' }] };
eq(readReply('cheaper-inference', gatewayOk).ok, true, 'a gateway reply reads');
eq((readReply('cheaper-inference', gatewayOk) as { text: string }).text, 'Train legs.', 'and carries its text');

/* ── and the three ways there is no reply ───────────────────────────────── */
//
// Both providers say "cut off" in their own vocabulary. Both mean the answer
// below is not the whole answer.

const cutG = readReply('cheaper-inference', { choices: [{ message: { content: 'Train le' }, finish_reason: 'length' }] });
eq(cutG.ok, false, 'a gateway truncation is not an answer');
eq((cutG as { why: string }).why, 'truncated', 'and it is named a truncation');

const cutA = readReply('anthropic', { content: [{ type: 'text', text: 'Train le' }], stop_reason: 'max_tokens' });
eq(cutA.ok, false, 'an Anthropic truncation is not an answer');
eq((cutA as { why: string }).why, 'truncated', 'and it is named a truncation');

// The shape that made this worth a type. A reasoning model that spent the whole
// budget thinking returns an empty string with finish_reason 'length' — which
// coach-chat used to answer with "I couldn't come up with a reply".
const spent = readReply('cheaper-inference', { choices: [{ message: { content: '' }, finish_reason: 'length' }] });
eq((spent as { why: string }).why, 'truncated', 'a budget spent on thinking is a truncation, not silence');

const emptyG = readReply('cheaper-inference', { choices: [{ message: { content: '   ' }, finish_reason: 'stop' }] });
eq((emptyG as { why: string }).why, 'empty', 'whitespace is not an answer');

eq((readReply('cheaper-inference', {}) as { why: string }).why, 'unreadable', 'a body with no choices is unreadable');
eq((readReply('cheaper-inference', null) as { why: string }).why, 'unreadable', 'a null body is unreadable');
eq((readReply('anthropic', { content: [] }) as { why: string }).why, 'unreadable', 'an empty content array is unreadable');
eq((readReply('anthropic', { content: 'text' }) as { why: string }).why, 'unreadable', 'a string content is unreadable');
eq((readReply('cheaper-inference', { choices: [{ message: { content: null }, finish_reason: 'stop' }] }) as { why: string }).why,
  'unreadable', 'a null content is unreadable');

/* ── thinking blocks ────────────────────────────────────────────────────── */
//
// gemini-3.1-pro on this gateway prints its reasoning into `content` as a
// literal <think> block ahead of the JSON, on three runs out of three. The JSON
// extraction every caller uses takes the first `{` to the last `}`, so a brace
// inside the thought swallows the answer.

eq(stripThinking('<think>a { brace }</think>{"ok":1}'), '{"ok":1}', 'a thinking block is removed');
eq(stripThinking('<think>one</think>A<think>two</think>B'), 'AB', 'every thinking block is removed');
eq(stripThinking('  plain  '), 'plain', 'a reply without one is only trimmed');
eq(stripThinking('<THINK>x</THINK>ok'), 'ok', 'the tag is matched whatever its case');

// An unterminated block is what a TRUNCATED reasoning model produces. Half a
// thought is not half an answer, so nothing survives it.
eq(stripThinking('<think>I should start by'), '', 'an unterminated thought leaves nothing');
eq(stripThinking('answer<think>then I thought'), 'answer', 'text before an unterminated thought survives');

const thought = readReply('cheaper-inference', {
  choices: [{ message: { content: '<think>The sheet says {82.4}</think>{"weightKg":82.4}' }, finish_reason: 'stop' }],
});
eq((thought as { text: string }).text, '{"weightKg":82.4}', 'the reader hands on JSON, not the thought about it');

const onlyThought = readReply('cheaper-inference', {
  choices: [{ message: { content: '<think>still thinking' }, finish_reason: 'stop' }],
});
eq((onlyThought as { why: string }).why, 'empty', 'a reply that is only an unfinished thought is empty');

/* ── what the caller says ───────────────────────────────────────────────── */

ok(replyProblem('truncated') !== replyProblem('empty'), 'the three reasons do not share one sentence');
ok(replyProblem('empty') !== replyProblem('unreadable'), 'the three reasons do not share one sentence');
ok(replyProblem('truncated').length > 0, 'a truncation has something to say');

/* ── report ─────────────────────────────────────────────────────────────── */

if (errors.length) {
  console.error(`llmGateway: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  - ${e}`);
} else {
  console.log('llmGateway: ok');
  process.exitCode = 0;
}
