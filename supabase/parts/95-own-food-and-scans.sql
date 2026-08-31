-- A coach could never log their own meal or their own scan, and the reason was
-- a foreign key rather than a policy.
--
-- `workouts`, `measurements` and `check_ins` all key their owner to `profiles`,
-- so a coach's own training already worked. `food_logs.client_id` and
-- `scans.client_id` pointed at `clients` — the COACHING-RELATIONSHIP table —
-- and provision_profile() gives a trainer signup a `trainers` row and no
-- `clients` row at all. Live at the time of writing: six trainers and two
-- owners, not one of them with a `clients` row. So every meal and every scan a
-- coach tried to record was refused by a constraint violation, for every coach,
-- always.
--
-- RLS was never the blocker: `food_owner` and `scans_owner` are
-- `client_id = auth.uid()`, which a coach passes. `food_trainer_read` — a coach
-- reading their own client's log — is untouched and still scoped through
-- `clients.trainer_id`.
--
-- These rows are a PERSON's own record, not an artefact of being coached by
-- somebody, so they key to the person. Every `clients` row is also a `profiles`
-- row, so this only widens what is allowed and invalidates no existing row
-- (checked: 3 food rows, 6 scans, none would break). ON DELETE CASCADE is
-- preserved, and profiles cascades from auth.users, so deleting an account
-- still takes its food log and scans with it.
--
-- The column keeps the name `client_id` deliberately. Renaming it would touch
-- every read and write across three apps and two edge functions for no
-- behavioural gain, and the RLS policies that name it are the real contract.
alter table public.food_logs drop constraint if exists food_logs_client_id_fkey;
alter table public.food_logs add constraint food_logs_client_id_fkey
  foreign key (client_id) references public.profiles(id) on delete cascade;

alter table public.scans drop constraint if exists scans_client_id_fkey;
alter table public.scans add constraint scans_client_id_fkey
  foreign key (client_id) references public.profiles(id) on delete cascade;
