-- ── Two holes opened tonight, both found by exploiting them ────────────────
--
-- 1. `log_gym_event` was an UNAUTHENTICATED CROSS-TENANT WRITE.
--
-- Part 105 wrote `revoke all on function ... from public` and stopped there.
-- Supabase grants EXECUTE to `anon` and `authenticated` SEPARATELY, so
-- revoking from `public` leaves both standing — and the function takes the
-- target tenant AS A PARAMETER and authorises nothing. It was reachable at
-- /rest/v1/rpc/log_gym_event with the publishable key, so anybody on the
-- internet could inject arbitrary lines into any gym's activity feed: the same
-- feed app/(owner)/ops.tsx renders as a record of what happened at their gym.
-- A verification pass proved it by writing "FORGED BY AN UNAUTHENTICATED
-- CALLER" into a live gym's feed. That row is deleted below.
--
-- Nothing legitimate calls it from the API. Its only callers are the four
-- SECURITY DEFINER triggers in part 105, which execute as the definer and are
-- unaffected by any grant to the API roles. Verified after applying: a member
-- joining still writes its event.
revoke all on function public.log_gym_event(uuid, text, uuid, text)
  from public, anon, authenticated;

-- The trigger functions were granted to PUBLIC and anon as well. A direct call
-- fails 0A000 — a trigger function cannot be invoked directly — so this is
-- tidiness rather than a hole. A grant nobody wrote reads as deliberate later.
revoke all on function public.gym_event_member_joined() from public, anon, authenticated;
revoke all on function public.gym_event_trainer_joined() from public, anon, authenticated;
revoke all on function public.gym_event_session_outcome() from public, anon, authenticated;
revoke all on function public.gym_event_promo_redeemed() from public, anon, authenticated;

-- The same asymmetry in part 104. These two are inert for anon — they key off
-- auth.uid() and answer 'signed-out' or an empty set — but a grant should not
-- be left standing for the next reader to have to reason about.
revoke all on function public.redeem_promo(text) from public, anon;
revoke all on function public.my_promo_redemptions() from public, anon;
grant execute on function public.redeem_promo(text) to authenticated;
grant execute on function public.my_promo_redemptions() to authenticated;


-- 2. `resolve_feedback` let ANY owner close ANY gym's ticket.
--
-- Part 118's predicate was:
--
--     is_owner_of(f.tenant_id)
--     or exists (select 1 from profiles p
--                 where p.id = auth.uid() and p.role = 'owner')
--
-- The second arm has no tenant test, so it discards the scope the first arm
-- establishes: being AN owner was enough to close ANYBODY's ticket, and
-- `resolved_by` was then stamped with the foreign owner's id. Proven live.
--
-- This is the same shape as the `invoices` policy removed in part 106 earlier
-- the same day — an unscoped `role = 'owner'` arm, written back when this was
-- one console over one set of books. Twice in one day is a pattern worth
-- naming: **`role = 'owner'` is never an authorisation on its own.**
-- `is_owner_of(tenant)` is the whole of it.
create or replace function public.resolve_feedback(p_id uuid, p_resolved boolean default true)
returns timestamptz
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare n int; at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  update public.feedback f
     set resolved_at = case when p_resolved then now() else null end,
         resolved_by = case when p_resolved then auth.uid() else null end
   where f.id = p_id
     and is_owner_of(f.tenant_id)
   returning f.resolved_at into at;
  get diagnostics n = row_count;

  if n = 0 then
    raise exception 'That ticket is not yours to close.' using errcode = '42501';
  end if;
  return at;
end $fn$;

revoke all on function public.resolve_feedback(uuid, boolean) from public, anon;
grant execute on function public.resolve_feedback(uuid, boolean) to authenticated;

delete from public.gym_events where summary like 'FORGED BY AN UNAUTHENTICATED CALLER%';
