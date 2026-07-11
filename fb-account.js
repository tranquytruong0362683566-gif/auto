(function () {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const els = {};
  let refreshTimer = null;
  let lastUid = '';

  function setActionStatus(message, state = '') {
    if (!els.actionStatus) return;
    els.actionStatus.textContent = message || '';
    els.actionStatus.dataset.state = state;
  }

  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      delete button.dataset.originalText;
    }
  }

  function setDisplay({ state = 'idle', uid = '', message = '', summary = '' } = {}) {
    const uidText = uid || message || 'Chưa phát hiện tài khoản Facebook đang đăng nhập';
    if (els.uid) els.uid.textContent = uidText;
    if (els.cookie) els.cookie.value = summary || message || '';
    if (!els.badge) return;

    els.badge.className = 'fb-account-badge';
    if (state === 'ok') {
      els.badge.classList.add('ok');
      els.badge.textContent = 'Đã đăng nhập';
    } else if (state === 'loading') {
      els.badge.classList.add('loading');
      els.badge.textContent = 'Đang kiểm tra';
    } else if (state === 'error') {
      els.badge.classList.add('error');
      els.badge.textContent = 'Chưa kết nối';
    } else {
      els.badge.textContent = 'Chưa đăng nhập';
    }
  }

  async function refreshFacebookAccount() {
    const extensionId = String(els.extensionId?.value || '').trim();
    if (!extensionId) {
      lastUid = '';
      setDisplay({ state: 'error', message: 'Chưa nhập Extension ID', summary: 'Chưa nhập Extension ID để đọc trạng thái Facebook.' });
      return;
    }

    setDisplay({ state: 'loading', message: 'Đang kiểm tra UID Facebook...', summary: 'Đang đọc trạng thái đăng nhập từ extension hợp nhất...' });
    try {
      const response = await window.fbBridgeApi.sendBridge([
        'GET_FB_ACCOUNT_STATUS',
        'GET_FACEBOOK_ACCOUNT_STATUS',
        'GET_FB_UID'
      ]);
      const data = window.fbBridgeApi.bridgeResponseData(response);
      const uid = String(data?.uid || '').trim();
      const loggedIn = Boolean(data?.loggedIn && /^\d+$/.test(uid));
      lastUid = loggedIn ? uid : '';

      if (loggedIn) {
        const cookieCount = Number(data?.cookieCount || 0);
        const summary = String(data?.cookieSummary || `c_user=${uid}; [${Math.max(0, cookieCount - 1)} cookie xác thực đã ẩn]`);
        setDisplay({ state: 'ok', uid, summary });
      } else {
        setDisplay({
          state: 'idle',
          message: 'Chưa phát hiện tài khoản Facebook đang đăng nhập',
          summary: 'Chưa phát hiện cookie c_user của Facebook.'
        });
      }
    } catch (error) {
      lastUid = '';
      const message = error?.message || String(error);
      setDisplay({ state: 'error', message: 'Không đọc được UID Facebook', summary: `Lỗi kết nối extension: ${message}` });
    }
  }

  async function openFacebookLogin() {
    setBusy(els.openLoginBtn, true, 'Đang mở...');
    setActionStatus('Đang yêu cầu extension mở trang đăng nhập Facebook...', 'loading');
    try {
      await window.fbBridgeApi.sendBridge(['OPEN_FB_LOGIN', 'OPEN_FACEBOOK_LOGIN']);
      setActionStatus('Đã mở trang đăng nhập Facebook. Đăng nhập xong quay lại web và bấm Làm mới.', 'ok');
    } catch (error) {
      setActionStatus(`Không mở được trang đăng nhập: ${error?.message || error}`, 'error');
    } finally {
      setBusy(els.openLoginBtn, false);
    }
  }

  async function logoutFacebookAccount() {
    if (!confirm('Đăng xuất tài khoản Facebook hiện tại trên trình duyệt này?')) return;
    setBusy(els.logoutBtn, true, 'Đang đăng xuất...');
    setActionStatus('Extension đang xóa phiên Facebook và tải lại các tab Facebook...', 'loading');
    try {
      const response = await window.fbBridgeApi.sendBridge([
        'LOGOUT_FB_ACCOUNT',
        'LOGOUT_FACEBOOK_ACCOUNT',
        'CLEAR_FACEBOOK_SESSION'
      ]);
      const data = window.fbBridgeApi.bridgeResponseData(response);
      setActionStatus(data?.message || 'Đã đăng xuất Facebook.', 'ok');
      await refreshFacebookAccount();
    } catch (error) {
      setActionStatus(`Đăng xuất thất bại: ${error?.message || error}`, 'error');
    } finally {
      setBusy(els.logoutBtn, false);
    }
  }

  function scheduleRefresh(delay = 350) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshFacebookAccount, delay);
  }

  async function copyUid() {
    if (!lastUid) {
      scheduleRefresh(0);
      return;
    }
    try {
      await navigator.clipboard.writeText(lastUid);
      const original = els.copyBtn.textContent;
      els.copyBtn.textContent = 'Đã chép';
      setTimeout(() => { els.copyBtn.textContent = original; }, 1200);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = lastUid;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  function init() {
    els.uid = $('#fbCurrentUid');
    els.badge = $('#fbAccountBadge');
    els.cookie = $('#currentFacebookCookie');
    els.refreshBtn = $('#refreshFbAccountBtn');
    els.copyBtn = $('#copyFbUidBtn');
    els.extensionId = $('#bridgeExtensionId');
    els.openLoginBtn = $('#openFbLoginBtn');
    els.logoutBtn = $('#logoutFbAccountBtn');
    els.actionStatus = $('#fbAccountActionStatus');

    els.refreshBtn?.addEventListener('click', refreshFacebookAccount);
    els.copyBtn?.addEventListener('click', copyUid);
    els.openLoginBtn?.addEventListener('click', openFacebookLogin);
    els.logoutBtn?.addEventListener('click', logoutFacebookAccount);
    els.extensionId?.addEventListener('input', () => scheduleRefresh(500));
    els.extensionId?.addEventListener('change', () => scheduleRefresh(100));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleRefresh(100);
    });
    window.addEventListener('focus', () => scheduleRefresh(100));

    scheduleRefresh(650);
    setInterval(() => {
      if (!document.hidden && String(els.extensionId?.value || '').trim()) refreshFacebookAccount();
    }, 15000);
  }

  window.addEventListener('DOMContentLoaded', init);
  window.fbAccountStatus = {
    refresh: refreshFacebookAccount,
    openLogin: openFacebookLogin,
    logout: logoutFacebookAccount
  };
}());
