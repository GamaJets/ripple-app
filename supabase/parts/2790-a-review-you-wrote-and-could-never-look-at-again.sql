-- ── A review you wrote, and could never look at again ──────────────────────
--
-- Part 139 built the review system and gave the author exactly one way back to
-- their own words: `my_review_of(p_coach)`, which takes the coach as an
-- argument. Every caller in the app supplies that argument from somewhere, and
-- there are only two somewheres:
--
--   · app/(client)/my-coach.tsx, from `my_coach_profile()` — which answers ONLY
--     while the coaching relationship is ACTIVE. Part 115 says so and part 68's
--     `end_coaching()` clears `clients.trainer_id`, so the moment coaching ends
--     the id is gone and the review goes with it.
--   · app/(client)/trainers.tsx, from a row of the DIRECTORY — which holds
--     `listed = true` coaches only, and `listed` defaults to false.
--
-- So a member who left a coach, or whose coach never ticked "list me", had
-- written a rating and a paragraph about a named professional and had no way
-- in the product to read it, change it, or take it down. `write_coach_review`
-- and `withdraw_coach_review` both still work perfectly — they take the coach
-- id too, and the member has nowhere to get one.
--
-- The right question was never "which coach?". It is "what have I written?",
-- and nothing in the database could be asked it.
--
-- ── Why a function, and why it takes no argument ───────────────────────────
--
-- `coach_reviews` holds no grant to any role at all (part 139, §2 header): RLS
-- selects ROWS and never COLUMNS, and any row-wide read hands out `client_id`
-- — the reviewer's account id against their rating of a named person. That
-- decision is not being reopened here. This is a fifth SECURITY DEFINER reader
-- alongside the four part 139 already has, and it names its columns.
--
-- It takes NO argument, for the same reason `my_coach_profile()` takes none:
-- an argument is a probe. Every row this returns was written BY the caller, so
-- there is nothing to pass and nothing to guess at.
--
-- ── What it discloses that nothing else did, and why that is not a widening ─
--
-- `coach_name`, in full, for a coach the member may no longer be with.
--
-- `my_coach_profile()` gives the full name of the CURRENT coach and stops at
-- the end of the relationship. This goes one step further, and the step is
-- small enough to say out loud rather than leave to be discovered:
--
--   · the reader had a coaching relationship with this person. That is exactly
--     what `can_review_coach()` asks, and a row can only exist here if it was
--     true when the review was written.
--   · the name is not new information to them. They were coached by this
--     person, under this name, and then wrote a paragraph about them.
--   · nothing is enumerable. No argument, and the WHERE clause is
--     `client_id = auth.uid()` — a caller cannot ask about anybody else's
--     reviews, or about a coach they never had.
--
-- `coach_listed` is here for the sentence the screen has to write. The existing
-- copy on app/(client)/my-coach.tsx says a withdrawn review is no longer "on
-- their profile", and a review of an UNLISTED coach was never on a profile
-- anybody could browse in the first place. Without this column a screen
-- listing old reviews would have to either say nothing about who can see them
-- or guess, and a guess about who is reading your words is the wrong thing to
-- get wrong. It says only what a coach chose about their own directory entry.
--
-- Withdrawn rows ARE returned, with their `withdrawn_at`. That is the whole
-- point: `coach_reviews_for` excludes them from everybody including the
-- author, so the author is the one person who must be able to see that the
-- thing they took down is down rather than gone.
--
-- No LIMIT, deliberately — see scripts/check-sql-caps.mjs for what a ceiling
-- written inside a function body does to `capped()`. The set is bounded by the
-- number of coaches one person has been coached by, and `coach_reviews` is
-- unique on (coach_id, client_id), so it cannot exceed that.

create or replace function public.my_coach_reviews()
returns table (
  review_id        uuid,
  coach_id         uuid,
  coach_name       text,
  coach_listed     boolean,
  rating           smallint,
  body             text,
  created_at       timestamptz,
  updated_at       timestamptz,
  edited           boolean,
  withdrawn_at     timestamptz,
  coach_reply      text,
  coach_replied_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select r.id,
         r.coach_id,
         nullif(btrim(coalesce(p.full_name, '')), ''),
         -- A coach with no `trainers` row is not listed. coalesce rather than a
         -- null, because null here would read on the screen as "we could not
         -- find out", and we did find out.
         coalesce(t.listed, false),
         r.rating,
         r.body,
         r.created_at,
         r.updated_at,
         r.edited,
         r.withdrawn_at,
         r.coach_reply,
         r.coach_replied_at
    from public.coach_reviews r
    left join public.profiles p on p.id = r.coach_id
    left join public.trainers t on t.id = r.coach_id
   where r.client_id = auth.uid()
     and auth.uid() is not null
   order by r.created_at desc;
$function$;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC, and in a Supabase
-- project PUBLIC includes `anon`. The revoke is not tidying — without it this
-- answers the publishable key. auth.uid() is null for anon and the WHERE clause
-- would return nothing, but a privilege that is only ever refused is a
-- privilege to remove. See scripts/check-grants.mjs.
revoke execute on function public.my_coach_reviews() from public, anon;
grant  execute on function public.my_coach_reviews() to authenticated;
