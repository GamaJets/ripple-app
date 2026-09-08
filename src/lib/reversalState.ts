// Where a payroll run actually stands after a reversal that did not finish.
//
// ── The sentence that was false ───────────────────────────────────────────
//
// studio-web/app/payroll/page.tsx caught anything `reverseSettlement` threw and
// appended one clause to every one of them:
//
//     "It still stands as paid, and its sessions are still stamped against it."
//
// Half of that is true at every failure point. The other half is true at three
// of the twelve places this can throw, and the half that is false is the
// expensive one.
//
// `reverseSettlement` (src/lib/gymPay.ts) is four writes in a fixed order —
// sessions, class pay lines, adjustments, then the settlement — and the order is
// its whole safety argument: the settlement is marked reversed LAST, so nothing
// that goes wrong can leave a run reversed while its sessions are still
// attached to it. That is why "it still stands as paid" holds everywhere.
//
// But it also means a refusal at the SECOND, third or fourth write happens
// after the sessions have already been unstamped. At those points the sessions
// have come loose, they are back in "Owed now", and the run still says it paid
// for them. Recording another run for that coach pays those hours twice. The
// screen was telling the owner the opposite — that the sessions were still
// stamped, which is precisely the state in which paying again is safe.
//
// It was already false before that lane's rewrite, on the plain `throw` from
// the settlement write itself: by then all three unstamps have landed.
//
// ── Why one count settles it, and which count ─────────────────────────────
//
// The ordering makes the SESSIONS the complete indicator. Sessions are
// unstamped first, so:
//
//   every session still stamped  ⇒ the failure was at or before write one, and
//                                  nothing at all has changed. Exact.
//   any session loose            ⇒ write one landed, at least in part. The class
//                                  lines and the adjustments may or may not have
//                                  followed; the settlement has not, because it
//                                  is last. Double pay is live either way.
//
// So the screen asks one question after a failure — how many sessions still
// carry this settlement id — and compares it against the run's own
// `payroll_settlements.sessions_count`, which is the number
// src/lib/unstampCheck.ts exists to compare against and the only number
// available that does not depend on which rows this account can see.
//
// The read can only ever UNDER-count: it is one `eq('settlement_id', …)` under
// RLS that filters, so a row it cannot see is a row missing from the answer. An
// under-count moves the answer towards "loose", which is the warning, never
// towards "untouched", which is the all-clear. The one state this asserts —
// nothing has changed — is therefore the one it cannot reach by being blind.
//
// ── Why it says what it saw rather than what it inferred ──────────────────
//
// The sentence is dated: "Checked just now". It has to be, because it can
// disagree with the reason printed beside it. `unstampBlocker`'s partial branch
// ends "Nothing has been changed" while the count it was given says some
// sessions did come loose, and this reads the record rather than the prose. A
// measured fact with a timestamp on it does not contradict a claim; it dates it.
//
// ── Why the loose state does not say "try again" ──────────────────────────
//
// Because trying again cannot work, and telling an owner to press a button that
// will refuse for ever is worse than telling them nothing. Once the sessions are
// loose, the retry's own unstamp matches zero rows, and `unstampBlocker(claimed,
// 0)` refuses on "only 0 of them could be unstamped". The run is stuck standing
// as paid over sessions that are payable again, and that is a record-level
// repair, not a second press. The screen says so.
//
// Pure, so every sentence an owner reads here is assertable without a database.

/** What the record said, after a reversal that threw. */
export type ReversalAftermath =
  /** Every session the run paid for is still stamped against it: the failure
   *  landed at or before the first write and nothing has changed. */
  | { state: 'untouched'; claimed: number; stillStamped: number }
  /** At least one session has come loose while the run still stands as paid. */
  | { state: 'loose'; claimed: number; stillStamped: number }
  /** The run records no sessions at all, so none of them can have come loose —
   *  but the two line tables might have, and they carry no recorded count to
   *  measure against. */
  | { state: 'noSessions' }
  /** Nothing is known. Not the same as nothing having happened. */
  | { state: 'unknown'; why: string };

/** The message off a thrown or returned error, where there is one. */
function reasonOf(e: unknown): string | null {
  if (!e) return null;
  const m = (e as { message?: unknown }).message;
  return typeof m === 'string' && m.trim() ? m.trim() : null;
}

function whole(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

/**
 * Read the aftermath.
 *
 * `claimed` is the settlement's own `sessions_count`; `stillStamped` is what
 * counting `sessions.settlement_id = <run>` came back with, and `readError` is
 * whatever stopped that count from happening.
 *
 * A missing count is 'unknown' and not 'untouched', for the reason
 * src/lib/wroteRows.ts gives about a missing write count: the reading that
 * costs nothing when it is wrong is the alarming one, and here the reassuring
 * reading is the one that gets a coach paid twice.
 */
export function aftermathOf(
  claimed: number | null | undefined,
  stillStamped: number | null | undefined,
  readError?: unknown,
): ReversalAftermath {
  const failed = reasonOf(readError);
  if (readError) {
    return { state: 'unknown', why: failed ?? 'the read was refused' };
  }
  if (!whole(claimed)) {
    return {
      state: 'unknown',
      why: 'this run does not record how many sessions it paid for, so there is nothing to compare against',
    };
  }
  if (!whole(stillStamped)) {
    return {
      state: 'unknown',
      why: 'the server did not say how many of its sessions are still stamped against it',
    };
  }
  if (claimed === 0) return { state: 'noSessions' };
  if (stillStamped > claimed) {
    return {
      state: 'unknown',
      why: `${stillStamped} sessions are stamped against it and the run says it paid for ${claimed}, `
        + 'so the two records disagree about what it covered',
    };
  }
  return stillStamped === claimed
    ? { state: 'untouched', claimed, stillStamped }
    : { state: 'loose', claimed, stillStamped };
}

/** "1 session" / "4 sessions". Same reason src/lib/unstampCheck.ts has its
 *  own: a mismatched plural in a sentence about somebody's pay reads as a
 *  machine that does not know what it is talking about. */
function sessions(n: number): string {
  return `${n} session${n === 1 ? '' : 's'}`;
}

/** One trailing full stop, whatever the reason arrived with. */
function sentence(s: string): string {
  const t = s.trim().replace(/\.+$/, '');
  return t ? `${t}.` : '';
}

/**
 * What the payroll screen says when a reversal threw.
 *
 * `reason` is the thrown message — the server's or `reverseSettlement`'s own.
 * It is printed first and unaltered but for its full stop, because it is the
 * only part that says WHY. Everything after it says WHERE THE RUN STANDS, which
 * is the part the owner acts on.
 *
 * The settlement clause is the same in every branch and is exactly true in every
 * branch: this attempt did not reach the fourth write, so the run has not been
 * marked reversed by it.
 */
export function reversalFailureText(reason: string, a: ReversalAftermath): string {
  const head = `That run was NOT reversed: ${sentence(reason) || 'the write was refused.'} `
    + 'It has not been marked reversed, so it still stands as paid. ';

  switch (a.state) {
    case 'untouched':
      return head
        + (a.claimed === 1
          ? 'Checked just now: the one session it paid for is still stamped against it, '
          : `Checked just now: all ${sessions(a.claimed)} it paid for are still stamped against it, `)
        + `so nothing has come loose and nothing is payable twice. Pressing Reverse again is safe.`;

    case 'loose': {
      const gone = a.claimed - a.stillStamped;
      const where = a.stillStamped === 0
        ? `Checked just now: none of the ${sessions(a.claimed)} it paid for are stamped against it any more.`
        : `Checked just now: ${a.stillStamped} of the ${sessions(a.claimed)} it paid for are still stamped `
          + `against it; ${gone === 1 ? 'the other one is' : `the other ${gone} are`} not.`;
      return head + where
        + ` ${gone === 1 ? 'That session is' : `Those ${gone} sessions are`} back in what this coach is owed `
        + `while the run still says it paid for ${gone === 1 ? 'it' : 'them'}, so recording another run for `
        + `this coach now pays ${gone === 1 ? 'that hour' : 'those hours'} a second time. Pressing Reverse `
        + `again will not finish the job — the unstamp would now match nothing and be refused for that very `
        + `reason — so put this run right on the record before paying this coach anything else.`;
    }

    case 'noSessions':
      return head
        + 'It records no sessions, so none of them can have come loose. Its class pay lines and its '
        + 'adjustments may already have been unstamped from it, and neither carries a recorded count to '
        + 'check that against, so do not record another run for this coach until this one has been put '
        + 'right — a line unstamped from a run that still stands as paid is a line that can be paid twice.';

    case 'unknown':
      return head
        + `Whether its sessions are still stamped against it could not be checked just now — `
        + `${sentence(a.why).replace(/\.$/, '')}. `
        + 'If they have come loose they are back in what this coach is owed while the run still says it '
        + 'paid for them, so do not record another run for this coach until you have reloaded this page '
        + 'and know which it is.';
  }
}
