// A body-composition breakdown belongs to the body it was measured from.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// src/ui/clientData.tsx kept the InBody composition metrics under one
// unqualified AsyncStorage key, keyed by nothing at all:
//
//   useEffect(() => { (async () => { try {
//     const raw = await AsyncStorage.getItem('repple.scanMetrics');
//     if (raw) setScanMetrics(JSON.parse(raw));
//   } catch {} })(); }, []);
//
//   AsyncStorage.setItem('repple.scanMetrics', JSON.stringify(nm))
//
// That is the third time this repository has had to end this shape, after
// `repple.mealOverride` (src/lib/mealSwaps.ts) and `repple.exerciseVideos`
// (src/lib/handsetClips.ts), on the same handset and for the same reason. A key
// with no account in it is a key the next account inherits.
//
// And this one is merged back BY DAY. The provider's `sorted` takes each scan
// and, when the row itself carries no breakdown, attaches whatever this map
// holds for `takenAt.slice(0, 10)`. So on the gym's shared handset, person A's
// visceral fat, BMR, fat and lean mass, body water and five segmental lean
// figures attach to person B's OWN scan of the same date — one date is the
// whole of the matching — and are then drawn under B's name in the Body
// Composition section of app/(client)/scans.tsx, in app/(trainer)/my-progress.tsx,
// and folded into `compositionInsights` for the report at app/(client)/report.tsx.
// A gym where two members are scanned on the same afternoon is not the rare
// case; it is the ordinary one, because the machine is on the gym floor.
//
// The in-memory half was the same defect again: the SIGNED_OUT branch of the
// auth listener clears `scans`, the name, the photo, the injuries and the
// manual figures, and did not clear `scanMetrics` — and the read effect above
// had `[]` dependencies, so it never ran a second time. The departing member's
// breakdown stayed in React state for the life of the process even where the
// device store was not consulted at all.
//
// src/lib/signOutState.ts names "body-scan metrics" in as many words as its
// example of a record that must be KEYED BY ACCOUNT rather than cleared. This
// one was neither.
//
// ── Why not an entry in PERSONAL_DEVICE_KEYS ──────────────────────────────
//
// Because clearing it on sign-out would destroy the record of the person who is
// LEAVING, which is the outbox argument in that file: a preference forgotten
// costs a question being asked again, and a measurement forgotten costs a
// measurement. The account goes in the key instead. A key with the account in
// it is unreadable to the next account by construction, and takes nothing from
// anybody.
//
// ── What is NOT migrated, and why — the call, and the fact that decided it ─
//
// The unqualified key is REMOVED on sight, never read into the signed-in
// account. That is the same call Lane 4 made for `repple.mealOverride` and Lane
// 85 made for `repple.exerciseVideos`, and it deserved more scrutiny here than
// it did there, because those two hold a PREFERENCE and this holds a
// MEASUREMENT: guessing wrong about a swapped breakfast costs a breakfast, and
// losing a measurement loses something a machine did that nobody can reproduce
// from memory.
//
// What settles it is that this key is not the record. `scans.metrics` is a
// column on the server (see `addScan`, which inserts the scan and then updates
// the row with the breakdown, and the hydrate read, which selects it back as
// `metrics: r.metrics ?? undefined`). This map is a CACHE IN FRONT OF THAT
// COLUMN: the merge in `sorted` only ever fires for a scan whose own `metrics`
// is absent. So for every breakdown whose write actually landed — which is all
// of them but the refused ones — dropping this key costs a cache entry and
// nothing else, and the next launch reads the same figures off the server.
//
// The residue is the breakdowns whose second write was refused, where this
// really is the only copy. Those are lost, and that is the price. It is the
// right price, because there is nothing on the device that could tell a
// single-owner handset's own old metrics from a shared handset's previous
// member's — the blob carries a date and thirteen numbers, no account, no scan
// id — so a migration would not be a rescue, it would be this defect performed
// once, deliberately, and its output is a stranger's body composition printed
// under somebody's own name on a screen their coach reads and acts on. A
// missing breakdown says "scan again". A wrong one says nothing at all.
//
// `LEGACY_SCAN_METRICS_KEY` is exported so the provider can remove it on sight,
// and so the choice is visible to a reader rather than implied.
import type { ScanMetrics } from './inbodyMetrics';

/** Every scan-metrics key starts with this. Nothing reads it at runtime; it is
 *  here so the shape can be asserted and recognised. */
export const SCAN_METRICS_PREFIX = 'repple.scanMetrics:';

/** The unqualified key this replaces. Removed on sight, never read — see the
 *  header. */
export const LEGACY_SCAN_METRICS_KEY = 'repple.scanMetrics';

/**
 * The fields a stored breakdown may carry.
 *
 * `satisfies Record<keyof ScanMetrics, true>` rather than a hand-kept list: a
 * field added to `ScanMetrics` and not added here fails to COMPILE, instead of
 * being silently dropped by the reader below and going missing from one screen
 * in a year's time. The excess check runs the other way for free — a name here
 * that is not a metric is an error too.
 */
const METRIC_FIELDS = {
  visceralFat: true, inbodyScore: true, bmr: true,
  fatMassKg: true, leanMassKg: true,
  bodyWaterL: true, proteinKg: true, mineralsKg: true,
  leanArmLKg: true, leanArmRKg: true, leanTrunkKg: true,
  leanLegLKg: true, leanLegRKg: true,
} satisfies Record<keyof ScanMetrics, true>;

/** The same fields as a list, for the reader and for the assertion. */
export const SCAN_METRIC_FIELDS = Object.keys(METRIC_FIELDS) as (keyof ScanMetrics)[];

/** The day a breakdown is filed under — `takenAt.slice(0, 10)`, and nothing
 *  else, because that slice is the whole of how the merge matches. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Where this member's cached breakdowns live.
 *
 * Null when there is no account to scope them to — a signed-out session, or one
 * whose auth read has not landed — and a null means DO NOT PERSIST, and DO NOT
 * READ. Falling back to a shared key is the defect itself. Nothing is lost by
 * not saving: a scan added before anybody is signed in has no `client_id` to
 * insert under either, so `addScan` has not reached the server with it.
 */
export function scanMetricsKey(uid: string | null | undefined): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  // 'unknown' is the literal src/ui/clientData.tsx publishes as `id` before the
  // auth read lands. It is not an account and must never be used as one — every
  // signed-out session on a handset would otherwise share one key, which is
  // what this file exists to stop. Guarded here for the same reason
  // `mealSwapsKey` and `handsetClipsKey` guard it.
  if (!id || id === 'unknown') return null;
  return `${SCAN_METRICS_PREFIX}${id}`;
}

/** Whether a key holds somebody's cached breakdowns. For the sign-out
 *  assertion. */
export const isScanMetricsKey = (k: string): boolean =>
  typeof k === 'string' && k.startsWith(SCAN_METRICS_PREFIX);

/**
 * The breakdowns read back off a stored string: day → composition figures.
 *
 * Every field is checked rather than trusted. The old code was a bare
 * `JSON.parse` assigned straight into state, so anything that parsed at all was
 * merged onto a scan and charted — and these numbers are not labels. They go to
 * `metricTrends`, which filters on `typeof v === 'number'` and then subtracts
 * one from another; a stored `NaN` passes that filter and comes out as a delta
 * of NaN on a member's own trend, and `Infinity` comes out as a chart with one
 * point and no scale. `deltaLabel` then decides from the sign of that number
 * whether the member is told they are moving the right way.
 *
 *   · A DAY that is not `YYYY-MM-DD` is dropped. It can match no scan anyway —
 *     the merge looks up `takenAt.slice(0, 10)` — so keeping it would only
 *     grow the blob.
 *   · A FIELD that is not a finite number is dropped, not repaired. There is no
 *     honest repair for "we cannot read your lean mass", and zero is not it.
 *   · A NEGATIVE field is dropped. No mass, no volume and no score on this
 *     sheet can be below zero; exactly zero is kept, because a zero segmental
 *     lean reading is a real thing the machine reports for a limb it could not
 *     read, and src/lib/inbodyMetrics.test.ts pins what the app does with one.
 *   · A DAY left with no usable field is dropped whole, which is the same
 *     answer `scansWithMetrics` gives an empty blob and the same test `addScan`
 *     applies before writing one: an empty breakdown is not a breakdown, and
 *     one merged onto a scan would make that scan count toward "N scans with a
 *     breakdown" while contributing nothing to any trend in it.
 *
 * An unreadable blob is NO breakdowns — and that is not a failed read being
 * called an empty one. The caller keeps its own `hydrated` flag false on a
 * failed READ and refuses to write, so "these bytes will not parse" and "the
 * store would not answer" stay different facts at the one place they differ:
 * whether the next write is allowed to stand on top of what is on the device.
 * A scan with no breakdown is also a state every screen already draws honestly,
 * because it is what a scan taken on a tape measure looks like.
 */
export function readScanMetrics(raw: string | null | undefined): Record<string, ScanMetrics> {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, ScanMetrics> = {};
  for (const [day, blob] of Object.entries(parsed as Record<string, unknown>)) {
    if (!DAY_RE.test(day)) continue;
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) continue;
    const src = blob as Record<string, unknown>;
    const m: ScanMetrics = {};
    let any = false;
    for (const f of SCAN_METRIC_FIELDS) {
      const v = src[f];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
      m[f] = v;
      any = true;
    }
    if (any) out[day] = m;
  }
  return out;
}

/** The breakdowns as they go to the store. The counterpart of
 *  `readScanMetrics`, routed through it so that what is written is exactly what
 *  will be read back and the two cannot drift. */
export function writeScanMetrics(map: Record<string, ScanMetrics> | null | undefined): string {
  return JSON.stringify(readScanMetrics(JSON.stringify(map ?? {})));
}

/**
 * Attach a cached breakdown to a scan that has none of its own.
 *
 * Lifted out of `sorted` in src/ui/clientData.tsx unchanged, so the one place
 * the cache reaches the rest of the app can be RUN by a test rather than read
 * by a reviewer — which is what "a single-account handset sees exactly what it
 * saw before" has to mean to be worth claiming.
 *
 * The server's own `metrics` always wins: a row that carries a breakdown is
 * returned untouched, by identity, so nothing downstream sees a new object for
 * a scan nothing happened to. `stored` being empty — the state of every
 * signed-out session, and of the second account on a shared handset — returns
 * the list it was given, element for element.
 */
export function mergeStoredMetrics<T extends { takenAt: string; metrics?: ScanMetrics }>(
  scans: readonly T[],
  stored: Record<string, ScanMetrics>,
): T[] {
  return scans.map((s) => {
    if (s.metrics) return s;
    const m = stored[s.takenAt.slice(0, 10)];
    return m ? { ...s, metrics: m } : s;
  });
}
