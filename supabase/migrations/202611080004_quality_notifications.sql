alter table public.quality_reviews add column notification_revision bigint not null default 0;
update public.quality_reviews set notification_revision=1 where status='sent';
create table public.quality_reads (
  review_id uuid primary key references public.quality_reviews(id) on delete cascade,
  seen_revision bigint not null check(seen_revision>=0),
  seen_at timestamptz not null default now()
);
alter table public.quality_reads enable row level security;
revoke all on public.quality_reads from public,anon,authenticated;
create table app.quality_portal_links (
  employee_id text primary key references public.employees(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(32),'hex')
);
create table app.quality_contacts (
  team_id text primary key references public.teams(id) on delete cascade,
  phone text not null check(phone ~ '^[1-9][0-9]{7,14}$')
);
alter table app.quality_portal_links enable row level security;
alter table app.quality_contacts enable row level security;
revoke all on app.quality_portal_links,app.quality_contacts from public,anon,authenticated;

create function app.quality_notifications(p_role text,p_team_id text,p_password text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_team text:=p_team_id;
  v_review public.quality_reviews%rowtype;
  v_finding public.quality_findings%rowtype;
  v_result jsonb;
  v_employee text;
  v_revision bigint;
  v_phone text;
begin
  if p_role='quality_link' then
    if not coalesce((select is_active from public.system_config limit 1),true) then raise exception 'النظام متوقف'; end if;
    select e.team_id,e.id into v_team,v_employee from app.quality_portal_links l
      join public.employees e on e.id=l.employee_id join public.teams t on t.id=e.team_id
      where l.token=p_password and e.role='مشرف' and coalesce(e.is_active,true) and coalesce(t.is_active,true);
    if not found or v_team is distinct from p_team_id then
      raise exception 'رابط الجودة غير صالح أو غير نشط' using errcode='42501';
    end if;
    if p_action not in ('list','get','respond','notifications','mark_seen') or p_action is null then
      raise exception 'غير مسموح لهذا الرابط' using errcode='42501';
    end if;
  elsif p_action in ('notifications','mark_seen','portal_links','delivery','save_contact') then
    if p_role in ('admin','supervisor') then perform app.authorize(p_role,p_team_id,p_password);
    elsif p_role='quality' then perform app.quality_dispatch(p_role,p_team_id,p_password,'list','{}'::jsonb);
    else raise exception 'غير مسموح' using errcode='42501'; end if;
  end if;

  if p_action in ('portal_links','delivery') then
    if p_role not in ('admin','supervisor','quality') then raise exception 'غير مسموح' using errcode='42501'; end if;
    insert into app.quality_portal_links(employee_id)
      select e.id from public.employees e join public.teams t on t.id=e.team_id
      where e.role='مشرف' and coalesce(e.is_active,true) and coalesce(t.is_active,true)
        and (p_role<>'supervisor' or e.team_id=p_team_id)
    on conflict(employee_id) do nothing;
    select jsonb_build_object('supervisors',coalesce((
      select jsonb_agg(jsonb_build_object('employee_id',e.id,'name',e.name,'team_id',e.team_id,'token',l.token) order by e.name,e.id)
      from app.quality_portal_links l join public.employees e on e.id=l.employee_id join public.teams t on t.id=e.team_id
      where e.role='مشرف' and coalesce(e.is_active,true) and coalesce(t.is_active,true)
        and (p_role<>'supervisor' or e.team_id=p_team_id)
    ),'[]'::jsonb),'contacts',coalesce((select jsonb_agg(to_jsonb(c)) from app.quality_contacts c
      where p_role<>'supervisor' or c.team_id=p_team_id),'[]'::jsonb)) into v_result;
    return v_result;
  end if;
  if p_action='save_contact' then
    if p_role not in ('admin','quality') then raise exception 'للمدير ومراقب الجودة فقط' using errcode='42501'; end if;
    if not exists(select 1 from public.teams where id=p_payload->>'team_id' and coalesce(is_active,true)) then raise exception 'اختر التيم'; end if;
    v_phone:=regexp_replace(coalesce(p_payload->>'phone',''),'[[:space:]()+-]','','g');
    if left(v_phone,2)='00' then v_phone:=substr(v_phone,3); end if;
    if v_phone='' then delete from app.quality_contacts where team_id=p_payload->>'team_id';
    else
      if v_phone !~ '^[1-9][0-9]{7,14}$' then raise exception 'أدخل الرقم الدولي بكود الدولة'; end if;
      insert into app.quality_contacts(team_id,phone) values(p_payload->>'team_id',v_phone)
        on conflict(team_id) do update set phone=excluded.phone;
    end if;
    return jsonb_build_object('ok',true);
  end if;
  if p_action='notifications' then
    if p_role not in ('supervisor','quality_link') then raise exception 'للمشرف فقط' using errcode='42501'; end if;
    select jsonb_build_object('unread_count',count(*) filter(where r.notification_revision>coalesce(s.seen_revision,0)),
      'reviews',coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'revision',r.notification_revision,
        'unread',r.notification_revision>coalesce(s.seen_revision,0)) order by r.sent_at desc),'[]'::jsonb)) into v_result
      from public.quality_reviews r left join public.quality_reads s on s.review_id=r.id where r.team_id=v_team and r.status='sent';
    return v_result;
  end if;
  if p_action='mark_seen' then
    if p_role not in ('supervisor','quality_link') then raise exception 'للمشرف فقط' using errcode='42501'; end if;
    select * into v_review from public.quality_reviews where id=(p_payload->>'review_id')::uuid and team_id=v_team and status='sent' for update;
    if not found then raise exception 'المراجعة غير متاحة' using errcode='42501'; end if;
    v_revision:=(p_payload->>'revision')::bigint;
    if v_revision is null or v_revision<1 or v_revision>v_review.notification_revision then raise exception 'إصدار المراجعة غير صالح'; end if;
    insert into public.quality_reads(review_id,seen_revision) values(v_review.id,v_revision)
      on conflict(review_id) do update set seen_revision=greatest(quality_reads.seen_revision,excluded.seen_revision),
        seen_at=case when excluded.seen_revision>quality_reads.seen_revision then clock_timestamp() else quality_reads.seen_at end;
    return jsonb_build_object('ok',true);
  end if;

  if p_role='quality_link' then
    if p_action='list' then
      select jsonb_build_object('teams',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.teams where id=v_team),'[]'::jsonb),
        'clients','[]'::jsonb,'reviews',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
          'total',(select count(*) from public.quality_findings f where f.review_id=r.id),
          'closed',(select count(*) from public.quality_findings f where f.review_id=r.id and f.status='closed')
        ) order by r.created_at desc) from public.quality_reviews r where r.team_id=v_team and r.status='sent'),'[]'::jsonb)) into v_result;
    else
      select * into v_review from public.quality_reviews where id=(p_payload->>'review_id')::uuid and team_id=v_team and status='sent' for update;
      if not found then raise exception 'المراجعة غير متاحة لهذا التيم' using errcode='42501'; end if;
      if p_action='respond' then
        select * into v_finding from public.quality_findings where id=(p_payload->>'finding_id')::uuid and review_id=v_review.id for update;
        if not found then raise exception 'الملاحظة غير موجودة'; end if;
        if v_finding.status='closed' then raise exception 'الملاحظة مغلقة'; end if;
        if v_finding.updated_at is distinct from (p_payload->>'updated_at')::timestamptz then raise exception 'تم تحديث الملاحظة. أعد فتح المراجعة'; end if;
        if coalesce(btrim(p_payload->>'reply'),'')='' then raise exception 'اكتب رد المعالجة'; end if;
        update public.quality_findings set reply=btrim(p_payload->>'reply'),status='resolved',updated_at=clock_timestamp() where id=v_finding.id;
        update public.quality_reviews set updated_at=clock_timestamp() where id=v_review.id;
        return jsonb_build_object('ok',true);
      end if;
      v_result:=to_jsonb(v_review)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(f) order by f.position)
        from public.quality_findings f where f.review_id=v_review.id),'[]'::jsonb));
    end if;
  else
    if p_action='delete_finding' then v_result:=app.quality_delete_finding(p_role,p_team_id,p_password,p_payload);
    elsif p_action='edit_review' then v_result:=app.quality_edit_review(p_role,p_team_id,p_password,p_payload);
    else v_result:=app.quality_dispatch(p_role,p_team_id,p_password,p_action,p_payload); end if;
    if p_action in ('publish','edit_review','reopen','delete_finding') then
      update public.quality_reviews set notification_revision=notification_revision+1
        where id=(p_payload->>'review_id')::uuid and status='sent';
    end if;
  end if;
  if p_action='list' then
    select jsonb_set(v_result,'{reviews}',coalesce(jsonb_agg(r||jsonb_build_object('seen_revision',coalesce(s.seen_revision,0),'seen_at',s.seen_at)),'[]'::jsonb)) into v_result
      from jsonb_array_elements(v_result->'reviews') r left join public.quality_reads s on s.review_id=(r->>'id')::uuid;
  elsif p_action='get' then
    v_result:=v_result||coalesce((select jsonb_build_object('seen_revision',seen_revision,'seen_at',seen_at) from public.quality_reads where review_id=(p_payload->>'review_id')::uuid),jsonb_build_object('seen_revision',0,'seen_at',null));
  end if;
  return v_result;
end;
$$;
revoke all on function app.quality_notifications(text,text,text,text,jsonb) from public;
grant execute on function app.quality_notifications(text,text,text,text,jsonb) to anon,authenticated;
create or replace function public.quality_api(p_role text,p_team_id text,p_password text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.quality_notifications(p_role,p_team_id,p_password,p_action,p_payload);
$$;
