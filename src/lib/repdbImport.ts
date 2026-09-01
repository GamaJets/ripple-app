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

/** Which RepDB licence a pack directory is shipped under. */
export type PackTier = 'standard' | 'free' | 'preview-nc' | 'unknown';

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
export function packTier(licenceText: string | null | undefined): PackTier {
  const t = String(licenceText || '');
  if (!t.trim()) return 'unknown';
  // Checked before the tier headings, because the preview's licence also names
  // the paid tiers when it points at them, and matching "Standard" anywhere in
  // the file would read the non-commercial preview as the commercial bundle —
  // which is the single most expensive misread this function can make.
  if (/creativecommons\.org\/licenses\/by-nc|BY-NC|NonCommercial/i.test(t)) return 'preview-nc';
  if (/Standard\s+License/i.test(t)) return 'standard';
  if (/Free\s+Tier\s+License/i.test(t)) return 'free';
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
export function tierMayShip(tier: PackTier): boolean {
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
export function demoLicenceFor(tier: PackTier): 'commercial' | 'evaluation' | null {
  if (tier === 'standard' || tier === 'free') return 'commercial';
  if (tier === 'preview-nc') return 'evaluation';
  return null;
}

/** Mirrors exerciseSlug() in src/lib/exerciseId.ts. Duplicated rather than
 *  imported because scripts/import-repdb.mjs loads this module through Node's
 *  type stripping, which cannot follow into the app's React Native imports. */
export const slug = (s: string | null | undefined): string =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');

/** A RepDB record, narrowed to the fields the mapping actually reads. */
export type RepdbRecord = {
  id?: string | null;
  name_en?: string | null;
  /** Set when this movement REUSES another movement's artwork. The pack's own
   *  README: "build their image (and animation) filenames from the alias slug,
   *  not the `id`". Six records in the Standard bundle carry one. */
  image_alias?: string | null;
  images?: { classic?: string[]; flat?: string[] } | null;
  animation?: boolean | null;
  animation_type?: string | null;
};

/**
 * The id this record must take in `public.exercises`.
 *
 * The slug of the DISPLAYED NAME, never RepDB's own id — see the header. Falls
 * back to the vendor id only when the name is missing entirely, because a row
 * with no id at all cannot be inserted and dropping it silently would shrink
 * the catalogue without saying so.
 */
export function catalogueId(rec: RepdbRecord): string {
  return slug(rec.name_en) || slug(rec.id);
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
export function mediaKey(rec: RepdbRecord): string {
  return slug(rec.image_alias) || slug(rec.id) || slug(rec.name_en);
}

/** Which of the two shipped art styles to import. */
export type Style = 'classic' | 'flat';

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
const VARIANT_ORDER: Record<string, number> = { start: 0, main: 0, peak: 1 };

export function stillFiles(rec: RepdbRecord, style: Style): string[] {
  const variants = (rec.images?.[style] || []).filter((v) => typeof v === 'string' && v);
  if (!variants.length) return [];
  const key = mediaKey(rec);
  if (!key) return [];
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
export function animationFile(rec: RepdbRecord): string | null {
  if (!rec.animation) return null;
  const key = mediaKey(rec);
  return key ? `images/animations/${key}.webp` : null;
}

/** One record's resolved plan, as the importer would write it. */
export type PlannedRow = {
  /** The id in public.exercises — slug of the name. */
  id: string;
  /** The stem RepDB's files are named by — the vendor id. */
  mediaKey: string;
  /** True when those two differ, which is the case worth counting in a report. */
  rekeyed: boolean;
  /** Still images, in play order, as paths inside the pack. */
  stills: string[];
  /** The animation this record claims, before the file is confirmed to exist. */
  animation: string | null;
};

/**
 * Resolve one record to the row and the media the importer would write.
 *
 * Returns null for a record with no usable id at all rather than inventing one,
 * because a catalogue row that nothing can resolve is worse than an absent one:
 * it is listed, illustrated, and dead on tap.
 */
export function planRow(rec: RepdbRecord, style: Style): PlannedRow | null {
  const id = catalogueId(rec);
  if (!id) return null;
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
export function overlap(
  records: readonly RepdbRecord[],
  existingIds: ReadonlySet<string>,
): { matched: string[]; added: string[] } {
  const matched: string[] = [];
  const added: string[] = [];
  for (const rec of records) {
    const id = catalogueId(rec);
    if (!id) continue;
    (existingIds.has(id) ? matched : added).push(id);
  }
  return { matched, added };
}
