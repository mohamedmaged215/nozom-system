import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(path.join(process.env.QUALITY_NODE_MODULES,'package.json'));
const {chromium}=require('playwright');
const errors=[];
const html=`<!doctype html><html><head><meta charset="utf-8"></head><body>
  <button id="other">Other action</button><div id="alerts"></div>
  <script>
    localStorage.setItem('qa_notification_sound','false');
    window.audioStarts=0;window.audioStops=0;window.audioDecodes=0;window.audioContexts=[];window.activationAtStart=[];
    const NativeContext=window.AudioContext;
    window.AudioContext=class extends NativeContext {
      constructor(...args){super(...args);audioContexts.push(this);}
      decodeAudioData(...args){return super.decodeAudioData(...args).then(buffer=>{audioDecodes++;return buffer;});}
    };
    const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start=function(...args){audioStarts++;activationAtStart.push(navigator.userActivation.hasBeenActive);return start.apply(this,args);};
    AudioBufferSourceNode.prototype.stop=function(...args){audioStops++;return stop.apply(this,args);};
    window.snapshot={unread_count:1,reviews:[{id:'review-a',revision:1,unread:true,title:'Test review'}]};
  </script>
  <script src="/quality-notifications.js"></script>
  <script>
    window.notifier=QualityNotifications.mount(document.getElementById('alerts'),{
      identity:'sound-test',credentials:()=>({}),onOpen:()=>{},rpc:async()=>structuredClone(snapshot)
    });
  </script>
</body></html>`;

async function fixture(browser,{delayAudio=false,touch=false}={}){
  const context=await browser.newContext({hasTouch:touch,isMobile:touch,viewport:touch?{width:390,height:844}:{width:1000,height:700}});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  let releaseAudio;
  const gate=new Promise(resolve=>{releaseAudio=resolve;});
  await page.route('http://quality.test/**',async route=>{
    const file=new URL(route.request().url()).pathname;
    if(file==='/')return route.fulfill({contentType:'text/html',body:html});
    if(file==='/assets/quality-notification.mp3'){
      if(delayAudio)await gate;
    }
    assert.ok(['/quality-notifications.js','/assets/quality-notification.mp3'].includes(file));
    await route.fulfill({path:path.resolve(file.slice(1))});
  });
  await page.goto('http://quality.test/');
  await page.locator('[data-unread-count]').getByText('1',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-sound]').getAttribute('aria-pressed'),'true','old saved mute must not disable a new visit');
  return {page,context,releaseAudio};
}

const blocked=await chromium.launch({executablePath:process.env.QUALITY_BROWSER,headless:true,args:['--autoplay-policy=document-user-activation-required']});
let allowed;
try{
  const {page,context}=await fixture(blocked);
  assert.equal(await page.evaluate(()=>audioContexts[0].state),'suspended');
  assert.equal(await page.evaluate(()=>audioStarts),0,'blocked autoplay should stay pending');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('qa_notification_audio_sound-test')),null,'blocked alert was marked played');
  await page.locator('#other').click();
  await page.waitForFunction(()=>audioStarts===1);
  assert.deepEqual(JSON.parse(await page.evaluate(()=>sessionStorage.getItem('qa_notification_audio_sound-test'))),{'review-a':1});
  await page.locator('#other').click();
  await page.evaluate(()=>notifier.refresh());
  assert.equal(await page.evaluate(()=>audioStarts),1,'same revision played twice');
  await page.getByRole('button',{name:'كتم صوت التنبيهات'}).click();
  assert.equal(await page.evaluate(()=>audioStops),1);
  await page.evaluate(async()=>{snapshot.reviews[0].revision=2;await notifier.refresh();});
  await page.locator('#other').click();
  assert.equal(await page.evaluate(()=>audioStarts),1,'interaction overrode manual mute');
  await page.getByRole('button',{name:'تشغيل صوت التنبيهات'}).click();
  await page.waitForFunction(()=>audioStarts===2);
  await page.evaluate(()=>notifier.destroy());
  assert.equal(await page.evaluate(()=>audioContexts[0].state),'closed');
  await page.locator('#other').click();
  assert.equal(await page.evaluate(()=>audioStarts),2,'destroyed notifier played');
  await context.close();

  const keyboard=await fixture(blocked);
  await keyboard.page.keyboard.press('a');
  await keyboard.page.waitForFunction(()=>audioStarts===1);
  await keyboard.context.close();

  const touch=await fixture(blocked,{touch:true});
  await touch.page.locator('#other').tap();
  await touch.page.waitForFunction(()=>audioStarts===1);
  await touch.context.close();

  const read=await fixture(blocked);
  await read.page.evaluate(async()=>{snapshot.unread_count=0;snapshot.reviews[0].unread=false;await notifier.refresh();});
  await read.page.locator('#other').click();
  await read.page.waitForFunction(()=>audioContexts[0].state==='running');
  assert.equal(await read.page.evaluate(()=>audioStarts),0,'already-read pending alert played');
  await read.context.close();

  const cancelled=await fixture(blocked,{delayAudio:true});
  const requested=cancelled.page.waitForRequest('**/assets/quality-notification.mp3');
  await cancelled.page.locator('#other').click();
  await requested;
  await cancelled.page.getByRole('button',{name:'كتم صوت التنبيهات'}).click();
  const loaded=cancelled.page.waitForResponse('**/assets/quality-notification.mp3');
  cancelled.releaseAudio();
  await loaded;
  await cancelled.page.waitForFunction(()=>audioDecodes===1);
  assert.equal(await cancelled.page.evaluate(()=>audioStarts),0,'muted pending download played');
  await cancelled.page.getByRole('button',{name:'تشغيل صوت التنبيهات'}).click();
  await cancelled.page.waitForFunction(()=>audioStarts===1);
  await cancelled.context.close();

  allowed=await chromium.launch({executablePath:process.env.QUALITY_BROWSER,headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const automatic=await fixture(allowed);
  await automatic.page.waitForFunction(()=>audioStarts===1);
  assert.equal(await automatic.page.evaluate(()=>activationAtStart[0]),false,'autoplay required a hidden interaction');
  await automatic.page.getByRole('button',{name:'كتم صوت التنبيهات'}).click();
  await automatic.page.reload();
  await automatic.page.locator('[data-sound][aria-pressed=true]').waitFor();
  await automatic.context.close();
  assert.deepEqual(errors,[]);
  console.log('Sound browser checks passed: enabled on entry, allowed autoplay, blocked-alert retry, mouse/keyboard/touch activation, mute, deduplication, read cancellation, delayed download, cleanup.');
}finally{
  await blocked.close();
  await allowed?.close();
}
