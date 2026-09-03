// The two rules that decide whether a RepDB import is correct, and both of them
// fail silently in production rather than loudly at import time.
//
// A wrong catalogue id produces a movement that lists in the picker and answers
// "not in our catalogue" when tapped. A wrong media key produces a row with no
// picture, which is indistinguishable from a movement the vendor never
// illustrated. Neither throws, neither shows up in a row count, and both have
// already shipped once.
import {
  packTier, tierMayShip, demoLicenceFor, slug,
  catalogueId, mediaKey, stillFiles, animationFile, planRow, overlap,
  IMPORT_TRANSLATION_LOCALES, planTranslations, translationCoverage,
} from './repdbImport';
import { TRANSLATION_LOCALES } from './catalogueLocale';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// ── the licence read off the pack, not off a flag ──────────────────────────
{
  ok(packTier('# RepDB — Standard License (v1.2)') === 'standard', 'the Standard bundle is recognised');
  ok(packTier('# RepDB — Free Tier License (v1.0)') === 'free', 'the free tier is recognised');
  ok(packTier('Creative Commons Attribution-NonCommercial 4.0') === 'preview-nc',
    'the evaluation preview is recognised');
  // The preview's own licence names the paid tiers when it points people at
  // them. A tier check that matched "Standard" anywhere in the file would read
  // the non-commercial preview as the commercial bundle and let 16 CC BY-NC
  // exercises into a product that sells memberships — the single most expensive
  // misread available here, so it gets its own fixture.
  ok(packTier(
    'Preview Pack License (CC BY-NC 4.0)\nFor commercial use see the Standard License at https://repdb.co.',
  ) === 'preview-nc', 'a preview that MENTIONS the Standard tier is still the preview');
  for (const nothing of ['', '   ', null, undefined]) {
    ok(packTier(nothing) === 'unknown', `${JSON.stringify(nothing)} is unknown, never a tier`);
  }
  ok(packTier('some other vendor licence') === 'unknown', 'an unrecognised licence is unknown');
}

// ── an unreadable licence is refused, not assumed ──────────────────────────
{
  ok(tierMayShip('standard'), 'the Standard bundle may ship');
  ok(tierMayShip('free'), 'so may the free tier — it permits commercial in-app use');
  ok(!tierMayShip('preview-nc'), 'the CC BY-NC preview may NOT ship in a product that sells memberships');
  // The whole point of the guard: absence of evidence is refusal. If this ever
  // returns true, a pack whose licence nobody could read is shippable by
  // default, which is how the preview gets in.
  ok(!tierMayShip('unknown'), 'and neither may a pack whose licence we could not read');

  eq(demoLicenceFor('standard'), 'commercial', 'Standard media is stamped commercial');
  eq(demoLicenceFor('free'), 'commercial', 'free-tier media is stamped commercial too');
  eq(demoLicenceFor('preview-nc'), 'evaluation', 'preview media is stamped evaluation');
  eq(demoLicenceFor('unknown'), null, 'an unknown tier stamps nothing, which renders nowhere');
}

// ── the row id is the slug of the NAME ─────────────────────────────────────
{
  // The exact record that broke this before: RepDB calls it `barbell-row` and
  // displays "Bent-Over Barbell Row". Keying the row by the vendor id put 80
  // movements in the catalogue and out of reach of every screen that resolves
  // through exerciseSlug(name).
  const rec = { id: 'barbell-row', name_en: 'Bent-Over Barbell Row' };
  eq(catalogueId(rec), 'bent-over-barbell-row', 'the row is keyed by the displayed name');
  ok(catalogueId(rec) !== rec.id, 'and explicitly NOT by the vendor id');
  // An apostrophe is a SEPARATOR, not a character to delete — every run of
  // non-alphanumerics becomes one hyphen, so "Child's Pose" is `child-s-pose`
  // and the seed agrees. RepDB calls the same movement `childs-pose`, which is
  // why this record is one of the 80: deleting the apostrophe instead would
  // produce an id no screen ever asks for, and the movement would be
  // illustrated, described, and dead on tap.
  eq(catalogueId({ id: 'childs-pose', name_en: "Child's Pose" }), 'child-s-pose',
    'an apostrophe separates exactly as exerciseSlug does it, matching the seeded row');
  eq(catalogueId({ id: 'x', name_en: 'Behind-the-Neck Pull-Up' }), 'behind-the-neck-pull-up',
    'hyphens and mixed case resolve to the one form the screens ask for');
  // Falling back rather than dropping: a record with no name still has to land
  // somewhere, because silently skipping it shrinks the catalogue without
  // saying so.
  eq(catalogueId({ id: 'only-an-id', name_en: null }), 'only-an-id', 'a nameless record falls back to the vendor id');
  eq(catalogueId({ id: null, name_en: null }), '', 'and a record with neither resolves to nothing');
}

// ── the media key is the VENDOR id, which is a different string ────────────
{
  const rec = { id: 'barbell-row', name_en: 'Bent-Over Barbell Row' };
  eq(mediaKey(rec), 'barbell-row', 'media files are named by the vendor id');
  // The assertion that keeps the two apart. If these two ever return the same
  // string for this fixture, one of them has been "tidied" into the other and
  // 80 rows are about to lose their pictures — or gain unreachable ids.
  ok(mediaKey(rec) !== catalogueId(rec), 'the media key and the row id are NOT the same string');

  // ── and image_alias beats the vendor id where it is present ──────────────
  //
  // The six records that reuse another movement's artwork. Reading `id` here
  // does not throw and does not show up in a count: it builds a filename that
  // is simply not in the pack, so the importer announced "6 claim an animation
  // with NO FILE" and "12 stills are absent" and looked like an incomplete
  // archive. Every one of those 18 files is present under the alias.
  eq(mediaKey({ id: 'paused-ohp', name_en: 'Paused Overhead Press', image_alias: 'ohp' }), 'ohp',
    'a record that borrows artwork is keyed by the alias, not by its own id');
  eq(catalogueId({ id: 'paused-ohp', name_en: 'Paused Overhead Press', image_alias: 'ohp' }), 'paused-overhead-press',
    'while its ROW is still keyed by its own displayed name — the alias is about files only');
  eq(mediaKey({ id: 'pause-deadlift', name_en: 'Pause Deadlift', image_alias: null }), 'pause-deadlift',
    'a null alias falls through to the vendor id rather than blanking the key');
  eq(mediaKey({ id: 'pause-deadlift', name_en: 'Pause Deadlift', image_alias: '' }), 'pause-deadlift',
    'and so does an empty one');
}

// ── stills come back in the order the screen cross-fades them ──────────────
{
  const rec = { id: 'barbell-row', name_en: 'Bent-Over Barbell Row', images: { classic: ['peak', 'start'], flat: ['start', 'peak'] } };
  // Deliberately handed peak-first. The detail screen fades [0] into [1], so
  // trusting the vendor's array order would play the rep backwards — present,
  // complete, and wrong in a way no count catches.
  eq(stillFiles(rec, 'classic'), ['images/classic/barbell-row-start.webp', 'images/classic/barbell-row-peak.webp'],
    'start precedes peak even when the vendor lists them the other way round');
  eq(stillFiles(rec, 'flat'), ['images/flat/barbell-row-start.webp', 'images/flat/barbell-row-peak.webp'],
    'and the style selects the folder');
  // 134 of the 601 are single-illustration movements — a plank, a carry, a
  // stretch held in place. Reading only start/peak dropped every one of them
  // and looked like the vendor not covering them.
  eq(stillFiles({ id: 'plank', name_en: 'Plank', images: { classic: ['main'] } }, 'classic'),
    ['images/classic/plank-main.webp'], 'a single-position movement yields its one illustration');
  eq(stillFiles({ id: 'x', name_en: 'X', images: { classic: [] } }, 'classic'), [],
    'no variants is an empty answer, not a path to nothing');
  eq(stillFiles({ id: 'x', name_en: 'X' }, 'classic'), [], 'and a record with no images block at all');
}

// ── an animation path is a claim the caller still has to confirm ───────────
{
  eq(animationFile({ id: 'barbell-row', name_en: 'Bent-Over Barbell Row', animation: true }),
    'images/animations/barbell-row.webp', 'the animation is named by the vendor id too');
  eq(animationFile({ id: 'x', name_en: 'X', animation: false }), null, 'a record claiming none yields none');
  eq(animationFile({ id: 'x', name_en: 'X' }), null, 'and so does one that says nothing about it');
  // The exact pair that came out unillustrated: plain Overhead Press played a
  // clip and Paused Overhead Press showed two cross-faded stills, because the
  // second one's animation was looked for under its own id. One file, both
  // records — which is what sharing artwork means.
  eq(animationFile({ id: 'paused-ohp', name_en: 'Paused Overhead Press', image_alias: 'ohp', animation: true }),
    'images/animations/ohp.webp', 'an aliased record finds its clip under the alias');
  eq(stillFiles({ id: 'paused-ohp', name_en: 'Paused Overhead Press', image_alias: 'ohp', images: { classic: ['start', 'peak'] } }, 'classic'),
    ['images/classic/ohp-start.webp', 'images/classic/ohp-peak.webp'],
    'and its stills too — the alias governs every filename, not just the animation');
}

// ── the whole plan for one record ──────────────────────────────────────────
{
  const p = planRow({ id: 'barbell-row', name_en: 'Bent-Over Barbell Row', images: { classic: ['start', 'peak'] }, animation: true }, 'classic');
  ok(p !== null, 'a usable record plans');
  eq(p?.id, 'bent-over-barbell-row', 'planned under the name slug');
  eq(p?.mediaKey, 'barbell-row', 'with media under the vendor id');
  ok(p?.rekeyed === true, 'and flagged as one of the 80 where the two disagree');
  eq(p?.stills.length, 2, 'both frames planned');
  const same = planRow({ id: 'arnold-press', name_en: 'Arnold Press', images: { classic: ['start', 'peak'] } }, 'classic');
  ok(same?.rekeyed === false, 'a record whose id already equals its name slug is not flagged');
  // Never invent an id. A row nothing can resolve is worse than an absent one:
  // it lists in the picker, shows an illustration, and dies on tap.
  ok(planRow({ id: null, name_en: null }, 'classic') === null, 'a record with no id at all is refused, not invented');
}

// ── the overlap number, which decides backfill vs replacement ──────────────
{
  const existing = new Set(['bent-over-barbell-row', 'arnold-press']);
  const recs = [
    { id: 'barbell-row', name_en: 'Bent-Over Barbell Row' },   // matches, via the NAME
    { id: 'arnold-press', name_en: 'Arnold Press' },           // matches directly
    { id: 'brand-new', name_en: 'Brand New Move' },            // genuinely new
  ];
  const r = overlap(recs, existing);
  eq(r.matched.sort(), ['arnold-press', 'bent-over-barbell-row'], 'both existing rows are recognised');
  eq(r.added, ['brand-new-move'], 'and the new one is counted as an addition under its name slug');
  // The failure this guards: matching on the vendor id instead would miss
  // `barbell-row` against `bent-over-barbell-row`, report an overlap of 1 where
  // it is 2, and make a media backfill look like a catalogue replacement.
  ok(r.matched.includes('bent-over-barbell-row'),
    'a record whose vendor id differs from its name still counts as MATCHED, not as an addition');
}

// ── the slug rule itself, since everything above rests on it ───────────────
{
  eq(slug('Bent-Over Barbell Row'), 'bent-over-barbell-row', 'spaces and hyphens collapse to one hyphen');
  eq(slug("Child's Pose"), 'child-s-pose', 'an apostrophe separates rather than vanishing');
  eq(slug('  Leading and trailing  '), 'leading-and-trailing', 'edges are trimmed rather than left as hyphens');
  eq(slug('90/90 Hip Stretch'), '90-90-hip-stretch', 'digits survive and the slash separates');
  for (const nothing of ['', null, undefined]) eq(slug(nothing), '', `${JSON.stringify(nothing)} slugs to nothing`);
}

// ── the translation set, where the vendor id trap appears a third time ─────
{
  // The record that broke the catalogue import once already: RepDB calls it
  // `barbell-row` and displays "Bent-Over Barbell Row". `exercises.de.json`
  // keys its German name by `barbell-row` too, so writing the translation under
  // the vendor id points it at an exercise that does not exist — and the
  // foreign key rejects it half way through the language rather than at the
  // start of it.
  const records = [
    { id: 'barbell-row', name_en: 'Bent-Over Barbell Row' },
    { id: 'back-squat', name_en: 'Back Squat' },
    { id: 'plank', name_en: 'Plank' },
  ];
  const de = [
    { id: 'barbell-row', name: 'Vorgebeugtes Langhantelrudern', description: 'Eine horizontale Zugübung.' },
    { id: 'back-squat', name: 'Kniebeuge' },
    // A localised entry for a movement the English set does not have. Guessing
    // a catalogue id from the German name would mint a row nothing resolves.
    { id: 'ghost-movement', name: 'Geisterübung' },
    // Nothing translated at all. Part 790 refuses to store such a row and the
    // reason is on screen: no row shows English AND SAYS it is English, where a
    // blank name shows nothing.
    { id: 'plank', name: '   ', description: null },
  ];

  const { rows, skipped } = planTranslations(records, de, 'de');
  eq(rows.length, 2, 'two of the four localised entries become rows');
  eq(rows[0], {
    exerciseId: 'bent-over-barbell-row', locale: 'de',
    name: 'Vorgebeugtes Langhantelrudern', description: 'Eine horizontale Zugübung.',
  }, "the row is keyed by the slug of the ENGLISH name, never by RepDB's own id");
  ok(!rows.some((r) => r.exerciseId === 'barbell-row'),
    'and specifically NOT by the vendor id, which is the failure this join exists to prevent');
  eq(rows[1].description, null, 'a name with no description is a row with a null description, not a blank one');

  ok(skipped.some((s) => s.vendorId === 'ghost-movement' && s.reason === 'no-english-record'),
    'a localised entry with no English counterpart is skipped and COUNTED, not guessed at');
  ok(skipped.some((s) => s.vendorId === 'plank' && s.reason === 'nothing-to-translate'),
    'an entry that translates nothing is skipped rather than written blank');

  // Re-running is the whole reason the table is keyed (exercise_id, locale).
  // Loading a language twice, or loading a corrected copy, must leave one row
  // per movement — never a second exercise and never a second name.
  const again = planTranslations(records, de, 'de');
  eq(again.rows, rows, 'planning the same set twice produces the same rows');
  const corrected = planTranslations(records, [{ id: 'back-squat', name: 'Langhantel-Kniebeuge' }], 'de');
  eq(corrected.rows.length, 1, 'a corrected partial set is one row');
  eq(corrected.rows[0].exerciseId, 'back-squat', 'against the SAME key, so the upsert replaces rather than adds');

  // Two vendor records whose English names slug to one catalogue id would both
  // write the same row and the second would win silently.
  const collide = planTranslations(
    [{ id: 'row-a', name_en: 'Bent-Over Row' }, { id: 'row-b', name_en: 'Bent-over Row' }],
    [{ id: 'row-a', name: 'Vorgebeugtes Rudern' }, { id: 'row-b', name: 'Rudern vorgebeugt' }],
    'de',
  );
  eq(collide.rows.length, 1, 'a catalogue id is written once');
  ok(collide.skipped.some((s) => s.reason === 'duplicate'), 'and the collision is reported rather than swallowed');

  eq(planTranslations(records, de, 'en' as any).rows, [],
    "'en' is not a translation locale — English is exercises.name, and the planner refuses it outright");
}

// ── coverage, which is the number a run should be judged on ────────────────
{
  const rows = [
    { exerciseId: 'back-squat', locale: 'de' as const, name: 'Kniebeuge', description: null },
    // A row with a description and NO name does not make the movement
    // translated: the name is what a member reads in a list of six hundred.
    { exerciseId: 'plank', locale: 'de' as const, name: null, description: 'Eine Rumpfübung.' },
  ];
  const cov = translationCoverage(rows, new Set(['back-squat', 'plank', 'deadlift']));
  eq(cov.translated, ['back-squat'], 'only a movement with a NAME counts as translated');
  eq(cov.untranslated, ['deadlift', 'plank'],
    'and the rest are named, because that list is what somebody works through next');
}

// ── the duplicated locale set has not drifted ──────────────────────────────
{
  // IMPORT_TRANSLATION_LOCALES is duplicated from TRANSLATION_LOCALES because
  // scripts/import-repdb.mjs loads this module through Node's type stripping.
  // Duplication that drifts silently is worse than no duplication; this is one
  // of the three places that agreement is enforced, alongside the check
  // constraint in supabase/parts/790 and scripts/check-translations.mjs.
  eq([...IMPORT_TRANSLATION_LOCALES], [...TRANSLATION_LOCALES],
    'the importer and the app agree on which languages exist');
}

if (errors.length) {
  console.error(`repdbImport.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('repdbImport.test.ts — ok');
