// ── Every route the DATABASE writes must be one it can classify ─────────────
//
// INCIDENT, 2 Oct 2026, and it is the reason part 3390 exists.
//
// Parts 3340 and 3350 added two server-written notifications on the routes
// '/(trainer)/checkins' and '/(client)/workouts'. `notification_channel` had
// never heard of either, both fell to its `else null`, and
// `notifications_dispatch_push` (part 900) filters on `channel is not null` —
// so the rows landed in the in-app bell and NOTHING reached a phone. "A
// check-in reaches the coach", the entire stated purpose of both parts, did
// not happen.
//
// It was invisible for two reasons worth keeping:
//
//   · The mapping exists TWICE. src/lib/notifyDispatch.ts carries
//     CHANNEL_BY_ROUTE for the app's own switches and got both routes; this
//     function is the half the database reads when deciding whether to send,
//     and it did not. The duplication is deliberate and documented — an edge
//     function under Deno cannot import the app's modules — so the answer is
//     not "remove one", it is that a new server-written notification is TWO
//     edits.
//
//   · Every test passed. They read the TypeScript copy.
//
// On 2 Oct part 3410 came within one line of repeating it.
//
// So: collect every route literal the SQL parts write into `notifications`,
// and require the live `notification_channel` definition to classify each one.
// Then require the two copies to agree, which is the duplication's only cost.
//
// A route may be deliberately unclassified — '/(client)/notices' is, see part
// 1870, because a notice is not any coach switch's business. Mark it with
// `channel-ok:` AND A REASON on the line or the line above. A bare marker does
// not count, which is this repo's rule for every marker escape.
import { readFileSync, readdirSync } from 'node:fs';

const PARTS = 'supabase/parts';
const ROUTE = /^\/\((client|trainer|owner)\)\/[a-z0-9-]+$/;
const fail = [];

/** Parts in applied order, so the last definition of a function is the live one. */
const files = readdirSync(PARTS).filter((f) => f.endsWith('.sql'))
  .sort((a, b) => (parseInt(a, 10) - parseInt(b, 10)) || a.localeCompare(b));

/* ── what the database can classify ─────────────────────────────────────── */

let channelBody = null;
for (const f of files) {
  const text = readFileSync(`${PARTS}/${f}`, 'utf8');
  const i = text.lastIndexOf('function public.notification_channel');
  if (i !== -1) channelBody = { file: f, text: text.slice(i) };
}
if (!channelBody) {
  console.error('check-notify-routes — notification_channel is not defined in any part. This gate cannot answer and is not passing quietly.');
  process.exit(1);
}
/**
 * `notification_channel` has TWO case blocks: routes first, then a fallback on
 * the whole title for rows written without a route. They mirror two different
 * TypeScript constants — CHANNEL_BY_ROUTE and CHANNEL_BY_TITLE — and the first
 * draft of this gate compared the titles against the route list and reported
 * three failures that were not ones. Split by shape, which is unambiguous: a
 * route starts with `/(`.
 */
const keyed = [...channelBody.text.matchAll(/when\s+'([^']+)'\s+then\s+'([a-z]+)'/g)].map((m) => m[1]);
const classified = new Set(keyed.filter((k) => ROUTE.test(k)));
const titled = new Set(keyed.filter((k) => !ROUTE.test(k)));

/* ── what the database writes ──────────────────────────────────────────── */

/** Routes written by an `insert into ... notifications`, with where to find them. */
const written = new Map();
for (const f of files) {
  const text = readFileSync(`${PARTS}/${f}`, 'utf8');
  const lines = text.split('\n');
  // Scan from each insert into notifications to the end of its statement, and
  // take the route-shaped literals in between. Statement-scoped rather than
  // file-scoped, so a route merely mentioned in a comment elsewhere in a long
  // part is not treated as one this part sends.
  for (const m of text.matchAll(/insert\s+into\s+(public\.)?notifications\b/gi)) {
    const end = text.indexOf(';', m.index);
    const stmt = text.slice(m.index, end === -1 ? text.length : end);
    for (const lit of stmt.matchAll(/'([^']+)'/g)) {
      if (!ROUTE.test(lit[1])) continue;
      const at = text.slice(0, m.index + lit.index).split('\n').length;
      if (!written.has(lit[1])) written.set(lit[1], `${f}:${at}`);
    }
  }
  // The escape, with its reason.
  for (const [i, l] of lines.entries()) {
    // `(.*)$` and not `(\S.*)$`: the stricter form did not MATCH a bare
    // `channel-ok:`, so the one thing this check exists to reject was skipped
    // in silence instead. An escape hatch that ignores its own abuse is not a
    // check.
    const mark = /channel-ok:(.*)$/.exec(l);
    if (!mark) continue;
    if (mark[1].trim().length < 12) {
      fail.push(`${f}:${i + 1} — \`channel-ok:\` with no reason. A bare marker does not count.`);
    }
    for (const lit of (l + '\n' + (lines[i + 1] ?? '')).matchAll(/'([^']+)'/g)) {
      if (ROUTE.test(lit[1])) classified.add(lit[1]);
    }
  }
}

for (const [route, where] of written) {
  if (!classified.has(route)) {
    fail.push(`${where} writes a notification on \`${route}\`, and notification_channel (${channelBody.file}) does not classify it. notifications_dispatch_push drops a row with a null channel, so this notification reaches the in-app bell and never a phone. Add the route to notification_channel, or mark it \`channel-ok: <why it must not push>\`.`);
  }
}

/* ── and the two copies must agree ──────────────────────────────────────── */

const ts = readFileSync('src/lib/notifyDispatch.ts', 'utf8');
const tsStart = ts.indexOf('CHANNEL_BY_ROUTE');
const tsBody = tsStart === -1 ? '' : ts.slice(tsStart, ts.indexOf('];', tsStart));
const tsRoutes = new Set([...tsBody.matchAll(/\['([^']+)',\s*'([a-z]+)'\]/g)].map((m) => m[1]));
if (!tsRoutes.size) {
  fail.push('src/lib/notifyDispatch.ts — CHANNEL_BY_ROUTE could not be read. The gate will not pass on an unread half of a mapping that exists twice.');
}

for (const route of classified) {
  if (route === '/(client)/notices') continue;  // see part 1870; not any switch's business
  if (tsRoutes.size && !tsRoutes.has(route)) {
    fail.push(`notification_channel classifies \`${route}\` and CHANNEL_BY_ROUTE in src/lib/notifyDispatch.ts does not. The app's own switch will not govern it.`);
  }
}
for (const route of tsRoutes) {
  if (!classified.has(route)) {
    fail.push(`CHANNEL_BY_ROUTE has \`${route}\` and notification_channel does not. This is the half that decides whether anything is SENT, and it is the half part 3390 found missing.`);
  }
}

/* The routeless rows, which have the same two halves and the same hazard. */
const tbStart = ts.indexOf('CHANNEL_BY_TITLE');
const tbBody = tbStart === -1 ? '' : ts.slice(tbStart, ts.indexOf('];', tbStart));
const tsTitles = new Set([...tbBody.matchAll(/\['([^']+)',\s*'([a-z]+)'\]/g)].map((m) => m[1]));
if (!tsTitles.size) {
  fail.push('src/lib/notifyDispatch.ts — CHANNEL_BY_TITLE could not be read, and it is the other half of a mapping that exists twice.');
}
for (const title of titled) {
  if (tsTitles.size && !tsTitles.has(title)) {
    fail.push(`notification_channel classifies the title "${title}" and CHANNEL_BY_TITLE does not.`);
  }
}
for (const title of tsTitles) {
  if (!titled.has(title)) {
    fail.push(`CHANNEL_BY_TITLE has "${title}" and notification_channel does not, so a routeless row with that title is never sent.`);
  }
}

if (fail.length) {
  console.error(`check-notify-routes — ${fail.length} problem(s):`);
  for (const f of fail) console.error('  · ' + f);
  process.exit(1);
}
console.log(`check-notify-routes — ok, ${written.size} server-written routes all classified; ${classified.size} routes and ${titled.size} titles agree across both copies of the mapping`);
