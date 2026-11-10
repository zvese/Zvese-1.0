-- LOCAL ONLY: synchronize an already-applied sourcing foundation. Do not run against production.
-- Review and execute manually; this file is deliberately outside the migrations directory.
begin;

create or replace function private.enforce_sourcing_media_decision_transition()
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

create or replace function private.enforce_sourcing_candidate_media_approval()
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

create or replace function public.record_sourcing_media_decision(p_media_id uuid,p_admin_id uuid,p_decision text,p_note text)
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

drop trigger if exists enforce_sourcing_candidate_media_approval on public.sourcing_candidates;
create trigger enforce_sourcing_candidate_media_approval before update of status
  on public.sourcing_candidates for each row execute function private.enforce_sourcing_candidate_media_approval();

revoke all on function private.enforce_sourcing_media_decision_transition(),
  private.enforce_sourcing_candidate_media_approval() from public,anon,authenticated,service_role;
revoke all on function public.record_sourcing_media_decision(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.record_sourcing_media_decision(uuid,uuid,text,text) to service_role;

commit;
