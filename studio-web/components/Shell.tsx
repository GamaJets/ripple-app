'use client';

// The console frame: who you are, which gym you are looking at, and the areas
// your role can reach.
//
// Navigation is filtered by role rather than hidden by it — a receptionist does
// not see a Payroll link they cannot open. The database enforces the same thing
// independently, so a hand-typed URL gets an empty result, not a leak.
//
// It is also split by CONTEXT, which is a different question from role. Most of
// this console is the gym: its members, its timetable, its books. Three screens
// are not — /coach and its children are scoped to the signed-in trainer, so an
// owner who also takes clients reads their own book there, not the gym's. Those
// two subjects used to sit in one list and the list did not survive it: every
// attempt to design the rail ended up inventing a container called "Mine" for
// the odd three. So the rail shows one context at a time and says which, rather
// than mixing "the gym" and "me" and leaving the reader to sort them out.
import type { Me } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import { siteRailLine, type SiteScope } from '@lib/ownedSites';

export type NavContext = 'gym' | 'mine';

export interface NavItem {
  href: string;
  label: string;
  roles: Array<'owner' | 'trainer'>;
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
  // It stays in the gym context for both roles: the front desk belongs to the
  // building, not to whoever happens to be standing at it.
  { href: '/door', label: 'Door', roles: ['owner', 'trainer'], context: 'gym' , group: 'Floor' },
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
  // Beside Gym rather than beside Members, because it is not about any one
  // member: it is what the gym can PRODUCE when somebody asks — an insurer, a
  // regulator, or the member themselves. Owner-only, and the strongest case for
  // it of anything in this group: the screen carries every signature the gym
  // holds, every document it has filed, and the log of who did what to its
  // record.
  { href: '/compliance', label: 'Compliance', roles: ['owner'], context: 'gym' , group: 'System' },
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
   */
  gymNameUnread?: boolean;
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
  // Null unless this account owns more than one gym AND the read settled. See
  // the note on the `sites` prop.
  const railLine = sites ? siteRailLine(sites) : null;

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
            "no gym linked" is a state worth seeing rather than an empty line. */}
        <div
          className="mono"
          style={{
            padding: '0 12px', marginTop: -8, fontSize: 9, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--ink3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {gymName ?? (
            <span className="dash">
              {gymNameUnread ? 'Gym name unread' : 'No gym linked'}
            </span>
          )}
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

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
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

      <main style={{ flex: 1, minWidth: 0, padding: 'var(--gutter)' }}>{children}</main>
    </div>
  );
}
