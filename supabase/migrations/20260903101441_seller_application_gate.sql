grant select on table public.seller_profiles to authenticated;

grant insert on table public.seller_profiles to authenticated;

alter table public.seller_profiles
  drop constraint seller_profiles_store_slug_check,
  add constraint seller_profiles_store_slug_check
  check (
    store_slug = trim(store_slug)
    and store_slug = lower(store_slug)
    and char_length(store_slug) between 2 and 160
    and store_slug ~ '^[a-z0-9_]([a-z0-9._]*[a-z0-9_])?$'
    and strpos(store_slug, '..') = 0
  );
