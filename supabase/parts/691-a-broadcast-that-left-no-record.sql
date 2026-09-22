-- ── A message to dozens of members, and nothing that says who got it ───────
--
-- /members can post to a segment. It writes one `announcements` row and, via
-- `notify_users`, one inbox row per named recipient. Thirty lines further down
-- the same screen writes a `gym_export_runs` row when a CSV of those same
-- members leaves the browser.
--
-- So taking the list out was audited and shouting at everybody on it was not.
--
-- What survives a broadcast today is the announcement: its body, its author,
-- its time. What does not survive is WHO IT WENT TO. `notify_users` returns a
-- count and inserts notification rows that point back at no announcement, so
-- there is no join in this schema from a notice to its recipients. "Who was
-- told about the closure?" and "was that member on the winback?" have no
-- answer, for the owner who sent it, the owner who inherits the gym, or
-- anybody answering for it afterwards.
--
-- ── Two halves, and only one of them can be a trigger ─────────────────────
--
-- Part 187 argues against console-written audit tables and it is right on every
-- point: a trigger cannot be forgotten by the next code path, cannot be skipped
-- from the phone, and cannot be forged by the party being audited.
--
-- So the half a trigger CAN see is a trigger. An insert into `announcements`
-- becomes a `notice-posted` gym event, with `actor_id` taken from the session
-- rather than from anything the caller states. That is "who posted, and when",
-- unforgeable, written by the data.
--
-- The recipient list is the half no trigger can see. It exists only in the
-- argument the console passed to `notify_users`, which stores it nowhere. It is
-- therefore written by the console, with the same caveat and the same
-- protections as `gym_export_runs`: insert-only, no update, no delete, narrow
-- enough that there is nothing in it worth forging.
--
-- ── Why the body is stored again ──────────────────────────────────────────
--
-- The announcement already holds it. It is copied here because the two rows
-- have different lifetimes: an announcement is a notice board entry an owner
-- may reasonably delete, and this row may not be deleted at all. A record that
-- says forty people were told something, and cannot say what, answers half of
-- the only question anybody asks it.
--
-- Additive and idempotent.

create table if not exists public.gym_broadcast_sends (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sent_at timestamptz not null default now(),
  -- `set null`: a member of staff leaving must not delete the record of what
  -- they sent. The row then says the account has gone, which is true and is a
  -- different sentence from "nobody sent it".
  sent_by uuid references public.profiles(id) on delete set null,

  -- The segment as the console named it, and the words it showed the sender.
  -- Both, because the id is what a later query groups by and the label is what
  -- the person actually read before they pressed the button.
  segment_id text not null,
  segment_label text not null,

  -- The half nothing else in this schema keeps. A plain uuid[] rather than a
  -- join table: nothing needs a recipient to be an object with its own
  -- history, and the question this answers is a set-membership one — "was this
  -- member on it". No foreign key, deliberately: these ids are a statement
  -- about who was addressed AT THE TIME, and it must stay true after somebody
  -- leaves the gym and their profile is deleted.
  member_ids uuid[] not null default '{}',
  recipients integer not null check (recipients >= 0),
  -- What notify_users reported writing. NULL is UNKNOWN — the RPC answered in a
  -- shape the console does not understand, or failed after the notice had
  -- already posted — and is stored as null rather than rounded up to
  -- `recipients`, which is the one lie this table must not tell.
  delivered integer check (delivered is null or delivered >= 0),

  body text not null check (length(btrim(body)) between 1 and 4000)
);

create index if not exists idx_gym_broadcast_sends_tenant
  on public.gym_broadcast_sends (tenant_id, sent_at desc);

-- "Was this member sent that?" — the question the recipient list exists for.
create index if not exists idx_gym_broadcast_sends_members
  on public.gym_broadcast_sends using gin (member_ids);

comment on table public.gym_broadcast_sends is
  'One row per message posted to a group of members from the console: who sent it, the words, the segment, and the member ids it was addressed to. The recipient list exists nowhere else — notify_users returns a count and writes inbox rows that point back at no announcement. Insert-only, like gym_export_runs: a record of a broadcast the sender can delete would be read, by its absence, as nothing having been sent.';

alter table public.gym_broadcast_sends enable row level security;

drop policy if exists gym_broadcast_sends_owner on public.gym_broadcast_sends;
create policy gym_broadcast_sends_owner on public.gym_broadcast_sends
  for all using (public.is_owner_of(tenant_id))
  with check (public.is_owner_of(tenant_id));

revoke all on public.gym_broadcast_sends from anon, authenticated, public;
grant select, insert on public.gym_broadcast_sends to authenticated;
grant all on public.gym_broadcast_sends to service_role;

-- No UPDATE and no DELETE for anybody, exactly as part 187 grants
-- gym_export_runs. The `for all` policy above would otherwise permit both.

-- ── the half that is written by the data ────────────────────────────────────

-- The closed set from part 187, re-declared whole and widened by one. A CHECK
-- constraint is replaced rather than added to, so dropping the old one without
-- restating every kind would silently make twenty of them illegal.
alter table public.gym_events drop constraint if exists gym_events_kind_check;
alter table public.gym_events add constraint gym_events_kind_check
  check (kind in (
    -- the five from part 105
    'member-joined', 'trainer-joined', 'session-delivered',
    'session-missed', 'promo-redeemed',
    -- money
    'payment-recorded', 'payment-corrected', 'invoice-raised',
    'price-changed', 'plan-retired',
    -- the membership itself
    'membership-cancelled', 'membership-frozen',
    -- pay
    'payroll-settled', 'payroll-reversed',
    -- the building
    'equipment-retired', 'equipment-out-of-service',
    -- the record
    'month-closed', 'month-reopened', 'record-exported',
    -- somebody's file was opened
    'document-opened',
    -- somebody was told something
    'notice-posted'
  ));

create or replace function public.gym_event_notice_posted()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  -- A coach's announcement has no tenant, and `log_gym_event` drops an event it
  -- cannot place in a gym rather than filing it where nobody can read it. That
  -- is what confines this to gym notices without a second condition here.
  perform public.log_gym_event(
    new.tenant_id, 'notice-posted', null,
    format('A notice was posted to the gym — %s',
           case when length(new.body) > 90 then left(new.body, 87) || '…' else new.body end));
  return new;
end $fn$;

drop trigger if exists trg_gym_event_notice_posted on public.announcements;
create trigger trg_gym_event_notice_posted
  after insert on public.announcements
  for each row execute function public.gym_event_notice_posted();
