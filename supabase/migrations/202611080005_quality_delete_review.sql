create function app.quality_delete_review(p_role text,p_team_id text,p_password text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_review public.quality_reviews%rowtype;
begin
  if p_role is null or p_role not in ('admin','quality') then
    raise exception 'حذف المراجعات للمدير ومراقب الجودة فقط' using errcode='42501';
  end if;
  perform app.quality_dispatch(p_role,p_team_id,p_password,'get',p_payload);
  select * into v_review from public.quality_reviews where id=(p_payload->>'review_id')::uuid;
  if v_review.updated_at is distinct from (p_payload->>'updated_at')::timestamptz then
    raise exception 'تم تحديث المراجعة. حدث القائمة قبل الحذف';
  end if;
  delete from public.quality_reviews where id=v_review.id;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function app.quality_delete_review(text,text,text,jsonb) from public;
grant execute on function app.quality_delete_review(text,text,text,jsonb) to anon,authenticated;

create or replace function public.quality_api(p_role text,p_team_id text,p_password text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select case when p_action='delete_review' then app.quality_delete_review(p_role,p_team_id,p_password,p_payload)
    else app.quality_notifications(p_role,p_team_id,p_password,p_action,p_payload)
  end;
$$;
