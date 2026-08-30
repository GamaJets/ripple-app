-- ─────────────────────────────────────────────────────────────────────────
-- Where a bought animation pack lands.
--
-- The catalogue stores image_paths as PATHS rather than URLs precisely so that
-- swapping the media never means rewriting 917 rows. This is that swap
-- arriving: a licensed looping clip per movement, resolved at read time exactly
-- as the reference frames are.
--
-- Two photographs are a start position and an end position. Cross-fading them
-- removes the jolt and invents no motion, but it is not an animation and was
-- reported, correctly, as choppy. This is the fix; the frames stay as the
-- fallback for movements the pack does not cover.
--
-- ── A separate bucket from exercise-videos ─────────────────────────────────
--
-- `exercise-videos` holds clips a COACH recorded, governed by per-clip
-- visibility and gym membership — a client may see one and not another. These
-- are stock content shown to everybody, and mixing them would put licensed
-- third-party media under RLS written to answer "is this my coach's client".
--
-- Private, not public. A commercial licence usually permits use inside the app
-- and says nothing kind about leaving the files openly fetchable. The app
-- already signs URLs for coach clips, so this costs nothing new; if the licence
-- bought permits it, flipping to public is one statement and gains CDN caching.
--
-- ── demo_licence, and why it is not optional ───────────────────────────────
--
-- A preview bundle is CC BY-NC: fine for deciding whether to buy, never fine in
-- a product that sells memberships. The realistic failure is not a decision
-- anybody makes — it is one nobody revisits. Somebody wires the preview in to
-- look at it, it works, and four builds later it is in an App Store binary that
-- nobody re-checked. So the licence travels with the row and is asked every
-- time it is about to render (src/lib/exerciseMedia.ts, demoIsShippable), and
-- a NULL is treated as unlicensed rather than as permission — the reason it is
-- unrecorded is unknown, and the expensive guess is the permissive one.
-- ─────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-demos', 'exercise-demos', false, 52428800,
        array['video/mp4','video/webm','image/webp','image/gif','application/json'])
on conflict (id) do nothing;

alter table public.exercises add column if not exists animation_path text;
alter table public.exercises add column if not exists demo_licence   text;

comment on column public.exercises.animation_path is
  'Storage key in the exercise-demos bucket for this movement''s looping clip. A path, never a URL — the media can be replaced without touching this table.';
comment on column public.exercises.demo_licence is
  'Licence of the animation: ''commercial'' once bought, ''evaluation'' for a CC BY-NC preview bundle, NULL when there is no animation. An ''evaluation'' asset must never render in a release build.';

create index if not exists exercises_animation_path_idx
  on public.exercises (animation_path)
  where animation_path is not null;
