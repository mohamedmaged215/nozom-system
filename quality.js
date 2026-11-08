(function (global) {
  'use strict';

  const catalog = {
    'الأرشفة والمستندات': ['أرشفة العميل غير موجودة','مستندات رسمية ناقصة','ملفات تحتاج تسمية','مستندات تحتاج تنظيم في مجلدات'],
    'المبيعات والمشتريات': ['ترميز الفواتير غير موحد','فواتير أو مرفقات ناقصة'],
    'الإقرارات والضريبة': ['إقرار أو إيصال استلام ناقص','نماذج سابقة ناقصة','رصيد الضريبة غير مطابق','تسويات ضريبية تحتاج مراجعة'],
    'البنوك': ['حركة البنك غير مكتملة','كشف حساب ناقص','تسمية الكشوف غير واضحة','رصيد البنك غير مطابق'],
    'أخرى': ['ملاحظة أخرى']
  };
  const statuses = { open:'مفتوحة', resolved:'تمت المعالجة', closed:'مغلقة' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const option = (value, text, selected) => `<option value="${escape(value)}"${value===selected?' selected':''}>${escape(text)}</option>`;
  const dateFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',numberingSystem:'latn',day:'2-digit',month:'2-digit',year:'numeric'});
  const date=value=>{
    const parts=Object.fromEntries(dateFormatter.formatToParts(new Date(value)).map(part=>[part.type,part.value]));
    return `${parts.day}-${parts.month}-${parts.year}`;
  };
  const badge = status => `<span class="qa-badge" data-status="${escape(status)}">${statuses[status] || 'مسودة'}</span>`;
  const readStatus = review => review.status==='draft' ? '' : `<span class="qa-badge" data-status="${Number(review.seen_revision)>=Number(review.notification_revision || 1)?'closed':'open'}">${Number(review.seen_revision)>=Number(review.notification_revision || 1)?'تمت المشاهدة':Number(review.seen_revision)>0?'تعديلات لم تشاهد':'لم تشاهد بعد'}</span>`;
  const findingsCount=count=>count===1?'ملاحظة واحدة':count===2?'ملاحظتان':`${count} ${count>=3 && count<=10?'ملاحظات':'ملاحظة'}`;

  function supervisorUrl(supervisor, reviewId='') {
    const url=new URL('employee.html',global.location.href);
    url.search=new URLSearchParams({empId:supervisor.employee_id,name:supervisor.name,teamId:supervisor.team_id,role:'مشرف'}).toString();
    const fragment=new URLSearchParams({qualityToken:supervisor.token});
    if(reviewId)fragment.set('qualityReview',reviewId);
    url.hash=fragment.toString();
    return url.href;
  }

  function exportRows(review, teamName) {
    return review.items.map(item => ({
      'المراجعة':review.title,'التيم':teamName,'تاريخ المراجعة':date(review.created_at),
      'العميل':item.client_name,'القسم':item.category,'الملاحظة':item.observation,
      'التفاصيل':item.details,'رد المشرف':item.reply,'الحالة':statuses[item.status]
    }));
  }

  function mount(root, { rpc, credentials, initialReviewId=null }) {
    let data = {teams:[],clients:[],reviews:[]};
    let review = null;
    let draft = [];
    let dirty = false;
    let busy = false;
    let disposed=false;
    let currentWork=Promise.resolve();
    let delivery={supervisors:[],contacts:[]};
    let teamFilter = '';
    let statusFilter = '';
    let findingFilter='all';
    const writer = () => ['admin','quality'].includes(credentials().p_role);
    const canReply = () => ['admin','supervisor','quality_link'].includes(credentials().p_role);
    const teamName = id => data.teams.find(t => t.id===id)?.name || 'التيم';
    const call = (action, payload={}) => rpc('quality_api',{...credentials(),p_action:action,p_payload:payload});
    const icons = () => global.lucide?.createIcons({root});
    root.classList.add('qa-root');

    function error(message) {
      const alert=root.querySelector('[data-error]');
      if(!disposed && alert)alert.textContent=message;
    }
    async function work(action) {
      if(disposed)return;
      if (busy) return currentWork;
      busy = true;
      root.querySelectorAll('button').forEach(b => { b.disabled=true; });
      currentWork=(async()=>{
        try { await action(); }
        catch(e) { error(e.message); }
        finally { busy=false; root.querySelectorAll('button').forEach(b => { b.disabled=false; }); }
      })();
      return currentWork;
    }
    function frame(content) {
      if(disposed)return;
      root.innerHTML = `<div data-error class="qa-error" role="alert"></div>${content}`;
      icons();
    }
    function actionMenu(label,content){
      return `<details class="qa-menu"><summary role="button" aria-label="${label}" title="${label}">${icon('ellipsis')}</summary><div class="qa-menu-popup">${content}</div></details>`;
    }
    function closeMenus(except=null){root.querySelectorAll('.qa-menu[open]').forEach(menu=>{if(menu!==except)menu.open=false;});}
    const outsideMenus=event=>{if(!event.target.closest('.qa-menu'))closeMenus();};
    document.addEventListener('click',outsideMenus);
    root.addEventListener('toggle',event=>{if(event.target.matches('.qa-menu') && event.target.open)closeMenus(event.target);},true);
    root.addEventListener('keydown',event=>{
      const menu=event.target.closest('.qa-menu[open]');
      if(event.key==='Escape' && menu){event.preventDefault();menu.open=false;menu.querySelector('summary').focus();return;}
      if(!event.target.matches('[role=tab]'))return;
      const tabs=Array.from(root.querySelectorAll('[role=tab]'));
      let index=tabs.indexOf(event.target);
      if(event.key==='ArrowLeft')index=(index+1)%tabs.length;
      else if(event.key==='ArrowRight')index=(index+tabs.length-1)%tabs.length;
      else if(event.key==='Home')index=0;
      else if(event.key==='End')index=tabs.length-1;
      else return;
      event.preventDefault();tabs[index].click();
    });
    async function fetchList() {
      data=await call('list');
      if(writer())delivery=await call('delivery');
    }
    function contacts(teamId='') {
      const selected=teamId || data.teams[0]?.id || '';
      const phone=delivery.contacts.find(c=>c.team_id===selected)?.phone || '';
      frame(`<div class="qa-toolbar"><button data-action="contacts-back">${icon('arrow-right')}رجوع</button><h2>أرقام واتساب المشرفين</h2></div>
        <form data-contact><div class="qa-editor-head"><label for="qa-contact-team">التيم</label><select id="qa-contact-team" name="team" required>
        ${data.teams.map(t=>option(t.id,t.name,selected)).join('')}</select></div>
        <div class="qa-editor-head"><label for="qa-contact-phone">رقم واتساب المشرف بكود الدولة</label><input id="qa-contact-phone" name="phone" type="tel" dir="ltr" autocomplete="tel" maxlength="30" value="${escape(phone)}" placeholder="+9665xxxxxxxx"></div>
        <button class="qa-primary" type="submit">${icon('save')}حفظ الرقم</button><div class="qa-message" data-contact-message role="status"></div></form>`);
    }
    function whatsapp() {
      const supervisor=delivery.supervisors.find(s=>s.team_id===review.team_id);
      const phone=delivery.contacts.find(c=>c.team_id===review.team_id)?.phone;
      if(!supervisor)return '<span class="qa-message">لا يوجد مشرف نشط لهذا التيم</span>';
      if(!phone)return `<button data-action="contacts" data-team="${escape(review.team_id)}">${icon('message-circle')}إضافة رقم المشرف</button>`;
      const text=`وصلتك مراجعة جودة بعنوان «${review.title}» لتيم ${teamName(review.team_id)}، تشمل ${review.items.length} ملاحظات. برجاء الدخول للاطلاع والمتابعة:\n${supervisorUrl(supervisor,review.id)}`;
      const url=`https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      return `<a class="qa-button qa-whatsapp" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${icon('message-circle')}تنبيه عبر واتساب</a>`;
    }
    function list() {
      review=null;
      const visible=data.reviews.filter(r => (!teamFilter || r.team_id===teamFilter) &&
        (!statusFilter || (statusFilter==='draft' ? r.status==='draft' : r.status==='sent')));
      frame(`<div class="qa-toolbar"><h2>مراجعات الجودة</h2>
        <button data-action="refresh" title="تحديث">${icon('refresh-cw')}</button>
        ${writer()?`<button data-action="contacts">${icon('phone')}أرقام المشرفين</button><button class="qa-primary" data-action="new">${icon('plus')}مراجعة جديدة</button>`:''}</div>
        <div class="qa-filters"><div><label for="qa-filter-team">التيم</label><select id="qa-filter-team" data-filter="team">
        ${option('','كل التيمات',teamFilter)}${data.teams.map(t=>option(t.id,t.name,teamFilter)).join('')}</select></div>
        <div><label for="qa-filter-status">المراجعات</label><select id="qa-filter-status" data-filter="status">
        ${option('','الكل',statusFilter)}${option('sent','مرسلة',statusFilter)}${writer()?option('draft','مسودات',statusFilter):''}</select></div></div>
        ${visible.length?`<div class="qa-scroll"><table class="qa-list"><thead><tr><th>المراجعة</th><th>التيم</th><th>التاريخ</th><th>الحالة</th><th>المغلق / الإجمالي</th>${writer()?'<th class="qa-row-actions">حذف</th>':''}</tr></thead><tbody>
        ${visible.map(r=>`<tr><td><button data-action="open" data-id="${r.id}">${escape(r.title)}</button></td><td>${escape(teamName(r.team_id))}</td><td><time class="qa-date" dir="ltr" datetime="${escape(r.created_at)}">${date(r.created_at)}</time></td>
        <td>${r.status==='draft'?badge('draft'):`مرسلة ${readStatus(r)}`}</td><td>${r.closed} / ${r.total}</td>
        ${writer()?`<td class="qa-row-actions"><button class="qa-danger qa-icon" data-action="delete-review" data-id="${r.id}" title="حذف المراجعة" aria-label="حذف المراجعة">${icon('trash-2')}</button></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="qa-empty">لا توجد مراجعات</div>'}`);
    }
    function createForm() {
      frame(`<div class="qa-toolbar"><button data-action="back">${icon('arrow-right')}رجوع</button><h2>مراجعة جديدة</h2></div>
        <form data-create><div class="qa-editor-head"><label for="qa-new-team">التيم</label>
        <select id="qa-new-team" name="team" required>${option('','اختر التيم','')}${data.teams.map(t=>option(t.id,t.name,'')).join('')}</select></div>
        <div class="qa-editor-head"><label for="qa-new-title">عنوان المراجعة (اختياري)</label><input id="qa-new-title" name="title" maxlength="160"></div>
        <button class="qa-primary" type="submit">${icon('plus')}بدء المراجعة</button></form>`);
    }
    function collect() {
      draft=Array.from(root.querySelectorAll('[data-draft-row]')).map(row=>({
        id:row.dataset.findingId || null,
        client_id:row.querySelector('[name=client]').value,
        category:row.querySelector('[name=category]').value,
        observation:row.querySelector('[name=custom]')?.value || row.querySelector('[name=observation]').value,
        details:row.querySelector('[name=details]').value
      }));
    }
    function draftRow(item,index) {
      const clients=data.clients.filter(c=>c.team_id===review.team_id);
      const category=item.category || '';
      const values=catalog[category] || [];
      const custom=category==='أخرى';
      return `<div class="qa-draft-row" data-draft-row="${index}" data-finding-id="${escape(item.id || '')}">
        <div><label for="qa-client-${index}">العميل</label><select id="qa-client-${index}" name="client" required>
        ${option('','اختر العميل',item.client_id)}${clients.map(c=>option(c.id,c.name,item.client_id)).join('')}</select></div>
        <div><label for="qa-category-${index}">القسم</label><select id="qa-category-${index}" name="category" required>
        ${option('','اختر القسم',category)}${Object.keys(catalog).map(c=>option(c,c,category)).join('')}</select></div>
        <div><label for="qa-observation-${index}">الملاحظة</label><select id="qa-observation-${index}" name="observation" required ${!category?'disabled':''}>
        ${option('','اختر الملاحظة',item.observation)}${values.map(v=>option(v,v,custom?'ملاحظة أخرى':item.observation)).join('')}</select></div>
        <button type="button" class="qa-icon qa-remove" title="حذف الملاحظة" aria-label="حذف الملاحظة" data-action="remove" data-index="${index}">${icon('trash-2')}</button>
        ${custom?`<div class="qa-draft-custom"><label for="qa-custom-${index}">الملاحظة المطلوبة</label><input id="qa-custom-${index}" name="custom" value="${escape(item.observation==='ملاحظة أخرى'?'':item.observation)}" maxlength="300" required></div>`:''}
        <div class="qa-draft-details"><label for="qa-details-${index}">التفاصيل (اختياري)</label><textarea id="qa-details-${index}" name="details" maxlength="4000">${escape(item.details)}</textarea></div></div>`;
    }
    function editor(title) {
      const sent=review.status==='sent';
      frame(`<div class="qa-toolbar"><button data-action="${sent?'cancel-edit':'back'}">${icon('arrow-right')}رجوع</button><h2>${escape(review.title)}</h2>${sent?'':badge('draft')}</div>
        <div class="qa-meta">${escape(teamName(review.team_id))} · <time class="qa-date" dir="ltr" datetime="${escape(review.created_at)}">${date(review.created_at)}</time></div>
        <form data-editor><div class="qa-editor-head"><label for="qa-title">عنوان المراجعة</label><input id="qa-title" name="title" maxlength="160" value="${escape(title ?? review.title)}" required></div>
        ${draft.map(draftRow).join('')}<div class="qa-actions">
        <button type="button" data-action="add">${icon('plus')}إضافة ملاحظة</button>
        ${sent?`<button type="submit" class="qa-primary" data-save="edit_review">${icon('save')}حفظ التعديلات</button>
        <button type="button" data-action="cancel-edit">إلغاء</button>`:`<button type="submit" data-save="save">${icon('save')}حفظ المسودة</button>
        <button type="submit" class="qa-primary" data-save="publish">${icon('send')}إرسال للمشرف</button>
        <button type="button" data-action="delete" title="حذف المسودة">${icon('trash-2')}حذف المسودة</button>`}</div></form>`);
    }
    function detail() {
      const counts={all:review.items.length,open:0,resolved:0,closed:0};
      review.items.forEach(item=>{counts[item.status]++;});
      const completion=counts.all?Math.round(counts.closed/counts.all*100):0;
      const tabs=[['all','الكل'],['open','بانتظار الرد'],['resolved','بانتظار الاعتماد'],['closed','مغلقة']];
      const groups=new Map();
      review.items.filter(item=>findingFilter==='all' || item.status===findingFilter).forEach(item=>{
        if(!groups.has(item.client_name))groups.set(item.client_name,[]);
        groups.get(item.client_name).push(item);
      });
      const reviewMenu=`${writer()?`<button data-action="edit-review">${icon('pencil')}تعديل المراجعة</button>`:''}
        <button data-action="export">${icon('file-spreadsheet')}تصدير Excel</button>
        ${writer()?`<button data-action="contacts" data-team="${escape(review.team_id)}">${icon('phone')}رقم المشرف</button>
        <div class="qa-menu-divider"></div><button class="qa-danger" data-action="delete-review" data-id="${review.id}">${icon('trash-2')}حذف المراجعة</button>`:''}`;
      frame(`<div class="qa-detail">
        <div class="qa-review-nav"><button class="qa-back" data-action="back">${icon('arrow-right')}رجوع</button><span>مراجعات الجودة</span></div>
        <header class="qa-review-header"><div class="qa-review-identity"><h2>${escape(review.title)}</h2>
          <div class="qa-review-meta"><span>${icon('users')}${escape(teamName(review.team_id))}</span><span>${icon('calendar-days')}<time class="qa-date" dir="ltr" datetime="${escape(review.created_at)}">${date(review.created_at)}</time></span>${readStatus(review)}</div></div>
          <div class="qa-review-tools${writer()?'':' qa-reader-tools'}">${writer()?`<button class="qa-primary" data-action="append-finding">${icon('plus')}إضافة ملاحظة</button>${whatsapp()}`:''}
          <button class="qa-icon" data-action="reload" title="تحديث" aria-label="تحديث">${icon('refresh-cw')}</button>${actionMenu('خيارات المراجعة',reviewMenu)}</div>
        </header>
        <div class="qa-review-overview"><div class="qa-review-tabs" role="tablist" aria-label="حالات الملاحظات">
          ${tabs.map(([value,label])=>`<button role="tab" id="qa-tab-${value}" aria-controls="qa-review-findings" aria-selected="${findingFilter===value}" tabindex="${findingFilter===value?'0':'-1'}" data-action="filter-findings" data-status="${value}">${label}<span>${counts[value]}</span></button>`).join('')}</div>
          <div class="qa-review-progress"><div><span>اكتمال المراجعة</span><strong>${completion}%</strong></div><progress aria-label="اكتمال المراجعة" value="${counts.closed}" max="${counts.all||1}"></progress></div></div>
        <div id="qa-review-findings" role="tabpanel" aria-labelledby="qa-tab-${findingFilter}" tabindex="0">
        ${Array.from(groups,([client,items])=>`<section class="qa-client-section"><div class="qa-client-title"><h3>${icon('building-2')}<span>${escape(client)}</span></h3><span>${findingsCount(items.length)}</span></div>
        ${items.map(item=>{
          const statusName={open:'بانتظار الرد',resolved:'بانتظار الاعتماد',closed:'مغلقة'}[item.status];
          const statusIcon={open:'clock-3',resolved:'circle-check',closed:'check-check'}[item.status];
          const number=String(review.items.indexOf(item)+1).padStart(2,'0');
          const menu=writer()?actionMenu('خيارات الملاحظة',`${item.status==='closed'?`<button data-action="reopen" data-id="${item.id}">${icon('rotate-ccw')}إعادة فتح</button>`:''}
            <button data-action="edit-finding" data-id="${item.id}">${icon('pencil')}تعديل الملاحظة</button><div class="qa-menu-divider"></div>
            <button class="qa-danger" data-action="delete-finding" data-id="${item.id}">${icon('trash-2')}حذف الملاحظة</button>`):'';
          return `<article class="qa-finding" data-finding-id="${item.id}" data-status="${item.status}"><div class="qa-finding-head"><div class="qa-finding-context"><span class="qa-finding-number" aria-label="الملاحظة ${number}">${number}</span><span class="qa-category">${escape(item.category)}</span></div>
          <div class="qa-finding-state"><span class="qa-badge" data-status="${item.status}">${icon(statusIcon)}${statusName}</span>${menu}</div></div>
          <h3>${escape(item.observation)}</h3>${item.details?`<p class="qa-description">${escape(item.details)}</p>`:''}
          ${item.reply?`<div class="qa-response" data-previous="${item.status==='open'}"><div class="qa-response-label">${icon('message-square-text')}<span>${item.status==='open'?'رد المشرف السابق':'رد المشرف'}</span></div><p>${escape(item.reply)}</p></div>`:''}
          ${canReply() && item.status!=='closed'?`<details class="qa-reply-editor"${item.status==='open' || !item.reply?' open':''}><summary>${icon(item.reply && item.status!=='open'?'pencil':'message-square-plus')}${item.reply && item.status!=='open'?'تعديل الرد':'رد المعالجة'}${icon('chevron-down')}</summary>
          <form data-reply="${item.id}" class="qa-reply"><label class="qa-visually-hidden" for="qa-reply-${item.id}">رد المعالجة</label>
          <textarea id="qa-reply-${item.id}" name="reply" placeholder="اكتب ما تم لمعالجة الملاحظة..." required maxlength="4000">${escape(item.status==='open'?'':item.reply)}</textarea><div class="qa-actions"><button class="qa-approve" type="submit">${icon('check')}تمت المعالجة</button></div></form></details>`:''}
          ${writer() && item.status==='resolved'?`<footer class="qa-finding-footer"><button class="qa-approve" data-action="close" data-id="${item.id}">${icon('check-check')}اعتماد وإغلاق</button><button class="qa-return" data-action="reopen" data-id="${item.id}">${icon('undo-2')}إرجاع للمشرف</button></footer>`:''}
          ${writer() && item.status==='open'?`<div class="qa-awaiting">${icon('clock-3')}بانتظار رد المشرف</div>`:''}
          </article>`;
        }).join('')}</section>`).join('') || `<div class="qa-empty qa-review-empty">${icon(counts.all?'list-filter':'clipboard-check')}<h3>${counts.all?'لا توجد ملاحظات في هذا التصنيف':'لا توجد ملاحظات في هذه المراجعة'}</h3></div>`}
        </div></div>`);
    }
    async function open(id) {
      if(review?.id!==id)findingFilter='all';
      review=await call('get',{review_id:id});
      if(disposed)return;
      if(['supervisor','quality_link'].includes(credentials().p_role) && review.status==='sent'){
        await call('mark_seen',{review_id:id,revision:review.notification_revision});
        review.seen_revision=review.notification_revision;
        global.dispatchEvent(new CustomEvent('quality:seen'));
      }
      dirty=false;
      if(review.status==='draft'){draft=review.items;editor();}else{detail();}
    }
    function exportExcel() {
      if(!review) { error('اختر مراجعة للتصدير'); return; }
      const sheet=global.XLSX.utils.json_to_sheet(exportRows(review,teamName(review.team_id)));
      sheet['!cols']=[{wch:28},{wch:22},{wch:16},{wch:26},{wch:24},{wch:40},{wch:75},{wch:65},{wch:20}];
      sheet['!autofilter']={ref:sheet['!ref'] || 'A1:I1'};
      const book=global.XLSX.utils.book_new();
      book.Workbook={Views:[{RTL:true}]};
      global.XLSX.utils.book_append_sheet(book,sheet,'مراجعة الجودة');
      global.XLSX.writeFile(book,`مراجعة_الجودة_${review.id.slice(0,8)}.xlsx`);
    }
    root.addEventListener('input',e=>{if(e.target.closest('[data-editor],[data-reply]'))dirty=true;});
    root.addEventListener('change',e=>{
      if(e.target.id==='qa-contact-team'){
        root.querySelector('#qa-contact-phone').value=delivery.contacts.find(c=>c.team_id===e.target.value)?.phone || '';
        root.querySelector('[data-contact-message]').textContent='';
      }else if(e.target.dataset.filter){
        if(e.target.dataset.filter==='team')teamFilter=e.target.value;else statusFilter=e.target.value;
        list();
      }else if(e.target.name==='category'){
        const title=root.querySelector('#qa-title').value;
        collect();
        draft[Number(e.target.closest('[data-draft-row]').dataset.draftRow)].observation='';
        dirty=true;editor(title);
      }
    });
    root.addEventListener('click',e=>{
      const trigger=e.target.closest('.qa-menu > summary');
      if(trigger)closeMenus(trigger.parentElement);
      const button=e.target.closest('button[data-action]');
      if(!button || busy)return;
      const action=button.dataset.action;
      const menuSummary=button.closest('.qa-menu')?.querySelector('summary');
      closeMenus();
      menuSummary?.focus({preventScroll:true});
      if(action==='back'){
        if(dirty && !global.confirm('يوجد تعديل غير محفوظ. هل تريد الرجوع؟'))return;
        dirty=false;work(async()=>{await fetchList();list();});
      }else if(action==='new'){createForm();}
      else if(action==='filter-findings'){
        if(dirty && !global.confirm('يوجد رد غير محفوظ. هل تريد تغيير التصنيف؟'))return;
        findingFilter=button.dataset.status;dirty=false;detail();
        root.querySelector('[role=tab][aria-selected=true]')?.focus({preventScroll:true});
      }
      else if(action==='contacts'){contacts(button.dataset.team);}
      else if(action==='contacts-back'){if(review)detail();else list();}
      else if(action==='edit-review' || action==='edit-finding' || action==='append-finding'){
        findingFilter='all';
        draft=review.items.map(item=>({...item}));
        if(action==='append-finding')draft.push({client_id:draft.at(-1)?.client_id || '',category:'',observation:'',details:''});
        dirty=action==='append-finding';editor();
        if(action==='edit-finding')root.querySelector(`[data-finding-id="${button.dataset.id}"] select`)?.focus();
        if(action==='append-finding')Array.from(root.querySelectorAll('[data-draft-row]')).at(-1)?.querySelector('select')?.focus();
      }else if(action==='cancel-edit'){
        if(dirty && !global.confirm('إلغاء التعديلات غير المحفوظة؟'))return;
        dirty=false;detail();
      }
      else if(action==='add' || action==='remove'){
        if(action==='remove' && !global.confirm(review.status==='sent'?'عند حفظ التعديلات سيتم حذف هذه الملاحظة ورد المشرف عليها. هل تريد المتابعة؟':'هل تريد حذف هذه الملاحظة من المسودة؟'))return;
        const title=root.querySelector('#qa-title').value;collect();
        if(action==='add')draft.push({client_id:draft.at(-1)?.client_id || '',category:'',observation:'',details:''});
        else draft.splice(Number(button.dataset.index),1);
        dirty=true;editor(title);
      }else if(action==='export'){exportExcel();}
      else if(action==='refresh'){work(async()=>{await fetchList();list();});}
      else if(action==='open' || action==='reload'){work(()=>open(button.dataset.id || review.id));}
      else if(action==='delete'){
        if(global.confirm('حذف هذه المسودة؟'))work(async()=>{await call('delete',{review_id:review.id,updated_at:review.updated_at});dirty=false;await fetchList();list();});
      }else if(action==='delete-review'){
        const target=review?.id===button.dataset.id?review:data.reviews.find(r=>r.id===button.dataset.id);
        if(!global.confirm(`هل تريد حذف المراجعة «${target.title}» نهائيًا؟\nسيتم حذف جميع الملاحظات وردود المشرف داخلها، ولن يمكن التراجع عن الحذف.`))return;
        work(async()=>{await call('delete_review',{review_id:target.id,updated_at:target.updated_at});dirty=false;await fetchList();list();});
      }else if(action==='delete-finding'){
        const item=review.items.find(i=>i.id===button.dataset.id);
        if(!global.confirm(`هل تريد حذف الملاحظة «${item.observation}» للعميل «${item.client_name}» نهائيًا؟\nسيتم حذف رد المشرف عليها أيضًا، ولن يمكن التراجع عن الحذف.`))return;
        work(async()=>{await call('delete_finding',{review_id:review.id,finding_id:item.id,updated_at:item.updated_at});await open(review.id);});
      }else if(action==='close' || action==='reopen'){
        const item=review.items.find(i=>i.id===button.dataset.id);
        work(async()=>{await call(action,{review_id:review.id,finding_id:item.id,updated_at:item.updated_at});await open(review.id);});
      }
    });
    root.addEventListener('submit',e=>{
      e.preventDefault();
      if(busy)return;
      const form=e.target;
      if(form.matches('[data-contact]')){
        work(async()=>{
          await call('save_contact',{team_id:form.elements.team.value,phone:form.elements.phone.value});
          delivery=await call('delivery');
          form.querySelector('[data-contact-message]').textContent='تم حفظ الرقم';
        });
      }else if(form.matches('[data-create]')){
        work(async()=>{const result=await call('create',{team_id:form.elements.team.value,title:form.elements.title.value});await open(result.id);});
      }else if(form.matches('[data-editor]')){
        collect();const title=form.elements.title.value;
        const action=e.submitter?.dataset.save || 'save';
        if(action==='publish' && !draft.length){error('أضف ملاحظة قبل الإرسال');return;}
        work(async()=>{await call(action,{review_id:review.id,updated_at:review.updated_at,title,items:draft});await open(review.id);});
      }else if(form.matches('[data-reply]')){
        const item=review.items.find(i=>i.id===form.dataset.reply);
        work(async()=>{await call('respond',{review_id:review.id,finding_id:item.id,updated_at:item.updated_at,reply:form.elements.reply.value});await open(review.id);});
      }
    });
    const beforeUnload=e=>{if(dirty){e.preventDefault();e.returnValue='';}};
    global.addEventListener('beforeunload',beforeUnload);
    frame('<div class="qa-empty">جاري تحميل المراجعات...</div>');
    const api={
      async refresh(){if(dirty)return;await work(async()=>{await fetchList();if(initialReviewId){const id=initialReviewId;initialReviewId=null;await open(id);}else if(review)await open(review.id);else list();});},
      async openReview(id){await currentWork;if(dirty && !global.confirm('يوجد تعديل غير محفوظ. هل تريد فتح المراجعة؟'))return;findingFilter='all';await work(async()=>{await fetchList();await open(id);});},
      exportExcel,
      destroy(){disposed=true;dirty=false;global.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('click',outsideMenus);root.replaceChildren();},
      hasUnsavedChanges:()=>dirty
    };
    api.ready=api.refresh();
    return api;
  }
  global.QualityReviews={mount,catalog,exportRows,supervisorUrl};
})(window);
