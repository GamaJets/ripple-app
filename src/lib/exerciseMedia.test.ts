// Turning a stored path into a URL, which is the one place a bad catalogue row
// becomes a broken image in front of a client.
//
// `image_paths` is populated from an imported dataset, and 41 of our own rows
// carry nothing at all. The distinction this file exists to protect is between
// "no picture of this movement" — which the screen says out loud — and "a URL
// we built out of a row we did not understand", which renders as a grey box
// the client reads as the app being broken.
import { frameUrls, FRAME_BASE, REPDB_FRAME_BASE, demoCaption, demoIsShippable } from './exerciseMedia';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

// ── the shapes the catalogue actually stores ───────────────────────────────
{
  const u = frameUrls(['Barbell_Curl/0.jpg', 'Barbell_Curl/1.jpg']);
  ok(u.length === 2, `two frames, got ${u.length}`);
  ok(u[0] === `${FRAME_BASE}/Barbell_Curl/0.jpg`, `built from the base, got ${u[0]}`);
  ok(u[1].endsWith('/1.jpg'), 'order is preserved — start position first');
  // A leading slash would produce a double slash, which some CDNs 404 on.
  ok(frameUrls(['/Barbell_Curl/0.jpg'])[0] === `${FRAME_BASE}/Barbell_Curl/0.jpg`,
    'a leading slash is trimmed rather than doubled');
  ok(frameUrls(['Anterior_Tibialis-SMR/0.jpg']).length === 1, 'hyphens and dots in the folder are fine');
}

// ── absence is an answer, not an empty string ──────────────────────────────
{
  for (const empty of [null, undefined, [] as string[]]) {
    ok(frameUrls(empty).length === 0, `${String(empty)} yields no URLs`);
  }
  ok(frameUrls(['', '   ']).length === 0, 'blank entries are dropped, not turned into the base URL');
}

// ── rows this module does not understand are dropped, never guessed at ─────
{
  const junk = ['no-slash.jpg', 'Deep/Nested/0.jpg', 'Barbell_Curl/0.gif', 'Barbell_Curl/x.jpg',
    'Barbell_Curl/', '../../etc/passwd', 'https://evil.example/0.jpg'];
  for (const j of junk) {
    ok(frameUrls([j]).length === 0, `"${j}" is not turned into a URL`);
  }
  // The assertion that matters most: a bad entry must not take the good one
  // with it, and must not survive alongside it either.
  const mixed = frameUrls(['Barbell_Curl/0.jpg', '../../etc/passwd']);
  ok(mixed.length === 1 && mixed[0].endsWith('Barbell_Curl/0.jpg'),
    `the good frame survives alone, got ${JSON.stringify(mixed)}`);
}

// ── the caption names provenance, and only when there is something to name ──
{
  ok(demoCaption('free-exercise-db', 2) !== null, 'an imported illustration is labelled as one');
  ok(demoCaption('free-exercise-db', 0) === null, 'nothing to caption when there are no frames');
  ok(demoCaption('repple', 0) === null, 'nor for our own rows with no frames');
}

// ── two catalogues, two hosts, decided by source and not by sniffing ───────
//
// RepDB stores 'images/flat/<id>-start.webp'; free-exercise-db stores
// 'Folder/0.jpg'. They are served from different places, so a row resolved
// against the wrong base is a 404 the client reads as a broken app.
{
  const r = frameUrls(['images/flat/ab-wheel-rollout-start.webp', 'images/flat/ab-wheel-rollout-peak.webp'], 'repdb');
  ok(r.length === 2, `two RepDB frames, got ${r.length}`);
  // Read through a default rather than indexed raw: a test that CRASHES when
  // the thing it is testing breaks reports a stack trace instead of the
  // sentence naming what went wrong, which is most of a test's value.
  const first = r[0] ?? '';
  ok(first === `${REPDB_FRAME_BASE}/images/flat/ab-wheel-rollout-start.webp`,
    `built from the RepDB base, got "${first}"`);
  ok(first.startsWith(REPDB_FRAME_BASE) && !first.startsWith(FRAME_BASE), 'and not from the other one');

  // The assertion that names the failure: the SAME path under the wrong source
  // must not resolve, because a wrong base is a 404 rather than a wrong picture.
  ok(frameUrls(['images/flat/ab-wheel-rollout-start.webp']).length === 0,
    'a RepDB path with no source does not resolve against the free-exercise-db base');
  ok(frameUrls(['Barbell_Curl/0.jpg'], 'repdb').length === 0,
    'and a free-exercise-db path does not resolve against the RepDB base');

  // Traversal is rejected under the new shape too.
  ok(frameUrls(['images/../../etc/passwd'], 'repdb').length === 0, 'traversal is refused for RepDB paths');
  ok(frameUrls(['images/flat/x.gif'], 'repdb').length === 0, 'and an unexpected extension');

  ok(demoCaption('repdb', 2) !== null, 'a RepDB illustration is captioned as one');
  ok(demoCaption('repdb', 2) !== demoCaption('free-exercise-db', 2),
    'and the two sources are not described with the same sentence');
}

// ── the licence gate ───────────────────────────────────────────────────────
//
// A preview bundle is CC BY-NC: fine for deciding whether to buy, never fine in
// a product that sells memberships. The failure this guards is not a decision
// anybody makes — it is one nobody revisits. The preview gets wired in to look
// at, it works, and four builds later it is in a binary nobody re-checked.
{
  ok(demoIsShippable('commercial', true), 'a bought pack renders in a release');
  ok(demoIsShippable('commercial', false), 'and in development');
  ok(demoIsShippable('evaluation', false), 'a preview renders while it is being judged');
  // The one that matters.
  ok(!demoIsShippable('evaluation', true), 'a preview NEVER renders in a release build');
  // An unlabelled asset is treated as unlicensed, not as permitted: the reason
  // it is unlabelled is unknown, and the expensive guess is the permissive one.
  ok(!demoIsShippable(null, true), 'an animation with no recorded licence does not ship');
  ok(!demoIsShippable(undefined, true), 'nor an undefined one');
  ok(!demoIsShippable('', true), 'nor an empty one');
  ok(!demoIsShippable('Commercial', true), 'and the check is exact — not a loose match on the word');
}

if (errors.length) {
  console.error(`exerciseMedia.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('exerciseMedia.test.ts — ok');
