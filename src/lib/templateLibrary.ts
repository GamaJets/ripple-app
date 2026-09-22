// The coach's template library, as a set of answers rather than as an effect.
//
// ── What was in here, and why it could not be tested ───────────────────────
//
// `src/ui/programTemplates.tsx` held one `useEffect` that read
// `program_templates`, decided a `LoadStatus` from what came back, and rebuilt
// the on-screen list. Two of those three jobs are pure and the third is one
// line, but all three were inside an async IIFE inside an effect, so the only
// way to exercise any of them was to run React.
//
// It had a bug of exactly the kind that arrangement hides:
//
//     if (real.length) setTemplates((p) => [...real, ...p.filter(isStarter)]);
//
// Guarded on `real.length`, so a read that correctly returned ZERO saved
// templates did not rebuild the list at all. Zero is precisely what the server
// returns after a coach deletes their last template — and it is what it returns
// on any device where another one of the coach's phones did the deleting. The
// stale row stayed on screen with nothing wrong anywhere, and deleting your
// only template looked like a button that does nothing. That is the report this
// module was split out to close and to keep closed.
//
// ── What the guard was actually protecting ─────────────────────────────────
//
// Nothing that survived the split, and it is worth saying why rather than
// leaving the next reader to re-derive it. `[...real, ...prev.filter(starter)]`
// keeps the three built-in starters explicitly, so an empty `real` rebuilds to
// exactly the starters — which is the correct library for a coach who has saved
// nothing. The one row the rebuild could genuinely lose is a template the coach
// has just saved whose INSERT has not landed yet: it is in the list
// optimistically and is not in the server's answer, and a read that raced past
// it would have wiped it off the screen while its write was succeeding.
//
// The guard did not protect that either — `real.length` is non-zero for any
// coach with a library, and the rebuild dropped the in-flight row every time.
// So `mergeLibrary` takes the in-flight ids and keeps them, which is both the
// thing the guard was reached for and the thing it never did.
import type { LoadStatus } from '../ui/loadStatus';
import { capLimit, capped } from './rowCap';
import type { Program } from './programs';

/** One saved weekly program in a coach's library. */
export interface ProgramTemplate { id: string; name: string; program: Program }

/**
 * Whether this template is one of the three compiled into the bundle.
 *
 * The prefix is the whole test and it was written out by hand in four places —
 * the provider's `isStarter`, the rebuild above, the seed builder, and the
 * delete guard. One of those getting out of step is how a starter becomes
 * deletable, and a "deleted" starter is back at the next launch with no
 * explanation.
 */
export const isStarterId = (id: string): boolean => id.startsWith('seed_');

/**
 * The library to show, given what the server just said and what is on screen.
 *
 * Three groups, in the order a coach should meet them:
 *
 *   · templates whose write is still in flight, newest-first, because they were
 *     put at the head of the list the moment the coach tapped Save and moving
 *     them would read as the app losing track of them;
 *   · the server's own answer, which is newest-first by the read's ordering and
 *     is the only group that is CONFIRMED;
 *   · the built-in starters, which are always last and are never removed,
 *     because they cannot be deleted and are not the coach's work.
 *
 * An empty `server` is a real answer and rebuilds to the starters alone. That
 * is the whole point: the list has to be able to shrink.
 */
export function mergeLibrary(
  server: ProgramTemplate[],
  prev: ProgramTemplate[],
  pending: ReadonlySet<string> = new Set<string>(),
): ProgramTemplate[] {
  const onServer = new Set(server.map((t) => t.id));
  const inFlight = prev.filter((t) => !isStarterId(t.id) && pending.has(t.id) && !onServer.has(t.id));
  return [...inFlight, ...server.filter((t) => !isStarterId(t.id)), ...prev.filter((t) => isStarterId(t.id))];
}

/**
 * What one read of the library found.
 *
 * `status` is never 'loading'. That is the contract the provider depends on and
 * the one templateLibrary.test.ts asserts over every shape of client: the
 * provider sets 'loading' synchronously when a reload starts, so a read that
 * could return without a terminal status would latch the screen — and every
 * screen fed by the provider — at 'loading' for the life of the process.
 *
 * `rows` is null when the list must NOT be rebuilt: the read failed, or it was
 * cancelled by the caller. It is an empty array when the server genuinely
 * answered with nothing, which is a different fact and has to be able to reach
 * `mergeLibrary`.
 */
export interface LibraryRead {
  status: LoadStatus;
  rows: ProgramTemplate[] | null;
  /** The signed-in coach, when the read got far enough to learn it. */
  uid: string | null;
}

/** The slice of supabase-js this read uses, so a fake can stand in for it. */
export interface LibraryClient {
  auth: {
    getSession: () => Promise<{ data?: { session?: unknown } | null; error?: unknown }>;
    getUser: () => Promise<{ data?: { user?: { id?: string } | null } | null; error?: unknown }>;
  };
  from: (table: string) => any;
}

/**
 * Read the coach's saved templates.
 *
 * Every path ends in a `LibraryRead`; there is no early `return` without one.
 *
 * No session is a true answer, not a failed check — `getUser()` REJECTS when
 * nobody is signed in, and treating that as an error latched this provider into
 * 'error' on the first tick, before anybody had signed in, where it stayed.
 * Signed out, the starters really are the whole library, so `rows` is `[]` and
 * not null: the list is rebuilt to the starters rather than left holding the
 * previous account's work.
 */
export async function readLibrary(sb: LibraryClient): Promise<LibraryRead> {
  try {
    // `error` read, and not merely `data`, which is what the seventeen
    // providers this was copied from do. A getSession that FAILED hands back
    // the same session-less shape as a phone nobody has signed in on, and the
    // two mean opposite things here: one says the starters are the whole
    // library, the other says we could not find out. Treating the second as the
    // first is how a coach's library empties itself on screen.
    const { data: sess, error: sessErr } = await sb.auth.getSession();
    if (sessErr) return { status: 'error', rows: null, uid: null };
    if (!sess?.session) return { status: 'ready', rows: [], uid: null };
    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) return { status: 'error', rows: null, uid: null };
    const id = auth?.user?.id;
    if (!id) return { status: 'ready', rows: [], uid: null };
    // Newest-first, because the cap decides which end is kept and a coach's most
    // recent templates are the ones they are working from. That is also the
    // order the picker should show them in.
    const { data, error } = await sb.from('program_templates')
      .select('id, name, program').eq('coach_id', id)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
    // `error || !data` used to return down the same path as a coach who has
    // simply not saved anything, leaving the seed starters standing in for
    // their library with nothing to mark the difference.
    if (error) return { status: 'error', rows: null, uid: id };
    const page = capped(data as any[] | null | undefined);
    const rows: ProgramTemplate[] = page.rows
      .filter((r: any) => r && r.program)
      .map((r: any) => ({ id: String(r.id), name: r.name, program: r.program as Program }));
    return { status: page.truncated ? 'partial' : 'ready', rows, uid: id };
  } catch {
    return { status: 'error', rows: null, uid: null };
  }
}

/**
 * What to put in front of a coach whose delete was refused.
 *
 * One sentence, in the coach's words, naming the template — because the thing
 * they need to know first is that the row they are looking at is still theirs
 * and still there. `why` comes from `writeFailure` and already reads as a
 * sentence; the fallback covers a caller that has no reason to offer, which
 * must still not be silence.
 */
export function deleteRefusedLine(name: string, why: string | null): string {
  return `“${name}” is still in your library. ${why ?? 'The server did not say why.'}`;
}
