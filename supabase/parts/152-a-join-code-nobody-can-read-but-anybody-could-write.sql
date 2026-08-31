-- ═══════════════════════════════════════════════════════════════════════════
-- A join code nobody could read, and every coach could write.
--
-- Part 131 established that `trainers.join_code` is a credential: a code is
-- what attaches somebody to a coach, so it revoked table-wide SELECT and
-- granted back a named list that deliberately excludes it. Part 141 closed the
-- other half of the same hole, where `anon` could call `join_by_code` and use
-- the table as an oracle to try codes against.
--
-- Neither touched the WRITE side. Measured live, before this file:
--
--     authenticated
--       SELECT  bio, id, late_cancel_*, listed, offers, session_fee,
--               specialties, tagline, tenant_id          -- no join_code, right
--       UPDATE  … and join_code                          -- join_code, wrong
--       INSERT  … and join_code                          -- join_code, wrong
--
-- So the column a coach is not allowed to READ was one they could SET.
--
--
-- ── What that was worth, honestly ──────────────────────────────────────────
--
-- Less than it sounds, and worth writing down rather than overstating.
--
-- `trainers_join_code_uniq` is a UNIQUE index on `upper(join_code)`, so a coach
-- could not take a code that belongs to somebody else — the insert is refused.
-- What they COULD do is use that refusal: set their own code to a guess and
-- read the outcome. Success means the code was free; 23505 means it is taken.
-- That is an existence oracle over the credential space, which is the exact
-- shape part 141 closed on the read side and which is no better for being
-- reachable only by somebody who has signed up as a coach.
--
-- And knowing a code exists is not nothing. `join_by_code` turns a code into a
-- pending request against that coach, so an enumerated set of live codes is a
-- list of coaches somebody can queue requests at.
--
--
-- ── Why revoking is safe ───────────────────────────────────────────────────
--
-- Nothing writes this column directly. Every operation on a join code in this
-- product goes through an RPC — `create_join_code`, `rotate_join_code`,
-- `revoke_join_code`, `my_join_code`, `my_join_code_stats`, `join_by_code` —
-- and all six were confirmed live as SECURITY DEFINER with `search_path=public`
-- pinned. A definer function runs as its owner, so it keeps writing the column
-- after the caller's grant on it is gone.
--
-- Those functions are also where the rules live: the label length, the cap on
-- how many live codes one coach may hold, the alphabet the code is drawn from.
-- A direct UPDATE bypassed all of it. The grant was not a feature anybody used;
-- it was the default privilege on a column added to a table that already had
-- one, which is the same way `join_code` became readable in the first place.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The first attempt at this file was a no-op, and that is the lesson ─────
--
-- It read
--
--     revoke insert (join_code), update (join_code) on public.trainers
--       from authenticated;
--
-- and changed nothing. `authenticated` holds INSERT and UPDATE at TABLE level,
-- and a table-level grant is not a set of column grants you can subtract one
-- from — it is a privilege over every column, including ones added later. The
-- revoke reported success and `information_schema.column_privileges` still
-- listed `join_code` under both.
--
-- This is the rule part 131 wrote down for SELECT — "you cannot subtract one
-- column from a table-wide grant" — arriving again on the write side, where
-- nobody had applied it. So the same shape is used: revoke the table
-- privilege, grant back the named columns.
--
-- The lists below are every column of `trainers` EXCEPT `join_code`, which is
-- the whole point, and they are written out rather than generated so that a
-- column added later is excluded until somebody decides otherwise. A new
-- column silently inheriting write access is how this happened.

revoke insert, update on public.trainers from authenticated;

grant insert (id, tenant_id, bio, tagline, offers, specialties, session_fee,
              listed, late_cancel_applies, late_cancel_notice_hours,
              late_cancel_fee)
  on public.trainers to authenticated;

grant update (bio, tagline, offers, specialties, session_fee, listed,
              late_cancel_applies, late_cancel_notice_hours, late_cancel_fee)
  on public.trainers to authenticated;

-- `id` and `tenant_id` are insertable but NOT updatable: a coach's row is
-- created against their own uid, and moving an existing row to another id or
-- another gym is not an edit, it is a different row. DELETE is left as it was.
--
-- `anon` holds nothing on this table and is not re-granted anything here; part
-- 131 revoked it wholesale and part 141 verified it. This file only narrows.
