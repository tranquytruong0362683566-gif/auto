(function () {
  'use strict';
  const gate = document.getElementById('licenseGate');
  const dashboard = document.getElementById('dashboardApp');
  const keyInput = document.getElementById('tqtMachineKeyInput');
  const status = document.getElementById('tqtLicenseStatus');
  const copyButton = document.getElementById('copyTqtMachineKeyBtn');
  const retryButton = document.getElementById('retryTqtLicenseBtn');
  const keyLabel = document.getElementById('tqtWebKeyValue');
  const remainingLabel = document.getElementById('tqtWebKeyRemaining');
  const verificationLabel = document.getElementById('tqtWebVerificationStatus');
  const client = window.TQTWebKey.createClient();
  let pending = false;
  let current = null, clock = null, captchaWidget = null, captchaLoading = null;
  let checkedTick = -Infinity;
  const serverNow = () => clock ? clock.time + performance.now() - clock.tick : Date.now();

  function remainingText(data) {
    if (!data?.synced) return data?.message || 'Đang xác minh KEY...';
    if (['blocked', 'archived', 'disabled', 'deleted'].includes(data.keyStatus)) return data.message;
    if (data.keyStatus === 'pending') return 'Chờ ADMIN duyệt';
    const remaining = data.expiresAt ? Date.parse(data.expiresAt) - serverNow() : Infinity;
    if (remaining <= 0 || data.keyStatus === 'expired') return 'Hết hạn · Chờ ADMIN duyệt';
    const prefix = data.trial === true ? 'Dùng thử 12 giờ · ' : '';
    if (!Number.isFinite(remaining)) return prefix + 'Không thời hạn';
    const days = remaining / 86400000;
    return prefix + 'Còn ' + (days < 0.01 ? '< 0,01' : days.toLocaleString('vi-VN', {minimumFractionDigits: 2, maximumFractionDigits: 2})) + ' ngày';
  }
  function paint() {
    if (!current) return;
    if (keyInput) keyInput.value = current.machineKey || 'Chờ KEY từ extension';
    if (keyLabel) keyLabel.textContent = current.machineKey || 'Chờ KEY từ extension';
    if (copyButton) copyButton.disabled = !current.machineKey;
    const expired = current.expiresAt && Date.parse(current.expiresAt) <= serverNow();
    const authorized = current.synced === true && current.authorized === true && !expired
      && window.tqtWebTransport?.getStatus()?.connected === true && performance.now() - checkedTick < 90000;
    const wasAuthorized = document.documentElement.dataset.tqtLicenseAuthorized === 'true';
    document.documentElement.classList.toggle('license-pending', !authorized);
    document.documentElement.classList.toggle('license-authorized', authorized);
    document.documentElement.dataset.tqtLicenseAuthorized = String(authorized);
    gate?.setAttribute('aria-hidden', String(authorized));
    dashboard?.toggleAttribute('inert', !authorized);
    dashboard?.setAttribute('aria-hidden', String(!authorized));
    if (remainingLabel) {
      remainingLabel.textContent = remainingText(current);
      remainingLabel.dataset.state = authorized ? current.trial ? 'trial' : 'active' : 'waiting';
      remainingLabel.title = current.expiresAt ? 'Hết hạn: ' + new Date(current.expiresAt).toLocaleString('vi-VN') : '';
    }
    if (status) {
      status.textContent = expired && current.authorized ? 'KEY đã hết hạn. Chờ ADMIN duyệt hoặc gia hạn.' : current.message;
      status.dataset.state = authorized ? 'ok' : current.synced ? 'waiting' : 'error';
    }
    retryButton.textContent = current.code === 'TQT_CAPTCHA_REQUIRED' ? 'Xác minh kết nối'
      : current.code === 'TQT_AUTH_RESET_REQUIRED' ? 'Khôi phục kết nối' : 'Kiểm tra lại';
    if (authorized && !wasAuthorized) window.dispatchEvent(new CustomEvent('tqt:license-authorized'));
    if (!authorized && wasAuthorized) window.dispatchEvent(new CustomEvent('tqt:license-revoked', {detail: {...current, authorized: false}}));
  }
  function applyLicense(data) {
    current = data; checkedTick = performance.now();
    if (data.synced && Number.isFinite(Date.parse(data.serverTime))) clock = {time: Date.parse(data.serverTime), tick: performance.now()};
    paint();
  }
  function verificationStatus(message, state = '') {
    if (verificationLabel) {verificationLabel.textContent = message; verificationLabel.dataset.state = state;}
  }
  async function checkLicense(options = {}) {
    if (pending) return;
    pending = true; retryButton.disabled = true;
    try {applyLicense(await client.sync(options));}
    finally {pending = false; retryButton.disabled = false;}
    verificationStatus(current?.synced ? 'Extension đã gửi KEY và bằng chứng xác minh đến ADMIN' : 'Chưa xác minh được KEY với extension', current?.synced ? 'ok' : 'error');
  }
  async function copyMachineKey(button = copyButton) {
    const value = String(keyInput?.value || '').trim();
    if (!/^TQT-[A-F0-9]{27}$/.test(value)) return;
    try {await navigator.clipboard.writeText(value);}
    catch {keyInput.focus(); keyInput.select(); document.execCommand('copy');}
    const original = button.textContent; button.textContent = 'Đã Copy!';
    window.setTimeout(() => {button.textContent = original;}, 1400);
  }
  async function showCaptcha() {
    const sitekey = window.TQT_CONFIG?.turnstileSiteKey;
    if (!sitekey) {status.textContent = 'ADMIN cần cấu hình Turnstile site key trong config.js.'; return;}
    const container = document.getElementById('tqtLicenseCaptcha'); container.hidden = false;
    try {
      if (!window.turnstile && !captchaLoading) captchaLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.onload = resolve; script.onerror = () => {captchaLoading = null; reject(Error('Chưa tải được xác minh kết nối.'));};
        document.head.append(script);
      });
      if (captchaLoading) await captchaLoading;
      if (captchaWidget !== null) {window.turnstile.reset(captchaWidget); return;}
      captchaWidget = window.turnstile.render(container, {sitekey,
        callback: captchaToken => checkLicense({captchaToken}),
        'error-callback': () => {status.textContent = 'Xác minh gặp lỗi. Bấm Xác minh kết nối để thử lại.';}
      });
    } catch (error) {status.textContent = error.message;}
  }
  copyButton?.addEventListener('click', () => copyMachineKey());
  document.getElementById('copyTqtSidebarKeyBtn')?.addEventListener('click', event => copyMachineKey(event.currentTarget));
  retryButton?.addEventListener('click', () => {
    return current?.code === 'TQT_CAPTCHA_REQUIRED' ? showCaptcha()
      : checkLicense({reconnect: current?.code === 'TQT_AUTH_RESET_REQUIRED'});
  });
  window.addEventListener('tqt:bridge-status', event => {
    if (event.detail?.connected) checkLicense();
    else if (current) applyLicense({...current, synced: false, authorized: false,
      code: 'TQT_DEVICE_EXTENSION_REQUIRED', message: 'Extension đã ngắt kết nối. Kết nối lại để xác minh KEY.'});
  });
  document.addEventListener('visibilitychange', () => {if (!document.hidden) checkLicense();});
  window.addEventListener('pageshow', event => {if (event.persisted) checkLicense();});
  window.setInterval(() => {if (!document.hidden) checkLicense();}, 20000);
  window.setInterval(paint, 1000);
  window.tqtWebLicense = Object.freeze({getStatus: () => current ? {...current,
    authorized: current.synced === true && current.authorized === true
      && window.tqtWebTransport?.getStatus()?.connected === true && performance.now() - checkedTick < 90000
      && (!current.expiresAt || Date.parse(current.expiresAt) > serverNow())} : null, check: checkLicense});
  checkLicense();
}());
