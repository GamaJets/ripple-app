// Which delivery mode a coach classified a client as, before the server agreed.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// src/ui/roster.tsx kept them under one unqualified AsyncStorage key:
//
//   const MODE_KEY = 'repple.clientModes';
//   useEffect(() => { … const raw = await AsyncStorage.getItem(MODE_KEY); … }, []);
//   AsyncStorage.setItem(MODE_KEY, JSON.stringify(next));
//
// That is the shape src/lib/mealSwaps.ts and src/lib/handsetClips.ts were
// written to end, and it is the same handset. A key with no account in it is a
// key the next account inherits, and nothing cleared this one: it was not in
// `PERSONAL_DEVICE_KEYS` (src/lib/signOutState.ts), and `repple.clientModes` is
// mentioned nowhere else in the repository, so no screen removed it either. It
// survived sign-out, sign-in, and the next coach entirely.
//
// ── How far it reaches, checked rather than assumed ───────────────────────
//
// This one is SMALLER than the rest of its class, and saying so is the point.
// `repple.clientModes` has NO server path of its own: `setClientMode` writes the
// mode to `clients` / `coach_clients` and this map is only the local echo held
// until the server accepts one — `forgetMode` drops the entry the moment it
// does. So an inherited entry cannot be promoted to anybody's row, cannot be
// read by the owner console, and cannot become a figure a coach reads.
//
// What it can do is shadow a fact. RosterProvider applies the map by client id
// (`modeOverrides[c.id] ? { ...c, mode: … } : c`), so an entry only bites on an
// id the NEXT coach also has on their roster — a client both coaches are linked
// to, which at a gym with two trainers on one desk handset is the ordinary case
// rather than the exotic one. Coach B then reads coach A's classification of
// that client as if it were their own, and reads it in place of the server's,
// which is the one thing the note on `modeOverrides` says must not happen.
//
// So: a preference leak, not a data corruption. It puts a stale opinion on one
// screen. It is fixed the same way as the rest of the class because the shape of
// the defect is identical and half-fixing a class is how the other half is
// forgotten — not because the consequence is equal to theirs.
//
// ── What is NOT migrated, and why ─────────────────────────────────────────
//
// The old global key is deleted rather than read into the signed-in account,
// which is the call src/lib/mealSwaps.ts made for `repple.mealOverride` and
// src/lib/handsetClips.ts made for `repple.exerciseVideos`, and it is the same
// call here. Reading it would be the defect performed once, deliberately: the
// blob carries no account, so nothing on the device distinguishes a single-coach
// handset's own old classifications from a shared handset's previous coach's,
// and a migration is a guess dressed as a repair. Guessing wrong puts one
// coach's opinion under another coach's name; guessing right saves a coach
// re-tapping a chip on a client whose mode the server is about to answer for
// anyway. `LEGACY_CLIENT_MODES_KEY` is exported so the provider can remove it on
// sight and so the choice is visible to a reader rather than implied.
//
// Pure: strings, parsing and a rule. src/ui/roster.tsx does the storage.
import { readCoachedModeOrNull, type CoachedMode } from './types';

/** Every client-mode key starts with this. Nothing reads it at runtime; it is
 *  here so the shape can be asserted and recognised. */
export const CLIENT_MODES_PREFIX = 'repple.clientModes:';

/** The unqualified key this replaces. Removed on sight, never read — see the
 *  header. */
export const LEGACY_CLIENT_MODES_KEY = 'repple.clientModes';

/**
 * Where this coach's classifications live.
 *
 * Null when there is no account to scope them to — a signed-out or
 * still-restoring session — and a null means DO NOT PERSIST and DO NOT READ.
 * Falling back to a shared key is the defect itself.
 *
 * Nothing is lost by refusing: a chip tapped before anybody is signed in
 * classifies a client on a roster that has not been read yet.
 */
export function clientModesKey(uid: string | null | undefined): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  // 'unknown' is the literal src/ui/clientData.tsx settles on before the auth
  // read lands. It is not an account and must never be used as one — every
  // signed-out session on a handset would share it.
  if (!id || id === 'unknown') return null;
  return `${CLIENT_MODES_PREFIX}${id}`;
}

/** Whether a key holds somebody's classifications. For the sign-out assertion. */
export const isClientModesKey = (k: string): boolean =>
  typeof k === 'string' && k.startsWith(CLIENT_MODES_PREFIX);

/**
 * The overrides read back off a stored string: client id → delivery mode.
 *
 * Every value is put through `readCoachedModeOrNull` — the strict half of the
 * pair in src/lib/types.ts — rather than trusted. The old code was a bare
 * `JSON.parse` inside a `try`, so anything that parsed at all was accepted: a
 * blob holding `{"c1": "onlne"}` put a string no `mode` column would take onto a
 * roster card and into the roster filter, where it matched nothing and the
 * client silently left the list.
 *
 * The strict reader and not `readCoachedMode`, which answers 'online' for
 * anything it does not recognise. Here that would be an invented answer: a
 * damaged value is not somebody classifying a client as online, and this map's
 * whole job is to say what the coach chose.
 *
 * An unreadable blob is NO overrides. That is not a failed read being called an
 * empty one: the override exists only to hold an answer the server has not
 * accepted yet, and the honest fallback for "we cannot tell what this device
 * remembered" is the server's own mode, which is what the roster already shows.
 */
export function readClientModes(raw: string | null | undefined): Record<string, CoachedMode> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, CoachedMode> = {};
    for (const [id, mode] of Object.entries(v as Record<string, unknown>)) {
      if (!id) continue;
      const m = readCoachedModeOrNull(mode);
      // An entry that does not narrow is left OUT rather than defaulted in, so a
      // damaged value becomes "this device has no opinion" rather than an
      // opinion nobody held.
      if (m == null) continue;
      out[id] = m;
    }
    return out;
  } catch { return {}; }
}

/** The overrides as they go to the store. The counterpart of `readClientModes`,
 *  so the two cannot drift. */
export function writeClientModes(modes: Record<string, CoachedMode> | null | undefined): string {
  return JSON.stringify(readClientModes(JSON.stringify(modes ?? {})));
}
