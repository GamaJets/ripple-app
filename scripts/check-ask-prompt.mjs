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
//
// ── PART TWO lives at the bottom of this file ─────────────────────────────
//
// Everything above is about the VOCABULARY: does the prompt read the fields the
// app sends. Part two is about the VALUES the app puts in those fields, and it
// is here rather than in a script of its own because it is the same object,
// read at the other end of the same wire. Its own header starts at
// "── PART TWO ──" below, and PART THREE after it does the same for the fact
// LINES the member's weekly report posts instead of an object.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

/* ══════════════════════════════════════════════════════════════════════════
 *
 * ── PART TWO — an absence, handed to a model as a figure ──────────────────
 *
 * ── the defect, found twice, by two lanes that were not looking for it ────
 *
 * A number put into a prompt object is not read the way a number on a screen
 * is read. A dash in a cell is visibly missing and a coach doubts it. The same
 * gap handed to a language model comes back as an English sentence with no gap
 * in it at all — and the coach may forward that sentence to a client.
 *
 *   1. app/(trainer)/assistant.tsx sent `atRiskClients: 0` for a coach whose
 *      whole book was hand-added. `driftSubjects` (the roster minus the
 *      hand-added clients) was EMPTY, `useClientDrift` short-circuits on
 *      `!ids.length` and returns `{}` with a clean coverage, so the coverage
 *      gate was truthy, the filter ran over nothing, and `.length` was 0.
 *      Nobody had been assessed and the model was told nobody is at risk.
 *      `onTrack`, `watch` and `atRiskLow` were three more all-clears made out
 *      of the same absence, and `avgAdherence: 'no check-ins yet'` said that
 *      about people who have no account and no check-in screen to have been
 *      silent on.
 *   2. Earlier, and in the same shape: "0 meals in the last 7 days" sent about
 *      a client with no account, under a prompt asking the model for "one
 *      concern to watch". A hand-added client's `food_logs` read is refused by
 *      RLS with no error, so the count was the refusal, written as a habit.
 *
 * Both are the house rule broken inside a prompt — an absence stated as a
 * fact — and the model's confident elaboration is what turns a 0 into advice.
 *
 * ── the shape of the fix, which is what this checks for ───────────────────
 *
 * Lane 89's repair is the model:
 *   · the field carries either the figure or the REASON there is not one, in
 *     the same field, because `COACH_BUSINESS_KEYS` is an allowlist and a
 *     companion field explaining the gap would be dropped on the way out;
 *   · that reason begins with the word `unknown`, because the system prompts
 *     on both coach screens say "where a figure is null or says 'unknown', say
 *     you were not given it" — so the word is not decoration, it is the token
 *     the instruction scans for;
 *   · an average states its denominator ("averaged over the 1 of 4 clients who
 *     have a check-in on record").
 *
 * ── WHAT THIS CANNOT SEE, said plainly ───────────────────────────────────
 *
 * Whether a 0 came from an empty set or from a real count is a RUNTIME fact.
 * This reads syntax. It cannot and does not decide that. So it does not try to
 * tell a true zero from a fabricated one, and any report that it "catches
 * invented zeroes" would be false. Specifically, it is blind to:
 *
 *   · a count whose set is emptied somewhere else — a hook that short-circuits,
 *     an RLS refusal that returns `[]`, a `.slice()` upstream. Nothing in the
 *     field's own text says so, and lane 89's bug was exactly that.
 *   · whether the emptiness test it accepts as evidence is the RIGHT test. It
 *     checks that the expression interrogates its set at all, not that it
 *     interrogates it correctly.
 *   · a prompt built as PROSE rather than as a field object was outside PART
 *     TWO entirely, and that is no longer true: PART THREE below scans the fact
 *     LINES app/(client)/report.tsx posts through `askAboutMyWeek`, with Rule A
 *     and a prose Rule C. What is still outside is every OTHER prose prompt —
 *     the discovery there starts at `askAboutMyWeek` and at nothing else.
 *   · the edge functions. supabase/functions/{nutrition-parse,vision-analyze}
 *     build their own prompts in Deno and are not scanned here.
 *   · anything more than ONE hop of `const` resolution, in the same file, and
 *     only for the names that ARE the figure (a bare value, a `.length`
 *     receiver, a whole ternary arm). A field whose gap-handling lives two names
 *     away reads to this as bare.
 *   · WHICH ARM a named unknown sits in. A field that offers one anywhere in its
 *     expression satisfies Rule A, so `whole ? 'not recorded' : 'unknown — …'`
 *     and the same two strings the wrong way round are the same text here.
 *   · a prompt object built somewhere this does not walk. Two shapes are found:
 *     a `const` handed to an ask call in app/(trainer) or app/(client), and an
 *     exported `…AskFacts` / `…AskContext` builder in src/lib that returns a
 *     literal. Anything assembled some third way is unseen, and the per-ask
 *     floors below are the only thing that would notice.
 *
 * What is left after all of that is still worth having, because it is exactly
 * the two shapes both lanes found by hand:
 *
 *   RULE A — A REASSURING ABSENCE, IN ENGLISH.  A string literal in a prompt
 *     field that begins with an absence word — "no", "none", "nothing", "not",
 *     "never", "nobody", "nil", "zero", "all clear" — and is therefore a claim
 *     about the world rather than a named unknown. "no check-ins yet" is a
 *     sentence about a person who has not failed to do anything. The repair is
 *     usually four characters of prefix and a reason: `'unknown — …'`.
 *
 *   RULE B — A COUNT WHOSE SET IS NEVER ASKED ABOUT.  A field whose expression
 *     counts with `.filter(…)` and, expanded one hop, contains no interrogation
 *     of the set it counted over: no `.length`/`.size` test, no `.some(`/
 *     `.every(`, no null test on the thing being counted, and no named unknown
 *     to fall back to. `roster.filter(f).length` is that shape.
 *     `adhKnown.length ? roster.filter(f).length : adhGap` is not, and that is
 *     lane 89's fixed line. The predicate inside the `.filter(…)` is blanked
 *     before any of this: it describes a ROW, and no question about a row can
 *     say whether there were any rows.
 *
 * Both rules run over a ratchet: every site that exists today is listed in
 * ALLOW with an assessment, and a NEW one fails. A stale ALLOW entry fails too
 * — a ratchet that is not tightened when a site is fixed stops being a ratchet
 * and becomes a list of excuses.
 *
 * ── what to do when this fails ────────────────────────────────────────────
 *
 * Do not delete the field and do not reword the phrase into something vaguer.
 * Put the unknown IN the field, beginning with the word `unknown` — or `not
 * known`, which is the spelling the member's side uses and which this accepts
 * for the reason given at NAMED_UNKNOWN_RE — and say what is missing and what
 * the model must not conclude from it:
 *
 *     atRiskClients: assessed.length ? assessed.filter(isAtRisk).length
 *       : 'unknown — none of the ' + roster.length + ' clients on this roster '
 *         + 'has a training record to judge, so nobody has been assessed',
 *
 * If the absence really is a counted fact about a set you know you read whole,
 * say so where the code is, with `// ask-ok: <reason>` on the field or the line
 * above it. A marker with no reason after the colon does not count.
 *
 * `node scripts/check-ask-prompt.mjs --list` prints every context object it
 * found, every field, and the verdict on each. That is the fastest way to see
 * what this can and cannot see before trusting it.
 * ═══════════════════════════════════════════════════════════════════════ */

const LIST = process.argv.includes('--list');

/**
 * A scratch tree to scan INSTEAD of the app, for proving that this bites.
 *
 * `--root <dir>` exists because the only honest way to know a gate works is to
 * hand it the bug and watch it fail, and the bug lives in files this lane may
 * not edit — several other lanes are in them right now. So the fixture goes in
 * a scratch directory and this points at it. It says so loudly, it does not
 * apply the per-root floors (a fixture tree has no floor to meet), and nothing
 * in package.json or check:all passes it: `check:ask-prompt` is registered with
 * no arguments, so the wired-up gate always reads the real roots.
 */
const ROOT_ARGS = process.argv.reduce((acc, a, i, all) => (a === '--root' && all[i + 1] ? [...acc, all[i + 1]] : acc), []);
if (ROOT_ARGS.length) console.log(`!! scanning ${ROOT_ARGS.join(', ')} instead of the app — this is the fixture mode, not the gate.`);

/** The calls that put an object in front of a model. `askAboutMyWeek` is in
 *  here so the discovery FLOOR notices if its shape ever becomes an object; it
 *  takes fact LINES, contributes no fields, and its two arrays are found by
 *  SHAPE THREE instead — see PART THREE. */
const ASK_FNS = ['askAboutMyBusiness', 'askAboutClient', 'askCoachForMember', 'askAboutMyWeek'];

/**
 * Where prompt context is built, and the least this may find there.
 *
 * A floor per ASK rather than one total, so that a screen moved out of one side
 * of the app cannot be paid for by a screen added to the other. These are not
 * targets: they are the count that exists today, and a drop means either a site
 * was removed (lower the floor, in the same commit, with the reason) or the
 * scanner has gone blind to a shape it used to see — which is the failure mode
 * that makes a gate worthless, and the reason `keyList` above is fatal on an
 * empty match.
 *
 * The member's ask spans two roots deliberately. It is being lifted out of the
 * screen and into a pure module as this is written — src/lib/memberAsk.ts, whose
 * header names this same defect ("the same shape as the `atRiskClients: 0` a
 * lane found on the coach side") — and a floor pinned to the screen alone would
 * have gone red on the commit that finished a repair. One ask, counted wherever
 * its object is built.
 */
const SITE_FLOOR = [
  // Six objects exist today: assistant, analytics and dashboard ×2 on the coach
  // side, coach.tsx and memberAskFacts on the member's. The floors are set at
  // the INVARIANT rather than at that count — one object per ask surface — for
  // the reason above: a lane consolidating two screens' asks into one builder is
  // doing the right thing, and a gate that goes red on a repair gets deleted.
  // The count is printed on every run, so a drop is visible without being fatal.
  { what: 'the coach asks', roots: ['app/(trainer)'], least: 3 },
  { what: 'the member ask', roots: ['app/(client)', 'src/lib'], least: 1 },
];

/** In a pure module there is no ask call to point at the object, so the name is
 *  the marker: a `…AskContext` / `…AskFacts` export that returns a literal is a
 *  prompt object by construction. `clientAskContext` in coachShare.ts is the
 *  older half of the convention; it returns a filter of somebody else's object
 *  and so contributes no fields of its own. */
const LIB_BUILDER_RE = /export function (\w*Ask(?:Context|Facts))\s*\(/g;

/** A string that opens by ruling something out. Matched on the WHOLE literal's
 *  first word, never as a substring: "no check-ins yet" is a claim, while
 *  "their food log could not be read" is a report about a read and opens with
 *  its subject. */
const ABSENCE_RE = /^\s*(no|none|nothing|not|never|nobody|nil|zero|all[- ]clear)\b/i;

/**
 * A named unknown, in either of the two spellings this repo uses.
 *
 * `unknown — …` is the coach-side one and it is not a style: both coach system
 * prompts say "where a figure is null or says 'unknown', say you were not given
 * it", so the word is the token the instruction scans for. `not known — …` is
 * the member-side spelling, where the prompt carries no scan word and instead
 * forbids inventing data outright. A field that offers either one has been
 * thought about, and Rule A leaves it alone.
 *
 * ── why this is no longer anchored to the start of the string ─────────────
 *
 * It was `/^\s*(unknown|not known)\b/`, and that anchor FAILED THE CORRECT
 * REPAIR. Lane 129's weight line is
 *
 *     Weight 82 kg (overall change not known — there is one weigh-in on record
 *     and nothing to measure a change against, so do not say their weight is
 *     steady or that it has moved)
 *
 * and the named unknown is mid-string because the FIGURE has to come first: the
 * weight is known, it is the CHANGE that is not, and a line that opens "not
 * known" would be saying the wrong thing about the wrong quantity. An anchored
 * rule reads that line as an unexcused absence — it carries `'no change'` in the
 * other arm of the same ternary — and reports a repaired site as a defect, which
 * is the one thing that gets a gate deleted.
 *
 * ── what unanchoring costs, and what is charged for it ────────────────────
 *
 * An unanchored token is easier to satisfy by accident: the word `unknown`
 * anywhere in a long sentence now excuses an absence claim anywhere else in the
 * same expression. Two narrower rules were tried against this tree before
 * settling on the plain token, and both of them failed REPAIRED code:
 *
 *   · A REASON REQUIRED after the token — `unknown — …`, `not known, …`, on
 *     the pattern of the `ask-ok:` marker below. Run against the tree it
 *     reported eight fields in src/lib/memberAsk.ts, every one of them already
 *     repaired: `mealsPerDay: \`not known — ${pGap}\`` puts the reason in an
 *     INTERPOLATION, so the literal ends at the dash; and `protein`, `carbs`
 *     and `fat` say a bare `'not known'` because the reason is written once, on
 *     `kcal`, and the four fields are read together. The dialect this repo
 *     actually writes does not put a reason in every literal, and a gate that
 *     demands one is a gate that fails the fix.
 *   · ADJACENCY — the named unknown in the SAME string literal as the absence
 *     word. It fails the weight line above for a structural reason: `'no
 *     change'` is an ARGUMENT to `deltaLabel` in the known arm and `'overall
 *     change not known — …'` is the whole of the unknown arm. They are
 *     alternatives to each other and can never be adjacent; being alternatives
 *     is the point of the repair.
 *
 * So the scope is the EXPRESSION — the strings of the one field or the one fact
 * line, never the rest of the object — and the token is a word inside a string
 * literal, so an identifier called `unknownCount` excuses nothing. What that
 * costs is stated rather than hidden: a line reading "Trained on 0 days. Their
 * sleep is not known — no watch was linked" has one honest unknown excusing one
 * dishonest zero, and this will not catch it. Rule B and Rule C are what stand
 * behind that case; a person reading the line is what stands behind the rest.
 *
 * And the older limit is unchanged: this checks the field OFFERS an unknown,
 * not that it offers it in the right arm. `whole ? 'not recorded' : 'not known
 * — …'` and the same two strings the other way round read identically here.
 */
const NAMED_UNKNOWN_RE = /\b(unknown|not known)\b/i;

/** Evidence that a counting expression asked about its own set. `.some(` and
 *  `.every(` count: they are a question put to the rows. Whether it is the
 *  RIGHT question is not knowable here — see the limits above. */
const SET_EVIDENCE_RE =
  /\.(length|size)\s*(\?|&&|\|\||===\s*0|!==\s*0|>\s*0|<\s*1|===\s*\w+\.length)|!\s*\w+(\.\w+)*\.(length|size)|\.(some|every)\s*\(|['"`](unknown|not known)/;

/**
 * A null test that is really a question about the set, and one that is not.
 *
 * `mealsThisWeek == null ? … : count` asks whether there IS a count — the read
 * answered or it did not — and that is the shape the "0 meals in the last 7
 * days" defect was repaired into. `atRisk === null ? null : atRisk.length` is
 * the same four characters doing nothing of the kind: the null means the read
 * failed, an EMPTY array passes the test intact, and `.length` is then 0. So a
 * null test counts as evidence only when the thing tested is not the same thing
 * a `.length` is taken of.
 */
function nullTestEvidence(expr) {
  // A property is not the set: `c.adherence != null` inside a predicate is a
  // question about one row, and answering it for every row still counts zero
  // rows when there are none.
  for (const m of expr.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*[!=]==?\s*null/g)) {
    if (!new RegExp('\\b' + m[2].replace(/\$/g, '\\$') + '\\s*\\.\\s*(length|size)\\b').test(expr)) return true;
  }
  return false;
}

/** The same expression with every `.filter(…)` ARGUMENT blanked. The predicate
 *  describes a row; nothing in it can say whether there were any rows, and the
 *  `!= null` guards these predicates are full of would otherwise read as a
 *  question about the set. */
function blankPredicates(expr) {
  let out = expr, i = 0;
  while ((i = out.indexOf('.filter(', i)) >= 0) {
    const open = i + '.filter'.length;
    const close = matchPair(out, open);
    if (close < 0) break;
    out = out.slice(0, open + 1) + ' '.repeat(close - open - 1) + out.slice(close);
    i = close;
  }
  return out;
}

/**
 * Every site that exists today, with what it is.
 *
 * Keyed `<path>::<field>`, reason required. This is a ratchet and not an
 * approval: most of these are live instances of the defect in files this lane
 * may not edit, and the reason field says which are which.
 */
const ALLOW = {
  // ── app/(trainer)/analytics.tsx and dashboard.tsx ──────────────────────
  // Nine entries stood here: the Monday digest's five (`avgAdherence`,
  // `onTrack`, `watch`, `atRiskLow`, `atRiskClients`) plus `takenThisMonth`,
  // and the two per-client asks' `adherence`, `injuryAreas` and
  // `programTitle`. Every one of them is repaired in the file it was filed
  // under, in lane 89's dialect: the field carries either the figure or a named
  // unknown saying why there is not one and what must not be concluded from it,
  // and the counts state their denominator. The entries are deleted rather than
  // reworded, which is the ratchet tightening — a regression on any of those
  // fields is now fatal rather than held.

  // ── app/(client)/coach.tsx — the member asking about themselves ────────
  // A different risk class, and it should be said: these are claims about the
  // member, made to the member, on a screen they are looking at. A member told
  // they have not recorded a weight can see that they have. None of them is
  // forwardable the way a coach-side sentence is.
  //
  // This file was six findings deep when this gate was written and is one now,
  // because another lane was repairing it while this was being written — and
  // then lifting the whole object into src/lib/memberAsk.ts, which is why that
  // module is scanned too. `goal`, `diet`, `weightKg`, the four macro targets,
  // `sleep`, `injuries` and `focusAreas` all carry `not known — <reason>`
  // behind a read gate as of this commit, wherever they now live. Worth writing
  // down as the counter-case: a field that offers a named unknown is the shape
  // this gate is looking for, and it found nine of them already there.
  //
  // If `readiness` follows them into that module, this entry moves with it —
  // the key is the path, and the assessment belongs beside the code it is about.
  'app/(client)/coach.tsx::readiness':
    'ASSESSED, mild. `_made.absence ?? "not enough data"` already prefers the named absence the '
    + 'readiness breakdown supplies; the literal is the last resort behind it, and the breakdown '
    + 'returns one in every state anybody has produced.',
};

/* ── the scanner ──────────────────────────────────────────────────────────
 *
 * Comments are blanked rather than removed, so every offset still points at the
 * line it came from and an `ask-ok:` marker can be found in the raw text. */
function blankComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  // Whether a `/` here opens a regex literal or is a division. Good enough for
  // this repo's `.replace(/\s+/g, ' ')`: a regex may not follow a value.
  let prev = '';
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && src[i + 1] === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    if (c === '/' && prev && !/[\w)\]'"`]/.test(prev)) {
      // regex literal: copied through, but its slashes must not be read as code
      out += c; i++;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (src[i] === '[') { while (i < n && src[i] !== ']' && src[i] !== '\n') { out += ' '; i++; } continue; }
        if (src[i] === '/') { out += c; i++; break; }
        out += ' '; i++;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { const end = endOfString(src, i); out += src.slice(i, end); i = end; prev = c; continue; }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/** Index just past the string starting at `i`. Template literals recurse
 *  through `${ … }`, which is where a naive scanner loses its place: the sleep
 *  field on the member's coach screen nests a template inside a template. */
function endOfString(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (q === '`' && c === '$' && src[i + 1] === '{') {
      i += 2;
      let d = 1;
      while (i < src.length && d > 0) {
        const k = src[i];
        if (k === "'" || k === '"' || k === '`') { i = endOfString(src, i); continue; }
        if (k === '{') d++;
        if (k === '}') d--;
        i++;
      }
      continue;
    }
    if (c === q) return i + 1;
    i++;
  }
  return i;
}

/** Index of the bracket closing the one at `open`. */
function matchPair(src, open) {
  let d = 0, i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = endOfString(src, i); continue; }
    if (c === '{' || c === '(' || c === '[') d++;
    else if (c === '}' || c === ')' || c === ']') { d--; if (d === 0) return i; }
    i++;
  }
  return -1;
}

/** Top-level commas only: an arrow predicate's own commas belong to it. */
function splitTop(body, base) {
  const parts = [];
  let d = 0, start = 0, i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') { i = endOfString(body, i); continue; }
    if (c === '{' || c === '(' || c === '[') d++;
    else if (c === '}' || c === ')' || c === ']') d--;
    else if (c === ',' && d === 0) { parts.push({ text: body.slice(start, i), at: base + start }); start = i + 1; }
    i++;
  }
  parts.push({ text: body.slice(start), at: base + start });
  return parts.filter((p) => p.text.trim());
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Every quoted string in an expression, template chunks included. */
function stringsIn(expr) {
  const found = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = endOfString(expr, i);
      if (c !== '`') found.push(expr.slice(i + 1, end - 1));
      else {
        // the literal chunks of a template, without their ${…} holes
        const inner = expr.slice(i + 1, end - 1);
        for (const chunk of inner.split(/\$\{[\s\S]*?\}/)) found.push(chunk);
        for (const s of stringsIn(inner)) found.push(s);
      }
      i = end; continue;
    }
    i++;
  }
  return found;
}

/* ══════════════════════════════════════════════════════════════════════════
 *
 * ── PART THREE — the same two defects, written as PROSE ───────────────────
 *
 * PART TWO's own limits section says this in as many words:
 *
 *     any prompt built as PROSE rather than as a field object.
 *     app/(client)/report.tsx composes fact LINES and posts them through
 *     `askAboutMyWeek`; that file gets none of this, and its lines are exactly
 *     as forwardable. A gate for it would be a different gate.
 *
 * It was not a different gate. It was this one, with two more shapes.
 *
 * ── what was unscanned, and for how long ──────────────────────────────────
 *
 * `askAboutMyWeek` was already in ASK_FNS, so the floor would have noticed if
 * its argument ever became an object — and its argument is
 *
 *     askAboutMyWeek({ fitness: fitnessFacts, health: healthFacts }, consent)
 *
 * which is an object whose VALUES are the two arrays. SHAPE ONE collects
 * identifiers that sit at the top level of the argument list, so it found
 * `consent` and nothing else; `const consent` is not an object literal, so no
 * site was recorded, and the member-facing Weekly Report — every fact line the
 * summariser is given about somebody's own week, body and check-ins — was
 * scanned by nothing at all. Lane 129 repaired that file by hand. Nothing kept
 * it repaired.
 *
 * ── the two shapes, and the hop between them ──────────────────────────────
 *
 *   · `const fitnessFacts = [ … ].filter(Boolean)` — an array literal of
 *     template expressions, each one a sentence.
 *   · `const healthFacts = reportHealthLines(healthTagged)` — the array reaches
 *     the call through a helper, so ONE hop through a single-argument call is
 *     followed, and `const healthTagged: ReportHealthFact[] = [ … ]` is the
 *     literal that gets scanned. One hop and no further: two hops is a dataflow
 *     analysis, and this is a regex with a bracket matcher.
 *
 * Each ELEMENT of such an array is one fact line, and is treated the way PART
 * TWO treats one field.
 *
 * ── RULE A, on a line rather than a field ─────────────────────────────────
 *
 * Identical in intent and one clause wider, because a line is not a field. A
 * field's whole value is its claim; a fact line is a SENTENCE that carries the
 * figure and its caveat together, and this tree's repaired lines put the
 * absence word inside a clause that is already gated on a read:
 *
 *     Waist 84 cm (no change since the previous tape reading).
 *
 * `'no change'` is an absence word by ABSENCE_RE and that line is CORRECT: it
 * is reached only when `waistDShown != null`, i.e. when two tape readings were
 * read and compared. So a line is a finding when it rules something out AND
 * offers no named unknown AND its expression never interrogates what it is
 * about — no null test, no `.length`/`.size` test, no `.some(`/`.every(`. The
 * evidence is exactly Rule B's, reused; only the subject changed.
 *
 * What that costs, plainly: a line gated on a plain boolean — `trainingWhole ?
 * 'No workouts logged this week.' : ''` — is flagged, because nothing in the
 * syntax tells this that `trainingWhole` means the log was read whole. That
 * line is honest and the marker is what it is for: `// ask-ok: <reason>`.
 *
 * ── RULE C — Rule B, interpolated ─────────────────────────────────────────
 *
 * `roster.filter(f).length` handed to a model as a FIELD is Rule B. The same
 * count interpolated into a sentence is the same defect in a different syntax,
 * and it is the shape Lane 129's kcal lines are:
 *
 *     `That kcal figure covers only ${num(kcalKnownFor)} of the
 *      ${num(weekEntries.length)} exercise(s) logged this week; the other
 *      ${num(kcalGaps)} carry no energy figure…`
 *
 * with `const kcalGaps = weekEntries.filter((e) => e.kcal == null).length`. A
 * count over a set that was never read whole is a sentence about exercises
 * nobody logged.
 *
 * What makes those lines honest is not in the line. It is a PROVENANCE line
 * standing beside them in the same array:
 *
 *     Their training log for these seven days was read in full, so the counts
 *     below are complete — a zero among them is a measured zero and not a gap.
 *
 * So Rule C fires when a fact line interpolates a figure that expands to a
 * `.filter(…)` count, its own expression carries no interrogation of the set,
 * and NO provenance line stands in the same array.
 *
 * The limits of that, said before anybody quotes the rule:
 *
 *   · it cannot tell WHICH counts a provenance line covers. One such sentence
 *     excuses every count in the array, exactly as the English does.
 *   · it cannot tell whether the provenance line and the count are gated on
 *     the SAME condition. In report.tsx they are (`trainingWhole`); a line
 *     whose provenance is gated on something else would read the same here.
 *   · it follows identifiers out of `${…}` holes one hop, which is wider than
 *     PART TWO's expansion and is why it is confined to fact-line arrays: in a
 *     sentence the interpolated names ARE the figures, which is not true of an
 *     arbitrary expression.
 * ═══════════════════════════════════════════════════════════════════════ */

/** A sentence saying the set behind the counts was read whole. Both halves are
 *  required — a line may mention a read without vouching for a count. */
const PROVENANCE_RE = /read in full/i;
const PROVENANCE_CLAIM_RE = /\b(count|counts|complete|measured zero)\b/i;

/**
 * Fact lines that state an absence as a fact today, with what each one is.
 *
 * Empty, and that is the finding: app/(client)/report.tsx was repaired by hand
 * before this could see it, and every line in both piles either names its
 * unknown or is gated on a read that landed. The key is
 * `<path>::<array>[<index>]`, which is brittle by construction — an element
 * inserted above a held line renumbers it — and that is deliberate. There is
 * nothing to hold yet, so the brittleness costs nothing, and a lane that has to
 * re-key an entry has to look at the line again, which is the only thing an
 * entry here is for.
 */
const LINE_ALLOW = {};

/** The array literal a name resolves to, through at most one wrapping call.
 *  `const x = [ … ]` directly, or `const x = helper(y)` → `const y = [ … ]`. */
function arrayLiteralFor(code, ref, depth = 0) {
  const esc = ref.replace(/\$/g, '\\$');
  const direct = code.match(new RegExp('\\bconst\\s+' + esc + '\\s*(?::[^=\\n]*)?=\\s*\\['));
  if (direct) {
    // The LAST character the match consumed, not the first `[` after the name:
    // `const healthTagged: ReportHealthFact[] = [ … ]` carries a bracket pair
    // in its TYPE, and indexOf('[') lands on that one — which matches to the
    // `]` beside it and reports an array of nothing, passing a whole pile of
    // fact lines as scanned.
    const open = direct.index + direct[0].length - 1;
    const close = matchPair(code, open);
    return close < 0 ? null : { name: ref, open, close };
  }
  if (depth > 0) return null;
  const wrapped = code.match(new RegExp('\\bconst\\s+' + esc + '\\s*(?::[^=\\n]*)?=\\s*[A-Za-z_$][\\w$]*\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*[,)]'));
  return wrapped ? arrayLiteralFor(code, wrapped[1], depth + 1) : null;
}

/** One hop to a `const` in the same file. The field scanner has its own copy of
 *  this, deliberately: they follow DIFFERENT identifiers and merging them would
 *  widen PART TWO's expansion, which is the mistake its own comment records. */
function hopIn(code, ref) {
  const d = code.match(new RegExp('\\bconst\\s+' + ref.replace(/\$/g, '\\$') + '\\s*(?::[^=\\n]*)?=\\s*([^\\n]*(?:\\n(?!\\s*(?:const|function|export|return|\\}))[^\\n]*)*)'));
  return d ? d[1] : '';
}

/**
 * The least the fact-line scan may find, at the INVARIANT.
 *
 * The member's Weekly Report posts two piles and says so in its own header —
 * the split into fitness and health is what the consent question on that screen
 * is about — so two arrays is the shape, not the count. The line floor is 10
 * against 21 found today: far below the truth, so trimming a pile cannot fail
 * a build, and far above zero, so an array literal that stops being recognised
 * cannot pass as a scan.
 */
const FACT_LINE_FLOOR = { what: 'the member weekly report', roots: ['app/(client)', 'src/lib'], leastArrays: 2, leastLines: 10 };

const lineSites = [];
const lineSeen = new Set();
const perRootLines = {};

const sites = [];
const perRoot = {};
const ROOTS = ROOT_ARGS.length ? ROOT_ARGS : [...new Set(SITE_FLOOR.flatMap((g) => g.roots))];
for (const root of ROOTS) {
  perRoot[root] = 0;
  for (const file of walk(root)) {
    const raw = readFileSync(file, 'utf8');
    const code = blankComments(raw);

    // SHAPE ONE — a screen. The identifiers actually handed to an ask call; not
    // every object literal in a screen is a prompt, and this is what makes one.
    const passed = new Set();
    for (const m of code.matchAll(new RegExp('\\b(' + ASK_FNS.join('|') + ')\\s*\\(', 'g'))) {
      const open = code.indexOf('(', m.index + m[0].length - 2);
      const close = matchPair(code, open);
      if (close < 0) continue;
      for (const id of code.slice(open, close + 1).matchAll(/(?:^|[(,]\s*)([A-Za-z_$][\w$]*)\s*(?=[,)])/g)) passed.add(id[1]);
    }
    for (const id of passed) {
      const decl = new RegExp('\\bconst\\s+' + id.replace(/\$/g, '\\$') + '\\s*(?::[^=\\n]*)?=\\s*\\{', 'g');
      for (const m of code.matchAll(decl)) {
        const open = code.indexOf('{', m.index);
        const close = matchPair(code, open);
        if (close < 0) continue;
        sites.push({ file, id, raw, code, open, close });
        perRoot[root]++;
      }
    }

    // SHAPE TWO — a pure module. The object is returned rather than passed, so
    // the export's name is what identifies it. Only the first `return {` in the
    // function: a builder with two of them is a shape nobody has written yet and
    // guessing at it would be the gate inventing its own subject.
    LIB_BUILDER_RE.lastIndex = 0;
    for (const m of code.matchAll(LIB_BUILDER_RE)) {
      const body = code.indexOf('{', code.indexOf(')', m.index));
      const bodyEnd = matchPair(code, body);
      const ret = code.indexOf('return {', body);
      if (ret < 0 || bodyEnd < 0 || ret > bodyEnd) continue;
      const open = code.indexOf('{', ret);
      const close = matchPair(code, open);
      if (close < 0) continue;
      sites.push({ file, id: m[1] + '()', raw, code, open, close });
      perRoot[root]++;
    }

    // SHAPE THREE — fact LINES rather than a field object. See PART THREE.
    for (const m of code.matchAll(/\baskAboutMyWeek\s*\(/g)) {
      const open = code.indexOf('(', m.index);
      const close = matchPair(code, open);
      if (close < 0) continue;
      // Every identifier in the call, at any depth. The array reaches the call
      // as the VALUE of a property — `{ fitness: fitnessFacts, health:
      // healthFacts }` — so the top-level-argument pattern SHAPE ONE uses finds
      // none of them, which is the whole reason this screen was unscanned.
      for (const id of new Set([...code.slice(open + 1, close).matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]))) {
        const arr = arrayLiteralFor(code, id);
        if (!arr) continue;
        const key = `${file}:${arr.open}`;
        if (lineSeen.has(key)) continue;
        lineSeen.add(key);
        lineSites.push({ file, id: arr.name, raw, code, open: arr.open, close: arr.close });
        perRootLines[root] = (perRootLines[root] ?? 0) + 1;
      }
    }
  }
}
for (const group of (ROOT_ARGS.length ? [] : SITE_FLOOR)) {
  const found = group.roots.reduce((n, r) => n + (perRoot[r] ?? 0), 0);
  ok(
    found >= group.least,
    `${group.what} still build at least ${group.least} prompt-context object(s) across ` +
    `${group.roots.join(' + ')} — found ${found}. Either one was removed, in which case lower the floor ` +
    'here in the same commit and say why, or the scanner no longer recognises the shape it is looking ' +
    'for, in which case this gate is checking nothing.',
  );
}

/* ── the fact-line scan ───────────────────────────────────────────────────── */

const lineHit = new Set();
const lineFindings = [];
let lineHeld = 0;
let linesScanned = 0;
for (const { file, id, raw, code, open, close } of lineSites) {
  const lineOf = (off) => code.slice(0, off).split('\n').length;
  const elements = splitTop(code.slice(open + 1, close), open + 1);
  if (LIST) console.log(`\n${file} :: ${id}[] (line ${lineOf(open)}) — ${elements.length} fact line(s)`);
  // The provenance sentence is a property of the ARRAY, not of one line: it is
  // written once and vouches for the counts standing under it.
  const everyString = elements.flatMap((el) => stringsIn(el.text));
  const provenance = everyString.some((s) => PROVENANCE_RE.test(s) && PROVENANCE_CLAIM_RE.test(s));
  elements.forEach((el, idx) => {
    const value = el.text.trim();
    if (!value) return;
    linesScanned++;

    // Every identifier inside a `${…}` hole, plus the two PART TWO follows.
    // In a sentence the interpolated names are the figures; `num` and `fig`
    // come along with them and hop to nothing, because they are imported.
    const sources = new Set();
    const bare = value.match(/^([A-Za-z_$][\w$]*)$/);
    if (bare) sources.add(bare[1]);
    for (const m of value.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(length|size)\b/g)) sources.add(m[1]);
    for (let i = 0; i < value.length; i++) {
      if (value[i] !== '$' || value[i + 1] !== '{') continue;
      const end = matchPair(value, i + 1);
      if (end < 0) break;
      for (const m of value.slice(i + 2, end).matchAll(/[A-Za-z_$][\w$]*/g)) sources.add(m[0]);
      i = end;
    }
    let expanded = value;
    for (const ref of sources) { const h = hopIn(code, ref); if (h) expanded += '\n/*hop*/ ' + h; }

    const startLine = lineOf(el.at + (el.text.match(/^\s*/) || [''])[0].length);
    const endLine = lineOf(el.at + el.text.length);
    const near = raw.split('\n').slice(Math.max(0, startLine - 2), endLine).join('\n');
    const marker = near.match(/ask-ok:[ \t]*(\S[^\n]*)/);

    const said = stringsIn(expanded);
    const absent = said.filter((s) => ABSENCE_RE.test(s));
    const named = NAMED_UNKNOWN_RE.test(said.join('\n'));
    const probe = blankPredicates(expanded);
    // The same evidence Rule B accepts, asked of a sentence.
    const asked = SET_EVIDENCE_RE.test(probe) || nullTestEvidence(probe);
    const ruleA = absent.length > 0 && !named && !asked;
    const ruleC = /\$\{/.test(value) && /\.filter\s*\(/.test(expanded) && !asked && !named && !provenance;
    const key = `${file}::${id}[${idx}]`;
    const why = ruleA
      ? `A — the phrase ${absent.map((s) => JSON.stringify(s.trim().slice(0, 60))).join(', ')}, in a line that names no unknown and never asks whether it could know`
      : ruleC ? 'C — a .filter() count spoken in a sentence, with nothing asked about the set and no provenance line in this array' : '';
    const preview = (said.find((s) => s.trim()) || value).trim().slice(0, 60);
    if (LIST) console.log(`   ${why ? '!' : '·'} [${idx}] ${JSON.stringify(preview)}${why ? '   ' + why : ''}${marker ? '   [ask-ok]' : ''}${key in LINE_ALLOW ? '   [allowed]' : ''}`);
    if (!why) return;
    if (marker) return;
    if (key in LINE_ALLOW) { lineHit.add(key); lineHeld++; return; }
    lineFindings.push(`${file}:${startLine}  ${id}[${idx}]  ${JSON.stringify(preview)}  RULE ${why}`);
  });
}

if (!ROOT_ARGS.length) {
  const arrays = FACT_LINE_FLOOR.roots.reduce((n, r) => n + (perRootLines[r] ?? 0), 0);
  ok(
    arrays >= FACT_LINE_FLOOR.leastArrays,
    `${FACT_LINE_FLOOR.what} still hands at least ${FACT_LINE_FLOOR.leastArrays} fact-line array(s) to ` +
    `\`askAboutMyWeek\` across ${FACT_LINE_FLOOR.roots.join(' + ')} — found ${arrays}. Either a pile was ` +
    'removed, in which case lower the floor here in the same commit and say why, or the array no longer ' +
    'resolves through the shapes arrayLiteralFor() knows — in which case the member\'s whole weekly ' +
    'report is unscanned again, which is the condition PART THREE was written to end.',
  );
  ok(
    linesScanned >= FACT_LINE_FLOOR.leastLines,
    `the fact-line arrays hold at least ${FACT_LINE_FLOOR.leastLines} lines between them — found ` +
    `${linesScanned}. An array that is found but empty is a scan of nothing wearing a pass.`,
  );
}

ok(
  lineFindings.length === 0,
  'a fact line handed to the weekly summariser states an absence as a fact:\n      ' + lineFindings.join('\n      ') +
  '\n    These are sentences, not fields: the model is given nothing else about the week, so a line ruling ' +
  'something out is the whole of what it knows, and it will elaborate on it in the second person to the ' +
  'member the line is about. Name the unknown in the line — `not known — <what is missing and what must ' +
  'not be concluded>` is the member-side spelling — or gate the clause on the read that would have ' +
  'answered it. If the absence really is something counted over a set you know you read whole, say so ' +
  'in the array the way the training pile does ("…was read in full, so the counts below are complete…"), ' +
  'or mark the line `// ask-ok: <reason>`.',
);

const lineStale = ROOT_ARGS.length ? [] : Object.keys(LINE_ALLOW).filter((k) => !lineHit.has(k));
ok(
  lineStale.length === 0,
  `LINE_ALLOW in this file still lists ${lineStale.map((k) => `\`${k}\``).join(', ')}, which no longer matches ` +
  'a live finding. Either the line was repaired — delete the entry — or it moved within its array, in ' +
  'which case re-key it, and look at the line again while you are there.',
);

const hit = new Set();
const findings = [];
let held = 0;
for (const { file, id, raw, code, open, close } of sites) {
  const lineOf = (off) => code.slice(0, off).split('\n').length;
  if (LIST) console.log(`\n${file} :: ${id} (line ${lineOf(open)})`);
  for (const field of splitTop(code.slice(open + 1, close), open + 1)) {
    const text = field.text.trim();
    const nm = text.match(/^([A-Za-z_$][\w$]*)\s*:/);
    const name = nm ? nm[1] : (text.match(/^([A-Za-z_$][\w$]*)\s*$/) || [])[1];
    if (!name) continue;
    const value = nm ? text.slice(nm[0].length).trim() : name;

    /**
     * ONE hop, same file, and only for the identifiers that ARE the figure.
     *
     * Two of them: the whole value when the field is `atRiskLow: riskCount` or
     * a shorthand, and the receiver when the field takes `something.length`.
     * Nothing else is followed. An earlier draft of this expanded every name in
     * the expression and dragged a `.filter(` in from an unrelated helper three
     * hundred lines away, which flagged a field that had already been repaired
     * — a gate that cries wolf about a fix is worse than no gate.
     */
    const hop = (ref) => {
      const d = code.match(new RegExp('\\bconst\\s+' + ref.replace(/\$/g, '\\$') + '\\s*(?::[^=\\n]*)?=\\s*([^\\n]*(?:\\n(?!\\s*(?:const|function|export|return|\\}))[^\\n]*)*)'));
      return d ? d[1] : '';
    };
    const sources = new Set();
    const bare = value.match(/^([A-Za-z_$][\w$]*)$/);
    if (bare) sources.add(bare[1]);
    for (const m of value.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(length|size)\b/g)) sources.add(m[1]);
    // And an identifier that is a whole ARM of the expression — `bWhole ?
    // 'not recorded' : bodyUnknown` in src/lib/memberAsk.ts. The gap-handling
    // that Rule A is looking for is exactly what gets lifted into a name like
    // that when two fields need to word it the same way.
    for (const m of value.matchAll(/(?:\?\?|[?:])\s*([A-Za-z_$][\w$]*)\s*(?=$|[,;)\n])/g)) sources.add(m[1]);
    let expanded = value;
    for (const ref of sources) { const h = hop(ref); if (h) expanded += '\n/*hop*/ ' + h; }

    // Past the whitespace the split left on the front, or the field's "line"
    // would be the previous field's and an `ask-ok:` marker would cover two.
    const startLine = lineOf(field.at + (field.text.match(/^\s*/) || [''])[0].length);
    const endLine = lineOf(field.at + field.text.length);
    const near = raw.split('\n').slice(Math.max(0, startLine - 2), endLine).join('\n');
    // The reason must be on the marker's OWN line: `\s*` would step over the
    // newline and read the next line of code as the reason, which is how a
    // marker with nothing after the colon passes for one that says why.
    const marker = near.match(/ask-ok:[ \t]*(\S[^\n]*)/);

    const said = stringsIn(expanded);
    const absent = said.filter((s) => ABSENCE_RE.test(s));
    // Joined, not per literal: a template that writes `unknown — ` and then
    // interpolates the reason has the token in one chunk and the reason in the
    // next, and testing each chunk alone would read that as a bare token.
    const named = NAMED_UNKNOWN_RE.test(said.join('\n'));
    const probe = blankPredicates(expanded);
    const counts = /\.filter\s*\(/.test(expanded)
      && !SET_EVIDENCE_RE.test(probe) && !nullTestEvidence(probe);
    const key = `${file}::${name}`;
    const why = absent.length && !named
      ? `A — the phrase ${absent.map((s) => JSON.stringify(s.trim().slice(0, 60))).join(', ')}`
      : counts ? 'B — a .filter() count with nothing asked about the set' : '';
    if (LIST) console.log(`   ${why ? '!' : '·'} ${name}${why ? '   ' + why : ''}${marker ? '   [ask-ok]' : ''}${key in ALLOW ? '   [allowed]' : ''}`);
    if (!why) continue;
    if (marker) continue;
    if (key in ALLOW) { hit.add(key); held++; continue; }
    findings.push(`${file}:${startLine}  \`${name}\`  RULE ${why}`);
  }
}

ok(
  findings.length === 0,
  'a prompt field states an absence as a fact:\n      ' + findings.join('\n      ') +
  '\n    If one of these is a field that MOVED, move its ALLOW entry in this file to the new path ' +
  'rather than writing a fresh one — the assessment is the point of it.' +
  '\n    A model does not doubt a figure the way a coach doubts a dash — it elaborates on it, in a ' +
  'sentence the coach may forward to a client. Put the unknown IN the field, beginning with the word ' +
  '`unknown` (both coach system prompts scan for exactly that word), and say what the model must not ' +
  'conclude from it. If the absence really is something you counted, write `// ask-ok: <reason>` on the ' +
  'field. See the header of this file for the two lanes that found this by hand.',
);

// Not in fixture mode: a scratch tree was never going to match these keys, and
// an error saying the app's sites are gone when the app was not read would be
// the gate lying about the one thing it is for.
const stale = ROOT_ARGS.length ? [] : Object.keys(ALLOW).filter((k) => !hit.has(k));
ok(
  stale.length === 0,
  `ALLOW in this file still lists ${stale.map((k) => `\`${k}\``).join(', ')}, which no longer matches a ` +
  'live finding. Either it was fixed — delete the entry, that is the ratchet tightening — or it moved, ' +
  'in which case move the entry to the path it moved to; the reason written there is worth more than ' +
  'the key it is filed under.',
);

if (errors.length) {
  for (const e of errors) console.error('  ' + e);
  console.error(`\ncheck:ask-prompt — ${errors.length} problem${errors.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(`check:ask-prompt ok — the prompt reads ${read.size} fields, every one of them sent, and every sent field spoken for.`);
console.log(
  `  and ${sites.length} prompt-context object${sites.length === 1 ? '' : 's'} scanned ` +
  `(${Object.entries(perRoot).map(([r, n]) => `${r} ${n}`).join(', ')}): ` +
  `${held} field${held === 1 ? '' : 's'} state an absence and are held at the ratchet (${hit.size} distinct), no new ones.`,
);
console.log(
  `  and ${lineSites.length} fact-line array${lineSites.length === 1 ? '' : 's'} ` +
  `(${lineSites.map((l) => `${l.file} ${l.id}`).join(', ') || 'none'}): ${linesScanned} line${linesScanned === 1 ? '' : 's'} ` +
  `scanned, ${lineHeld} held at the ratchet, no new ones.`,
);
