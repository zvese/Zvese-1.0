-- UNAPPLIED proposal revised after audit. If this timestamp exists remotely,
-- STOP: prepare a forward migration instead of replacing an applied migration.
begin;
alter table public.listings
 add column availability_mode text not null default 'source_managed' check(availability_mode='source_managed'),
 add column availability_state text not null default 'checking' check(availability_state in ('checking','available','unavailable')),
 add column review_state text not null default 'legacy_unreviewed' check(review_state in ('legacy_unreviewed','draft','pending_review','approved','rejected','withdrawn')),
 add column current_revision integer not null default 0 check(current_revision>=0),
 add column draft_epoch uuid not null default gen_random_uuid(),
 add column submitted_at timestamptz, add column reviewed_at timestamptz, add column deleted_at timestamptz;
-- Preserve pre-existing active listing visibility, without claiming verification.
alter table public.listings alter column review_state set default 'draft';
create table public.listing_sources (
 listing_id uuid primary key references public.listings(id) on delete restrict,
 source_type text not null check(source_type in ('supplier','manufacturer','production_partner','pod_partner','customization_partner','other')),
 partner_reference text not null check(char_length(trim(partner_reference)) between 2 and 300)
);
create table public.product_files (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings(id) on delete restrict,
 draft_epoch uuid not null, visibility text not null check(visibility in ('public','private')),
 bucket_id text not null check(bucket_id in ('product-images','product-videos','product-public-documents','product-private-documents')),
 object_path text not null, original_name text not null check(char_length(original_name) between 1 and 255),
 mime_type text not null, size_bytes bigint not null check(size_bytes between 1 and 104857600),
 reservation_state text not null default 'reserved' check(reservation_state in ('reserved','finalized','cancelled','expired')),
 expires_at timestamptz not null default(clock_timestamp()+interval '30 minutes'), storage_version text, finalized_at timestamptz,
 content_validation_state text not null default 'pending' check(content_validation_state in ('pending','passed','failed')),
 created_at timestamptz not null default now(), unique(bucket_id,object_path), unique(id,listing_id), unique(id,storage_version),
 check((reservation_state='finalized')=(storage_version is not null and finalized_at is not null))
);
create index product_files_listing_idx on public.product_files(listing_id);
create table public.listing_draft_files (
 listing_id uuid not null references public.listings(id) on delete restrict, file_id uuid primary key,
 foreign key(file_id,listing_id) references public.product_files(id,listing_id) on delete restrict
);
create table public.listing_submissions (
 listing_id uuid not null references public.listings(id) on delete restrict, revision integer not null check(revision>0),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'), snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 submitted_at timestamptz not null default now(), primary key(listing_id,revision)
);
create table public.submission_files (
 listing_id uuid not null, revision integer not null, file_id uuid not null, storage_version text not null,
 primary key(listing_id,revision,file_id),
 foreign key(listing_id,revision) references public.listing_submissions(listing_id,revision) on delete restrict,
 foreign key(file_id,listing_id) references public.product_files(id,listing_id) on delete restrict,
 foreign key(file_id,storage_version) references public.product_files(id,storage_version) on delete restrict
);
create table public.product_file_validations (
 file_id uuid primary key, storage_version text not null, job_id uuid not null unique,
 state text not null check(state in ('passed','failed')), content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
 validator text not null check(char_length(trim(validator)) between 2 and 100),
 evidence_reference text not null check(char_length(evidence_reference) between 10 and 2000 and evidence_reference ~ '^evidence://[A-Za-z0-9][A-Za-z0-9/_.:-]+$'),
 validated_at timestamptz not null default now(), vault_path text unique, vault_version text,
 foreign key(file_id,storage_version) references public.product_files(id,storage_version) on delete restrict,
 check((state='passed' and vault_path is not null and vault_version is not null) or (state='failed' and vault_path is null and vault_version is null))
);
create table public.product_review_events (
 id uuid primary key default gen_random_uuid(), job_id uuid not null unique, listing_id uuid not null, revision integer not null,
 decision text not null check(decision in ('approved','rejected')), availability_state text not null check(availability_state in ('checking','available','unavailable')),
 snapshot_hash text not null, files_fingerprint text not null, provenance jsonb not null check(jsonb_typeof(provenance)='object'),
 created_at timestamptz not null default now(), unique(listing_id,revision),
 foreign key(listing_id,revision) references public.listing_submissions(listing_id,revision) on delete restrict
);
create table public.product_cleanup_queue (
 bucket_id text not null, object_path text not null, reason text not null, first_seen_at timestamptz not null default now(),
 not_before timestamptz not null, status text not null default 'needs_review' check(status in ('needs_review','approved','completed')),
 primary key(bucket_id,object_path)
);
revoke all on public.products,public.listings from public,anon,authenticated,service_role;
revoke execute on function public.create_product_listing(text,text,bigint,bigint,text,text,uuid) from public,anon,authenticated,service_role;
grant select on public.products,public.listings to anon,authenticated,service_role;
drop policy "Users can create their own products" on public.products;
drop policy "Users can update their own products" on public.products;
drop policy "Users can delete their own products" on public.products;
drop policy "Sellers can create their own listings" on public.listings;
drop policy "Sellers can update their own listings" on public.listings;
drop policy "Sellers can delete their own listings" on public.listings;
do $$ declare t text; begin
 foreach t in array array['listing_sources','product_files','listing_draft_files','listing_submissions','submission_files','product_file_validations','product_review_events','product_cleanup_queue'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to service_role',t);
 end loop;
end $$;
grant select on public.listing_sources,public.listing_draft_files to authenticated;
-- No storage paths, object versions or tokens in ordinary metadata queries.
grant select(id,listing_id,visibility,original_name,mime_type,size_bytes,reservation_state,expires_at,content_validation_state,created_at) on public.product_files to anon,authenticated;
create function private.immutable_product_record() returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'Immutable product evidence' using errcode='55000'; end; $$;
create trigger immutable_submission before update or delete on public.listing_submissions for each row execute function private.immutable_product_record();
create trigger immutable_submission_files before update or delete on public.submission_files for each row execute function private.immutable_product_record();
create trigger immutable_validation before update or delete on public.product_file_validations for each row execute function private.immutable_product_record();
create trigger immutable_product_review before update or delete on public.product_review_events for each row execute function private.immutable_product_record();
create function private.owns_active_listing(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.listings l join public.seller_profiles s on s.id=l.seller_id join public.products p on p.id=l.product_id
 where l.id=p_id and s.user_id=auth.uid() and s.status='active' and p.created_by=auth.uid() and l.deleted_at is null);
$$;
create function private.lock_owned_listing(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform l.id from public.listings l join public.seller_profiles s on s.id=l.seller_id join public.products p on p.id=l.product_id
 where l.id=p_id and s.user_id=auth.uid() and s.status='active' and p.created_by=auth.uid() and l.deleted_at is null for update of l for share of s;
 if not found then raise exception 'Active listing owner required' using errcode='42501'; end if;
end; $$;
create function private.lock_listing_draft(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.lock_owned_listing(p_id);
 if not exists(select 1 from public.listings where id=p_id and review_state='draft') then raise exception 'Start a new draft before editing' using errcode='55000'; end if;
end; $$;
create function private.validated_file_intact(p_file uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.product_files f join public.product_file_validations v on v.file_id=f.id and v.storage_version=f.storage_version
 join storage.objects o on o.bucket_id='product-validated-files' and o.name=v.vault_path and o.version=v.vault_version
 where f.id=p_file and f.reservation_state='finalized' and f.content_validation_state='passed' and v.state='passed'
 and o.metadata->>'mimetype'=f.mime_type and (o.metadata->>'size')::bigint=f.size_bytes);
$$;
create function private.listing_is_public(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.listings l join public.seller_profiles s on s.id=l.seller_id join public.products p on p.id=l.product_id
 where l.id=p_id and l.deleted_at is null and l.status='active' and s.status='active' and p.status='active'
 and (l.review_state='legacy_unreviewed' or (l.review_state='approved'
 and exists(select 1 from public.product_review_events e where e.listing_id=l.id and e.revision=l.current_revision and e.decision='approved')
 and not exists(select 1 from public.submission_files sf where sf.listing_id=l.id and sf.revision=l.current_revision and not private.validated_file_intact(sf.file_id)))));
$$;
create function private.can_read_product_file(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.product_files f where f.id=p_id and (private.owns_active_listing(f.listing_id)
 or (f.visibility='public' and private.validated_file_intact(f.id) and private.listing_is_public(f.listing_id)
 and exists(select 1 from public.submission_files sf join public.listings l on l.id=sf.listing_id and l.current_revision=sf.revision where sf.file_id=f.id and sf.listing_id=f.listing_id))));
$$;
drop policy "Active listings are publicly viewable" on public.listings;
create policy "Eligible listings are public" on public.listings for select to anon,authenticated using(private.listing_is_public(id));
drop policy "Active products are publicly viewable" on public.products;
create policy "Eligible products are public" on public.products for select to anon,authenticated using(exists(select 1 from public.listings l where l.product_id=products.id and private.listing_is_public(l.id)));
create policy "Owners read source" on public.listing_sources for select to authenticated using(private.owns_active_listing(listing_id));
create policy "Owners read draft files" on public.listing_draft_files for select to authenticated using(private.owns_active_listing(listing_id));
create policy "Eligible file metadata" on public.product_files for select to anon,authenticated using(private.can_read_product_file(id));
create function public.begin_listing_revision(p_listing_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_product uuid;
begin
 perform private.lock_owned_listing(p_listing_id);
 select product_id into v_product from public.listings where id=p_listing_id;
 if exists(select 1 from public.listings where product_id=v_product and id<>p_listing_id) then raise exception 'Shared legacy product needs controlled transition' using errcode='55000'; end if;
 if exists(select 1 from public.listings where id=p_listing_id and review_state='draft') then raise exception 'Already a draft' using errcode='55000'; end if;
 update public.listings set review_state='draft',status='draft',availability_state='checking',draft_epoch=gen_random_uuid(),reviewed_at=null where id=p_listing_id;
 update public.products set status='draft' where id=v_product;
end; $$;
create function public.save_source_listing(p_title text,p_description text,p_price_minor bigint,p_source_type text,p_partner_reference text,p_listing_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_seller public.seller_profiles; v_product uuid; v_listing uuid:=p_listing_id;
begin
 select * into v_seller from public.seller_profiles where user_id=auth.uid() and status='active' for share;
 if not found then raise exception 'Active seller required' using errcode='42501'; end if;
 if p_title is null or char_length(trim(p_title)) not between 3 and 160 or p_description is null or char_length(trim(p_description)) not between 10 and 2000
 or p_price_minor is null or p_price_minor not between 1 and 100000000 then raise exception 'Invalid details' using errcode='22023'; end if;
 if v_listing is null then
 v_product:=gen_random_uuid();
 insert into public.products(id,created_by,title,slug,description,status) values(v_product,auth.uid(),trim(p_title),'product-'||v_product::text,trim(p_description),'draft');
 insert into public.listings(seller_id,product_id,price_minor,currency,inventory_quantity,inventory_mode,status) values(v_seller.id,v_product,p_price_minor,v_seller.default_currency,0,'external','draft') returning id into v_listing;
 else
 perform private.lock_listing_draft(v_listing);
 select product_id into v_product from public.listings where id=v_listing;
 if exists(select 1 from public.listings where product_id=v_product and id<>v_listing) then raise exception 'Shared product' using errcode='55000'; end if;
 update public.products set title=trim(p_title),description=trim(p_description) where id=v_product;
 update public.listings set title=null,price_minor=p_price_minor where id=v_listing;
 end if;
 insert into public.listing_sources values(v_listing,p_source_type,trim(p_partner_reference)) on conflict(listing_id) do update set source_type=excluded.source_type,partner_reference=excluded.partner_reference;
 return v_listing;
end; $$;
-- Four staging buckets and a separate server-only validated vault.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('product-images','product-images',false,10485760,array['image/jpeg','image/png','image/webp']),
 ('product-videos','product-videos',false,104857600,array['video/mp4','video/webm']),
 ('product-public-documents','product-public-documents',false,26214400,array['application/pdf']),
 ('product-private-documents','product-private-documents',false,26214400,array['application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
 ('product-validated-files','product-validated-files',false,104857600,array['image/jpeg','image/png','image/webp','video/mp4','video/webm','application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create function public.reserve_product_file(p_listing_id uuid,p_visibility text,p_name text,p_mime text,p_size bigint)
returns table(id uuid,bucket_id text,object_path text,expires_at timestamptz) language plpgsql security definer set search_path='' as $$
declare v_ext text; v_bucket text; v_limit bigint; v_id uuid:=gen_random_uuid(); v_epoch uuid; v_path text; v_exp timestamptz:=clock_timestamp()+interval '30 minutes';
begin
 perform private.lock_listing_draft(p_listing_id);
 if p_name is null or char_length(p_name) not between 1 and 255 or p_name ~ '[[:cntrl:]/\\]' then raise exception 'Invalid filename' using errcode='22023'; end if;
 v_ext:=lower(substring(p_name from '\.([^.]+)$'));
 if v_ext is null or not coalesce((v_ext in ('jpg','jpeg') and p_mime='image/jpeg') or (v_ext='png' and p_mime='image/png')
 or (v_ext='webp' and p_mime='image/webp') or (v_ext='mp4' and p_mime='video/mp4') or (v_ext='webm' and p_mime='video/webm')
 or (v_ext='pdf' and p_mime='application/pdf') or (v_ext='txt' and p_mime='text/plain') or (v_ext='csv' and p_mime='text/csv')
 or (v_ext='docx' and p_mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
 or (v_ext='xlsx' and p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),false) then raise exception 'Invalid MIME or extension' using errcode='22023'; end if;
 if p_visibility='public' and p_mime in ('image/jpeg','image/png','image/webp') then v_bucket:='product-images'; v_limit:=10485760;
 elsif p_visibility='public' and p_mime in ('video/mp4','video/webm') then v_bucket:='product-videos'; v_limit:=104857600;
 elsif p_visibility='public' and v_ext='pdf' then v_bucket:='product-public-documents'; v_limit:=26214400;
 elsif p_visibility='private' and v_ext in ('pdf','txt','csv','docx','xlsx') then v_bucket:='product-private-documents'; v_limit:=26214400;
 else raise exception 'Invalid visibility' using errcode='22023'; end if;
 if p_size is null or p_size<1 or p_size>v_limit then raise exception 'Invalid size' using errcode='22023'; end if;
 if (select count(*) from public.listing_draft_files d where d.listing_id=p_listing_id)>=12 then raise exception 'Maximum 12 files' using errcode='22023'; end if;
 select l.draft_epoch into v_epoch from public.listings l where l.id=p_listing_id;
 v_path:='incoming/'||auth.uid()::text||'/'||p_listing_id::text||'/'||v_id::text||'.'||v_ext;
 insert into public.product_files(id,listing_id,draft_epoch,visibility,bucket_id,object_path,original_name,mime_type,size_bytes,expires_at)
 values(v_id,p_listing_id,v_epoch,p_visibility,v_bucket,v_path,p_name,p_mime,p_size,v_exp);
 insert into public.listing_draft_files values(p_listing_id,v_id);
 return query select v_id,v_bucket,v_path,v_exp;
end; $$;
create function private.can_stage_product_object(p_bucket text,p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.product_files f join public.listings l on l.id=f.listing_id join public.listing_draft_files d on d.file_id=f.id
 where f.bucket_id=p_bucket and f.object_path=p_path and f.reservation_state='reserved' and f.expires_at>clock_timestamp()
 and f.draft_epoch=l.draft_epoch and l.review_state='draft' and private.owns_active_listing(l.id));
$$;
create policy "Stage owned reserved files" on storage.objects for insert to authenticated with check(private.can_stage_product_object(bucket_id,name));
create policy "Product insert boundary" on storage.objects as restrictive for insert to anon,authenticated
 with check(bucket_id not in ('product-images','product-videos','product-public-documents','product-private-documents','product-validated-files') or private.can_stage_product_object(bucket_id,name));
-- Direct read/sign/copy/update/delete is denied even under broader old policies.
create policy "Product read boundary" on storage.objects as restrictive for select to anon,authenticated
 using(bucket_id not in ('product-images','product-videos','product-public-documents','product-private-documents','product-validated-files'));
create policy "Product update boundary" on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id not in ('product-images','product-videos','product-public-documents','product-private-documents','product-validated-files'))
 with check(bucket_id not in ('product-images','product-videos','product-public-documents','product-private-documents','product-validated-files'));
create policy "Product delete boundary" on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id not in ('product-images','product-videos','product-public-documents','product-private-documents','product-validated-files'));
create function public.finish_product_file(p_file_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare f public.product_files; v_version text;
begin
 select * into f from public.product_files where id=p_file_id;
 perform private.lock_listing_draft(f.listing_id);
 select * into f from public.product_files where id=p_file_id for update;
 -- Check wall time after acquiring locks, not the earlier transaction timestamp.
 if f.reservation_state<>'reserved' or f.expires_at<=clock_timestamp() or not exists(select 1 from public.listings l join public.listing_draft_files d on d.listing_id=l.id
 where d.file_id=f.id and l.draft_epoch=f.draft_epoch) then raise exception 'Reservation expired, cancelled or superseded' using errcode='55000'; end if;
 select o.version into v_version from storage.objects o where o.bucket_id=f.bucket_id and o.name=f.object_path
 and o.metadata->>'mimetype'=f.mime_type and (o.metadata->>'size')::bigint=f.size_bytes for share;
 if v_version is null then raise exception 'Uploaded object mismatch' using errcode='22023'; end if;
 update public.product_files set reservation_state='finalized',storage_version=v_version,finalized_at=now() where id=f.id;
end; $$;
create function public.remove_product_file(p_file_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare f public.product_files;
begin
 select * into f from public.product_files where id=p_file_id;
 perform private.lock_listing_draft(f.listing_id);
 delete from public.listing_draft_files where file_id=f.id;
 update public.product_files set reservation_state='cancelled' where id=f.id and reservation_state='reserved';
 insert into public.product_cleanup_queue(bucket_id,object_path,reason,not_before)
 values(f.bucket_id,f.object_path,'Detached or cancelled reservation',greatest(f.expires_at,now())+interval '7 days') on conflict do nothing;
end; $$;
create function public.submit_source_listing(p_listing_id uuid) returns integer language plpgsql security definer set search_path='' as $$
declare l public.listings; v_revision integer; v_snapshot jsonb; v_hash text;
begin
 perform private.lock_listing_draft(p_listing_id);
 select * into l from public.listings where id=p_listing_id;
 if not exists(select 1 from public.listing_sources where listing_id=l.id) then raise exception 'Source required' using errcode='22023'; end if;
 if exists(select 1 from public.listing_draft_files d join public.product_files f on f.id=d.file_id where d.listing_id=l.id
 and (f.reservation_state<>'finalized' or f.content_validation_state='failed')) then raise exception 'Finish or remove invalid files' using errcode='55000'; end if;
 v_revision:=l.current_revision+1;
 select jsonb_build_object('product',jsonb_build_object('id',p.id,'title',p.title,'description',p.description,'price_minor',l.price_minor,'currency',l.currency),
 'source',jsonb_build_object('source_type',s.source_type,'partner_reference',s.partner_reference),
 'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'storage_version',f.storage_version,'visibility',f.visibility,'mime_type',f.mime_type,'size_bytes',f.size_bytes) order by f.id)
 from public.listing_draft_files d join public.product_files f on f.id=d.file_id where d.listing_id=l.id),'[]'::jsonb))
 into v_snapshot from public.products p join public.listing_sources s on s.listing_id=l.id where p.id=l.product_id;
 v_hash:=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 insert into public.listing_submissions(listing_id,revision,snapshot,snapshot_hash) values(l.id,v_revision,v_snapshot,v_hash);
 insert into public.submission_files select l.id,v_revision,f.id,f.storage_version from public.listing_draft_files d join public.product_files f on f.id=d.file_id where d.listing_id=l.id;
 update public.listings set current_revision=v_revision,review_state='pending_review',status='draft',availability_state='checking',submitted_at=now(),reviewed_at=null where id=l.id;
 return v_revision;
end; $$;
-- Worker hashes/inspects bytes and writes a fresh server-only vault object first.
create function public.record_product_file_validation(p_file_id uuid,p_storage_version text,p_job_id uuid,p_state text,p_sha256 text,p_validator text,p_evidence_reference text,p_vault_path text default null,p_vault_version text default null)
returns void language plpgsql security definer set search_path='' as $$
declare f public.product_files; v_ext text; v_expected_path text;
begin
 select * into f from public.product_files where id=p_file_id;
 perform l.id from public.listings l join public.seller_profiles s on s.id=l.seller_id where l.id=f.listing_id and l.deleted_at is null and s.status='active' for update of l for share of s;
 if not found then raise exception 'Active seller required' using errcode='42501'; end if;
 select * into f from public.product_files where id=p_file_id for update;
 if f.reservation_state<>'finalized' or f.storage_version is distinct from p_storage_version then raise exception 'Stale file version' using errcode='40001'; end if;
 if exists(select 1 from public.product_file_validations where file_id=f.id or job_id=p_job_id) then raise exception 'Duplicate validation' using errcode='23505'; end if;
 if p_sha256 is null or char_length(p_sha256)<>64 or p_sha256 !~ '^[a-f0-9]{64}$'
 then raise exception 'Invalid content SHA256' using errcode='22023'; end if;
 if not exists(select 1 from storage.objects where bucket_id=f.bucket_id and name=f.object_path and version=p_storage_version
 and metadata->>'mimetype'=f.mime_type and (metadata->>'size')::bigint=f.size_bytes) then raise exception 'Staging object changed; reserve a new file' using errcode='40001'; end if;
 if p_state='passed' then
 -- Preserve the extension generated by the reservation, including jpg/jpeg.
 -- Check its allowed MIME pairing again before constructing the only valid path.
 v_ext:=substring(f.object_path from '\.([^.]+)$');
 if not exists(select 1 from (values
 ('jpg','image/jpeg'),('jpeg','image/jpeg'),('png','image/png'),('webp','image/webp'),
 ('mp4','video/mp4'),('webm','video/webm'),('pdf','application/pdf'),('txt','text/plain'),('csv','text/csv'),
 ('docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
 ('xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 ) as allowed(extension,mime) where allowed.extension=v_ext and allowed.mime=f.mime_type)
 then raise exception 'Invalid reserved file type' using errcode='22023'; end if;
 v_expected_path:='validated/'||f.id::text||'/'||p_sha256||'.'||v_ext;
 if p_vault_path is distinct from v_expected_path or not exists(select 1 from storage.objects o
 where o.bucket_id='product-validated-files' and o.name=p_vault_path and o.version=p_vault_version and o.metadata->>'mimetype'=f.mime_type and (o.metadata->>'size')::bigint=f.size_bytes)
 then raise exception 'Validated vault object required' using errcode='22023'; end if;
 end if;
 insert into public.product_file_validations values(f.id,p_storage_version,p_job_id,p_state,p_sha256,p_validator,p_evidence_reference,now(),p_vault_path,p_vault_version);
 update public.product_files set content_validation_state=p_state where id=f.id;
end; $$;
create function private.submission_files_fingerprint(p_listing_id uuid,p_revision integer) returns text language sql stable security definer set search_path='' as $$
 select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('file_id',sf.file_id,'storage_version',sf.storage_version,'sha256',v.content_sha256,'vault_version',v.vault_version) order by sf.file_id),'[]'::jsonb)::text,'UTF8')),'hex')
 from public.submission_files sf left join public.product_file_validations v on v.file_id=sf.file_id and v.storage_version=sf.storage_version where sf.listing_id=p_listing_id and sf.revision=p_revision;
$$;
-- Worker reads authoritative canonical hashes, avoiding JSON serialization drift.
create function public.get_product_review_input(p_listing_id uuid,p_expected_revision integer)
returns table(snapshot jsonb,snapshot_hash text,files_fingerprint text) language sql stable security definer set search_path='' as $$
 select s.snapshot,s.snapshot_hash,private.submission_files_fingerprint(s.listing_id,s.revision)
 from public.listing_submissions s join public.listings l on l.id=s.listing_id
 join public.seller_profiles seller on seller.id=l.seller_id
 where s.listing_id=p_listing_id and s.revision=p_expected_revision and l.current_revision=s.revision
 and l.review_state='pending_review' and l.deleted_at is null and seller.status='active';
$$;
create function public.record_product_review(p_listing_id uuid,p_expected_revision integer,p_job_id uuid,p_decision text,p_availability text,p_snapshot_hash text,p_files_fingerprint text,p_provenance jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare l public.listings; sub public.listing_submissions; v_files text; v_observed timestamptz;
begin
 select * into l from public.listings where id=p_listing_id for update;
 perform id from public.seller_profiles where id=l.seller_id and status='active' for share;
 if not found or l.deleted_at is not null then raise exception 'Active seller required' using errcode='42501'; end if;
 if l.current_revision is distinct from p_expected_revision then raise exception 'Stale submission revision' using errcode='40001'; end if;
 if exists(select 1 from public.product_review_events where job_id=p_job_id or (listing_id=l.id and revision=p_expected_revision)) then raise exception 'Duplicate review job or decided revision' using errcode='23505'; end if;
 if l.review_state<>'pending_review' then raise exception 'Submission not pending' using errcode='55000'; end if;
 select * into sub from public.listing_submissions where listing_id=l.id and revision=p_expected_revision for update;
 if not found or sub.snapshot_hash is distinct from p_snapshot_hash then raise exception 'Snapshot mismatch' using errcode='40001'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or p_availability is null or p_availability not in ('checking','available','unavailable') then raise exception 'Invalid decision' using errcode='22023'; end if;
 if p_provenance is null or octet_length(p_provenance::text)>16384 or jsonb_typeof(p_provenance)<>'object' or coalesce(p_provenance->>'kind','') not in ('manual','model')
 or char_length(coalesce(p_provenance->>'controller','')) not between 2 and 100
 or char_length(coalesce(p_provenance#>>'{source,reference}','')) not between 10 and 2000
 or coalesce(p_provenance#>>'{source,reference}','') !~ '^evidence://[A-Za-z0-9][A-Za-z0-9/_.:-]+$'
 or (p_provenance#>>'{source,availability}') is distinct from p_availability
 or char_length(coalesce(p_provenance#>>'{policy,version}','')) not between 2 and 100
 or (p_provenance#>>'{policy,result}') is distinct from p_decision then raise exception 'Invalid provenance' using errcode='22023'; end if;
 if p_provenance->>'kind'='model' and (char_length(coalesce(p_provenance#>>'{model,provider}',''))<2 or char_length(coalesce(p_provenance#>>'{model,name}',''))<2
 or char_length(coalesce(p_provenance#>>'{model,response_id}',''))<2 or coalesce(p_provenance#>>'{model,output_sha256}','') !~ '^[a-f0-9]{64}$') then raise exception 'Model provenance required' using errcode='22023'; end if;
 v_observed:=(p_provenance#>>'{source,observed_at}')::timestamptz;
 if v_observed is null or v_observed>now()+interval '5 minutes' or v_observed<now()-interval '24 hours' then raise exception 'Fresh source evidence required' using errcode='22023'; end if;
 if p_decision='approved' and exists(select 1 from public.submission_files sf where sf.listing_id=l.id and sf.revision=p_expected_revision and not private.validated_file_intact(sf.file_id))
 then raise exception 'All revision files must pass validation' using errcode='55000'; end if;
 v_files:=private.submission_files_fingerprint(l.id,p_expected_revision);
 if v_files is distinct from p_files_fingerprint then raise exception 'Reviewed file fingerprint mismatch' using errcode='40001'; end if;
 insert into public.product_review_events(job_id,listing_id,revision,decision,availability_state,snapshot_hash,files_fingerprint,provenance)
 values(p_job_id,l.id,p_expected_revision,p_decision,p_availability,p_snapshot_hash,v_files,p_provenance);
 update public.listings set review_state=p_decision,availability_state=p_availability,status=case when p_decision='approved' then 'active' else 'draft' end,reviewed_at=now() where id=l.id;
 update public.products set status=case when p_decision='approved' then 'active' else 'draft' end where id=l.product_id;
end; $$;

-- Public metadata is explicitly limited to the current approved revision, even
-- when the caller happens to own the listing and has broader metadata access.
create function public.get_listing_public_files(p_listing_id uuid)
returns table(id uuid,original_name text,mime_type text) language sql stable security definer set search_path='' as $$
 select f.id,f.original_name,f.mime_type from public.product_files f
 join public.submission_files sf on sf.file_id=f.id and sf.listing_id=f.listing_id
 join public.listings l on l.id=sf.listing_id and l.current_revision=sf.revision
 where l.id=p_listing_id and private.listing_is_public(l.id) and f.visibility='public'
 and private.validated_file_intact(f.id) order by f.created_at,f.id;
$$;
-- Internal delivery descriptor: no ordinary caller receives a vault path.
create function public.get_validated_file_delivery(p_file_id uuid)
returns table(vault_path text,vault_version text,content_sha256 text) language sql stable security definer set search_path='' as $$
 select v.vault_path,v.vault_version,v.content_sha256 from public.product_file_validations v
 where v.file_id=p_file_id and private.validated_file_intact(v.file_id);
$$;
create function public.withdraw_source_listing(p_listing_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.lock_owned_listing(p_listing_id);
 update public.listings set review_state='withdrawn',status='archived',availability_state='unavailable',deleted_at=now() where id=p_listing_id;
 update public.product_files set reservation_state='cancelled' where listing_id=p_listing_id and reservation_state='reserved';
 -- Logical deletion only. Shared legacy products and immutable evidence survive.
end; $$;
-- Inventory and queue only: never deletes bytes or evidence. A separately
-- authorized operator must recheck references/retention and delete via Storage API.
create function public.reconcile_product_files() returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 update public.product_files f set reservation_state='expired'
 where reservation_state='reserved' and (expires_at<=clock_timestamp() or not exists(
 select 1 from public.listings l join public.seller_profiles s on s.id=l.seller_id
 where l.id=f.listing_id and l.draft_epoch=f.draft_epoch and l.review_state='draft' and l.deleted_at is null and s.status='active'));
 insert into public.product_cleanup_queue(bucket_id,object_path,reason,not_before)
 select f.bucket_id,f.object_path,'Abandoned staging reservation',greatest(f.expires_at,now())+interval '7 days'
 from public.product_files f where f.reservation_state in ('expired','cancelled') on conflict do nothing;
 insert into public.product_cleanup_queue(bucket_id,object_path,reason,not_before)
 select f.bucket_id,f.object_path,'Validated staging copy; preserve vault and review evidence',now()+interval '7 days'
 from public.product_files f where f.content_validation_state in ('passed','failed') on conflict do nothing;
 insert into public.product_cleanup_queue(bucket_id,object_path,reason,not_before)
 select 'product-validated-files',v.vault_path,'Withdrawn/rejected/detached file: retention and reference review required',
 greatest(coalesce(l.deleted_at,l.reviewed_at,now()),v.validated_at)+interval '30 days'
 from public.product_file_validations v join public.product_files f on f.id=v.file_id join public.listings l on l.id=f.listing_id
 where v.vault_path is not null and (l.deleted_at is not null or l.review_state='rejected' or not exists(select 1 from public.listing_draft_files d where d.file_id=f.id)) on conflict do nothing;
 insert into public.product_cleanup_queue(bucket_id,object_path,reason,not_before)
 select o.bucket_id,o.name,'Unreferenced object: operator investigation required',greatest(o.created_at,now())+interval '7 days'
 from storage.objects o where o.bucket_id in ('product-images','product-videos','product-public-documents','product-private-documents','product-validated-files')
 and not exists(select 1 from public.product_files f where f.bucket_id=o.bucket_id and f.object_path=o.name)
 and not exists(select 1 from public.product_file_validations v where o.bucket_id='product-validated-files' and v.vault_path=o.name) on conflict do nothing;
 get diagnostics v_count=row_count;
 return v_count; -- newly discovered orphan objects, not deletion count
end; $$;
-- Close default function EXECUTE, including Supabase's role default privileges.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname in ('begin_listing_revision','save_source_listing','reserve_product_file','finish_product_file','remove_product_file','submit_source_listing','record_product_file_validation','record_product_review','get_listing_public_files','get_validated_file_delivery','get_product_review_input','withdraw_source_listing','reconcile_product_files'))
 or (n.nspname='private' and p.proname in ('submission_files_fingerprint','immutable_product_record','owns_active_listing','lock_owned_listing','lock_listing_draft','validated_file_intact','listing_is_public','can_read_product_file','can_stage_product_object')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant usage on schema private to anon,authenticated,service_role;
grant execute on function private.owns_active_listing(uuid),private.listing_is_public(uuid),private.can_read_product_file(uuid),private.can_stage_product_object(text,text) to anon,authenticated;
grant execute on function public.begin_listing_revision(uuid),public.save_source_listing(text,text,bigint,text,text,uuid),public.reserve_product_file(uuid,text,text,text,bigint),public.finish_product_file(uuid),public.remove_product_file(uuid),public.submit_source_listing(uuid),public.withdraw_source_listing(uuid) to authenticated;
grant execute on function public.get_listing_public_files(uuid) to anon,authenticated;
grant execute on function public.record_product_file_validation(uuid,text,uuid,text,text,text,text,text,text),public.record_product_review(uuid,integer,uuid,text,text,text,text,jsonb),public.get_validated_file_delivery(uuid),public.get_product_review_input(uuid,integer),public.reconcile_product_files() to service_role;
commit;
