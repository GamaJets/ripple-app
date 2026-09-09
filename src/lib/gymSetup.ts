// A gym's first five minutes, as a list that stays.
//
// ── What this is, and the numbers that made it worth writing ──────────────
//
// src/lib/firstRun.ts is the client's list. src/lib/coachFirstRun.ts is the
// coach's, and its header makes the argument in one sentence: "A coach who
// never sets a currency has SIX screens showing dashes… and none of them
// offers to fix it." A gym owner had no such list at all, on either surface,
// and the gym is the account with the most settings hanging off it.
//
// This is not a hypothesis about new gyms. Counted against the live database
// on 4 September 2026, across all 54 tenants:
//
//     · 54 of 54 are still called what the sign-up trigger named them —
//       `coalesce(full_name,'My') || '''s space'` (supabase/parts/06). Not one
//       gym on the platform has ever been given its own name.
//     · 54 of 54 have `timezone` null. Every "today", every month close, every
//       payroll month and every by-hour footfall chart in the console is
//       therefore being cut on whichever laptop the page is open on, and each
//       of those screens says so in small type that nobody has acted on.
//     · 35 of 54 have `currency` null, so no plan can be priced, no payment
//       recorded, no price book imported and no payroll settled.
//     · 30 of 54 have `session_fee` null.
//     · 0 membership plans exist. 1 membership exists. 0 classes. 0 door
//       visits.
//
// Every gym on this platform is stuck in its first five minutes, and the
// product's response was thirty screens of dashes, each correctly explaining
// its own dash. docs/STUDIO-HUB.md has "Gym identity on owner sign-up" on the
// not-built list and calls it small; this is that, plus the five other things
// that are in the same state for the same reason.
//
// ── Why a list and not a wizard ───────────────────────────────────────────
//
// The argument the other two files make, and it holds harder here. A wizard is
// one sitting: skip it and there is no way back that anybody would find. These
// six are not one sitting either — a currency is a ten-second decision, a
// timezone is a ten-second decision, and importing two hundred members off the
// old system's export is a Sunday. So this is a list of what is not set, each
// naming the screen that sets it, that keeps saying so until it is done.
//
// ── The rule every item passes ────────────────────────────────────────────
//
// NAME WHAT BREAKS, not what would be nicer. Every `breaks` string below is a
// failure an owner would otherwise report as a bug, in the words they would
// see it in. Deliberately NOT on the list, each for a stated reason:
//
//   · A trainer.       A gym with no coaches is a real gym — a 24-hour access
//                      site has none — so an item nobody there can honestly
//                      complete would be an instruction to do the wrong thing.
//   · A class.         Same. A floor-only gym runs no timetable, and /classes
//                      already renders its own empty state.
//   · A brand colour.  Cosmetic by construction, and /settings prompts for it
//                      in place.
//   · Stripe.          A gym that takes cash and bank transfer is a gym, and
//                      /settings carries the connect flow with its own state.
//                      An unconnected account breaks nothing; it just means
//                      /orders stays empty.
//
// Two of the six that ARE here are conditional rather than universal, and say
// so on their own row — see `onlyIf`. A gym selling nothing but drop-in passes
// never needs a membership plan, and a gym that delivers no one-to-ones never
// needs a session fee. Listing them without the condition would be the same
// mistake as listing a trainer.
//
// ── Three states, not two ─────────────────────────────────────────────────
//
// 'done', 'todo' and 'unknown'. The third is the whole reason this is a module
// with a test rather than six ternaries on a page: every input here can be
// null for two unrelated reasons — the gym has not set the thing, or the read
// did not come back — and a checklist that folds the second into the first
// tells an owner to go and set a currency they set last week, or, worse,
// reports a gym as fully set up because the reads that would have contradicted
// that all failed. `unknownWhy` is the sentence for the second case and it
// names the read, not the setting.
//
// Nothing here reaches a database, formats a date or knows what a route is:
// the console and the phone have different screens for the same six settings,
// so the destinations belong to them and the reasoning belongs here. That is
// also what stops the two surfaces wording the same gap two ways.

/** The six. See the header for what is deliberately not among them. */
export type SetupKey = 'currency' | 'timezone' | 'name' | 'plan' | 'member' | 'fee';

/**
 * Done, not done, or not established.
 *
 * 'unknown' is never rendered as a tick and never as a cross. It is a
 * statement about a read.
 */
export type SetupState = 'done' | 'todo' | 'unknown';

/**
 * The order the list is shown in: what unblocks the most, first.
 *
 *   currency  nothing about money works without it, including the plan two
 *             rows down — /money refuses to price a plan until it is set.
 *   timezone  every dated figure in the console is currently being cut on the
 *             reader's machine, silently, and it is the only item here that is
 *             wrong rather than empty while it is undone.
 *   name      everything that leaves the building carries it.
 *   plan      the price book, which a membership hangs off.
 *   member    the roster, which every screen is a view of.
 *   fee       payroll for one-to-ones, which needs the roster first.
 */
export const SETUP_ORDER: SetupKey[] = ['currency', 'timezone', 'name', 'plan', 'member', 'fee'];

export interface SetupItem {
  key: SetupKey;
  state: SetupState;
  /** Imperative and short. What the owner is being asked to go and do. */
  title: string;
  /**
   * What is broken while this is undone, in the present tense, naming the
   * screens it is broken on. Never "you should" and never a benefit.
   */
  breaks: string;
  /**
   * Null when every gym needs this. A sentence when only some do, which the
   * row prints beside the title so an owner can decide it does not apply to
   * them rather than carry an item they can never complete.
   */
  onlyIf: string | null;
  /**
   * Why the state could not be established. Null under 'done' and 'todo'.
   * Names the READ, because that is the thing that failed — the setting is
   * not known to be either way.
   */
  unknownWhy: string | null;
  /**
   * What the record says now, where saying it helps. Only the gym's name uses
   * it: "still called X" is the whole of that item's evidence, and an owner
   * who reads their own gym's real name there knows to ignore the row.
   *
   * A value in a slot, never the subject of a sentence — see
   * scripts/check-prose.mjs for why that distinction is a gate.
   */
  found: string | null;
}

/** What a tenants row says about itself, as far as this question goes. */
export interface TenantSettings {
  /** `tenants.name`. */
  name: string | null;
  /** `tenants.currency` — ISO 4217, or null/blank for a gym that has not said. */
  currency: string | null;
  /** `tenants.timezone` — an IANA zone, or null for a gym that has not said. */
  timezone: string | null;
  /**
   * `tenants.session_fee`, in WHOLE currency units (part 01 declared it
   * `numeric(8,2)`; part 118 dropped its default and its not-null, so null now
   * means unstated).
   */
  sessionFee: number | null;
}

export interface SetupFacts {
  /**
   * The tenants row, or NULL when that read did not come back. Null is not a
   * gym with nothing set: it is four settings nobody managed to ask about, and
   * four items go 'unknown' on it rather than 'todo'.
   */
  tenant: TenantSettings | null;
  /**
   * How many plans the price book holds, or null when that read did not come
   * back WHOLE.
   *
   * Null covers both a refusal and a truncated read, and both must. A
   * truncated price book cannot make this item wrong — a capped read has at
   * least a thousand rows in it, so there is certainly a plan — but the caller
   * that hands over a number is asserting it counted the set, and one door for
   * "I did not count it" is worth more than one clever exception.
   */
  plans: number | null;
  /** How many memberships the roster holds, on exactly the same terms. */
  members: number | null;
}

/** Every count the tally reports, kept apart on purpose. */
export interface SetupTally {
  done: number;
  todo: number;
  unknown: number;
  total: number;
}

/**
 * Whether this gym is still wearing the name sign-up gave it.
 *
 * supabase/parts/06-account-provisioning.sql writes it, twice:
 *
 *     insert into tenants (name) values (coalesce(p.full_name,'My') || '''s space')
 *
 * — the owner's full name, or the literal `My`, then a straight apostrophe and
 * ` space`. Nothing normalises it afterwards.
 *
 * The SHAPE is what is matched rather than that exact string rebuilt from the
 * signed-in profile, because an owner who has since changed their own full
 * name would no longer match it: the tenant keeps the name it was created
 * with. So: anything ending in `'s space`.
 *
 * That is a heuristic and it can be wrong in one direction: a gym genuinely
 * called "Sara's space" reads as unnamed. It cannot be wrong in the other, and
 * the direction matters — an owner who sees the row, reads their own gym's
 * real name in it and ignores it has lost two seconds, while a gym that
 * silently keeps mailing statements headed "Sara's space" has lost something
 * an accountant will ask about. The curly apostrophe is accepted too, because
 * an owner retyping the same name from a phone keyboard gets one.
 *
 * A gym with no name at all — which the column permits — is unnamed by the
 * same measure and the same row asks for one.
 */
export function looksProvisioned(name: string | null): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  return /['’]s space$/.test(n);
}

/** Blank, whitespace and null are one answer: the gym has not said. */
function stated(v: string | null): string | null {
  const s = (v ?? '').trim();
  return s || null;
}

const UNREAD_GYM =
  'The gym record could not be read, so this could not be checked — it is not known to be either way.';

/**
 * The six, in order, each with its state and its consequence.
 *
 * Pure: the same facts give the same list, and the list is the only thing the
 * two screens agree through.
 */
export function assessGymSetup(f: SetupFacts): SetupItem[] {
  const t = f.tenant;

  const gymItem = (
    key: SetupKey,
    isDone: (s: TenantSettings) => boolean,
    title: string,
    breaks: string,
    onlyIf: string | null,
    found: (s: TenantSettings) => string | null = () => null,
  ): SetupItem => (
    t === null
      ? { key, state: 'unknown', title, breaks, onlyIf, unknownWhy: UNREAD_GYM, found: null }
      : { key, state: isDone(t) ? 'done' : 'todo', title, breaks, onlyIf, unknownWhy: null, found: found(t) }
  );

  const countItem = (
    key: SetupKey,
    n: number | null,
    title: string,
    breaks: string,
    onlyIf: string | null,
    unknownWhy: string,
  ): SetupItem => (
    n === null
      ? { key, state: 'unknown', title, breaks, onlyIf, unknownWhy, found: null }
      : { key, state: n > 0 ? 'done' : 'todo', title, breaks, onlyIf, unknownWhy: null, found: null }
  );

  const by: Record<SetupKey, SetupItem> = {
    currency: gymItem(
      'currency',
      (s) => stated(s.currency) !== null,
      'Set what this gym charges in',
      'Until a currency is set this gym cannot price a plan, record a payment, import a price '
      + 'book or settle payroll, and every money figure in the console is withheld rather than '
      + 'shown in a currency nobody chose.',
      null,
    ),
    timezone: gymItem(
      'timezone',
      (s) => stated(s.timezone) !== null,
      'Say where this gym is',
      'This is the only setting here that is wrong rather than empty while it is unset: with no '
      + 'timezone, “today”, the month close, the payroll month and the footfall-by-hour chart are '
      + 'each cut on whichever machine the page is open on. Read at the front desk they are right '
      + 'by accident; read by a bookkeeper in another country they are not.',
      null,
    ),
    name: gymItem(
      'name',
      (s) => !looksProvisioned(s.name),
      'Name the gym',
      'Sign-up named this gym after the account that created it. That name is the heading on the '
      + 'month-close sheet, the tax pack and every export that leaves the building, and it is what '
      + 'members see in the app.',
      null,
      (s) => stated(s.name),
    ),
    plan: countItem(
      'plan',
      f.plans,
      'Price at least one membership',
      'A membership opens against a plan, so until the price book has one, a membership carries '
      + 'no price and the recurring revenue figure on the overview is a dash.',
      'Only if this gym sells memberships rather than drop-ins alone.',
      'The price book did not come back whole, so this could not be checked.',
    ),
    member: countItem(
      'member',
      f.members,
      'Get the members in',
      'Every screen in this console is a view of the roster, so with nothing on it they are all '
      + 'correctly empty. Members are invited rather than typed in — a membership needs a real '
      + 'account behind it — and a spreadsheet from the old system can issue the invitations in '
      + 'one go.',
      null,
      'The roster did not come back whole, so this could not be checked.',
    ),
    fee: gymItem(
      'fee',
      (s) => s.sessionFee !== null,
      'Say what a session is worth',
      'Payroll multiplies delivered one-to-ones by this, so while it is unset the payroll screen '
      + 'shows what was delivered and refuses to price it.',
      'Only if this gym delivers one-to-one sessions.',
    ),
  };

  return SETUP_ORDER.map((k) => by[k]);
}

/** How many of each. Three counts, never two: see the header. */
export function setupTally(items: readonly SetupItem[]): SetupTally {
  let done = 0, todo = 0, unknown = 0;
  for (const i of items) {
    if (i.state === 'done') done++;
    else if (i.state === 'todo') todo++;
    else unknown++;
  }
  return { done, todo, unknown, total: items.length };
}

/**
 * Whether the list is worth putting in front of anybody.
 *
 * True only when something is actually outstanding. NOT true for unknowns
 * alone: a screen whose reads failed already carries a banner saying which,
 * and a second panel underneath saying "6 things could not be checked" is one
 * silence with two explanations. A list that appeared for a fully set-up gym
 * every time the network hiccuped would be dismissed, and then it would be
 * dismissed on the day it mattered.
 */
export function needsSetup(items: readonly SetupItem[]): boolean {
  return items.some((i) => i.state === 'todo');
}

/**
 * The one sentence above the list, or null when there is nothing to say.
 *
 * The unknown count is a separate clause and never folded into the outstanding
 * one — "2 still to do" and "2 still to do, and 1 we could not check" are
 * different statements about somebody's business.
 */
export function setupLine(items: readonly SetupItem[]): string | null {
  const t = setupTally(items);
  if (t.todo === 0 && t.unknown === 0) return null;
  // "All six are set" is never said while anything is unknown, because it
  // would be a claim about the two settings nobody managed to read.
  // numbers-ok: `t.total` is `items.length` — the fixed setup checklist a gym
  // works through once, six entries long. Not "it is small today": there is no
  // reachable state in which a gym has a thousand settings to switch on. It is
  // also the count the sentence above says "All six are set" about. (This
  // module is console-shared as well — studio-web/app/page.tsx renders it — so
  // a latched `appLocale()` would be a hydration hazard on top; see
  // src/lib/consoleSearch.ts for that argument written out in full.)
  const head = t.todo === 0
    // numbers-ok: as above — a fixed six-entry checklist.
    ? `${t.done} of ${t.total} set`
    // numbers-ok: as above — a fixed six-entry checklist.
    : `${t.done} of ${t.total} set, ${t.todo} still to do`;
  if (t.unknown === 0) return `${head}.`;
  const tail = t.unknown === 1
    ? 'and one could not be checked, so it is not counted either way'
    : `and ${t.unknown} could not be checked, so they are not counted either way`;
  return `${head}, ${tail}.`;
}
