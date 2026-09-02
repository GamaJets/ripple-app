// One owner, more than one gym — what the console is allowed to say about it.
//
// ── The state of the world this file describes ────────────────────────────
//
// `supabase/parts/290` records WHO OWNS WHAT and grants nothing else. It adds
// `owner_sites` (a table no authenticated account can write) and `my_sites()`
// (a function returning `[{ id, name, current }]`), and it deliberately does
// not touch `is_owner_of`, `my_tenant`, `my_role` or any existing policy. So
// after that part, an owner recorded against two gyms can read exactly one of
// them — the one `current` marks — and can read the OTHER one's name and
// nothing else.
//
// That is a real, useful, and slightly awkward state, and the awkward half is
// the point of this file: a console that quietly showed one gym's numbers to
// somebody who owns two would be telling them their business is smaller than
// it is. So the rule here is the same one the rest of this codebase runs on —
// say what was counted — applied to a question that is normally invisible
// because there has only ever been one answer to it.
//
// ── Why a single-site owner cannot tell any of this exists ────────────────
//
// `owner_sites` ships empty and `my_sites()` returns the profile's own tenant
// whether or not there is a row for it. So an ordinary owner gets a
// one-element list, `siteCount` is 1, and every function below that produces
// copy returns `null`. Nothing renders. That is not an accident of the
// wording — it is asserted in ownedSites.test.ts, because "the common case is
// untouched" is a claim, and a claim about a live database is worth a test.
//
// ── The second half: a figure that covers two places ──────────────────────
//
// `gym_classes.branch` is free text a trainer types (app/(trainer)/classes.tsx
// offers chips built from the gym's own past values) and a client filters the
// timetable by (app/(client)/classes.tsx). It is a label for a place WITHIN
// one gym, and part 290 argues at length that it is not the multi-site key and
// must not be made into one.
//
// But `summariseClassRows` in src/lib/classRates.ts sums whatever rows it is
// handed, and /classes and /analytics both label the result as the gym's fill
// and show rate. Hand it a month of classes from two branches and it returns
// one number that is neither branch's — presented, with no qualification, as
// one place's performance. THAT is the defect: not the blending, which is
// sometimes exactly what an owner wants, but the blending presented as a
// single site's figure. `branchSpan` below is what lets a screen tell the
// difference, and `branchNote` is the sentence it says when it cannot.
import type { LoadStatus } from '../ui/loadStatus';

/* ── who owns what ────────────────────────────────────────────────────────── */

/** One gym this account is recorded as owning. */
export interface OwnedSite {
  id: string;
  /** `tenants.name`, or null when the gym has never been named. Null is not a
   *  failed read here: `my_sites()` returns the row it found, and a gym created
   *  by the sign-up flow without a name is a real state (docs/STUDIO-HUB.md
   *  lists "Gym identity on owner sign-up" as unbuilt). */
  name: string | null;
  /**
   * True for the ONE site this session can actually read.
   *
   * `my_sites()` sets it for the tenant `is_owner_of()` says yes to, which is
   * `profiles.tenant_id`. Every other entry is a gym whose name this account
   * can see and whose data it cannot — because part 290 changed no policy.
   * At most one entry carries it, and an account whose profile is not an owner
   * carries it nowhere.
   */
  current: boolean;
}

/** The answer and how much of it is known. */
export interface SiteScope {
  status: LoadStatus;
  /**
   * The gyms, readable one first. EMPTY UNDER 'error' MEANS UNKNOWN — never
   * "this account owns no gyms", which is a sentence about somebody's business
   * that a failed RPC has established nothing about.
   */
  sites: OwnedSite[];
}

/**
 * `my_sites()`'s jsonb, turned into something with a type on it.
 *
 * Everything is defensive because the value crosses PostgREST as jsonb and
 * arrives as `unknown`: an entry with no id is dropped (it can name no gym),
 * ids and names are trimmed, and a duplicate id keeps the readable copy. A
 * value that is not an array at all under a 'ready' status is treated as no
 * sites rather than as an error — the function's own `coalesce` makes `[]` the
 * floor, so the only way to get here is a shape nobody wrote.
 */
export function sitesFrom(raw: unknown, status: LoadStatus): SiteScope {
  if (status !== 'ready' && status !== 'partial') return { status, sites: [] };
  if (!Array.isArray(raw)) return { status, sites: [] };

  const by = new Map<string, OwnedSite>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as { id?: unknown; name?: unknown; current?: unknown };
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id) continue;
    const name = typeof r.name === 'string' ? (r.name.trim() || null) : null;
    // `=== true` rather than truthiness: jsonb can hand back a string, and
    // "false" is truthy. The flag decides which gym the console claims to be
    // showing, so it is worth being literal about.
    const current = r.current === true;
    const had = by.get(id);
    if (had) { if (current) by.set(id, { id, name: name ?? had.name, current: true }); continue; }
    by.set(id, { id, name, current });
  }

  const sites = [...by.values()].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      (a.name ?? '').localeCompare(b.name ?? '') ||
      a.id.localeCompare(b.id),
  );
  return { status, sites };
}

/**
 * How many gyms this account owns, or null when that is not known.
 *
 * Null under 'loading', 'partial' and 'error', and the reason is the house
 * rule rather than caution: a count over a set that is not all of the set is
 * not a smaller count, it is a wrong one. Every caller below branches on null
 * rather than falling through to a number.
 */
export function siteCount(s: SiteScope): number | null {
  return s.status === 'ready' ? s.sites.length : null;
}

/** The one gym this console is showing, or null when there isn't one — either
 *  because the read did not settle, or because no entry is readable. */
export function currentSite(s: SiteScope): OwnedSite | null {
  if (s.status !== 'ready') return null;
  return s.sites.find((x) => x.current) ?? null;
}

/**
 * Whether the reader should be offered a choice of site at all.
 *
 * False for everybody today, and it will stay false for a single-site owner
 * forever. It is written as its own function rather than as `count > 1` at the
 * call site because the answer has to be false under an unknown count too —
 * offering a picker over a list that did not come back would be a control
 * built out of a failed read.
 */
export function showsSitePicker(s: SiteScope): boolean {
  const n = siteCount(s);
  return n !== null && n > 1;
}

/**
 * The rail's one extra line, or null for no line at all.
 *
 * Null for a single-site owner, which is what makes the rail byte-identical
 * for everybody who is not affected by this. Null under an unknown count too:
 * the rail is a label strip, and the sentence about a failed read belongs on
 * the page beside the figures, which is what `siteNotice` is for.
 */
export function siteRailLine(s: SiteScope): string | null {
  const n = siteCount(s);
  if (n === null || n <= 1) return null;
  return `1 of ${n} sites`;
}

/** What the console says when the site list did not settle. One sentence, in
 *  one place, so two screens cannot word the same silence two ways. */
export const SITES_UNREAD_NOTE =
  'How many gyms this account owns is not known — that read did not come back. The figures below are one gym’s record, and nothing here can say whether that is your whole business or part of it.';

/**
 * The paragraph a screen full of figures puts above them, or null when there
 * is nothing worth saying.
 *
 * Null for: a settled read of one gym (the overwhelming case, and the reason
 * this is invisible in production), a settled read of none (the page already
 * says the account is not linked to a gym), and while the read is in flight.
 *
 * Not null for a failed read, because a multi-site owner and a single-site
 * owner are indistinguishable then, and the difference is what the figures
 * mean.
 */
export function siteNotice(s: SiteScope): string | null {
  if (s.status === 'loading') return null;
  const n = siteCount(s);
  if (n === null) return SITES_UNREAD_NOTE;
  if (n <= 1) return null;

  const here = currentSite(s);
  const others = n - 1;
  const rest = others === 1 ? 'The other one has' : `The other ${others} have`;
  // The gym's name is never the SUBJECT of this sentence when it is missing —
  // "— is one of 3 gyms" reads as a broken screen rather than as missing data,
  // which is what scripts/check-prose.mjs exists to stop.
  const opening = here
    ? (here.name
        ? `Showing ${here.name}, one of ${n} gyms your account owns.`
        : `Showing one of the ${n} gyms your account owns.`)
    : `Your account is recorded as owning ${n} gyms, and this console is not signed in to any of them.`;
  if (!here) return opening;
  return `${opening} ${rest} their own sign-in, and no figure on this page includes them.`;
}

/* ── a figure that covers more than one place ─────────────────────────────── */

/**
 * How many places the rows behind a figure came from.
 *
 *   'unknown'  the read did not settle, so the question cannot be answered.
 *   'none'     no row carries a branch label. Every gym in production today,
 *              because studio-web writes `branch: ''` and always has.
 *   'one'      every row carries the same label. The figure is that place's,
 *              and it is also the whole gym's.
 *   'mixed'    the rows come from more than one place — two labels, or a label
 *              and some unlabelled rows. A total over this set is not any one
 *              place's figure.
 */
export type BranchSpan =
  | { kind: 'unknown' }
  | { kind: 'none' }
  | { kind: 'one'; branch: string }
  | { kind: 'mixed'; branches: string[]; unlabelled: boolean };

/** A row as far as this question is concerned. Anything with a branch on it. */
export interface BranchedRow { branch?: string | null }

/**
 * Which places a set of rows spans.
 *
 * 'partial' is unknown, not 'ready with fewer rows': a truncated read can be
 * missing exactly the branch that would have made the set mixed, and answering
 * 'one' from it is how a blended figure gets a clean bill of health.
 *
 * An empty set under 'ready' is 'none' rather than 'unknown' — there are no
 * rows, so there is nothing being blended, and the screen's own empty state is
 * the sentence that belongs there.
 */
export function branchSpan(rows: readonly BranchedRow[], status: LoadStatus): BranchSpan {
  if (status !== 'ready') return { kind: 'unknown' };
  const labels = new Set<string>();
  let unlabelled = false;
  for (const r of rows) {
    const b = (r.branch ?? '').trim();
    if (b) labels.add(b); else unlabelled = true;
  }
  if (labels.size === 0) return { kind: 'none' };
  if (labels.size === 1 && !unlabelled) return { kind: 'one', branch: [...labels][0] };
  return { kind: 'mixed', branches: [...labels].sort((a, b) => a.localeCompare(b)), unlabelled };
}

/**
 * Whether a figure over these rows may be presented as one place's.
 *
 * THE RULE THIS FILE EXISTS FOR. False under 'mixed' — the figure is real, it
 * is just not one place's, and a screen that prints it under a single gym's
 * name has said something false without printing a wrong number. False under
 * 'unknown' as well: a screen may not claim a scope it did not establish.
 */
export function mayPresentAsOneSite(span: BranchSpan): boolean {
  return span.kind === 'none' || span.kind === 'one';
}

/**
 * The sentence that goes with a blended figure, or null when there is none to
 * say.
 *
 * Null under 'unknown' on purpose: a screen whose read failed already carries
 * its own banner about that, and a second note underneath saying the same
 * thing in different words is how one silence comes to have two explanations.
 * `mayPresentAsOneSite` is the gate; this is only the copy.
 */
export function branchNote(span: BranchSpan): string | null {
  if (span.kind !== 'mixed') return null;
  const named = span.branches.join(', ');
  const tail = span.unlabelled
    ? `${named}, and classes with no place recorded`
    : named;
  return `These figures cover more than one place — ${tail} — so they are a total across all of them and not any one’s.`;
}
