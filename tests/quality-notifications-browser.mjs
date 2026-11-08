import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(path.join(process.env.QUALITY_NODE_MODULES,'package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:process.env.QUALITY_BROWSER,headless:true});
const output=path.join(os.tmpdir(),'nozom-quality-browser');
await fs.mkdir(output,{recursive:true});
const errors=[];
const supervisor={id:'sup-notification',name:'مشرف الاختبار',team_id:'team-a',role:'مشرف',is_active:true};
const employee={id:'employee-b',name:'موظف الاختبار',team_id:'team-a',role:'موظف',is_active:true};
const teams=[{id:'team-a',name:'advanced team-6',is_active:true}];
const clients=[{id:'client-a',name:'شركة الاختبار',team_id:'team-a'}];
const review={id:'10000000-0000-4000-8000-000000000001',team_id:'team-a',title:'مراجعة الأرشفة الجديدة',status:'sent',
  created_at:'2026-11-08T12:00:00Z',updated_at:'2026-11-08T12:00:00Z',notification_revision:1,seen_revision:0,
  items:[{id:'20000000-0000-4000-8000-000000000001',client_id:'client-a',client_name:'شركة الاختبار',category:'البنوك',observation:'رصيد البنك غير مطابق',details:'مراجعة التسوية البنكية',status:'open',reply:'',updated_at:'2026-11-08T12:00:00Z'}]};
const token='notification-test-token';
const delivery={supervisors:[{employee_id:supervisor.id,name:supervisor.name,team_id:supervisor.team_id,token}],contacts:[{team_id:'team-a',phone:'201000000000'}]};
async function setup(page,url){
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/rest/v1/rpc/**',async route=>{
    const method=route.request().url().split('/').at(-1);
    const args=route.request().postDataJSON();
    let result=[];
    if(method==='check_system_status')result={active:true};
    else if(method==='get_login_bootstrap')result={teams,employees:[supervisor,employee]};
    else if(method==='get_reports')result={rows:[]};
    else if(method==='get_clients')result=clients;
    else if(method==='quality_api'){
      const p=args.p_payload || {};
      if(args.p_role==='quality_link'){
        assert.equal(args.p_password,token);assert.equal(args.p_team_id,'team-a');
      }
      switch(args.p_action){
        case 'list':result={teams,clients,reviews:[{...review,total:1,closed:0}]};break;
        case 'get':assert.equal(p.review_id,review.id);result=review;break;
        case 'delivery':result=delivery;break;
        case 'portal_links':assert.equal(args.p_role,'supervisor');result=delivery;break;
        case 'notifications':result={unread_count:review.notification_revision>review.seen_revision?1:0,
          reviews:[{id:review.id,title:review.title,revision:review.notification_revision,unread:review.notification_revision>review.seen_revision}]};break;
        case 'mark_seen':
          assert.ok(p.revision<=review.notification_revision);
          review.seen_revision=Math.max(review.seen_revision,p.revision);result={ok:true};break;
        case 'respond':
          assert.equal(args.p_role,'quality_link');
          assert.equal(p.finding_id,review.items[0].id);
          Object.assign(review.items[0],{reply:p.reply,status:'resolved',updated_at:'2026-11-08T12:30:00Z'});result={ok:true};break;
        default:throw new Error(`Unexpected notification action ${args.p_action}`);
      }
    }
    await route.fulfill({json:result});
  });
  await page.goto(url);
}
function employeeUrl(id,withToken=true){
  const url=pathToFileURL(path.resolve('employee.html'));
  url.search=new URLSearchParams({empId:id,teamId:'team-a'}).toString();
  if(withToken)url.hash=new URLSearchParams({qualityToken:token}).toString();
  return url.href;
}
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  await setup(page,employeeUrl(supervisor.id));
  await page.locator('[data-unread-count]').getByText('1',{exact:true}).waitFor();
  assert.equal(review.seen_revision,0,'banner marked review read');
  await page.getByRole('button',{name:'تشغيل صوت التنبيهات'}).click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('qa_notification_sound')),'true');
  await page.getByRole('button',{name:'كتم صوت التنبيهات'}).click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('qa_notification_sound')),'false');
  await page.getByRole('button',{name:'عرض المراجعة',exact:true}).click();
  await page.locator('#employee-quality .qa-finding').waitFor();
  await page.locator('[data-unread-count]').getByText('0',{exact:true}).waitFor();
  assert.equal(review.items[0].status,'open','viewing resolved a finding');
  assert.equal(await page.getByRole('button',{name:'تعديل المراجعة',exact:true}).count(),0);
  await page.locator('#employee-quality form[data-reply] textarea').fill('تمت مراجعة التسوية وإرفاق المستند');
  await page.getByRole('button',{name:'تمت المعالجة',exact:true}).click();
  await page.locator('#employee-quality .qa-badge[data-status=resolved]').waitFor();
  assert.equal(review.notification_revision,1);
  await page.locator('#employee-quality').screenshot({path:path.join(output,'personal-quality-desktop.png')});
  review.notification_revision=2;review.title='مراجعة جودة محدثة';
  review.items[0].details='تفاصيل جديدة للمراجعة';review.items[0].status='open';
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('[data-unread-count]').getByText('1',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.locator('#employee-quality').screenshot({path:path.join(output,'personal-quality-mobile-alert.png')});
  await page.getByRole('button',{name:'عرض المراجعة',exact:true}).click();
  await page.getByText('تفاصيل جديدة للمراجعة',{exact:true}).waitFor();
  await page.locator('[data-unread-count]').getByText('0',{exact:true}).waitFor();
  assert.equal(review.seen_revision,2);
  await page.locator('#employee-quality').screenshot({path:path.join(output,'personal-quality-mobile-read.png')});
  const normal=await context.newPage();
  await setup(normal,employeeUrl(employee.id,false));
  await normal.locator('#main-content').waitFor({state:'visible'});
  assert.equal(await normal.locator('#employee-quality').isVisible(),false,'employee sees quality portal');
  const oldLink=await context.newPage();
  await setup(oldLink,employeeUrl(supervisor.id,false));
  await oldLink.locator('#qa-activate-password').fill('test-password');
  await oldLink.getByRole('button',{name:'تفعيل',exact:true}).click();
  await oldLink.locator('[data-unread-count]').waitFor();
  assert.ok(oldLink.url().includes('qualityToken='));
  review.notification_revision=3;
  const direct=await context.newPage();
  await setup(direct,`${employeeUrl(supervisor.id)}&qualityReview=${review.id}`);
  await direct.locator('#employee-quality .qa-finding').waitFor();
  await direct.locator('[data-unread-count]').getByText('0',{exact:true}).waitFor();
  assert.equal(review.seen_revision,3,'direct review link did not mark viewed revision');
  assert.equal(review.items[0].status,'open','deep link processed finding');
  const reviewer=await context.newPage();
  await setup(reviewer,pathToFileURL(path.resolve('quality.html')).href);
  await reviewer.locator('#qa-password').fill('reviewer-password');
  await reviewer.getByRole('button',{name:'دخول',exact:true}).click();
  await reviewer.getByRole('button',{name:review.title,exact:true}).click();
  await reviewer.getByText('تمت المشاهدة',{exact:true}).waitFor();
  const wa=new URL(await reviewer.getByRole('link',{name:'تنبيه عبر واتساب'}).getAttribute('href'));
  assert.equal(wa.pathname,'/201000000000');
  const text=wa.searchParams.get('text');assert.ok(text.includes('qualityToken='));assert.ok(text.includes('qualityReview='));
  assert.deepEqual(errors,[]);
  console.log('Notification browser checks passed: personal link, bell, read sync, sound, replies, updated review, employee isolation, old-link activation, WhatsApp.');
}finally{await browser.close();}
