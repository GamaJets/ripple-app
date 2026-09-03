-- The gym inviting you could not be named.
--
-- ── The hole ──────────────────────────────────────────────────────────────
--
-- 37-member-invites.sql gives the invitee exactly one read: `mi_invitee_read`,
-- which matches `lower(email) = lower(auth.jwt() ->> 'email')` and returns the
-- invite row. That row carries a `tenant_id` and a `plan_id` and no names, and
-- the invitee can read neither of the tables those point at:
--
--   · `tenants_client_r` (142) scopes tenant rows to somebody who is ALREADY in
--     the tenant, through coach_clients. An invitee is not, by definition —
--     the invite is what makes them one.
--   · `membership_plans` is the gym's own price list and is read by its members
--     and its staff, not by a stranger holding an invitation.
--
-- Both of those are right, and the consequence is that the app cannot say which
-- gym is inviting you or onto what plan. app/(client)/trainers.tsx renders
-- "A Gym Has Invited You to Join" and a sentence saying the plan's name could
-- not be read, which is honest and is not what the gym paid for: the member is
-- being asked to join something the screen cannot name.
--
-- ── Why a function and not a policy ───────────────────────────────────────
--
-- Because RLS selects ROWS, not columns. A policy on `tenants` wide enough to
-- show an invitee the gym's name would hand them the whole tenant row —
-- settings, currency, brand, retention, the lot — for a gym they have not
-- joined. 242-a-fee-a-client-can-read-the-currency-of.sql makes exactly this
-- argument on this exact table and answers it the same way: a SECURITY DEFINER
-- function that returns the two columns and nothing else.
--
-- ── What it discloses, and to whom ────────────────────────────────────────
--
-- To a signed-in caller, for each PENDING invitation addressed to their own
-- email address: the tenant id (which they can already read off the invite
-- row), the gym's name, the plan id (likewise) and the plan's name. Nothing
-- else, and nothing at all for an invitation addressed to anybody else.
--
-- The predicate is the same one `mi_invitee_read` uses, `nullif` included: an
-- unauthenticated caller has no email claim, and coalescing it to '' would make
-- an invite stored with a blank address readable by anon. `member_invites` has
-- a not-blank constraint on email as well, and both stay.
--
-- Accepted and revoked invitations are excluded. The name of a gym that
-- withdrew an invitation is not something this needs to keep answering.
--
-- ── The app does not depend on this having been applied ───────────────────
--
-- src/ui/gymInvites.ts calls this and treats a failure — including "function
-- does not exist" — as "no names available". The invitations still list and can
-- still be accepted; they are described rather than named. So this part
-- improves a working screen and does not gate one.

create or replace function public.my_invited_gyms()
returns table (tenant_id uuid, gym_name text, plan_id uuid, plan_name text)
language sql stable security definer set search_path = public as $$
  select mi.tenant_id, t.name, mi.plan_id, p.name
    from public.member_invites mi
    join public.tenants t on t.id = mi.tenant_id
    left join public.membership_plans p on p.id = mi.plan_id
   where mi.status = 'pending'
     and lower(mi.email) = lower(nullif(auth.jwt() ->> 'email', ''));
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function and Supabase's
-- default privileges add anon on top, so the revoke has to come first or the
-- grant back means nothing. Same convention as 37-member-invites.sql, which
-- documents the live acl this was verified against.
revoke execute on function public.my_invited_gyms() from public, anon;
grant  execute on function public.my_invited_gyms() to authenticated;
