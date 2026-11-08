create function app.quality_edit_review(p_role text,p_team_id text,p_password text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_review public.quality_reviews%rowtype;
  v_finding public.quality_findings%rowtype;
  v_client public.clients%rowtype;
  v_row jsonb;
  v_seen uuid[] := '{}'::uuid[];
  v_id uuid;
  v_position integer := 0;
  v_changed boolean;
begin
  if p_role is null or p_role not in ('admin','quality') then
    raise exception 'تعديل المراجعة للمدير ومراقب الجودة فقط' using errcode='42501';
  end if;
  perform app.quality_dispatch(p_role,p_team_id,p_password,'get',p_payload);
  select * into v_review from public.quality_reviews where id=(p_payload->>'review_id')::uuid;
  if v_review.status<>'sent' then raise exception 'استخدم حفظ المسودة لهذه المراجعة'; end if;
  if v_review.updated_at is distinct from (p_payload->>'updated_at')::timestamptz then
    raise exception 'تم تحديث المراجعة. أعد فتحها قبل التعديل';
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items')>200 then
    raise exception 'قائمة الملاحظات غير صالحة';
  end if;
  if coalesce(btrim(p_payload->>'title'),'')='' then raise exception 'اكتب عنوان المراجعة'; end if;

  for v_row in select value from jsonb_array_elements(p_payload->'items') loop
    select * into v_client from public.clients where id=v_row->>'client_id' and team_id=v_review.team_id;
    if not found then raise exception 'اختر عميلًا من نفس التيم لكل ملاحظة'; end if;
    if coalesce(btrim(v_row->>'category'),'')='' or coalesce(btrim(v_row->>'observation'),'')='' then
      raise exception 'اختر القسم والملاحظة';
    end if;
    v_position:=v_position+1;
    v_id:=nullif(v_row->>'id','')::uuid;
    if v_id is null then
      insert into public.quality_findings(review_id,client_id,client_name,category,observation,details,position)
      values(v_review.id,v_client.id,v_client.name,btrim(v_row->>'category'),btrim(v_row->>'observation'),coalesce(btrim(v_row->>'details'),''),v_position)
      returning id into v_id;
    else
      if v_id=any(v_seen) then raise exception 'الملاحظة مكررة في الطلب'; end if;
      select * into v_finding from public.quality_findings where id=v_id and review_id=v_review.id for update;
      if not found then raise exception 'الملاحظة غير موجودة في هذه المراجعة'; end if;
      v_changed := row(v_finding.client_id,v_finding.category,v_finding.observation,v_finding.details)
        is distinct from row(v_client.id,btrim(v_row->>'category'),btrim(v_row->>'observation'),coalesce(btrim(v_row->>'details'),''));
      update public.quality_findings set client_id=v_client.id,client_name=v_client.name,
        category=btrim(v_row->>'category'),observation=btrim(v_row->>'observation'),details=coalesce(btrim(v_row->>'details'),''),
        position=v_position,status=case when v_changed then 'open' else status end,
        updated_at=case when v_changed then clock_timestamp() else updated_at end
      where id=v_id;
    end if;
    v_seen:=array_append(v_seen,v_id);
  end loop;
  delete from public.quality_findings where review_id=v_review.id and not(id=any(v_seen));
  update public.quality_reviews set title=btrim(p_payload->>'title'),updated_at=clock_timestamp() where id=v_review.id;
  return jsonb_build_object('ok',true,'id',v_review.id);
end;
$$;
revoke all on function app.quality_edit_review(text,text,text,jsonb) from public;
grant execute on function app.quality_edit_review(text,text,text,jsonb) to anon,authenticated;

create or replace function public.quality_api(p_role text,p_team_id text,p_password text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select case when p_action='delete_finding' then app.quality_delete_finding(p_role,p_team_id,p_password,p_payload)
    when p_action='edit_review' then app.quality_edit_review(p_role,p_team_id,p_password,p_payload)
    else app.quality_dispatch(p_role,p_team_id,p_password,p_action,p_payload)
  end;
$$;
