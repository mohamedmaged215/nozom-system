(function initTaskCatalog(global) {
  'use strict';

  const catalog = Object.freeze({
    'البنك': Object.freeze([
      'طلب بنك',
      'تسجيل بنك',
      'إرفاق تسجيل بنك',
      'مراجعة تسجيل بنك',
      'ترحيل تسجيل بنك',
      'مطابقة بنك',
      'تفريغ بنك',
      'أرشفة بنك'
    ]),
    'المشتريات': Object.freeze([
      'استلام فواتير مشتريات',
      'تسجيل مشتريات',
      'إرفاق تسجيلات مشتريات',
      'مراجعة تسجيل مشتريات',
      'ترحيل تسجيل مشتريات',
      'تفريغ مشتريات',
      'أرشفة مشتريات'
    ]),
    'المبيعات': Object.freeze([
      'استلام تفاصيل مبيعات',
      'تسجيل مبيعات',
      'إرفاق تسجيلات مبيعات',
      'مراجعة تسجيل مبيعات',
      'ترحيل تسجيل مبيعات',
      'تفريغ مبيعات',
      'أرشفة مبيعات'
    ]),
    'الموردين': Object.freeze([
      'طلب كشف حساب الموردين',
      'تجهيز تحليلي أرصدة الموردين',
      'مراجعة حسابات الموردين',
      'مطابقة مع كشف حساب المورد',
      'تعديلات لازمة لمطابقة حساب المورد'
    ]),
    'العملاء': Object.freeze([
      'تجهيز تحليلي أرصدة العملاء',
      'مراجعة حسابات العملاء',
      'مطابقة مع كشف حساب العميل',
      'تعديلات لازمة لمطابقة حساب العميل'
    ]),
    'التقارير': Object.freeze([
      'مراجعة ميزان / حسابات',
      'تصنيف حركات',
      'تجهيز تقرير',
      'مراجعة تقرير',
      'إرسال تقرير للعميل'
    ]),
    'الإقرارات': Object.freeze([
      'مراجعة الحساب',
      'تصنيف حركات',
      'تجهيز الإقرار',
      'أرشفة الإقرار',
      'مراجعة الإقرار',
      'إرسال الإقرار للعميل',
      'تقديم إقرار',
      'تسجيل قيد التسوية'
    ]),
    'الميزانية': Object.freeze([
      'مراجعة ميزان / حسابات',
      'تصدير ميزان المراجعة',
      'تصنيف الحسابات',
      'تجهيز العينات وكشوف الحساب',
      'أرشفة العينات وكشوف الحساب',
      'مراجعة العينات وكشوف الحساب',
      'تجهيز المستندات الرسمية',
      'أرشفة المستندات الرسمية',
      'إرسال ملف الميزانية للمحاسب القانوني',
      'الرد على متطلبات المحاسب القانوني',
      'اعتماد ميزان المراجعة',
      'إرسال الميزان المعتمد للمحاسب القانوني',
      'تجهيز المصادقات',
      'اعتماد المصادقات',
      'إرسال المصادقات المعتمدة للمحاسب القانوني',
      'تجهيز الخطابات الرسمية',
      'اعتماد الخطابات الرسمية',
      'إرسال الخطابات الرسمية المعتمدة للمحاسب القانوني',
      'استلام مسودة الميزانية من المحاسب القانوني',
      'مراجعة مسودة الميزانية',
      'إرسال مسودة الميزانية بعد المراجعة للعميل للاعتماد',
      'إرسال مسودة الميزانية المعتمدة للمحاسب القانوني',
      'استلام مسودة الميزانية المعتمدة من المحاسب القانوني',
      'إرسال الميزانية المعتمدة من المحاسب القانوني للعميل',
      'أرشفة الميزانية المعتمدة من المحاسب القانوني',
      'إقفال السنة على النظام المحاسبي'
    ])
  });

  const types = Object.freeze(Object.keys(catalog));
  const notesMarker = '\nملاحظات: ';

  function setOptions(select, values, placeholder, selectedValue, allowLegacy) {
    if (!select) return;
    const selected = String(selectedValue || '').trim();
    select.innerHTML = '';

    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);

    values.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });

    if (allowLegacy && selected && !values.includes(selected)) {
      const legacyOption = document.createElement('option');
      legacyOption.value = selected;
      legacyOption.textContent = `${selected} (قديم)`;
      legacyOption.dataset.legacy = 'true';
      select.appendChild(legacyOption);
    }

    select.value = selected;
  }

  function populateTypeSelect(select, selectedValue = '', allowLegacy = true) {
    setOptions(select, types, 'اختر نوع المهمة...', selectedValue, allowLegacy);
  }

  function populateDetailSelect(select, taskType, selectedValue = '', allowLegacy = true) {
    const values = catalog[taskType] || [];
    setOptions(select, values, taskType ? 'اختر المهمة المطلوبة...' : 'اختر نوع المهمة أولاً...', selectedValue, allowLegacy);
    select.disabled = !taskType;
  }

  function splitDescription(taskType, description) {
    const value = String(description || '').trim();
    if (!value) return { detail: '', notes: '' };

    const options = catalog[taskType] || [];
    for (const detail of options) {
      if (value === detail) return { detail, notes: '' };
      const prefix = `${detail}${notesMarker}`;
      if (value.startsWith(prefix)) {
        return { detail, notes: value.slice(prefix.length).trim() };
      }
    }

    return { detail: value, notes: '' };
  }

  function composeDescription(detail, notes) {
    const taskDetail = String(detail || '').trim();
    const taskNotes = String(notes || '').trim();
    if (!taskDetail) return '';
    return taskNotes ? `${taskDetail}${notesMarker}${taskNotes}` : taskDetail;
  }

  function appendNotes(description, notes) {
    const base = String(description || '').trim();
    const extra = String(notes || '').trim();
    if (!extra) return base;
    return base ? `${base}${notesMarker}${extra}` : extra;
  }

  global.TaskCatalog = Object.freeze({
    catalog,
    types,
    populateTypeSelect,
    populateDetailSelect,
    splitDescription,
    composeDescription,
    appendNotes
  });
})(window);
