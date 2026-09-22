-- ── A gym can finally say what a late cancellation costs ────────────────────
--
-- src/lib/classCancel.ts has been carrying this in its header since it was
-- written:
--
--     this app does not hold a gym's class cancellation policy. There is no
--     column for it, no screen where an owner sets one, and inventing "24
--     hours" here would be worse than the silence — a member told they are
--     inside a window their gym does not run is being given a fact this app
--     made up.
--
-- So the confirmation says the two true things — how long until the class
-- starts, and that the charge is the gym's decision and not one this app can
-- see. That was the right answer while there was no column. This part is the
-- column.
--
-- ── Nullable, and never defaulted ───────────────────────────────────────────
--
-- Both columns are nullable with NO default, and that is the whole design.
--
--   NULL          the gym has not told us. The member keeps getting
--                 CLASS_POLICY_UNKNOWN_NOTE, which is honest.
--   hours = 0     "we do not charge for late cancellations" — a real policy a
--                 gym can state, and a different fact from not having said.
--   fee = 0       the same statement about money, stated.
--
-- A `default 24` here would have been the exact fabrication that file refuses,
-- applied to every gym on the platform at once, and every member would have
-- been told a notice period their gym has never run. `default 0` is no better
-- in the other direction: it tells a member a late cancellation is free, over a
-- gym that charges for it, which is the more expensive lie of the two.
--
-- ── The fee has no currency of its own ──────────────────────────────────────
--
-- `tenants.currency` is the unit, the same one `session_fee` beside it is in.
-- A second currency column here would be a second place for a gym's unit to be
-- recorded and therefore a second place for it to disagree with itself, which
-- is the rule the whole money layer is built on. A fee recorded against a
-- tenant with no currency is a number nothing may render — the client library
-- withholds the amount and keeps the sentence, rather than picking a symbol.
--
-- ── Why a function rather than letting the member read `tenants` ────────────
--
-- `tenants_client_r` lets a client read their gym's row, but it reaches them
-- through `coach_clients` → `trainers` → `staff_tenant_of`. A gym member who
-- books classes and has no coach does not match it, and that is most of the
-- people this sentence is for. The alternatives were both worse:
--
--   · widening `tenants_client_r` to include anybody with a membership would
--     hand every class-booking member the whole tenant row — pay policy, tax
--     registration, retention period — to answer one question about one class.
--   · putting the policy on `gym_classes` would copy a gym-wide fact onto
--     every class row, where it would go stale the first time an owner changed
--     it and nothing would say which copy was right.
--
-- So: one SECURITY DEFINER function returning three fields and nothing else,
-- with its own authorisation predicate written out below — a booking of the
-- caller's on that class, or a membership of theirs at that gym. It answers the
-- question at the moment it is asked and discloses nothing that is not already
-- on the confirmation.

-- `alter table public.tenants`, not `alter table if exists tenants`, which is
-- the form part 710 uses for the column beside these. It is not only style:
-- scripts/check-schema.mjs reads `alter table <name>` to learn which columns the
-- repo declares, and `if exists` puts the word "if" where it expects the table,
-- so a column added that way is invisible to the gate and is reported as named
-- by the app and declared nowhere.
alter table public.tenants add column if not exists class_cancel_hours integer;
alter table public.tenants add column if not exists class_cancel_fee numeric(8,2);

comment on column tenants.class_cancel_hours is
  'Hours of notice before a class starts, inside which the gym may charge. NULL means the gym has not stated a policy and the app must say so; 0 is a stated policy of no notice period.';
comment on column tenants.class_cancel_fee is
  'What the gym charges for a late cancellation, in tenants.currency. NULL means unstated; 0 is a stated policy of no charge.';

-- Negative values are not a policy, they are a typo that would print as
-- "starts in -3 hours" or a credit. Checked rather than trusted, and written so
-- an existing row with NULLs is unaffected.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_class_cancel_hours_check') then
    alter table tenants add constraint tenants_class_cancel_hours_check
      check (class_cancel_hours is null or (class_cancel_hours >= 0 and class_cancel_hours <= 336));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_class_cancel_fee_check') then
    alter table tenants add constraint tenants_class_cancel_fee_check
      check (class_cancel_fee is null or class_cancel_fee >= 0);
  end if;
end $$;

/**
 * The cancellation policy for ONE class, for somebody who can see that class.
 *
 * Returns exactly one row, always — including for a gym that has stated
 * nothing, where every field is null and the caller keeps the "we do not hold
 * your gym's policy" sentence. No row at all would be indistinguishable from a
 * failed read at the client, which is the distinction src/lib/classCancel.ts
 * is being extended to draw.
 *
 * ── The authorisation is written out, because DEFINER means it has to be ────
 *
 * A first draft of this function checked `exists (select 1 from gym_classes
 * where id = p_class)` and called that the authorisation. It is not. A
 * SECURITY DEFINER function runs as its owner, so RLS on `gym_classes` does
 * not apply inside it — that predicate proves only that the row exists, and
 * the function would have handed any signed-in person any gym's fee by
 * guessing class ids. This is the trap DEFINER always sets and the reason
 * every definer function in this tree states its own predicate.
 *
 * Two ways in, and they are the two honest reasons to be asking:
 *
 *   · a booking of the caller's own on that class — the cancel confirmation,
 *     which is what this was built for. `status` is not filtered: somebody
 *     looking at a booking they have already cancelled is still entitled to
 *     know what it cost them.
 *   · a membership of the caller's at that class's gym — so the policy can
 *     also be shown BEFORE booking, to a member who has not booked yet.
 *
 * Anybody else gets no row, which the client reads as "could not be read"
 * rather than as "no policy" — see `classCancelBody`.
 */
create or replace function public.class_cancel_policy(p_class uuid)
returns table (notice_hours integer, fee numeric, currency text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.class_cancel_hours, t.class_cancel_fee, t.currency
    from gym_classes c
    join tenants t on t.id = c.tenant_id
   where c.id = p_class
     and (
       exists (
         select 1 from class_bookings b
          where b.class_id = c.id
            and b.user_id = (select auth.uid())
       )
       or exists (
         select 1 from memberships m
          where m.tenant_id = c.tenant_id
            and m.member_id = (select auth.uid())
       )
     )
   limit 1;
$$;

-- Granted to signed-in callers only. A definer function is created owned by the
-- definer and granted to PUBLIC — which includes anon — so the revoke is not
-- tidiness, it is the difference between "members can read their gym's class
-- fee" and "the internet can".
revoke all on function public.class_cancel_policy(uuid) from public;
revoke all on function public.class_cancel_policy(uuid) from anon;
grant execute on function public.class_cancel_policy(uuid) to authenticated;
