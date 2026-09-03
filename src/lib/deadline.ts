// A request that is never going to answer, and the sentence a person gets
// instead of a spinner.
//
// ── The condition ─────────────────────────────────────────────────────────
//
// Nothing in this product has ever had a timeout. `src/lib/pullRefresh.ts`
// records the fact at line 14 — "no AbortController anywhere in this app and no
// request has a timeout" — and states it as an obstacle to what THAT file is
// doing rather than as a defect of its own. It is a defect of its own, and the
// console is where it costs the most.
//
// A front desk on gym wifi behind a captive portal is the ordinary version. The
// socket is accepted. The TLS handshake completes. The portal then holds the
// request open and answers nothing, for ever. `fetch` in a browser has no
// default deadline for that case, so the promise supabase-js is awaiting never
// settles, in either direction.
//
// What the console does with a promise that never settles is not "shows an
// error late". It is worse and quieter:
//
//   · `components/Gate.tsx` renders "Reading your account…" and stays there.
//     The unreadable branch beside it — the one with the Try Again button and
//     the sentence saying this is not you being signed out — is reached only
//     when `loadMe` REJECTS, and a hung fetch never rejects.
//   · `components/Fetched.tsx` sets `running.current = true` before awaiting and
//     clears it in a `finally` that never runs. `refresh()` returns at its first
//     line from then on, so the "Read again" button is disabled permanently. The
//     one control on the page for getting out of this is the one the condition
//     takes away.
//   · every screen holding a `Read<T>` sits at `state: 'loading'`, which
//     `Unresolved` renders as "Loading…" — the sentence the console's whole
//     three-state discipline exists to keep separate from "empty" and from
//     "refused". Under a hung read it is separate and it is also permanent.
//
// So the honest three states collapse to one, and the person at the desk is
// given no way to tell a slow gym from a dead one and nothing to press. They
// reload the tab, which is the thing `Fetched`'s own header says nobody does
// because it discards a half-typed form.
//
// ── Why a deadline rather than a retry ────────────────────────────────────
//
// Because the screens are already built for the answer. Every one of them has a
// 'failed' arm with a banner carrying the database's own sentence, and every one
// of them has a way to ask again. A deadline turns a hang into exactly the state
// they are written for; a retry loop would hide the condition for another three
// attempts and then produce the same screen anyway.
//
// ── Why the sentence differs for a write ──────────────────────────────────
//
// This is the part that must not be got wrong. Giving up on a READ changes
// nothing: the request either arrives or it does not, and the screen still
// holds what it held. Giving up on a WRITE tells you nothing about whether the
// row was written — the request may have reached the database, committed, and
// had its answer lost on the way back. "It failed" is a claim this console
// cannot make about a write it stopped waiting for, and it is the claim that
// gets a payment taken twice.
//
// `src/lib/wroteRows.ts` makes the same distinction one layer down for a write
// that matched no rows: "was sent, but the server did not say whether it
// changed anything". This is that sentence for the case where the server did
// not say anything at all.

/** How long a read may go unanswered before the console stops waiting.
 *
 *  Generous on purpose. This is not a latency budget and it must never fire on
 *  a gym with a slow line — every figure it interrupts is one somebody wanted.
 *  It exists for the request that is never coming back, and twenty-five seconds
 *  is far longer than any query in this console has ever taken and far shorter
 *  than for ever. */
export const READ_DEADLINE_MS = 25_000;

/** The same, for a request carrying a FILE.
 *
 *  `studio-web/app/compliance/page.tsx` uploads a gym document to storage
 *  through the same client, and a policy PDF on a gym's upstream is minutes of
 *  legitimate transfer. Cutting that off at twenty-five seconds would be a new
 *  defect written to fix an old one. Three minutes, and the upload is the only
 *  thing that gets it. */
export const UPLOAD_DEADLINE_MS = 180_000;

/**
 * What sort of body a request carries — which is the only thing that decides
 * which deadline applies.
 *
 * Not the URL and not the table. A rule keyed on either of those is a rule that
 * is wrong the first time somebody adds a screen, and this one has to be right
 * about an upload it has never heard of.
 *
 *   'none'   a GET, a HEAD, a DELETE with no body. Every read in the console.
 *   'text'   JSON. Every write in the console: a payment, a shift, a close.
 *   'file'   a Blob, a File, a FormData or a stream. An upload, and the only
 *            thing that legitimately takes minutes.
 */
export type BodyKind = 'none' | 'text' | 'file';

/** The deadline for a request, from what it is carrying. */
export function deadlineMsFor(kind: BodyKind): number {
  return kind === 'file' ? UPLOAD_DEADLINE_MS : READ_DEADLINE_MS;
}

/**
 * Whether this request changes anything — which decides which sentence a
 * person is told when it is given up on.
 *
 * Read off the HTTP method, because that is the one fact available at the point
 * a deadline fires. GET and HEAD are the only two that are guaranteed to have
 * changed nothing; everything else, INCLUDING a method this function has never
 * heard of, is treated as a write. Erring the other way would produce "nothing
 * has changed" over a payment that may well have been recorded.
 */
export function changesThings(method: string | null | undefined): boolean {
  const m = (method ?? 'GET').trim().toUpperCase();
  return m !== 'GET' && m !== 'HEAD';
}

/** A duration as the number of seconds a person would say. */
export function secondsPhrase(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${s} second${s === 1 ? '' : 's'}`;
}

/**
 * The tail of the sentence a screen prints when a request was given up on.
 *
 * Written to be appended to the wordings the console already has —
 * `landed()`'s "Could not read the payments: …" and `writeFailure()`'s "That
 * membership could not be saved." — so a screen needs no new branch to say
 * this. It is a `message` on an ordinary Error, and every existing 'failed'
 * arm already prints one.
 *
 * The two wordings are not interchangeable and the difference is the whole
 * point of the function. A read that was given up on changed nothing and the
 * reader can be told so. A write that was given up on may have landed, and
 * telling somebody it failed is how a payment gets taken twice.
 */
export function deadlineNote(ms: number, wrote: boolean): string {
  const t = secondsPhrase(ms);
  return wrote
    ? `the gym did not answer within ${t}, so this console stopped waiting. `
      + `It cannot say whether the change was made — read the screen again before repeating it.`
    : `the gym did not answer within ${t}, so this console stopped waiting. `
      + `Nothing has changed. This is what a connection that is accepted and then answers `
      + `nothing looks like — a captive portal at the desk is the usual reason.`;
}

/** A request this console stopped waiting for. Its own class so a caller that
 *  wants to treat a deadline differently from a refusal can, and so the two are
 *  never conflated in a log. */
export class DeadlineExceeded extends Error {
  readonly ms: number;
  /** True when the request may have changed something. See `deadlineNote`. */
  readonly wrote: boolean;
  constructor(ms: number, wrote: boolean) {
    super(deadlineNote(ms, wrote));
    this.name = 'DeadlineExceeded';
    this.ms = ms;
    this.wrote = wrote;
  }
}

/** True when this is a deadline rather than a refusal. Written as a predicate
 *  rather than an `instanceof` at each call site because an error crossing a
 *  bundle boundary can fail `instanceof` while carrying the right name. */
export function isDeadlineExceeded(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'DeadlineExceeded';
}

/** The two timer functions, injected so a test does not have to wait. */
export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * A promise, with a deadline on it.
 *
 * `onExpire` is what actually stops the work — an `AbortController.abort()` at
 * the fetch layer. It is a separate argument rather than something this
 * function does, because this module is compiled into the phone app as well as
 * the console and must not depend on a browser type.
 *
 * The timer is cleared whichever way the promise settles. That is not tidiness:
 * these tests run under plain `node`, and a timer left armed keeps the process
 * alive past the last assertion, so a suite that passed would hang instead of
 * exiting.
 */
export function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  wrote: boolean,
  onExpire?: () => void,
  timers: Timers = realTimers,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const id = timers.setTimeout(() => {
      if (done) return;
      done = true;
      // Stop the work FIRST, then report. The other order leaves a request in
      // flight against a screen that has already moved on, which is how a read
      // given up on at 25 seconds lands at 40 and overwrites a fresher one.
      try { onExpire?.(); } catch { /* aborting is best-effort; the report is not */ }
      reject(new DeadlineExceeded(ms, wrote));
    }, ms);
    const settle = (fn: (v: any) => void) => (v: any) => {
      if (done) return;
      done = true;
      timers.clearTimeout(id);
      fn(v);
    };
    work.then(settle(resolve), settle(reject));
  });
}
