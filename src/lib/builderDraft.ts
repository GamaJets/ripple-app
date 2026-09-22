// The program a coach is part-way through writing — and whose it is.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// app/(trainer)/builder.tsx kept the whole in-progress block under one
// unqualified AsyncStorage key:
//
//   const DRAFT_KEY = 'repple.builder.draft.v1';
//   useEffect(() => { … AsyncStorage.getItem(DRAFT_KEY) … }, []);
//
// No account in the key, `[]` dependencies on the read, and no entry in
// `PERSONAL_DEVICE_KEYS` (src/lib/signOutState.ts) — so nothing removed it at
// sign-out and nothing re-read it at sign-in. That is the same shape
// src/lib/handsetClips.ts and src/lib/mealSwaps.ts were written to end, and on
// this screen it is worse than either of them.
//
// What the blob holds is a whole program: a title, a coach's note, and every
// week, day, exercise, set, rep, load and cue they have typed. On a shared gym
// handset coach B signs in, opens Programs, and coach A's entire draft is
// restored into their builder with `seededFor` set to null — which is the
// screen saying "this is your own work". The Assign control on the same screen
// then sends it to B's clients, under B's name, with A's loads on it. The
// inheritance does not even need a sign-out to be missed: the read has `[]`
// dependencies, so the tab — `Tabs` keeps tab screens MOUNTED, and the
// builder is a tab — never re-reads for the account that arrives next.
//
// ── The fix ───────────────────────────────────────────────────────────────
//
// The account goes in the key. A key with the account in it is unreadable to
// the next account by construction, which is why src/lib/signOutState.ts needs
// no entry for it and says so about every other per-account key.
//
// ── What is NOT migrated, and why losing a draft is the cheaper loss ──────
//
// `LEGACY_BUILDER_DRAFT_KEY` is REMOVED UNREAD. Not read into the signed-in
// coach, not merged, not offered — deleted.
//
// The blob carries no account. Nothing inside it says who wrote it, and
// nothing on the device distinguishes a single-owner handset's own old draft
// from the previous coach's on a gym's shared one. So a migration is a guess,
// and the two ways of being wrong are not symmetrical:
//
//   · Guess right and a coach is spared retyping one unsaved program.
//   · Guess wrong and one coach's program — their loads, their progressions,
//     their notes about a named client's shoulder — opens inside another
//     coach's builder, presented as that coach's own work, one tap from being
//     assigned to that coach's clients under that coach's name.
//
// An unsaved draft is, by definition, work that never reached the server;
// losing it costs one coach one evening's typing that they still remember.
// Restoring it to the wrong coach costs a client the wrong program and costs
// the first coach their work being sent out under somebody else's name. The
// cheap loss is the one taken deliberately here.
//
// ── Pure ──────────────────────────────────────────────────────────────────
//
// Strings and decisions, no storage. app/(trainer)/builder.tsx does the I/O, so
// the key composition and the restore decision can both be driven across a
// whole sign-in → sign-out → sign-in without a device.

import { accountStateStep, type AccountStateStep } from './accountScopedState';

/** Every account-scoped builder-draft key starts with this. Nothing reads the
 *  prefix at runtime; it is here so the shape can be asserted and recognised. */
export const BUILDER_DRAFT_PREFIX = 'repple.builder.draft.v1:';

/**
 * The unqualified key this replaces.
 *
 * Exported so the screen can remove it on sight and so the choice is visible to
 * a reader rather than implied. It is never read — see the header.
 */
export const LEGACY_BUILDER_DRAFT_KEY = 'repple.builder.draft.v1';

/**
 * Where one coach's draft lives.
 *
 * Null when there is no account to scope it to, and a null means DO NOT READ
 * AND DO NOT WRITE. Falling back to a shared key is exactly the defect above.
 *
 * 'unknown' is refused as loudly as a null. It is the literal
 * src/ui/clientData.tsx settles on before an auth read lands, and it is not an
 * account: every signed-out session on every handset would share it, which is
 * the unqualified key again wearing a suffix.
 */
export function builderDraftKey(uid: string | null | undefined): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  if (!id || id === 'unknown') return null;
  return `${BUILDER_DRAFT_PREFIX}${id}`;
}

/** Whether a key holds somebody's builder draft. For the sign-out assertion. */
export const isBuilderDraftKey = (k: string): boolean =>
  typeof k === 'string' && k.startsWith(BUILDER_DRAFT_PREFIX);

/**
 * One week of a draft.
 *
 * Generic over the day, because the day type belongs to the screen — it carries
 * exercises, set groups, methods and per-set tables — and a lib file that
 * imported it would be reaching into `app/`. Nothing here inspects a day; the
 * draft is round-tripped whole, which is the point: a restore that silently
 * dropped a field would hand a coach back what looks like their week with the
 * cues gone.
 */
export interface DraftWeek<D> {
  days: D[];
  label?: string;
  deload?: boolean;
}

/** What is written to the device, and what comes back off it. */
export interface BuilderDraft<D> {
  title: string;
  note: string;
  /**
   * Week one, written alongside `weeks` and never instead of it.
   *
   * A build rolled back to before blocks existed reads this key and finds a
   * whole week rather than finding nothing and presenting a coach with an empty
   * builder. The screen has always written both for that reason; this file only
   * moved the decision, it did not change it.
   */
  days: D[];
  weeks: DraftWeek<D>[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * What is on the device, and whether we managed to look.
 *
 * The pair is the house rule and it is the same one src/lib/planEdits.ts and
 * src/lib/readCache.ts draw: `null` from AsyncStorage is a real answer — this
 * coach has no draft — and it is not the same answer as a store that would not
 * open.
 *
 * `read: false` is reserved for bytes that are there and will not parse. It is
 * NOT used for bytes that parse into something which is not a draft: those were
 * read, and what they say is that there is no draft here.
 *
 * The caller must not arm its autosave on `read: false`, and it must not arm it
 * at all if the read THREW — a rejected `getItem` never reaches this function.
 */
export function readBuilderDraft<D>(raw: string | null | undefined): {
  draft: BuilderDraft<D> | null; read: boolean;
} {
  if (raw == null) return { draft: null, read: true };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { draft: null, read: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { draft: null, read: true };
  }
  const p = parsed as Record<string, unknown>;
  const days = arr<D>(p.days);
  // `weeks` when the draft has one, and `days` — which is week one — when it
  // does not. Every draft written before blocks existed is the second case, and
  // restoring it as a one-week block is what it is.
  const weeks: DraftWeek<D>[] = Array.isArray(p.weeks) && p.weeks.length
    ? (p.weeks as unknown[]).map((w) => {
      const o = (w && typeof w === 'object' && !Array.isArray(w)) ? (w as Record<string, unknown>) : {};
      const week: DraftWeek<D> = { days: arr<D>(o.days) };
      // Present only when the coach actually said. An absent label is not an
      // empty one: src/lib/programBlock.ts names an unlabelled week itself.
      if (typeof o.label === 'string') week.label = o.label;
      if (typeof o.deload === 'boolean') week.deload = o.deload;
      return week;
    })
    : [{ days }];
  return { draft: { title: str(p.title), note: str(p.note), days, weeks }, read: true };
}

/** What goes on the device. One serialiser, so the screen and this file cannot
 *  grow two opinions about the shape. */
export function writeBuilderDraft<D>(d: BuilderDraft<D>): string {
  return JSON.stringify({ title: d.title, note: d.note, days: d.days, weeks: d.weeks });
}

/** True when a draft has something in it worth keeping or restoring. A title
 *  alone counts: a coach who has named a block and gone to make tea has done
 *  work. Whitespace does not. */
export function draftHasContent<D>(d: BuilderDraft<D> | null | undefined): boolean {
  if (!d) return false;
  if (d.weeks.some((w) => w.days.length)) return true;
  if (d.days.length) return true;
  return !!(d.title.trim() || d.note.trim());
}

/** Why a restore did or did not happen. Named rather than boolean, so the test
 *  can tell "there was no draft" apart from "there was one and we refused it" —
 *  which are the two outcomes this screen must never confuse. */
export type RestoreWhy = 'no-draft' | 'empty-draft' | 'builder-in-use' | 'restore';

/**
 * Whether a stored draft may be put on screen.
 *
 * Two refusals, and the second one is the one that is easy to get wrong.
 *
 *   · An EMPTY draft is not worth resurrecting over whatever the screen has
 *     already been given. That rule predates this file.
 *
 *   · A BUILDER WITH WORK IN IT is never overwritten, whatever is on disk.
 *     This read now re-runs whenever the account changes, and an account can
 *     change back to the same one — auth-js emits a null session when a token
 *     refresh fails on a dead gym wifi and restores the member on the next
 *     tick. When that blip finds unsaved work, `draftStepFor` answers `hold`
 *     and the work stays on screen; this rule is what stops the re-read that
 *     follows replaying an older WRITTEN draft over the top of it. Losing the
 *     current coach's typing to a machine that was trying to protect it is the
 *     regression, not the fix. A draft restore is for coming back to an EMPTY
 *     builder; it is not a sync.
 *
 * It is deliberately NOT the thing that keeps one account's draft out of
 * another's builder. That is `draftStepFor`'s `forget`, which runs before this
 * is asked — because this function's honest answer to "coach A's program is
 * on screen and coach B's is on disk" is to refuse the restore, and a refusal
 * would leave A's program exactly where it must not be.
 */
export function restoreDraftDecision<D>(args: {
  stored: BuilderDraft<D> | null;
  builderHasContent: boolean;
}): { restore: BuilderDraft<D> | null; why: RestoreWhy } {
  if (!args.stored) return { restore: null, why: 'no-draft' };
  if (!draftHasContent(args.stored)) return { restore: null, why: 'empty-draft' };
  if (args.builderHasContent) return { restore: null, why: 'builder-in-use' };
  return { restore: args.stored, why: 'restore' };
}

/** What the screen should do about the account it currently has.
 *
 *  `hold` and `forget` are deliberately different answers to "there is no uid".
 *  See `draftStepFor`. */
export type DraftStep = AccountStateStep;

/**
 * What to do when the account behind this screen changes.
 *
 * Three answers to one question, and collapsing any two of them is a defect
 * this app has already paid for somewhere.
 *
 *   · `load` — there is an account. Read ITS key, and arm the autosave only
 *     once that read has come back. `forget: true` says the draft currently on
 *     screen belongs to a DIFFERENT account and must be dropped before the read
 *     lands, not merely left for the restore to overwrite: the restore is
 *     allowed to refuse (see `restoreDraftDecision`), and a refusal that left
 *     coach A's program sitting in coach B's builder is the whole defect
 *     wearing a fix.
 *
 *   · `forget` — the account is gone and everything on screen is already on
 *     this device under the departing account's own key. Drop it from memory.
 *     This screen is a TAB: `expo-router` keeps tab screens mounted, and an
 *     `href: null` screen mounts once and is never torn down, so a screen-local
 *     `useState` outlives a sign-out with no storage read involved at all.
 *     Forgetting does NOT mean deleting the stored draft — that is the
 *     departing coach's work under their own key, unreadable to whoever signs
 *     in next, and destroying it is the loss src/lib/outbox.ts refuses to take.
 *
 *   · `hold` — the account is gone and what is on screen is NOT yet on the
 *     device. Read nothing, write nothing, and leave it alone. A null uid is
 *     not a sign-out: auth-js emits a null session when a token refresh fails
 *     on a dead gym wifi and restores the member on the next tick, and
 *     src/ui/clientData.tsx sets out at length why those two are not the same
 *     event. Blanking a builder full of unsaved work on a network blip is a
 *     worse bug than the one this file fixes, so the unsaved case is held and
 *     the saved case — where forgetting costs a flicker and the next `load`
 *     brings the same work straight back off the disk — is the one that clears.
 *
 * The three answers themselves are src/lib/accountScopedState.ts, shared with
 * every other screen that keeps something under an account-scoped key — one
 * copy of a rule whose wrong answers are invisible until somebody signs out on
 * a shared handset. What belongs to THIS screen is the key composition above
 * and the restore decision below.
 *
 * Nothing here consults a SIGNED_OUT listener, and that is on purpose: the
 * listener and `useAuth()` are two subscribers to the same event, so which of
 * them runs first is a registration-order accident, and a fix that depends on
 * one is a fix that works on some launches. `onScreenKey` and `onScreenSaved`
 * are render values the screen already has.
 *
 * @param uid           the signed-in account, or null/undefined/'unknown'.
 * @param onScreenKey   the key of the account whose draft is in React state
 *                      right now — null when the builder holds nobody's work.
 * @param onScreenSaved whether the autosave was armed for that account, i.e.
 *                      whether the device already has a copy of what is on
 *                      screen.
 */
export function draftStepFor(session: {
  uid: string | null | undefined;
  onScreenKey: string | null;
  onScreenSaved: boolean;
}): DraftStep {
  return accountStateStep({
    key: builderDraftKey(session.uid),
    onScreenKey: session.onScreenKey,
    onScreenSaved: session.onScreenSaved,
  });
}
