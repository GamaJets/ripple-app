'use client';

// The console frame: who you are, which gym you are looking at, and the areas
// your role can reach.
//
// Navigation is filtered by role rather than hidden by it — a receptionist does
// not see a Payroll link they cannot open. The database enforces the same thing
// independently, so a hand-typed URL gets an empty result, not a leak.
//
// That sentence named a role this file did not have. `receptionist` is a real
// value of `profiles.role` (supabase/parts/711) and it now reaches exactly one
// entry in the list below, for the reasons written against it.
//
// It is also split by CONTEXT, which is a different question from role. Most of
// this console is the gym: its members, its timetable, its books. Three screens
// are not — /coach and its children are scoped to the signed-in trainer, so an
// owner who also takes clients reads their own book there, not the gym's. Those
// two subjects used to sit in one list and the list did not survive it: every
// attempt to design the rail ended up inventing a container called "Mine" for
// the odd three. So the rail shows one context at a time and says which, rather
// than mixing "the gym" and "me" and leaving the reader to sort them out.
import { useEffect, useState } from 'react';
import type { Me } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import { fetchOwnedSites } from '@/lib/sites';
import { siteRailLine, type SiteScope } from '@lib/ownedSites';

export type NavContext = 'gym' | 'mine';

export interface NavItem {
  href: string;
  label: string;
  /**
   * Which roles are OFFERED this link. Not which roles the database admits —
   * that is `supabase/parts`, and it refuses independently — but the two are
   * kept in step deliberately, because a rail that offers a screen the page or
   * the policies will refuse is the failure part 530 spends forty lines
   * declining to ship.
   *
   * `receptionist` reaches exactly one entry, /door, and the note beside it
   * says why it reaches no others.
   */
  roles: Array<'owner' | 'trainer' | 'receptionist'>;
  context: NavContext;
  /** The rail's heading this sits under. Eighteen ungrouped links is a wall. */
  group: string;
  /**
   * True for a link only somebody on the `platform_admins` allowlist may see.
   *
   * A separate flag rather than a fourth value in `roles`, because it is not a
   * role: `profiles.role` is signed up for, and the whole argument in
   * supabase/parts/252 is that platform access must not be reachable that way.
   * The page refuses independently — `is_platform_admin()` is checked there
   * too — so this flag and that check say the same thing rather than one
   * covering for the other.
   */
  adminOnly?: boolean;
}

export const CONTEXTS: Array<{ id: NavContext; label: string }> = [
  { id: 'gym', label: 'The gym' },
  { id: 'mine', label: 'My book' },
];

export const NAV: NavItem[] = [
  // Owner only, and it must stay in step with app/page.tsx, which rejects any
  // non-owner outright. This said ['owner','trainer'] while the page said
  // owner — so a trainer saw Overview in their own nav, clicked it, and was
  // told "Not your console". A nav that offers what the page refuses is
  // worse than one that offers nothing.
  { href: '/', label: 'Overview', roles: ['owner'], context: 'gym' , group: 'Floor' },
  { href: '/members', label: 'Members', roles: ['owner'], context: 'gym' , group: 'Floor' },
  // Directly after Members because it is where members come from. A membership
  // needs a Repple account behind it (memberships.member_id references
  // profiles), so every person on the roster arrived through an invitation —
  // and until this entry existed the write that issues one was reachable from
  // no screen in the product.
  { href: '/invites', label: 'Invites', roles: ['owner'], context: 'gym' , group: 'Floor' },
  // Beside Members because it is the same record asked as a gym-wide
  // question: Members answers "how is Sara doing?", this answers
  // "are we keeping people?".
  { href: '/retention', label: 'Retention', roles: ['owner'], context: 'gym' , group: 'Floor' },
  // The same question at the other end of the funnel: Retention asks whether
  // the gym keeps the people it has, this asks whether the people it gives
  // passes to ever become people it has.
  { href: '/passes', label: 'Passes', roles: ['owner'], context: 'gym' , group: 'Floor' },
  // Beside Members, and owner-only for the same reason /close is: it carries
  // every colleague's pay and delivery record on one screen. A trainer must not
  // be offered a link to their own performance file, still less to everyone
  // else's — and the page refuses the role independently, so this nav entry and
  // that check say the same thing rather than one covering for the other.
  { href: '/staff', label: 'Staff', roles: ['owner'], context: 'gym' , group: 'Delivery' },
  // Before Timetable because it is the thing the timetable is made of: a class
  // is defined once, then scheduled many times.
  { href: '/classes', label: 'Classes', roles: ['owner'], context: 'gym' , group: 'Delivery' },
  // Owner AND trainer, matching app/timetable/page.tsx, which admits both. The
  // board is the only place in this console a coach can take a register, and
  // `class_bookings.attended_at` is the single source of attendance for fill
  // rate, show rate, retention and class pay — nothing infers it from a
  // booking, and nobody ticks a class from memory three days later. While this
  // said owner alone the coach standing in the room had no way in, and the
  // /classes refusal told them to come here.
  //
  // What a trainer sees here is the board and the register; adding a class,
  // booking a one-to-one and removing anything are not rendered for them, and
  // the database refuses all three independently.
  { href: '/timetable', label: 'Timetable', roles: ['owner', 'trainer'], context: 'gym' , group: 'Delivery' },
  { href: '/sessions', label: 'Sessions', roles: ['owner'], context: 'gym' , group: 'Delivery' },
  // This was called "Money", one line above a screen called "Revenue", and no
  // label told you which one to click. They are opposite verbs on the same
  // ledger: here you WRITE it — price a plan, open a membership, record a
  // payment that arrived — and on Revenue you only READ it back. Naming this
  // one for what you do here leaves Revenue free to mean the analysis.
  { href: '/money', label: 'Plans & payments', roles: ['owner'], context: 'gym' , group: 'Money' },
  // Directly under it because it is the OTHER half of the same question. Plans
  // & payments is what the desk took; this is what members paid on their own
  // phones, through the gym's own Stripe account — money `payments` does not
  // contain. `gym_orders` had been written by the checkout function since
  // supabase/parts/281 and read by nobody but the buyer, so a gym taking card
  // money online had no order list at all: no way to see what sold, no way to
  // find a receipt at the desk, and no sight of an order Stripe charged for and
  // this product failed to grant.
  { href: '/orders', label: 'Online orders', roles: ['owner'], context: 'gym' , group: 'Money' },
  // Revenue is the analysis behind the capture above, and accounting is what
  // leaves the building for somebody else to file. Analytics is the only screen
  // here that answers "which way is this moving" rather than "what is true now".
  { href: '/revenue', label: 'Revenue', roles: ['owner'], context: 'gym' , group: 'Money' },
  // Directly under Revenue because it is the same ledger pointed the other way,
  // and because until it existed this product held no outgoing at all except
  // what it settles with its trainers: no rent, no power, no cleaner, no music
  // licence, no insurance, no accountant. The only profit-and-loss a gym had
  // was eight numbers typed into one AsyncStorage key on one phone.
  //
  // Owner only, and more firmly than most: a 'staff' cost line carries what the
  // gym pays the people who are not on Payroll, and a trainer reading their
  // colleagues' pay off a costs table is a disclosure the gym never made. The
  // page and the database each refuse the role independently.
  { href: '/costs', label: 'Costs', roles: ['owner'], context: 'gym' , group: 'Money' },
  { href: '/accounting', label: 'Accounting', roles: ['owner'], context: 'gym' , group: 'Money' },
  // After Accounting because it is the same records assembled for somebody
  // outside the building, and for a period nothing else in this console could
  // produce: /accounting and /close are both monthly, and a return is filed for
  // a quarter in most regimes that have one. It states no tax figure and says
  // so at the top — see the header of the page.
  { href: '/tax', label: 'Tax', roles: ['owner'], context: 'gym' , group: 'Money' },
  { href: '/analytics', label: 'Analytics', roles: ['owner'], context: 'gym' , group: 'System' },
  // Beside the money screens because it is the same ledger read from the other
  // side: those are what came in, this is what goes out to the people who
  // earned it.
  { href: '/payroll', label: 'Payroll', roles: ['owner'], context: 'gym' , group: 'Money' },
  // Owner only, like every other entry here bar Door, and for the strongest
  // reason of any of them: the close carries every payment, every invoice and
  // every trainer's pay for the month on one screen.
  { href: '/close', label: 'Close', roles: ['owner'], context: 'gym' , group: 'Money' },
  // Staff work the door, so this is the one operational screen a trainer sees.
  // It stays in the gym context for all three roles: the front desk belongs to
  // the building, not to whoever happens to be standing at it.
  //
  // ── And it is the WHOLE of a receptionist's console ───────────────────────
  //
  // supabase/parts/711 gave the gym's front desk a role of its own and widened
  // exactly two policies for it: `gym_visits` (select, insert, update) and
  // `gym_member_records` (select). This is the screen those two are for. Every
  // other entry above is withheld, and each is withheld because the database
  // would refuse it rather than because a rail felt tidier that way:
  //
  //   · Members, Retention, Passes, Money, Orders, Revenue, Costs, Accounting,
  //     Tax, Payroll, Close, Analytics — all read tables whose only policy is
  //     `is_owner_of(tenant_id)`. A receptionist opening any of them reads
  //     nothing, which draws as a gym with no members, no passes and no money.
  //   · Members in particular, which part 711's own footer names as the desk's
  //     screen: its roster is built from `memberships`, and `memberships` has
  //     two policies, `is_owner_of` and `member_id = auth.uid()`. The page's
  //     spine therefore comes back empty rather than refused, and an empty
  //     roster is this console telling the desk their gym has no members. The
  //     refusal on that page says so in full.
  //   · Timetable and Equipment admit a trainer and gate on `my_role() in
  //     ('trainer','owner')`; neither was widened.
  //   · My day, My clients, Their checklists, My earnings are a coach's own
  //     book. A receptionist has no `trainers` row by design — part 711 refuses
  //     to create one — so there is no book for these to be about.
  //
  // One entry means `contexts` below has one member, so the Gym/Mine switch is
  // not drawn for this role at all. That is the existing rule doing its job
  // rather than a special case: a role with one context gets no switch.
  { href: '/door', label: 'Door', roles: ['owner', 'trainer', 'receptionist'], context: 'gym' , group: 'Floor' },
  // A coach's own book — the whole of the "mine" context. Scoped to the signed-in
  // trainer, not the tenant, which is exactly why it is not in the list above.
  { href: '/coach', label: 'My day', roles: ['owner', 'trainer'], context: 'mine' , group: 'My book' },
  { href: '/coach/roster', label: 'My clients', roles: ['owner', 'trainer'], context: 'mine' , group: 'My book' },
  // Between the roster and earnings because it is the third thing a coach does
  // with a named client, after seeing them and before being paid for them.
  { href: '/coach/checklists', label: 'Their checklists', roles: ['owner', 'trainer'], context: 'mine' , group: 'My book' },
  { href: '/coach/earnings', label: 'My earnings', roles: ['owner', 'trainer'], context: 'mine' , group: 'My book' },
  // Beside Door because both are about the building rather than the books:
  // what is in the room, and who is coming through it.
  //
  // Owner AND trainer, matching app/equipment/page.tsx, which admits both and
  // says why in its header: taking a machine out of action is a job for whoever
  // is standing next to the machine, and a register only staff can read but not
  // write goes stale in a week. This entry said owner alone, so a trainer could
  // reach the page by typing the URL and was never offered the link — the same
  // disagreement, in the opposite direction, as the Overview entry above.
  { href: '/equipment', label: 'Equipment', roles: ['owner', 'trainer'], context: 'gym' , group: 'System' },
  // Last in System and first in importance for a gym that has just opened.
  // Until this route existed every `.from('tenants')` call in this console was
  // a select: /money and /import each told the owner to set the currency "on
  // the gym settings screen", and there was no such screen — so a new gym could
  // not price a plan, record a payment, import a price book or settle payroll,
  // and the console said where to go and had nowhere to send them.
  { href: '/settings', label: 'Gym', roles: ['owner'], context: 'gym' , group: 'System' },
  // Beside Gym, because "which gyms are mine" is the same kind of fact as the
  // gym's own settings and a different one from anything on the floor.
  //
  // It renders for every owner, including the great majority with one gym —
  // and for them it is one row and no totals, because a roll-up of one gym is
  // that gym. Hiding it below a threshold would mean the rail changed shape
  // the day somebody's second site was recorded, which is the moment they are
  // least well served by a console that has moved.
  { href: '/sites', label: 'Sites', roles: ['owner'], context: 'gym' , group: 'System' },
  // Beside Gym rather than beside Members, because it is not about any one
  // member: it is what the gym can PRODUCE when somebody asks — an insurer, a
  // regulator, or the member themselves. Owner-only, and the strongest case for
  // it of anything in this group: the screen carries every signature the gym
  // holds, every document it has filed, and the log of who did what to its
  // record.
  { href: '/compliance', label: 'Compliance', roles: ['owner'], context: 'gym' , group: 'System' },
  // Directly after Compliance because that is where it was hiding. `gym_events`
  // holds every payment, price change, cancellation, payroll run, month close
  // and deleted cost this gym has produced — twenty-one kinds by
  // supabase/parts/700 — and nothing in this rail named it. The only reader was
  // a `<select>` beneath the waivers on /compliance, itself gated on the gym
  // having done more than one kind of thing, so at a new gym the control did
  // not exist. "Who changed this price", "who cancelled that membership" and
  // "who deleted the September cost" are asked after something is already
  // wrong, and the answers were filed under a heading nobody in that state
  // would think to open.
  { href: '/activity', label: 'Activity', roles: ['owner'], context: 'gym' , group: 'System' },
  // Directly after Compliance because it is the same obligation with a deadline
  // on it. `app/(owner)/deletions.tsx` was the only surface in the product that
  // read the erasure queue, so the console — where an owner does everything
  // else that is regulated — was the one place a statutory clock could not be
  // honoured. An owner without the Studio app installed ran the thirty days out
  // and had no way of knowing.
  { href: '/deletions', label: 'Erasure', roles: ['owner'], context: 'gym' , group: 'System' },
  { href: '/import', label: 'Import', roles: ['owner'], context: 'gym' , group: 'System' },
  // Beside Import deliberately: a gym that can be imported into and not
  // exported out of is a gym that cannot leave.
  { href: '/export', label: 'Export', roles: ['owner'], context: 'gym' , group: 'System' },
  // Repple's own book — what trainers and gyms pay Repple, which is the
  // opposite direction from every other Money entry above. Its own group of one
  // so it cannot be misread as part of the gym's finances, and shown only to an
  // account on the platform_admins allowlist. The list is empty on a fresh
  // project, so on every gym's console this link does not exist.
  { href: '/platform', label: 'Repple', roles: ['owner', 'trainer'], context: 'gym', group: 'Platform', adminOnly: true },
];

// Which context the reader is currently in. Derived from the URL rather than
// remembered, so the rail can never disagree with the page beside it: land on
// /coach/roster from a bookmark and the switch already reads "My book".
export function contextOf(path: string): NavContext {
  const hit = NAV.find((n) => n.href === path);
  if (hit) return hit.context;
  // Sub-routes the rail does not list still belong somewhere, and anything
  // under /coach is the signed-in trainer's own book whatever hangs off it.
  return path === '/coach' || path.startsWith('/coach/') ? 'mine' : 'gym';
}

export function Shell({
  me,
  gymName,
  gymNameUnread,
  gymScoped = true,
  platformAdmin,
  sites,
  current,
  children,
}: {
  me: Me;
  gymName: string | null;
  /**
   * True when the gym's name could not be READ, as opposed to not existing.
   *
   * `gymName: null` was carrying both facts and the rail printed "No gym
   * linked" for either — a statement about the owner's ACCOUNT, made out of a
   * query that failed, on pages that deliberately discard that read's error
   * because the name is only a label. The label is only a label; the sentence
   * under it is not. Same distinction, and same reason, as `roleUnknown` on
   * `Me`: a refused read is not a fact about who somebody is.
   *
   * Optional, so a page that genuinely checks the read and shows a banner about
   * it need not pass anything.
   *
   * It stays a boolean about ONE query, and is deliberately not widened into a
   * status. It cannot describe the moment before that query answers — every
   * page starts it false — and the two answers that moment needs are read off
   * `me` instead, in `gymNote` below. Widening this to `'loading' | 'failed'`
   * would put the pending case back in the hands of thirty call sites that
   * would each have to remember to set it before awaiting.
   */
  gymNameUnread?: boolean;
  /**
   * False on the one screen whose subject is not a gym.
   *
   * `gymNote` below reads a name-shaped hole as a read still in flight, which
   * is right for the thirty-four routes that DO ask for the name — they all
   * render this rail while that query is out. /platform never asks: it is the
   * platform allowlist, above every tenant, and it passes `gymName={null}`
   * permanently. Left to the default it would sit on "Reading the gym name…"
   * for as long as the tab is open, which is the same class of untruth in the
   * other direction — a read reported as pending that nobody ever started.
   *
   * So the slot is left empty there, and only there. That is not the "empty
   * line" the comment beside the label argues against: that argument is about
   * staying silent where there IS an answer, and here the screen is not asking
   * the question. Defaulting to true keeps every other caller unchanged and
   * makes this an opt-out a page has to state on purpose.
   */
  gymScoped?: boolean;
  /**
   * True only when `is_platform_admin()` came back true.
   *
   * Optional and defaulting to false, so every existing page keeps the rail it
   * had and the one admin link is offered by nothing until a page deliberately
   * says so. An UNKNOWN answer (the check itself failed) is false here: the
   * rail offering a link the page will refuse is worse than a missing link
   * somebody can reach by typing the URL.
   */
  platformAdmin?: boolean;
  /**
   * The gyms this account owns, when the page has bothered to ask.
   *
   * Optional and defaulting to undefined, so every page that does not pass it
   * gets the rail it has always had — and so does every page that DOES pass it,
   * for the overwhelming majority of accounts: `siteRailLine` returns null for
   * one gym, for no gyms, and for a read that did not settle. A line appears
   * only for an account recorded against more than one gym, which is nobody
   * until a row is written into `owner_sites` with the service role.
   *
   * It is a label, not a control. Part 290 changed no policy, so a second site
   * is a name this console knows and a gym it cannot open; the rail says which
   * one is being shown and the page says the rest.
   */
  sites?: SiteScope;
  current: string;
  children: React.ReactNode;
}) {
  const role = me.role;
  const reachable = NAV.filter((n) => role && (n.roles as string[]).includes(role) && (!n.adminOnly || platformAdmin === true));
  const ctx = contextOf(current);
  const items = reachable.filter((n) => n.context === ctx);
  // Only offer a switch for contexts this role can actually reach. A role with
  // one context gets no switch at all rather than a control that does nothing.
  const contexts = CONTEXTS.filter((c) => reachable.some((n) => n.context === c.id));
  // Switching contexts is a navigation, not a toggle: it lands on the first
  // screen of the other context. That keeps the rail stateless — no stored
  // preference to drift out of step with the page being shown.
  const landing = (id: NavContext) => reachable.find((n) => n.context === id)?.href ?? '/';
  const who = me.fullName?.trim() || me.email || 'Signed in';
  /*
   * What the rail says where the gym's name goes, when there is no name.
   *
   * ── Extending the argument on `gymNameUnread` ─────────────────────────────
   *
   * That prop's own note above says a read that FAILED must not be printed as
   * "No gym linked", because that is a statement about the owner's account
   * assembled out of a query that did not return. Every word of it holds for a
   * read that has not COME BACK YET, and there was no third answer for one.
   *
   * Every page in this console starts the flag at `useState(false)` and sets it
   * only when the `tenants` row lands. So for the whole round trip between the
   * profile resolving — which is when this component first renders, the pages
   * gate on `me` above it — and that second read landing, `gymName` is null and
   * `gymNameUnread` is false, and the rail on roughly twenty routes told the
   * owner their account had no gym on it. Not on failure: on EVERY load, of
   * every screen, for every account on the platform. A false sentence shown for
   * a few hundred milliseconds on every page view is not a milder version of
   * the failure case; it is the one people actually see.
   *
   * ── Why the two new answers are not two new props ─────────────────────────
   *
   * Because they are already sitting in `me`, and a prop threaded through
   * thirty call sites is one more thing for a page to forget to pass — which is
   * exactly how `gymNameUnread` came to be false during the load it was meant
   * to describe. `gymScoped` above is a prop and is not a counter-example: it
   * answers a different question, one page knows the answer and every other
   * page keeps the default.
   *
   * `me.tenantId` is the column the sentence is ABOUT. Null is an account with
   * no gym on it, which is the one case "No gym linked" was ever true for; a
   * non-null id with no name yet is a name still in flight, and says so.
   *
   * `me.roleUnknown` has to be checked first, because `loadMe` returns
   * `tenantId: null` for a profile read that failed — it says so in its own
   * comment — so the id is not evidence of anything there. Reading it as "no
   * gym" would rebuild the identical defect one query earlier: an account state
   * invented out of a refused read. The page beside this rail already renders
   * "We could not read your account" for that branch, and this now agrees with
   * it rather than contradicting it in the corner of the screen.
   */
  const gymNote = !gymScoped
    ? null
    : gymNameUnread
      ? 'Gym name unread'
      : me.roleUnknown
        ? 'Profile unread'
        : me.tenantId
          ? 'Reading the gym name…'
          : 'No gym linked';
  /*
   * The site list, asked for here when the page did not hand one over.
   *
   * ── What was wrong ───────────────────────────────────────────────────────
   *
   * `sites` had exactly ONE caller in the whole console: app/page.tsx. The
   * other thirty routes render this same rail with the prop undefined, so
   * `siteRailLine` was never called on any of them and the strip said nothing.
   *
   * The effect on an owner recorded against two gyms is precise and bad. They
   * open the home page and are told they are looking at 1 of 2 sites. They then
   * click Close, or Payroll, or Accounting — and from that click onwards every
   * figure in the console is ONE gym's, with nothing anywhere on the page
   * saying which one or that there is another. The screen where it matters most
   * is the one they sign: a month-end close, handed to an accountant, of half a
   * business, with a rail that looks exactly like a single-site owner's.
   *
   * ── Why the read moved here rather than onto thirty pages ────────────────
   *
   * Because thirty copies of a read is thirty places for the next one to be
   * forgotten, which is the shape of the defect being fixed rather than a fix
   * for it. This component is the one thing every route already renders.
   *
   * ── What it costs, and who pays it ───────────────────────────────────────
   *
   * One `my_sites()` per page load, for owners only. It is a single SECURITY
   * DEFINER function returning one jsonb value (supabase/parts/290) and the
   * home page has always paid it. A trainer does not: five of this console's
   * screens are theirs, `owner_sites` is about owners, and an RPC per page for
   * a line that can never render for them is not a trade worth making.
   *
   * ── What it still does not do ────────────────────────────────────────────
   *
   * Nothing renders for the overwhelming case. `siteRailLine` is null for one
   * gym, for none, and for a read that did not settle — asserted in
   * ownedSites.test.ts — so a single-site owner's rail is byte-identical to
   * what it was. And this is a LABEL: part 290 changed no policy, so the second
   * site is a name this console knows and a gym it cannot open. The sentence
   * about what a failed site read means for the figures is `siteNotice`, and it
   * belongs beside the figures rather than in a label strip.
   */
  const [own, setOwn] = useState<SiteScope>({ status: 'loading', sites: [] });
  const askSites = !sites && me.role === 'owner';
  useEffect(() => {
    if (!askSites) return;
    let live = true;
    // No catch that turns a refusal into an empty list: `fetchOwnedSites`
    // returns status 'error' with no sites, and `siteRailLine` renders nothing
    // for that — which is right. A rail that said "1 of 1 sites" over a failed
    // read would be this console telling somebody their business is one gym.
    void fetchOwnedSites().then((s) => { if (live) setOwn(s); });
    return () => { live = false; };
  }, [askSites]);

  const scope = sites ?? (askSites ? own : null);
  const railLine = scope ? siteRailLine(scope) : null;

  // Headings in the order their first member appears in NAV, so there is no
  // second list of group names to fall out of step with the nav itself.
  const groups: Array<[string, NavItem[]]> = [];
  for (const n of items) {
    const hit = groups.find(([g]) => g === n.group);
    if (hit) hit[1].push(n);
    else groups.push([n.group, [n]]);
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/*
       * The skip link, and why it is worth its own paragraph.
       *
       * The rail below is identical on all thirty-five routes and holds up to
       * thirty links, so a person working the desk by keyboard paid thirty tab
       * stops for every screen change — and every screen change in this console
       * is a full document reload, so it was thirty every time, all day.
       *
       * It is visually hidden until focused, which is the only version that
       * works: a permanently visible skip link is the first thing a sighted
       * reader sees on a console they use forty times a day, and a
       * `display: none` one is not focusable at all.
       */}
      <a
        href="#main"
        style={{
          position: 'absolute', left: -9999, top: 0, zIndex: 10,
          background: 'var(--surface)', color: 'var(--ink)',
          border: '1px solid var(--ring)', padding: '8px 12px', fontSize: 13,
        }}
        onFocus={(e) => { e.currentTarget.style.left = '8px'; e.currentTarget.style.top = '8px'; }}
        onBlur={(e) => { e.currentTarget.style.left = '-9999px'; }}
      >
        Skip to the page
      </a>
      <aside
        style={{
          width: 184,
          flex: 'none',
          background: 'var(--rail)',
          borderRight: '1px solid var(--ring)',
          padding: '14px 0 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="2.3" fill="var(--brand)" stroke="none" />
            <path d="M17.2 6.8a7.35 7.35 0 0 1 0 10.4" />
            <path d="M6.8 17.2a7.35 7.35 0 0 1 0-10.4" />
          </svg>
          <div className="mono" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.11em' }}>
            REPPLE<span style={{ color: 'var(--ink3)' }}>/STUDIO</span>
          </div>
        </div>

        {/* The gym, not the person — this console is scoped to one tenant, and
            "no gym linked" is a state worth seeing rather than an empty line.
            Which of the four things a missing name can mean is decided by
            `gymNote` above; the argument for there being four is with it. */}
        <div
          className="mono"
          style={{
            padding: '0 12px', marginTop: -8, fontSize: 9, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--ink3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {gymName ?? (gymNote ? <span className="dash">{gymNote}</span> : null)}
        </div>

        {/* Which of how many, and only when there is more than one. Null for a
            single-site owner and null for a read that did not settle, so this
            renders nothing at all for every account on the platform today —
            the sentence about a FAILED site read belongs beside the figures it
            qualifies, not in a label strip. */}
        {railLine ? (
          <div
            className="mono"
            style={{
              padding: '0 12px', marginTop: -12, fontSize: 9, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--ink3)',
            }}
          >
            {railLine}
          </div>
        ) : null}

        {contexts.length > 1 && (
          <div style={{ margin: '0 12px', display: 'grid', gridTemplateColumns: `repeat(${contexts.length}, 1fr)`, border: '1px solid var(--ring)' }}>
            {contexts.map((c) => {
              const on = c.id === ctx;
              return (
                <a
                  key={c.id}
                  href={landing(c.id)}
                  aria-current={on ? 'true' : undefined}
                  className="mono"
                  style={{
                    textAlign: 'center',
                    padding: '4px 2px',
                    fontSize: 9.5,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    textDecoration: 'none',
                    color: on ? 'var(--brand-ink)' : 'var(--ink3)',
                    background: on ? 'var(--brand)' : 'transparent',
                  }}
                >
                  {c.id === 'gym' ? 'Gym' : 'Mine'}
                </a>
              );
            })}
          </div>
        )}

        {/* Named, because a screen reader listing the landmarks on this page
            otherwise offers "navigation" and nothing else — and there are two
            navigational regions on some routes. */}
        <nav aria-label="Console sections" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {groups.map(([group, ns]) => (
            <div key={group}>
              <div className="eyebrow" style={{ padding: '0 12px 4px' }}>{group}</div>
              {ns.map((n) => {
                const active = n.href === current;
                return (
                  <a
                    key={n.href}
                    href={n.href}
                    className="mono"
                    // Which of these thirty-five links is the page you are ON.
                    // It was carried by ink colour, a surface tint and a 2px
                    // left border and by nothing else — so a screen reader
                    // walking this rail read thirty-five identical link names
                    // on every route in the console, with no way to tell where
                    // it already was. The site switcher fifteen lines above
                    // this one has set `aria-current` since it was written.
                    //
                    // `page`, not `true`: this is a link to the page currently
                    // shown, which is the token that exists for exactly that
                    // and is what a reader announces as "current page".
                    aria-current={active ? 'page' : undefined}
                    style={{
                      display: 'block',
                      padding: '3px 12px',
                      fontSize: 11.5,
                      textTransform: 'lowercase',
                      textDecoration: 'none',
                      color: active ? 'var(--ink)' : 'var(--ink3)',
                      background: active ? 'var(--surface2)' : 'transparent',
                      borderLeft: `2px solid ${active ? 'var(--brand)' : 'transparent'}`,
                    }}
                  >
                    {n.label}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', padding: '10px 12px 0', borderTop: '1px solid var(--ring)' }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {who}
          </div>
          {/* Three states, and the rail had two.
              `me.roleUnknown` exists in studio-web/lib/supabase.ts precisely so
              a REFUSED profile read is not reported as an account without a
              role, and every page body already uses it — the Overview prints
              "We could not read your account… which is not the same as you not
              having access." This line, on every screen, said "no role"
              underneath it. */}
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink3)', textTransform: 'lowercase', marginTop: 2 }}>
            {role ?? (me.roleUnknown ? 'role not read' : 'no role')}
          </div>
          <button
            onClick={() => supabase.auth.signOut().then(() => location.reload())}
            className="mono"
            style={{
              marginTop: 9, background: 'transparent', color: 'var(--ink3)',
              border: '1px solid var(--ring)', borderRadius: 0, padding: '4px 9px',
              fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* `id` for the skip link above, and `tabIndex={-1}` so the browser
          actually moves focus here rather than only scrolling — without it the
          next Tab goes back to the second rail link and the skip link achieves
          nothing for the person it is for. */}
      <main id="main" tabIndex={-1} style={{ flex: 1, minWidth: 0, padding: 'var(--gutter)', outline: 'none' }}>{children}</main>
    </div>
  );
}
