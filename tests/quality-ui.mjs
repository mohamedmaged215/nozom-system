import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(path.join(process.env.QUALITY_NODE_MODULES,'package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:process.env.QUALITY_BROWSER,headless:true});
const output=path.join(os.tmpdir(),'nozom-quality-browser');
await fs.mkdir(output,{recursive:true});
const errors=[];
const teams=[{id:'team-6',name:'advanced team-6'}];
const clients=[{id:'client-a',name:'شركة أمد الصناعة',team_id:'team-6'},{id:'client-b',name:'جيف هومز',team_id:'team-6'}];
const items=[
  {id:'finding-a',client_id:'client-a',client_name:clients[0].name,category:'الأرشفة والمستندات',observation:'مستندات رسمية ناقصة',details:'استكمال السجل التجاري وعقد الإيجار ضمن مجلد المستندات الرسمية للشركة.',status:'resolved',reply:'تم رفع السجل التجاري وعقد الإيجار، وتنظيم الملفات وتسميتها على الدرايف الموحد.'},
  {id:'finding-b',client_id:'client-a',client_name:clients[0].name,category:'البنوك',observation:'رصيد البنك غير مطابق',details:'يرجى مراجعة مذكرة التسوية البنكية وإرفاق كشف الحساب بعد استكمال الحركات المعلقة.',status:'open',reply:''},
  {id:'finding-c',client_id:'client-a',client_name:clients[0].name,category:'الإقرارات والضريبة',observation:'إقرار أو إيصال استلام ناقص',details:'إرفاق إيصال استلام الإقرار الضريبي للربع الثالث.',status:'closed',reply:'تم إرفاق الإقرار وإيصال الاستلام في مجلد الربع الثالث.'},
  {id:'finding-d',client_id:'client-b',client_name:clients[1].name,category:'الأرشفة والمستندات',observation:'أرشفة العميل غير موجودة',details:'تجهيز مجلد العميل على الدرايف الموحد وإرفاق المستندات المتاحة.',status:'open',reply:''}
];
const review={id:'ui-review',team_id:'team-6',title:'مراجعة الأرشفة والحسابات',status:'sent',created_at:'2026-11-08T12:00:00Z',updated_at:'2026-11-08T12:00:00Z',notification_revision:1,seen_revision:1,items};
try{
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  context.setDefaultTimeout(15000);
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/rest/v1/rpc/**',async route=>{
    const method=route.request().url().split('/').at(-1);
    let result={active:true};
    if(method==='quality_api'){
      const p=route.request().postDataJSON();
      if(p.p_action==='list')result={teams,clients,reviews:[{...review,total:4,closed:1}]};
      else if(p.p_action==='get')result=review;
      else if(p.p_action==='delivery')result={supervisors:[{employee_id:'sup-6',team_id:'team-6',name:'مشرف تيم 6',token:'ui-only'}],contacts:[{team_id:'team-6',phone:'201000000000'}]};
      else throw new Error(`Unexpected UI action ${p.p_action}`);
    }
    await route.fulfill({json:result});
  });
  await page.goto(pathToFileURL(path.resolve('quality.html')).href);
  await page.locator('#qa-password').fill('ui-only');
  await page.getByRole('button',{name:'دخول',exact:true}).click();
  await page.getByRole('button',{name:review.title,exact:true}).click();
  await page.locator('.qa-detail .qa-finding').first().waitFor();
  assert.equal(await page.locator('.qa-finding').count(),4);
  await page.screenshot({path:path.join(output,'quality-redesign-desktop.png'),fullPage:true});
  await page.getByRole('tab',{name:/بانتظار الاعتماد/}).click();
  assert.equal(await page.locator('.qa-finding').count(),1);
  await page.getByRole('button',{name:'اعتماد وإغلاق',exact:true}).waitFor();
  await page.getByRole('tab',{name:/بانتظار الاعتماد/}).press('ArrowLeft');
  assert.equal(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-status'),'closed');
  await page.locator('[role=tab][aria-selected=true]').press('Home');
  assert.equal(await page.locator('.qa-finding').count(),4);
  const reviewMenu=page.getByRole('button',{name:'خيارات المراجعة',exact:true});
  await reviewMenu.click();
  await page.getByRole('button',{name:'تصدير Excel',exact:true}).waitFor();
  await reviewMenu.press('Escape');
  assert.equal(await page.locator('.qa-menu[open]').count(),0);
  assert.equal(await reviewMenu.evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'خيارات الملاحظة',exact:true}).first().click();
  await reviewMenu.click();
  assert.equal(await page.locator('.qa-menu[open]').count(),1);
  await page.getByRole('heading',{name:review.title,exact:true}).click();
  assert.equal(await page.locator('.qa-menu[open]').count(),0);
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`page overflow at ${width}`);
    await reviewMenu.click();
    const box=await page.locator('.qa-menu[open] .qa-menu-popup').boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=width,`menu outside ${width}px viewport`);
    await reviewMenu.press('Escape');
    const clipped=await page.locator('.qa-review-tools,.qa-finding,.qa-response,[role=tab]').evaluateAll(elements=>elements.some(el=>{
      const rect=el.getBoundingClientRect();return rect.left<0 || rect.right>innerWidth+1;
    }));
    assert.equal(clipped,false,`clipped element at ${width}`);
    await page.screenshot({path:path.join(output,`quality-redesign-mobile-${width}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('Quality UI passed: status filters, keyboard tabs, dropdowns, Escape, outside click, desktop and 390/320px layouts.');
}finally{await browser.close();}
