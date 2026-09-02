-- ═══════════════════════════════════════════════════════════════════════════
-- How this coach coaches — asked once, changeable, and never guessed.
--
-- `clients.mode` (part 57) says how ONE client is coached, and it is the
-- coach's answer about that person. Nothing anywhere said how the COACH works.
-- The app therefore assumed in-person for everybody: a coach whose entire book
-- is remote still opened onto a calendar, an availability generator, session
-- blocking, classes, a rota, a gym-floor queue and walk-ins, and their revenue
-- was computed as "sessions × your session rate" — a figure that is not merely
-- inflated for somebody who sells packages and subscriptions, it is about a
-- business they do not run.
--
-- The roster can be READ for this, and is: a coach with one in-person client
-- is an in-person coach whatever they once declared. But the roster cannot
-- answer at signup, because a new coach has nobody on it, and "no in-person
-- clients" and "no clients" are different facts. So the coach is asked.
--
--
-- ── The two sources, and the rule that stops them fighting ─────────────────
--
-- Neither has priority. They agree by construction, and the rule is in
-- src/lib/coachDelivery.ts with its assertions in coachDelivery.test.ts:
--
--     THE DECLARED ANSWER SETS THE FLOOR. THE ROSTER MAY ONLY WIDEN IT.
--
--   · declared 'inperson' or 'hybrid'  →  nothing is ever put away.
--   · declared 'online', then a first in-person client arrives  →  the calendar
--     comes back on its own. Evidence widens; the coach is not asked again.
--   · declared 'online', book entirely remote  →  the in-person tools are
--     de-emphasised. Never removed, never unsearchable.
--   · NULL — skipped, or not yet read  →  behaves as the WIDEST answer. Hiding
--     a calendar from somebody who has simply not answered a question is the
--     one direction that loses a coach something they need.
--
-- NULL is therefore load-bearing and is not defaulted. A default of 'online'
-- would make every coach who has never been asked look like one who answered,
-- and would take the calendar away from all of them on the strength of a column
-- default. A default of 'inperson' would be the same lie pointing the other
-- way, and would make "have they answered?" unanswerable for the setup list.
--
--
-- ── Why this column and not a preference on the handset ────────────────────
--
-- It is a fact about the coach's business, not about the phone in their hand. A
-- coach who changes device, or reinstalls, must not be asked again and must not
-- silently revert to the widest answer with a book full of online clients.
-- `coachPrefsStore` is device storage and would do exactly that.
--
--
-- ── The grant, and part 152's door ────────────────────────────────────────
--
-- Part 152 revoked table-wide INSERT and UPDATE on `trainers` and granted back
-- a NAMED list, stating the reason in full: "a column added later is excluded
-- until somebody decides otherwise. A new column silently inheriting write
-- access is how this happened." Part 131 did the same on the read side.
--
-- So a column added here is unreadable and unwritable by `authenticated` until
-- this file says otherwise, and this file says so deliberately and narrowly:
--
--   SELECT  yes. The coach's own app reads it back on every launch, and it is
--           not a credential — it says nothing that the coach's own public
--           profile does not already imply.
--   UPDATE  yes, and this is the only door. src/ui/coachDelivery.ts writes it
--           with `.eq('id', uid)` under the `trainers_self` policy, which is
--           the same door the bio, the tagline and the session fee go through.
--           There is no RPC here because there is no rule for one to enforce:
--           the CHECK constraint below is the whole of the validation, and a
--           definer function wrapping a three-value enum would be ceremony.
--   INSERT  NO, deliberately. The trainer row is created at signup by a path
--           that has nothing to say about this, and the answer is collected
--           afterwards on Getting Started. An INSERT grant would add a second
--           way for the value to arrive and nothing would use it.
--
-- `anon` is granted nothing here. Parts 131 and 141 revoked it wholesale from
-- this table and this file only ever adds to `authenticated`.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.trainers add column if not exists delivery_mode text;

comment on column public.trainers.delivery_mode is
  'How this coach works: online | inperson | hybrid. NULL means they have not been asked or chose to skip, which is NOT a fourth answer and is NOT the same as ''online'' — the app treats NULL as the widest of the three and hides nothing. Deliberately has no DEFAULT: a default would make an unasked coach indistinguishable from one who answered. This is the FLOOR the app sets up from; the roster may widen it (a coach who declared online and takes an in-person client gets their calendar back) and may never narrow it. See src/lib/coachDelivery.ts.';

-- The three answers and nothing else. Written as a constraint rather than left
-- to the app because `clients.mode` was CHECK-constrained from the start and
-- part 57 is the account of what it cost to widen it late — the constraint is
-- what made that a decision rather than a discovery.
--
-- 'solo' is NOT among them. `CoachingMode` in src/lib/types.ts carries it for a
-- CLIENT who has no coach; a coach who coaches nobody in either mode is not a
-- fourth kind of coach, they are a coach who has not answered, which is NULL.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trainers'::regclass and conname = 'trainers_delivery_mode_check'
  ) then
    alter table public.trainers add constraint trainers_delivery_mode_check
      check (delivery_mode is null or delivery_mode in ('online', 'inperson', 'hybrid'));
  end if;
end $$;

-- Part 131 revoked table-wide SELECT and granted back a named list; part 152
-- did the same for UPDATE. Both lists are re-granted one column at a time, so
-- these two lines are additive and neither widens anything else.
grant select (delivery_mode) on public.trainers to authenticated;
grant update (delivery_mode) on public.trainers to authenticated;
