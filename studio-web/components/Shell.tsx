'use client';

// The console frame: who you are, which gym you are looking at, and the areas
// your role can reach.
//
// Navigation is filtered by role rather than hidden by it — a receptionist does
// not see a Money link they cannot open. The database enforces the same thing
// independently, so a hand-typed URL gets an empty result, not a leak.
import type { Me } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

export interface NavItem { href: string; label: string; roles: Array<'owner' | 'trainer'> }

export const NAV: NavItem[] = [
  // Owner only, and it must stay in step with app/page.tsx, which rejects any
  // non-owner outright. This said ['owner','trainer'] while the page said
  // owner — so a trainer saw Overview in their own nav, clicked it, and was
  // told "Not your console". A nav that offers what the page refuses is
  // worse than one that offers nothing.
  { href: '/', label: 'Overview', roles: ['owner'] },
  { href: '/members', label: 'Members', roles: ['owner'] },
  // Beside Members because it is the same record asked as a gym-wide
  // question: Members answers "how is Sara doing?", this answers
  // "are we keeping people?".
  { href: '/retention', label: 'Retention', roles: ['owner'] },
  // Beside Members, and owner-only for the same reason /close is: it carries
  // every colleague's pay and delivery record on one screen. A trainer must not
  // be offered a link to their own performance file, still less to everyone
  // else's — and the page refuses the role independently, so this nav entry and
  // that check say the same thing rather than one covering for the other.
  { href: '/staff', label: 'Staff', roles: ['owner'] },
  { href: '/timetable', label: 'Timetable', roles: ['owner'] },
  { href: '/sessions', label: 'Sessions', roles: ['owner'] },
  { href: '/money', label: 'Money', roles: ['owner'] },
  // Owner only, like every other entry here bar Door, and for the strongest
  // reason of any of them: the close carries every payment, every invoice and
  // every trainer's pay for the month on one screen.
  { href: '/close', label: 'Close', roles: ['owner'] },
  // Staff work the door, so this is the one operational screen a trainer sees.
  { href: '/door', label: 'Door', roles: ['owner', 'trainer'] },
  { href: '/import', label: 'Import', roles: ['owner'] },
  // Beside Import deliberately: a gym that can be imported into and not
  // exported out of is a gym that cannot leave.
  { href: '/export', label: 'Export', roles: ['owner'] },
];

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
  const items = NAV.filter((n) => role && (n.roles as string[]).includes(role));
  const who = me.fullName?.trim() || me.email || 'Signed in';

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 216,
          flex: 'none',
          borderRight: '1px solid var(--ring)',
          background: 'var(--surface)',
          padding: '18px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '0 18px 16px', borderBottom: '1px solid var(--ring)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span
              style={{
                width: 26, height: 26, borderRadius: 7, background: 'var(--brand)',
                display: 'grid', placeItems: 'center', flex: 'none',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 100 100" aria-hidden="true">
                <g fill="none" stroke="var(--brand-ink)" strokeWidth="8">
                  <circle cx="50" cy="50" r="31" opacity="0.4" />
                  <circle cx="50" cy="50" r="19" opacity="0.7" />
                </g>
                <circle cx="50" cy="50" r="9" fill="var(--brand-ink)" />
              </svg>
            </span>
            <strong style={{ fontSize: 14.5 }}>Repple Studio</strong>
          </div>
          {/* The gym, not the person — this console is scoped to one tenant. */}
          <div style={{ marginTop: 9, fontSize: 12.5, color: 'var(--ink3)' }}>
            {gymName ?? <span className="dash">No gym linked</span>}
          </div>
        </div>

        <nav style={{ padding: '12px 10px', flex: 1 }}>
          {items.map((n) => {
            const active = n.href === current;
            return (
              <a
                key={n.href}
                href={n.href}
                style={{
                  display: 'block',
                  padding: '8px 10px',
                  borderRadius: 6,
                  marginBottom: 2,
                  fontSize: 13.5,
                  color: active ? 'var(--ink)' : 'var(--ink2)',
                  background: active ? 'var(--surface2)' : 'transparent',
                  textDecoration: 'none',
                }}
              >
                {n.label}
              </a>
            );
          })}
        </nav>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--ring)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {who}
          </div>
          <div className="micro" style={{ marginTop: 3 }}>{role ?? 'no role'}</div>
          <button
            onClick={() => supabase.auth.signOut().then(() => location.reload())}
            style={{
              marginTop: 10, background: 'var(--surface2)', color: 'var(--ink2)',
              border: '1px solid var(--ring)', borderRadius: 6, padding: '6px 10px',
              fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--sans)',
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
