-- ═══════════════════════════════════════════════════════════════════════════
-- The attendance write that matched no row, and could not say so
-- ═══════════════════════════════════════════════════════════════════════════
--
-- UNAPPLIED at the time of writing. Nothing in this part has been run against
-- the live database; it is here to be applied, and the app does not depend on
-- it having been. See "what the app does until this is applied" at the bottom.
--
-- ── the fault ─────────────────────────────────────────────────────────────
--
-- `set_class_attendance` is `returns void`, and after part 460's guard its last
-- statement is a bare update:
--
--     update class_bookings
--        set attended_at = case when p_present then now() else null end
--      where class_id = p_class and user_id = p_user;
--
-- An UPDATE that matches no row is not an error in Postgres. It succeeds,
-- having changed nothing, and a `void` function has no way to mention it. The
-- caller gets `{ data: null, error: null }` — which is the same answer it gets
-- for a tick that really landed.
--
-- src/ui/floorQueue.ts then did this, and the comment above it was wrong:
--
--     // An RPC, so there are no rows to count — the function either ran or it
--     // did not. `rows: 1` tells classifyWrite to judge on the error alone.
--     const { error } = await supabase.rpc('set_class_attendance', {…});
--     return classifyWrite(error as never, 1);
--
-- `rows: 1` is an assertion that a row was touched, made by the one party that
-- cannot see whether one was. `classifyWrite`'s own header sets out the general
-- shape of this — "a write PostgREST narrows to zero rows under RLS does not
-- fail: it succeeds, having done nothing" — and the same thing arrives here
-- through an RPC instead, where there is not even a row count to ask for.
--
-- ── how the row goes missing, which is not exotic ──────────────────────────
--
-- `cancel_class` DELETES the booking row. app/(trainer)/class-checkin.tsx reads
-- its roster when the screen opens and the room fills up afterwards. A member
-- cancels at 06:58 on their own phone; the coach, holding a register read at
-- 06:50, ticks them in at 07:01. The update matches nothing, the RPC returns
-- void, the phone is told 'stored'.
--
-- Everything downstream then states it. The row moves to ticked. `saveFailed`
-- clears. `registerVisibilityLine` prints the calm sentence — the gym owner sees
-- this attendance for payroll and class analytics — and it is false about this
-- member. The class reaches `class_attendance_summary` with one fewer attendee
-- than the coach counted in the room, and `classPayAmount` in src/lib/gymPay.ts
-- settles per-attendee pay from that. The coach is paid for somebody they
-- checked in, and there is no record anywhere that the tick was ever made.
--
-- ── the change ────────────────────────────────────────────────────────────
--
-- The function reports whether it matched. `true` means the booking was there
-- and now carries the coach's answer; `false` means there was no such booking to
-- mark, which is a real answer and not a failure — the member cancelled, or was
-- never on this class.
--
-- Nothing else about the function moves. The guard is part 460's, character for
-- character, including the `raise exception` whose message the phone shows the
-- coach; widening or narrowing who may take a register is not what this part is
-- about and would be a change nobody reading this diff came for.
--
-- The return type changes, so `create or replace` cannot be used — Postgres
-- refuses to change a function's return type in place — and the function is
-- dropped and recreated. That is the same move part 460 made on
-- `class_attendance_summary` for the same reason. `false` is returned rather
-- than a row count because the caller has exactly one question and a count of
-- rows invites a second, wrong one: `class_bookings` is unique on
-- (class_id, user_id), so the count can only ever be 0 or 1.
--
-- A dropped function loses its grants, so they are restated. The REVOKE is not
-- decoration: `create function` in a Supabase project leaves EXECUTE with
-- PUBLIC, which includes `anon` — the failure part 1901 shipped and part 2050
-- swept up. Run get_advisors after applying this.
--
-- ── what the app does until this is applied ───────────────────────────────
--
-- It proves the write itself, by reading the register back: after a successful
-- RPC, `class_roster` is asked whether that member is still on the class, and a
-- member who is not there is a write that matched nothing. That is sound because
-- part 2320 made `class_roster`'s guard identical to this function's, so the read
-- answers about exactly the rows the write was allowed to touch.
--
-- src/ui/floorQueue.ts prefers THIS function's answer when there is one — it
-- takes a boolean over the read — so applying this part costs the register one
-- round trip per tick and changes nothing else. Until then `data` comes back
-- null, which is the void function answering, and null is not evidence.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.set_class_attendance(uuid, uuid, boolean);

create function public.set_class_attendance(p_class uuid, p_user uuid, p_present boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rows int;
begin
  -- Part 460's guard, unchanged. Two arms, deliberately: the gym's staff,
  -- matching class_bookings_staff_u from part 165 line for line so the phone and
  -- the console cannot disagree about who may take a register; and the class's
  -- own trainer, kept because an independent coach has no tenant and would
  -- otherwise be locked out of their own class by a tenant-scoped guard.
  if not exists (
    select 1 from gym_classes gc
    where gc.id = p_class
      and ( ( gc.tenant_id is not null
              and gc.tenant_id = my_tenant()
              and my_role() in ('trainer', 'owner') )
            or gc.trainer_id = auth.uid() )
  ) then
    -- The message is what the phone shows the coach, so it says which of the
    -- two things is wrong rather than repeating a possessive that is no longer
    -- the test. `refusedLine` in src/lib/floorQueue.ts puts it beside "was not
    -- saved and is not waiting to send".
    raise exception 'this class is not yours to register';
  end if;

  update class_bookings
     set attended_at = case when p_present then now() else null end
   where class_id = p_class and user_id = p_user;

  -- The whole point of this part. Zero rows means there is no booking to mark —
  -- the member cancelled, and `cancel_class` deletes the row — which is an
  -- answer the caller has to be given rather than a silence it reads as success.
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $function$;

-- Dropped above, so every grant on it went with it. `create function` leaves
-- EXECUTE with PUBLIC, which in a Supabase project includes anon.
revoke all on function public.set_class_attendance(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_class_attendance(uuid, uuid, boolean) to authenticated;
