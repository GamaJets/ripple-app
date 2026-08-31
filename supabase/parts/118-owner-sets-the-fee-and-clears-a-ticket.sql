-- ─────────────────────────────────────────────────────────────────────────
-- Two things the owner console asserts and the database will not let anybody
-- change: what a session is worth, and whether a support ticket is dealt with.
-- ─────────────────────────────────────────────────────────────────────────


-- ── 1 · A session fee nobody set ───────────────────────────────────────────
--
-- `tenants.session_fee` is `numeric(8,2) not null default 75` (part 01). Part
-- 99 already noted what that default is — "seventy-five of something" — and
-- stopped at the currency. This is the other half of the same sentence.
--
-- Checked against the live database before writing this: 31 tenants, and the
-- session fee is exactly 75.00 on ALL of them. Not one gym has ever set one.
-- The number is the schema's, and every owner screen spends it as though it
-- were the owner's:
--
--   • Overview prints "Payroll · 30d" as delivered sessions × 75;
--   • Revenue prints "Value / Client" and the hero's "…at your session fee";
--   • Trainers values one trainer's month at 75 a session.
--
-- Worse, the branch that would have caught it is unreachable. All three screens
-- carry a "set a session fee" fallback for `sessionFee == null`, and a NOT NULL
-- column with a default can never be null — so the honest sentence has never
-- been drawn on any device, and the invented one always has.
--
-- So the column becomes nullable and loses its default. NULL is then what a new
-- gym has until its owner says otherwise, the fallback copy becomes reachable,
-- and Ops now has the control it has been pointing at (app/(owner)/ops.tsx).
--
-- EXISTING ROWS ARE LEFT ALONE, deliberately, and this is the uncomfortable
-- half. All 31 of them hold a figure their owner did not choose. Nulling them
-- would be the honest reading — but `session_fee` is also what
-- src/lib/gymSessions.ts prices a delivered session at when the booking carries
-- no snapshotted rate, so blanking it would silently un-price historic sessions
-- in the trainer and client apps as well, and an owner who DID type 75 during
-- onboarding cannot be told apart from the 30 who did not. A wrong number that
-- an owner can now see and correct is recoverable; quietly voiding the pricing
-- basis of every gym on the platform on an OTA night is not.
--
-- Nothing inserts this column: provision_profile() (part 101) inserts (name,
-- brand) and relies on the default, which is exactly the path that must start
-- producing NULL.
alter table public.tenants alter column session_fee drop default;
alter table public.tenants alter column session_fee drop not null;

comment on column public.tenants.session_fee is
  'What one delivered session is worth, in tenants.currency, whole units. '
  'NULL means the gym has not set one — render a dash and ask, never assume. '
  'Was NOT NULL DEFAULT 75 until part 118; every row predating it carries that 75.';


-- ── 2 · Resolving a support ticket ─────────────────────────────────────────
--
-- The Ops support inbox is `feedback` rows (part 18) and it offers "Mark
-- Resolved". That button set a key in React state and wrote nothing: the ticket
-- came back on the next open, and the owner triaging twenty of them had triaged
-- none. An owner cannot tell a queue they have worked through from one they
-- have not, which makes the whole tab decorative.
--
-- Two columns rather than a boolean. WHEN it was resolved is the fact worth
-- keeping — a boolean answers "is it done" and nothing else, and the first
-- question anybody asks of a closed ticket is when — and NULL then carries
-- "still open" without a second column to disagree with it.
alter table public.feedback add column if not exists resolved_at timestamptz;
alter table public.feedback add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_feedback_open on public.feedback (created_at desc) where resolved_at is null;

comment on column public.feedback.resolved_at is
  'When an owner marked this dealt with. NULL is open. Set only through resolve_feedback().';


-- ── 3 · Why an RPC and not an UPDATE policy ────────────────────────────────
--
-- `feedback` has three SELECT policies and no UPDATE policy at all, which is
-- why the button could never have worked. The obvious repair is to mirror
-- `fb_owner` for update — and it is the wrong one, for the reason part 101 sets
-- out at length: RLS cannot restrict WHICH COLUMNS an update touches. An UPDATE
-- policy shaped like `fb_owner` would let any owner rewrite the BODY of any
-- tester's feedback, and the inbox's whole value is that the words in it are
-- the words the tester typed.
--
-- So: a SECURITY DEFINER function that can only ever write those two columns.
-- Its gate is `fb_owner` transcribed exactly — is_owner_of(tenant_id), OR the
-- caller is an owner at all — so this closes precisely the tickets the caller
-- can already read, and not one more. (That second arm is wide: it is the
-- platform-owner inbox that part 18 shipped, where feedback from every tenant
-- lands in one place. Widening it is not this part's business; matching it is.)
--
-- Returns the resolved_at it settled on, so the caller can check the write
-- rather than assume it. Zero rows touched comes back as a raised exception
-- rather than a quiet null, because "you may not close this" and "it is now
-- open again" are different answers and the app has to be able to tell them
-- apart.
create or replace function public.resolve_feedback(p_id uuid, p_resolved boolean default true)
returns timestamptz
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare n int; at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  update public.feedback f
     set resolved_at = case when p_resolved then now() else null end,
         resolved_by = case when p_resolved then auth.uid() else null end
   where f.id = p_id
     and (
       is_owner_of(f.tenant_id)
       or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner')
     )
   returning f.resolved_at into at;
  get diagnostics n = row_count;

  if n = 0 then
    raise exception 'That ticket is not yours to close.' using errcode = '42501';
  end if;
  return at;
end $$;

-- PUBLIC *and* anon. Part 101's note — that revoking from anon alone does
-- nothing, because Postgres grants EXECUTE to PUBLIC on every new function and
-- that is the grant anon resolves through — is right and is only half of it on
-- this project: checked live, `alter default privileges` here also hands anon
-- its OWN explicit grant, so revoking from PUBLIC alone leaves
-- `has_function_privilege('anon', …)` true. Both have to go. (The function
-- refuses a caller with no auth.uid() regardless; this is so the grant says the
-- same thing the body does.)
revoke execute on function public.resolve_feedback(uuid, boolean) from public;
revoke execute on function public.resolve_feedback(uuid, boolean) from anon;
grant execute on function public.resolve_feedback(uuid, boolean) to authenticated;
