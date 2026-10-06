(function () {
  'use strict';
  const status = document.getElementById('status');
  const c = window.TQT_CONFIG || {};
  const id = new URLSearchParams(location.search).get('extensionId') || c.extensionId;
  if (!/^[a-p]{32}$/.test(id || '')) { status.textContent = 'Hãy mở trang này bằng nút Xác minh trong extension.'; return; }
  if (!c.turnstileSiteKey) { status.textContent = 'ADMIN cần cấu hình Turnstile site key và bật CAPTCHA trong Supabase.'; return; }
  if (!window.chrome?.runtime?.sendMessage) { status.textContent = 'Hãy dùng Chrome hoặc trình duyệt hỗ trợ extension.'; return; }
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.onload = () => window.turnstile.render('#captcha', {
    sitekey: c.turnstileSiteKey,
    callback: token => {
      status.textContent = 'Đang đăng ký thiết bị…';
      chrome.runtime.sendMessage(id, { action: 'TQT_AUTH_CAPTCHA', captchaToken: token }, response => {
        const message = chrome.runtime.lastError?.message;
        if (message || !response?.ok) { status.textContent = response?.message || 'Không liên hệ được extension. Kiểm tra extension đã bật.'; return; }
        status.textContent = response.data?.message || 'Đã xác minh. Quay lại extension để kiểm tra KEY.';
      });
    },
    'error-callback': () => { status.textContent = 'Xác minh gặp lỗi. Tải lại trang để thử lại.'; },
    'expired-callback': () => { status.textContent = 'Xác minh đã hết hạn. Thử lại trên trang này.'; }
  });
  script.onerror = () => { status.textContent = 'Không tải được phần xác minh. Kiểm tra kết nối mạng.'; };
  document.head.append(script);
}());
