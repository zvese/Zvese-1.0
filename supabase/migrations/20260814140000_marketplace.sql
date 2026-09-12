-- ============================================================
-- Zvese 1.0 — Marketplace Foundation
-- Migration: 20260814140000_marketplace.sql
--
-- FOUNDATION ONLY
--
-- Establishes:
--   1. User profiles
--   2. Seller profiles
--   3. Marketplace categories
--   4. Canonical products
--   5. Seller listings
--   6. Updated-at automation
--   7. Row Level Security
--   8. Automatic profile creation after signup
--   9. Seller status protection
--  10. Atomic product + listing creation
--
-- Future migrations will add:
--   Orders
--   Payments
--   Cart
--   Wishlist
--   Shipping
--   Suppliers
--   Fulfillment
--   Product variants
--   Reviews
--   AI
--   JARVIS
--   Zvese Luxe
--
-- IMPORTANT:
-- This migration is intended to be applied once to the
-- currently empty Zvese database foundation.
-- ============================================================


-- ============================================================
-- 1. PROFILES
-- ============================================================

create table public.profiles (
  id uuid primary key
    references auth.users(id)
    on delete cascade,

  display_name text,

  handle text
    check (
      handle is null
      or (
        handle = trim(handle)
        and char_length(handle) between 3 and 40
        and handle ~ '^[A-Za-z0-9]([A-Za-z0-9_-]*[A-Za-z0-9])?$'
      )
    ),

  bio text,

  avatar_url text,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);


create unique index profiles_handle_unique_idx
  on public.profiles (lower(handle))
  where handle is not null;


-- ============================================================
-- 2. SELLER PROFILES
-- ============================================================

create table public.seller_profiles (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null unique
    references public.profiles(id)
    on delete cascade,

  store_name text not null
    check (char_length(trim(store_name)) between 2 and 160),

  store_slug text not null
    check (
      store_slug = trim(store_slug)
      and store_slug = lower(store_slug)
      and char_length(store_slug) between 2 and 160
      and store_slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    ),

  store_description text,

  logo_url text,

  country_code text
    check (
      country_code is null
      or country_code ~ '^[A-Z]{2}$'
    ),

  default_currency text not null default 'USD'
    check (default_currency ~ '^[A-Z]{3}$'),

  status text not null default 'pending'
    check (
      status in (
        'pending',
        'active',
        'suspended',
        'closed'
      )
    ),

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);


create unique index seller_profiles_store_slug_unique_idx
  on public.seller_profiles (lower(store_slug));


-- ============================================================
-- 3. CATEGORIES
-- ============================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),

  parent_id uuid
    references public.categories(id)
    on delete set null,

  name text not null
    check (char_length(trim(name)) between 1 and 160),

  slug text not null
    check (
      slug = trim(slug)
      and slug = lower(slug)
      and char_length(slug) between 1 and 160
      and slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    ),

  description text,

  image_url text,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);


create unique index categories_slug_unique_idx
  on public.categories (lower(slug));


create index categories_parent_id_idx
  on public.categories(parent_id);


-- ============================================================
-- 4. PRODUCTS
-- ============================================================
--
-- A PRODUCT represents WHAT the item is.
--
-- Products are independent from a particular seller.
-- This allows multiple sellers to offer the same product
-- through separate listings.
-- ============================================================

create table public.products (
  id uuid primary key default gen_random_uuid(),

  created_by uuid not null
    references public.profiles(id)
    on delete restrict,

  category_id uuid
    references public.categories(id)
    on delete set null,

  title text not null
    check (char_length(trim(title)) between 3 and 160),

  slug text not null
    check (
      slug = trim(slug)
      and slug = lower(slug)
      and char_length(slug) between 1 and 180
      and slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    ),

  description text,

  brand text,

  status text not null default 'draft'
    check (
      status in (
        'draft',
        'active',
        'archived'
      )
    ),

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);


create unique index products_slug_unique_idx
  on public.products (lower(slug));


create index products_created_by_idx
  on public.products(created_by);


create index products_category_id_idx
  on public.products(category_id);


create index products_status_idx
  on public.products(status);


-- ============================================================
-- 5. LISTINGS
-- ============================================================

create table public.listings (
  id uuid primary key default gen_random_uuid(),

  seller_id uuid not null
    references public.seller_profiles(id)
    on delete cascade,

  product_id uuid not null
    references public.products(id)
    on delete restrict,

  title text,

  price_minor bigint not null
    check (price_minor >= 0),

  currency text not null default 'USD'
    check (currency ~ '^[A-Z]{3}$'),

  inventory_quantity bigint not null default 0
    check (inventory_quantity >= 0),

  inventory_mode text not null default 'on_demand'
    check (
      inventory_mode in (
        'stock',
        'on_demand',
        'external'
      )
    ),

  status text not null default 'draft'
    check (
      status in (
        'draft',
        'active',
        'paused',
        'archived'
      )
    ),

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  unique (seller_id, product_id)
);


create index listings_seller_id_idx
  on public.listings(seller_id);


create index listings_product_id_idx
  on public.listings(product_id);


create index listings_status_idx
  on public.listings(status);


create index listings_active_lookup_idx
  on public.listings(product_id, status);


-- ============================================================
-- 6. UPDATED_AT FUNCTION
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


revoke execute on function public.set_updated_at()
from public;


-- ============================================================
-- 7. UPDATED_AT TRIGGERS
-- ============================================================

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();


create trigger seller_profiles_set_updated_at
before update on public.seller_profiles
for each row
execute function public.set_updated_at();


create trigger categories_set_updated_at
before update on public.categories
for each row
execute function public.set_updated_at();


create trigger products_set_updated_at
before update on public.products
for each row
execute function public.set_updated_at();


create trigger listings_set_updated_at
before update on public.listings
for each row
execute function public.set_updated_at();


-- ============================================================
-- 8. SELLER STATUS PROTECTION
-- ============================================================

create or replace function public.prevent_seller_status_self_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin

  if tg_op = 'INSERT' then

    if (select auth.uid()) is not null
       and new.status <> 'pending'
    then
      raise exception
        'New seller profiles must be created with pending status';
    end if;

  elsif tg_op = 'UPDATE' then

    if (select auth.uid()) is not null
       and (select auth.uid()) = old.user_id
       and new.status is distinct from old.status
    then
      raise exception
        'Seller status can only be changed by Zvese administration';
    end if;

  end if;

  return new;

end;
$$;


revoke execute on function public.prevent_seller_status_self_change()
from public;


create trigger seller_status_protection
before insert or update on public.seller_profiles
for each row
execute function public.prevent_seller_status_self_change();


-- ============================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;

alter table public.seller_profiles enable row level security;

alter table public.categories enable row level security;

alter table public.products enable row level security;

alter table public.listings enable row level security;


-- ============================================================
-- 10. PROFILE POLICIES
-- ============================================================

create policy "Profiles are publicly viewable"
on public.profiles
for select
to anon, authenticated
using (true);


create policy "Users can create their own profile"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);


create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);


-- ============================================================
-- 11. SELLER PROFILE POLICIES
-- ============================================================

create policy "Active seller profiles are publicly viewable"
on public.seller_profiles
for select
to anon, authenticated
using (status = 'active');


create policy "Users can view their own seller profile"
on public.seller_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);


create policy "Users can create their own seller profile"
on public.seller_profiles
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'pending'
);


create policy "Users can update their own seller profile"
on public.seller_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);


-- ============================================================
-- 12. CATEGORY POLICIES
-- ============================================================

create policy "Active categories are publicly viewable"
on public.categories
for select
to anon, authenticated
using (is_active = true);


-- ============================================================
-- 13. PRODUCT POLICIES
-- ============================================================

create policy "Active products are publicly viewable"
on public.products
for select
to anon, authenticated
using (status = 'active');


create policy "Users can view their own products"
on public.products
for select
to authenticated
using ((select auth.uid()) = created_by);


create policy "Users can create their own products"
on public.products
for insert
to authenticated
with check ((select auth.uid()) = created_by);


create policy "Users can update their own products"
on public.products
for update
to authenticated
using ((select auth.uid()) = created_by)
with check ((select auth.uid()) = created_by);


create policy "Users can delete their own products"
on public.products
for delete
to authenticated
using ((select auth.uid()) = created_by);


-- ============================================================
-- 14. LISTING POLICIES
-- ============================================================

create policy "Active listings are publicly viewable"
on public.listings
for select
to anon, authenticated
using (
  status = 'active'
  and exists (
    select 1
    from public.seller_profiles sp
    where sp.id = listings.seller_id
      and sp.status = 'active'
  )
  and exists (
    select 1
    from public.products p
    where p.id = listings.product_id
      and p.status = 'active'
  )
);


create policy "Sellers can view their own listings"
on public.listings
for select
to authenticated
using (
  exists (
    select 1
    from public.seller_profiles sp
    where sp.id = listings.seller_id
      and sp.user_id = (select auth.uid())
  )
);


create policy "Sellers can create their own listings"
on public.listings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.seller_profiles sp
    where sp.id = listings.seller_id
      and sp.user_id = (select auth.uid())
      and sp.status = 'active'
  )
);


create policy "Sellers can update their own listings"
on public.listings
for update
to authenticated
using (
  exists (
    select 1
    from public.seller_profiles sp
    where sp.id = listings.seller_id
      and sp.user_id = (select auth.uid())
      and sp.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.seller_profiles sp
    where sp.id = listings.seller_id
      and sp.user_id = (select auth.uid())
      and sp.status = 'active'
  )
);


create policy "Sellers can delete their own listings"
on public.listings
for delete
to authenticated
using (
  exists (
    select 1
    from public.seller_profiles sp
    where sp.id = listings.seller_id
      and sp.user_id = (select auth.uid())
  )
);


-- ============================================================
-- 15. AUTOMATIC PROFILE CREATION
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin

  insert into public.profiles (
    id,
    display_name
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  );

  return new;

end;
$$;


revoke execute on function public.handle_new_user()
from public;


-- ============================================================
-- 16. AUTH USER → PROFILE TRIGGER
-- ============================================================

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();


-- ============================================================
-- 17. ATOMIC PRODUCT & LISTING CREATION
-- ============================================================

create or replace function public.create_product_listing(
  p_title text,
  p_description text,
  p_price_minor bigint,
  p_inventory_quantity bigint default 0,
  p_inventory_mode text default 'on_demand',
  p_brand text default null,
  p_category_id uuid default null
)
returns table (
  product_id uuid,
  listing_id uuid,
  product_slug text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_seller_id uuid;
  v_currency text;
  v_base_slug text;
  v_slug text;
  v_counter integer := 0;
  v_product_id uuid;
  v_listing_id uuid;
  v_max_attempts integer := 100;
  v_constraint text;
  v_category_exists boolean;
begin

  -- ==========================================================
  -- 1. Authentication
  -- ==========================================================

  v_user_id := (select auth.uid());

  if v_user_id is null then
    raise exception
      'Authentication required to create a listing';
  end if;


  -- ==========================================================
  -- 2. Active seller verification
  -- ==========================================================

  select
    id,
    default_currency
  into
    v_seller_id,
    v_currency
  from public.seller_profiles
  where user_id = v_user_id
    and status = 'active';

  if v_seller_id is null then
    raise exception
      'An active seller profile is required to publish listings';
  end if;


  -- ==========================================================
  -- 3. Input validation
  -- ==========================================================

  if p_title is null
     or char_length(trim(p_title)) < 3
     or char_length(trim(p_title)) > 160
  then
    raise exception
      'Title must be between 3 and 160 characters';
  end if;


  if p_price_minor is null
     or p_price_minor < 0
  then
    raise exception
      'Price must be greater than or equal to 0';
  end if;


  if p_inventory_quantity is null
     or p_inventory_quantity < 0
  then
    raise exception
      'Inventory quantity must be greater than or equal to 0';
  end if;


  if p_inventory_mode is null
     or p_inventory_mode not in (
       'stock',
       'on_demand',
       'external'
     )
  then
    raise exception
      'Invalid inventory mode';
  end if;


  -- ==========================================================
  -- 4. Category validation
  -- ==========================================================

  if p_category_id is not null then

    select exists (
      select 1
      from public.categories
      where id = p_category_id
        and is_active = true
    )
    into v_category_exists;

    if not v_category_exists then
      raise exception
        'Selected category does not exist or is inactive';
    end if;

  end if;


  -- ==========================================================
  -- 5. Deterministic URL-safe slug generation
  -- ==========================================================

  v_base_slug :=
    lower(
      regexp_replace(
        trim(p_title),
        '[^a-zA-Z0-9]+',
        '-',
        'g'
      )
    );

  v_base_slug := trim(both '-' from v_base_slug);

  if v_base_slug = '' then
    v_base_slug := 'product';
  end if;

  v_slug := v_base_slug;


  -- ==========================================================
  -- 6. Product creation + targeted slug collision retry
  -- ==========================================================

  loop

    begin

      insert into public.products (
        created_by,
        category_id,
        title,
        slug,
        description,
        brand,
        status
      )
      values (
        v_user_id,
        p_category_id,
        trim(p_title),
        v_slug,
        trim(p_description),
        trim(p_brand),
        'active'
      )
      returning id into v_product_id;

      exit;

    exception
      when unique_violation then

        get stacked diagnostics
          v_constraint = constraint_name;

        if v_constraint = 'products_slug_unique_idx' then

          v_counter := v_counter + 1;

          if v_counter > v_max_attempts then
            raise exception
              'Could not generate unique slug for product after % attempts',
              v_max_attempts;
          end if;

          v_slug :=
            v_base_slug || '-' || v_counter::text;

        else

          raise;

        end if;

    end;

  end loop;


  -- ==========================================================
  -- 7. Listing creation
  -- ==========================================================

  insert into public.listings (
    seller_id,
    product_id,
    title,
    price_minor,
    currency,
    inventory_quantity,
    inventory_mode,
    status
  )
  values (
    v_seller_id,
    v_product_id,
    null,
    p_price_minor,
    v_currency,
    p_inventory_quantity,
    p_inventory_mode,
    'active'
  )
  returning id into v_listing_id;


  -- ==========================================================
  -- 8. Return canonical identifiers
  -- ==========================================================

  return query
  select
    v_product_id,
    v_listing_id,
    v_slug;

end;
$$;


-- Explicit least-privilege RPC permissions.
-- PUBLIC must not be able to execute this function.

revoke execute
on function public.create_product_listing(
  text,
  text,
  bigint,
  bigint,
  text,
  text,
  uuid
)
from public;


grant execute
on function public.create_product_listing(
  text,
  text,
  bigint,
  bigint,
  text,
  text,
  uuid
)
to authenticated;


-- ============================================================
-- END OF ZVESE MARKETPLACE FOUNDATION
-- ============================================================