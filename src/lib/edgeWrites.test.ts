// An edge function's update or delete that matched nothing, and said so to
// nobody.
//
// ── The rule ──────────────────────────────────────────────────────────────
//
// src/lib/wroteRows.ts is the argument in full and this is the one sentence of
// it: a PostgREST UPDATE or DELETE that matches ZERO rows is not an error. It
// is a 204, `error` is null, and the result is indistinguishable from a write
// that changed something. `if (error) …` never fires. It has shipped here
// twice; the settlement write that stamped zero sessions showed a payroll run
// as paid while every session stayed payable.
//
// INSERT is outside the rule, and so is an upsert's ON CONFLICT DO UPDATE path:
// neither can silently affect zero rows, because a conflicting row that fails
// the UPDATE policy's USING clause RAISES rather than being skipped. There are
// 45 inserts and non-ignoreDuplicates upserts under `supabase/functions` alone
// and a rule that flagged them would be wrong 45 times on the day it landed,
// which is how a gate gets deleted rather than fixed. The one upsert shape that
// CAN come back empty is `ignoreDuplicates: true` — ON CONFLICT DO NOTHING —
// and that one is in.
//
// ── Why this scans supabase/functions and nothing else ────────────────────
//
// scripts/check-writes.mjs already holds exactly this rule, with exactly this
// `no-count-ok:` marker, over ROOTS = src, app, studio-web/*. It is a good gate
// and it is another lane's file. A second gate re-asking its question over its
// own roots would double-report every site it already covers, which is the
// thing its own header declines to do to check-reads.mjs.
//
// What no gate in this repo covers is `supabase/functions`. It is outside
// check-writes.mjs's ROOTS, outside check-reads.mjs's, and outside
// src/lib/silentCatch.test.ts's — that last one deliberately, on the grounds
// that a server's swallowed failure lands in a log somebody reads. That
// argument is about `catch`, and it does not carry to this rule: a webhook
// handler whose UPDATE matched zero rows writes NOTHING to the log, because
// there was no error to log. It returns 200 to Stripe, the delivery is marked
// succeeded and never retried, and the row the event was about is untouched
// for ever. The absence of a reader is what makes the silence permanent.
//
// So: 40 in-class writes under supabase/functions when this was written, of
// which 35 are unguarded and unexplained. They are ratcheted below rather than
// fixed, because this lane audits and does not own them.
//
// ── What "guarded" means, and why the test cannot ask for more ────────────
//
// Three things count, and all three are syntactic:
//
//   · `{ count: 'exact' }` in the mutation's OWN argument list — the row count
//     comes back and can be compared;
//   · `.select(…)` in the chain — the write hands back the rows it touched, so
//     an empty array is a write that matched nothing;
//   · a `no-count-ok:` marker above the statement, with a reason.
//
// It does NOT check that the count is then READ, and that gap is real: two
// writes in src/lib/gymPay.ts (`reverseSettlement`, on gym_class_pay and
// payroll_adjustments) ask for `{ count: 'exact' }` and never look at it, while
// their two siblings in the same function do. Whether a bound number is used is
// a dataflow question, and a test that guessed at it would produce the false
// positives that get a gate deleted. Asking for the count is the half that can
// be held mechanically; `writeFailure` fails closed on a null count at runtime,
// which is the other half.
//
// ── Why a ratchet and not a total ─────────────────────────────────────────
//
// A hard total — "there are 40 in-class writes here" — fails on the next
// legitimate counted write somebody adds, which teaches people that the way
// past this file is to edit the number. A ratchet keyed by FILE, at the count
// each file has today, fails only on the two events worth failing on: a new
// unguarded write in a file that has none, and one more in a file that has
// some. A count that has DROPPED fails too, so the list can only shrink and a
// fix cannot quietly leave its entry behind. Same idiom, same reasons, as
// `KNOWN_COUNT` in scripts/check-writes.mjs.
//
// Line numbers are deliberately not in the ratchet. They drift on every edit
// above them, and a list that goes red because somebody added a comment is a
// list that gets deleted. The report names the lines; the gate holds the count.
//
// Compile with tsc then run with node, like silentCatch.test.ts.
export {};

/**
 * The filesystem, reached through a locally-declared `require` rather than an
 * `import`, for the reason set out in silentCatch.test.ts and consoleRoutes.
 * test.ts: the root tsconfig.json is Expo's, carries no node types, and type-
 * checks `src/**` for the phone app, so `import … from 'node:fs'` fails there.
 */
declare const require: (id: string) => any;

const { readdirSync, readFileSync, existsSync, statSync } = require('node:fs') as {
  readdirSync: (p: string) => string[];
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
  statSync: (p: string) => { isDirectory: () => boolean };
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ROOT = 'supabase/functions';

/* ── reading the source without being fooled by it ────────────────────────── */

/**
 * Comments and string bodies replaced by spaces, character for character, so
 * every offset and line number still lines up with the original.
 *
 * Both halves matter and for opposite reasons. Comments must go because this
 * repo's Phase 8 fixes left prose describing these patterns all over the tree —
 * seven of sixteen `catch {}` grep hits in silentCatch.test.ts's audit were
 * comments about catches already removed — and a rule that counts its own
 * documentation is a rule that reports work as outstanding for ever. String
 * bodies must go because a table name or an error message may hold a brace, a
 * paren or an apostrophe, and one unbalanced bracket inside a quote throws off
 * every boundary computed after it.
 *
 * `keepStrings` returns the second half only: comments gone, strings intact.
 * That is the text the `count: 'exact'` test runs against, because the literal
 * it is looking for IS a string.
 */
function mask(src: string, keepStrings: boolean): string {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  const blank = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; if (src[j] === '\n') break; j++; }
      if (!keepStrings) blank(i + 1, j);
      i = j + 1; continue;
    }
    if (c === '`') {
      // A template's TEXT is inert, but `${…}` is live code and may hold the
      // chain this file is looking for, so the holes are stepped over rather
      // than blanked.
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1, k = j + 2;
          while (k < n && depth > 0) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
          j = k; continue;
        }
        if (!keepStrings && src[j] !== '\n') out[j] = ' ';
        j++;
      }
      if (!keepStrings) { out[i] = ' '; if (j < n) out[j] = ' '; }
      i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

/** Forward to the bracket matching the one at `open`, or -1. */
function matchBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * The member names of the chain to the LEFT of the dot at `dotIdx`, innermost
 * first — so `service.from(TBL).update(` answers `['from', 'service']`.
 *
 * Walks the expression by balancing brackets rather than by matching a shape,
 * which is what lets `from` be found however long the argument to an
 * intervening call is.
 */
function chainBefore(s: string, dotIdx: number): string[] {
  const names: string[] = [];
  let i = dotIdx - 1;
  for (let guard = 0; guard < 500; guard++) {
    while (i >= 0 && /\s/.test(s[i])) i--;
    if (i < 0) break;
    if (s[i] === ')' || s[i] === ']') {
      const close = s[i], open = close === ')' ? '(' : '[';
      let depth = 0;
      while (i >= 0) {
        if (s[i] === close) depth++;
        else if (s[i] === open) { depth--; if (depth === 0) break; }
        i--;
      }
      i--; continue;
    }
    if (/[A-Za-z0-9_$]/.test(s[i])) {
      const e = i + 1;
      while (i >= 0 && /[A-Za-z0-9_$]/.test(s[i])) i--;
      names.push(s.slice(i + 1, e));
      continue;
    }
    if (s[i] === '.' || s[i] === '?' || s[i] === '!') { i--; continue; }
    break;
  }
  return names;
}

/**
 * The statement holding `p`, as `[start, end)`.
 *
 * NOT a character window, and the distinction is the whole reason this function
 * is 30 lines instead of one regex. An earlier audit in this repo searched 900
 * characters after a `.update(` and reported src/ui/clientData.tsx:607 as
 * unguarded; its `{ count: 'exact' }` sits 19 lines and about 1,050 characters
 * further on, as the second argument after a row object with sixteen keys. Any
 * rule measured in lines or characters reports that counted write as an
 * uncounted one. This walks brackets to the real end however far away it is.
 *
 * Two subtleties:
 *
 *   · walking BACKWARDS, `}` is normally the end of a previous block and so the
 *     boundary — EXCEPT when it closes a destructuring pattern that is this
 *     statement's own left-hand side, `const { error, count } = await …`. They
 *     are told apart by what follows the brace: a lone `=`.
 *   · a depth-zero COMMA ends the statement in both directions, so that one
 *     element of a `Promise.all([…])` cannot borrow its sibling's count.
 */
function statementRange(s: string, p: number): [number, number] {
  let depth = 0, a = p;
  while (a > 0) {
    const c = s[a - 1];
    if (c === ')' || c === ']') { depth++; a--; continue; }
    if (c === '}') {
      if (depth > 0) { depth++; a--; continue; }
      let d = 0, k = a - 1;
      while (k >= 0) { if (s[k] === '}') d++; else if (s[k] === '{') { d--; if (d === 0) break; } k--; }
      let q = a;
      while (q < s.length && /\s/.test(s[q])) q++;
      const isPattern = s[q] === '=' && s[q + 1] !== '=' && s[q + 1] !== '>';
      if (!isPattern) break;
      a = k; continue;
    }
    if (c === '(' || c === '[' || c === '{') { if (depth === 0) break; depth--; a--; continue; }
    if ((c === ';' || c === ',') && depth === 0) break;
    a--;
  }
  depth = 0;
  let b = p;
  while (b < s.length) {
    const c = s[b];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
    else if (c === ';' && depth === 0) { b++; break; }
    else if (c === ',' && depth === 0) break;
    b++;
  }
  return [a, b];
}

/**
 * Does a `no-count-ok:` marker apply to the statement starting on `line`?
 *
 * The marker may be on the line itself or anywhere in the unbroken run of
 * comment and blank lines immediately above it. NOT "the three lines above",
 * which is the window scripts/check-writes.mjs's own header records getting
 * this wrong: a marker three lines up with real code in between belongs to the
 * statement it is sitting on, not to this one.
 */
function markedAbove(lines: string[], line: number): boolean {
  const re = /no-count-ok:\s*\S/;
  if (re.test(lines[line - 1] ?? '')) return true;
  for (let i = line - 2; i >= 0; i--) {
    const l = lines[i] ?? '';
    if (!/\S/.test(l)) continue;                       // blank, keep looking
    if (!/^\s*(\/\/|\*|\/\*)/.test(l)) return false;   // real code — the run ended
    if (re.test(l)) return true;
  }
  return false;
}

interface Site { file: string; line: number; verb: string; }

/**
 * Every in-class mutation in one source that is NOT guarded.
 *
 * In-class is update, delete, and the one upsert shape that can come back empty
 * on purpose. Guarded is `{ count: 'exact' }` in the mutation's own arguments,
 * `.select(…)` anywhere in the statement, or a `no-count-ok:` marker.
 */
function unguardedIn(file: string, src: string): Site[] {
  const s = mask(src, false);              // comments and strings gone
  const nc = mask(src, true);              // comments gone, strings kept
  const lines = src.split('\n');
  const out: Site[] = [];
  const re = /\.\s*(update|delete|upsert)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) != null) {
    const verb = m[1];
    const dot = m.index;
    // A PostgREST builder, not `Map.delete` or an array method: the chain to the
    // left must run through `.from(`.
    if (!chainBefore(s, dot).includes('from')) continue;

    const openParen = m.index + m[0].length - 1;
    const closeParen = matchBracket(s, openParen);
    const args = closeParen < 0 ? '' : nc.slice(openParen, closeParen + 1);

    if (verb === 'upsert' && !/ignoreDuplicates\s*:\s*true/.test(args)) continue;

    const [a, b] = statementRange(s, dot);
    if (/count\s*:\s*'exact'/.test(args)) continue;
    if (/\.\s*select\s*\(/.test(s.slice(a, b))) continue;

    let sa = a;
    while (sa < b && /\s/.test(s[sa])) sa++;
    const stmtLine = src.slice(0, sa).split('\n').length;
    if (markedAbove(lines, stmtLine)) continue;

    out.push({ file, line: src.slice(0, dot).split('\n').length, verb });
  }
  return out;
}

/* ── the detector answers on known input ──────────────────────────────────── */
//
// First, and at length, because everything after it asserts that a search found
// a particular number of things — and a search that cannot find anything finds
// exactly nothing, passes, and says "ok".

// `TBL` rather than a table name in quotes: scripts/check-schema reads the
// literals inside these strings as if they were a real query and asks the live
// database for the columns beside them. A fixture is not a query, and teaching
// every schema gate to make an exception for this file is worse than not
// looking like one.
const SAMPLE = [
  "const { error } = await service.from(TBL).update({ status }).eq('id', id);", // 1  DEFECT
  "await service.from(TBL).delete().eq('object_key', key);",             // 2  DEFECT
  "const r = await sb.from(TBL).update(row, { count: 'exact' }).eq('id', id);",           // 3  counted
  // `error` is destructured here only to keep scripts/check-reads.mjs off this
  // fixture: it reads the sample's own string literals as if they were code, and
  // a `data` with no `error` beside it is its rule, not this one's.
  "const { data, error: e0 } = await sb.from(TBL).delete().eq('id', id).select('id');",   // 4  selected
  "const { error: e1 } = await sb.from(TBL).insert({ id });",                             // 5  outside
  "const { error: e2 } = await sb.from(TBL).upsert(row, { onConflict: 'id' });",          // 6  outside
  "const { error: e3 } = await sb.from(TBL).upsert(row, { onConflict: 'id', ignoreDuplicates: true });", // 7 DEFECT
  '// no-count-ok: nothing to clear is the outcome asked for',                            // 8
  "const { error: e4 } = await sb.from(TBL).delete().eq('id', id);",                      // 9  marked
  "seen.delete(id); rows.map((r) => r.id).filter(Boolean);",                              // 10 not PostgREST
  "// prose: a from(TBL).update({ a }) with no count, in a comment",                      // 11 prose
  "/** and a from(TBL).delete() in a doc block, which is where most of it is */",         // 12 prose
  "const wide = await sb.from(TBL).update({",                                             // 13 counted, but
  '  a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8,',                                    // 14 the count is
  '  i: 1, j: 2, k: 3, l: 4, m: 5, n: 6, o: 7, p: 8,',                                    // 15 nineteen lines
  '  q: 1, r: 2, s: 3, t: 4, u: 5, v: 6, w: 7, x: 8,',                                    // 16 below the
  '  y: 1, z: 2, aa: 3, bb: 4, cc: 5, dd: 6, ee: 7,',                                     // 17 `.update(`
  '  ff: 1, gg: 2, hh: 3, ii: 4, jj: 5, kk: 6, ll: 7,',                                   // 18
  '  mm: 1, nn: 2, oo: 3, pp: 4, qq: 5, rr: 6, ss: 7,',                                   // 19
  '  tt: 1, uu: 2, vv: 3, ww: 4, xx: 5, yy: 6, zz: 7,',                                   // 20
  '  a2: 1, b2: 2, c2: 3, d2: 4, e2: 5, f2: 6, g2: 7,',                                   // 21
  '  h2: 1, i2: 2, j2: 3, k2: 4, l2: 5, m2: 6, n2: 7,',                                   // 22
  '  o2: 1, p2: 2, q2: 3, r2: 4, s2: 5, t2: 6, u2: 7,',                                   // 23
  '  v2: 1, w2: 2, x2: 3, y2: 4, z2: 5, a3: 6, b3: 7,',                                   // 24
  '  c3: 1, d3: 2, e3: 3, f3: 4, g3: 5, h3: 6, i3: 7,',                                   // 25
  '  j3: 1, k3: 2, l3: 3, m3: 4, n3: 5, o3: 6, p3: 7,',                                   // 26
  '  q3: 1, r3: 2, s3: 3, t3: 4, u3: 5, v3: 6, w3: 7,',                                   // 27
  '  x3: 1, y3: 2, z3: 3, a4: 4, b4: 5, c4: 6, d4: 7,',                                   // 28
  '  e4: 1, f4: 2, g4: 3, h4: 4, i4: 5, j4: 6, k4: 7,',                                   // 29
  '  l4: 1, m4: 2, n4: 3, o4: 4, p4: 5, q4: 6, r4: 7,',                                   // 30
  '  s4: 1, t4: 2, u4: 3, v4: 4, w4: 5, x4: 6, y4: 7,',                                   // 31
  "}, { count: 'exact' }).eq('id', id);",                                                 // 32 <- here
  'const [pa, pb] = await Promise.all([',                                                 // 33
  "  sb.from(TBL).update({ a: 1 }, { count: 'exact' }).eq('id', x),",                     // 34 counted
  "  sb.from(TBL).update({ b: 2 }).eq('id', y),",                                         // 35 DEFECT
  ']);',                                                                                  // 36
].join('\n');

const sampleHits = unguardedIn('sample', SAMPLE);
const sampleLines = sampleHits.map((h) => h.line);

eq(sampleLines.join(','), '1,2,7,35', 'the detector finds exactly the four defects in the sample');
ok(sampleLines.includes(1), 'a bound update reading only `error` is a defect');
ok(sampleLines.includes(2), 'a delete whose result is not even bound is a defect');
ok(sampleLines.includes(7), 'an upsert with ignoreDuplicates CAN affect zero rows, so it is in the class');
ok(!sampleLines.includes(3), "`{ count: 'exact' }` in the mutation's own arguments is a guard");
ok(!sampleLines.includes(4), '`.select(…)` in the chain is a guard');
ok(!sampleLines.includes(5), 'an insert cannot silently affect zero rows and is outside the class');
ok(!sampleLines.includes(6), "an upsert's ON CONFLICT DO UPDATE path raises rather than skipping, so it is outside the class");
ok(!sampleLines.includes(9), 'a `no-count-ok:` marker with a reason above the statement is a guard');
ok(!sampleLines.includes(10), '`Set.delete` and `Array.filter` are not PostgREST writes');
ok(!sampleLines.includes(11) && !sampleLines.includes(12),
  'prose describing the shape is not the shape — the Phase 8 fixes left this comment everywhere');
ok(!sampleLines.includes(13),
  'a count nineteen lines and a thousand characters below the `.update(` is still its count — the boundary is brackets, not a window');
ok(!sampleLines.includes(34), "a counted sibling in a Promise.all is guarded");
ok(sampleLines.includes(35), "and it does NOT lend its count to the uncounted element beside it");

/* ── the ratchet ──────────────────────────────────────────────────────────── */

/**
 * Files under supabase/functions with in-class writes that are neither guarded
 * nor explained, at the count each had when this was written.
 *
 * Listed at N, fails at N+1, and fails when it drops below N so a fix cannot
 * leave its entry behind. Every one is REAL — each is an UPDATE or DELETE whose
 * `error` is read and whose row count never is.
 *
 * It stood at 35 when this file was written and at 29 after the eight writes
 * shown to somebody as a success were closed. It is 15 now. What came off was
 * the fourteen where NOTHING is shown to the person and a later screen reads
 * the row as truth, and they did not all come off the same way: eleven are
 * counted, and three are marked `no-count-ok:` because a zero-row match there
 * is the outcome the write was asking for and reporting it would be noise a
 * caller cannot act on. Which of the two a site got is argued at the site.
 *
 * What is left is the residue that argument does not reach. The twelve in
 * stripe-webhook are the four insert-then-two-guarded-updates idempotency sets
 * and nothing else — `lte('stripe_event_at', …)` matching nothing IS an
 * out-of-order delivery being correctly ignored. They want a `no-count-ok:`
 * naming that, and they have not got one, because the lane that closed the
 * fourteen was told to leave them alone and annotating a design it was not
 * asked to judge is how a marker stops meaning anything.
 */
const KNOWN = new Map<string, { count: number; why: string }>([
  ['calendar-sync/index.ts', {
    count: 2,
    why: "Down from 3. The push path's write-calendar remake is counted now: it re-creates a calendar in the coach's Google account when the stored id 404s, and zero rows there means the connection was deleted while the push ran — so the id is lost, a new calendar is made on the next push, and the account fills with empty ones, which is the failure the comment above it already describes. It answers with `calendar_remake_not_stored`, the reason its own error path uses, and logs the abandoned calendar's id. The two left are the token stores in `usableToken`: zero rows there means the link row has gone, so there is no connection left for a rotated token to be lost from.",
  }],
  ['wearable-day/index.ts', {
    count: 1,
    why: 'Storing a rotated refresh token. The comment above it already explains that a lost write leaves the row holding a token the vendor will never accept again; a zero-row match loses it just as thoroughly as an error does.',
  }],
  ['stripe-webhook/index.ts', {
    count: 12,
    why: "Down from 20, and now exactly the four idempotency sets: the upsert-then-lte-then-is-null triples on client_subscriptions, subscriptions, client_disputes and invoices. Zero rows in one of those is a stale delivery arriving after a newer one, which is what the filter is FOR. The eight that came off were the writes around them: both halves of `account.updated` (counted jointly — one of the pair matching nothing is the design, both matching nothing is an account neither table knows, which is a coach or a gym who has finished Stripe's verification and still cannot sell); the upgrade's supersede-close; both gym_orders closes, paid and failed; the gym refund's `refunded_cents` state; and the client-side sale's `refunded_cents`. All eight log rather than 500: every one is keyed on a row this same request read moments earlier, so zero rows means the row has gone, and a retry re-runs that read and reaches a branch this file already wrote for it. The refund_note write beside the state write is marked no-count-ok instead — same key, same request, seconds apart, so its zero match is the state write's, already logged.",
  }],
]);

/* ── and the tree ─────────────────────────────────────────────────────────── */

if (!existsSync(ROOT)) {
  // Run from somewhere that is not the repository root. Loud, rather than a
  // suite that silently asserts nothing and prints "ok".
  console.error(`edgeWrites.test.ts — ${ROOT}/ not found; run from the repository root.`);
  process.exit(1);
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const files = sources(ROOT);
ok(files.length >= 20, `the scan covered the edge functions (found ${files.length} sources under ${ROOT})`);

const found: Site[] = [];
for (const f of files) found.push(...unguardedIn(f, readFileSync(f, 'utf8')));

const perFile = new Map<string, Site[]>();
for (const s of found) {
  const rel = s.file.slice(ROOT.length + 1);
  const list = perFile.get(rel) ?? [];
  list.push(s);
  perFile.set(rel, list);
}

for (const [rel, list] of perFile) {
  const known = KNOWN.get(rel);
  if (!known) {
    errors.push(
      `${rel} has ${list.length} update/delete that can match zero rows unnoticed, and is not on the list:\n` +
      list.map((s) => `      ${s.file}:${s.line} [${s.verb}]`).join('\n') +
      "\n    Add `{ count: 'exact' }` and read the count (src/lib/wroteRows.ts), or `.select('id')` and check\n" +
      '    the length, or a `no-count-ok:` comment above the statement saying why zero rows is the honest\n' +
      '    outcome there. Only add an entry to KNOWN if none of those is true today.',
    );
    continue;
  }
  if (list.length > known.count) {
    errors.push(
      `${rel} is listed at ${known.count} unguarded write${known.count === 1 ? '' : 's'} and now has ${list.length}. ` +
      'The ratchet only goes down.\n' +
      list.map((s) => `      ${s.file}:${s.line} [${s.verb}]`).join('\n'),
    );
  }
  if (list.length < known.count) {
    const fixed = known.count - list.length;
    errors.push(
      `${rel} is listed at ${known.count} and now has ${list.length} — ${fixed} ` +
      `${fixed === 1 ? 'has' : 'have'} been fixed. Lower the number in KNOWN (or delete the entry once it ` +
      'reaches zero) so the list keeps meaning what it says.',
    );
  }
}

for (const [rel] of KNOWN) {
  ok(perFile.has(rel), `${rel} is on the list but has no unguarded write left — delete its entry from KNOWN.`);
}

const total = found.length;
const listed = [...KNOWN.values()].reduce((a, k) => a + k.count, 0);
eq(total, listed, 'every unguarded edge-function write is accounted for by the ratchet');

if (errors.length) {
  console.error('edgeWrites.test.ts FAILED');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(
  `edgeWrites.test.ts — ok (${files.length} edge sources, ${total} update/delete awaiting a count or a reason, none new)`,
);
