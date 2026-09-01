-- Two things a member records about their body that the schema cannot hold.
--
-- ── 1. A progress photo has no pose ────────────────────────────────────────
--
-- `progress_photos` holds taken_at, image_path, weight_kg and body_fat_pct, and
-- nothing about WHICH SHOT it is. So Compare — src/lib/photoCompare.ts, which
-- pairs the oldest and newest photo in a window — will happily put a front shot
-- beside a side shot and present the difference between them as progress. It is
-- the one comparison on the screen and it can be a comparison of two different
-- views of the same unchanged body.
--
-- A member cannot fix that from inside the app either, because there is nowhere
-- to say what a photo is. The column is what makes "front, side, back" a
-- question the app can ask and Compare a pairing it can get right.
--
-- Nullable, and every existing row stays null. There is no honest way to infer
-- the pose of a photo already taken — a guess would silently re-pair somebody's
-- whole history — so an untagged photo stays untagged and pairs the way it does
-- today, which is the behaviour that is already there.
--
-- The check constraint is deliberately a short closed list rather than free
-- text. Compare has to GROUP by this value, and free text produces 'front',
-- 'Front', 'front view' and 'frontal' as four incomparable poses inside one
-- member's own history.
--
-- ── 2. A tape measurement cannot be a goal ─────────────────────────────────
--
-- `goal_targets.kind` is checked against ('weight','bodyfat','muscle','custom')
-- — see part 59 — so the only measured goals are the three that come off a
-- scan. A member working toward a waist measurement, which is the single most
-- commonly set body goal there is, has to record it as a `custom` goal: a
-- sentence, with no target value, no progress ring and no projection, because
-- part 59's own constraint requires custom goals to carry a title and no number.
--
-- The measurement sites are the ones src/ui/measurements.tsx lists, and they
-- are added as their own kinds rather than as a generic 'measurement' kind with
-- a site column, for one reason: the partial unique index below is
-- `(client_id, kind) where kind <> 'custom'`, which gives one target per metric.
-- A generic kind would allow only one tape goal in total, so a member could aim
-- at a waist OR an arm and never both.
--
-- ⚠ NOT APPLIED. This is written as a numbered part and nothing has been run
-- against the database. The client code for both features is deliberately NOT
-- in this release: a build that writes `pose` against a table without the
-- column fails the INSERT, which would take out progress photos entirely, and a
-- build that writes kind = 'waist' against the old constraint fails the same
-- way for goals. Apply this first, then the screens.

-- ── the pose ───────────────────────────────────────────────────────────────

alter table public.progress_photos
  add column if not exists pose text;

-- Dropped and recreated rather than added blind, so re-running this part is
-- safe — an `add constraint` against an existing name is an error, and a part
-- that cannot be re-run is a part somebody is afraid to apply.
alter table public.progress_photos
  drop constraint if exists progress_photos_pose_check;
alter table public.progress_photos
  add constraint progress_photos_pose_check
  check (pose is null or pose in ('front', 'side', 'back'));

-- Compare pairs within a pose, so the read is (client, pose, date). Named,
-- because `create index if not exists on ...` with no name is a syntax error
-- that this repository has already shipped once — see the note beside the scans
-- indexes in part 01.
create index if not exists progress_photos_client_pose_taken_idx
  on public.progress_photos (client_id, pose, taken_at desc);

-- ── the tape-measurement goals ─────────────────────────────────────────────
--
-- The constraint is REPLACED, not added to, because a check constraint cannot
-- be extended in place. The new list is the old four plus the twelve sites, and
-- the old four come first so a diff of this file against part 59 reads as an
-- addition rather than as a rewrite.
--
-- No existing row can violate it: every current row holds one of the original
-- four, all of which are still permitted.
alter table public.goal_targets
  drop constraint if exists goal_targets_kind_check;
alter table public.goal_targets
  add constraint goal_targets_kind_check
  check (kind in (
    'weight', 'bodyfat', 'muscle', 'custom',
    -- The sites, spelled exactly as src/ui/measurements.tsx spells them and in
    -- the same order. `measurements.kind` is a bare text column with no
    -- constraint of its own, so THIS list is the only place the two halves can
    -- be checked against each other, and a site added there without a line here
    -- is a goal the member can describe and not set.
    'waist', 'chest', 'shoulders', 'neck', 'hips',
    'arm', 'armL', 'armR',
    'thigh', 'thighL', 'thighR',
    'calf'
  ));

-- The value/title rule from part 59 is unchanged and still correct for the new
-- kinds: a waist goal is a number and carries no title, exactly as a weight
-- goal does. It is restated here only because it names `kind <> 'custom'`, and
-- a reader arriving at this file needs to see that the predicate still covers
-- the twelve kinds added above without being edited.
-- `goal_targets_shape` is its name in part 59 (an inline named constraint),
-- while the kind check above is unnamed there and so carries Postgres's
-- generated `goal_targets_kind_check`. Dropping the wrong name is a no-op with
-- `if exists`, which would leave the OLD four-kind constraint in place and this
-- part silently doing nothing — so both names are taken from part 59 itself.
alter table public.goal_targets
  drop constraint if exists goal_targets_shape;
alter table public.goal_targets
  add constraint goal_targets_shape
  check (
    (kind =  'custom' and target_value is null and title is not null and btrim(title) <> '')
    or
    (kind <> 'custom' and target_value is not null and title is null)
  );
