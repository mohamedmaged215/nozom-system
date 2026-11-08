(function(global){
  'use strict';
  const soundUrl=new URL('assets/quality-notification.mp3',document.currentScript?.src || global.location.href).href;
  const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
  const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function mount(root,{rpc,credentials,onOpen,identity}){
    let disposed=false,fetching=false,pending=false;
    let sound=false,audio=null,bufferPromise=null,source=null,playback=0;
    let known={};
    const key=`qa_notifications_${identity}`;
    try{sound=localStorage.getItem('qa_notification_sound')==='true';known=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
    let latest={unread_count:0,reviews:[]};
    root.classList.add('qa-root','qa-notifier');
    function render(message=''){
      const first=latest.reviews.find(r=>r.unread);
      root.innerHTML=`<div class="qa-notification-bar"><h3>مراجعات الجودة</h3>
        <button class="qa-notification-bell" data-open title="مراجعات الجودة" aria-label="مراجعات الجودة، ${latest.unread_count} جديدة">${icon('bell')}<span data-unread-count>${latest.unread_count}</span></button>
        <button class="qa-icon" data-sound aria-pressed="${sound}" title="${sound?'كتم صوت التنبيهات':'تشغيل صوت التنبيهات'}">${icon(sound?'volume-2':'volume-x')}</button>
        <span class="qa-notification-status" role="status">${escape(message || (latest.unread_count?`${latest.unread_count} مراجعات جديدة أو محدثة`:'لا توجد مراجعات جديدة'))}</span></div>
        ${first?`<div class="qa-incoming" role="status"><span>وصلتك مراجعة جودة: <strong>${escape(first.title)}</strong></span><button data-review="${escape(first.id)}">${icon('arrow-up-left')}عرض المراجعة</button></div>`:''}`;
      global.lucide?.createIcons({root});
    }
    async function unlock(){
      if(!sound || disposed)return;
      try{
        const Audio=global.AudioContext || global.webkitAudioContext;
        if(!audio && Audio)audio=new Audio();
        if(audio?.state==='suspended')await audio.resume();
      }catch{}
    }
    function stopSound(){
      playback++;
      if(source){source.stop();source.disconnect();source=null;}
    }
    async function chime(){
      if(!sound || audio?.state!=='running')return;
      stopSound();
      const request=playback;
      try{
        // Decode once; keep the gesture-unlocked context for subsequent alerts.
        if(!bufferPromise)bufferPromise=fetch(soundUrl).then(response=>{
          if(!response.ok)throw new Error('Notification audio unavailable');
          return response.arrayBuffer();
        }).then(bytes=>audio.decodeAudioData(bytes)).catch(error=>{bufferPromise=null;throw error;});
        const buffer=await bufferPromise;
        if(disposed || !sound || request!==playback || audio.state!=='running')return;
        const current=audio.createBufferSource();
        current.buffer=buffer;current.connect(audio.destination);source=current;
        current.onended=()=>{current.disconnect();if(source===current)source=null;};
        current.start();
      }catch{if(!disposed && sound && request===playback)render('تعذر تشغيل صوت التنبيه؛ جرّب تشغيله مرة أخرى');}
    }
    async function refresh(){
      if(disposed || document.hidden)return;
      if(fetching){pending=true;return;}
      fetching=true;
      try{
        const result=await rpc('quality_api',{...credentials(),p_action:'notifications',p_payload:{}});
        if(disposed)return;
        const fresh=result.reviews.some(r=>r.unread && Number(r.revision)>Number(known[r.id]||0));
        latest=result;
        latest.reviews.forEach(r=>{known[r.id]=r.revision;});
        try{sessionStorage.setItem(key,JSON.stringify(known));}catch{}
        render();if(fresh)chime();
      }catch{if(!disposed)render('تعذر تحديث التنبيهات؛ أعد المحاولة من الجرس');}
      finally{fetching=false;if(pending){pending=false;refresh();}}
    }
    root.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-sound')){
        sound=!sound;
        if(!sound)stopSound();
        try{localStorage.setItem('qa_notification_sound',String(sound));}catch{}
        await unlock();if(sound)chime();render();
      }else if(button.hasAttribute('data-review')){onOpen(button.dataset.review);}
      else if(button.hasAttribute('data-open')){refresh();onOpen();}
    });
    const visible=()=>{if(!document.hidden)refresh();};
    document.addEventListener('visibilitychange',visible);
    document.addEventListener('pointerdown',unlock);
    global.addEventListener('quality:seen',refresh);
    const interval=global.setInterval(refresh,30000);
    render('جاري التحقق من المراجعات...');
    refresh();
    return {refresh,destroy(){disposed=true;stopSound();global.clearInterval(interval);global.removeEventListener('quality:seen',refresh);document.removeEventListener('visibilitychange',visible);document.removeEventListener('pointerdown',unlock);audio?.close().catch(()=>{});root.replaceChildren();}};
  }
  global.QualityNotifications={mount};
})(window);
