"use strict";
// Mapping a RepDB pack onto this app's catalogue, and deciding whether the pack
// in somebody's Downloads folder is one we are allowed to ship.
//
// This is the pure half of scripts/import-repdb.mjs. It lives here rather than
// inside the script so that the rules below are covered by `npm test` — the
// script itself reads 1.8 GB off a disk that CI does not have, so nothing in it
// can be exercised there, and the two rules this file exists for are exactly
// the ones that fail silently.
//
// ── The two keys, which are NOT the same key ──────────────────────────────
//
// This is the whole reason this file exists, and getting it wrong has already
// cost this repo one production incident.
//
// A RepDB record carries its own `id` — `barbell-row` — and a display name,
// "Bent-Over Barbell Row". Those disagree for 80 of the 601 records. Two
// different consumers want two different ones:
//
//   · the CATALOGUE ROW is keyed by slug(name_en). Every screen in the app
//     resolves a movement by exerciseSlug(name), because a program stores an
//     exercise NAME. A row keyed by RepDB's id instead is in the catalogue and
//     unreachable from it — it lists in the picker, shows an illustration, and
//     answers "not in our catalogue" when tapped. That is precisely what
//     happened to 80 movements once already; see 74-repdb-catalogue.sql.
//
//   · the MEDIA FILE is named by RepDB's own id — or, for six records, by the
//     `image_alias` they borrow artwork under. On disk the picture for
//     "Bent-Over Barbell Row" is `barbell-row-start.webp`, not
//     `bent-over-barbell-row-start.webp`. Building the filename from the row id
//     finds nothing for those same 80 rows, and the failure is a silent one:
//     the import reports success and 80 movements come out with no picture.
//
// So both directions are wrong in isolation and each one is wrong for a
// different set of consequences. Everything below keeps them apart by name.
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPORT_TRANSLATION_LOCALES = exports.slug = void 0;
exports.packTier = packTier;
exports.tierMayShip = tierMayShip;
exports.demoLicenceFor = demoLicenceFor;
exports.catalogueId = catalogueId;
exports.mediaKey = mediaKey;
exports.stillFiles = stillFiles;
exports.animationFile = animationFile;
exports.planRow = planRow;
exports.overlap = overlap;
exports.planTranslations = planTranslations;
exports.translationCoverage = translationCoverage;
/**
 * Read the tier out of a pack's LICENSE.md.
 *
 * The importer is pointed at a directory by hand, and the three RepDB archives
 * look nearly identical from the outside: same filenames, same JSON shape, same
 * image folders. The evaluation preview is CC BY-NC and must never reach a
 * product that sells memberships, and the way that goes wrong is not a decision
 * anybody makes — it is a `--pack` argument left pointing at the wrong folder
 * in Downloads. So the tier is read from the licence text that travels with the
 * files rather than passed in as a flag somebody can get wrong.
 *
 * 'unknown' on anything unrecognised, and callers must treat that as
 * non-shippable: a licence we cannot read is not a licence we may assume.
 */
function packTier(licenceText) {
    const t = String(licenceText || '');
    if (!t.trim())
        return 'unknown';
    // Checked before the tier headings, because the preview's licence also names
    // the paid tiers when it points at them, and matching "Standard" anywhere in
    // the file would read the non-commercial preview as the commercial bundle —
    // which is the single most expensive misread this function can make.
    if (/creativecommons\.org\/licenses\/by-nc|BY-NC|NonCommercial/i.test(t))
        return 'preview-nc';
    if (/Standard\s+License/i.test(t))
        return 'standard';
    if (/Free\s+Tier\s+License/i.test(t))
        return 'free';
    return 'unknown';
}
/**
 * Whether a pack of this tier may be written into the product at all.
 *
 * Both the Standard bundle and the free tier permit commercial use inside an
 * application; the evaluation preview does not, and an unreadable licence is
 * treated exactly like the preview. The expensive guess is the permissive one,
 * so absence of evidence is refusal — the same rule demoIsShippable() applies
 * per row at render time, kept consistent here at import time.
 */
function tierMayShip(tier) {
    return tier === 'standard' || tier === 'free';
}
/**
 * What `exercises.demo_licence` should say for media out of this pack.
 *
 * The licence travels with the row rather than with the build, because the
 * realistic failure is a preview animation that got wired in to look at, worked
 * fine, and was still there four builds later inside an App Store binary that
 * nobody re-checked. A row that carries its own provenance can be asked at
 * render time; a build-time constant cannot.
 */
function demoLicenceFor(tier) {
    if (tier === 'standard' || tier === 'free')
        return 'commercial';
    if (tier === 'preview-nc')
        return 'evaluation';
    return null;
}
/** Mirrors exerciseSlug() in src/lib/exerciseId.ts. Duplicated rather than
 *  imported because scripts/import-repdb.mjs loads this module through Node's
 *  type stripping, which cannot follow into the app's React Native imports. */
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');
exports.slug = slug;
/**
 * The id this record must take in `public.exercises`.
 *
 * The slug of the DISPLAYED NAME, never RepDB's own id — see the header. Falls
 * back to the vendor id only when the name is missing entirely, because a row
 * with no id at all cannot be inserted and dropping it silently would shrink
 * the catalogue without saying so.
 */
function catalogueId(rec) {
    return (0, exports.slug)(rec.name_en) || (0, exports.slug)(rec.id);
}
/**
 * The stem RepDB's own media files are named by.
 *
 * The vendor id, because that is what is actually on disk. Kept as its own
 * named function so that a future reader cannot mistake it for catalogueId():
 * the two return different strings for 80 of the 601 records, and the compiler
 * cannot tell you which one a call site wanted.
 *
 * ── image_alias comes FIRST, and skipping it looked like missing files ────
 *
 * A handful of movements are visual variants of another and ship no artwork of
 * their own — Paused Overhead Press reuses Overhead Press's, Pause Deadlift
 * reuses Deadlift's. Those records carry `image_alias`, and the pack's README
 * is explicit that image AND animation filenames are built from the alias
 * rather than from the id.
 *
 * Reading the id regardless does not fail loudly. It produces a filename that
 * is simply not in the pack, so the importer reported "6 claim an animation
 * with NO FILE" and "12 stills named in the JSON are absent" — which reads as
 * the vendor shipping an incomplete archive, and was in fact us looking in the
 * wrong place. Every one of those 18 files is present under the alias. Confirmed
 * against the Standard bundle: keyed by id, 6 animations and 12 stills are
 * missing; keyed by the alias, nothing is.
 */
function mediaKey(rec) {
    return (0, exports.slug)(rec.image_alias) || (0, exports.slug)(rec.id) || (0, exports.slug)(rec.name_en);
}
/**
 * The still-image files for a record, in the order the screen plays them.
 *
 * Order is load bearing and not alphabetical: the detail screen cross-fades
 * image_paths[0] into image_paths[1], so a peak-then-start array plays the
 * movement backwards. RepDB lists the variants in the right order already, but
 * this sorts explicitly rather than trusting it, because a vendor reordering
 * its own JSON is not something we would notice — the images would still all be
 * present and the rep would just run in reverse.
 *
 * `main` is a single illustration for a movement with no two ends to show — a
 * plank, a carry, a stretch held in place. 134 of the 601 are shaped that way,
 * and reading only start/peak drops every one of them on the floor while
 * looking like RepDB simply had no picture.
 */
const VARIANT_ORDER = { start: 0, main: 0, peak: 1 };
function stillFiles(rec, style) {
    const variants = (rec.images?.[style] || []).filter((v) => typeof v === 'string' && v);
    if (!variants.length)
        return [];
    const key = mediaKey(rec);
    if (!key)
        return [];
    return [...variants]
        .sort((a, b) => (VARIANT_ORDER[a] ?? 9) - (VARIANT_ORDER[b] ?? 9))
        .map((v) => `images/${style}/${key}-${v}.webp`);
}
/**
 * The animation file for a record, or null when it claims none.
 *
 * Returning a path here is a CLAIM, not a confirmation. The caller still has to
 * stat the file before writing animation_path — a path written for a file that
 * is not there produces a signed URL to nothing, and the client sees a
 * permanently spinning player rather than the still frames it would otherwise
 * have fallen back to.
 *
 * All 489 records that set `animation: true` in the Standard bundle do resolve
 * to a file, but only via mediaKey() — six of them name their clip by
 * `image_alias`, and 483 files serve the 489 records because those six share
 * artwork with another movement. A pack where the stat fails is a pack to stop
 * on, not one to write through.
 */
function animationFile(rec) {
    if (!rec.animation)
        return null;
    const key = mediaKey(rec);
    return key ? `images/animations/${key}.webp` : null;
}
/**
 * Resolve one record to the row and the media the importer would write.
 *
 * Returns null for a record with no usable id at all rather than inventing one,
 * because a catalogue row that nothing can resolve is worse than an absent one:
 * it is listed, illustrated, and dead on tap.
 */
function planRow(rec, style) {
    const id = catalogueId(rec);
    if (!id)
        return null;
    const key = mediaKey(rec);
    return {
        id,
        mediaKey: key,
        rekeyed: key !== id,
        stills: stillFiles(rec, style),
        animation: animationFile(rec),
    };
}
/**
 * How the pack's records line up against the catalogue we already have.
 *
 * The number this produces is the one that decides the whole shape of the job:
 * a high overlap means a MEDIA BACKFILL onto rows that already exist, and a low
 * one means a catalogue replacement with every program and log in the database
 * pointing at names that are about to move. Those are not the same change and
 * they do not carry the same risk, so the number is computed rather than
 * assumed.
 *
 * Matched on the catalogue id, which for both sides is the slug of the
 * displayed name — the one key every screen in the app actually resolves.
 */
function overlap(records, existingIds) {
    const matched = [];
    const added = [];
    for (const rec of records) {
        const id = catalogueId(rec);
        if (!id)
            continue;
        (existingIds.has(id) ? matched : added).push(id);
    }
    return { matched, added };
}
/* ═══════════════════════════════════════════════════════════════════════════
 * Translations
 *
 * The Standard bundle ships `exercises.de.json` and `exercises.es.json`
 * alongside `exercises.json` — 601 records each, with a translated name, a
 * translated description, instructions and tips. They are keyed by RepDB's OWN
 * id, which is the whole reason this section exists rather than being three
 * lines in the script.
 *
 * ── The third key, and it is the first one again ──────────────────────────
 *
 * The header of this file is about two keys that are not the same key. A
 * translation set introduces the same trap a third time and in its most
 * expensive form:
 *
 *   `exercises.de.json` has an entry for `barbell-row`. The catalogue row for
 *   that movement is `bent-over-barbell-row`, because the id is the slug of the
 *   DISPLAYED NAME. Writing the translation under the vendor id produces a row
 *   in `exercise_translations` pointing at an exercise that does not exist.
 *
 * That happens for the same 80 of 601 records the catalogue import already had
 * to rekey. It is not silent this time — `exercise_translations.exercise_id` is
 * a foreign key, so the insert is rejected — but it is rejected HALF WAY
 * THROUGH, taking the rest of the language with it and leaving a catalogue
 * partly translated with nothing recording which part.
 *
 * So the join below is: read the localised file by VENDOR id, find the English
 * record with that vendor id, and emit catalogueId() of the English record.
 * scripts/check-translations.mjs makes the same check against the seed parts.
 * ═══════════════════════════════════════════════════════════════════════════ */
/**
 * The catalogue languages, duplicated from TRANSLATION_LOCALES in
 * src/lib/catalogueLocale.ts for the same reason `slug` above is duplicated
 * from exerciseId.ts: scripts/import-repdb.mjs loads this module through Node's
 * type stripping, which resolves only what it is given an explicit path to.
 *
 * Duplication that drifts silently is worse than no duplication, so
 * scripts/check-translations.mjs compares all three places this set is written
 * down — here, the TypeScript module the app reads, and the check constraint in
 * supabase/parts/790 — and fails the build when they disagree.
 *
 * English is deliberately absent. It is not a translation of the catalogue, it
 * is `exercises.name`, and `exercises.id` is the slug of it.
 */
exports.IMPORT_TRANSLATION_LOCALES = ['de', 'es'];
const text = (v) => {
    if (typeof v !== 'string')
        return null;
    const t = v.trim();
    return t === '' ? null : t;
};
/**
 * The translation rows for one language, and everything that did not become
 * one.
 *
 * Idempotent by construction: the output is keyed (exerciseId, locale), which
 * is the primary key of the table, so the caller's upsert re-running or being
 * re-run with corrections leaves exactly one row per movement per language.
 * Loading German twice does not produce a second exercise, a second name, or a
 * second anything — that is the property the whole table shape was chosen for,
 * and it is asserted in src/lib/repdbImport.test.ts.
 *
 * `records` is the ENGLISH set — it is what carries `name_en`, and therefore
 * the only thing that knows what the catalogue id is. A localised record with
 * no English counterpart is skipped rather than guessed at: it would be a
 * foreign key violation, and inventing a catalogue id from a German name would
 * mint a row nothing in the app can ever resolve.
 *
 * A record with neither a name nor a description in this language produces NO
 * ROW, rather than an empty one. Part 790 refuses to store one anyway, and the
 * reason is on screen: absence of a row shows English and says it is English,
 * where a row with a blank name shows nothing at all.
 */
function planTranslations(records, localised, locale) {
    const rows = [];
    const skipped = [];
    if (!exports.IMPORT_TRANSLATION_LOCALES.includes(locale))
        return { rows, skipped };
    // By VENDOR id. That is what the localised files are keyed by, and joining on
    // anything else is the fault this whole section exists to prevent.
    const english = new Map();
    for (const rec of records) {
        const vendorId = (0, exports.slug)(rec.id);
        if (vendorId)
            english.set(vendorId, rec);
    }
    const taken = new Set();
    for (const loc of localised) {
        const vendorId = (0, exports.slug)(loc?.id);
        if (!vendorId) {
            skipped.push({ vendorId: String(loc?.id ?? ''), reason: 'no-usable-id' });
            continue;
        }
        const rec = english.get(vendorId);
        if (!rec) {
            skipped.push({ vendorId, reason: 'no-english-record' });
            continue;
        }
        const exerciseId = catalogueId(rec);
        if (!exerciseId) {
            skipped.push({ vendorId, reason: 'no-usable-id' });
            continue;
        }
        const name = text(loc.name);
        const description = text(loc.description);
        if (name == null && description == null) {
            skipped.push({ vendorId, reason: 'nothing-to-translate' });
            continue;
        }
        // Two vendor records whose English names slug to the same catalogue id
        // would both write the same row, and the second would silently overwrite
        // the first. Counted, so the report says a language is 600 rows and not
        // 601 rather than quietly being one short.
        if (taken.has(exerciseId)) {
            skipped.push({ vendorId, reason: 'duplicate' });
            continue;
        }
        taken.add(exerciseId);
        rows.push({ exerciseId, locale, name, description });
    }
    return { rows, skipped };
}
/**
 * How many of the catalogue rows this language actually covers, and which are
 * left in English.
 *
 * The number a translation run should be judged on. "601 rows written" says
 * nothing about the catalogue: it could be 601 rows onto 619 movements with 18
 * left English, or 601 rows onto movements that no longer exist. This answers
 * the question the reader has — how much of what I can see is in my language —
 * and the untranslated list is what somebody works through next.
 */
function translationCoverage(rows, catalogueIds) {
    const named = new Set(rows.filter((r) => !!text(r.name)).map((r) => r.exerciseId));
    const translated = [];
    const untranslated = [];
    for (const id of catalogueIds)
        (named.has(id) ? translated : untranslated).push(id);
    translated.sort();
    untranslated.sort();
    return { translated, untranslated };
}
