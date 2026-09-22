#!/usr/bin/env node
// A ceiling inside a SQL function that nothing on the client can see.
//
// ── the bug this exists for ───────────────────────────────────────────────
//
// src/lib/rowCap.ts is this codebase's answer to a silently truncated read, and
// its whole mechanism is asking for one row MORE than you are willing to accept
// — come back with cap + 1 and you know the set was bigger. That works for
// PostgREST's own 1000-row default because the client sets the limit.
//
// It does not work, at all, for a `limit` written INSIDE a `create function`
// body. The server will never answer with cap + 1 no matter what the client
// asks for, because the client's `.limit()` can only narrow what the function
// already decided. So `capped()`, `assertWhole()` and `isTruncated()` are all
// blind to it, the provider reports 'ready' over a prefix, and every screen
// downstream renders a subtotal as a total with nothing anywhere having cause
// to doubt it.
//
// `challenge_board()` (supabase/parts/128-a-cohort-and-a-credit.sql) ends
// `limit 200`, which is a deliberate product decision — a leaderboard past two
// hundred names is not a leaderboard. A gym-wide challenge with four hundred
// entrants therefore returned two hundred real rows, no error, no flag. And
// because `my_challenges()` carries the TRUE head count, one sheet said both of
// these at once:
//
//     400 athletes on this board          ← from head_count
//     You are #147 of 200                 ← counting the page
//
// A member ranked 250th — who had joined, whose score the server had computed —
// opened the board, could not find themselves, and was given no sentence saying
// why. src/lib/challenges.ts now mirrors the number as `BOARD_CAP` and its
// header argues the whole case; src/ui/coachReferrals.ts does the same for
// `coach_referrals()`.
//
// ── why a gate, and why this shape of gate ────────────────────────────────
//
// Because the two halves of that pair live in different languages, in different
// directories, under different review, and NOTHING connects them. Raise the SQL
// `limit 200` to 500 and the TypeScript constant stays at 200: every board
// between 201 and 500 entrants is then reported 'partial' when it is whole,
// which is the small wrong. Lower it, or add a NEW capped function with no
// constant at all, and the big wrong comes back — a prefix rendered as a total,
// exactly as before, with the fix still sitting in the file next door looking
// like it is doing its job.
//
// Fixing the two known pairs by hand does not stop the third. This does.
//
// ── what this checks ──────────────────────────────────────────────────────
//
// Two things, and they are two halves of one rule.
//
//   THE PAIRS — the `PAIRS` table below names, for each capped function, the
//   TypeScript constant that mirrors it. Both sides are read and the numbers
//   must agree. This is the half that catches drift: raise the SQL `limit 200`
//   to 500 and this fails by name, on the number, in both files, immediately.
//
//   THE COVERAGE — every `.rpc('name')` whose function carries a cap must be
//   covered by a pair, or carry a `sql-cap-ok:` marker saying why nothing
//   counts those rows. This is the half that catches the NEXT one: a new capped
//   RPC with no constant anywhere cannot be added quietly.
//
// The pairing is declared here rather than inferred from the calling file,
// because inference was tried first and was wrong in both directions. The
// constant does not live where the call is: `src/ui/challenges.tsx` calls
// `challenge_board()` and the number lives one module away in
// `src/lib/challenges.ts`, reached through `boardTruncated()` and never
// imported by name. And widening the search to "any constant equal to 200 in
// anything this file imports" silently passed
// app/(client)/coach-documents.tsx on an unrelated 200 in an unrelated module,
// which is a gate agreeing with itself.
//
// "Capped" means the EFFECTIVE definition contains a `limit N` with N greater
// than 1.
//
// "Effective" means the definition in the highest-numbered part, because that
// is the one the built schema ends on. It matters here and not in theory:
// `my_session_series` is defined with `limit 500` in part 135 and redefined
// with `limit 501` in part 143, and 143's own header explains that the extra
// row is a truncation probe. A gate reading the first definition would demand
// the wrong number.
//
// `limit 1` is excluded throughout. That is a single-row lookup — "the earliest
// booking", "the current secret" — not a ceiling on a set anybody counts.
//
// ── what this cannot check, said plainly ──────────────────────────────────
//
// It cannot tell whether the constant is USED — whether anything actually
// compares the row count against it and reports 'partial'. Proving that needs
// dataflow, and a gate that guessed would be wrong about honest code. What it
// guarantees is narrower and still worth having: the number cannot exist in one
// language only, and it cannot drift between the two, because the moment the
// SQL changes the constant stops matching and this fails by name.
//
// ── the escape hatch ──────────────────────────────────────────────────────
//
// A capped function whose rows nobody counts genuinely needs no constant. Say
// so on the `.rpc(` line, or in the comment run immediately above it:
//
//     // sql-cap-ok: notify_users is a dispatch, not a read — the caller sends
//     // and never counts, so a ceiling on the fan-out is not a figure anywhere
//
// The sentence is the point, as with `no-error-ok:` in check-reads.mjs. Writing
// it means saying out loud what happens to the rows past the ceiling, which is
// the question that was not asked the first time.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Everywhere an RPC is called from. */
const TS_ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/lib', 'studio-web/components'];
const PARTS = join(ROOT, 'supabase/parts');

/**
 * The declared pairs: a capped SQL function and the TypeScript constant that
 * mirrors its ceiling. Both numbers are read and must agree.
 *
 * Add an entry whenever you add a capped RPC — the coverage half of this gate
 * will ask you to. `where` is the file the constant lives in, which is the file
 * that decides what 'partial' means for that read, and is often not the file
 * making the call.
 */
const PAIRS = [
  { fn: 'challenge_board', where: 'src/lib/challenges.ts', name: 'BOARD_CAP' },
  { fn: 'coach_referrals', where: 'src/ui/coachReferrals.ts', name: 'ROW_CAP' },
  // notify_users() ends `limit 2000` and RETURNS the number of rows it wrote,
  // so past two thousand recipients its answer stops being a count and becomes a
  // floor — the owner announcing a closure to 2,400 members was told 2,000 had
  // it. NOTIFY_USERS_CAP is what `recordInbox` compares the request length
  // against to say "at least".
  { fn: 'notify_users', where: 'src/ui/pushNotifications.ts', name: 'NOTIFY_USERS_CAP' },
  // The member half of the referral feature, which never got the constant the
  // coach half has had since it was written. The two counts above the list come
  // from `my_referral_summary()` and are computed over every row, so they stay
  // exact; `invitesCutLine` is the sentence under the LIST.
  { fn: 'my_referrals', where: 'src/lib/referrals.ts', name: 'REFERRAL_ROW_CAP' },
  { fn: 'my_promo_redemptions', where: 'app/(client)/offers.tsx', name: 'REDEMPTION_ROW_CAP' },
  // Both constants live beside the code that SHAPES these rows rather than
  // beside the call, which is the arrangement this gate's header argues for.
  { fn: 'coach_document_standing', where: 'src/lib/coachDocs.ts', name: 'STANDING_ROW_CAP' },
  { fn: 'coach_document_audience', where: 'src/lib/coachDocAudience.ts', name: 'AUDIENCE_ROW_CAP' },
  // Reachable, unlike most of these: one coach's booked hours over a sixty-day
  // window, and the order is `starts_at asc`, so a cut loses the far end of the
  // calendar — the part somebody scrolls to looking for an hour to wait for.
  { fn: 'waitlistable_slots', where: 'src/ui/sessions.tsx', name: 'SLOTS_ROW_CAP' },
  // 501, not 500. Part 143 selects `SERIES_CAP + 1` so the last row is a
  // truncation probe; SERIES_LIMIT is the number the SQL ends on and SERIES_CAP
  // is derived from it, so the probe cannot go missing from one of the two.
  { fn: 'my_session_series', where: 'src/ui/availability.ts', name: 'SERIES_LIMIT' },
];

/**
 * Call sites of a capped function with no pair and no marker — real, NOT
 * silenced, and not fixed in the change that added this check.
 *
 * A ratchet, not an ignore list, on the terms `KNOWN` sets out in
 * check-dead-exports.mjs: an entry whose call site has become clean fails too,
 * asking for the line to be deleted, so the list can only shrink. Keyed by
 * `function@callsite`, because the same function called from two screens is two
 * decisions about two sentences.
 *
 * Each needs one of two edits, and which one is a judgement about the screen:
 *   · the rows are counted, summed or ranked → mirror the cap as a constant,
 *     add it to `PAIRS`, and report 'partial' at the ceiling;
 *   · nothing counts them → `// sql-cap-ok: <what happens to the rows past the
 *     ceiling, and why no sentence on the screen is wrong about it>`.
 * They were listed rather than annotated here because this gate was written in a
 * lane that does not own those files, and a gate's author quietly annotating
 * other people's code is how a rule gets weakened by the person least placed to
 * judge it.
 *
 * All eight are now cleared and the ratchet is empty. Six took the constant and
 * are in `PAIRS` above. Two took the marker, and both arguments turn on the
 * ORDER the function cuts in rather than on the size of the number:
 * `my_waitlist()` would need one person waiting on five hundred separate hours,
 * and `my_coach_documents()` sorts `required desc` before it cuts, so the one
 * figure counted over it — how many documents are waiting on the client — can
 * only lose optional rows from the bottom.
 */
const KNOWN = new Map([]);

const isTest = (f) => /\.test\.[jt]sx?$/.test(f) || f.includes('__tests__');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !isTest(p)) out.push(p);
  }
  return out;
}

/** Does a marker apply to `line` (1-based)? On the line itself, or in the
 *  unbroken run of comment and blank lines above it. */
function markedAbove(lines, line, re) {
  if (re.test(lines[line - 1] ?? '')) return true;
  for (let i = line - 2; i >= 0; i--) {
    const l = lines[i];
    if (!/\S/.test(l)) continue;
    if (!/^\s*(\/\/|\*|\/\*)/.test(l)) return false;
    if (re.test(l)) return true;
  }
  return false;
}

/* ── the SQL side ─────────────────────────────────────────────────────────── */

const partFiles = (existsSync(PARTS) ? readdirSync(PARTS) : []).filter((f) => f.endsWith('.sql'));
if (partFiles.length < 50) {
  console.error(`check-sql-caps: only found ${partFiles.length} files in supabase/parts, which cannot be right. Refusing to pass.`);
  process.exit(1);
}
/** Build order. The last definition of a name is the one the schema ends on. */
const ordered = partFiles.sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

/** function name -> { part, line, cap } for its EFFECTIVE definition. */
const sqlCaps = new Map();
/** Function names defined anywhere, capped or not — a later uncapped redefinition
 *  removes a cap and must remove the requirement with it. */
const defined = new Set();

for (const p of ordered) {
  const src = readFileSync(join(PARTS, p), 'utf8');
  // SQL line comments stripped, spaces kept so offsets and lines survive: every
  // part in this tree opens with a long header, and several of those headers
  // quote a `limit` they are explaining.
  const clean = src.split('\n').map((l) => (/^\s*--/.test(l) ? ' '.repeat(l.length) : l.replace(/--.*$/, (m) => ' '.repeat(m.length)))).join('\n');
  const heads = [...clean.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)];
  heads.forEach((h, i) => {
    const from = h.index;
    const to = i + 1 < heads.length ? heads[i + 1].index : clean.length;
    const body = clean.slice(from, to);
    const name = h[1];
    defined.add(name);
    let best = null;
    for (const lm of body.matchAll(/\blimit\s+(\d+)/gi)) {
      const n = Number(lm[1]);
      if (n <= 1) continue;
      if (!best || n > best.n) best = { n, at: from + lm.index };
    }
    if (best) sqlCaps.set(name, { part: p, cap: best.n, line: clean.slice(0, best.at).split('\n').length });
    else sqlCaps.delete(name); // redefined without a cap — the requirement goes with it
  });
}

/* ── the TypeScript side ──────────────────────────────────────────────────── */

const tsFiles = [];
for (const r of TS_ROOTS) walk(join(ROOT, r), tsFiles);

// The empty-set guard every gate here has.
if (tsFiles.length < 150) {
  console.error(`check-sql-caps: only found ${tsFiles.length} TypeScript files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

const text = new Map(tsFiles.map((f) => [f, readFileSync(f, 'utf8')]));

/* ── half one: the declared pairs must agree ──────────────────────────────── */

const mismatched = [];
for (const p of PAIRS) {
  const abs = join(ROOT, p.where);
  const src = text.get(abs);
  if (src === undefined) {
    mismatched.push({ ...p, why: `${p.where} does not exist (or is not under a scanned root). The pair cannot be checked, which is not the same as it being right.` });
    continue;
  }
  const sql = sqlCaps.get(p.fn);
  if (!sql) {
    mismatched.push({ ...p, why: `no capped definition of ${p.fn}() is left in supabase/parts. Either the limit came out of the SQL — in which case ${p.name} is now a client-side fiction and should go — or the function was renamed and this entry with it.` });
    continue;
  }
  const dec = new RegExp(`\\b(?:const|let|readonly)\\s+${p.name}\\s*(?::\\s*number\\s*)?=\\s*(\\d+)`).exec(src);
  if (!dec) {
    mismatched.push({ ...p, why: `${p.name} is not declared as a number in ${p.where}. It is the mirror of \`limit ${sql.cap}\` in supabase/parts/${sql.part}:${sql.line} and there is now nothing holding the two together.` });
    continue;
  }
  if (Number(dec[1]) !== sql.cap) {
    mismatched.push({
      ...p,
      why: `${p.name} is ${dec[1]} and supabase/parts/${sql.part}:${sql.line} says \`limit ${sql.cap}\`. One of the two moved without the other. The SQL is the one the server obeys; the constant is the one every screen believes.`,
    });
  }
}

/* ── half two: every capped RPC call is covered ───────────────────────────── */

const paired = new Set(PAIRS.map((p) => p.fn));
const found = [];
for (const f of tsFiles) {
  const src = text.get(f);
  const lines = src.split('\n');
  for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z0-9_]+)['"]/g)) {
    const fn = m[1];
    const cap = sqlCaps.get(fn);
    if (!cap || paired.has(fn)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    if (markedAbove(lines, line, /sql-cap-ok:\s*\S/)) continue;
    found.push({ fn, cap: cap.cap, part: cap.part, sqlLine: cap.line, rel: relative(ROOT, f), line });
  }
}

if (mismatched.length) {
  console.error(`\n${mismatched.length} declared pair${mismatched.length === 1 ? '' : 's'} where the two halves no longer agree:\n`);
  for (const p of mismatched) {
    console.error(`  ${p.fn}()  ↔  ${p.name} in ${p.where}`);
    console.error(`    ${p.why}\n`);
  }
  console.error('A ceiling written in two languages is two numbers, and nothing but this line');
  console.error('keeps them the same. Fix whichever is wrong, in BOTH places, and if the product');
  console.error('decision really has changed, change the sentence the screen prints with it.\n');
  process.exit(1);
}

/* ── the ratchet ──────────────────────────────────────────────────────────── */

const key = (h) => `${h.fn}@${h.rel}`;
const fresh = found.filter((h) => !KNOWN.has(key(h)));
const seen = new Set(found.map(key));
const drifted = [...KNOWN.keys()].filter((k) => !seen.has(k));

if (fresh.length) {
  fresh.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel < b.rel ? -1 : 1));
  console.error(`\n${fresh.length} server-side row ceiling${fresh.length === 1 ? '' : 's'} that nothing on the client can see:\n`);
  for (const h of fresh) {
    console.error(`  ${h.rel}:${h.line}  calls ${h.fn}()`);
    console.error(`    supabase/parts/${h.part}:${h.sqlLine} ends that function \`limit ${h.cap}\``);
    console.error(`    wrong: the limit is INSIDE the function, so the server can never answer with`);
    console.error(`           ${h.cap + 1} and src/lib/rowCap.ts cannot see the truncation — capped(),`);
    console.error(`           assertWhole() and isTruncated() are all blind to it, and a read that`);
    console.error(`           came back at ${h.cap} rows arrives as 'ready' over a prefix`);
    console.error(`    right: mirror it — \`const SOME_CAP = ${h.cap};\` beside the code that shapes`);
    console.error(`           these rows, add { fn: '${h.fn}', … } to PAIRS in this gate so the two`);
    console.error(`           numbers stay married, and report 'partial' when the row count reaches`);
    console.error(`           it. src/lib/challenges.ts (BOARD_CAP) and src/ui/coachReferrals.ts`);
    console.error(`           (ROW_CAP) are the two worked examples, and both headers say why the`);
    console.error(`           test is \`>= cap\` and not the \`> cap\` used everywhere else.`);
    console.error(`           If nothing counts these rows, say so: \`// sql-cap-ok: <why>\`\n`);
  }
  console.error('A member ranked 250th on a 400-entrant board opened it, could not find herself,');
  console.error('and got no sentence saying why — under a heading that said 400. That is what a');
  console.error('ceiling nobody mirrored looks like on a screen.\n');
  process.exit(1);
}

if (drifted.length) {
  console.error(`\n${drifted.length} ratchet entr${drifted.length === 1 ? 'y is' : 'ies are'} out of date — the pair is clean and the list still names it:\n`);
  for (const k of drifted) console.error(`  ${k}: delete the entry.`);
  console.error('\nA list that over-states what is wrong is how a ratchet turns into an ignore list.\n');
  process.exit(1);
}

console.log(
  `check-sql-caps — ok, ${sqlCaps.size} capped SQL function${sqlCaps.size === 1 ? '' : 's'} across ${partFiles.length} parts; `
  + `${PAIRS.length} declared pair${PAIRS.length === 1 ? '' : 's'} agree`
  + (KNOWN.size ? `, ${KNOWN.size} function${KNOWN.size === 1 ? '' : 's'} still unmirrored and ratcheted` : ', every capped function a client calls is mirrored'),
);
