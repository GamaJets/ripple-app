"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Turning a stored path into a URL, which is the one place a bad catalogue row
// becomes a broken image in front of a client.
//
// `image_paths` is populated from an imported dataset, and 41 of our own rows
// carry nothing at all. The distinction this file exists to protect is between
// "no picture of this movement" — which the screen says out loud — and "a URL
// we built out of a row we did not understand", which renders as a grey box
// the client reads as the app being broken.
const exerciseMedia_1 = require("./exerciseMedia");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
// ── the shapes the catalogue actually stores ───────────────────────────────
{
    const u = (0, exerciseMedia_1.frameUrls)(['Barbell_Curl/0.jpg', 'Barbell_Curl/1.jpg']);
    ok(u.length === 2, `two frames, got ${u.length}`);
    ok(u[0] === `${exerciseMedia_1.FRAME_BASE}/Barbell_Curl/0.jpg`, `built from the base, got ${u[0]}`);
    ok(u[1].endsWith('/1.jpg'), 'order is preserved — start position first');
    // A leading slash would produce a double slash, which some CDNs 404 on.
    ok((0, exerciseMedia_1.frameUrls)(['/Barbell_Curl/0.jpg'])[0] === `${exerciseMedia_1.FRAME_BASE}/Barbell_Curl/0.jpg`, 'a leading slash is trimmed rather than doubled');
    // The folder character class is `[\w.-]`, so the fixture has to carry all
    // three. It used to be 'Anterior_Tibialis-SMR', which has an underscore and a
    // hyphen and no dot at all — the only dot in it was the .jpg extension every
    // other fixture here already has, so the "dots" half of this sentence was
    // never tested and a class narrowed to `[\w-]` would have passed it.
    ok((0, exerciseMedia_1.frameUrls)(['Anterior_Tibialis-SMR.v2/0.jpg']).length === 1, 'hyphens and dots in the folder are fine');
    // `?? ''` rather than `[0].endsWith(...)`: when the folder is rejected the
    // array is empty, and indexing it would throw a TypeError that aborts the run
    // instead of pushing a named failure onto `errors` the way this file reports
    // everything else.
    ok(((0, exerciseMedia_1.frameUrls)(['Anterior_Tibialis-SMR.v2/0.jpg'])[0] ?? '').endsWith('/Anterior_Tibialis-SMR.v2/0.jpg'), 'and the folder reaches the CDN with those characters intact rather than stripped');
}
// ── absence is an answer, not an empty string ──────────────────────────────
{
    for (const empty of [null, undefined, []]) {
        ok((0, exerciseMedia_1.frameUrls)(empty).length === 0, `${String(empty)} yields no URLs`);
    }
    ok((0, exerciseMedia_1.frameUrls)(['', '   ']).length === 0, 'blank entries are dropped, not turned into the base URL');
}
// ── rows this module does not understand are dropped, never guessed at ─────
{
    const junk = ['no-slash.jpg', 'Deep/Nested/0.jpg', 'Barbell_Curl/0.gif', 'Barbell_Curl/x.jpg',
        'Barbell_Curl/', '../../etc/passwd', 'https://evil.example/0.jpg'];
    for (const j of junk) {
        ok((0, exerciseMedia_1.frameUrls)([j]).length === 0, `"${j}" is not turned into a URL`);
    }
    // The assertion that matters most: a bad entry must not take the good one
    // with it, and must not survive alongside it either.
    const mixed = (0, exerciseMedia_1.frameUrls)(['Barbell_Curl/0.jpg', '../../etc/passwd']);
    ok(mixed.length === 1 && mixed[0].endsWith('Barbell_Curl/0.jpg'), `the good frame survives alone, got ${JSON.stringify(mixed)}`);
}
// ── the caption names provenance, and only when there is something to name ──
{
    ok((0, exerciseMedia_1.demoCaption)('free-exercise-db', 2) !== null, 'an imported illustration is labelled as one');
    ok((0, exerciseMedia_1.demoCaption)('free-exercise-db', 0) === null, 'nothing to caption when there are no frames');
    ok((0, exerciseMedia_1.demoCaption)('repple', 0) === null, 'nor for our own rows with no frames');
}
// ── two catalogues, two hosts, decided by source and not by sniffing ───────
//
// RepDB stores 'images/flat/<id>-start.webp'; free-exercise-db stores
// 'Folder/0.jpg'. They are served from different places, so a row resolved
// against the wrong base is a 404 the client reads as a broken app.
{
    const r = (0, exerciseMedia_1.frameUrls)(['images/flat/ab-wheel-rollout-start.webp', 'images/flat/ab-wheel-rollout-peak.webp'], 'repdb');
    ok(r.length === 2, `two RepDB frames, got ${r.length}`);
    // Read through a default rather than indexed raw: a test that CRASHES when
    // the thing it is testing breaks reports a stack trace instead of the
    // sentence naming what went wrong, which is most of a test's value.
    const first = r[0] ?? '';
    ok(first === `${exerciseMedia_1.REPDB_FRAME_BASE}/images/flat/ab-wheel-rollout-start.webp`, `built from the RepDB base, got "${first}"`);
    ok(first.startsWith(exerciseMedia_1.REPDB_FRAME_BASE) && !first.startsWith(exerciseMedia_1.FRAME_BASE), 'and not from the other one');
    // The assertion that names the failure: the SAME path under the wrong source
    // must not resolve, because a wrong base is a 404 rather than a wrong picture.
    ok((0, exerciseMedia_1.frameUrls)(['images/flat/ab-wheel-rollout-start.webp']).length === 0, 'a RepDB path with no source does not resolve against the free-exercise-db base');
    ok((0, exerciseMedia_1.frameUrls)(['Barbell_Curl/0.jpg'], 'repdb').length === 0, 'and a free-exercise-db path does not resolve against the RepDB base');
    // Traversal is rejected under the new shape too.
    ok((0, exerciseMedia_1.frameUrls)(['images/../../etc/passwd'], 'repdb').length === 0, 'traversal is refused for RepDB paths');
    ok((0, exerciseMedia_1.frameUrls)(['images/flat/x.gif'], 'repdb').length === 0, 'and an unexpected extension');
    ok((0, exerciseMedia_1.demoCaption)('repdb', 2) !== null, 'a RepDB illustration is captioned as one');
    ok((0, exerciseMedia_1.demoCaption)('repdb', 2) !== (0, exerciseMedia_1.demoCaption)('free-exercise-db', 2), 'and the two sources are not described with the same sentence');
}
// ── the licence gate ───────────────────────────────────────────────────────
//
// A preview bundle is CC BY-NC: fine for deciding whether to buy, never fine in
// a product that sells memberships. The failure this guards is not a decision
// anybody makes — it is one nobody revisits. The preview gets wired in to look
// at, it works, and four builds later it is in a binary nobody re-checked.
{
    ok((0, exerciseMedia_1.demoIsShippable)('commercial', true), 'a bought pack renders in a release');
    ok((0, exerciseMedia_1.demoIsShippable)('commercial', false), 'and in development');
    ok((0, exerciseMedia_1.demoIsShippable)('evaluation', false), 'a preview renders while it is being judged');
    // The one that matters.
    ok(!(0, exerciseMedia_1.demoIsShippable)('evaluation', true), 'a preview NEVER renders in a release build');
    // An unlabelled asset is treated as unlicensed, not as permitted: the reason
    // it is unlabelled is unknown, and the expensive guess is the permissive one.
    ok(!(0, exerciseMedia_1.demoIsShippable)(null, true), 'an animation with no recorded licence does not ship');
    ok(!(0, exerciseMedia_1.demoIsShippable)(undefined, true), 'nor an undefined one');
    ok(!(0, exerciseMedia_1.demoIsShippable)('', true), 'nor an empty one');
    ok(!(0, exerciseMedia_1.demoIsShippable)('Commercial', true), 'and the check is exact — not a loose match on the word');
}
// ── evaluation animations never touch our storage ──────────────────────────
//
// A preview pack is CC BY-NC: it exists to be judged before a purchase, and
// putting it in the exercise-demos bucket — which holds content we are licensed
// to ship — would be the first step of losing track of which is which.
{
    ok((0, exerciseMedia_1.evalAnimationUrl)('bench-leg-pull-in.webp', 'evaluation') === `${exerciseMedia_1.EVAL_DEMO_BASE}/bench-leg-pull-in.webp`, 'an evaluation animation resolves against the evaluation host');
    // The assertion that keeps the two routes apart: a COMMERCIAL animation must
    // NOT resolve here, because it belongs in the signed bucket. Returning a URL
    // for it would quietly serve licensed content off an evaluation server.
    ok((0, exerciseMedia_1.evalAnimationUrl)('bench-leg-pull-in.webp', 'commercial') === null, 'a commercial animation does NOT resolve here — it belongs in the signed bucket');
    ok((0, exerciseMedia_1.evalAnimationUrl)('bench-leg-pull-in.webp', null) === null, 'nor an unlabelled one');
    ok((0, exerciseMedia_1.evalAnimationUrl)(null, 'evaluation') === null, 'no path, no URL');
    // Shapes we do not understand are dropped rather than guessed at.
    for (const bad of ['../../etc/passwd', 'nested/path.webp', 'file.exe', '', '   ']) {
        ok((0, exerciseMedia_1.evalAnimationUrl)(bad, 'evaluation') === null, `"${bad}" is not turned into a URL`);
    }
}
if (errors.length) {
    console.error(`exerciseMedia.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors)
        console.error('  · ' + e);
    process.exit(1);
}
console.log('exerciseMedia.test.ts — ok');
