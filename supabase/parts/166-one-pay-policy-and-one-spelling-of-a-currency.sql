-- ═══════════════════════════════════════════════════════════════════════════
-- Two things about a gym that four screens each held their own opinion of.
--
-- ── 1. The pay policy nobody could store ──────────────────────────────────
--
-- Whether a no-show is paid, and whether a late cancellation is paid, is a
-- decision a gym makes once and applies to every coach. `PayPolicy` in
-- src/lib/gymSessions.ts models it, `isPayable` applies it, and until now there
-- has been nowhere to keep it. So it was held FOUR TIMES, in four places, none
-- of which survives a page reload:
--
--   studio-web/app/sessions/page.tsx   useState(PAY_DELIVERED_ONLY)
--   studio-web/app/staff/page.tsx      useState(PAY_DELIVERED_ONLY)
--   studio-web/app/close/page.tsx      useState(PAY_DELIVERED_ONLY)
--   studio-web/app/coach/earnings      const policy = PAY_DELIVERED_ONLY
--
-- The first three are controls: an owner sets one on Sessions, walks to Close
-- to settle the month, and Close has reset to the conservative reading. The
-- number they settle against is not the number they decided. The fourth is
-- worse, because it is not a control at all — the coach's own earnings screen
-- hardcodes the conservative reading and tells every coach, in as many words,
-- that it cannot read the gym's real policy. A coach owed for two no-shows is
-- shown a smaller number than the gym is about to pay them, and has no way to
-- tell whether that is the policy or the screen.
--
-- One nullable column closes all four.
--
-- NULLABLE, and the null is the point — the same argument `tenants.currency`
-- makes in part 99 and part 150 makes for every money column. "The gym has not
-- decided" is a real and common state, and it is NOT the same as "the gym pays
-- only for delivered sessions". A NOT NULL DEFAULT 'delivered_only' would look
-- exactly like a considered decision on every screen that renders it, so nobody
-- would ever go and make one — and the first time an owner discovered the
-- disagreement would be a coach asking why they were paid for one no-show and
-- not the next. A null renders as "not set" with a link to set it.
--
-- Four values rather than two booleans. They are read together, always, by one
-- function; two columns can hold three-quarters of an answer and this cannot.
--
-- ── 2. One spelling of a currency ─────────────────────────────────────────
--
-- `tenants.currency` is now written from two places for the first time: the
-- phone app's own settings sheet, and the web console's new /settings screen.
-- Both normalise before writing and both check the ISO shape, which is exactly
-- the arrangement that produces a disagreement eventually — two implementations
-- of one rule, in two languages, edited by two people. `gbp` from one and `GBP`
-- from the other are the same currency and two different strings, and every
-- currency comparison in this product is `===`: /page.tsx already withholds a
-- total when the contributing rows "disagree", and two spellings of one
-- currency would trip that on a gym that has only ever charged in one.
--
-- So the normalisation is moved to the one place both writers go through. A
-- trigger cannot be forgotten by a new client, cannot drift from the constraint
-- beside it, and applies to rows written by hand in the SQL editor too. The
-- clients keep their own parsing — a caller should be told '£' is not a
-- currency code before the round trip, not after — but nothing depends on them
-- agreeing about case or whitespace any more.
--
-- Idempotent, additive, and it alters no existing value except by trimming and
-- upper-casing on the next write.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.tenants
  add column if not exists session_pay_policy text;

alter table public.tenants drop constraint if exists tenants_session_pay_policy_known;
alter table public.tenants add constraint tenants_session_pay_policy_known
  check (session_pay_policy is null or session_pay_policy in (
    'delivered_only',
    'no_shows',
    'late_cancellations',
    'no_shows_and_late_cancellations'
  ));

comment on column public.tenants.session_pay_policy is
  'Which outcomes this gym pays a coach for, beyond a delivered session. NULL means the gym has not decided — render "not set" and ask, never read it as delivered_only. Values map to PayPolicy in src/lib/gymSessions.ts: delivered_only = {false,false}, no_shows = {true,false}, late_cancellations = {false,true}, no_shows_and_late_cancellations = {true,true}.';

-- ── the one normaliser both writers pass through ────────────────────────────
--
-- Whitespace and case only. It deliberately does NOT rescue a value that is not
-- a currency code: 'pounds' becomes 'POUNDS' and the check constraint below
-- rejects it, loudly, at the write. A trigger that quietly turned junk into a
-- plausible code would be the invented-currency bug wearing a different hat.
--
-- An empty string becomes NULL, because '' is what an emptied text field posts
-- and "the owner cleared it" and "the owner never set it" are the same fact.
create or replace function public.tenants_normalise_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.currency := nullif(upper(btrim(coalesce(new.currency, ''))), '');
  new.session_pay_policy := nullif(lower(btrim(coalesce(new.session_pay_policy, ''))), '');
  -- The gym's own name, collapsed the way src/lib/gymSettings.ts collapses it.
  -- "Iron  Works" and "Iron Works" being two gyms on two owners' phones is the
  -- divergence writing the name to the tenant was meant to end, and it must not
  -- come back through whichever client writes next. `name` is NOT NULL, so a
  -- blank is left exactly as it arrived for the column to reject.
  if new.name is not null then
    new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  end if;
  return new;
end $$;

revoke all on function public.tenants_normalise_settings() from public, anon, authenticated;

drop trigger if exists trg_tenants_normalise on public.tenants;
create trigger trg_tenants_normalise
  before insert or update on public.tenants
  for each row execute function public.tenants_normalise_settings();

-- The currency constraint is restated rather than assumed. Part 99 added it,
-- and this file's whole argument is that the trigger and the constraint are two
-- halves of one rule — a reader who finds one should find the other beside it,
-- and a database built from parts out of order should get both.
alter table public.tenants drop constraint if exists tenants_currency_is_iso;
alter table public.tenants add constraint tenants_currency_is_iso
  check (currency is null or currency ~ '^[A-Z]{3}$');
