import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(path.join(process.env.QUALITY_NODE_MODULES, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: process.env.QUALITY_BROWSER, headless:true });
const output = path.join(os.tmpdir(),'nozom-quality-browser');
await fs.mkdir(output,{recursive:true});
const fixture = {
  teams:[{id:'team-a',name:'advanced team-6'}],
  clients:[{id:'client-a',name:'شركة الاختبار',team_id:'team-a'}],
  reviews:[]
};
const delivery={supervisors:[{employee_id:'sup-a',team_id:'team-a',name:'مشرف الاختبار',token:'test-portal-token'}],contacts:[{team_id:'team-a',phone:'966500000000'}]};
let review;
let revision=0;
let deletionCalls=0;
function stamp(){return new Date(Date.UTC(2026,10,8,12,0,revision++)).toISOString();}
const reviewId='10000000-0000-4000-8000-000000000001';
const errors=[];

async function setup(page, file='quality.html') {
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/rest/v1/rpc/**',async route=>{
    const method=route.request().url().split('/').at(-1);
    if(method==='check_system_status'){
      await route.fulfill({json:{active:true}});return;
    }
    if(method==='get_login_bootstrap'){
      await route.fulfill({json:{teams:fixture.teams,employees:[]}});return;
    }
    assert.equal(method,'quality_api');
    const request=route.request().postDataJSON();
    const payload=request.p_payload || {};
    let result={};
    switch(request.p_action){
      case 'list': result=fixture;break;
      case 'delivery':result=delivery;break;
      case 'mark_seen':review.seen_revision=payload.revision;break;
      case 'save_contact':delivery.contacts=[{team_id:payload.team_id,phone:payload.phone}];break;
      case 'create':
        review={id:reviewId,team_id:payload.team_id,title:payload.title || 'مراجعة جودة',created_at:stamp(),updated_at:stamp(),status:'draft',items:[]};
        fixture.reviews=[{...review,total:0,closed:0}];result={id:review.id};break;
      case 'get':result=review;break;
      case 'save':
      case 'publish':
        assert.equal(payload.updated_at,review.updated_at);
        review={...review,title:payload.title,status:request.p_action==='publish'?'sent':'draft',notification_revision:request.p_action==='publish'?1:0,updated_at:stamp(),
          items:payload.items.map((item,i)=>({...item,id:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,client_name:'شركة الاختبار',status:'open',reply:'',updated_at:stamp()}))};
        fixture.reviews=[{...review,total:review.items.length,closed:0}];break;
      case 'respond':{
        assert.equal(request.p_role,'supervisor');
        const item=review.items.find(i=>i.id===payload.finding_id);
        assert.equal(payload.updated_at,item.updated_at);
        Object.assign(item,{status:'resolved',reply:payload.reply,updated_at:stamp()});break;
      }
      case 'delete_finding':{
        assert.equal(request.p_role,'quality');
        const item=review.items.find(i=>i.id===payload.finding_id);
        assert.equal(payload.updated_at,item.updated_at);
        review.items=review.items.filter(i=>i.id!==item.id);
        review.updated_at=stamp();deletionCalls++;
        fixture.reviews=[{...review,total:review.items.length,closed:review.items.filter(i=>i.status==='closed').length}];break;
      }
      case 'edit_review':{
        assert.equal(request.p_role,'quality');
        assert.equal(payload.updated_at,review.updated_at);
        review.items=payload.items.map((row,i)=>{
          const previous=review.items.find(item=>item.id===row.id);
          const changed=previous && ['client_id','category','observation','details'].some(key=>row[key]!==previous[key]);
          return {...previous,...row,id:row.id || `30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,client_name:'شركة الاختبار',
            status:!previous || changed?'open':previous.status,reply:previous?.reply || '',updated_at:stamp()};
        });
        review.title=payload.title;review.updated_at=stamp();review.notification_revision++;
        fixture.reviews=[{...review,total:review.items.length,closed:review.items.filter(i=>i.status==='closed').length}];break;
      }
      case 'close':
      case 'reopen':{
        assert.equal(request.p_role,'quality');
        const item=review.items.find(i=>i.id===payload.finding_id);
        Object.assign(item,{status:request.p_action==='close'?'closed':'open',updated_at:stamp()});break;
      }
      default:throw new Error(`Unexpected action: ${request.p_action}`);
    }
    await route.fulfill({json:result});
  });
  await page.goto(pathToFileURL(path.resolve(file)).href);
}
async function noOverflow(page){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'horizontal page overflow');
}

try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();
  await setup(page);
  await page.locator('#qa-password').fill('test-only');
  await page.getByRole('button',{name:'دخول',exact:true}).click();
  await page.getByRole('button',{name:'مراجعة جديدة'}).click();
  await page.locator('#qa-new-team').selectOption('team-a');
  await page.locator('#qa-new-title').fill('مراجعة الأرشفة والحسابات');
  await page.getByRole('button',{name:'بدء المراجعة'}).click();
  await page.getByRole('button',{name:'إضافة ملاحظة',exact:true}).click();
  await page.locator('#qa-client-0').selectOption('client-a');
  await page.locator('#qa-category-0').selectOption('البنوك');
  await page.locator('#qa-observation-0').selectOption('رصيد البنك غير مطابق');
  await page.locator('#qa-details-0').fill('رصيد كشف الحساب ١٩٣٧٫٤٧ مدين، والميزان ٢٨٣٩٫٩٢ مدين.');
  await page.getByRole('button',{name:'إضافة ملاحظة',exact:true}).click();
  await page.locator('#qa-category-1').selectOption('أخرى');
  await page.locator('#qa-custom-1').fill('مراجعة المستندات المرسلة من العميل');
  await page.getByRole('button',{name:'حفظ المسودة',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-draft-row]').length===2 && !document.querySelector('[data-save=save]').disabled);
  assert.equal(review.items.length,2);
  await noOverflow(page);
  await page.screenshot({path:path.join(output,'desktop-draft.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await noOverflow(page);
  await page.screenshot({path:path.join(output,'mobile-draft.png'),fullPage:true});
  await page.getByRole('button',{name:'إضافة ملاحظة',exact:true}).click();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('[data-action=remove]').last().click();
  assert.equal(await page.locator('[data-draft-row]').count(),3,'draft cancellation removed row');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-action=remove]').last().click();
  assert.equal(await page.locator('[data-draft-row]').count(),2);
  await page.getByRole('button',{name:'إرسال للمشرف'}).click();
  await page.locator('.qa-finding').first().waitFor();
  assert.equal(review.status,'sent');
  const whatsapp=new URL(await page.getByRole('link',{name:'تنبيه عبر واتساب'}).getAttribute('href'));
  assert.equal(whatsapp.hostname,'wa.me');
  assert.ok(whatsapp.searchParams.get('text').includes('qualityReview='));
  assert.equal(await page.locator('form[data-reply]').count(),0,'reviewer can respond');

  const supervisor=await context.newPage();
  await setup(supervisor);
  await supervisor.evaluate(()=>{
    document.getElementById('qa-login').hidden=true;
    const root=document.getElementById('qa-app');root.hidden=false;
    QualityReviews.mount(root,{rpc:qualityRpc,credentials:()=>({p_role:'supervisor',p_team_id:'team-a',p_password:'test-only'})});
  });
  await supervisor.getByRole('button',{name:'مراجعة الأرشفة والحسابات',exact:true}).click();
  assert.equal(await supervisor.getByRole('button',{name:'مراجعة جديدة'}).count(),0);
  assert.equal(await supervisor.getByRole('button',{name:'حذف الملاحظة',exact:true}).count(),0,'supervisor can delete');
  assert.equal(await supervisor.getByRole('button',{name:'تعديل المراجعة',exact:true}).count(),0,'supervisor can edit review');
  await supervisor.locator('form[data-reply]').first().locator('textarea').fill('تمت مطابقة الحساب وإرفاق التسوية على الدرايف.');
  await supervisor.locator('form[data-reply]').first().getByRole('button',{name:'تمت المعالجة',exact:true}).click();
  await supervisor.locator('.qa-badge[data-status=resolved]').waitFor();
  await noOverflow(supervisor);
  await supervisor.screenshot({path:path.join(output,'supervisor-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'تحديث',exact:true}).click();
  await page.getByRole('button',{name:'إغلاق الملاحظة'}).click();
  await page.locator('.qa-badge[data-status=closed]').waitFor();
  await noOverflow(page);
  await page.screenshot({path:path.join(output,'mobile-review.png'),fullPage:true});
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Excel',exact:true}).click();
  const download=await downloadPromise;
  await download.saveAs(path.join(output,'review.xlsx'));
  const bytes=await fs.readFile(path.join(output,'review.xlsx'));
  const exported=await page.evaluate(base64=>{
    const book=XLSX.read(base64,{type:'base64'});
    return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
  },bytes.toString('base64'));
  assert.equal(exported.length,2);
  assert.equal(exported[0]['الحالة'],'مغلقة');
  assert.equal(exported[0]['رد المشرف'],'تمت مطابقة الحساب وإرفاق التسوية على الدرايف.');
  assert.equal(exported[1]['الملاحظة'],'مراجعة المستندات المرسلة من العميل');
  const admin=await context.newPage();
  await setup(admin,'admin.html');
  await admin.evaluate(()=>{
    STATE.role='supervisor';STATE.teamId='team-a';STATE.password='test-only';
    document.getElementById('login-wrap').style.display='none';
    document.getElementById('main-wrap').style.display='flex';
    document.getElementById('sidebar').style.display='flex';
    switchPanel('quality');
  });
  await admin.getByRole('button',{name:'مراجعة الأرشفة والحسابات',exact:true}).click();
  await admin.locator('#quality-root .qa-finding').first().waitFor();
  await noOverflow(admin);
  await admin.screenshot({path:path.join(output,'admin-panel-desktop.png'),fullPage:true});
  await admin.setViewportSize({width:390,height:844});
  await admin.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().left>=innerWidth-1);
  await noOverflow(admin);
  await admin.screenshot({path:path.join(output,'admin-panel-mobile.png'),fullPage:true});
  const originalId=review.items[0].id;
  const originalReply=review.items[0].reply;
  await page.getByRole('button',{name:'تعديل الملاحظة',exact:true}).first().click();
  await page.locator('#qa-details-0').fill('تعديل غير محفوظ');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'إلغاء',exact:true}).click();
  assert.equal(review.items[0].status,'closed');
  await page.getByRole('button',{name:'تعديل المراجعة',exact:true}).click();
  await page.locator('#qa-title').fill('مراجعة محدثة');
  await page.locator('#qa-details-0').fill('تفاصيل معدلة تحتاج مراجعة المشرف');
  await page.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();
  await page.getByRole('heading',{name:'مراجعة محدثة',exact:true}).waitFor();
  assert.equal(review.items[0].id,originalId);
  assert.equal(review.items[0].status,'open');
  assert.equal(review.items[0].reply,originalReply);
  await page.getByText('رد المشرف السابق',{exact:true}).waitFor();
  await page.getByRole('button',{name:'إضافة ملاحظة',exact:true}).click();
  await page.locator('#qa-category-2').selectOption('الأرشفة والمستندات');
  await page.locator('#qa-observation-2').selectOption('مستندات رسمية ناقصة');
  await noOverflow(page);
  await page.screenshot({path:path.join(output,'edit-review-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.qa-finding').length===3);
  assert.equal(review.items[2].status,'open');
  await page.getByRole('button',{name:'تعديل المراجعة',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-action=remove]').last().click();
  await page.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.qa-finding').length===2);
  page.once('dialog',dialog=>{
    assert.ok(dialog.message().includes('رد المشرف'));
    dialog.dismiss();
  });
  await page.getByRole('button',{name:'حذف الملاحظة',exact:true}).first().click();
  assert.equal(deletionCalls,0,'cancelled deletion called API');
  assert.equal(await page.locator('.qa-finding').count(),2);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'حذف الملاحظة',exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelectorAll('.qa-finding').length===1);
  assert.equal(deletionCalls,1);
  assert.equal(review.items[0].observation,'مراجعة المستندات المرسلة من العميل');
  await noOverflow(page);
  await page.screenshot({path:path.join(output,'delete-finding-mobile.png'),fullPage:true});
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'حذف الملاحظة',exact:true}).click();
  await page.getByText('لا توجد ملاحظات في هذه المراجعة',{exact:true}).waitFor();
  assert.equal(deletionCalls,2);
  assert.deepEqual(errors,[]);
  console.log('Browser workflow passed: draft, publish, reply, closure, Excel, mobile layout, editing, append, cancel, delete confirmation.');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
