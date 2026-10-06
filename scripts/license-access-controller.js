(function () {
  'use strict';

  const gate = document.getElementById('licenseGate');
  const dashboard = document.getElementById('dashboardApp');
  const keyInput = document.getElementById('tqtMachineKeyInput');
  const status = document.getElementById('tqtLicenseStatus');
  const copyButton = document.getElementById('copyTqtMachineKeyBtn');
  const retryButton = document.getElementById('retryTqtLicenseBtn');
  let pending = false;

  function setStatus(message, state) {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state || '';
  }

  function applyLicense(data) {
    if (keyInput && data.machineKey) keyInput.value = data.machineKey;
    const wasAuthorized = document.documentElement.dataset.tqtLicenseAuthorized === 'true';
    const authorized = data.synced === true && data.authorized === true;
    document.documentElement.classList.toggle('license-pending', !authorized);
    document.documentElement.classList.toggle('license-authorized', authorized);
    document.documentElement.dataset.tqtLicenseAuthorized = String(authorized);
    gate?.setAttribute('aria-hidden', String(authorized));
    dashboard?.toggleAttribute('inert', !authorized);
    dashboard?.setAttribute('aria-hidden', String(!authorized));
    setStatus(data.message || 'Chưa nhận được trạng thái KEY.', authorized ? 'ok' : data.synced ? 'waiting' : 'error');
    retryButton.textContent = data.code === 'TQT_CAPTCHA_REQUIRED' ? 'Xác minh kết nối'
      : data.code === 'TQT_AUTH_RESET_REQUIRED' ? 'Khôi phục kết nối' : 'Kiểm tra lại';
    if (authorized && !wasAuthorized) window.dispatchEvent(new CustomEvent('tqt:license-authorized'));
    if (!authorized && wasAuthorized) window.dispatchEvent(new CustomEvent('tqt:license-revoked', {detail: data}));
  }

  async function checkLicense(retry = false) {
    if (pending) return;
    pending = true;
    retryButton.disabled = true;
    if (document.documentElement.dataset.tqtLicenseAuthorized !== 'true') {
      setStatus('Đang kiểm tra KEY qua tiện ích...', 'checking');
    }
    try {
      const response = await window.tqtWebTransport.request(
        retry ? 'TQT_RETRY_LICENSE' : 'GET_TQT_LICENSE_STATUS', {forceRefresh: true}
      );
      if (!response?.ok || !response.data) throw new Error(response?.message || 'Chưa kết nối được ADMIN.');
      applyLicense(response.data);
    } catch (error) {
      applyLicense({synced: false, authorized: false, message: `Không kiểm tra được KEY: ${error.message}`});
    } finally {
      pending = false;
      retryButton.disabled = false;
    }
  }

  async function copyMachineKey() {
    const value = String(keyInput?.value || '').trim();
    if (!/^TQT-[A-F0-9]{27}$/.test(value)) return;
    try {await navigator.clipboard.writeText(value);}
    catch {keyInput.focus();keyInput.select();document.execCommand('copy');}
    const originalText = copyButton.textContent;
    copyButton.textContent = 'Đã Copy!';
    window.setTimeout(() => {copyButton.textContent = originalText;}, 1400);
  }

  copyButton?.addEventListener('click', copyMachineKey);
  retryButton?.addEventListener('click', () => checkLicense(true));
  window.addEventListener('tqt:bridge-status', event => {
    if (event.detail?.connected) checkLicense();
    else applyLicense({synced: false, authorized: false, message: event.detail?.message || 'Chưa kết nối tiện ích.'});
  });
  document.addEventListener('visibilitychange', () => {if (!document.hidden) checkLicense();});
  window.setInterval(() => {if (!document.hidden) checkLicense();}, 60000);
  checkLicense();
}());
