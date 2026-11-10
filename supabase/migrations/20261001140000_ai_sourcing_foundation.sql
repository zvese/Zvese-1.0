-- UNAPPLIED: AI-assisted sourcing foundation. Apply through the reviewed migration workflow only.
-- Sourcing approval creates an existing-system draft; it cannot submit, approve, activate, or publish it.
begin;

create function private.normalize_sourcing_https_url(p_url text)
returns text language plpgsql immutable strict security invoker set search_path = '' as $$
declare
  v_url text := btrim(p_url);
  v_parts text[];
  v_host text;
  v_port text;
  v_suffix text;
  v_octets integer[];
begin
  if char_length(v_url) > 2000 or v_url ~ '[[:cntrl:][:space:]]' or v_url ~ '#' then
    raise exception 'Invalid sourcing HTTPS URL' using errcode='22023';
  end if;
  v_parts := pg_catalog.regexp_match(v_url, '^https://([A-Za-z0-9.-]+)(:[0-9]{1,5})?([/?][^#]*)?$');
  if v_parts is null then raise exception 'Invalid sourcing HTTPS URL' using errcode='22023'; end if;
  v_host := lower(v_parts[1]);
  v_port := v_parts[2];
  v_suffix := coalesce(v_parts[3], '/');
  if v_port is not null and v_port <> ':443' then raise exception 'Only standard HTTPS URLs are allowed' using errcode='22023'; end if;
  if pg_catalog.regexp_replace(v_suffix, '%[0-9A-Fa-f]{2}', '', 'g') ~ '%'
    or v_suffix ~* '%(?:0[0-9A-F]|1[0-9A-F]|7F)'
    or v_suffix ~ '%(?:[0-9A-F][a-f]|[a-f][0-9A-Fa-f])'
    or v_suffix ~* '(^|/)(?:\.|%2e)(?:\.|%2e)?(?:/|$|\?)' then
    raise exception 'Malformed URL encoding' using errcode='22023';
  end if;
  if v_host ~ '^[0-9.]+$' then
    if v_host !~ '^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$' then
      raise exception 'Canonical dotted-decimal IP address required' using errcode='22023';
    end if;
    v_octets := pg_catalog.string_to_array(v_host, '.')::integer[];
    if exists(select 1 from pg_catalog.unnest(v_octets) octet where octet not between 0 and 255)
      or v_octets[1] in (0,10,127) or v_octets[1] >= 224
      or (v_octets[1]=100 and v_octets[2] between 64 and 127)
      or (v_octets[1]=169 and v_octets[2]=254)
      or (v_octets[1]=172 and v_octets[2] between 16 and 31)
      or (v_octets[1]=192 and v_octets[2] in (0,168))
      or (v_octets[1]=192 and v_octets[2]=88 and v_octets[3]=99)
      or (v_octets[1]=198 and v_octets[2] in (18,19))
      or (v_octets[1]=198 and v_octets[2]=51 and v_octets[3]=100)
      or (v_octets[1]=203 and v_octets[2]=0 and v_octets[3]=113) then
      raise exception 'Private or reserved hosts are not allowed' using errcode='22023';
    end if;
  elsif v_host = 'localhost' or v_host like '%.localhost' or v_host like '%.local'
    or v_host !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'A valid public hostname is required' using errcode='22023';
  end if;
  return 'https://' || v_host || v_suffix;
end; $$;

create function private.is_supported_sourcing_currency(p_code text)
returns boolean language sql immutable strict security invoker set search_path = '' as $$
  select p_code = any(array[
    'AED','AFN','ALL','AMD','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD',
    'CAD','CDF','CHF','CLP','CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP',
    'GMD','GNF','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD',
    'KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN',
    'NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP',
    'SLE','SOS','SRD','SSP','STN','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV',
    'WST','XAF','XCD','XCG','XOF','XPF','YER','ZAR','ZMW','ZWG'
  ]::text[]);
$$;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = lower(btrim(code)) and code ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  display_name text not null check (display_name = btrim(display_name) and char_length(display_name) between 2 and 160 and display_name !~ '[[:cntrl:]]'),
  legal_name text check (legal_name is null or (legal_name = btrim(legal_name) and char_length(legal_name) between 2 and 200 and legal_name !~ '[[:cntrl:]]')),
  supplier_type text not null check (supplier_type in ('supplier','manufacturer','authorized_distributor')),
  status text not null default 'pending' check (status in ('pending','active','held','suspended','rejected','closed')),
  website_url text check (website_url is null or website_url = private.normalize_sourcing_https_url(website_url)),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object' and octet_length(capabilities::text) <= 65536),
  shipping_capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(shipping_capabilities) = 'object' and octet_length(shipping_capabilities::text) <= 65536),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sourcing_imports (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  import_type text not null check (import_type in ('api_catalog','csv','json','manual')),
  source_reference text not null check (source_reference = btrim(source_reference) and char_length(source_reference) between 2 and 300 and source_reference !~ '[[:cntrl:]]'),
  status text not null default 'received' check (status in ('received','normalized','validated','failed','completed')),
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) in ('object','array') and octet_length(raw_payload::text) <= 1048576),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 262144),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, supplier_id),
  constraint sourcing_imports_completion_state_check check (
    (status in ('validated','failed','completed') and completed_at is not null)
    or (status in ('received','normalized') and completed_at is null)
  ),
  constraint sourcing_imports_completion_order_check check (completed_at is null or completed_at >= created_at)
);

create table public.sourcing_candidates (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  target_seller_id uuid not null references public.seller_profiles(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  source_sku text not null check (source_sku = btrim(source_sku) and char_length(source_sku) between 2 and 160 and source_sku !~ '[[:cntrl:]]'),
  source_sku_identity text generated always as (lower(btrim(source_sku))) stored,
  manufacturer_sku text check (manufacturer_sku is null or (manufacturer_sku = btrim(manufacturer_sku) and char_length(manufacturer_sku) between 1 and 160 and manufacturer_sku !~ '[[:cntrl:]]')),
  manufacturer_sku_identity text generated always as (lower(btrim(manufacturer_sku))) stored,
  gtin text check (gtin is null or gtin ~ '^[0-9]{8,14}$'),
  source_reference text not null check (source_reference = btrim(source_reference) and char_length(source_reference) between 2 and 300 and source_reference !~ '[[:cntrl:]]'),
  source_url text check (source_url is null or source_url = private.normalize_sourcing_https_url(source_url)),
  source_url_identity text generated always as (private.normalize_sourcing_https_url(source_url)) stored,
  title text not null check (title = btrim(title) and char_length(title) between 3 and 160 and title !~ '[[:cntrl:]]'),
  description text not null check (description = btrim(description) and char_length(description) between 10 and 2000 and description !~ '[[:cntrl:]]'),
  brand text check (brand is null or (brand = btrim(brand) and char_length(brand) between 1 and 160 and brand !~ '[[:cntrl:]]')),
  source_cost_minor bigint not null check (source_cost_minor between 1 and 100000000),
  proposed_price_minor bigint not null check (proposed_price_minor > source_cost_minor and proposed_price_minor <= 100000000),
  currency text not null check (private.is_supported_sourcing_currency(currency)),
  estimated_gross_margin_bps integer not null check (
    estimated_gross_margin_bps between 0 and 9999
    and abs(estimated_gross_margin_bps - round(((proposed_price_minor-source_cost_minor)::numeric/proposed_price_minor)*10000)::integer) <= 1
  ),
  pricing_policy text not null check (pricing_policy = btrim(pricing_policy) and char_length(pricing_policy) between 2 and 160),
  availability_state text not null check (availability_state in ('checking','unavailable')),
  availability_verification_state text not null default 'unverified' check (availability_verification_state = 'unverified'),
  stock_quantity bigint check (stock_quantity is null or stock_quantity between 0 and 1000000000),
  variants jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array' and octet_length(variants::text) <= 262144),
  sizes jsonb not null default '[]'::jsonb check (jsonb_typeof(sizes) = 'array' and octet_length(sizes::text) <= 65536),
  handling_time_min_days integer not null default 0 check (handling_time_min_days between 0 and 365),
  handling_time_max_days integer not null default 0 check (handling_time_max_days between handling_time_min_days and 365),
  shipping jsonb not null default '{}'::jsonb check (jsonb_typeof(shipping) = 'object' and octet_length(shipping::text) <= 262144),
  minimum_order_quantity integer not null default 1 check (minimum_order_quantity between 1 and 100000),
  last_availability_check timestamptz check (last_availability_check is null or last_availability_check <= now() + interval '5 minutes'),
  last_price_check timestamptz check (last_price_check is null or last_price_check <= now() + interval '5 minutes'),
  normalized_snapshot jsonb not null check (jsonb_typeof(normalized_snapshot) = 'object' and octet_length(normalized_snapshot::text) <= 1048576),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'object' and octet_length(source_snapshot::text) <= 1048576),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array' and octet_length(warnings::text) <= 262144),
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors) = 'array' and octet_length(validation_errors::text) <= 262144),
  duplicate_supplier_product_id uuid,
  duplicate_candidate_id uuid references public.sourcing_candidates(id) on delete restrict,
  duplicate_product_id uuid references public.products(id) on delete restrict,
  duplicate_source_url boolean not null default false,
  media_status text not null default 'incomplete' check (media_status in ('ready','review_required','incomplete')),
  status text not null default 'needs_review' check (status in ('needs_review','held','rejected','approved','invalid')),
  created_product_id uuid references public.products(id) on delete restrict,
  created_listing_id uuid references public.listings(id) on delete restrict,
  created_supplier_product_id uuid,
  decided_by uuid references auth.users(id) on delete restrict,
  decision_note text check (decision_note is null or (decision_note = btrim(decision_note) and char_length(decision_note) between 10 and 2000 and decision_note !~ '[[:cntrl:]]')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (import_id, supplier_id) references public.sourcing_imports(id, supplier_id) on delete restrict,
  unique (import_id, source_sku_identity),
  check ((status='needs_review' and decided_at is null and decided_by is null and decision_note is null
      and created_product_id is null and created_listing_id is null and created_supplier_product_id is null)
    or (status='held' and decided_at is not null and decided_by is not null and decision_note is not null
      and created_product_id is null and created_listing_id is null and created_supplier_product_id is null)
    or (status='rejected' and decided_at is not null and decided_by is not null and decision_note is not null
      and created_product_id is null and created_listing_id is null and created_supplier_product_id is null)
    or (status='approved' and decided_at is not null and decided_by is not null and decision_note is not null)
    or (status='invalid' and created_product_id is null and created_listing_id is null and created_supplier_product_id is null)),
  check (status <> 'approved' or (created_product_id is not null and created_listing_id is not null and created_supplier_product_id is not null))
);

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  listing_id uuid unique references public.listings(id) on delete restrict,
  source_sku text not null check (source_sku = btrim(source_sku) and char_length(source_sku) between 2 and 160 and source_sku !~ '[[:cntrl:]]'),
  source_sku_identity text generated always as (lower(btrim(source_sku))) stored,
  manufacturer_sku text check (manufacturer_sku is null or (manufacturer_sku = btrim(manufacturer_sku) and char_length(manufacturer_sku) between 1 and 160 and manufacturer_sku !~ '[[:cntrl:]]')),
  manufacturer_sku_identity text generated always as (lower(btrim(manufacturer_sku))) stored,
  gtin text check (gtin is null or gtin ~ '^[0-9]{8,14}$'),
  source_reference text not null check (source_reference = btrim(source_reference) and char_length(source_reference) between 2 and 300 and source_reference !~ '[[:cntrl:]]'),
  source_url text check (source_url is null or source_url = private.normalize_sourcing_https_url(source_url)),
  source_url_identity text generated always as (private.normalize_sourcing_https_url(source_url)) stored,
  source_cost_minor bigint not null check (source_cost_minor between 1 and 100000000),
  currency text not null check (private.is_supported_sourcing_currency(currency)),
  availability_state text not null check (availability_state in ('checking','available','unavailable')),
  availability_verification_state text not null default 'unverified' check (availability_verification_state in ('unverified','verified')),
  availability_evidence_reference text,
  availability_verified_at timestamptz,
  stock_quantity bigint check (stock_quantity is null or stock_quantity between 0 and 1000000000),
  variants jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array' and octet_length(variants::text) <= 262144),
  handling_time_min_days integer not null default 0 check (handling_time_min_days between 0 and 365),
  handling_time_max_days integer not null default 0 check (handling_time_max_days between handling_time_min_days and 365),
  shipping jsonb not null default '{}'::jsonb check (jsonb_typeof(shipping) = 'object' and octet_length(shipping::text) <= 262144),
  minimum_order_quantity integer not null default 1 check (minimum_order_quantity between 1 and 100000),
  last_availability_check timestamptz,
  last_price_check timestamptz,
  raw_snapshot jsonb not null check (jsonb_typeof(raw_snapshot) = 'object' and octet_length(raw_snapshot::text) <= 1048576),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((availability_verification_state='unverified' and availability_state in ('checking','unavailable') and availability_evidence_reference is null and availability_verified_at is null)
    or (availability_verification_state='verified' and availability_evidence_reference ~ '^evidence://[A-Za-z0-9][A-Za-z0-9/_.:-]{8,1998}$' and availability_verified_at is not null)),
  unique (supplier_id, source_sku_identity)
);

alter table public.sourcing_candidates
  add constraint sourcing_candidates_duplicate_supplier_product_fk
  foreign key (duplicate_supplier_product_id) references public.supplier_products(id) on delete restrict,
  add constraint sourcing_candidates_created_supplier_product_fk
  foreign key (created_supplier_product_id) references public.supplier_products(id) on delete restrict;

create table public.sourcing_media_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.sourcing_candidates(id) on delete restrict,
  media_type text not null check (media_type in ('image','video','rotation_360')),
  source_url text not null check (source_url = private.normalize_sourcing_https_url(source_url)),
  source_url_identity text generated always as (private.normalize_sourcing_https_url(source_url)) stored,
  provenance_type text not null check (provenance_type in ('supplier_catalog','manufacturer_official','authorized_distributor','licensed_source','existing_zvese','synthetic')),
  rights_status text not null check (rights_status in ('claimed_authorized','unknown','restricted')),
  variant_reference text check (variant_reference is null or (variant_reference = btrim(variant_reference) and char_length(variant_reference) between 1 and 160 and variant_reference !~ '[[:cntrl:]]')),
  match_status text not null check (match_status in ('matched','review_required','rejected')),
  width integer check (width is null or width between 1 and 20000),
  height integer check (height is null or height between 1 and 20000),
  watermarked boolean not null default false,
  synthetic boolean not null default false,
  match_confidence numeric(4,3) not null check (match_confidence between 0 and 1),
  quality_score numeric(4,3) not null check (quality_score between 0 and 1),
  selected_role text not null default 'none' check (selected_role in ('none','hero','gallery','video')),
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array' and octet_length(warnings::text) <= 262144),
  created_at timestamptz not null default now(),
  unique (candidate_id, source_url_identity),
  check ((provenance_type='synthetic') = synthetic),
  check (review_status<>'approved' or (not watermarked and not synthetic and rights_status='claimed_authorized' and match_status='matched')),
  check (review_status<>'rejected' or selected_role='none'),
  check (selected_role <> 'hero' or (media_type='image' and not watermarked and not synthetic and rights_status='claimed_authorized' and match_status='matched' and match_confidence>=0.600)),
  check (selected_role <> 'gallery' or (media_type='image' and not watermarked and not synthetic and rights_status='claimed_authorized' and match_status='matched')),
  check (selected_role <> 'video' or (media_type in ('video','rotation_360') and not watermarked and not synthetic and rights_status='claimed_authorized' and match_status='matched'))
);

create table public.sourcing_review_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.sourcing_candidates(id) on delete restrict,
  decision text not null check (decision in ('approve','reject','hold')),
  from_status text not null check (from_status in ('needs_review','held')),
  to_status text not null check (to_status in ('approved','rejected','held')),
  decided_by uuid not null references auth.users(id) on delete restrict,
  note text not null check (note = btrim(note) and char_length(note) between 10 and 2000 and note !~ '[[:cntrl:]]'),
  policy_version text not null check (policy_version = btrim(policy_version) and char_length(policy_version) between 2 and 100),
  reviewed_snapshot jsonb not null check (jsonb_typeof(reviewed_snapshot)='object' and octet_length(reviewed_snapshot::text)<=4194304),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (candidate_id, decision, snapshot_hash),
  check ((decision='approve' and to_status='approved') or (decision='reject' and to_status='rejected') or (decision='hold' and to_status='held'))
);

create table public.sourcing_media_review_events (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null unique references public.sourcing_media_candidates(id) on delete restrict,
  decision text not null check (decision in ('approve','reject')),
  from_status text not null check (from_status='pending'),
  to_status text not null check (to_status in ('approved','rejected')),
  decided_by uuid not null references auth.users(id) on delete restrict,
  note text not null check (note = btrim(note) and char_length(note) between 10 and 2000 and note !~ '[[:cntrl:]]'),
  policy_version text not null check (policy_version = btrim(policy_version) and char_length(policy_version) between 2 and 100),
  reviewed_snapshot jsonb not null check (jsonb_typeof(reviewed_snapshot)='object' and octet_length(reviewed_snapshot::text)<=1048576),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check ((decision='approve' and to_status='approved') or (decision='reject' and to_status='rejected'))
);

create table public.supplier_status_events (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  from_status text not null check (from_status in ('none','pending','active','held','suspended','rejected','closed')),
  to_status text not null check (to_status in ('pending','active','held','suspended','rejected','closed')),
  decided_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (from_status='none' or from_status<>to_status)
);

create table public.supplier_availability_verification_events (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references public.supplier_products(id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  availability_state text not null check (availability_state in ('available','unavailable')),
  evidence_reference text not null check (evidence_reference ~ '^evidence://[A-Za-z0-9][A-Za-z0-9/_.:-]{8,1998}$'),
  observed_at timestamptz not null,
  verified_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (observed_at <= created_at + interval '5 minutes' and observed_at >= created_at - interval '24 hours')
);

create index suppliers_status_idx on public.suppliers(status);
create index supplier_products_supplier_availability_idx on public.supplier_products(supplier_id, availability_state);
create unique index supplier_products_supplier_gtin_idx on public.supplier_products(supplier_id, gtin) where gtin is not null;
create index supplier_products_manufacturer_sku_idx on public.supplier_products(supplier_id, manufacturer_sku_identity) where manufacturer_sku_identity is not null;
create index supplier_products_source_url_idx on public.supplier_products(supplier_id, source_url_identity) where source_url_identity is not null;
create index sourcing_imports_supplier_created_idx on public.sourcing_imports(supplier_id, created_at desc);
create index sourcing_candidates_status_created_idx on public.sourcing_candidates(status, created_at desc);
create unique index sourcing_candidates_live_supplier_sku_idx on public.sourcing_candidates(supplier_id, source_sku_identity) where status in ('needs_review','held','approved');
create unique index sourcing_candidates_live_supplier_gtin_idx on public.sourcing_candidates(supplier_id, gtin) where gtin is not null and status in ('needs_review','held','approved');
create index sourcing_candidates_manufacturer_sku_idx on public.sourcing_candidates(supplier_id, manufacturer_sku_identity) where manufacturer_sku_identity is not null;
create index sourcing_candidates_source_url_idx on public.sourcing_candidates(supplier_id, source_url_identity) where source_url_identity is not null;
create index sourcing_media_candidate_idx on public.sourcing_media_candidates(candidate_id, selected_role);
create index sourcing_review_candidate_idx on public.sourcing_review_events(candidate_id, created_at desc);
create index supplier_status_events_supplier_idx on public.supplier_status_events(supplier_id, created_at desc);
create index supplier_availability_events_product_idx on public.supplier_availability_verification_events(supplier_product_id, created_at desc);

create function private.set_sourcing_import_completed_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('validated','failed','completed') then
    if tg_op='INSERT' then
      new.completed_at:=greatest(new.created_at,pg_catalog.clock_timestamp());
    elsif old.status not in ('validated','failed','completed') then
      new.completed_at:=greatest(new.created_at,pg_catalog.clock_timestamp());
    else
      new.completed_at:=old.completed_at;
    end if;
  else
    new.completed_at:=null;
  end if;
  return new;
end; $$;

create function private.enforce_initial_sourcing_candidate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from 'needs_review' or new.decided_by is not null or new.decided_at is not null
    or new.decision_note is not null or new.created_product_id is not null or new.created_listing_id is not null
    or new.created_supplier_product_id is not null then
    raise exception 'Imported sourcing candidates must begin undecided in needs_review' using errcode='42501';
  end if;
  return new;
end; $$;

create function private.enforce_sourcing_media_decision_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then
    raise exception 'Sourcing media evidence is immutable' using errcode='55000';
  end if;
  if old.review_status='pending' and new.review_status in ('approved','rejected')
    -- Stored generated values are recomputed after BEFORE triggers; compare their source instead.
    and (to_jsonb(new) - ARRAY['review_status','source_url_identity'])
      is not distinct from (to_jsonb(old) - ARRAY['review_status','source_url_identity']) then
    return new;
  end if;
  raise exception 'Sourcing media may only be decided through the controlled review operation' using errcode='55000';
end; $$;

create function private.enforce_sourcing_candidate_media_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The candidate row lock serializes approval with media inserts/reviews, which take FOR SHARE.
  if new.status='approved' and old.status is distinct from new.status then
    if not exists(select 1 from public.sourcing_media_candidates m where m.candidate_id=new.id
      and m.selected_role='hero' and m.media_type='image' and m.review_status='approved')
      or exists(select 1 from public.sourcing_media_candidates m where m.candidate_id=new.id
        and m.selected_role<>'none' and (m.review_status<>'approved' or m.watermarked or m.synthetic
          or m.rights_status<>'claimed_authorized' or m.match_status<>'matched' or m.match_confidence<0.600)) then
      raise exception 'An approved hero image and approved valid selected media are required before draft approval' using errcode='55000';
    end if;
  end if;
  return new;
end; $$;

create trigger suppliers_set_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
create trigger supplier_products_set_updated_at before update on public.supplier_products for each row execute function public.set_updated_at();
create trigger sourcing_media_immutable before update or delete on public.sourcing_media_candidates for each row execute function private.enforce_sourcing_media_decision_transition();
create trigger sourcing_review_events_immutable before update or delete on public.sourcing_review_events for each row execute function private.immutable_product_record();
create trigger sourcing_media_review_events_immutable before update or delete on public.sourcing_media_review_events for each row execute function private.immutable_product_record();
create trigger supplier_status_events_immutable before update or delete on public.supplier_status_events for each row execute function private.immutable_product_record();
create trigger supplier_availability_events_immutable before update or delete on public.supplier_availability_verification_events for each row execute function private.immutable_product_record();
create trigger sourcing_media_no_truncate before truncate on public.sourcing_media_candidates for each statement execute function private.immutable_product_record();
create trigger sourcing_review_events_no_truncate before truncate on public.sourcing_review_events for each statement execute function private.immutable_product_record();
create trigger sourcing_media_review_events_no_truncate before truncate on public.sourcing_media_review_events for each statement execute function private.immutable_product_record();
create trigger supplier_status_events_no_truncate before truncate on public.supplier_status_events for each statement execute function private.immutable_product_record();
create trigger supplier_availability_events_no_truncate before truncate on public.supplier_availability_verification_events for each statement execute function private.immutable_product_record();

create function private.enforce_supplier_product_availability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.availability_state='available' and (new.availability_verification_state<>'verified'
    or not exists(select 1 from public.suppliers s where s.id=new.supplier_id and s.status='active')) then
    raise exception 'Verified availability from an active supplier is required' using errcode='55000';
  end if;
  return new;
end; $$;

create function private.enforce_active_sourcing_supplier()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.suppliers s where s.id=new.supplier_id and s.status='active' for share;
  if not found then
    raise exception 'Active supplier required for sourcing imports and candidates' using errcode='42501';
  end if;
  return new;
end; $$;

create function private.enforce_open_media_candidate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.review_status is distinct from 'pending' then
    raise exception 'Imported sourcing media must begin pending review' using errcode='42501';
  end if;
  perform 1 from public.sourcing_candidates c where c.id=new.candidate_id and c.status in ('needs_review','held') for share;
  if not found then
    raise exception 'Media can only be attached to an open sourcing candidate' using errcode='55000';
  end if;
  return new;
end; $$;

create function private.enforce_sourced_listing_availability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.availability_mode='source_managed' and new.availability_state='available'
    and exists(select 1 from public.supplier_products sp where sp.listing_id=new.id)
    and not exists(select 1 from public.supplier_products sp join public.suppliers s on s.id=sp.supplier_id
      where sp.listing_id=new.id and sp.availability_state='available' and sp.availability_verification_state='verified' and s.status='active') then
    raise exception 'Listing source is not verified available' using errcode='55000';
  end if;
  return new;
end; $$;

create function private.cascade_inactive_supplier_availability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status<>'active' and old.status is distinct from new.status then
    update public.supplier_products set availability_state='unavailable',availability_verification_state='unverified',
      availability_evidence_reference=null,availability_verified_at=null where supplier_id=new.id;
    update public.listings l set availability_state='unavailable'
      where l.availability_mode='source_managed' and exists(select 1 from public.supplier_products sp where sp.listing_id=l.id and sp.supplier_id=new.id);
  end if;
  return new;
end; $$;

create trigger enforce_supplier_product_availability before insert or update of availability_state,availability_verification_state,supplier_id
  on public.supplier_products for each row execute function private.enforce_supplier_product_availability();
create trigger enforce_active_import_supplier before insert or update of supplier_id
  on public.sourcing_imports for each row execute function private.enforce_active_sourcing_supplier();
create trigger set_sourcing_import_completed_at before insert or update
  on public.sourcing_imports for each row execute function private.set_sourcing_import_completed_at();
create trigger enforce_active_candidate_supplier before insert or update of supplier_id
  on public.sourcing_candidates for each row execute function private.enforce_active_sourcing_supplier();
create trigger enforce_initial_sourcing_candidate before insert
  on public.sourcing_candidates for each row execute function private.enforce_initial_sourcing_candidate();
create trigger enforce_sourcing_candidate_media_approval before update of status
  on public.sourcing_candidates for each row execute function private.enforce_sourcing_candidate_media_approval();
create trigger enforce_open_media_candidate before insert
  on public.sourcing_media_candidates for each row execute function private.enforce_open_media_candidate();
create trigger enforce_sourced_listing_availability before insert or update of availability_state,availability_mode
  on public.listings for each row execute function private.enforce_sourced_listing_availability();
create trigger cascade_inactive_supplier_availability after update of status
  on public.suppliers for each row execute function private.cascade_inactive_supplier_availability();

do $$ declare t text; begin
  foreach t in array array['suppliers','supplier_products','sourcing_imports','sourcing_candidates','sourcing_media_candidates','sourcing_review_events','sourcing_media_review_events','supplier_status_events','supplier_availability_verification_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role', t);
  end loop;
end $$;

grant select on public.suppliers,public.supplier_products,public.sourcing_imports,public.sourcing_candidates,
  public.sourcing_media_candidates,public.sourcing_review_events,public.sourcing_media_review_events,public.supplier_status_events,
  public.supplier_availability_verification_events to service_role;
grant insert (supplier_id,import_type,source_reference,status,raw_payload,summary,submitted_by)
  on public.sourcing_imports to service_role;
grant insert (import_id,supplier_id,target_seller_id,category_id,source_sku,manufacturer_sku,gtin,source_reference,source_url,
  title,description,brand,source_cost_minor,proposed_price_minor,currency,estimated_gross_margin_bps,pricing_policy,
  availability_state,stock_quantity,variants,sizes,handling_time_min_days,handling_time_max_days,shipping,
  minimum_order_quantity,last_availability_check,last_price_check,normalized_snapshot,source_snapshot,warnings,validation_errors,
  duplicate_supplier_product_id,duplicate_candidate_id,duplicate_product_id,duplicate_source_url,media_status)
  on public.sourcing_candidates to service_role;
grant insert (candidate_id,media_type,source_url,provenance_type,rights_status,variant_reference,match_status,width,height,
  watermarked,synthetic,match_confidence,quality_score,selected_role,warnings)
  on public.sourcing_media_candidates to service_role;

create function public.create_supplier(p_admin_id uuid,p_code text,p_display_name text,p_supplier_type text,p_status text,p_website_url text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.admin_memberships am where am.user_id=p_admin_id and am.role='super_admin' and am.is_active=true) then
    raise exception 'Active super administrator required' using errcode='42501';
  end if;
  if p_code is null or p_display_name is null or p_supplier_type not in ('supplier','manufacturer','authorized_distributor')
    or p_status not in ('pending','active','held','suspended','rejected','closed') then
    raise exception 'Invalid supplier details' using errcode='22023';
  end if;
  insert into public.suppliers(code,display_name,supplier_type,status,website_url,created_by)
    values(lower(btrim(p_code)),btrim(p_display_name),p_supplier_type,p_status,
      case when nullif(btrim(p_website_url),'') is null then null else private.normalize_sourcing_https_url(p_website_url) end,p_admin_id)
    returning id into v_id;
  insert into public.supplier_status_events(supplier_id,from_status,to_status,decided_by) values(v_id,'none',p_status,p_admin_id);
  return v_id;
end; $$;

create function public.set_supplier_status(p_supplier_id uuid, p_admin_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_status text;
begin
  if not exists(select 1 from public.admin_memberships am where am.user_id=p_admin_id and am.role='super_admin' and am.is_active=true) then
    raise exception 'Active super administrator required' using errcode='42501';
  end if;
  if p_status not in ('pending','active','held','suspended','rejected','closed') then raise exception 'Invalid supplier status' using errcode='22023'; end if;
  select status into old_status from public.suppliers where id=p_supplier_id for update;
  if not found then raise exception 'Supplier not found' using errcode='P0002'; end if;
  if old_status=p_status then return; end if;
  update public.suppliers set status=p_status where id=p_supplier_id;
  insert into public.supplier_status_events(supplier_id,from_status,to_status,decided_by) values(p_supplier_id,old_status,p_status,p_admin_id);
end; $$;

create function public.record_supplier_availability_verification(p_supplier_product_id uuid,p_admin_id uuid,p_availability text,p_evidence_reference text,p_observed_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare sp public.supplier_products; s public.suppliers;
begin
  if not exists(select 1 from public.admin_memberships am where am.user_id=p_admin_id and am.role='super_admin' and am.is_active=true) then
    raise exception 'Active super administrator required' using errcode='42501';
  end if;
  if p_availability not in ('available','unavailable') or p_evidence_reference is null
    or p_evidence_reference !~ '^evidence://[A-Za-z0-9][A-Za-z0-9/_.:-]{8,1998}$'
    or p_observed_at is null or p_observed_at>now()+interval '5 minutes' or p_observed_at<now()-interval '24 hours' then
    raise exception 'Fresh trusted availability evidence is required' using errcode='22023';
  end if;
  select * into sp from public.supplier_products where id=p_supplier_product_id for update;
  if not found or sp.listing_id is null then raise exception 'Supplier product unavailable' using errcode='P0002'; end if;
  select * into s from public.suppliers where id=sp.supplier_id for share;
  if p_availability='available' and s.status<>'active' then raise exception 'Active supplier required' using errcode='42501'; end if;
  update public.supplier_products set availability_state=p_availability,availability_verification_state='verified',
    availability_evidence_reference=p_evidence_reference,availability_verified_at=p_observed_at,last_availability_check=p_observed_at where id=sp.id;
  update public.listings set availability_state=p_availability where id=sp.listing_id and availability_mode='source_managed';
  if not found then raise exception 'Linked source-managed listing unavailable' using errcode='55000'; end if;
  insert into public.supplier_availability_verification_events(supplier_product_id,listing_id,availability_state,evidence_reference,observed_at,verified_by)
    values(sp.id,sp.listing_id,p_availability,p_evidence_reference,p_observed_at,p_admin_id);
end; $$;

create function public.record_sourcing_media_decision(p_media_id uuid,p_admin_id uuid,p_decision text,p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.sourcing_media_candidates;
  c public.sourcing_candidates;
  v_candidate_id uuid;
  v_to_status text;
  v_policy_version text := 'sourcing-media-review-v2';
  v_snapshot jsonb;
  v_snapshot_hash text;
begin
  if not exists(select 1 from public.admin_memberships am where am.user_id=p_admin_id and am.role='super_admin' and am.is_active=true) then
    raise exception 'Active super administrator required' using errcode='42501';
  end if;
  if p_decision not in ('approve','reject') or p_note is null
    or char_length(btrim(p_note)) not between 10 and 2000 or p_note ~ '[[:cntrl:]]' then
    raise exception 'Invalid sourcing media decision' using errcode='22023';
  end if;
  select sm.candidate_id into v_candidate_id from public.sourcing_media_candidates sm where sm.id=p_media_id;
  if not found then raise exception 'Sourcing media unavailable' using errcode='P0002'; end if;
  select * into c from public.sourcing_candidates sc where sc.id=v_candidate_id for share;
  if not found or c.status not in ('needs_review','held') then
    raise exception 'Media can only be reviewed for an open sourcing candidate' using errcode='55000';
  end if;
  select * into m from public.sourcing_media_candidates sm where sm.id=p_media_id and sm.candidate_id=c.id for update;
  if not found or m.review_status<>'pending' then raise exception 'Sourcing media unavailable or already decided' using errcode='55000'; end if;
  if p_decision='approve' and (m.watermarked or m.synthetic or m.rights_status<>'claimed_authorized'
    or m.match_status<>'matched' or m.match_confidence<0.600) then
    raise exception 'Media provenance, rights, and product match must pass review before approval' using errcode='55000';
  end if;

  v_to_status:=case p_decision when 'approve' then 'approved' else 'rejected' end;
  v_snapshot:=jsonb_build_object(
    'policy_version',v_policy_version,
    'candidate',jsonb_build_object('id',c.id,'supplier_id',c.supplier_id,'source_sku',c.source_sku,
      'manufacturer_sku',c.manufacturer_sku,'gtin',c.gtin,'source_url_identity',c.source_url_identity),
    'media',jsonb_build_object('id',m.id,'candidate_id',m.candidate_id,'media_type',m.media_type,
      'source_url',m.source_url,'source_url_identity',m.source_url_identity,'provenance_type',m.provenance_type,
      'rights_status',m.rights_status,'variant_reference',m.variant_reference,'match_status',m.match_status,
      'width',m.width,'height',m.height,'watermarked',m.watermarked,'synthetic',m.synthetic,
      'match_confidence',m.match_confidence,'quality_score',m.quality_score,'selected_role',m.selected_role,
      'review_status',m.review_status,'warnings',m.warnings)
  );
  v_snapshot_hash:=encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  update public.sourcing_media_candidates set review_status=v_to_status where id=m.id;
  insert into public.sourcing_media_review_events(media_id,decision,from_status,to_status,decided_by,note,policy_version,reviewed_snapshot,snapshot_hash)
    values(m.id,p_decision,m.review_status,v_to_status,p_admin_id,btrim(p_note),v_policy_version,v_snapshot,v_snapshot_hash);
end; $$;

create function public.record_sourcing_decision(p_candidate_id uuid, p_admin_id uuid, p_decision text, p_note text)
returns table(candidate_id uuid, product_id uuid, listing_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  c public.sourcing_candidates;
  i public.sourcing_imports;
  s public.suppliers;
  seller public.seller_profiles;
  v_product uuid;
  v_listing uuid;
  v_supplier_product uuid;
  v_to_status text;
  v_source_type text;
  v_policy_version text := 'sourcing-review-v2';
  v_media jsonb;
  v_snapshot jsonb;
  v_snapshot_hash text;
begin
  if not exists(select 1 from public.admin_memberships am where am.user_id=p_admin_id and am.role='super_admin' and am.is_active=true) then
    raise exception 'Active super administrator required' using errcode='42501';
  end if;
  if p_decision not in ('approve','reject','hold') or p_note is null or char_length(btrim(p_note)) not between 10 and 2000 or p_note ~ '[[:cntrl:]]' then
    raise exception 'Invalid sourcing decision' using errcode='22023';
  end if;
  select * into c from public.sourcing_candidates sc where sc.id=p_candidate_id for update;
  if not found or c.status not in ('needs_review','held') then raise exception 'Candidate unavailable or already decided' using errcode='55000'; end if;
  select * into i from public.sourcing_imports si where si.id=c.import_id and si.supplier_id=c.supplier_id for share;
  if not found then raise exception 'Import and supplier identity mismatch' using errcode='55000'; end if;
  select * into s from public.suppliers x where x.id=c.supplier_id for share;
  select * into seller from public.seller_profiles sp where sp.id=c.target_seller_id for share;
  if s.status<>'active' then raise exception 'Active supplier required' using errcode='42501'; end if;
  if seller.status<>'active' then raise exception 'Active seller required' using errcode='42501'; end if;
  if not exists(select 1 from public.categories cat where cat.id=c.category_id and cat.is_active=true) then raise exception 'Active category required' using errcode='55000'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'media_type',m.media_type,'source_url',m.source_url,'source_url_identity',m.source_url_identity,
    'provenance_type',m.provenance_type,'rights_status',m.rights_status,'variant_reference',m.variant_reference,
    'match_status',m.match_status,'width',m.width,'height',m.height,'watermarked',m.watermarked,'synthetic',m.synthetic,
    'review_status',m.review_status,
    'match_confidence',m.match_confidence,'quality_score',m.quality_score,'selected_role',m.selected_role,'warnings',m.warnings
  ) order by m.id),'[]'::jsonb) into v_media from public.sourcing_media_candidates m where m.candidate_id=c.id;
  v_snapshot:=jsonb_build_object(
    'policy_version',v_policy_version,
    'candidate_id',c.id,
    'import',jsonb_build_object('id',i.id,'type',i.import_type,'source_reference',i.source_reference,'supplier_id',i.supplier_id),
    'supplier',jsonb_build_object('id',s.id,'code',s.code,'name',s.display_name,'type',s.supplier_type,'status',s.status),
    'target_seller_id',c.target_seller_id,'category_id',c.category_id,
    'source_identity',jsonb_build_object('source_sku',c.source_sku,'source_sku_identity',c.source_sku_identity,
      'manufacturer_sku',c.manufacturer_sku,'manufacturer_sku_identity',c.manufacturer_sku_identity,'gtin',c.gtin,
      'source_reference',c.source_reference,'source_url',c.source_url,'source_url_identity',c.source_url_identity),
    'product',jsonb_build_object('title',c.title,'description',c.description,'brand',c.brand,'variants',c.variants,'sizes',c.sizes),
    'financials',jsonb_build_object('source_cost_minor',c.source_cost_minor,'proposed_price_minor',c.proposed_price_minor,
      'currency',c.currency,'estimated_gross_margin_bps',c.estimated_gross_margin_bps,'pricing_policy',c.pricing_policy),
    'availability',jsonb_build_object('state',c.availability_state,'verification_state',c.availability_verification_state,
      'stock_quantity',c.stock_quantity,'last_claim_check',c.last_availability_check),
    'fulfillment',jsonb_build_object('handling_min_days',c.handling_time_min_days,'handling_max_days',c.handling_time_max_days,
      'shipping',c.shipping,'minimum_order_quantity',c.minimum_order_quantity),
    'warnings',c.warnings,'validation_errors',c.validation_errors,'duplicate_supplier_product_id',c.duplicate_supplier_product_id,
    'duplicate_candidate_id',c.duplicate_candidate_id,'duplicate_product_id',c.duplicate_product_id,'duplicate_source_url',c.duplicate_source_url,
    'normalized_snapshot',c.normalized_snapshot,'source_snapshot',c.source_snapshot,'media_status',c.media_status,'media',v_media
  );
  v_snapshot_hash:=encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');

  v_to_status:=case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'held' end;
  if p_decision='approve' then
    if c.validation_errors <> '[]'::jsonb or c.duplicate_supplier_product_id is not null or c.duplicate_candidate_id is not null or c.duplicate_product_id is not null then
      raise exception 'Resolve validation and duplicate warnings before approval' using errcode='55000';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.supplier_id::text||'|'||coalesce(c.gtin,c.source_sku_identity),0));
    if exists(select 1 from public.supplier_products sp where sp.supplier_id=c.supplier_id
      and (sp.source_sku_identity=c.source_sku_identity or (c.gtin is not null and sp.gtin=c.gtin))) then
      raise exception 'Supplier product already exists' using errcode='23505';
    end if;
    if c.gtin is null and c.manufacturer_sku is null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(btrim(c.title))||'|'||coalesce(lower(btrim(c.brand)),''),0));
      if exists(select 1 from public.products p where lower(btrim(p.title))=lower(btrim(c.title)) and coalesce(lower(btrim(p.brand)),'')=coalesce(lower(btrim(c.brand)),'')) then
        raise exception 'Possible duplicate Zvese product exists' using errcode='23505';
      end if;
    end if;
    v_product:=gen_random_uuid();
    insert into public.products(id,created_by,category_id,title,slug,description,brand,status)
      values(v_product,seller.user_id,c.category_id,c.title,'sourced-'||c.id::text,c.description,c.brand,'draft');
    insert into public.listings(seller_id,product_id,title,price_minor,currency,inventory_quantity,inventory_mode,status,availability_mode,availability_state,review_state)
      values(seller.id,v_product,null,c.proposed_price_minor,c.currency,0,'external','draft','source_managed',c.availability_state,'draft')
      returning id into v_listing;
    v_source_type:=case when s.supplier_type='manufacturer' then 'manufacturer' else 'supplier' end;
    insert into public.listing_sources(listing_id,source_type,partner_reference)
      values(v_listing,v_source_type,left(s.code||':'||c.source_sku,300));
    insert into public.supplier_products(supplier_id,listing_id,source_sku,manufacturer_sku,gtin,source_reference,source_url,source_cost_minor,currency,
      availability_state,availability_verification_state,stock_quantity,variants,handling_time_min_days,handling_time_max_days,shipping,
      minimum_order_quantity,last_availability_check,last_price_check,raw_snapshot)
      values(c.supplier_id,v_listing,c.source_sku,c.manufacturer_sku,c.gtin,c.source_reference,c.source_url,c.source_cost_minor,c.currency,
      c.availability_state,'unverified',c.stock_quantity,c.variants,c.handling_time_min_days,c.handling_time_max_days,c.shipping,
      c.minimum_order_quantity,c.last_availability_check,c.last_price_check,c.source_snapshot)
      returning id into v_supplier_product;
  end if;
  update public.sourcing_candidates set status=v_to_status,created_product_id=v_product,created_listing_id=v_listing,
    created_supplier_product_id=v_supplier_product,decided_by=p_admin_id,decision_note=btrim(p_note),decided_at=now()
    where id=c.id;
  insert into public.sourcing_review_events(candidate_id,decision,from_status,to_status,decided_by,note,policy_version,reviewed_snapshot,snapshot_hash)
    values(c.id,p_decision,c.status,v_to_status,p_admin_id,btrim(p_note),v_policy_version,v_snapshot,v_snapshot_hash);
  return query select c.id,v_product,v_listing;
end; $$;

revoke all on function private.normalize_sourcing_https_url(text),private.is_supported_sourcing_currency(text),
  private.set_sourcing_import_completed_at(),private.enforce_supplier_product_availability(),private.enforce_active_sourcing_supplier(),
  private.enforce_initial_sourcing_candidate(),private.enforce_sourcing_candidate_media_approval(),
  private.enforce_sourcing_media_decision_transition(),private.enforce_open_media_candidate(),
  private.enforce_sourced_listing_availability(),private.cascade_inactive_supplier_availability()
  from public,anon,authenticated,service_role;
grant execute on function private.normalize_sourcing_https_url(text),private.is_supported_sourcing_currency(text) to service_role;
revoke all on function public.create_supplier(uuid,text,text,text,text,text),public.set_supplier_status(uuid,uuid,text),
  public.record_supplier_availability_verification(uuid,uuid,text,text,timestamptz),public.record_sourcing_media_decision(uuid,uuid,text,text),
  public.record_sourcing_decision(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.create_supplier(uuid,text,text,text,text,text),public.set_supplier_status(uuid,uuid,text),
  public.record_supplier_availability_verification(uuid,uuid,text,text,timestamptz),public.record_sourcing_media_decision(uuid,uuid,text,text),
  public.record_sourcing_decision(uuid,uuid,text,text) to service_role;

comment on function public.record_sourcing_decision(uuid,uuid,text,text) is
  'Service-only atomic sourcing decision. Every decision binds an immutable reviewed snapshot hash. Approval creates draft product/listing records only.';
comment on function public.record_supplier_availability_verification(uuid,uuid,text,text,timestamptz) is
  'Service-only trusted availability evidence path. Reactivation never restores availability without a new verification.';
comment on function public.record_sourcing_media_decision(uuid,uuid,text,text) is
  'Service-only atomic media decision. It is the sole review-status transition and writes immutable reviewed evidence.';

commit;
