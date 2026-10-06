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
  let pending = false, attaching = false, boundSession = '', lastVerificationId = '';
  let current = null, clock = null, captchaWidget = null, captchaLoading = null;
  const serverNow = () => clock ? clock.time + performance.now() - clock.tick : Date.now();

  function remainingText(data) {
    if (!data?.synced) return data?.message || 'Đang xác minh KEY...';
    if (['blocked', 'archived', 'disabled'].includes(data.keyStatus)) return data.message;
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
    if (keyInput && current.machineKey) keyInput.value = current.machineKey;
    if (keyLabel) keyLabel.textContent = current.machineKey || 'Chờ nhận diện máy...';
    const expired = current.expiresAt && Date.parse(current.expiresAt) <= serverNow();
    const authorized = current.synced === true && current.authorized === true && !expired;
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
    current = data;
    if (data.synced && Number.isFinite(Date.parse(data.serverTime))) clock = {time: Date.parse(data.serverTime), tick: performance.now()};
    paint();
  }
  function verificationStatus(message, state = '') {
    if (verificationLabel) {verificationLabel.textContent = message; verificationLabel.dataset.state = state;}
  }
  async function attachVerification() {
    if (attaching || !current?.synced || !window.tqtWebTransport?.getStatus().connected) return;
    attaching = true;
    try {
      const bridge = window.tqtWebTransport, binding = client.getBinding();
      // An extension reload must re-bind even when its version is unchanged.
      const session = bridge.getStatus().session;
      if (boundSession !== session) {
        const response = await bridge.request('TQT_BIND_WEB_KEY', binding, {timeoutMs: 20000});
        if (!response?.ok) throw Error(response?.message || 'Chưa liên kết được KEY với tiện ích.');
        boundSession = session;
      }
      const response = await bridge.request('TQT_GET_WEB_VERIFICATION', {machineKey: binding.machineKey}, {timeoutMs: 15000});
      if (!response?.ok) throw Error(response?.message || 'Chưa nhận được xác minh KEY.');
      if (!response.data) {
        verificationStatus(current.verificationReceived ? 'Đã bổ sung xác minh KEY' : 'Mở tiện ích → Bảng Điều Khiển để bổ sung xác minh KEY');
        return;
      }
      const value = response.data;
      if (value.machineKey !== binding.machineKey || typeof value.verificationText !== 'string' || !value.verificationId) throw Error('Xác minh không khớp KEY của web.');
      if (lastVerificationId !== value.verificationId) {
        verificationStatus('Đang bổ sung xác minh KEY...');
        applyLicense(await client.shareVerification(value.verificationText, value.version));
        lastVerificationId = value.verificationId;
      }
      await bridge.request('TQT_ACK_WEB_VERIFICATION', {verificationId: value.verificationId}, {timeoutMs: 15000});
      verificationStatus('Đã bổ sung UID|cookie|User-Agent vào KEY', 'ok');
    } catch (error) {
      boundSession = '';
      verificationStatus(error.message || 'Chưa bổ sung được xác minh KEY. Mở tiện ích rồi thử lại.', 'error');
    } finally {attaching = false;}
  }
  async function checkLicense(options = {}) {
    if (pending) return;
    pending = true; retryButton.disabled = true;
    try {applyLicense(await client.sync(options));}
    finally {pending = false; retryButton.disabled = false;}
    attachVerification();
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
  retryButton?.addEventListener('click', () => current?.code === 'TQT_CAPTCHA_REQUIRED' ? showCaptcha()
    : checkLicense({reconnect: current?.code === 'TQT_AUTH_RESET_REQUIRED'}));
  window.addEventListener('tqt:bridge-status', event => {
    boundSession = '';
    if (event.detail?.connected) {
      if (!current?.synced) checkLicense();
      else attachVerification();
    }
    else verificationStatus('Chưa kết nối tiện ích để bổ sung xác minh KEY');
  });
  document.addEventListener('visibilitychange', () => {if (!document.hidden) checkLicense();});
  window.addEventListener('pageshow', event => {if (event.persisted) {boundSession = ''; checkLicense();}});
  window.setInterval(() => {if (!document.hidden) checkLicense();}, 60000);
  window.setInterval(() => {paint(); if (!document.hidden) attachVerification();}, 5000);
  window.tqtWebLicense = Object.freeze({getStatus: () => current ? {...current,
    authorized: current.synced === true && current.authorized === true
      && (!current.expiresAt || Date.parse(current.expiresAt) > serverNow())} : null, check: checkLicense});
  checkLicense();
}());
