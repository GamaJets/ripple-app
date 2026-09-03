// The rules that decide whether a German member is reading German, English, or
// something worse than either.
//
// Every assertion here is about a failure that renders. A blank name, a raw
// exercise id, a Spanish name on a German screen, and — the one this module was
// written for — an English name shown among German ones with nothing saying it
// is English.
import {
  TRANSLATION_LOCALES, CATALOGUE_BASE_LOCALE, isTranslationLocale, catalogueLocale,
  indexTranslations, displayName, displayDescription, fallbackTag, fallbackNote,
  matchesSearch, validateTranslations, type TranslationRow,
} from './catalogueLocale';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// ── the supported set, and what is deliberately not in it ──────────────────
{
  eq([...TRANSLATION_LOCALES], ['de', 'es'], 'the catalogue is translated into German and Spanish');
  ok(!(TRANSLATION_LOCALES as readonly string[]).includes('en'),
    "English is NOT a translation locale — it is `exercises.name`, and a second English string would be a second answer to what a movement is called");
  eq(CATALOGUE_BASE_LOCALE, 'en', 'the catalogue itself is English');
  ok(isTranslationLocale('de') && isTranslationLocale('es'), 'both shipped languages are recognised');
  for (const no of ['en', 'de-DE', 'DE', 'fr', '', null, undefined, 7]) {
    ok(!isTranslationLocale(no), `${JSON.stringify(no)} is not a catalogue language`);
  }
}

// ── a device tag becomes a catalogue language, or honestly nothing ─────────
{
  eq(catalogueLocale('de'), 'de', 'German is German');
  eq(catalogueLocale('de-AT'), 'de', 'an Austrian handset reads the German catalogue');
  eq(catalogueLocale('de-CH-1901'), 'de', 'so does one with a variant subtag');
  eq(catalogueLocale('es-419'), 'es', 'and a Latin American one reads the Spanish catalogue');
  // The POSIX form really does come back off emulators and vendor skins;
  // normaliseLocale() in locale.ts accepts it for the same reason.
  eq(catalogueLocale('de_DE'), 'de', 'an underscore tag is not a different language');
  eq(catalogueLocale('DE-de'), 'de', 'the tag is matched case-insensitively');
  // The important negative: English readers must not be told anything fell
  // back, because for them nothing did.
  eq(catalogueLocale('en-GB'), null, 'English is the catalogue, not a translation of it');
  eq(catalogueLocale('en'), null, 'and that holds for bare English too');
  for (const no of ['fr-FR', 'ja', '', '   ', null, undefined]) {
    eq(catalogueLocale(no), null, `${JSON.stringify(no)} has no catalogue of its own`);
  }
}

// ── the index keeps one language and refuses blanks ────────────────────────
{
  const rows: TranslationRow[] = [
    { exerciseId: 'back-squat', locale: 'de', name: 'Kniebeuge' },
    { exerciseId: 'back-squat', locale: 'es', name: 'Sentadilla trasera' },
    { exerciseId: 'deadlift', locale: 'de', name: 'Kreuzheben', description: 'Eine Hüftbeuge vom Boden.' },
    // A row that got saved with an empty name. The database refuses to store
    // one; if one arrives anyway it must read as ABSENT, because honouring it
    // puts a movement with no name on a screen somebody is about to train from.
    { exerciseId: 'bench-press', locale: 'de', name: '   ' },
    { exerciseId: '', locale: 'de', name: 'Nirgendwo' },
  ];
  const de = indexTranslations(rows, 'de');
  eq(de.get('back-squat')?.name, 'Kniebeuge', 'the German name is indexed');
  eq(de.get('deadlift')?.description, 'Eine Hüftbeuge vom Boden.', 'so is the German description');
  ok(!de.has('bench-press'), 'a whitespace-only name is not a name');
  ok(!de.has(''), 'a row naming no exercise is dropped');
  // The one that would show a Spanish name to a German reader.
  ok(!Array.from(de.values()).some((v) => v.name === 'Sentadilla trasera'),
    'a Spanish row is dropped from the German index rather than merged into it');
  const es = indexTranslations(rows, 'es');
  eq(es.get('back-squat')?.name, 'Sentadilla trasera', 'and the Spanish index has the Spanish name');
  eq(es.size, 1, 'and nothing else');
  eq(indexTranslations(null, 'de').size, 0, 'no rows indexes to nothing rather than throwing');
}

// ── the name, and whether the reader is being told the truth about it ──────
{
  const de = indexTranslations([{ exerciseId: 'back-squat', locale: 'de', name: 'Kniebeuge' }], 'de');

  const translated = displayName('Back Squat', 'back-squat', de, 'de');
  eq(translated, { text: 'Kniebeuge', locale: 'de', isFallback: false }, 'a translated row shows German and says so');

  // THE assertion this module exists for. The English name is still shown —
  // it is better than nothing and better than a key — but it is flagged, so
  // the screen can mark it and nobody reads it as the German name.
  const fell = displayName('Bent-Over Barbell Row', 'bent-over-barbell-row', de, 'de');
  eq(fell, { text: 'Bent-Over Barbell Row', locale: 'en', isFallback: true },
    'an untranslated row falls back to English and is FLAGGED as English');
  ok(fell.text !== '', 'never a blank');
  ok(fell.text !== 'bent-over-barbell-row', 'and never the id');

  // An English reader is not experiencing a fallback and must not be told they
  // are — that badge on every row of the library would be noise on a screen
  // where nothing is missing.
  eq(displayName('Back Squat', 'back-squat', de, null),
    { text: 'Back Squat', locale: 'en', isFallback: false }, 'English shown to an English reader is not a fallback');

  eq(displayName('Back Squat', 'back-squat', null, 'de'),
    { text: 'Back Squat', locale: 'en', isFallback: true },
    'no translations loaded at all still produces a name, flagged');

  eq(fallbackTag(translated), null, 'a translated name carries no marker');
  eq(fallbackTag(fell), 'EN', 'an untranslated one is marked EN');
}

// ── the description, where "nothing" is a real answer ──────────────────────
{
  const de = indexTranslations([
    { exerciseId: 'deadlift', locale: 'de', name: 'Kreuzheben', description: 'Eine Hüftbeuge vom Boden.' },
    { exerciseId: 'back-squat', locale: 'de', name: 'Kniebeuge' },
  ], 'de');

  eq(displayDescription('A hip hinge from the floor.', 'deadlift', de, 'de'),
    { text: 'Eine Hüftbeuge vom Boden.', locale: 'de', isFallback: false }, 'a translated description is shown');
  eq(displayDescription('A knee-dominant squat.', 'back-squat', de, 'de'),
    { text: 'A knee-dominant squat.', locale: 'en', isFallback: true },
    'a translated NAME does not imply a translated description — the English one is flagged');
  // Roughly a fifth of the catalogue has no description in any language, and
  // ExerciseDetail.description already says a screen must show nothing rather
  // than fill the space. A null here is that, not a failure.
  eq(displayDescription(null, 'plank', de, 'de'), null, 'no description in any language is null, not an empty string');
  eq(displayDescription('   ', 'plank', de, 'de'), null, 'and neither is whitespace a description');
}

// ── the sentence the detail screen shows ───────────────────────────────────
{
  const nameEn = { text: 'Pendlay Row', locale: 'en', isFallback: true };
  const nameDe = { text: 'Kniebeuge', locale: 'de', isFallback: false };
  const descEn = { text: 'A strict row from the floor.', locale: 'en', isFallback: true };
  const descDe = { text: 'Eine Hüftbeuge vom Boden.', locale: 'de', isFallback: false };

  ok((fallbackNote(nameEn, descEn) || '').includes('name and description'),
    'when both fell back the note says both did');
  ok((fallbackNote(nameEn, descDe) || '').includes('its name is shown in English'),
    'when only the name fell back the note is about the name');
  ok((fallbackNote(nameDe, descEn) || '').includes('description'),
    'a translated name with an untranslated description still gets said out loud');
  eq(fallbackNote(nameDe, descDe), null, 'nothing fell back, so there is nothing to apologise for');
  eq(fallbackNote(nameDe, null), null, 'and a movement with no description at all is not a fallback');
  eq(fallbackNote(nameDe), null, 'the description argument is optional');
}

// ── search finds the row under either name ─────────────────────────────────
{
  const shown = { text: 'Kniebeuge', locale: 'de', isFallback: false };
  ok(matchesSearch('knie', 'Back Squat', shown), 'a German member finds it by the German name');
  // Most German coaches learned these movements in English. Dropping the
  // English haystack would hide the catalogue from the person building the
  // programme.
  ok(matchesSearch('squat', 'Back Squat', shown), 'and a coach finds it by the English one');
  ok(matchesSearch('SQUAT', 'Back Squat', shown), 'case is not a filter');
  ok(!matchesSearch('deadlift', 'Back Squat', shown), 'and an unrelated term still does not match');
  ok(matchesSearch('  ', 'Back Squat', shown), 'an empty term matches everything, as every list in this app does');
  ok(matchesSearch('squat', 'Back Squat', null), 'a row with no translation is still searchable in English');
  ok(matchesSearch('knie', 'Back Squat', 'Kniebeuge'), 'a bare string is accepted as the shown name');
}

// ── the validator both the importer and the gate run ───────────────────────
{
  const known = new Set(['back-squat', 'deadlift']);

  eq(validateTranslations([
    { exerciseId: 'back-squat', locale: 'de', name: 'Kniebeuge' },
    { exerciseId: 'deadlift', locale: 'es', name: 'Peso muerto' },
  ], known), [], 'a clean set has nothing wrong with it');

  // The row the whole gate is for: it points at a movement that does not
  // exist, so applying the seed fails half way through and the catalogue is
  // left half translated with nothing recording which half.
  const orphan = validateTranslations([{ exerciseId: 'kniebeuge', locale: 'de', name: 'Kniebeuge' }], known);
  eq(orphan.length, 1, 'a translation of a movement that does not exist is one problem');
  ok(orphan[0].includes('kniebeuge') && orphan[0].includes('no such exercise'),
    'and the sentence names the id, because the fix is to correct that id');

  const badLocale = validateTranslations([{ exerciseId: 'back-squat', locale: 'de-DE', name: 'Kniebeuge' }], known);
  ok(badLocale.some((p) => p.includes('de-DE')), 'a locale outside the supported set is caught');
  ok(badLocale.some((p) => p.includes('de, es')), 'and the message says what the supported set is');

  ok(validateTranslations([{ exerciseId: 'back-squat', locale: 'en', name: 'Back Squat' }], known).length > 0,
    "'en' is refused like any other unsupported locale — English is the catalogue, not a translation of it");

  const dupe = validateTranslations([
    { exerciseId: 'back-squat', locale: 'de', name: 'Kniebeuge' },
    { exerciseId: 'back-squat', locale: 'de', name: 'Hocke' },
  ], known);
  ok(dupe.some((p) => p.includes('twice')), 'the same movement translated twice in one set is caught');
  // Both rows would apply; the last one wins. Which name a German member reads
  // would be decided by the order lines happen to sit in a file.
  ok(dupe.some((p) => p.includes('row order')), 'and the message says why that matters');

  const empty = validateTranslations([{ exerciseId: 'back-squat', locale: 'de', name: '  ', description: null }], known);
  ok(empty.some((p) => p.includes('neither')), 'a row that translates nothing is caught');

  const noId = validateTranslations([{ exerciseId: '', locale: 'de', name: 'Kniebeuge' }], known);
  ok(noId.some((p) => p.includes('no exercise')), 'a row naming no exercise is caught');

  // Every problem, not the first: a translation set is corrected in one pass
  // or in three hundred.
  const many = validateTranslations([
    { exerciseId: 'nope-one', locale: 'de', name: 'Eins' },
    { exerciseId: 'nope-two', locale: 'de', name: 'Zwei' },
  ], known);
  eq(many.length, 2, 'both bad rows are reported, not just the first');
}

if (errors.length) {
  console.error(`catalogueLocale.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('catalogueLocale.test.ts — ok');
