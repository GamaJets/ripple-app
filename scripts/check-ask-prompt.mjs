#!/usr/bin/env node
// The system prompt must read every field the app takes the trouble to send.
//
// ── The defect this exists because of ─────────────────────────────────────
//
// `coach-chat` serves four different asks, and its system prompt was written
// for one of them:
//
//   a member asking about themselves          → FITNESS_KEYS
//   the same, after consenting                → FITNESS_KEYS + HEALTH_KEYS
//   a coach asking about one client           → COACH_CLIENT_KEYS
//   a coach asking about their own business   → COACH_BUSINESS_KEYS
//
// The prompt read only the member vocabulary, so the two coach shapes were
// dropped on the floor by the one component that had already been handed them.
// Asked "how is my month going?", the assistant answered — correctly, under its
// own "never invent data you were not given" rule — that it had not been given
// any figures. Every business field the app had just sent was in the request
// body and in none of the prompt.
//
// ── And the half that is a safety defect ──────────────────────────────────
//
// `COACH_CLIENT_KEYS` carries `injuryAreas`: the REDACTED injury, area and
// severity, never the note. src/lib/coachShare.ts argues at length for why it
// is in the fitness tier rather than the health one —
//
//     "a coach asking 'what should they train next' and getting an answer that
//      loads an injured knee is the failure this whole feature would be judged
//      on — and the AREA is what stops it."
//
// The prompt read `c.injuries`, which is on `COACH_CLIENT_HEALTH`, the list
// that is documented as never sent on a coach ask. So the model was told
// "Injuries / limitations: none disclosed" — under a rule instructing it to
// ALWAYS train around disclosed injuries — about a client whose injured knee
// the app had just described to it under a different key.
//
// The filters were right. The prompt was reading a vocabulary nobody speaks.
//
// ── What this test does, and why it reads a file ──────────────────────────
//
// It parses `c.<field>` out of the deployed Deno source, because that file
// cannot be imported here — it is Deno, and the prompt is the thing under test
// rather than a copy of it. Both directions are checked:
//
//   NO DEAD READS.     A field the prompt reads must be one that some filter
//                      sends, or it renders its fallback for ever.
//   NO DROPPED FIELDS. A field a filter sends must be read, or the app is
//                      spending a round trip and a person's data to no effect —
//                      which is exactly what happened to `injuryAreas`.
//
// The second direction has an allowlist, because a field can be sent to be
// carried rather than to be spoken about. Every entry needs a reason.
import { readFileSync } from 'node:fs';

const errors = [];
function ok(cond, what) { if (!cond) errors.push(what); }

/**
 * A `const NAME = [...] as const` list out of coachShare.ts.
 *
 * Read by regex rather than imported because this runs as plain node against a
 * TypeScript source — the same way check-sql-caps.mjs reads its constants. An
 * empty result is fatal: a renamed list must fail loudly rather than silently
 * checking nothing, which is the failure mode that makes a gate worthless.
 */
const SHARE = readFileSync('src/lib/coachShare.ts', 'utf8');
function keyList(name) {
  const m = SHARE.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  ok(!!m, `coachShare.ts still exports ${name}`);
  if (!m) return [];
  const found = [...m[1].matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)].map((x) => x[1]);
  ok(found.length > 0, `${name} is not empty`);
  return found;
}
const FITNESS_KEYS = keyList('FITNESS_KEYS');
const HEALTH_KEYS = keyList('HEALTH_KEYS');
const COACH_CLIENT_KEYS = keyList('COACH_CLIENT_KEYS');
const COACH_BUSINESS_KEYS = keyList('COACH_BUSINESS_KEYS');

const SRC = 'supabase/functions/coach-chat/index.ts';
const src = readFileSync(SRC, 'utf8');

// The prompt builder only. Reading the whole file would pick up `c.` in the
// request-parsing code and in comments quoting the old version.
const start = src.indexOf('function systemPrompt(');
ok(start >= 0, `${SRC} still declares systemPrompt()`);
const end = src.indexOf('\nDeno.serve(', start);
const body = src.slice(start, end > 0 ? end : undefined);

// Strip comments first: this file documents the fields it used to read, and a
// name in a comment is not a read.
const code = body
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const read = new Set();
for (const m of code.matchAll(/\bc\.([A-Za-z_][A-Za-z0-9_]*)/g)) read.add(m[1]);

const sent = new Set([
  ...FITNESS_KEYS, ...HEALTH_KEYS, ...COACH_CLIENT_KEYS, ...COACH_BUSINESS_KEYS,
]);

/**
 * Fields a filter sends that the prompt is not required to speak about.
 *
 * A reason, not a name, is what makes an entry legitimate — the same rule the
 * `currency-ok:` and `prose-ok:` markers hold elsewhere in this repo.
 */
const NOT_SPOKEN = {
  currency: 'the unit of the money fields, spoken as part of them rather than on its own',
  unread: 'a count of unread threads; the assistant does not read or write messages',
  unreadThreads: 'the same count on the business ask',
  reason: 'why a client left — it reaches the prompt through the ended-coaching copy, not here',
  lastActive: 'a display phrase built for a roster row, not a fact to reason from',
  joinedMonthsAgo: 'tenure; carried for the coach summary rather than for advice',
  mealsLoggedCount: 'covered by eatenToday, which says the same thing in words',
};

ok(read.size > 5, `the prompt reads more than a handful of fields (found ${read.size})`);

const dead = [...read].filter((k) => !sent.has(k));
ok(
  dead.length === 0,
  `the prompt reads ${dead.map((k) => `\`c.${k}\``).join(', ')}, which no filter in coachShare.ts sends — ` +
  'so it renders its fallback for every caller. `injuries` was one of these: it is on ' +
  'COACH_CLIENT_HEALTH, the list documented as never sent on a coach ask, while the redacted ' +
  '`injuryAreas` the app does send was read nowhere.',
);

const dropped = [...sent].filter((k) => !read.has(k) && !(k in NOT_SPOKEN));
ok(
  dropped.length === 0,
  `coachShare.ts sends ${dropped.map((k) => `\`${k}\``).join(', ')} and the prompt never reads ` +
  'it — a round trip and somebody\'s data spent to no effect. Read it, or add it to NOT_SPOKEN ' +
  'with the reason it is carried but not spoken about.',
);

// The two that matter most, named individually so a failure says which.
ok(read.has('injuryAreas'), 'the prompt reads `injuryAreas` — the redacted injury a coach ask actually carries');
ok(read.has('coachedMode'), 'the prompt reads `coachedMode` — a coach ask sends this, not `coaching`');
ok(
  read.has('sessionsDeliveredThisMonth') && read.has('revenueAtOwnRate'),
  'the prompt reads the business figures, so "how is my month going" is answerable',
);

// And the rule that makes the injury fields worth carrying at all.
ok(
  /ALWAYS train around them/.test(body),
  'the injury rule is still in the prompt — the fields above exist to feed it',
);

if (errors.length) {
  for (const e of errors) console.error('  ' + e);
  console.error(`\ncheck:ask-prompt — ${errors.length} problem${errors.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(`check:ask-prompt ok — the prompt reads ${read.size} fields, every one of them sent, and every sent field spoken for.`);
