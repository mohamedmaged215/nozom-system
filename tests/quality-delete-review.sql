begin;
do $$
<<quality_delete_test>>
declare
  admin_password text;
  test_password text:=gen_random_uuid()::text;
  test_team text:='qa_delete_'||gen_random_uuid()::text;
  test_client text:='qa_delete_'||gen_random_uuid()::text;
  review_id uuid;
  peer_id uuid;
  doc jsonb;
  denied boolean;
begin
  select password into strict admin_password from public.credentials where role='admin' limit 1;
  insert into public.teams(id,name) values(test_team,'Delete review test');
  insert into public.clients(id,name,team_id) values(test_client,'Delete review client',test_team);
  insert into public.credentials(role,team_id,password) values('supervisor',test_team,test_password);
  perform public.quality_api('admin',null,admin_password,'set_password',jsonb_build_object('password',test_password));
  doc:=public.quality_api('quality',null,test_password,'create',jsonb_build_object('team_id',test_team));
  review_id:=(doc->>'id')::uuid;
  doc:=public.quality_api('quality',null,test_password,'get',jsonb_build_object('review_id',review_id));
  perform public.quality_api('quality',null,test_password,'publish',jsonb_build_object('review_id',review_id,'updated_at',doc->>'updated_at','items',
    jsonb_build_array(jsonb_build_object('client_id',test_client,'category','أخرى','observation','Delete me'))));
  doc:=public.quality_api('quality',null,test_password,'get',jsonb_build_object('review_id',review_id));
  perform public.quality_api('supervisor',test_team,test_password,'respond',jsonb_build_object('review_id',review_id,'finding_id',doc->'items'->0->>'id','updated_at',doc->'items'->0->>'updated_at','reply','Test reply'));
  perform public.quality_api('supervisor',test_team,test_password,'mark_seen',jsonb_build_object('review_id',review_id,'revision',doc->>'notification_revision'));
  doc:=public.quality_api('quality',null,test_password,'create',jsonb_build_object('team_id',test_team,'title','Keep me'));
  peer_id:=(doc->>'id')::uuid;
  doc:=public.quality_api('quality',null,test_password,'get',jsonb_build_object('review_id',review_id));
  denied:=false;
  begin perform public.quality_api('supervisor',test_team,test_password,'delete_review',doc||jsonb_build_object('review_id',review_id));
    exception when insufficient_privilege then denied:=true; end;
  assert denied,'supervisor deleted review';
  denied:=false;
  begin perform public.quality_api('quality_link',test_team,'invalid','delete_review',doc||jsonb_build_object('review_id',review_id));
    exception when insufficient_privilege then denied:=true; end;
  assert denied,'portal deleted review';
  denied:=false;
  begin perform public.quality_api('quality',null,'invalid','delete_review',doc||jsonb_build_object('review_id',review_id));
    exception when others then denied:=true; end;
  assert denied,'bad password deleted review';
  denied:=false;
  begin perform public.quality_api('quality',null,test_password,'delete_review',doc||jsonb_build_object('review_id',review_id,'updated_at','2000-01-01T00:00:00Z'));
    exception when others then denied:=true; end;
  assert denied,'stale review deleted';
  perform public.quality_api('quality',null,test_password,'delete_review',doc||jsonb_build_object('review_id',review_id));
  assert not exists(select 1 from public.quality_reviews where id=review_id),'review remains';
  assert not exists(select 1 from public.quality_findings f where f.review_id=quality_delete_test.review_id),'findings remain';
  assert not exists(select 1 from public.quality_reads s where s.review_id=quality_delete_test.review_id),'read receipt remains';
  assert exists(select 1 from public.quality_reviews where id=peer_id),'other review affected';
  doc:=public.quality_api('admin',null,admin_password,'get',jsonb_build_object('review_id',peer_id));
  perform public.quality_api('admin',null,admin_password,'delete_review',doc||jsonb_build_object('review_id',peer_id));
  assert not exists(select 1 from public.quality_reviews where id=peer_id),'empty draft remains';
end;
$$;
rollback;
select 'Review deletion, cascade, concurrency and permissions passed' as result;
