-- ─────────────────────────────────────────────────────────────────────────
-- An enquiry that tells the coach it arrived.
--
-- ── What was silent, and how that was established ────────────────────────
--
-- Part 157 built the whole enquiry path: a public form, one narrow SECURITY
-- DEFINER writer `anon` may call, a `coach_leads` row with the join code that
-- brought the person in, and `app/(trainer)/leads.tsx` to work through them.
-- Part 211 extended it. Neither part carries a trigger and neither calls
-- `notify_users` — grep both files for either word and there is nothing.
--
-- So a `coach_leads` row is written by an UNAUTHENTICATED form and then sits
-- there until the coach happens to open the Leads screen. Nothing on the phone
-- knows it exists. `leads.tsx:19-25` already prints `FOLLOW_UP_IS_MANUAL` on
-- the screen, which is honest about the absent email channel; what it cannot
-- say is that the app is not even telling the coach there is something to
-- follow up.
--
-- An enquiry is a person who raised their hand, and at that moment they are
-- also enquiring with three other coaches. This is the one row in this table
-- whose value decays in hours.
--
-- ── Why a trigger, and not a push from the writer ────────────────────────
--
-- The writer is `record_coach_lead()` — SECURITY DEFINER, called by `anon` from
-- a marketing page. Two reasons the notification does not go in there.
--
-- The choke point argument parts 158 and 163 both make: a trigger on the table
-- cannot be forgotten by the next writer, and part 211 already added a second
-- path into this table once.
--
-- And the authorisation one, which is specific to this row. `notify_users()`
-- (part 122) authorises the RECIPIENT against the CALLER's identity, and the
-- caller here is `anon` — no `auth.uid()`, no relationship to the coach, no
-- basis on which that function would write anything. So this inserts into
-- `notifications` directly, exactly as part 146 does and for the same stated
-- reason: the recipient is established by the ROW rather than by the caller,
-- and `coach_leads.trainer_id` is a `not null references trainers(id)`, which
-- is itself `references profiles(id)`. The recipient is a real profile by
-- construction, which is the foreign key `notifications.user_id` needs.
--
-- ── The guards, each of which is a way this could refuse an enquiry ──────
--
-- This fires inside the transaction of a stranger submitting a form. An
-- exception here rolls back the INSERT, and the person who raised their hand is
-- told the form failed and does not fill it in twice.
--
--   `coach_leads.trainer_id`  NOT NULL, on delete cascade — it cannot be null
--                             and it cannot point at a missing trainer, so the
--                             recipient is safe by the schema rather than by a
--                             check here. Guarded anyway, because a check that
--                             costs one comparison is cheaper than an enquiry
--                             lost to a schema change nobody re-read this file
--                             after.
--   `coach_leads.name`        NOT NULL and length-constrained (part 157), but
--                             it is a string a STRANGER typed. Trimmed, and a
--                             blank one falls back to "Somebody" rather than
--                             rendering a sentence that starts with a space.
--
-- Deliberately NOT wrapped in `exception when others then null`, on part 158's
-- argument: that swallows a real defect silently and for ever, and the
-- reasoning above is the stronger guarantee.
--
-- ── What this must not say ───────────────────────────────────────────────
--
-- NOT THE CONTACT DETAILS, and not the message. `coach_leads.contact` is
-- whatever a stranger typed into a public form and `note` is free text from the
-- same place. A push notification is rendered on a lock screen, so putting
-- either in the body would show an unread phone number, or an unvetted
-- sentence, to whoever is standing next to the coach. The coach can read both
-- the moment they open the screen, which is one tap away and is where the
-- policy that entitles them to it is enforced.
--
-- The NAME is in the body, and it is the one field that has to be: "an enquiry
-- came in" is not a thing a coach can prioritise between, and the name is what
-- makes the notification worth opening rather than dismissing. It is also the
-- field that person typed in order to be called by it.
--
-- NOT THE JOIN CODE either. `via_code` is how the coach measures a channel and
-- it belongs on the screen that can match it against their own codes; in a
-- notification it is a string of letters that means nothing at arm's length.
--
-- ── And why nobody else is told ──────────────────────────────────────────
--
-- Part 160's test: the recipient must be able to act AND have no other way to
-- learn. The gym's owner fails the first half — an enquiry to a self-employed
-- coach through that coach's own join code is not the gym's to answer, and
-- `coach_leads` has no tenant column to address one by. The enquirer fails
-- both: they have no account, which is the whole premise of the table.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.coach_lead_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_who  text;
  v_body text;
begin
  -- Schema-guaranteed today. Checked anyway: the cost is one comparison and the
  -- failure it prevents is a stranger being told their enquiry did not send.
  if new.trainer_id is null then
    return new;
  end if;

  -- A stranger's typing. Trimmed, and a blank falls back rather than producing
  -- a sentence with a hole at the front of it.
  v_who := nullif(btrim(coalesce(new.name, '')), '');

  v_body := coalesce(v_who, 'Somebody')
    || ' has enquired about training with you. They left their details on your enquiry form and have not been'
    || ' replied to. Open Leads to see what they asked for and how to reach them.';

  insert into public.notifications (user_id, title, body, icon, route)
  values (new.trainer_id, 'A new enquiry', left(v_body, 500), 'people', '/(trainer)/leads');

  return new;
end;
$function$;

comment on function public.coach_lead_notify() is
  'Tells the COACH the moment an enquiry lands on coach_leads. Carries the enquirer''s name and nothing else — not their contact details, not their message, not the join code — because a push is rendered on a lock screen. See part 470.';

drop trigger if exists coach_leads_notify on public.coach_leads;
create trigger coach_leads_notify
  after insert on public.coach_leads
  for each row execute function public.coach_lead_notify();

-- Revoked from public, anon AND authenticated. Postgres checks EXECUTE when a
-- trigger is CREATED and not when it fires, so a trigger function needs no
-- grant to anybody (parts 51, 141, 158, 163). Postgres grants EXECUTE to PUBLIC
-- on every new function and `anon` resolves through that grant, so both are
-- named — and `anon` is the role that actually reaches this table, which makes
-- the revoke here load-bearing rather than ceremonial.
revoke all on function public.coach_lead_notify() from public;
revoke all on function public.coach_lead_notify() from anon;
revoke all on function public.coach_lead_notify() from authenticated;
