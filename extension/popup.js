'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;
  const fbDot = document.getElementById('fbDot');
  const fbStatus = document.getElementById('fbStatus');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'WEB_REQUEST',
      requestId: `popup_${Date.now()}`,
      action: 'GET_FB_SESSION',
      payload: {}
    });
    if (!response?.success) throw new Error(response?.message || 'Không đọc được phiên Facebook');
    const data = response.data || {};
    const cUser = (data.cookies || []).find((cookie) => cookie.name === 'c_user')?.value;
    document.getElementById('uid').textContent = cUser || 'Chưa đăng nhập';
    document.getElementById('machineId').textContent = data.machineId || 'Không có';
    fbStatus.textContent = cUser ? 'Đã đăng nhập' : 'Chưa đăng nhập';
    fbDot.className = `dot ${cUser ? 'online' : 'offline'}`;
  } catch (error) {
    fbStatus.textContent = 'Lỗi kết nối';
    fbDot.className = 'dot offline';
    document.getElementById('uid').textContent = error.message;
  }

  document.getElementById('openWeb').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://tranquytruong0362683566-gif.github.io/auto/' });
  });
  document.getElementById('openFacebook').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.facebook.com/' });
  });
});
