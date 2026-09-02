-- ─────────────────────────────────────────────────────────────────────────
-- The door asked nothing about the person.
--
-- `checkIn` in src/lib/gymVisits.ts was a bare insert. It read nothing, so a
-- membership cancelled in March admitted its holder with one click in June, and
-- one card could badge in an unlimited queue behind it. That check now happens
-- in the library — `admissionCheck`, with a staff override that has to say why
-- — and this part is the half of it the database has to hold.
--
-- ── Why the database needs a share of it at all ──────────────────────────
--
-- Because the console is not the only writer and never will be. `gym_visits`
-- takes `source in ('desk','qr','door','app','manual')`: a turnstile, a QR
-- reader and the member's own phone are all in the table's own vocabulary, and
-- none of them will call a TypeScript function. A rule that lives only in the
-- console is a rule the first terminal integration walks straight through.
--
-- ── What is guarded, and what deliberately is not ────────────────────────
--
-- The DUPLICATE, not the membership. A second open visit for a member who
-- already has one is wrong under every business model a gym could have: it puts
-- the same person into the fire-evacuation headcount twice, which is the one
-- number on the Door screen somebody could be hurt by. Whether a lapsed member
-- may train is a decision the gym makes, it changes, and the console states it
-- with a reason the desk can read — that belongs in the library, not in a
-- constraint that would refuse the owner's own decision at 6am with a Postgres
-- error code.
--
-- ── Why a trigger and not a unique index ─────────────────────────────────
--
-- A partial unique index on (tenant_id, member_id) where exited_at is null is
-- the stronger guard and cannot be created: gyms already carry open duplicates,
-- and the only ways to clear them are to delete a visit — destroying the record
-- of an arrival — or to stamp an exit time nobody observed. This codebase
-- refuses to invent an exit (see `sweepStaleVisits`, which writes a note and
-- leaves `exited_at` null precisely so a twenty-hour stay never enters the dwell
-- average), so the guard has to be one that can be added to a table with
-- history in it. The trigger reads committed rows, so two desks scanning the
-- same member in the same instant can still both get through; seconds apart —
-- the queue, the double press, the tablet retrying — is what actually happens
-- and is what this stops.
--
-- ── The stale-visit escape ───────────────────────────────────────────────
--
-- Only an open visit from the last twelve hours blocks. The same twelve hours
-- `sweepStaleVisits` uses: nobody trains for twelve hours, and a 6am regular is
-- not back until 6am tomorrow. Past that an open visit is a row nobody closed,
-- and refusing today's arrival over last Tuesday's paperwork would lock a
-- paying member out of the building.
--
-- ── The override ─────────────────────────────────────────────────────────
--
-- A note beginning `admitted anyway: ` is a member of staff who has been shown
-- the refusal and typed a reason. It passes. That is not a hole in the guard,
-- it is the guard's purpose: the alternative to an auditable override is a desk
-- that stops recording visits, and the door log is what attendance, fill rate
-- and every retention figure in the product are built on.
--
-- The prefix must stay byte-identical to OVERRIDE_PREFIX in
-- src/lib/gymVisits.ts. Two spellings and the console would believe it had
-- recorded a visit the database refused.
--
-- Additive only. Nothing here alters an existing table or policy, and nothing
-- here widens who can read or write anything.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function gym_visits_no_double_entry() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  open_at timestamptz;
begin
  -- An anonymous head-count is not a duplicate of anything. Two turnstile
  -- counts with no member id are two different people, and collapsing them
  -- would under-count the evacuation list instead — the same fault pointing
  -- the other way.
  if new.member_id is null then
    return new;
  end if;

  -- Staff have been shown the refusal and said why. Let it through, with their
  -- sentence on the row.
  if new.note is not null and new.note like 'admitted anyway: %' then
    return new;
  end if;

  -- A row being inserted with an exit already on it is a correction or an
  -- import, not somebody walking in. It cannot be a second body in the room.
  if new.exited_at is not null then
    return new;
  end if;

  select v.entered_at into open_at
    from gym_visits v
   where v.tenant_id = new.tenant_id
     and v.member_id = new.member_id
     and v.exited_at is null
     and v.entered_at > coalesce(new.entered_at, now()) - interval '12 hours'
     and v.id is distinct from new.id
   order by v.entered_at desc
   limit 1;

  if open_at is not null then
    -- The message reaches a receptionist with somebody standing in front of
    -- them, so it says what happened and what to do about it rather than
    -- naming a constraint.
    raise exception
      'That member is already checked in (at %) and has not been checked out. Check them out first, or record the visit with a reason.',
      to_char(open_at, 'HH24:MI')
      using errcode = 'unique_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_gym_visits_no_double_entry on gym_visits;
create trigger trg_gym_visits_no_double_entry
  before insert on gym_visits
  for each row execute function gym_visits_no_double_entry();

-- The lookup the trigger does on every arrival. Partial, because the only rows
-- it ever reads are the open ones, and on a busy gym those are a handful out of
-- years of log.
create index if not exists idx_gym_visits_open_member
  on gym_visits(tenant_id, member_id, entered_at desc)
  where exited_at is null and member_id is not null;
