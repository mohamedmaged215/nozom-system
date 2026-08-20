(function () {
  var URL = 'https://gzkjladvhhntmzigyorv.supabase.co/rest/v1/rpc/check_system_status';
  var KEY = 'sb_publishable_0x-wR8lObcOtpswFQHhlbw_ok0YYm-D';

  // إخفاء الصفحة فوراً قبل أي حاجة تظهر
  var s = document.createElement('style');
  s.id = '__gs';
  s.textContent = 'body{visibility:hidden!important;pointer-events:none!important;}';
  (document.head || document.documentElement).appendChild(s);

  var finished = false;
  var timer = setTimeout(function () {
    if (finished) return;
    finished = true;
    lock();
  }, 6000);

  function reveal() {
    clearTimeout(timer);
    var el = document.getElementById('__gs');
    if (el) el.remove();
  }

  function lock() {
    clearTimeout(timer);
    var el = document.getElementById('__gs');
    if (el) el.remove();

    function paint() {
      if (!document.body) { setTimeout(paint, 10); return; }
      document.body.innerHTML = '';
      document.body.style.cssText = [
        'margin:0', 'padding:0', 'background:#0f0d0b',
        'display:flex', 'align-items:center', 'justify-content:center',
        'min-height:100vh', 'direction:rtl',
        'font-family:"IBM Plex Sans Arabic","Tajawal",sans-serif'
      ].join(';');
      document.body.innerHTML =
        '<div style="text-align:center;padding:2rem;">' +
          '<svg width="48" height="48" viewBox="0 0 24 24" fill="none"' +
              ' stroke="#d4703b" stroke-width="1.5"' +
              ' stroke-linecap="round" stroke-linejoin="round"' +
              ' style="margin-bottom:28px;">' +
            '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
            '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
          '</svg>' +
          '<p style="color:#78716c;font-size:13px;margin:0 0 12px;letter-spacing:.4px;">' +
            'نظم وحلول للتقنية المالية' +
          '</p>' +
          '<h1 style="color:#f5f0eb;font-size:22px;font-weight:600;margin:0 0 10px;">' +
            'النظام متوقف' +
          '</h1>' +
          '<p style="color:#78716c;font-size:14px;margin:0;">' +
            'لحين تشغيل السيرفر' +
          '</p>' +
        '</div>';
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', paint);
    } else {
      paint();
    }
  }

  fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': KEY },
    body: '{}'
  })
  .then(function (r) { return r.json(); })
  .then(function (d) {
    if (finished) return;
    finished = true;
    if (d && d.active === true) { reveal(); }
    else { lock(); }
  })
  .catch(function () {
    if (finished) return;
    finished = true;
    lock();
  });
})();
