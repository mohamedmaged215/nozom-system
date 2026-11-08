create function app.quality_delete_finding(p_role text,p_team_id text,p_password text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_finding public.quality_findings%rowtype;
begin
  if p_role is null or p_role not in ('admin','quality') then
    raise exception 'حذف الملاحظات للمدير ومراقب الجودة فقط' using errcode='42501';
  end if;
  -- Reuse the current password checks and hold the review lock for this transaction.
  perform app.quality_dispatch(p_role,p_team_id,p_password,'get',p_payload);
  select * into v_finding from public.quality_findings
    where id=(p_payload->>'finding_id')::uuid
      and review_id=(p_payload->>'review_id')::uuid for update;
  if not found then raise exception 'الملاحظة غير موجودة'; end if;
  if v_finding.updated_at is distinct from (p_payload->>'updated_at')::timestamptz then
    raise exception 'تم تحديث الملاحظة. أعد فتح المراجعة قبل الحذف';
  end if;
  delete from public.quality_findings where id=v_finding.id;
  update public.quality_reviews set updated_at=clock_timestamp() where id=v_finding.review_id;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function app.quality_delete_finding(text,text,text,jsonb) from public;
grant execute on function app.quality_delete_finding(text,text,text,jsonb) to anon,authenticated;

create or replace function public.quality_api(p_role text,p_team_id text,p_password text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select case when p_action='delete_finding'
    then app.quality_delete_finding(p_role,p_team_id,p_password,p_payload)
    else app.quality_dispatch(p_role,p_team_id,p_password,p_action,p_payload)
  end;
$$;
