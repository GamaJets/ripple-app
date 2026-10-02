-- ═══════════════════════════════════════════════════════════════════════════
-- Three more from the same review as part 3390, and the first of them is the
-- interesting one: a grant written carefully, checked against the live
-- database, documented at length — and still not enforcing what its own header
-- claims. The other two are the coach's board finishing what part 3370 opened.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · A coach could still rewrite the question their client asked
-- ═════════════════════════════════════════════════════════════════════════
--
-- Part 3350's header says it plainly: "a coach may WRITE two columns and no
-- others". It does not hold, and the reason is worth keeping, because the part
-- that got it wrong got the hard half right.
--
-- A column grant is held by a ROLE. Part 3350 revoked table-wide UPDATE from
-- `authenticated` and granted back three columns:
--
--     grant update (note) on public.form_clips to authenticated;
--     grant update (coach_reply, coach_replied_at) ...
--
-- `note` is granted so the MEMBER can edit their own question, and the comment
-- beside it says "their `for all` policy from part 2617 is what keeps it to
-- their own row". That is true of the member. It says nothing about the coach,
-- who holds the identical column grant — every `authenticated` session does —
-- and whose own policy `form_clips_coach_reply` is `using (is_my_client(...))`
-- with no mention of columns, because a policy cannot mention columns.
--
-- So a coach could rewrite "does my knee cave on rep 4" into anything at all,
-- on a video of their client's body, with no record that it had been changed.
-- Nothing in the app does this. The point is that the database allowed it while
-- documenting that it did not.
--
-- ── Why a trigger and not more policy ────────────────────────────────────
--
-- The two mechanisms PostgreSQL offers each see half of what is needed. A
-- column grant knows the column and not the row; an RLS policy knows the row
-- and not the column. "This column, by this person only" is outside both, and a
-- BEFORE UPDATE trigger is the only place both facts are in scope at once.
--
-- `path` is frozen in the same breath. It was never granted to anybody but is
-- in the member's own `for all` policy, so they could repoint their own clip --
-- harmless on its own, and not something worth leaving reachable on a row that
-- also carries a coach's written answer.
create or replace function public.form_clips_freeze_members_own()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The member's row is the member's. They may edit their question; nobody
  -- else may, whatever grants their role happens to hold.
  if auth.uid() is distinct from old.user_id then
    if new.note is distinct from old.note then
      raise exception 'The question on a form check belongs to the person who asked it.'
        using errcode = '42501';
    end if;
    if new.path is distinct from old.path then
      raise exception 'A form check''s video cannot be repointed.'
        using errcode = '42501';
    end if;
    if new.user_id is distinct from old.user_id or new.set_id is distinct from old.set_id then
      raise exception 'A form check cannot be moved to another person or another set.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

revoke execute on function public.form_clips_freeze_members_own() from public, anon, authenticated;

drop trigger if exists form_clips_freeze_members_own on public.form_clips;
create trigger form_clips_freeze_members_own
  before update on public.form_clips
  for each row execute function public.form_clips_freeze_members_own();

comment on column public.form_clips.note is
  'The member''s own question about the set. Theirs to edit and nobody else''s: enforced by the trigger form_clips_freeze_members_own, because the column-level grant in part 3350 is held by the role and so by the coach too.';


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · A photo on a coach's own board had nowhere to go
-- ═════════════════════════════════════════════════════════════════════════
--
-- Part 3390 left this open on purpose and said why: the folder question had not
-- been decided. Deciding it — the first folder is the BOARD, which on a gym's
-- board is the tenant and on a coach's board is the coach.
--
-- That keeps the one property the original policy was built around: the first
-- folder names who the object belongs with and the second names who put it
-- there, so an object's own key is enough to decide both questions without
-- reading a single row.
--
-- A coach's client uploads under the coach's folder, which looks odd written
-- down and is right: it is the coach's board, it is the coach who answers for
-- what is on it, and `coach_board_can_read` is the same roster the posts use.
-- ── A folder name is text, and a uuid cast on text that is not one RAISES ──
--
-- `nullif(folder, '')::uuid` inside a policy looked fine and is not: an object
-- key whose first folder is not a uuid would abort the statement with 22P02
-- instead of failing the check, and PostgreSQL promises no evaluation order
-- that would stop it. A guarded helper is the whole of the fix — it returns
-- false for anything that is not a uuid, which is what a policy wants.
create or replace function public.coach_board_can_read_folder(f text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when f ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.coach_board_can_read(f::uuid)
    else false
  end;
$$;

revoke execute on function public.coach_board_can_read_folder(text) from public, anon;
grant  execute on function public.coach_board_can_read_folder(text) to authenticated;

drop policy if exists communitymedia_obj_insert on storage.objects;
create policy communitymedia_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'community-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
    and (
      -- A gym's board: the uploader's own tenant, exactly as before.
      (storage.foldername(name))[1] = (select public.my_tenant())::text
      -- Or a board belonging to a coach they are on the roster of — or their
      -- own, since `coach_board_can_read` admits the coach first.
      or public.coach_board_can_read_folder((storage.foldername(name))[1])
    )
  );

-- The read side needs the same second clause, or an uploader cannot see the
-- object they just put there until a post names it — which is the state the
-- composer is in between the upload and the insert.
drop policy if exists communitymedia_obj_read on storage.objects;
create policy communitymedia_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'community-media'
    and (
      exists (select 1 from public.community_posts p where p.image_path = objects.name)
      or ((storage.foldername(name))[2] = (select auth.uid())::text
          and (
            (storage.foldername(name))[1] = (select public.my_tenant())::text
            or public.coach_board_can_read_folder((storage.foldername(name))[1])
          ))
    )
  );

-- And the delete, which had the same shape and so the same gap: on a coach's
-- board nobody could take their own photo back down.
drop policy if exists communitymedia_obj_delete on storage.objects;
create policy communitymedia_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'community-media'
    and (
      -- Your own object, on either kind of board.
      ((storage.foldername(name))[2] = (select auth.uid())::text
       and (
         (storage.foldername(name))[1] = (select public.my_tenant())::text
         or public.coach_board_can_read_folder((storage.foldername(name))[1])
       ))
      -- Or you moderate the board it is on. A gym's staff, as before; and the
      -- coach whose board it is, which is the clause that was missing.
      or exists (select 1 from public.tenants t
                  where t.id::text = (storage.foldername(name))[1] and public.community_moderates(t.id))
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );
