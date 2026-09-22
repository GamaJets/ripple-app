-- A coach can sell a program to the members of their gym.
--
-- A listing is one of the coach's saved program templates (part 13) with a
-- title, a price and a currency, offered to everybody on the coach's tenant.
-- It carries a COPY of the program taken when the listing is made: a buyer gets
-- what was on sale, not whatever the template has been edited into since, and a
-- coach can still delete the template (template_id goes null, the listing and
-- every sale of it stay whole).
--
-- Money goes through the coach's existing Stripe Connect account and the
-- `marketplace-checkout` edge function, which takes the price from THIS row,
-- never from the client, and applies the same platform fee as connect-checkout
-- (PLATFORM_FEE_PCT through src/lib/directCharges.ts). No new fee is invented.
--
-- A sale is written by the edge function (pending) and completed by the Stripe
-- webhook through `marketplace_fulfil()`, which marks it paid and assigns the
-- program to the buyer exactly as a coach assigning a template does: an upsert
-- of `assigned_programs` on client_id. Part 176's trigger keeps the program
-- that was there before in history, so nothing a buyer already had is lost.
--
-- Nobody but the service role writes a sale. Buyers read their own; coaches read
-- sales of their own listings.

create table if not exists public.marketplace_listings (
  id           uuid primary key default gen_random_uuid(),
  coach_id     uuid not null references public.profiles(id) on delete cascade,
  -- Filled from the coach's own profile; the policy below refuses any other.
  tenant_id    uuid not null default public.my_tenant() references public.tenants(id) on delete cascade,
  template_id  text references public.program_templates(id) on delete set null,
  program      jsonb not null,
  title        text not null,
  description  text not null default '',
  price_cents  bigint not null,
  currency     text not null,
  status       text not null default 'draft',
  created_at   timestamptz not null default now(),
  constraint marketplace_listings_title_chk check (length(btrim(title)) between 1 and 120),
  constraint marketplace_listings_description_chk check (length(description) <= 2000),
  constraint marketplace_listings_price_chk check (price_cents > 0),
  -- ISO 4217, uppercase, the rule `tenants_currency_is_iso` (part 99) states.
  constraint marketplace_listings_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint marketplace_listings_status_chk check (status in ('draft', 'live', 'retired'))
);
create index if not exists idx_marketplace_listings_coach on public.marketplace_listings(coach_id);
create index if not exists idx_marketplace_listings_tenant_live on public.marketplace_listings(tenant_id) where status = 'live';

alter table public.marketplace_listings enable row level security;

-- A coach makes, edits and removes their own listings, only on their own
-- tenant, and only from a template that is theirs.
drop policy if exists marketplace_listings_coach_rw on public.marketplace_listings;
create policy marketplace_listings_coach_rw on public.marketplace_listings for all
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and tenant_id = (select public.my_tenant())
    and (template_id is null or exists (
      select 1 from public.program_templates t
       where t.id = template_id and t.coach_id = (select auth.uid())
    ))
  );

-- Everybody on the same tenant reads what is on sale. Drafts and retired
-- listings stay the coach's.
drop policy if exists marketplace_listings_member_r on public.marketplace_listings;
create policy marketplace_listings_member_r on public.marketplace_listings for select
  using (status = 'live' and tenant_id = (select public.my_tenant()));

revoke all on public.marketplace_listings from anon;
grant select, insert, update, delete on public.marketplace_listings to authenticated;

comment on table public.marketplace_listings is
  'A coach''s program template offered for sale to members of their tenant. program is a copy taken at listing. '
  'Sold through marketplace-checkout on the coach''s Stripe Connect account. See part 3310.';


create table if not exists public.marketplace_purchases (
  id                 uuid primary key default gen_random_uuid(),
  listing_id         uuid not null references public.marketplace_listings(id) on delete restrict,
  buyer_id           uuid not null references public.profiles(id) on delete cascade,
  coach_id           uuid not null references public.profiles(id) on delete cascade,
  amount_cents       bigint not null,
  currency           text not null,
  stripe_session_id  text unique,
  status             text not null default 'pending',
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  constraint marketplace_purchases_amount_chk check (amount_cents >= 0),
  constraint marketplace_purchases_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint marketplace_purchases_status_chk check (status in ('pending', 'paid', 'refunded'))
);
create index if not exists idx_marketplace_purchases_buyer on public.marketplace_purchases(buyer_id);
create index if not exists idx_marketplace_purchases_coach on public.marketplace_purchases(coach_id);
create index if not exists idx_marketplace_purchases_listing on public.marketplace_purchases(listing_id);

alter table public.marketplace_purchases enable row level security;

drop policy if exists marketplace_purchases_buyer_r on public.marketplace_purchases;
create policy marketplace_purchases_buyer_r on public.marketplace_purchases for select
  using (buyer_id = (select auth.uid()));

drop policy if exists marketplace_purchases_coach_r on public.marketplace_purchases;
create policy marketplace_purchases_coach_r on public.marketplace_purchases for select
  using (coach_id = (select auth.uid()));

-- Read only from the apps. Every write is the service role's.
revoke all on public.marketplace_purchases from anon, authenticated;
grant select on public.marketplace_purchases to authenticated;

-- A buyer keeps reading what they bought after it stops being on sale, so My
-- Purchases can still name it. After both tables exist, because it reads the
-- second. Reads marketplace_purchases, whose policies
-- never read this table, so there is no cycle.
drop policy if exists marketplace_listings_buyer_r on public.marketplace_listings;
create policy marketplace_listings_buyer_r on public.marketplace_listings for select
  using (exists (
    select 1 from public.marketplace_purchases p
     where p.listing_id = marketplace_listings.id and p.buyer_id = (select auth.uid())
  ));

comment on table public.marketplace_purchases is
  'One checkout of a marketplace listing. Written pending by marketplace-checkout, completed by stripe-webhook '
  'through marketplace_fulfil(). No app writes. See part 3310.';


-- Mark a sale paid and give the buyer the program. Called by stripe-webhook on
-- checkout.session.completed with repple_kind = 'marketplace'.
--
-- Answers one word, so the webhook can log without a second read:
--   paid     just completed now, program assigned
--   already  was paid before; nothing done (Stripe retries are safe)
--   missing  no sale with this session id; nothing done
--
-- Amount and currency are what Stripe says was charged, and they are what is
-- recorded, because that is the money that moved.
create or replace function public.marketplace_fulfil(
  p_session_id text,
  p_amount_cents bigint,
  p_currency text
)
returns text
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_purchase marketplace_purchases%rowtype;
  v_program  jsonb;
begin
  select * into v_purchase from marketplace_purchases
   where stripe_session_id = p_session_id
   for update;
  if not found then
    return 'missing';
  end if;
  if v_purchase.status <> 'pending' then
    return 'already';
  end if;

  select l.program into v_program from marketplace_listings l where l.id = v_purchase.listing_id;

  update marketplace_purchases
     set status = 'paid',
         paid_at = now(),
         amount_cents = coalesce(p_amount_cents, amount_cents),
         currency = coalesce(nullif(upper(btrim(p_currency)), ''), currency)
   where id = v_purchase.id;

  insert into assigned_programs (client_id, coach_id, program, updated_at)
  values (v_purchase.buyer_id, v_purchase.coach_id, v_program, now())
  on conflict (client_id) do update
     set coach_id = excluded.coach_id,
         program = excluded.program,
         updated_at = excluded.updated_at,
         -- The old program's start date is not this one's.
         starts_on = null;

  return 'paid';
end;
$fn$;

revoke all on function public.marketplace_fulfil(text, bigint, text) from public, anon, authenticated;
grant execute on function public.marketplace_fulfil(text, bigint, text) to service_role;
