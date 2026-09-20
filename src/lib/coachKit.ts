// The gym's kit register, told to the coach who has to program around it.
//
// ── Why this did not exist ────────────────────────────────────────────────
//
// `gym_equipment` (supabase/parts/34) has admitted the gym's trainers since the
// day it was written. Its SELECT policy is
//
//     create policy gym_equipment_staff_r on gym_equipment
//       for select using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));
//
// — supabase/setup.sql line 2494, and the part file agrees. The permission was
// never the obstacle. The obstacle was that nothing in `app/(trainer)/**`
// mentioned the table at all: the only reader anywhere in the product was the
// owner's console (app/(owner)/equipment.tsx and studio-web/app/equipment), so
// the register was written by the person who buys the kit and read by the
// person who buys the kit, and the person who programs a session on it was
// left to find out at 6am that four of the rowers are broken.
//
// That is a scheduling fact, not a maintenance one — `capacityFor` in
// src/lib/gymEquipment.ts makes the whole argument: a class capacity of 14 is a
// claim about the room, and it stops being true the moment six of the rowers
// go down. The owner's screen already turns that into a red banner. The coach,
// who is the one standing in the room, could not see the input to it.
//
// ── The four silences, which are not one silence ──────────────────────────
//
// This module exists because "there is nothing to show you" arrives here by
// four different routes and only one of them means the gym's kit is fine:
//
//   · NO GYM AT ALL. Seven coaches are live on this product and every one of
//     them is alone in their own tenant; no gym has signed up yet. So the
//     overwhelmingly common render is the one with no employer, and an empty
//     list under a heading about the gym's equipment says, silently, "your gym
//     has recorded no broken kit" to somebody who has no gym. `src/lib/gymLink.ts`
//     is named after that exact substitution and its sentence is reused here.
//   · A GYM, AND AN EMPTY REGISTER. Nobody filled the form in. That is not a
//     gym that owns no rowers, and it is emphatically not a gym whose rowers
//     all work. `capacityFor` already refuses to report 0 for this case and so
//     does this one.
//   · A GYM, A WHOLE READ, AND NOTHING WRONG. The one case where silence is an
//     answer, and it is said out loud rather than drawn as a blank space.
//   · A READ THAT DID NOT LAND. Nothing may be stated from it. A coach told
//     "nothing is out of action" over a timeout programs the broken rack.
//
// ── Read-only, and why that is the whole feature ──────────────────────────
//
// `gym_equipment_staff_u` does permit a trainer to take a machine out of
// action, and this module offers nothing of the sort. Taking kit out of service
// writes `out_of_service_reason` and `out_of_service_since`, which feed the
// owner's capacity banner and the maintenance history in `gym_equipment_log`;
// a half-built version of that — a toggle with no reason box, or one that
// reports success from the absence of an error — is worse than not having it.
// What a coach needs before they write a program is the state, and the state
// is what this gives them.
//
// Pure: no react, no supabase, no clock. `today` is passed in, and the caller
// is expected to pass the GYM's day where it knows one — see src/ui/coachKit.ts.
import { daysBetween } from './attendance';
import {
  serviceState, nextServiceDue, usableUnits, outOfServiceUnits, needsAttention,
  type Equipment, type ServiceState,
} from './gymEquipment';
import { noGymNote } from './gymLink';
// The same three-valued link app/(trainer)/settings.tsx and the coach's pay
// card use. Imported rather than redeclared: 'unknown' being a separate value
// from 'none' is the decision that stops "you are not attached to a gym" being
// printed over a profile read that timed out, and there must be exactly one
// place that decision is written down.
import type { GymLink } from './coachPayTerms';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/* ── the sentences ────────────────────────────────────────────────────────── */

/**
 * What a coach is told when the register could not be read.
 *
 * The second clause is the load-bearing half. Without it this is "nothing to
 * show", and a coach acts on that by assuming the rack is fine — which is the
 * precise failure the whole module is built around.
 */
export const KIT_UNREAD_NOTE =
  'Your gym’s equipment register could not be read, so nothing here says what is in service. ' +
  'It is not a statement that everything works — check with the gym before you program around a machine.';

/**
 * A gym whose register has no rows in it.
 *
 * Said as a fact about the FORM rather than about the gym, for the reason
 * `capacityFor` gives about returning null instead of 0: an unfilled register
 * and a gym that owns nothing are indistinguishable in the data, and only one
 * of them is a reason to change a program.
 */
export const KIT_UNWRITTEN_NOTE =
  'Your gym has not put anything in its equipment register. That is an empty form rather than an empty gym — ' +
  'nothing here says a machine is missing, and nothing here says one works.';

/** The one silence that is an answer, said rather than drawn as blank space. */
export const KIT_ALL_CLEAR_NOTE =
  'Nothing in the register is out of action and nothing is past a service.';

/** Why there are no controls on this. See the header. */
export const KIT_READ_ONLY_NOTE =
  'This is the gym’s register, shown as it stands. Taking a machine out of action is done by the gym.';

/**
 * What each service state means to somebody writing a session, in their words
 * rather than the register's.
 *
 * `unrecorded` is deliberately not folded into `due`. The register distinguishes
 * "this gym decided this kit needs no schedule" from "it set one and nobody has
 * ever logged a service", and the second is the one that matters — see
 * `ServiceState` in src/lib/gymEquipment.ts. Collapsing them here would undo
 * that one layer up.
 */
export const KIT_SERVICE_NOTE: Record<FlaggedService, string> = {
  overdue: 'past its service date',
  due: 'due a service within the week',
  unrecorded: 'on a service schedule with no service ever recorded',
};

/* ── the shapes ───────────────────────────────────────────────────────────── */

/** The three service states a coach is shown. `ok` and `unscheduled` are not
 *  problems and do not appear — see `needsAttention`, which draws the same line. */
export type FlaggedService = Extract<ServiceState, 'overdue' | 'due' | 'unrecorded'>;

/** One machine that is out of action right now. */
export interface DownItem {
  id: string;
  /** Name, with the asset tag after it when the register carries one. */
  label: string;
  /** The gym's own word for the kind of kit, or null. Used to group. */
  category: string | null;
  /** Units of it that are down. `quantity` on the row — a rack of eight
   *  dumbbells out of action is eight, not one. */
  units: number;
  /** Why, in the words of whoever took it out. Null when nobody said, which is
   *  NOT the same as "no reason" and is drawn as its own sentence. */
  reason: string | null;
  /**
   * Whole days it has been out, or null when the register does not say when.
   *
   * Null rather than 0: `out_of_service_since` was added after the status
   * column existed (supabase/parts/186 and the columns beside it), so rows that
   * went down before it exists carry a status and no date. Reporting those as
   * "out for 0 days" would tell a coach a rower broke this morning when it may
   * have been broken since spring.
   */
  daysDown: number | null;
}

/** One machine whose service is owed. */
export interface ServiceItem {
  id: string;
  label: string;
  category: string | null;
  state: FlaggedService;
  /** The day it falls or fell due, or null when nothing was ever recorded to
   *  count from. Never invented from the purchase date. */
  dueOn: string | null;
  /** Whole days past due. Null unless it is overdue AND there is a date. */
  daysOverdue: number | null;
}

/**
 * What the coach's kit section draws. One of five, and never an empty list
 * standing in for any of the other four.
 */
export type CoachKitView =
  /** No answer yet, or an answer that did not land. Nothing may be stated. */
  | { kind: 'unread'; note: string }
  /** The account carries no gym. The common case on this product today. */
  | { kind: 'no_gym'; note: string }
  /** A gym, a whole read, and no rows. An unfilled form. */
  | { kind: 'unwritten'; note: string }
  /** A gym, a whole read, and nothing wrong with anything in it. */
  | { kind: 'clear'; note: string; usableUnits: number; items: number }
  /** A gym, a whole read, and something a coach should know before programming. */
  | {
      kind: 'attention';
      down: DownItem[];
      service: ServiceItem[];
      /** Units in service across the whole register. */
      usableUnits: number;
      /** Units the gym owns and cannot use right now. */
      downUnits: number;
      /** Rows that are not retired. Retired kit is gone, not broken. */
      items: number;
    };

/* ── pure rules ───────────────────────────────────────────────────────────── */

/**
 * How one machine is named on screen.
 *
 * The asset tag is included because a gym with nine identical rowers calls them
 * all "Rower" and the coach has to know which one to walk past. `name` is
 * `not null` in the schema but nothing stops it being blank, and a row that
 * renders as an empty string reads as a rendering fault rather than as missing
 * data — the failure src/lib/gymLink.ts's neighbours keep finding.
 */
export function kitLabel(e: Pick<Equipment, 'name' | 'identifier'>): string {
  const name = (e.name ?? '').trim();
  const tag = (e.identifier ?? '').trim();
  const base = name || 'Unnamed item';
  return tag ? `${base} · ${tag}` : base;
}

/**
 * Everything out of action, longest out first.
 *
 * Longest first rather than alphabetically because the ordering is the message:
 * a rower that has been broken for eleven weeks is a different conversation
 * from one that went down this morning, and the coach reading this is deciding
 * what to do about their 6am. Rows with no date sort last — they are not
 * "0 days out", they are undated, and putting them at the top would rank them
 * as the freshest breakages.
 */
export function downItems(items: Equipment[], today: string): DownItem[] {
  return items
    .filter((e) => e.status === 'out_of_service')
    .map((e) => {
      const d = e.outOfServiceSince ? daysBetween(e.outOfServiceSince, today) : null;
      return {
        id: e.id,
        label: kitLabel(e),
        category: e.category ?? null,
        units: Math.max(0, e.quantity),
        reason: (e.outOfServiceReason ?? '').trim() || null,
        // A negative span is a date in the future, which is not a duration and
        // is withheld rather than shown as a negative number of days or clamped
        // to zero. Both of those state something about when it broke.
        daysDown: d != null && d >= 0 ? d : null,
      };
    })
    .sort((a, b) =>
      (a.daysDown == null ? 1 : 0) - (b.daysDown == null ? 1 : 0)
      || (b.daysDown ?? 0) - (a.daysDown ?? 0)
      || a.label.localeCompare(b.label));
}

/**
 * Everything whose service is owed, worst first.
 *
 * Built on `needsAttention`, which already ranks overdue before due before
 * unrecorded and already drops retired kit — one ordering, stated once, so the
 * coach's list and the owner's cannot disagree about which rower is worst.
 *
 * Machines that are ALREADY out of action are dropped here. They are named in
 * `downItems` above with the reason they went down, and listing the same rower
 * twice under two headings reads as two rowers — which, on a screen whose job
 * is to say how many of them work, is the one arithmetic mistake that matters.
 */
export function serviceItems(items: Equipment[], today: string): ServiceItem[] {
  return needsAttention(items, today)
    .filter((r) => r.item.status !== 'out_of_service')
    .map(({ item, state }) => {
      const dueOn = nextServiceDue(item);
      const over = state === 'overdue' && dueOn ? daysBetween(dueOn, today) : null;
      return {
        id: item.id,
        label: kitLabel(item),
        category: item.category ?? null,
        // `needsAttention` only ever returns these three, and the cast says so
        // rather than widening every consumer to the two states that cannot
        // arrive. Its filter is one line above in src/lib/gymEquipment.ts.
        state: state as FlaggedService,
        dueOn,
        daysOverdue: over != null && over > 0 ? over : null,
      };
    });
}

/**
 * The whole section, decided once.
 *
 * `link` and `status` are BOTH required and neither is inferred from the rows.
 * An empty array is the same array under all four silences the header lists,
 * so the rows can never be the thing that decides which sentence is printed —
 * that is the defect this module is built to be unable to have.
 *
 * `isWhole` and not `=== 'ready'`: a truncated read is not the register, and a
 * screen counting usable units from a prefix would report a gym with 1,400
 * items as having whatever the first thousand came to. See src/ui/loadStatus.ts.
 */
export function coachKitView(
  link: GymLink,
  status: LoadStatus,
  items: Equipment[] | null,
  today: string,
): CoachKitView {
  if (link === 'unknown') return { kind: 'unread', note: KIT_UNREAD_NOTE };
  if (link === 'none') return { kind: 'no_gym', note: noGymNote('equipment records') };
  if (!isWhole(status) || !items) return { kind: 'unread', note: KIT_UNREAD_NOTE };

  // Retired kit has been disposed of. It is not broken and it is not usable,
  // and counting it anywhere on a coach's screen would answer "how much of this
  // can I program on" with stock the gym no longer owns.
  const live = items.filter((e) => e.status !== 'retired');
  if (live.length === 0) return { kind: 'unwritten', note: KIT_UNWRITTEN_NOTE };

  const down = downItems(live, today);
  const service = serviceItems(live, today);
  const usable = usableUnits(live);
  if (down.length === 0 && service.length === 0) {
    return { kind: 'clear', note: KIT_ALL_CLEAR_NOTE, usableUnits: usable, items: live.length };
  }
  return {
    kind: 'attention',
    down,
    service,
    usableUnits: usable,
    downUnits: outOfServiceUnits(live),
    items: live.length,
  };
}

/**
 * The one-line summary beside the section heading, or null.
 *
 * Null under every view that is not a whole read of a real register, so the
 * heading of an unread or gym-less section carries no figure at all. A "0" next
 * to "Gym Kit" is read as "nothing is broken", and that is precisely the claim
 * none of those views is entitled to make.
 */
export function kitHeadNote(view: CoachKitView): string | null {
  if (view.kind === 'clear') return 'All in service';
  if (view.kind !== 'attention') return null;
  const parts: string[] = [];
  if (view.downUnits > 0) parts.push(`${view.downUnits} out of action`);
  if (view.service.length > 0) parts.push(`${view.service.length} to service`);
  return parts.length ? parts.join(' · ') : null;
}
