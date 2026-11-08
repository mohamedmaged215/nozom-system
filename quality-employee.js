(function(global){
  'use strict';
  let active=null;
  function start(employee,rpc){
    active?.destroy();active=null;
    const host=document.getElementById('employee-quality');
    host.hidden=employee.role!=='مشرف';
    if(host.hidden)return;
    host.innerHTML='<div data-quality-access class="qa-root"></div><div data-quality-notifications></div><section data-quality-panel hidden><div class="qa-root qa-actions"><button type="button" data-quality-close>العودة للعمل</button></div><div data-quality-reviews></div></section>';
    const storageKey=`qa_portal_${employee.id}`;
    const fragment=new URLSearchParams(global.location.hash.slice(1));
    const linkedEmployee=new URLSearchParams(global.location.search).get('empId');
    let token=linkedEmployee===employee.id ? fragment.get('qualityToken') : null;
    try{token ||= sessionStorage.getItem(storageKey);}catch{}
    let notifier=null,panel=null,disposed=false;
    const credentials=()=>({p_role:'quality_link',p_team_id:employee.team_id,p_password:token});
    const panelHost=host.querySelector('[data-quality-panel]');
    async function open(reviewId){
      panelHost.hidden=false;
      if(!panel)panel=global.QualityReviews.mount(host.querySelector('[data-quality-reviews]'),{rpc,credentials,initialReviewId:reviewId});
      else if(reviewId)await panel.openReview(reviewId);
      else await panel.refresh();
      panelHost.scrollIntoView({behavior:'smooth',block:'start'});
    }
    function connect(){
      host.querySelector('[data-quality-access]').replaceChildren();
      notifier=global.QualityNotifications.mount(host.querySelector('[data-quality-notifications]'),{rpc,credentials,onOpen:open,identity:employee.id});
      try{sessionStorage.setItem(storageKey,token);}catch{}
      if(linkedEmployee===employee.id && fragment.get('qualityReview'))open(fragment.get('qualityReview'));
    }
    if(token){connect();}
    else{
      const access=host.querySelector('[data-quality-access]');
      access.innerHTML='<form data-activate class="qa-activation"><h3>مراجعات الجودة</h3><div><label for="qa-activate-password">كلمة مرور المشرف لتفعيل التنبيهات</label><input id="qa-activate-password" name="password" type="password" autocomplete="current-password" required></div><button class="qa-primary" type="submit">تفعيل</button><div class="qa-error" role="alert"></div></form>';
      access.querySelector('form').addEventListener('submit',async event=>{
        event.preventDefault();const form=event.target,button=form.querySelector('button');
        if(button.disabled)return;button.disabled=true;
        try{
          const result=await rpc('quality_api',{p_role:'supervisor',p_team_id:employee.team_id,p_password:form.elements.password.value,p_action:'portal_links',p_payload:{}});
          if(disposed)return;
          const link=result.supervisors.find(s=>s.employee_id===employee.id);
          if(!link)throw new Error('لم يتم العثور على رابط هذا المشرف');
          token=link.token;
          if(linkedEmployee===employee.id){fragment.set('qualityToken',token);global.history.replaceState(null,'',`${global.location.pathname}${global.location.search}#${fragment}`);}
          connect();
        }catch(error){form.querySelector('[role=alert]').textContent=error.message;}
        finally{button.disabled=false;}
      });
    }
    host.querySelector('[data-quality-close]').addEventListener('click',()=>{
      if(panel?.hasUnsavedChanges() && !global.confirm('يوجد رد أو تعديل غير محفوظ. هل تريد العودة؟'))return;
      panelHost.hidden=true;
    });
    active={destroy(){disposed=true;notifier?.destroy();panel?.destroy();host.replaceChildren();}};
  }
  global.EmployeeQuality={start};
})(window);
