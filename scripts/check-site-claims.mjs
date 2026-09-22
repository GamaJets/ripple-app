#!/usr/bin/env node
// The public site is the one surface with no gate on it, and it has been wrong
// about the product three times this week.
//
// ── what was actually wrong, and what it cost ─────────────────────────────
//
// `web/` is about twenty static pages. It is the last thing a stranger reads
// before they sign up, the thing a gym owner reads before they pay, and the
// thing a regulator reads if anybody ever asks. It is also the only part of
// this repo that no check has ever looked at. It was audited once and corrected
// twice on the same day, and BOTH audits found it stating things the code had
// stopped doing months earlier:
//
//   · `web/signup.html` promised "At least 6 characters" and carried
//     `minlength="6"` on the box. `PASSWORD_MIN` is 8, and Supabase then wants
//     a lowercase letter, an uppercase letter, a digit and a symbol on top. A
//     tester typed six characters, was refused, and was then refused once more
//     per unmet class. Two of the people who could not get in that week were on
//     the password screens. The sweep that fixed the same sentence in
//     `app/welcome.tsx`, `app/reset-password.tsx`, `src/ui/components.tsx` and
//     `web/reset-password.html` missed the ACCOUNT-CREATION page — the first
//     password anybody types.
//
//   · `web/pricing.html` said nothing is charged. `DEFAULT_FEE_PCT` is 10 and
//     it is applied to every Connect charge. "We take nothing" is not a stale
//     number, it is a false statement about money on the page whose entire job
//     is money.
//
//   · `web/privacy.html` named the processors that receive personal data and
//     did not name `api.anthropic.com` or `api.ocr.space`. Both are called from
//     `supabase/functions/**` today. Anthropic receives what a client types to
//     the coach, their meal photographs and — behind a switch — their injury
//     areas; OCR.space receives the WHOLE of a physiotherapy report. Two live
//     processors of health data, undisclosed. That is the finding this file
//     exists for, and it is the one that is not merely embarrassing.
//
//   · `web/client.html` offered "WHOOP, Oura, Fitbit, Garmin — connect the ones
//     you use." Fitbit has an empty client id in every build profile and Garmin
//     is `special: 'partnership'`, so neither can be connected by anybody. The
//     app's own catalogue says so in `src/lib/wearables/registry.ts`, whose
//     header records the same promise being removed from the DEVICE SCREEN for
//     the same reason — and the marketing page kept making it.
//
//   · `web/security.html` described a consent step as unbuilt when all three
//     layers of it existed, and its deletion chart read 42 tables when the live
//     catalogue said 106.
//
// ── why this is a gate and not five more corrections ──────────────────────
//
// Every one of those was fixed by hand, and nothing stops the sixth. The
// failure mode is not that somebody writes a lie; it is that somebody changes a
// constant in `src/` and the sentence describing it, three directories away in
// a file that no build step reads, keeps saying the old thing. Every other
// invariant in this repo has a gate. The page a stranger reads before signing
// up had none.
//
// ── the rule every check here obeys ───────────────────────────────────────
//
// A check may only exist if it can PARSE its truth out of the code. Nothing
// below hardcodes 8, or 10, or 14, or the list of processors: each is read from
// the file that decides it, so changing the code moves the gate rather than
// creating a second thing to update. Where the truth could not be parsed the
// claim is NOT gated — see "what this deliberately does not check" — because a
// gate with false positives gets suppressed and then ignored, which is worse
// than no gate at all.
//
//   A · Password minimum      web prose + minlength  vs  PASSWORD_MIN
//                                                        src/lib/passwordRules.ts
//   B · Platform fee          web prose              vs  DEFAULT_FEE_PCT
//                                                        src/lib/directCharges.ts
//   C · Trial length          web prose              vs  TRIAL_DAYS
//                                                        src/lib/trialGate.ts
//   D · Named processors      privacy.html           vs  every host literally
//                                                        contacted from
//                                                        supabase/functions/**
//   E · Connectable wearables a marked claim         vs  the cloud vendors that
//                                                        have an OAuth entry, no
//                                                        partnership gate and a
//                                                        non-empty client id in
//                                                        app.json or eas.json
//   F · The deletion figure   security.html's chart is internally consistent
//                             and carries a parseable provenance date
//   G · Hosts the SITE calls  every host a visitor's browser is made to
//                             contact  vs  privacy.html
//   H · The CSP               every host from G  vs  web/_headers
//   I · The catalogue figures the pages agree with each other, the three
//                             numbers nest, and the count is stamped with the
//                             date it was taken from the live catalogue
//   J · Internal links        every same-origin href  vs  the files under web/,
//                             and every #fragment  vs  the ids on its target
//   K · The console's size    "thirty pages in five groups" on studio.html
//                             vs  the NAV array in
//                             studio-web/components/Shell.tsx
//   L · The export's parts    the twenty-eight rows on studio.html  vs
//                             EXPORT_PARTS and EXPORT_LABEL in
//                             src/lib/gymExport.ts
//   M · The coach setup list  the nine steps on coach-setup.html  vs
//                             COACH_SETUP_STEPS in src/lib/coachFirstRun.ts
//   N · Store badges          every `<a class="store">` cluster  vs  a release
//                             caveat in the same <section>. The six store
//                             addresses do not resolve yet; the caveat is what
//                             stops a Download button being a false claim.
//   O · The erasure figure   every file stating how far account deletion
//                             reaches  vs  the `do $$` threshold in
//                             supabase/parts/41-account-deletion.sql, which is
//                             the one statement that can measure it. Not a site
//                             check — it lives here because check F already
//                             owns web/security.html's copy of that figure, and
//                             a second gate would be a second thing to keep in
//                             step with the first.
//
// ── what this deliberately does NOT check ─────────────────────────────────
//
//   · THE DELETION COUNTS THEMSELVES (66 / 74 / 106). They come from one query
//     over the live database's foreign keys. This gate runs offline, in CI,
//     with no credentials — by deliberate design, see the `//check:all` note in
//     package.json — so it cannot know the true number and must not pretend to.
//     What it CAN do is check the things that go wrong when somebody edits
//     those numbers by hand, and those are check F: the screen-reader label
//     repeating a figure the visible chart no longer shows, a bar drawn to the
//     old value, and a provenance date that quietly stops being a date. The
//     numbers stay a human job; re-run the catalogue query, update all three
//     places, and move the stamp. Check F makes a partial edit fail loudly.
//
//   · WHETHER A PROCESSOR IS DESCRIBED CORRECTLY. Check D asserts presence of
//     the name and nothing about the sentence around it. "Is this an accurate
//     account of what Anthropic receives" is not a machine question.
//
//   · THE DEVICE TABLE ON support.html. It lists every device including the
//     ones that cannot be connected, each with its own explanation, so there is
//     no set for a gate to compare against. If Fitbit is ever registered, that
//     table needs a human. Check E will fail on that day and this is the note
//     that says where else to look.
//
//   · THE CATALOGUE COUNTS THEMSELVES (608 / 601 / 489), for exactly the reason
//     the deletion counts are not checked: they are one query over
//     `public.exercises` and this gate has no credentials. Check I holds the
//     three things a hand edit breaks — the pages disagreeing, the figures
//     failing to nest, and the stamp stopping being a date — and leaves the
//     values to a person with a psql prompt. The query is in the comment above
//     the claim on web/client.html.
//
//   · WHETHER THE DESCRIPTION OF A CONSOLE PAGE OR AN EXPORT PART IS FAIR.
//     Checks K and L compare a COUNT and a SET OF NAMES, which are mechanical.
//     "Is this a fair account of what the Money page does" is not.
//
//   · PRICES, DATES OTHER THAN THE ONE IN CHECK F, AND EVERY OTHER SENTENCE ON
//     THE SITE. Not because they cannot be wrong, but because no file in this
//     repo decides them, so there is nothing to compare them to.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname, resolve } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Violations that could not be cleared on the day this gate was written.
 *
 * A RATCHET, not an exemption: the count per page may fall and may never rise,
 * and a count that has fallen without somebody lowering the number here is
 * itself a failure — otherwise the list becomes a licence rather than a debt.
 *
 * Empty, because everything this found was fixed in the same change. It stays
 * because the next person to find three violations they cannot clear needs
 * somewhere to put them that is not a suppression.
 */
const KNOWN = new Map([
  // ['web/example.html', { count: 1, why: 'why it is still there and what clears it' }],
]);

const problems = [];
const fatal = [];
const note = (page, line, claim, truth) => problems.push({ page, line, claim, truth });

/* ── the source of truth, parsed ─────────────────────────────────────────── */

/**
 * `export const NAME = <number>;` out of a real source file.
 *
 * Fails the whole run when it cannot find it. A gate that cannot locate its
 * source of truth must fail loudly rather than pass quietly: silently skipping
 * check A because somebody renamed `PASSWORD_MIN` is exactly how the six came
 * back the first time.
 */
function numericConstant(rel, name) {
  if (!existsSync(join(ROOT, rel))) {
    fatal.push(`${rel} does not exist, so the value of ${name} cannot be read. This gate refuses to pass without it.`);
    return null;
  }
  const re = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*(\\d+(?:\\.\\d+)?)\\s*;`);
  const m = re.exec(read(rel));
  if (!m) {
    fatal.push(`${rel} no longer declares \`export const ${name} = <number>\`. Either it moved or it is now computed — either way the site claim that mirrors it is now ungated. Point this gate at the new home.`);
    return null;
  }
  return Number(m[1]);
}

const PASSWORD_MIN = numericConstant('src/lib/passwordRules.ts', 'PASSWORD_MIN');
const FEE_PCT = numericConstant('src/lib/directCharges.ts', 'DEFAULT_FEE_PCT');
const TRIAL_DAYS = numericConstant('src/lib/trialGate.ts', 'TRIAL_DAYS');

/* ── the pages ───────────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (extname(e.name) === '.html') out.push(p);
  }
  return out;
}

const PAGES = walk(join(ROOT, 'web')).map((p) => relative(ROOT, p)).sort();

// The empty-set guard. There are twenty-odd pages under web/; a run that finds
// a handful has been pointed at the wrong tree, and a run that finds none would
// otherwise print "ok" and a count of zero.
if (PAGES.length < 15) {
  fatal.push(`only ${PAGES.length} pages found under web/, which cannot be right — the site has about twenty. Refusing to pass.`);
}

/** Entities the site actually uses, so prose matching sees the sentence a reader sees. */
const ENTITIES = [
  [/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&mdash;/g, '—'], [/&ndash;/g, '–'],
  [/&rsquo;/g, "'"], [/&lsquo;/g, "'"], [/&ldquo;/g, '"'], [/&rdquo;/g, '"'],
  [/&rarr;/g, '→'], [/&hellip;/g, '…'], [/&lt;/g, '<'], [/&gt;/g, '>'],
  [/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))],
];

/** Tags out, entities in, curly apostrophes flattened so one pattern matches both. */
function text(html) {
  let s = String(html).replace(/<[^>]*>/g, ' ');
  for (const [re, to] of ENTITIES) s = s.replace(re, to);
  return s.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

/** The whole page as a reader sees it: script and style bodies dropped as well. */
function pageText(html) {
  return text(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' '));
}

/** The words a person writes a small number in. Both forms are claims. */
const WORD_NUMBERS = new Map(Object.entries({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, sixty: 60, ninety: 90,
}));
/**
 * The alternation a claim's number is matched with.
 *
 * COMPOUNDS FIRST — `thirty-one` before `one`, or the regex alternates its way
 * to the shortest match and a page saying "thirty-one pages" is read as a
 * claim about ONE. That is not hypothetical: the console grew to 31 pages, the
 * sentence was updated to "thirty-one", and this gate reported that the page
 * "says the console has one pages".
 *
 * Tens are listed before units for the same reason.
 */
const TENS = ['twenty', 'thirty', 'forty', 'sixty', 'ninety'];
const UNITS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const COMPOUNDS = TENS.flatMap((t) => UNITS.map((u) => `${t}-${u}`));
const NUM = '\\d+|' + [...COMPOUNDS, ...[...WORD_NUMBERS.keys()].sort((a, b) => b.length - a.length)].join('|');

/** A written number, compound or not. `thirty-one` is thirty plus one; every
 *  other form is a single word this table already holds. */
const asNumber = (s) => {
  const w = s.toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  if (w.includes('-')) {
    const [tens, units] = w.split('-');
    const a = WORD_NUMBERS.get(tens);
    const b = WORD_NUMBERS.get(units);
    return a == null || b == null ? undefined : a + b;
  }
  return WORD_NUMBERS.get(w);
};

/**
 * The escape hatch: `site-claim-ok: <reason>` in the unbroken comment run
 * DIRECTLY above the line it excuses.
 *
 * Directly above, and only there, so it excuses one line rather than a file —
 * and with a written reason, so the next reader learns why rather than that
 * somebody once wanted a green run. A bare marker with nothing after it is not
 * a reason and does not count.
 */
const COMMENT = /^\s*(?:<!--|\/\/|\*|\/\*)/;
function excused(lines, i) {
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (t === '') return false;
    if (!COMMENT.test(t)) return false;
    const m = /site-claim-ok:\s*(\S.*?)\s*(?:-->|\*\/)?\s*$/.exec(t);
    if (m && m[1].length >= 8) return true;
  }
  return false;
}

/* ── A · the password minimum ────────────────────────────────────────────── */
//
// Three shapes, all of which have appeared on these pages: the prose
// ("at least eight characters"), the checklist item ("8 characters or more")
// and the browser's own `minlength`, which was 6 while the sentence beside it
// said 6 and the server said 8.
//
// Scoped to pages that mention a password at all, so a length stated about
// something else — a join code, a gym name — is not dragged in. And every page
// with an `autocomplete="new-password"` field, which is to say every page where
// somebody CHOOSES a password, must state the minimum somewhere: silence on
// those two pages is the original bug wearing a different face.

const PW_CLAIMS = [
  new RegExp(`(?:at least|minimum of|no fewer than|a minimum)\\s+(${NUM})\\s+characters`, 'i'),
  new RegExp(`(${NUM})\\s+characters or (?:more|longer)`, 'i'),
];

function checkPasswords(page, raw, lines) {
  if (!/password/i.test(raw)) return;
  let stated = 0;
  lines.forEach((line, i) => {
    if (COMMENT.test(line)) return;              // prose about the old bug, not the bug
    const t = text(line);
    for (const re of PW_CLAIMS) {
      const m = re.exec(t);
      if (!m) continue;
      stated++;
      const said = asNumber(m[1]);
      if (said !== PASSWORD_MIN && !excused(lines, i)) {
        note(page, i + 1, `states a password minimum of ${m[1]} — "${m[0]}"`,
          `PASSWORD_MIN is ${PASSWORD_MIN} (src/lib/passwordRules.ts, established by probing the signup endpoint)`);
      }
    }
    const ml = /minlength="(\d+)"/.exec(line);
    if (ml && /type="password"/.test(line)) {
      stated++;
      if (Number(ml[1]) !== PASSWORD_MIN && !excused(lines, i)) {
        note(page, i + 1, `a password field carries minlength="${ml[1]}"`,
          `PASSWORD_MIN is ${PASSWORD_MIN} — the browser would accept a password the server then refuses`);
      }
    }
  });
  if (/autocomplete="new-password"/.test(raw) && stated === 0) {
    note(page, 1, 'sets a new password and states no minimum length at all',
      `PASSWORD_MIN is ${PASSWORD_MIN}. A page that asks somebody to choose a password has to say what will be accepted, or they find out one refusal at a time.`);
  }
}

/* ── B · the platform fee ────────────────────────────────────────────────── */
//
// A percentage only counts as a fee claim when fee language sits within a line
// of it. That is INCLUSION rather than exclusion, on purpose: the cost of the
// rule being narrow is a fee claim phrased in some entirely new way going
// unchecked, and the cost of it being wide is `width:100%`, "50–60% of max HR"
// and every other percentage on the site turning this gate into noise. The
// empty-set guard below is what stops the narrowness becoming silence.

const FEE_CUES = /Repple keeps|Repple takes|platform fee|takes today|of anything sold|of what you sell|through Repple|Repple's (?:own )?checkout|goes back with it/i;

function checkFee(page, lines, seen) {
  lines.forEach((line, i) => {
    if (COMMENT.test(line)) return;
    const here = text(line);
    if (!/%/.test(here)) return;
    const window = [lines[i - 1], line, lines[i + 1]].filter(Boolean).map(text).join(' ');
    if (!FEE_CUES.test(window)) return;
    for (const m of here.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
      seen.count++;
      if (Number(m[1]) !== FEE_PCT && !excused(lines, i)) {
        note(page, i + 1, `states a platform fee of ${m[1]}% — "${here.slice(Math.max(0, m.index - 40), m.index + 40).trim()}"`,
          `DEFAULT_FEE_PCT is ${FEE_PCT} (src/lib/directCharges.ts), applied to every Connect charge`);
      }
    }
  });
}

/* ── C · the trial length ────────────────────────────────────────────────── */
//
// Deliberately without an empty-set guard, and this is the one place the
// asymmetry is right: the coach app's countdown gates nothing, so the sentence
// describing it may legitimately disappear when the counter does. What must not
// happen is the sentence outliving the constant.

const TRIAL_CLAIMS = [
  new RegExp(`(${NUM})[- ]day (?:free )?(?:trial|countdown)`, 'i'),
  new RegExp(`(?:trial|countdown) (?:of|lasts|runs for) (${NUM}) days`, 'i'),
  new RegExp(`(${NUM}) free days`, 'i'),
];

function checkTrial(page, lines) {
  lines.forEach((line, i) => {
    if (COMMENT.test(line)) return;
    const t = text(line);
    for (const re of TRIAL_CLAIMS) {
      const m = re.exec(t);
      if (!m) continue;
      const said = asNumber(m[1]);
      if (said !== TRIAL_DAYS && !excused(lines, i)) {
        note(page, i + 1, `states a trial length of ${m[1]} — "${m[0]}"`,
          `TRIAL_DAYS is ${TRIAL_DAYS} (src/lib/trialGate.ts)`);
      }
    }
  });
}

/* ── D · the processors ──────────────────────────────────────────────────── */
//
// Every host literally named in a request from an edge function, mapped to the
// company that answers it, and that company's name must appear on privacy.html.
//
// Presence, and nothing more. Whether the sentence around the name is a fair
// account of what that company receives is a human question — but a company
// that is CONTACTED and NOT NAMED is a mechanical question with one answer, and
// it is the one that was wrong: Anthropic and OCR.space were both live and both
// absent until the day this was written.
//
// The important half is the failure on an UNKNOWN host. A new `fetch` to a host
// nobody has classified fails this gate until somebody decides whether it is a
// processor and, if it is, discloses it. That is what makes this track the code
// instead of tracking a list somebody has to remember to extend.

const HOST_OWNERS = new Map([
  ['api.anthropic.com', 'Anthropic'],
  // The gateway Repple can be pointed at instead of Anthropic, per
  // src/lib/llmGateway.ts. It is a RESELLER: it answers the request itself and
  // forwards it to whichever company runs the model asked for, so what it
  // receives is everything Anthropic would have, and who it hands that on to
  // depends on the model an operator names in a secret.
  ['api.cheaperinference.com', 'Cheaper Inference'],
  ['api.ocr.space', 'OCR.space'],
  // The recipe library behind the Meals list (supabase/functions/recipes). What
  // it receives carries no identity — a diet, excluded allergens, a meal type, a
  // calorie band and the words typed into a search box, sent from Repple's
  // server on Repple's key. It is listed as a processor anyway rather than in
  // NOT_PROCESSORS: "avoids dairy and gluten" is about somebody's health even
  // with no name on it, and the member's phone loads each photograph from
  // Spoonacular's image host directly, which does see an IP address.
  ['api.spoonacular.com', 'Spoonacular'],
  ['exp.host', 'Expo'],
  ['api.prod.whoop.com', 'WHOOP'],
  ['developer.whoop.com', 'WHOOP'],
  ['api.ouraring.com', 'Oura'],
  ['cloud.ouraring.com', 'Oura'],
  ['api.fitbit.com', 'Fitbit'],
  ['dev.fitbit.com', 'Fitbit'],
  ['oauth2.googleapis.com', 'Google'],
  ['www.googleapis.com', 'Google'],
  ['googleads.googleapis.com', 'Google'],
  ['graph.facebook.com', 'Meta'],
  ['business-api.tiktok.com', 'TikTok'],
]);

/** Ours. Contacting our own site is not a disclosure. */
const FIRST_PARTY = new Set(['www.repplefitness.com', 'repplefitness.com']);

/** Reached, but no personal data goes there — each with the reason it is exempt. */
const NOT_PROCESSORS = new Map([
  ['esm.sh', 'a module CDN. It serves the edge function its own JavaScript at cold start; nothing about a person is sent to it.'],
]);

// ── the scan follows the functions OUT of supabase/functions ───────────────
//
// It used to read that directory and stop there, which was true of the code for
// as long as every `fetch` was written inline in a function. It stopped being
// true the day the three AI functions started sharing src/lib/llmGateway.ts:
// `api.anthropic.com` moved one file sideways and this gate would have reported
// one fewer processor than the product has, with nothing failing.
//
// That is the same walk scripts/check-functions.mjs makes for the same reason —
// a function's behaviour is not bounded by its own file — so it is made here
// too. Relative imports only: a module this repo owns is code that runs on
// Repple's server on Repple's key, and a host named in one is a host contacted.
const RELATIVE_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)[\s\S]{0,400}?from\s+['"](\.[^'"]+)['"]/g;

function edgeFunctionHosts() {
  const dir = join(ROOT, 'supabase/functions');
  const entries = [];
  (function w(d) {
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = join(d, e.name);
      if (e.isDirectory()) w(p);
      else if (/\.tsx?$/.test(e.name)) entries.push(p);
    }
  })(dir);

  const hosts = new Map();                       // host → "rel:line" first seen
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    let src; try { src = readFileSync(f, 'utf8'); } catch { continue; }
    const rel = relative(ROOT, f);
    src.split('\n').forEach((line, i) => {
      // A URL in a comment is documentation, not a request. `wearable-day`
      // cites developer.whoop.com and dev.fitbit.com in its header for exactly
      // that reason, and neither is a call.
      if (COMMENT.test(line)) return;
      for (const m of line.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const h = m[1].toLowerCase();
        if (!hosts.has(h)) hosts.set(h, `${rel}:${i + 1}`);
      }
    });
    for (const m of src.matchAll(RELATIVE_IMPORT)) {
      const target = resolve(dirname(f), m[1]);
      if (existsSync(target)) queue.push(target);
    }
  }
  return hosts;
}

function checkProcessors() {
  const hosts = edgeFunctionHosts();
  if (hosts.size < 8) {
    fatal.push(`only ${hosts.size} hosts found across supabase/functions — the edge functions call more than that. Something is wrong with the scan; refusing to pass.`);
    return;
  }
  const privacy = 'web/privacy.html';
  if (!existsSync(join(ROOT, privacy))) {
    fatal.push(`${privacy} does not exist. The processor disclosure has no home; refusing to pass.`);
    return;
  }
  const disclosed = pageText(read(privacy));
  if (disclosed.length < 3000) {
    fatal.push(`${privacy} reads as only ${disclosed.length} characters of text, which cannot be the privacy policy. Refusing to pass.`);
    return;
  }
  const missing = new Map();
  for (const [host, where] of [...hosts].sort()) {
    if (FIRST_PARTY.has(host) || NOT_PROCESSORS.has(host)) continue;
    const owner = HOST_OWNERS.get(host);
    if (!owner) {
      fatal.push(`${where} contacts ${host}, and nothing here says who that is.\n`
        + `      Decide, then record the decision in scripts/check-site-claims.mjs:\n`
        + `        · a processor of personal data → add it to HOST_OWNERS *and* name that company on ${privacy}\n`
        + `        · one of ours                  → FIRST_PARTY\n`
        + `        · reached, but no personal data goes there → NOT_PROCESSORS, with the reason\n`
        + `      Undisclosed processors is how api.anthropic.com and api.ocr.space came to be reading\n`
        + `      injury reports and meal photographs while the privacy policy did not mention either.`);
      continue;
    }
    // Word-boundary and case-sensitive: "Meta" must not be satisfied by
    // "metabolic", and a <meta> tag is stripped before this runs.
    const named = new RegExp(`\\b${owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(disclosed);
    if (!named) missing.set(owner, [...(missing.get(owner) ?? []), `${host} (${where})`]);
  }
  for (const [owner, hostList] of missing) {
    note(privacy, 1, `does not name ${owner}, which the code contacts: ${hostList.join(', ')}`,
      `A company reachable from supabase/functions is a company that receives data. Name it under "Services we rely on" — or, if it genuinely receives nothing about a person, say so in NOT_PROCESSORS with the reason rather than deleting it from the scan.`);
  }
}

/* ── G · the hosts THIS WEBSITE contacts ─────────────────────────────────── */
//
// Check D asks what the edge functions call. This asks what the twenty-two
// static pages call, and until it was written the answer was nobody's job.
//
// The distinction is not academic. D is about a request made on a server, on
// behalf of somebody who has already signed in and agreed to something. G is
// about a request made by a STRANGER'S BROWSER, before they have agreed to
// anything at all, on a page that may well be the privacy policy itself. The
// data is thinner — an IP address, a user-agent, a referring page — but the
// consent is nil and the audience is everyone who ever looks at the site.
//
// What it found on the day it was written:
//
//   · `fonts.googleapis.com` and `fonts.gstatic.com`, from `styles.css`'s
//     `@import` plus a `preconnect` on every page. Every visitor to every page
//     hands Google their IP and the page they are on. privacy.html did not
//     mention it, and worse, it said Google was used "for coaches only, and
//     only for a coach's own accounts" — a sentence the page contradicted while
//     rendering it.
//
//   · `cdn.jsdelivr.net`, which serves an executable ES module to six pages,
//     three of which are where a password gets typed. Undisclosed.
//
// Neither is exotic and neither is malicious. That is the point: this is the
// class of dependency that arrives in a stylesheet, never gets written down,
// and is entirely invisible to a policy that was drafted by thinking about the
// apps. A gate is the only thing that connects the two.
//
// RESOURCE POSITIONS ONLY. A link to the App Store is a place a person may
// choose to go; a `<script src>` is a request their browser makes whether they
// like it or not. `<a href>` is therefore not scanned, which is why
// apps.apple.com and play.google.com do not appear here.

/** Who answers for a host the SITE contacts, over and above the app's list. */
const SITE_HOST_OWNERS = new Map([
  ['fonts.googleapis.com', 'Google'],
  ['fonts.gstatic.com', 'Google'],
  ['cdn.jsdelivr.net', 'jsDelivr'],
]);

/** Reached by the site, but not on anybody's behalf — each with its reason. */
const SITE_NOT_PROCESSORS = new Map([
  ['schema.org', 'a JSON-LD `@context` identifier. It is a string in a script tag that names a vocabulary; no request is made to it.'],
  ['www.w3.org', 'the SVG namespace URI. An XML namespace is an identifier, not an address that is fetched.'],
]);

/**
 * Every external host the pages under web/ cause a browser to CONTACT.
 *
 * Deliberately over-broad on the positions it reads and then narrowed by the
 * two maps above, rather than the other way round: a new `<script src>` to an
 * unclassified host has to stop this gate, and it only can if the scan sees
 * positions nobody has thought about yet.
 */
function siteHosts() {
  const hosts = new Map();                       // host → "rel:line" first seen
  const add = (h, where) => {
    h = h.toLowerCase();
    if (!hosts.has(h)) hosts.set(h, where);
  };
  const files = [...PAGES, 'web/styles.css'];
  for (const rel of files) {
    if (!existsSync(join(ROOT, rel))) continue;
    const raw = read(rel);
    // Comments are documentation, not requests — the same rule check D uses.
    // download.html and join.html both cite itunes.apple.com in a comment.
    const body = raw.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
    body.split('\n').forEach((line, i) => {
      if (COMMENT.test(line)) return;
      const where = `${rel}:${i + 1}`;
      const patterns = [
        /<script[^>]+src="(https?:\/\/[^"]+)"/gi,
        /<(?:img|iframe|source|video|audio|embed|track)[^>]+src="(https?:\/\/[^"]+)"/gi,
        /<link[^>]+href="(https?:\/\/[^"]+)"/gi,
        /@import\s+url\(['"]?(https?:\/\/[^'")]+)/gi,
        /\bimport\s*\(?\s*['"](https?:\/\/[^'"]+)/gi,
        /\bfrom\s+['"](https?:\/\/[^'"]+)/gi,
        /\bfetch\s*\(\s*['"`](https?:\/\/[^'"`]+)/gi,
        /createClient\s*\(\s*['"](https?:\/\/[^'"]+)/gi,
      ];
      for (const re of patterns) {
        for (const m of line.matchAll(re)) {
          try { add(new URL(m[1]).hostname, where); } catch { /* not a URL we can read */ }
        }
      }
    });
  }
  return hosts;
}

function checkSiteHosts(seen) {
  const hosts = siteHosts();
  // The empty-set guard, in the same spirit as check D's. styles.css imports
  // three font families and six pages import a module from a CDN, so a run
  // that finds nothing has stopped reading rather than found a clean site.
  if (hosts.size < 3) {
    fatal.push(`only ${hosts.size} external hosts found across web/ — the stylesheet alone contacts two, and six pages import a module from a third. The scan in siteHosts() has gone blind; refusing to pass.`);
    return;
  }
  seen.siteHosts = hosts.size;
  const privacy = 'web/privacy.html';
  const disclosed = pageText(read(privacy));
  for (const [host, where] of [...hosts].sort()) {
    if (FIRST_PARTY.has(host) || SITE_NOT_PROCESSORS.has(host)) continue;
    const owner = SITE_HOST_OWNERS.get(host) ?? HOST_OWNERS.get(host);
    if (!owner) {
      fatal.push(`${where} makes a browser contact ${host}, and nothing here says who that is.\n`
        + `      This is a request a STRANGER'S browser makes before they have agreed to anything.\n`
        + `      Decide, then record the decision in scripts/check-site-claims.mjs:\n`
        + `        · it receives something about a visitor → add it to SITE_HOST_OWNERS *and* name that company on ${privacy}\n`
        + `        · one of ours                          → FIRST_PARTY\n`
        + `        · an identifier rather than an address → SITE_NOT_PROCESSORS, with the reason\n`
        + `      Google Fonts sat in styles.css unmentioned by the privacy policy for the life of this site,\n`
        + `      on a page that simultaneously said Google was used "for coaches only".`);
      continue;
    }
    const named = new RegExp(`\\b${owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(disclosed);
    if (!named) {
      note(privacy, 1, `does not name ${owner}, which this website makes every visitor's browser contact: ${host} (${where})`,
        `A host the site loads a resource from receives the visitor's IP address, user-agent and the page they are on, with no opportunity to decline. Name it — the section is "This website, separately from the apps" — or, if it is an identifier rather than a fetch, say so in SITE_NOT_PROCESSORS with the reason.`);
    }
  }
}

/* ── H · the Content-Security-Policy permits what the pages actually use ─── */
//
// `web/_headers` carries a CSP. Nothing else in this repo can notice when it
// stops matching the site, and the failure mode is asymmetric in the worst way:
// `npx serve web` does not read `_headers`, so a broken policy is invisible on
// every local run and every preview, and shows up only in production — as a
// blank page, a page with no styling, or a signup form whose submit button
// silently does nothing because the module behind it was refused.
//
// So: every host check G found must be permitted by some directive in the
// policy. This does not attempt to validate CSP semantics in general; it
// answers one question — is a host the pages demonstrably use missing from the
// policy that will be in front of them?

function checkCsp(seen) {
  const rel = 'web/_headers';
  if (!existsSync(join(ROOT, rel))) {
    fatal.push(`${rel} does not exist, so the security headers this gate checks have no home. If they were deliberately removed, remove check H with them rather than leaving a check that inspects nothing.`);
    return;
  }
  const headers = read(rel);
  const m = /^\s+Content-Security-Policy:\s*(.+)$/m.exec(headers);
  if (!m) {
    fatal.push(`${rel} declares no Content-Security-Policy. Six pages under web/ execute a module fetched from a third-party CDN and three of those are where a password is typed; the policy is what bounds that. Restore it, or delete check H and say here why the site no longer has one.`);
    return;
  }
  const csp = m[1].trim();
  seen.csp = csp.split(';').filter((d) => d.trim()).length;
  const permitted = new Set();
  for (const directive of csp.split(';')) {
    for (const tok of directive.trim().split(/\s+/).slice(1)) {
      if (/^https?:\/\//.test(tok)) { try { permitted.add(new URL(tok).hostname.toLowerCase()); } catch { /* ignore */ } }
    }
  }
  for (const [host, where] of [...siteHosts()].sort()) {
    if (SITE_NOT_PROCESSORS.has(host)) continue;      // never fetched
    if (FIRST_PARTY.has(host)) continue;              // 'self' once deployed
    if (!permitted.has(host)) {
      note(rel, 1, `the Content-Security-Policy does not permit ${host}, which ${where} loads a resource from`,
        `In production Cloudflare serves this policy and the browser refuses the request — a stylesheet that never arrives, or a sign-in module that never runs. Local \`npx serve web\` ignores _headers entirely, so this will not reproduce before it ships. Add the host to the right directive, or stop loading it.`);
    }
  }
}

/* ── E · the connectable wearables ───────────────────────────────────────── */
//
// Marker-anchored, and that is a considered choice rather than a shortcut.
//
// "Fitbit appears on a page" is not a violation: privacy.html, support.html and
// delete-account.html all name Fitbit and Garmin correctly, precisely in order
// to say they cannot be connected, and a gate that failed on those would be
// pushing the site towards saying LESS. What is a violation is a page listing a
// vendor as one you can connect. That is a claim about a set, so the page
// declares where it makes it, and the gate compares the set.
//
//     <!-- site-claim: wearables-connect -->
//     <li>…WHOOP and Oura…</li>
//
// The block after the marker, up to its closing tag, must name exactly the
// cloud vendors this build can connect — no more (the Fitbit bug) and no fewer
// (a vendor going live and the page not saying so). Apple Health and Health
// Connect are not cloud OAuth and are ignored entirely, so a block may mention
// them freely.
//
// Its blast radius is one marked claim per page, and that is stated plainly
// here so nobody mistakes it for a sweep of the whole site.

function connectableVendors() {
  const registry = read('src/lib/wearables/registry.ts');
  const oauth = read('src/lib/wearables/oauthConfig.ts');

  // Cloud rows only. `appleHealth` is a native module and the Health Connect
  // row is the phone's own store; neither has a client id to be missing.
  const cloud = [];
  for (const m of registry.matchAll(/cloud\(\{\s*id:\s*'([a-z0-9]+)'\s*,\s*name:\s*'([^']+)'[^}]*?kind:\s*'([a-z-]+)'/g)) {
    if (m[3] === 'cloud') cloud.push({ id: m[1], name: m[2] });
  }
  if (cloud.length < 2) {
    fatal.push(`src/lib/wearables/registry.ts yielded ${cloud.length} cloud vendors, which cannot be right — the catalogue lists at least WHOOP, Oura, Garmin and Fitbit. The shape of that file has changed; re-point this parser before trusting check E.`);
    return null;
  }

  // Where each vendor's client id comes from, read out of oauthConfig rather
  // than guessed from its id — the env var name is stated there.
  const configuredIn = [];
  const app = JSON.parse(read('app.json'));
  configuredIn.push(app?.expo?.extra ?? {});
  if (existsSync(join(ROOT, 'eas.json'))) {
    const eas = JSON.parse(read('eas.json'));
    for (const profile of Object.values(eas?.build ?? {})) if (profile?.env) configuredIn.push(profile.env);
  }
  const hasValue = (key) => configuredIn.some((src) => typeof src[key] === 'string' && src[key].trim() !== '');

  const out = [];
  for (const v of cloud) {
    const at = oauth.indexOf(`id: '${v.id}'`);
    const slice = at < 0 ? '' : oauth.slice(at, oauth.indexOf("id: '", at + 8) < 0 ? oauth.length : oauth.indexOf("id: '", at + 8));
    const envVar = /clientId:\s*env\('([A-Z0-9_]+)'\)/.exec(slice)?.[1];
    const partnership = /special:\s*'partnership'/.test(slice);
    const connectable = at >= 0 && !partnership && !!envVar && hasValue(envVar);
    // The catalogue name may be two words ("Oura Ring") while the page writes
    // one. The first word is the vendor; the rest is the product.
    out.push({ ...v, token: v.name.split(/[\s/]+/)[0], connectable });
  }
  return out;
}

const MARKER = /<!--\s*site-claim:\s*wearables-connect\b[^>]*-->/g;

function checkWearables(vendors, seen) {
  if (!vendors) return;
  const can = vendors.filter((v) => v.connectable);
  if (can.length === 0) {
    fatal.push('no cloud wearable vendor resolves as connectable, which cannot be right — WHOOP and Oura both carry client ids in app.json. The parser in connectableVendors() has gone stale; refusing to pass on a set this gate does not believe.');
    return;
  }
  for (const page of PAGES) {
    const raw = read(page);
    for (const m of [...raw.matchAll(MARKER)]) {
      seen.markers++;
      const from = m.index + m[0].length;
      const end = [...raw.slice(from).matchAll(/<\/(li|p|td|div|span)>/g)][0];
      const block = text(raw.slice(from, end ? from + end.index : from + 600));
      const line = raw.slice(0, m.index).split('\n').length;
      const found = vendors.filter((v) => new RegExp(`\\b${v.token}\\b`).test(block)).map((v) => v.token);
      const wantList = can.map((v) => v.token);
      const extra = found.filter((t) => !wantList.includes(t));
      const absent = wantList.filter((t) => !found.includes(t));
      if (!extra.length && !absent.length) continue;
      const lines = raw.split('\n');
      if (excused(lines, line - 1)) continue;
      const why = [];
      if (extra.length) why.push(`offers ${extra.join(', ')} as connectable`);
      if (absent.length) why.push(`omits ${absent.join(', ')}, which this build CAN connect`);
      note(page, line, `a wearables-connect claim ${why.join(' and ')} — "${block.slice(0, 120)}"`,
        `the vendors with an OAuth entry, no partnership gate and a client id in app.json or eas.json are: ${wantList.join(', ')}`
        + ` (${vendors.filter((v) => !v.connectable).map((v) => v.token).join(', ')} cannot be connected by anybody)`);
    }
  }
  if (seen.markers === 0) {
    fatal.push('no `<!-- site-claim: wearables-connect -->` marker anywhere under web/, so check E compared nothing.\n'
      + '      The marker sits directly above the sentence that lists the devices a client can connect —\n'
      + '      web/client.html had one. If that sentence has moved, move the marker with it. If it has been\n'
      + '      deleted, delete check E rather than leaving a check that silently inspects nothing.');
  }
}

/* ── F · the deletion figure ─────────────────────────────────────────────── */
//
// The three counts on this chart come from a query over the live database's
// foreign keys, which this gate cannot run. So it checks the things that go
// wrong when a person updates them by hand, and every one of those has already
// happened to a chart in this repo:
//
//   1. The provenance stamp stops being a date, or starts being in the future.
//      "Counted from the live catalogue" with no readable date is worse than no
//      claim at all — it is authority without a way to check it.
//   2. The `aria-label` and the visible chart disagree. The label repeats every
//      figure in prose for a screen reader, so a partial edit leaves a blind
//      reader with the old number and no way to know.
//   3. A bar keeps the width it was drawn at for the old value. The axis says
//      what a pixel is worth, so this is arithmetic, not judgement.
//
// If this fails after a re-count, the fix is to finish the edit — all three
// places and the stamp — not to relax the check.
//
// ── WHAT THIS CHECK CANNOT SEE, MEASURED RATHER THAN ASSUMED ──────────────
//
// Read the list above again and notice what is missing from it: a database.
// Check F compares the chart's figures WITH EACH OTHER, and the stamp with the
// calendar. It has no way to ask whether any of them is true of anything, and
// on 14 September 2026 that limit stopped being theoretical. The chart was
// stamped 3 September 2026 and read 66 tables / 74 columns cascading, 50 tables
// / 69 columns kept, 106 reached in total. Measured against the live catalogue
// that same fortnight: 68 / 76, 59 / 81, and 129. ALL FIVE figures had drifted
// — and the aria-label agreed with the chart, every bar was drawn to its own
// value, and the stamp parsed and was in the past, so check F passed the chart
// on every run in between.
//
// That is not a bug in check F. It is the whole of what a gate with no
// credentials can do. It is written down here because a gate that is READ as
// saying more than it checks is worse than no gate: the stamp LOOKS like
// provenance, and a reader who sees this go green beside it concludes the
// number was verified. It was not. Three things carry the part check F cannot:
//
//   · the `do $$` block at the foot of supabase/parts/41-account-deletion.sql,
//     which re-runs the closure against whatever database setup.sql is applied
//     to and raises a WARNING when it has grown. That is the only mechanism in
//     this repo that can see the real number.
//   · check O below, which does not know the number either, but makes every
//     file that states it state the SAME one, with its date and its query.
//   · a person with a psql prompt, which the chart's own comment names.
//
// Parsing supabase/setup.sql is not a fourth option and must not be offered as
// one: a `create table` clause is not the last word on a foreign key, part 184
// drops and recreates three of them as `on delete set null`, and file parses
// have produced 120, 122 and 125 against a live 118.

function checkDeletionFigure() {
  const page = 'web/security.html';
  if (!existsSync(join(ROOT, page))) { fatal.push(`${page} does not exist; check F has nothing to inspect.`); return; }
  const raw = read(page);
  const at = raw.indexOf('id="deletion"');
  if (at < 0) { fatal.push(`${page} has no id="deletion" section, so the account-deletion figures could not be located. Refusing to pass.`); return; }
  const section = raw.slice(at, raw.indexOf('</section>', at) + 10);
  const lineOf = (idx) => raw.slice(0, at + idx).split('\n').length;

  // 1 · the stamp
  const stamp = /Counted from the live catalogue,\s*(\d{1,2} [A-Z][a-z]+ \d{4})/.exec(section);
  if (!stamp) {
    note(page, lineOf(0), 'the deletion figures carry no readable "Counted from the live catalogue, <D Month YYYY>" stamp',
      'These numbers move whenever a cascading foreign key is added and cannot be checked offline. The date is the only thing that tells a reader how old they are, so it is the part that is gated.');
  } else {
    const when = new Date(`${stamp[1]} UTC`);
    if (Number.isNaN(when.getTime())) {
      note(page, lineOf(stamp.index), `the deletion figures are stamped "${stamp[1]}", which is not a date`,
        'It must parse as `D Month YYYY`, e.g. "3 September 2026".');
    } else if (when.getTime() > Date.now() + 86400000) {
      note(page, lineOf(stamp.index), `the deletion figures are stamped "${stamp[1]}", which is in the future`,
        'A count cannot have been taken from a catalogue that has not happened yet.');
    }
  }

  // 2 · the screen reader and the eyes read the same chart
  const svg = /<svg[\s\S]*?<\/svg>/.exec(section);
  if (!svg) { fatal.push(`${page}'s deletion section contains no <svg>; the chart this gate checks has been replaced. Re-point check F or remove it.`); return; }
  const label = /aria-label="([^"]*)"/.exec(svg[0]);
  if (!label) {
    note(page, lineOf(svg.index), 'the deletion chart has no aria-label', 'A chart that only exists as pixels is a chart a blind reader is told nothing by.');
  }
  const bag = (s) => [...String(s).matchAll(/(\d+)\s+(tables|columns)\b/g)].map((m) => `${m[1]} ${m[2]}`).sort();
  const visible = bag([...svg[0].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => text(m[1])).join(' | '));
  const spoken = label ? bag(label[1]) : [];
  if (label && (spoken.join(', ') !== visible.join(', '))) {
    note(page, lineOf(label.index), `the deletion chart's aria-label says [${spoken.join(', ')}] and the chart itself says [${visible.join(', ')}]`,
      'They are the same chart. A screen reader is being given a figure the page no longer shows — which is what a half-finished re-count looks like.');
  }
  if (visible.length < 3) {
    fatal.push(`${page}'s deletion chart yielded only ${visible.length} labelled figures. It has been redrawn and check F is no longer reading it. Refusing to pass.`);
    return;
  }

  // 3 · every bar is drawn to its own number
  const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const ticks = [...svg[0].matchAll(/<text[^>]*x="([\d.]+)"[^>]*>\s*(\d+)\s*<\/text>/g)].map((m) => ({ x: Number(m[1]), v: Number(m[2]) }));
  if (ticks.length >= 2) {
    const lo = ticks.reduce((a, b) => (b.v < a.v ? b : a));
    const hi = ticks.reduce((a, b) => (b.v > a.v ? b : a));
    if (hi.v > lo.v) {
      const perUnit = (hi.x - lo.x) / (hi.v - lo.v);
      const bars = [...svg[0].matchAll(/<rect[^>]*\/>/g)].map((m) => attrs(m[0]))
        .filter((a) => a.width && a.y && a.x).sort((a, b) => Number(a.y) - Number(b.y));
      const vals = [...svg[0].matchAll(/<text[^>]*class="cx-val"[^>]*>([^<]*)<\/text>/g)]
        .map((m) => ({ y: Number(attrs(m[0]).y ?? 0), n: Number(/(\d+)/.exec(text(m[1]))?.[1]) }))
        .sort((a, b) => a.y - b.y);
      if (bars.length === vals.length) {
        bars.forEach((bar, i) => {
          const want = vals[i].n * perUnit;
          if (Math.abs(Number(bar.width) - want) > 0.75) {
            note(page, lineOf(svg.index), `a deletion bar is ${bar.width}px wide for a value of ${vals[i].n}`,
              `the axis runs ${lo.v} at x=${lo.x} to ${hi.v} at x=${hi.x}, so ${vals[i].n} is ${want.toFixed(1)}px. The number was changed and the bar was not.`);
          }
        });
      }
    }
  }
}

/* ── O · the erasure figure, everywhere this repo states it ─────────────── */
//
// Check F holds ONE copy of this figure — the chart on web/security.html — and
// holds it only against itself. The figure lives on eight files. On
// 14 September 2026 five surfaces were found saying 39 when the answer was 129,
// a count taken when the schema was a quarter of its present size and never
// re-taken; each of the five had been copied out of a different file's comment.
// Nothing in that story could not happen again with 129: a ninth surface
// appears, or one of the eight is updated and the rest are not.
//
// THIS CHECK DOES NOT KNOW THE NUMBER EITHER. It cannot — see check F's note.
// What it does is make the repo have ONE of them. The pin is the `do $$` block
// at the foot of supabase/parts/41-account-deletion.sql, chosen because it is
// the only statement in this repo that can actually MEASURE the figure, against
// whatever database setup.sql is applied to, and because a threshold in SQL is
// machine-readable. This gate reads 118 and 11 out of that block's condition
// and the measurement date out of the warning beside it, then requires:
//
//   1. Every file stating the figure states the SAME pair. A count beside
//      `public` must equal the pinned public count, one beside `auth` the
//      pinned auth count, and an "N in all" their sum. This is the drift that
//      actually happens — the password minimum was corrected on four screens
//      and missed on the fifth, and the 39 survived on five.
//   2. Every such file carries the date the figure was measured, and a way to
//      re-measure it: the token `pg_constraint`, or a citation of the pin. A
//      number on an irreversible confirmation with no date cannot be told from
//      a stale one, which is exactly how 39 lasted as long as it did.
//   3. At least four such files exist. A run finding none has gone blind and
//      would otherwise print the same "ok" as a clean repo.
//
// WHAT IT CANNOT DO, stated so nobody reads the green as more than it is:
//
//   · It cannot tell whether 118 is true. Nothing offline can.
//   · It reads the CANONICAL PHRASING — "N tables in `public`", "N more inside
//     … `auth`", "N in all", `CASCADE_TABLES = N`. A ninth surface inventing a
//     new way to say it is invisible to this, and one phrasing already is: the
//     118 in src/ui/notifications.tsx is written "118 tables of gym data" and is
//     reached only through the 11 and the 129 beside it.
//   · It does not read supabase/setup.sql. That file is generated from the
//     parts this does read, so it would only double-count.
//   · It says nothing about whether the sentence around the figure is right.
//     Both halves of "their invoices and memberships go too" were wrong on four
//     surfaces while every number beside them agreed.

const FIG_PIN = 'supabase/parts/41-account-deletion.sql';
const FIG_ROOTS = ['web', 'app', 'src', 'studio-web', 'supabase/parts', 'docs'];
const FIG_EXT = /\.(tsx?|jsx?|mjs|sql|html|md)$/;
const FIG_SKIP = /node_modules|[\\/](\.next|dist|build|\.expo|\.preflight-export)[\\/]/;

// "118 tables in `public`", "11 more inside Supabase's own `auth` schema".
// The span between the number and the schema name may not contain another
// digit, so "118 tables … plus 11 more inside `auth`" reads as 11/auth rather
// than pairing 118 with the wrong schema.
const FIG_SCHEMA = /(\d{1,4})\s+(?:more\s+)?(?:tables?\s+)?(?:in|inside)\b[^.\n\d]{0,60}?[`'"]?(public|auth)\b/gi;
const FIG_INALL = /\b(\d{1,4})\s+in all\b/gi;
const FIG_CONST = /CASCADE_TABLES\s*=\s*(\d+)/g;
// Both supabase/parts/2612 and docs/ROADMAP.md say "159 tables in `public`"
// about the SIZE of the schema, which is a different claim. This cue window is
// what tells them apart, and is the reason it is a window and not a whole-file
// test — 2612 mentions deletion elsewhere in its own length.
const FIG_CUE = /delet|erasure|cascad/i;
const FIG_OK = /cascade-figure-ok:/;

function erasurePin() {
  if (!existsSync(join(ROOT, FIG_PIN))) {
    fatal.push(`${FIG_PIN} does not exist, so the erasure figure has no pinned value and check O cannot run. Re-point it at the new home of the \`do $$\` block that re-measures the cascade.`);
    return null;
  }
  const raw = read(FIG_PIN);
  const cond = /n_public\s*>\s*(\d+)\s+or\s+n_auth\s*>\s*(\d+)/.exec(raw);
  if (!cond) {
    fatal.push(`${FIG_PIN} no longer carries a \`do $$\` block testing \`n_public > <N> or n_auth > <N>\`. That block is the pinned figure every other surface is checked against, and the only thing in this repo that can measure it. Either it moved — re-point check O — or it was deleted, in which case the figure is ungated on eight files and check O must go with it rather than be left passing.`);
    return null;
  }
  const when = /measured (\d{1,2} [A-Z][a-z]+ \d{4})/.exec(raw);
  if (!when) {
    fatal.push(`${FIG_PIN}'s warning no longer names the date the figure was measured ("… measured <D Month YYYY>"). A pinned number with no date cannot be told from a stale one.`);
    return null;
  }
  const [, dd, mon] = /^(\d{1,2}) ([A-Z][a-z]+) \d{4}$/.exec(when[1]);
  return {
    pub: Number(cond[1]),
    auth: Number(cond[2]),
    date: when[1],
    // parts/1120 writes "14 Sep 2026"; everything else writes the month out.
    // Both are the date, and a gate that accepted only one would be asking for
    // a house style rather than for provenance.
    dateRe: new RegExp(`\\b${dd} ${mon.slice(0, 3)}(?:${mon.slice(3)})? \\d{4}\\b`),
  };
}

function figFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (FIG_SKIP.test(p)) continue;
    if (e.isDirectory()) figFiles(p, out);
    else if (FIG_EXT.test(e.name)) out.push(p);
  }
  return out;
}

function checkErasureFigure(pin, seen) {
  if (!pin) return;
  const expect = new Map([['public', pin.pub], ['auth', pin.auth], ['in all', pin.pub + pin.auth]]);

  for (const abs of FIG_ROOTS.flatMap((r) => figFiles(join(ROOT, r)))) {
    const rel = relative(ROOT, abs);
    const raw = readFileSync(abs, 'utf8');
    const lines = raw.split('\n');
    const lineOf = (i) => raw.slice(0, i).split('\n').length;
    const hits = [];

    for (const [re, kind] of [[FIG_SCHEMA, null], [FIG_INALL, 'in all'], [FIG_CONST, 'public']]) {
      re.lastIndex = 0;
      for (const m of raw.matchAll(re)) {
        if (re !== FIG_CONST && !FIG_CUE.test(raw.slice(Math.max(0, m.index - 700), m.index + 700))) continue;
        const line = lineOf(m.index);
        if (FIG_OK.test(lines.slice(Math.max(0, line - 3), line).join('\n'))) continue;
        hits.push({ line, n: Number(m[1]), of: kind ?? m[2].toLowerCase(), said: m[0].trim() });
      }
    }
    if (!hits.length) continue;
    seen.erasure += 1;

    for (const h of hits) {
      const want = expect.get(h.of);
      if (h.n !== want) {
        note(rel, h.line, `it states the erasure reaches ${h.n} ${h.of === 'in all' ? 'tables in all' : 'tables in `' + h.of + '`'} ("${h.said}")`,
          `${FIG_PIN} pins ${pin.pub} in \`public\` and ${pin.auth} in \`auth\`, ${pin.pub + pin.auth} in all, measured ${pin.date}. Eight files state this figure and they must state one number between them: five of them said 39 for however long it took a person to re-measure by hand. If the schema has grown, re-run the query in ${FIG_PIN}'s header, move the threshold in its \`do $$\` block, and bring every surface with it.`);
      }
    }
    if (!pin.dateRe.test(raw)) {
      note(rel, hits[0].line, 'it states the erasure figure without the date it was measured',
        `Every other file carrying this number carries "${pin.date}" beside it. A figure on an irreversible confirmation with no date cannot be told from a stale one, and that is precisely how 39 survived on five surfaces. Copy the date from ${FIG_PIN}.`);
    }
    if (!/pg_constraint/.test(raw) && !/41-account-deletion|part 41/i.test(raw)) {
      note(rel, hits[0].line, 'it states the erasure figure with no way to re-measure it',
        `This number moves whenever a cascading foreign key is added, so a file stating it must also carry the catalogue query — the token \`pg_constraint\` — or cite ${FIG_PIN}, which holds it. Otherwise the next reader has a number and nothing to check it with.`);
    }
  }

  // The empty-set guard, as on checks B, D, G and N. Eight files state this
  // figure today. A run finding none has stopped matching the way the repo
  // writes it, and a blind detector prints the same "ok" as a clean tree.
  if (seen.erasure < 4) {
    fatal.push(`check O found the erasure figure stated in only ${seen.erasure} file${seen.erasure === 1 ? '' : 's'}. Eight state it — web/security.html, web/studio.html, app/(owner)/deletions.tsx, src/ui/notifications.tsx, studio-web/app/deletions/page.tsx, and supabase/parts/41, 1120 and 2370. Either they stopped saying it, or the phrasing moved out from under FIG_SCHEMA / FIG_INALL / FIG_CONST and this check is now reading nothing.`);
  }
}

/* ── I · the exercise catalogue's three figures ──────────────────────────── */
//
// `/client` and `/trainer` both state the size of the exercise catalogue, and
// they stated 604 while the live table held 608. Not a dangerous number — it
// UNDER-sells the product — but it is the same defect as every other one this
// file exists for: a figure on a marketing page that nothing connects to the
// thing it describes, quietly ageing.
//
// It cannot be gated on its VALUE. The counts come from one query over
// `public.exercises`, this gate runs offline with no credentials, and check F's
// note above sets out why a gate must not pretend to know a number it cannot
// read. So the same treatment check F gives the deletion chart:
//
//   1. Every page stating the total must state the SAME total. This is the
//      failure that actually happens — the password minimum was fixed on four
//      screens and missed on the fifth, and a catalogue figure quoted on two
//      pages will be updated on one of them.
//   2. The figures must nest: animated ⊆ illustrated ⊆ total. A hand edit that
//      moves one and not the others produces "608 movements, 610 illustrated",
//      which is arithmetic rather than judgement.
//   3. Somewhere on a page that states them there must be a parseable
//      "Counted from the live catalogue, <D Month YYYY>" stamp that is not in
//      the future — the only thing that tells a reader how old the number is.
//
// The re-count query is in the comment above the claim on web/client.html.

const CAT_MARKER = /<!--\s*site-claim:\s*catalogue-figures\b[^>]*-->/g;

function checkCatalogueFigures(seen) {
  const totals = new Map();                      // total → ["page:line", …]
  for (const page of PAGES) {
    const raw = read(page);
    const lines = raw.split('\n');
    for (const m of [...raw.matchAll(CAT_MARKER)]) {
      seen.catalogue++;
      const line = raw.slice(0, m.index).split('\n').length;
      // The claim is the marked comment's own paragraph: from the marker to the
      // end of the element it introduces, exactly as check E reads its block.
      const from = m.index + m[0].length;
      const end = [...raw.slice(from).matchAll(/<\/(li|p|td|span|div)>/g)][0];
      const block = text(raw.slice(from, end ? from + end.index : from + 700));

      const total = /catalogue (?:carries|of) (\d+) movements/i.exec(block);
      if (!total) {
        note(page, line, 'carries a catalogue-figures marker and states no "catalogue of <N> movements"',
          'The marker exists so this gate can compare the figure across the pages that state it. A marker above a sentence that no longer states a total compares nothing — move the marker, or delete it with the claim.');
        continue;
      }
      const n = Number(total[1]);
      totals.set(n, [...(totals.get(n) ?? []), `${page}:${line}`]);

      const illustrated = /(\d+)\s+of\s+them\s+illustrated|(\d+)\s+illustrated/i.exec(block);
      const animated = /(\d+)\s+of\s+(?:those|them)\s+as\s+a\s+looping\s+animation/i.exec(block);
      const ill = illustrated ? Number(illustrated[1] ?? illustrated[2]) : null;
      const anim = animated ? Number(animated[1]) : null;
      if (ill !== null && ill > n && !excused(lines, line - 1)) {
        note(page, line, `states ${ill} illustrated movements out of a catalogue of ${n}`,
          'A subset cannot be larger than the set it is a subset of. One of the two was moved by hand and the other was not.');
      }
      if (anim !== null && ill !== null && anim > ill && !excused(lines, line - 1)) {
        note(page, line, `states ${anim} animated movements out of ${ill} illustrated ones`,
          'Every animated movement is an illustrated one. These moved apart in a hand edit.');
      }
    }
  }
  if (seen.catalogue === 0) {
    fatal.push('no `<!-- site-claim: catalogue-figures -->` marker anywhere under web/, so check I compared nothing.\n'
      + '      The marker sits directly above each sentence that states the size of the exercise catalogue —\n'
      + '      web/client.html and web/trainer.html each had one. If the claim has moved, move the marker.\n'
      + '      If it has been deleted from both pages, delete check I rather than leaving a check that\n'
      + '      silently inspects nothing.');
    return;
  }
  if (totals.size > 1) {
    const said = [...totals].map(([n, where]) => `${n} (${where.join(', ')})`).join('; ');
    note('web/', 1, `the pages disagree about how many movements the catalogue holds: ${said}`,
      'There is one catalogue. Somebody re-counted it and updated one page. Re-run the query in the comment on web/client.html and move every figure, and the stamp beneath it, together.');
  }
  // The stamp, on whichever page carries the full claim.
  const stamped = PAGES.filter((p) => /Counted from the live catalogue,/.test(read(p)) && CAT_MARKER.test(read(p)));
  CAT_MARKER.lastIndex = 0;
  if (stamped.length === 0) {
    note('web/client.html', 1, 'the catalogue figures carry no "Counted from the live catalogue, <D Month YYYY>" stamp on any page that states them',
      'These numbers cannot be checked offline, so the date they were taken is the only thing a reader has. It is the part that is gated.');
  }
  for (const page of stamped) {
    const raw = read(page);
    const m = /Counted from the live catalogue,\s*(\d{1,2} [A-Z][a-z]+ \d{4})/.exec(pageText(raw));
    const line = raw.slice(0, raw.indexOf('Counted from the live catalogue')).split('\n').length;
    if (!m) {
      note(page, line, 'the catalogue stamp is not followed by a readable date',
        'It must parse as `D Month YYYY`, e.g. "4 September 2026".');
      continue;
    }
    const when = new Date(`${m[1]} UTC`);
    if (Number.isNaN(when.getTime())) {
      note(page, line, `the catalogue figures are stamped "${m[1]}", which is not a date`, 'It must parse as `D Month YYYY`.');
    } else if (when.getTime() > Date.now() + 86400000) {
      note(page, line, `the catalogue figures are stamped "${m[1]}", which is in the future`,
        'A count cannot have been taken from a catalogue that has not happened yet.');
    }
  }
}

/* ── J · every internal link resolves ────────────────────────────────────── */
//
// The site is served extensionless — `/pricing`, not `/pricing.html` — so a
// link to a page that does not exist is not a build error, not a 404 anybody
// sees in review, and not visible in any editor. It is a 404 for a stranger,
// on the one surface where a stranger is deciding whether to trust this.
//
// Nothing checked this. Twenty-two pages carried about six hundred internal
// links between them and the only thing standing between a typo and a dead
// link on the pricing page was somebody noticing.
//
// The rule: every same-origin href must resolve to a file under web/, and every
// `#fragment` must be an id that exists on the page it points at. Both halves
// matter — a footer link to a page that does not exist and an in-page jump to a
// section somebody renamed fail in exactly the same way for the reader.

function checkLinks(seen) {
  const exists = new Set();
  for (const rel of PAGES) {
    const base = rel.replace(/^web\//, '').replace(/\.html$/, '');
    exists.add('/' + base);
    exists.add('/' + base + '.html');
    if (base === 'index') exists.add('/');
  }
  // Everything else served out of web/ that is not a page: images, the badges,
  // the stylesheet, robots.txt. Read from disk rather than listed, so adding a
  // file is enough to link to it.
  (function walkAll(dir, prefix) {
    let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isDirectory()) walkAll(join(dir, e.name), `${prefix}${e.name}/`);
      else { exists.add(`${prefix}${e.name}`); exists.add(`/${prefix}${e.name}`.replace('//', '/')); }
    }
  })(join(ROOT, 'web'), '');

  const idsOf = new Map();                       // page → Set of ids
  const idsFor = (rel) => {
    if (!idsOf.has(rel)) {
      idsOf.set(rel, new Set([...read(rel).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])));
    }
    return idsOf.get(rel);
  };

  for (const page of PAGES) {
    const raw = read(page);
    const lines = raw.split('\n');
    lines.forEach((line, i) => {
      if (COMMENT.test(line)) return;
      for (const m of line.matchAll(/\bhref="([^"]*)"/g)) {
        const href = m[1];
        // Off-site, a mail link, a deep link into an app, or an empty anchor:
        // none of them is a file in this repository.
        if (/^(?:https?:|mailto:|tel:|data:|[a-z]+:\/\/|repple)/i.test(href)) continue;
        if (href === '' || href === '#') continue;
        seen.links++;
        const [pathPart, frag] = href.split('#');
        let targetPage = page;
        if (pathPart) {
          const clean = pathPart.split('?')[0];
          // Site-absolute (`/pricing`) or relative to the page's own directory
          // (`../styles.css` from web/ads/callback.html). Resolving relative
          // links as though they were absolute is how this check first reported
          // two working links as broken.
          const dir = page.replace(/^web\//, '').replace(/[^/]*$/, '');
          const abs = clean.startsWith('/')
            ? clean
            : new URL(clean, `http://x/${dir}`).pathname;
          if (!exists.has(abs) && !exists.has(clean)) {
            if (!excused(lines, i)) {
              note(page, i + 1, `links to ${href}, and nothing under web/ answers to it`,
                'The site is served without file extensions, so a link to a page that does not exist is a 404 for a visitor and silence for everybody else. Either the file is missing or the path is a typo.');
            }
            continue;
          }
          const asFile = 'web' + (abs === '/' ? '/index.html' : abs.endsWith('.html') ? abs : abs + '.html');
          targetPage = PAGES.includes(asFile) ? asFile : null;
        }
        // A fragment on a page this gate can read must name an id on it. A
        // fragment on a non-page target (an image, say) is not a claim.
        if (frag && targetPage) {
          if (!idsFor(targetPage).has(frag) && !excused(lines, i)) {
            note(page, i + 1, `links to ${href}, and ${targetPage} has no id="${frag}"`,
              'The browser lands at the top of the page instead of at the thing the link named, which reads as a link that does nothing. Either the id was renamed or the anchor was guessed.');
          }
        }
      }
    });
  }
  if (seen.links < 200) {
    fatal.push(`check J found only ${seen.links} internal links across web/, which cannot be right — the footer alone carries a dozen on every page. The scan has gone blind; refusing to pass.`);
  }
}

/* ── K · the size and shape of the Studio console ────────────────────────── */
//
// `/studio` and `/how-it-works` described "the seven console pages". The
// console's own navigation carries thirty that a gym's owner can open, in five
// groups. Under-claiming by a factor of four is not a lie, but it is the same
// failure as every other entry here — a sentence about the product written once
// and never re-read against it — and it is expensive in the opposite direction:
// a gym owner deciding on the strength of that sentence is being shown a
// quarter of what they would be buying.
//
// The rail is a literal array in one file, so it can be parsed. The count and
// the group names are what the page states, so they are what is compared.
//
// `adminOnly` entries are excluded deliberately: /platform is shown only to an
// account on an allowlist that is empty on a fresh project, so on every gym's
// console that link does not exist and a page claiming it would be wrong.

function consoleRail() {
  const rel = 'studio-web/components/Shell.tsx';
  if (!existsSync(join(ROOT, rel))) {
    fatal.push(`${rel} does not exist, so the console's own page list cannot be read and check K has no source of truth. Point it at the new home, or remove check K and the sentence it holds.`);
    return null;
  }
  const src = read(rel);
  const entries = [];
  for (const m of src.matchAll(/\{\s*href:\s*'([^']+)'[^}]*?group:\s*'([^']+)'([^}]*)\}/g)) {
    entries.push({ href: m[1], group: m[2], adminOnly: /adminOnly:\s*true/.test(m[3]) });
  }
  if (entries.length < 20) {
    fatal.push(`${rel} yielded ${entries.length} navigation entries, which cannot be right — the console rail lists about thirty. The shape of that array has changed; re-point the parser in consoleRail() before trusting check K.`);
    return null;
  }
  const visible = entries.filter((e) => !e.adminOnly);
  return { count: visible.length, groups: [...new Set(visible.map((e) => e.group))] };
}

const RAIL_MARKER = /<!--\s*site-claim:\s*console-rail\b[^>]*-->/g;

function checkConsoleRail(rail, seen) {
  if (!rail) return;
  for (const page of PAGES) {
    const raw = read(page);
    const lines = raw.split('\n');
    for (const m of [...raw.matchAll(RAIL_MARKER)]) {
      seen.rail++;
      const line = raw.slice(0, m.index).split('\n').length;
      const from = m.index + m[0].length;
      const end = [...raw.slice(from).matchAll(/<\/(p|li|div|td)>/g)][0];
      const block = text(raw.slice(from, end ? from + end.index : from + 1600));
      if (excused(lines, line - 1)) continue;

      const stated = new RegExp(`(${NUM}) pages`, 'i').exec(block);
      if (!stated) {
        note(page, line, 'carries a console-rail marker and states no page count',
          `The console's rail lists ${rail.count} pages an owner can open. The marker exists so that number is compared rather than remembered.`);
      } else if (asNumber(stated[1]) !== rail.count) {
        note(page, line, `says the console has ${stated[1]} pages`,
          `studio-web/components/Shell.tsx lists ${rail.count} that a gym's owner can open (${rail.groups.join(', ')}), excluding the platform-admin entry that does not exist on a gym's console. A page was added to the rail and this sentence was not moved with it.`);
      }
      const absent = rail.groups.filter((g) => !new RegExp(`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(block));
      if (absent.length) {
        note(page, line, `names the console's groups and omits ${absent.join(', ')}`,
          `The rail's groups are: ${rail.groups.join(', ')}. A group nobody mentions is a part of the console a reader does not know exists.`);
      }
    }
  }
  if (seen.rail === 0) {
    fatal.push('no `<!-- site-claim: console-rail -->` marker anywhere under web/, so check K compared nothing.\n'
      + '      It sits above the sentence on web/studio.html that says how many pages the console has.\n'
      + '      If that sentence has gone, delete check K with it rather than leaving a check that inspects nothing.');
  }
}

/* ── L · the parts of a gym's export ─────────────────────────────────────── */
//
// `/studio` now tells a gym owner what leaving looks like, and it does it by
// listing the twenty-eight parts of the export bundle by name. That is the
// single most load-bearing table on the page for somebody deciding whether to
// migrate a business onto this, and it is a list — which is to say it is the
// exact shape of claim that rots: a part added to `EXPORT_PARTS` and not to the
// page turns a complete answer into an incomplete one with no visible edit.
//
// So the table's first column must be exactly the labels the code prints,
// no more and no fewer.

function exportParts() {
  const rel = 'src/lib/gymExport.ts';
  if (!existsSync(join(ROOT, rel))) {
    fatal.push(`${rel} does not exist, so the gym export's own list of parts cannot be read. The claim on web/studio.html is ungated; point check L at the new home or remove both.`);
    return null;
  }
  const src = read(rel);
  const list = /export const EXPORT_PARTS:[^=]*=\s*\[([\s\S]*?)\];/.exec(src);
  const labels = /export const EXPORT_LABEL:[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  if (!list || !labels) {
    fatal.push(`${rel} no longer declares EXPORT_PARTS and EXPORT_LABEL in the shape check L reads. The table on web/studio.html mirrors them, so it is now ungated.`);
    return null;
  }
  const parts = [...list[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
  const label = new Map([...labels[1].matchAll(/(\w+):\s*'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => [m[1], m[2].replace(/\\'/g, "'")]));
  if (parts.length < 10) {
    fatal.push(`only ${parts.length} export parts parsed out of ${rel}; the format moved. Refusing to pass on a set this gate does not believe.`);
    return null;
  }
  return parts.map((p) => ({ part: p, label: label.get(p) ?? null }));
}

const EXPORT_MARKER = /<!--\s*site-claim:\s*export-parts\b[^>]*-->/g;

function checkExportParts(parts, seen) {
  if (!parts) return;
  const missingLabel = parts.filter((p) => !p.label).map((p) => p.part);
  if (missingLabel.length) {
    fatal.push(`EXPORT_LABEL has no wording for ${missingLabel.join(', ')}, so check L cannot say what web/studio.html should be calling them.`);
    return;
  }
  for (const page of PAGES) {
    const raw = read(page);
    const lines = raw.split('\n');
    for (const m of [...raw.matchAll(EXPORT_MARKER)]) {
      seen.exportParts++;
      const line = raw.slice(0, m.index).split('\n').length;
      if (excused(lines, line - 1)) continue;
      const from = m.index + m[0].length;
      const closeAt = raw.indexOf('</tbody>', from);
      const block = raw.slice(from, closeAt < 0 ? from + 8000 : closeAt);
      const listed = [...block.matchAll(/<th scope="row">([\s\S]*?)<\/th>/g)]
        .map((t) => text(t[1]).toLowerCase());
      const want = parts.map((p) => text(p.label).toLowerCase());
      const absent = want.filter((w) => !listed.includes(w));
      const extra = listed.filter((l) => !want.includes(l));
      if (!absent.length && !extra.length) continue;
      const why = [];
      if (absent.length) why.push(`omits ${absent.map((x) => `"${x}"`).join(', ')}`);
      if (extra.length) why.push(`lists ${extra.map((x) => `"${x}"`).join(', ')}, which the export does not produce`);
      note(page, line, `the export table ${why.join(' and ')}`,
        `EXPORT_PARTS in src/lib/gymExport.ts holds ${parts.length} parts and EXPORT_LABEL names each one. A gym owner reads this table to decide whether their record can leave, so a part that is in the bundle and not on the page understates it — and one on the page and not in the bundle promises a file that will not be there.`);
    }
  }
  if (seen.exportParts === 0) {
    fatal.push('no `<!-- site-claim: export-parts -->` marker anywhere under web/, so check L compared nothing.\n'
      + '      It sits directly above the <tbody> of the export table on web/studio.html. If that table\n'
      + '      has gone, delete check L with it rather than leaving a check that inspects nothing.');
  }
}

/* ── M · the coach's setup list ──────────────────────────────────────────── */
//
// `/coach-setup` publishes the nine-item list Repple Coach opens on, in the
// app's order, using the app's own titles. That is the whole point of the page:
// a coach can read what setting up involves before they sign up rather than
// discovering it one screen at a time. It is worth exactly as much as its
// agreement with the app, and nothing else on the site would notice if a step
// were renamed, reordered or removed.

function coachSetupSteps() {
  const rel = 'src/lib/coachFirstRun.ts';
  if (!existsSync(join(ROOT, rel))) {
    fatal.push(`${rel} does not exist, so the coach setup list cannot be read and the whole of web/coach-setup.html is ungated. Point check M at the new home, or take the page down with it.`);
    return null;
  }
  const titles = [...read(rel).matchAll(/^\s*title:\s*'((?:[^'\\]|\\.)*)',/gm)].map((m) => m[1].replace(/\\'/g, "'"));
  if (titles.length < 5) {
    fatal.push(`only ${titles.length} setup steps parsed out of ${rel}; the shape of that file has moved. Refusing to pass on a list this gate does not believe.`);
    return null;
  }
  return titles;
}

const STEPS_MARKER = /<!--\s*site-claim:\s*coach-setup-steps\b[^>]*-->/g;

function checkCoachSteps(titles, seen) {
  if (!titles) return;
  for (const page of PAGES) {
    const raw = read(page);
    const lines = raw.split('\n');
    for (const m of [...raw.matchAll(STEPS_MARKER)]) {
      seen.coachSteps++;
      const line = raw.slice(0, m.index).split('\n').length;
      if (excused(lines, line - 1)) continue;
      const from = m.index + m[0].length;
      const closeAt = raw.indexOf('</ol>', from);
      const block = raw.slice(from, closeAt < 0 ? from + 12000 : closeAt);
      const listed = [...block.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((t) => text(t[1]));
      if (listed.join(' | ') === titles.join(' | ')) continue;
      note(page, line, `the setup list reads [${listed.join(', ')}]`,
        `COACH_SETUP_STEPS in src/lib/coachFirstRun.ts is [${titles.join(', ')}], in that order. This page exists to show a coach the app's own list before they sign up; a list that has drifted from it is worse than no list, because it will be believed.`);
    }
  }
  if (seen.coachSteps === 0) {
    fatal.push('no `<!-- site-claim: coach-setup-steps -->` marker anywhere under web/, so check M compared nothing.\n'
      + '      It sits directly above the <ol class="steps"> on web/coach-setup.html — the nine items that\n'
      + '      page exists to publish. If the page has gone, delete check M with it.');
  }
}

/* ── N · a store badge is never shown without the caveat beside it ───────── */
//
// Every "Download on the App Store" and "Get it on Google Play" badge under
// web/ links to an address that DOES NOT RESOLVE. Checked again on 13 Sep 2026
// and nothing has moved since 26 Aug: `itunes.apple.com/lookup` answers
// `resultCount 0` for 6790096518, 6804358275 and 6804417240, and all three
// Play pages answer 404. The apps exist on App Store Connect and are on
// TestFlight; no listing is public. The hrefs stay because they are the
// permanent addresses and switch on by themselves the day each listing
// publishes — that decision is docs/LAUNCH-CHECKLIST.md section 2.
//
// A badge whose whole content is the word "Download" is a claim. What keeps it
// honest is the sentence beside it saying the listing may not open yet, and
// that sentence is exactly the thing that gets forgotten: the 3 Sep 2026 sweep
// added it under the badges in the HERO of client.html, trainer.html and
// studio.html and missed the CLOSING CALL TO ACTION on all three, so the last
// thing a reader saw on each page was a download button for a 404 with nothing
// beside it. One page, two badge clusters, one of them caveated — which is the
// shape no human sweep catches twice.
//
// So the rule is per CLUSTER, not per page: the caveat must be inside the same
// <section> as the badges it is caveating, because a caveat in the hero is not
// visible from the footer. Pages with no <section> at all (download.html,
// join.html) are one region and their page-level callout covers them.
//
// WHEN THE LISTINGS GO LIVE this check is what to delete, together with the
// caveats themselves — see section 2 of the checklist. It is not a permanent
// invariant; it is a gate on a temporary untruth, and leaving it in place after
// the listings publish would force the site to keep saying something that had
// stopped being true, which is the same failure pointing the other way.

/** The badge itself: an `<a class="store">` pointing at a store we do not own. */
const STORE_BADGE = /<a[^>]*class="store"[^>]*href="(https?:\/\/[^"]+)"/i;

/**
 * The sentence that makes a badge honest.
 *
 * Keyed on the one clause every caveat on the site now contains, rather than on
 * the whole paragraph, because the copy around it differs per page. Reword that
 * clause and this gate fails loudly, which is correct: it is the load-bearing
 * half of the sentence and the only part that is a disclosure.
 *
 * IT USED TO BE "not finished going out", and the wording was changed on
 * 13 Sep 2026 because that phrase asserted something nobody had checked. It
 * says a release is IN PROGRESS. App Store Connect says otherwise: asked
 * directly that day, `GET /v1/apps/<id>?include=appStoreVersions` returns
 * `appStoreState: PREPARE_FOR_SUBMISSION` for the only version (iOS 1.0) of all
 * three apps — 6790096518, 6804358275 and 6804417240. Not IN_REVIEW, not
 * WAITING_FOR_REVIEW, not REJECTED. No version of any of the three is in
 * review or approved, so "still going live" was a claim about motion that did
 * not exist, on the page whose job is telling people where to get the app.
 *
 * What replaced it is the fact instead of the forecast: the listing is not
 * public, and the button is the permanent address that opens when it is. That
 * is true today, stays true tomorrow, and needs no knowledge of anybody's
 * intentions.
 */
const RELEASE_CAVEAT = /not on the stores yet|no public App Store or\s+Google Play listing|None of the three listings is public/i;

/** The <section> a line sits in, as [startLine, endLine] 1-based and inclusive.
 *  A page with no sections is one region, which is what download.html and
 *  join.html are. */
function enclosingSection(lines, line) {
  let start = 1;
  let end = lines.length;
  for (let i = line - 1; i >= 0; i--) {
    if (/<section\b/i.test(lines[i])) { start = i + 1; break; }
  }
  for (let i = line - 1; i < lines.length; i++) {
    if (/<\/section>/i.test(lines[i])) { end = i + 1; break; }
  }
  return [start, end];
}

function checkStoreBadges(seen) {
  for (const page of PAGES) {
    const raw = read(page);
    const lines = raw.split('\n');
    // Badge lines, grouped into clusters. Two badges three lines apart are one
    // button row and want one caveat, not two.
    const hits = [];
    lines.forEach((l, i) => {
      if (COMMENT.test(l)) return;            // a comment quoting a badge is not a badge
      if (STORE_BADGE.test(l)) hits.push(i + 1);
    });
    if (!hits.length) continue;
    const clusters = [];
    for (const line of hits) {
      const last = clusters[clusters.length - 1];
      if (last && line - last[last.length - 1] <= 4) last.push(line);
      else clusters.push([line]);
    }
    for (const cluster of clusters) {
      seen.storeBadges++;
      if (excused(lines, cluster[0] - 1)) continue;
      const [start, end] = enclosingSection(lines, cluster[0]);
      const region = pageText(lines.slice(start - 1, end).join('\n'));
      if (RELEASE_CAVEAT.test(region)) continue;
      note(page, cluster[0],
        `${cluster.length} store badge${cluster.length === 1 ? '' : 's'} with nothing in the same section saying the listing may not open`,
        `None of the six store addresses resolves — itunes lookup answers resultCount 0 for all three Apple ids and all three Play pages answer 404, re-checked 13 Sep 2026. A badge reading "Download on the App Store" over a link that 404s is a claim the product cannot support. Put the caveat the other clusters use in this section — the clause that matters is "not on the stores yet" — or, if the listings are now live, delete every caveat AND check N together, per docs/LAUNCH-CHECKLIST.md section 2.`);
    }
  }
  // The empty-set guard, in the same spirit as B, D and G. Six pages carry
  // store badges today; a run that finds none has stopped reading, and a blind
  // detector prints the same "ok" as a clean site.
  if (seen.storeBadges === 0) {
    fatal.push('check N found no `<a class="store">` badge anywhere under web/. Six pages carry them — index, download, join, client, trainer and studio. Either the badges were removed (in which case delete check N with them) or STORE_BADGE no longer matches the markup.');
  }
}

/* ── run ─────────────────────────────────────────────────────────────────── */

const seen = { count: 0, markers: 0, siteHosts: 0, csp: 0, catalogue: 0, links: 0, rail: 0, exportParts: 0, coachSteps: 0, storeBadges: 0, erasure: 0 };
if (PASSWORD_MIN !== null && FEE_PCT !== null && TRIAL_DAYS !== null) {
  for (const page of PAGES) {
    const raw = read(page);
    const lines = raw.split('\n');
    checkPasswords(page, raw, lines);
    checkFee(page, lines, seen);
    checkTrial(page, lines);
  }
  // The narrowness guard for check B. The site states the platform fee today,
  // in several places. Finding none means the detector went blind, and a blind
  // detector prints the same "ok" as a clean site.
  if (seen.count === 0) {
    fatal.push('check B found no platform-fee percentage anywhere under web/. pricing.html states one — so either the page stopped saying what Repple takes, or FEE_CUES no longer matches the way it says it. Both need a person.');
  }
  checkProcessors();
  checkSiteHosts(seen);
  checkCsp(seen);
  checkWearables(connectableVendors(), seen);
  checkDeletionFigure();
  checkCatalogueFigures(seen);
  checkLinks(seen);
  checkConsoleRail(consoleRail(), seen);
  checkExportParts(exportParts(), seen);
  checkCoachSteps(coachSetupSteps(), seen);
  checkStoreBadges(seen);
  checkErasureFigure(erasurePin(), seen);
}

if (fatal.length) {
  console.error('\ncheck-site-claims cannot run honestly:\n');
  for (const f of fatal) console.error(`  · ${f}\n`);
  console.error('A gate that cannot find its source of truth must fail loudly, not pass quietly.\n');
  process.exit(1);
}

const byPage = new Map();
for (const p of problems) byPage.set(p.page, [...(byPage.get(p.page) ?? []), p]);

const fresh = [];
const shrunk = [];
for (const [page, list] of byPage) {
  const known = KNOWN.get(page);
  if (!known) { fresh.push(...list); continue; }
  if (list.length > known.count) fresh.push(...list.slice(known.count));
}
for (const [page, known] of KNOWN) {
  const now = byPage.get(page)?.length ?? 0;
  if (now < known.count) shrunk.push({ page, was: known.count, now });
}

if (fresh.length) {
  console.error('\nThe public site states something the code does not do:\n');
  for (const f of fresh) {
    console.error(`  ${f.page}:${f.line}`);
    console.error(`    claim  ${f.claim}`);
    console.error(`    code   ${f.truth}\n`);
  }
  console.error(`${fresh.length} claim${fresh.length === 1 ? '' : 's'} the code does not support.`);
  console.error('Change the PAGE. Do not soften a disclosure to make this pass: if the page understates');
  console.error('what leaves the product, the page is the thing that is wrong. Where a sentence is right');
  console.error('and this gate is wrong, put `site-claim-ok: <reason>` in the comment run directly above');
  console.error('the line — with the reason, which is the part that is worth anything.\n');
  process.exit(1);
}

if (shrunk.length) {
  console.error('\nKNOWN is out of date — the ratchet only counts down if somebody turns it:\n');
  for (const s of shrunk) console.error(`  ${s.page}: KNOWN says ${s.was}, the page has ${s.now}`);
  console.error('\nLower the count in scripts/check-site-claims.mjs.\n');
  process.exit(1);
}

console.log(`check-site-claims — ok, ${PAGES.length} public pages; password minimum ${PASSWORD_MIN}, `
  + `platform fee ${FEE_PCT}% (${seen.count} statement${seen.count === 1 ? '' : 's'}), trial ${TRIAL_DAYS} days, `
  + `every host contacted from supabase/functions named on privacy.html, `
  + `${seen.siteHosts} host${seen.siteHosts === 1 ? '' : 's'} the site itself contacts, each disclosed and each permitted by the ${seen.csp}-directive CSP, `
  + `${seen.markers} wearables-connect claim${seen.markers === 1 ? '' : 's'} matching the connectable set, `
  + `deletion chart internally consistent and dated, `
  + `${seen.catalogue} catalogue-figure claim${seen.catalogue === 1 ? '' : 's'} agreeing with each other and stamped, `
  + `${seen.links} internal links each resolving to a file and an id, `
  + `${seen.rail} console-rail claim and ${seen.exportParts} export-parts table matching studio-web, `
  + `${seen.coachSteps} coach setup list matching the app's own, `
  + `${seen.storeBadges} store-badge cluster${seen.storeBadges === 1 ? '' : 's'} each caveated in its own section, `
  + `${seen.erasure} file${seen.erasure === 1 ? '' : 's'} stating the erasure figure, each agreeing with the pin in supabase/parts/41-account-deletion.sql and each dated and re-measurable.`);
