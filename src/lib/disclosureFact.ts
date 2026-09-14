// Three facts that had been collapsed into one empty list.
//
// A coach writing a programme needs to know what the person cannot do. The
// screens that ask have, until now, asked it in a shape with room for only two
// answers — a list of injuries, or an empty list — and the shape cannot hold
// the third answer, which is an ordinary one on a coach's book:
//
//   asked, and disclosed nothing    the client has the app, has opened Injuries
//                                   & Limitations, and has nothing to put in
//                                   it. That is knowledge ABOUT the person, and
//                                   the gate may open on it.
//   asked, and disclosed something  `guardInjuries` holds the control until the
//                                   coach has read what they wrote. See
//                                   src/lib/injuryGate.ts; this module says
//                                   nothing over the top of that refusal.
//   never asked                     a client the coach typed into Add Client. A
//                                   `coach_clients` row, no account, no app,
//                                   and therefore no screen on which they could
//                                   ever have disclosed anything. Nobody has
//                                   ever put the question to them.
//
// The third one reached `guardInjuries` as `(c?.injuries ?? [])` — an empty
// list, indistinguishable from the first — and the gate returned ALLOWED on it.
// So a person with no account, who has never been asked, opened the programme
// gate exactly as though they had been asked and had answered that there was
// nothing wrong. The screen said "no injuries recorded", which reads as an
// all-clear about a human being, and a coach assigned a template on the
// strength of it. It is the roster's own distinction — src/ui/roster.tsx sets
// `handAdded: true` and leaves `injuries` undefined, deliberately, because
// undefined is "nobody has ever asked this person" and `[]` is "they were asked
// and said none" — flattened one screen downstream by a `?? []`.
//
// ── What this deliberately does NOT do ────────────────────────────────────
//
// It does not stop the assign. Putting a programme in front of somebody the
// coach added by hand is the ordinary case — it is most of what Add Client is
// for — and a gate that refused it would be a worse product than the defect it
// was fixing. What changes is that the absence stops being reported as a
// clearance: the coach is told, on that person's row and again in the sentence
// they confirm, that nobody has asked this person anything and that nothing on
// the screen says they are uninjured. The decision stays the coach's; what they
// are deciding on is now stated.
//
// ── And the shape that is not a state of the person at all ────────────────
//
// A read that did not land is not one of the three. `guardInjuries` already
// refuses on it, in its own words, so this module hands it the status and stays
// quiet — two sentences saying the same thing on one row is how a coach learns
// to skip both. The one exception is a row that came back carrying no injury
// list whatsoever: the read landed, so "could not be read" is not quite true of
// it, and it gets a sentence of its own.
import type { Injury } from './injuries';
import type { LoadStatus } from '../ui/loadStatus';
import { listNames } from './groupProgram';

/** An injury as the roster carries it on a client row. Narrower than `Injury`:
 *  the roster has no id and no disclosed-at to give, which is why the mapping
 *  below exists at all and why it lived, copy-pasted, in three screens. */
export interface RosterInjury {
  area: string;
  severity: string;
  note?: string;
}

/** As much of a roster row as this question needs. Both fields are optional and
 *  both absences mean something: see `disclosureFact`. */
export interface DisclosureRow {
  /** `true` only from src/ui/roster.tsx, at the one place that knows which of
   *  its two tables a row came out of. `undefined` is "the roster has not
   *  said", which is not knowledge and must not be read as `false` — the rule
   *  `clientIsQueryable` states in src/lib/clientRecord.ts. */
  handAdded?: boolean | null;
  injuries?: readonly RosterInjury[] | null;
}

/**
 * Which of the three it is. `unread` is the fourth shape — not a state of the
 * person — and is kept out of the other two rather than folded into either.
 */
export type DisclosureKind = 'asked' | 'never-asked' | 'unread';

/**
 * Why, precisely. `kind` is what a screen branches on; this is what a reader of
 * a test failure needs, and it is the field that stops the three collapsing
 * back into each other the next time somebody writes `?? []`.
 */
export type DisclosureWhy =
  /** Asked, and they named something. */
  | 'disclosed'
  /** Asked, and they named nothing. The only clearance there is. */
  | 'none'
  /** Hand-added: no account, so the question has never been put to them. */
  | 'no-account'
  /** The row arrived without an injury list at all. The read landed, so this is
   *  not 'error' — but an absent list is not an empty one either. */
  | 'no-list'
  /** The roster read has not come back yet. */
  | 'loading'
  /** The roster read failed or was refused. */
  | 'error'
  /** The roster came back truncated and this person is past the cap. */
  | 'partial'
  /** A whole roster, and no row for this id in it. */
  | 'absent';

export interface DisclosureFact {
  kind: DisclosureKind;
  why: DisclosureWhy;
  /**
   * What to hand `guardInjuries` (and `FanOutMember.disclosures`) as the status
   * of THIS person's disclosures.
   *
   * 'never-asked' resolves to 'ready' here, and that is the one line in this
   * file worth arguing with. It is not the gate being told the absence is a
   * clearance — it is the gate being told there is nothing for it to hold, in
   * the only vocabulary it has, because `LoadStatus` has no word for "there was
   * never a read to succeed or fail". The honesty is carried by `note`, which
   * is non-null for exactly this case, and a caller that uses `gateStatus`
   * without rendering `note` has reintroduced the defect this module exists to
   * remove.
   */
  gateStatus: LoadStatus;
  /** The disclosed injuries, ready for the gate. Non-empty only under
   *  `why: 'disclosed'` — never under any absence. */
  injuries: Injury[];
  /** The sentence the coach reads about this person ON A SCREEN THAT HAS A
   *  GATE, or null when the gate already says it: `guardInjuries` refuses in
   *  its own words for every unread status and for a disclosure that has not
   *  been read, and those sentences are better than anything this module could
   *  put beside them. */
  note: string | null;
  /**
   * The same fact for a screen with NO gate to defer to — a list, a board, a
   * row a coach only reads.
   *
   * Non-null for every answer that is not an answer about the person, the
   * unread statuses included, because there is nothing else on such a screen to
   * say them. Null only under 'disclosed', where the injury itself is drawn and
   * a sentence saying it was read would be noise.
   *
   * Kept as a second field rather than as a second call so that a badge and its
   * spoken form come out of one decision — src/lib/leaderboardFacts.ts states
   * the rule: an accessibility label that has drifted from what is drawn is
   * worse than none, because it is confidently wrong.
   */
  spoken: string | null;
  /** True when `note` is about an absence rather than about the person. Drives
   *  the tone; the words carry the meaning either way. */
  warn: boolean;
}

/** The roster's injury rows as the gate wants them. The id is positional
 *  because the roster has none to give, and `at` is empty for the same reason —
 *  `injuryKey` in src/lib/injuryGate.ts keys on area, severity and note, so an
 *  acknowledgement still survives a re-read. */
export function rosterInjuries(rows: readonly RosterInjury[], clientId: string): Injury[] {
  return rows.map((i, n): Injury => ({
    id: `${clientId}-${n}`,
    area: i.area,
    severity: i.severity as Injury['severity'],
    status: 'active',
    note: i.note,
    at: '',
  }));
}

/**
 * What this screen actually knows about one person's injuries.
 *
 * `row` is whatever the roster produced for them, or null/undefined when it
 * produced nothing. `who` is the name as it will be read back — a first name,
 * the way every other sentence in this area addresses a client.
 *
 * The order of the questions below is the whole of it, and the first one is
 * first on purpose: a hand-added client is 'never asked' whatever the roster
 * status says, because the `clients` read that failed was never a read about
 * them. Their absence from it is not a fact about their injuries, and treating
 * an outage as though it had changed what we know about somebody with no
 * account would be the same mistake pointed the other way.
 */
export function disclosureFact(
  rosterStatus: LoadStatus,
  row: DisclosureRow | null | undefined,
  clientId: string,
  who: string,
): DisclosureFact {
  if (row && row.handAdded === true) {
    return {
      kind: 'never-asked',
      why: 'no-account',
      gateStatus: 'ready',
      injuries: [],
      note: NEVER_ASKED(who),
      spoken: NEVER_ASKED(who),
      warn: true,
    };
  }

  // Nobody is trustworthy under a failed roster read, including somebody we can
  // still see: under 'error' src/ui/roster.tsx keeps whatever manual rows it
  // had, so a row surviving the failure says nothing about the `clients` read
  // that carried the disclosures.
  if (rosterStatus === 'error') return unread('error', who);

  if (!row) {
    if (rosterStatus === 'loading') return unread('loading', who);
    // 'partial' means the roster is a real PREFIX, so somebody past the cap is
    // missing for a reason that has nothing to do with what they disclosed.
    if (rosterStatus === 'partial') return unread('partial', who);
    // A whole roster with no row for this id. Whatever that is, it is not an
    // answer about their injuries.
    return unread('absent', who);
  }

  // The row is here and it is not hand-added — but it carried no list. The read
  // landed, so 'could not be read' is the wrong sentence; an absent list is
  // still not an empty one, and the gate is held rather than opened.
  if (row.injuries == null) {
    return {
      kind: 'unread',
      why: 'no-list',
      gateStatus: 'error',
      injuries: [],
      note: NO_LIST(who),
      spoken: NO_LIST(who),
      warn: true,
    };
  }

  const injuries = rosterInjuries(row.injuries, clientId);
  if (!injuries.length) {
    return {
      kind: 'asked',
      why: 'none',
      gateStatus: 'ready',
      injuries: [],
      note: `${who} has been asked in their own app and has disclosed nothing they are working around.`,
      spoken: `${who} has been asked in their own app and has disclosed nothing they are working around.`,
      warn: false,
    };
  }
  return {
    kind: 'asked',
    why: 'disclosed',
    gateStatus: 'ready',
    injuries,
    // Said by the gate, which knows whether the coach has read them yet and has
    // a better sentence for both answers — and, on a screen with no gate, by
    // the injury itself.
    note: null,
    spoken: null,
    warn: false,
  };
}

type UnreadWhy = Extract<DisclosureWhy, 'loading' | 'error' | 'partial' | 'absent'>;

function unread(why: UnreadWhy, who: string): DisclosureFact {
  return {
    kind: 'unread',
    why,
    // 'absent' becomes 'error' for the gate: a person the roster does not
    // contain is a person whose disclosures were not read, and that is the
    // refusal `guardInjuries` already writes.
    gateStatus: why === 'absent' ? 'error' : why,
    injuries: [],
    // Null: on a screen with a gate, `guardInjuries` has already refused in its
    // own words and a second sentence beside it teaches the coach to read
    // neither.
    note: null,
    spoken: UNREAD_SPOKEN[why](who),
    warn: true,
  };
}

const NEVER_ASKED = (who: string): string =>
  `${who} was added by hand and has no Repple account, so they have never been asked about injuries. `
  + 'Nothing here says they are uninjured — ask them yourself before you build around it.';

const NO_LIST = (who: string): string =>
  `${who}'s row came back without an injury list at all, so this screen cannot tell whether they have `
  + 'disclosed any. An absent list is not an empty one.';

/** One sentence per unread status, for the screens that have no gate to say it
 *  for them. Each names what did not happen and then refuses, out loud, to be
 *  read as an all-clear — the sentence "no injuries recorded" was not. */
const UNREAD_SPOKEN: Record<UnreadWhy, (who: string) => string> = {
  loading: (who) => `Still reading your roster, so nothing here says whether ${who} has disclosed an injury.`,
  error: (who) => `${who}'s injuries could not be read. This is not a statement that they have disclosed none.`,
  partial: (who) => `Only part of your roster came back and ${who} is past it, so their injuries were not read. This is not a statement that they have disclosed none.`,
  absent: (who) => `${who} is not on the roster this screen read, so their injuries were not read either. This is not a statement that they have disclosed none.`,
};

/**
 * The line a coach reads before confirming a bulk assign that includes people
 * nobody has ever asked.
 *
 * Names rather than a count, for the reason `overwriteBrief` gives in
 * src/lib/bulkActions.ts: a coach does not recognise "3 of 12" and does
 * recognise the person. Null when there are none, so the caller can drop it
 * from the dialog rather than print an empty paragraph.
 */
export function neverAskedBrief(names: readonly string[]): string | null {
  if (!names.length) return null;
  const one = names.length === 1;
  return `${listNames(names)} ${one ? 'has' : 'have'} no Repple account and ${one ? 'has' : 'have'} never been asked about injuries, `
    + 'so nothing on this screen says they are uninjured. '
    + 'You are assigning on what you know about them yourself.';
}
