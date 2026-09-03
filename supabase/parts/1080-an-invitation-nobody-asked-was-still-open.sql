-- ═══════════════════════════════════════════════════════════════════════════
-- An invitation nobody asked was still open.
--
-- The sweep of the `authenticated`-executable SECURITY DEFINER functions whose
-- argument names an OBJECT rather than a principal found this class in two
-- functions, and they are the same defect twice: an invite is looked up by the
-- id the caller supplies, the caller's EMAIL is checked against it, and the
-- invite's own `status` — the column that says whether the invitation is still
-- an invitation — is never read at all.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- `accept_trainer_invite(p_invite)` and `accept_invite(p_invite)` both do
-- exactly three things before they write: find the row, compare
-- `lower(inv.email)` with the caller's address on `auth.users`, and act. There
-- is no fourth thing. An invite that has already been accepted is accepted
-- again. An invite the owner REVOKED is accepted as though it were live.
--
-- That the revoked state is real, and not something this file has invented, is
-- already written into both tables:
--
--     coach_invites_status_check    CHECK (status IN ('pending','accepted','revoked'))
--     trainer_invites_status_check  CHECK (status IN ('pending','accepted','revoked'))
--
-- The schema has always named three states. The accept path has only ever
-- distinguished one thing, and it was not the state — it was the address.
--
-- The neighbouring function shows what the shape was meant to be.
-- `accept_member_invite()` (part 37), on the same screen family, against the
-- same kind of row, refuses an invite that is `accepted`, refuses one that is
-- `revoked`, refuses one past `expires_at`, and refuses a role that has no
-- business taking it. Two of its three siblings do none of that.
--
-- ── WHAT SOMEBODY COULD DO WITH ONE UUID ─────────────────────────────────
--
-- The uuid is not a secret and was never treated as one: it is the id the
-- acceptance screen passes straight through as `p_invite`, so it reaches the
-- invitee's own device the moment they are invited. The other half of the test
-- is control of the invited email address, which the invitee has by
-- construction. Both halves are permanently in the hands of the person the
-- check is supposed to be aimed at.
--
-- On `accept_trainer_invite` that is staff reinstatement, and it defeats the
-- one function in this schema written to prevent exactly it.
--
-- `revoke_staff_role()` (part 711) is a careful, expensive removal. It refuses
-- outright while the coach still has a single client on their book, with a
-- message explaining that ending staff access would NOT end their read of those
-- people's training and health record. Only once the owner has unpicked the
-- whole book does it do the removal, and its own comment states what the
-- removal IS:
--
--     "Clearing the tenant is what actually removes the access: every staff
--      policy in this schema is `tenant_id = my_tenant()` and `my_tenant()` is
--      now null"
--
-- `update public.profiles set tenant_id = null where id = p_subject`. That is
-- the whole of it. And `accept_trainer_invite` writes that column straight back:
--
--     update profiles set role = 'trainer', tenant_id = coalesce(ten, tenant_id)
--
-- So a coach an owner has removed from their gym — after the owner did the work
-- of reassigning or ending every coaching relationship first — replays the
-- invite they were originally sent and is staff again. Their `trainers` row was
-- deliberately kept by part 711 and is waiting for them; the upsert below it
-- re-points it at the tenant; `trainer_billing` gets a fresh trial. Every staff
-- policy that reads `tenant_id = my_tenant()` opens: the gym's members, its
-- classes, its documents, its roster. Nothing in the gym says it happened,
-- because `staff_grants` is only written by `grant_staff_role()` and
-- `revoke_staff_role()`, and this path is neither.
--
-- It is not once, either. There is no expiry column on `trainer_invites` at
-- all, so the invite is a permanent key: the owner may revoke the staff role
-- again and again and the same call puts it back every time.
--
-- On `accept_invite` the same replay resurrects a coaching relationship.
-- `end_coaching()` (part 68) sets `coaching_relationships.status = 'ended'` and
-- `clients.trainer_id = null`, and either side may call it. `accept_invite`
-- calls `link_coaching()`, whose `on conflict ... do update set status =
-- 'active'` and `update clients set trainer_id = p_coach` undo precisely those
-- two writes. `link_coaching` itself is not at fault and is not touched here —
-- its authorisation test passes honestly, because `auth.uid() = p_client` is
-- true; the caller really is the client. What is false is the premise it was
-- handed, that a live invitation was being accepted.
--
-- The result is that a coach who ended a relationship — the person who wanted
-- distance from a client, which is the case that matters — cannot keep it.
-- The former client puts themselves back on that coach's book, and back into
-- the coach's messaging thread, with one call the coach cannot see coming.
--
-- Part 1062's header lists `accept_trainer_invite()` among the SECURITY DEFINER
-- functions that "pass untouched" through its tenant guard because they have
-- "already done its own checking". That is the assumption this file corrects.
-- It had done one check, and the one it had done was not this one.
--
-- ── WHY THE FIX IS SHAPED THIS WAY ───────────────────────────────────────
--
-- One test per function, on the column that already exists, in the place the
-- other checks already stand. What the test DOES is different for the two
-- states, and the difference is the whole of the design here.
--
--   status = 'accepted'  → return, having written nothing.
--   anything not 'pending' → raise.
--
-- The temptation is to raise on both, which is what `accept_member_invite()`
-- does. Reading the two accept screens says not to. src/ui/invites.tsx:290 and
-- src/ui/trainerInvites.tsx:224 both treat ANY error from the RPC as a failed
-- acceptance: they put the invitation back in the list and, in invites.tsx,
-- push the id into `acceptFailed`. That behaviour is deliberate and correct —
-- its comment explains that dismissing a failed accept "makes a failure here
-- permanent" and loses the client "the only route to their coach".
--
-- But it means an accept whose RESPONSE was lost — committed on the server,
-- never seen by the phone — leaves the invitation on screen. Today the retry
-- silently succeeds. If this file raised on 'accepted', that retry would fail,
-- and would keep failing every time, for ever: an invitation that has already
-- worked, permanently displayed as broken, with no way out from the phone.
--
-- So 'accepted' returns quietly. The end state the caller is asking for already
-- holds, there is nothing to do, and a void function that has nothing to do has
-- an honest way of saying so. Crucially this is NOT the old behaviour under a
-- different name: the old code re-ran every write, and it is the WRITES that
-- were the hole. Returning early performs none of them, so a revoked coach
-- replaying their accepted invite gets a successful no-op and stays off the
-- staff, which is the correct outcome for both questions at once.
--
-- 'revoked' raises, because there the end state does NOT hold and never will.
-- Telling the caller their invitation was withdrawn is the only answer that
-- does not leave them believing they have joined something they have not. The
-- wording is `accept_member_invite()`'s, copied. This is not a case where the
-- two states must be made indistinguishable to avoid leaking: the caller has
-- already proved they control the invited address before either branch can be
-- reached, so both facts are about an invitation that is genuinely theirs.
--
-- Tested as "not pending" rather than as "= revoked", so any fourth state the
-- CHECK constraint gains later fails closed instead of falling through to the
-- writes.
--
-- The explicit `auth.uid() is null` guard is added to both. Today the email
-- comparison happens to refuse a signed-out caller — `lower(inv.email) <>
-- lower('')` is true, so it falls into 'invite not addressed to you' — but that
-- is an accident of a comparison written for a different purpose, and a
-- security check that works by coincidence is one edit away from not working.
-- `accept_member_invite()` states it outright; so do these now.
--
-- WHAT IS DELIBERATELY NOT DONE HERE:
--
--   · No expiry. `trainer_invites` and `coach_invites` have no `expires_at`
--     column, and adding one is a schema change that would retroactively
--     expire live invitations on a rule nobody was told about. That is a
--     product decision about how long an invitation lasts, not a hole, and it
--     does not belong in a security part. The status check makes every invite
--     single-use, which is the property that was actually missing.
--
--   · No role guards on `accept_trainer_invite`. `accept_member_invite()`
--     refuses an owner and refuses to move a trainer between gyms; this one
--     does neither. But that path requires an owner to have deliberately typed
--     that address into an invitation, which is a consented act by the person
--     whose gym it is — a different question from a stale invite replaying
--     itself, and one that should be decided on its own evidence rather than
--     smuggled in here.
--
-- Both functions are re-emitted from `pg_get_functiondef` taken verbatim on
-- 3 Sep 2026, with the guards added and nothing else altered. The signatures
-- are character-for-character the live ones: an overload is not cosmetic here,
-- it is PostgREST resolving `accept_invite` against two candidates and refusing
-- the call entirely, which is what part 188 had to undo.
--
-- Idempotent and safe to re-run: `create or replace function` replaces a body
-- in place, and re-running this file a second time produces the same two
-- bodies. It reads no rows and writes no data.
--
-- Checked against the live project before writing: the only invitation that
-- exists in either table is a single `trainer_invites` row with status
-- 'pending', so this refuses nothing that anybody is currently holding.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.accept_trainer_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare inv trainer_invites; my_email text; ten uuid;
begin
  -- Stated rather than left to the email comparison below. See the header: a
  -- signed-out caller is refused today only because `lower(inv.email) <>
  -- lower('')` happens to be true.
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select email into my_email from auth.users where id = auth.uid();
  select * into inv from trainer_invites where id = p_invite;
  if inv.id is null then raise exception 'invite not found'; end if;
  if lower(inv.email) <> lower(coalesce(my_email, '')) then
    raise exception 'invite not addressed to you';
  end if;

  -- THE CHECK THAT WAS MISSING. Without it this function is a permanent key to
  -- a gym's staff surface, held by whoever was ever invited to it: an invite
  -- that has been accepted, or that the owner has since withdrawn, is accepted
  -- again and writes `profiles.tenant_id` back — which is the single column
  -- `revoke_staff_role()` clears to remove somebody from the staff.
  --
  -- An already-accepted invite RETURNS rather than raising, and the writes
  -- below are what it is declining to repeat. See the header: the accept screen
  -- re-queues on any error, so raising here would trap a lost-response retry in
  -- a permanent failure loop — while returning early re-grants nothing, which
  -- is what actually closes the hole.
  if inv.status = 'accepted' then
    return;
  elsif inv.status <> 'pending' then
    raise exception 'invite was withdrawn';
  end if;

  ten := coalesce(inv.tenant_id, (select tenant_id from profiles where id = inv.owner_id));
  update profiles set role = 'trainer', tenant_id = coalesce(ten, tenant_id) where id = auth.uid();
  if ten is not null then
    insert into trainers (id, tenant_id) values (auth.uid(), ten)
      on conflict (id) do update set tenant_id = excluded.tenant_id;
    insert into trainer_billing (trainer_id, tenant_id, plan, mrr, status)
      values (auth.uid(), ten, 'Pro', 0, 'trial')
      on conflict (trainer_id) do nothing;
  end if;
  update trainer_invites
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = p_invite;
end $function$;

create or replace function public.accept_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare inv coach_invites; my_email text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select email into my_email from auth.users where id = auth.uid();
  select * into inv from coach_invites where id = p_invite;
  if inv.id is null then raise exception 'invite not found'; end if;
  if lower(inv.email) <> lower(coalesce(my_email, '')) then
    raise exception 'invite not addressed to you';
  end if;

  -- The same missing check, one level down, and the same two answers.
  -- `link_coaching()` below sets the relationship back to 'active' and
  -- re-points `clients.trainer_id`, which are exactly the two writes
  -- `end_coaching()` undoes — so without this a former client replays an old
  -- invitation and puts themselves back on a coach's book after that coach
  -- ended the relationship. Returning early is what declines to re-link.
  if inv.status = 'accepted' then
    return;
  elsif inv.status <> 'pending' then
    raise exception 'invite was withdrawn';
  end if;

  perform link_coaching(inv.coach_id, auth.uid(), inv.mode);
  update coach_invites
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = p_invite;
end $function$;
