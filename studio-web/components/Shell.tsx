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

export type NavContext = 'gym' | 'mine';

export interface NavItem {
  href: string;
  label: string;
  roles: Array<'owner' | 'trainer'>;
  context: NavContext;
  /** The rail's heading this sits under. Eighteen ungrouped links is a wall. */
  group: string;
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
  { href: '/timetable', label: 'Timetable', roles: ['owner'], context: 'gym' , group: 'Delivery' },
  { href: '/sessions', label: 'Sessions', roles: ['owner'], context: 'gym' , group: 'Delivery' },
  // This was called "Money", one line above a screen called "Revenue", and no
  // label told you which one to click. They are opposite verbs on the same
  // ledger: here you WRITE it — price a plan, open a membership, record a
  // payment that arrived — and on Revenue you only READ it back. Naming this
  // one for what you do here leaves Revenue free to mean the analysis.
  { href: '/money', label: 'Plans & payments', roles: ['owner'], context: 'gym' , group: 'Money' },
  // Revenue is the analysis behind the capture above, and accounting is what
  // leaves the building for somebody else to file. Analytics is the only screen
  // here that answers "which way is this moving" rather than "what is true now".
  { href: '/revenue', label: 'Revenue', roles: ['owner'], context: 'gym' , group: 'Money' },
  { href: '/accounting', label: 'Accounting', roles: ['owner'], context: 'gym' , group: 'Money' },
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
  { href: '/equipment', label: 'Equipment', roles: ['owner'], context: 'gym' , group: 'System' },
  { href: '/import', label: 'Import', roles: ['owner'], context: 'gym' , group: 'System' },
  // Beside Import deliberately: a gym that can be imported into and not
  // exported out of is a gym that cannot leave.
  { href: '/export', label: 'Export', roles: ['owner'], context: 'gym' , group: 'System' },
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
  current,
  children,
}: {
  me: Me;
  gymName: string | null;
  current: string;
  children: React.ReactNode;
}) {
  const role = me.role;
  const reachable = NAV.filter((n) => role && (n.roles as string[]).includes(role));
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
          {gymName ?? <span className="dash">No gym linked</span>}
        </div>

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
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink3)', textTransform: 'lowercase', marginTop: 2 }}>
            {role ?? 'no role'}
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
