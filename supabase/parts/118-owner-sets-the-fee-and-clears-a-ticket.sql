-- ─────────────────────────────────────────────────────────────────────────
-- Three things the owner console states about a gym that its owner has never
-- been able to state back: what a session is worth, what colour the gym is, and
-- whether a support ticket has been dealt with.
--
-- Two of them are the same fault. `session_fee` and `brand_color` are columns
-- with DEFAULTS, and every gym in the live database holds those defaults
-- unchanged — 75 of something, and the product's own teal. The screens spend
-- both as though an owner had chosen them. Part 99 wrote the sentence this part
-- applies twice: a default that silently applies LOOKS considered, which is the
-- worst kind of wrong figure to put in front of somebody making a decision on
-- it. The third is simpler — a button that wrote nothing at all.
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


-- ── 4 · A brand colour nobody picked ───────────────────────────────────────
--
-- Same fault as the session fee, one column along, and it only matters now
-- because something finally reads this column.
--
-- `tenants.brand_color` is `text default '#2dd4bf'` (part 01) — the teal the
-- default palette is drawn in. Nothing in three apps has ever written it and,
-- until this change, nothing had ever read it: the White-label Studio screen
-- set the theme accent, which is AsyncStorage on one phone, and the gym's own
-- row was never consulted. Checked live before writing this: 24 tenants, all 24
-- holding exactly the default, none holding anything else.
--
-- app/(owner)/brand.tsx now applies `brand_color` as the app's accent, so that
-- default stops being inert and starts being an instruction. Left as it is, the
-- first owner to open the screen would have their Studio app repainted teal —
-- over the amber every Studio build is drawn in (VARIANT_ACCENT in
-- src/lib/variant.ts) — on the authority of a colour nobody chose. A default
-- that silently applies LOOKS chosen; that is part 99's sentence and it is the
-- same one here.
--
-- So the default goes, and the rows still carrying it are cleared to NULL,
-- which is the answer that is actually true: this gym has not stated a colour.
-- The screen then says so and offers the ten palettes, and the first tap writes
-- a colour an owner picked — which every device that owner signs in on will
-- then agree about, which is the whole point of the column.
--
-- The date is in the statement for the reason part 101 gives: a bare
-- `where brand_color = '#2dd4bf'` re-run next year would silently un-choose
-- teal for every gym that had deliberately picked it. This claims only what was
-- already there, unchosen, on the day it was written.
alter table public.tenants alter column brand_color drop default;

update public.tenants set brand_color = null
 where brand_color = '#2dd4bf' and created_at < timestamptz '2026-09-01';

comment on column public.tenants.brand_color is
  'The gym''s accent colour, #rgb or #rrggbb. NULL means the gym has not chosen one — '
  'show the app''s own accent and ask, never a default dressed as a choice. '
  'Was DEFAULT ''#2dd4bf'' until part 118.';
