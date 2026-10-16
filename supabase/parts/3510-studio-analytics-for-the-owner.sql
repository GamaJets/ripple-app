-- Studio analytics for the gym owner: one secure RPC, aggregates only.
--
-- Additive only: a new SECURITY DEFINER function. No table, column or policy
-- changes. The gym is resolved from auth.uid() exactly the way
-- owner_site_figures (part 2614) does it, and is_owner_of() is re-checked, so
-- an owner can only ever read a gym they own. Nothing returned names a
-- member; coach names are returned because the owner already sees their own
-- rota.
--
-- Small groups are withheld: the InBody aggregates need at least 3 members
-- with two scans, otherwise the "average change" would be one person's body.

create or replace function public.owner_studio_analytics(
  p_tenant uuid default null,
  p_days   integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_t     uuid;
  v_days  int := least(greatest(coalesce(p_days, 90), 7), 365);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_out   jsonb;
begin
  select m.tenant_id into v_t
    from (
      select p.tenant_id from public.profiles p
       where p.id = auth.uid() and p.role = 'owner' and p.tenant_id is not null
      union
      select os.tenant_id from public.owner_sites os where os.user_id = auth.uid()
    ) m
   where p_tenant is null or m.tenant_id = p_tenant
   limit 1;

  if v_t is null or not public.is_owner_of(v_t) then
    return null;
  end if;

  with
  ms as (select * from public.memberships where tenant_id = v_t),
  base_then as (
    -- Memberships that were live at the start of the window.
    select member_id from ms
     where started_on <= (now() - make_interval(days => v_days))::date
       and (ends_on is null or ends_on >= (now() - make_interval(days => v_days))::date)
  ),
  members as (select id from public.clients where tenant_id = v_t),
  sess as (
    select s.trainer_id, count(*)::int as n
      from public.sessions s
     where s.tenant_id = v_t and s.status = 'booked'
       and s.starts_at >= v_since and s.starts_at < now()
     group by s.trainer_id
  ),
  pays as (
    select coalesce(nullif(btrim(gp.currency), ''), '?') as cur,
           to_char(date_trunc('month', coalesce(gp.taken_at, gp.created_at)), 'YYYY-MM') as month,
           sum(gp.amount_cents)::bigint as cents
      from public.gym_payments gp
     where gp.tenant_id = v_t and coalesce(gp.taken_at, gp.created_at) >= v_since
     group by 1, 2
  ),
  ib as (
    select sc.client_id,
           (array_agg(sc.body_fat_pct order by sc.taken_at) filter (where sc.body_fat_pct is not null)) as bf,
           (array_agg(sc.skeletal_muscle_kg order by sc.taken_at) filter (where sc.skeletal_muscle_kg is not null)) as smm,
           (array_agg(sc.weight_kg order by sc.taken_at) filter (where sc.weight_kg is not null)) as wt,
           count(*) as n
      from public.scans sc
     where sc.client_id in (select id from members)
       and sc.source ilike 'inbody%'
     group by sc.client_id
  ),
  ib2 as (
    select bf[array_length(bf,1)] - bf[1] as d_bf,
           smm[array_length(smm,1)] - smm[1] as d_smm,
           wt[array_length(wt,1)] - wt[1] as d_wt
      from ib where n >= 2
  )
  select jsonb_build_object(
    'tenant_id', v_t,
    'days', v_days,
    'active_memberships', (select count(*) from ms where status = 'active'),
    'members', (select count(*) from members),
    'training_members', (select count(distinct w.user_id) from public.workouts w
                          where w.user_id in (select id from members)
                            and w.performed_at >= now() - interval '30 days'),
    'retention', jsonb_build_object(
      'base', (select count(distinct member_id) from base_then),
      'retained', (select count(distinct b.member_id) from base_then b
                    join ms on ms.member_id = b.member_id and ms.status = 'active')),
    'sessions_per_coach', coalesce((
      select jsonb_agg(jsonb_build_object('trainer_id', s.trainer_id,
               'name', coalesce(p.full_name, 'Coach'), 'sessions', s.n) order by s.n desc)
        from sess s left join public.profiles p on p.id = s.trainer_id), '[]'::jsonb),
    'revenue', coalesce((
      select jsonb_agg(jsonb_build_object('currency', cur, 'month', month, 'cents', cents) order by month, cur)
        from pays), '[]'::jsonb),
    'inbody', jsonb_build_object(
      'scanned_members', (select count(*) from ib),
      'repeat_members', (select count(*) from ib2),
      'avg_body_fat_change', case when (select count(d_bf) from ib2) >= 3
                               then round((select avg(d_bf) from ib2)::numeric, 1) end,
      'avg_muscle_change_kg', case when (select count(d_smm) from ib2) >= 3
                                then round((select avg(d_smm) from ib2)::numeric, 1) end,
      'avg_weight_change_kg', case when (select count(d_wt) from ib2) >= 3
                                then round((select avg(d_wt) from ib2)::numeric, 1) end,
      'min_group', 3)
  ) into v_out;

  return v_out;
end $fn$;

revoke all on function public.owner_studio_analytics(uuid, integer) from public, anon;
grant  execute on function public.owner_studio_analytics(uuid, integer) to authenticated;

comment on function public.owner_studio_analytics(uuid, integer) is
  'Studio analytics for the calling owner''s own gym (resolved from auth.uid(), re-checked with is_owner_of): active memberships, members training in the last 30 days, retention of memberships live at the window start, booked sessions per coach, gym_payments per currency per month, and InBody aggregates withheld below 3 members. Aggregates only; no member is named. Null for anyone who owns no gym.';
