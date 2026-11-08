create table public.quality_reviews (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id),
  title text not null check (length(title) between 1 and 160),
  status text not null default 'draft' check (status in ('draft','sent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz
);
create table public.quality_findings (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.quality_reviews(id) on delete cascade,
  client_id text references public.clients(id) on delete set null,
  client_name text not null,
  category text not null,
  observation text not null check (length(observation) between 1 and 300),
  details text not null default '' check (length(details) <= 4000),
  status text not null default 'open' check (status in ('open','resolved','closed')),
  reply text not null default '' check (length(reply) <= 4000),
  position integer not null,
  updated_at timestamptz not null default clock_timestamp()
);
create index quality_reviews_team_idx on public.quality_reviews(team_id,created_at desc);
create index quality_findings_review_idx on public.quality_findings(review_id,position);
alter table public.quality_reviews enable row level security;
alter table public.quality_findings enable row level security;
revoke all on public.quality_reviews, public.quality_findings from public,anon,authenticated;

create table app.quality_access (
  singleton boolean primary key default true check (singleton),
  password_hash text not null,
  updated_at timestamptz not null default now()
);
alter table app.quality_access enable row level security;
revoke all on app.quality_access from public,anon,authenticated;

-- The existing CRM uses password-checked RPCs rather than Supabase Auth sessions.
create function app.quality_dispatch(p_role text,p_team_id text,p_password text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_review public.quality_reviews%rowtype;
  v_finding public.quality_findings%rowtype;
  v_row jsonb;
  v_client public.clients%rowtype;
  v_result jsonb;
  v_id uuid;
  v_position integer := 0;
begin
  if p_role='quality' then
    if not coalesce((select is_active from public.system_config limit 1),true) then
      raise exception 'النظام متوقف';
    end if;
    if p_password is null or not exists (
      select 1 from app.quality_access where password_hash=extensions.crypt(p_password,password_hash)
    ) then raise exception 'كلمة مرور مراقب الجودة غير صحيحة أو لم يتم تفعيل الحساب'; end if;
  elsif p_role in ('admin','supervisor') then
    perform app.authorize(p_role,p_team_id,p_password);
  else
    raise exception 'غير مسموح' using errcode='42501';
  end if;

  if p_action='set_password' then
    if p_role<>'admin' then raise exception 'للمدير فقط' using errcode='42501'; end if;
    if coalesce(length(p_payload->>'password'),0) < 8 or length(p_payload->>'password') > 72 then
      raise exception 'كلمة المرور يجب أن تكون من 8 إلى 72 حرفًا';
    end if;
    insert into app.quality_access(singleton,password_hash) values
      (true,extensions.crypt(p_payload->>'password',extensions.gen_salt('bf',10)))
    on conflict(singleton) do update set password_hash=excluded.password_hash,updated_at=now();
    return jsonb_build_object('ok',true);
  end if;

  if p_action='list' then
    select jsonb_build_object(
      'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name)
        from public.teams t where coalesce(t.is_active,true) and (p_role<>'supervisor' or t.id=p_team_id)),'[]'::jsonb),
      'clients',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'team_id',c.team_id) order by c.name)
        from public.clients c where p_role<>'supervisor' or c.team_id=p_team_id),'[]'::jsonb),
      'reviews',coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object(
          'total',(select count(*) from public.quality_findings f where f.review_id=r.id),
          'closed',(select count(*) from public.quality_findings f where f.review_id=r.id and f.status='closed')
        ) order by r.created_at desc)
        from public.quality_reviews r where p_role<>'supervisor' or (r.team_id=p_team_id and r.status='sent')),'[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  if p_action='create' then
    if p_role not in ('quality','admin') then raise exception 'غير مسموح' using errcode='42501'; end if;
    if not exists(select 1 from public.teams where id=p_payload->>'team_id' and coalesce(is_active,true)) then
      raise exception 'اختر تيمًا نشطًا';
    end if;
    insert into public.quality_reviews(team_id,title) values
      (p_payload->>'team_id',coalesce(nullif(btrim(p_payload->>'title'),''),'مراجعة جودة - ' || (now() at time zone 'Africa/Cairo')::date::text))
    returning id into v_id;
    return jsonb_build_object('id',v_id);
  end if;

  select * into v_review from public.quality_reviews where id=(p_payload->>'review_id')::uuid for update;
  if not found then raise exception 'المراجعة غير موجودة'; end if;
  if p_role='supervisor' and (v_review.team_id is distinct from p_team_id or v_review.status<>'sent') then
    raise exception 'هذه المراجعة غير متاحة لك' using errcode='42501';
  end if;
  if p_action='get' then
    return to_jsonb(v_review) || jsonb_build_object('items',coalesce((
      select jsonb_agg(to_jsonb(f) order by f.position) from public.quality_findings f where f.review_id=v_review.id
    ),'[]'::jsonb));
  end if;

  if p_action in ('save','publish','delete') then
    if p_role not in ('quality','admin') or v_review.status<>'draft' then
      raise exception 'يمكن تعديل المسودات فقط' using errcode='42501';
    end if;
    if v_review.updated_at is distinct from (p_payload->>'updated_at')::timestamptz then
      raise exception 'تم تحديث المراجعة. أعد فتحها قبل التعديل';
    end if;
    if p_action='delete' then
      delete from public.quality_reviews where id=v_review.id;
      return jsonb_build_object('ok',true);
    end if;
    if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items')>200 then
      raise exception 'قائمة الملاحظات غير صالحة';
    end if;
    if p_action='publish' and jsonb_array_length(p_payload->'items')=0 then raise exception 'أضف ملاحظة قبل الإرسال'; end if;
    delete from public.quality_findings where review_id=v_review.id;
    for v_row in select value from jsonb_array_elements(p_payload->'items') loop
      select * into v_client from public.clients where id=v_row->>'client_id' and team_id=v_review.team_id;
      if not found then raise exception 'اختر عميلًا من نفس التيم لكل ملاحظة'; end if;
      if coalesce(btrim(v_row->>'observation'),'')='' or coalesce(btrim(v_row->>'category'),'')='' then
        raise exception 'اختر القسم والملاحظة';
      end if;
      v_position := v_position+1;
      insert into public.quality_findings(review_id,client_id,client_name,category,observation,details,position)
      values(v_review.id,v_client.id,v_client.name,v_row->>'category',btrim(v_row->>'observation'),coalesce(btrim(v_row->>'details'),''),v_position);
    end loop;
    update public.quality_reviews set title=coalesce(nullif(btrim(p_payload->>'title'),''),title),
      status=case when p_action='publish' then 'sent' else 'draft' end,
      sent_at=case when p_action='publish' then now() else null end,updated_at=clock_timestamp()
    where id=v_review.id;
    return jsonb_build_object('id',v_review.id);
  end if;

  if v_review.status<>'sent' then raise exception 'المراجعة لم ترسل بعد'; end if;
  select * into v_finding from public.quality_findings
    where id=(p_payload->>'finding_id')::uuid and review_id=v_review.id for update;
  if not found then raise exception 'الملاحظة غير موجودة'; end if;
  if v_finding.updated_at is distinct from (p_payload->>'updated_at')::timestamptz then
    raise exception 'تم تحديث الملاحظة. أعد فتح المراجعة';
  end if;
  if p_action='respond' then
    if p_role not in ('supervisor','admin') or v_finding.status='closed' then
      raise exception 'لا يمكن الرد على هذه الملاحظة' using errcode='42501';
    end if;
    if coalesce(btrim(p_payload->>'reply'),'')='' then raise exception 'اكتب رد المعالجة'; end if;
    update public.quality_findings set reply=btrim(p_payload->>'reply'),status='resolved',updated_at=clock_timestamp()
      where id=v_finding.id;
  elsif p_action in ('close','reopen') then
    if p_role not in ('quality','admin') then raise exception 'الإغلاق لمراقب الجودة فقط' using errcode='42501'; end if;
    if p_action='close' and v_finding.status<>'resolved' then raise exception 'الملاحظة لم تتم معالجتها بعد'; end if;
    update public.quality_findings set status=case when p_action='close' then 'closed' else 'open' end,
      updated_at=clock_timestamp() where id=v_finding.id;
  else
    raise exception 'الإجراء غير معروف';
  end if;
  update public.quality_reviews set updated_at=clock_timestamp() where id=v_review.id;
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function app.quality_dispatch(text,text,text,text,jsonb) from public;
grant usage on schema app to anon,authenticated;
grant execute on function app.quality_dispatch(text,text,text,text,jsonb) to anon,authenticated;
create function public.quality_api(p_role text,p_team_id text,p_password text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.quality_dispatch(p_role,p_team_id,p_password,p_action,p_payload);
$$;
revoke all on function public.quality_api(text,text,text,text,jsonb) from public;
grant execute on function public.quality_api(text,text,text,text,jsonb) to anon,authenticated;
