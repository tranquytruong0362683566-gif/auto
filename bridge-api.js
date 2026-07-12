(function () {
  'use strict';

  const S = window.fbBridgeShared;

  function bridgeAvailable() {
    return !!(window.chrome && chrome.runtime && (chrome.runtime.connect || chrome.runtime.sendMessage));
  }

  function getBridgeTimeoutMs(action) {
    const name = String(action || '');
    if (/SCAN_GROUP|SCAN_LINK/i.test(name)) return 15 * 60 * 1000;
    if (/SHOPEE|CUSTOM_LINK|AFFILIATE/i.test(name)) return 3 * 60 * 1000;
    if (/COMMENT/i.test(name)) return 4 * 60 * 1000;
    if (/READ/i.test(name)) return 3 * 60 * 1000;
    return 60 * 1000;
  }

  const NON_FATAL_BRIDGE_CODES = new Set([
    'IGNORED_FACEBOOK_STATE',
    'COOKIE_LOGIN_SKIPPED',
    'COMMENT_EMPTY',
    'COMMENT_BOX_NOT_FOUND',
    'SEND_BUTTON_NOT_FOUND',
    'COMMENT_INSERT_FAILED',
    'COMMENT_POSTER_ERROR',
    'COMMENT_TAB_ERROR',
    'COMMENT_SEND_REJECTED',
    'FB_TAB_ERROR',
    'FB_LINK_MISSING',
    'FB_LINK_INVALID',
    'FB_GROUP_ID_MISSING',
    'TAB_ID_MISSING',
    'MESSENGER_BOX_DETECTED',
    'TAB_CLOSE_ERROR'
  ]);


  const REMOVED_FACEBOOK_CODES = new Set([
    ['FB', 'LOGIN', 'REQUIRED'].join('_'),
    ['LOGIN', 'PAGE', 'DETECTED'].join('_'),
    ['COOKIE', 'INVALID'].join('_'),
    ['COOKIE', 'MISSING', 'C', 'USER'].join('_'),
    ['COOKIE', 'PARSE', 'FAILED'].join('_'),
    ['NO', 'COOKIE', 'SELECTED'].join('_'),
    ['ACTION', 'BLOCKED'].join('_'),
    ['TEMPORARY', 'BLOCKED'].join('_'),
    ['COMMENT', 'RESTRICTED'].join('_')
  ]);

  function isRemovedFacebookCondition(response, code = '') {
    const normalizedCode = String(code || response?.code || response?.errorCode || '').trim().toUpperCase();
    if (REMOVED_FACEBOOK_CODES.has(normalizedCode)) return true;
    const message = String(response?.error || response?.message || '').toLowerCase();
    return /c_user|cookie không|cookie invalid|cookie|login|đăng nhập|session|auth|checkpoint|captcha|xác minh|security|temporarily blocked|tạm thời bị chặn|tam thoi bi chan|action blocked|hành động này bị chặn|hanh dong nay bi chan|going too fast|quá nhanh|qua nhanh|try again later|thử lại sau|thu lai sau|can't comment|cannot comment|không thể bình luận|khong the binh luan|hạn chế bình luận|han che binh luan|comment.*restricted/i.test(message);
  }

  function inferBridgeErrorCode(response) {
    const raw = String(response?.code || response?.errorCode || response?.name || '').trim();
    if (raw) return raw;
    const message = String(response?.error || response?.message || '').toLowerCase();
    if (/spam|có vẻ là spam|co ve la spam|looks like spam|appears to be spam/i.test(message)) return 'SPAM_WARNING';
    if (isRemovedFacebookCondition(response)) return 'IGNORED_FACEBOOK_STATE';
    if (/ô viết bình luận|comment box|không tìm thấy.*bình luận|khong tim thay.*binh luan/i.test(message)) return 'COMMENT_BOX_NOT_FOUND';
    if (/chèn được|chen duoc|insert/i.test(message)) return 'COMMENT_INSERT_FAILED';
    if (/nút.*gửi|button|gửi|send|post/i.test(message)) return 'SEND_BUTTON_NOT_FOUND';
    if (/tab|scripting|cannot access|chrome/i.test(message)) return 'FB_TAB_ERROR';
    if (/rakko|description|nội dung bài viết|read/i.test(message)) return 'READ_POST_ERROR';
    if (/api|chatgpt|timeout|quá lâu/i.test(message)) return 'AI_OR_TIMEOUT_ERROR';
    return 'BRIDGE_ERROR';
  }

  function normalizeBridgeResponse(response) {
    if (!response) {
      const error = new Error('Extension trả về rỗng.');
      error.code = 'EMPTY_BRIDGE_RESPONSE';
      throw error;
    }
    if (response.ok === false || response.error) {
      const code = String(inferBridgeErrorCode(response) || '').toUpperCase();
      if (NON_FATAL_BRIDGE_CODES.has(code) || isRemovedFacebookCondition(response, code)) {
        const data = response?.data && typeof response.data === 'object' ? response.data : {};
        return {
          ...response,
          ...data,
          data: { ...data, skipped: true, nonFatal: true, code },
          ok: true,
          skipped: true,
          nonFatal: true,
          code,
          error: ''
        };
      }
      const error = new Error(response.error || response.message || 'Extension báo lỗi.');
      error.code = code;
      error.response = response;
      throw error;
    }
    return response;
  }

  function sendRawBridgeByPort(extensionId, message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let port;
      let done = false;
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const cleanup = () => {
        done = true;
        clearTimeout(timer);
        try { port?.disconnect(); } catch {}
      };

      const timer = setTimeout(() => {
        if (done) return;
        cleanup();
        reject(new Error('Extension xử lý quá lâu hoặc chưa phản hồi.'));
      }, timeoutMs);

      try {
        port = chrome.runtime.connect(extensionId, { name: 'fb-auto-commenter-bridge' });
        port.onMessage.addListener(response => {
          if (!response || response.requestId !== requestId) return;
          cleanup();
          try { resolve(normalizeBridgeResponse(response)); } catch (error) { reject(error); }
        });
        port.onDisconnect.addListener(() => {
          if (done) return;
          cleanup();
          const err = chrome.runtime.lastError;
          reject(new Error(err?.message || 'Extension port đã đóng trước khi có phản hồi.'));
        });
        port.postMessage({ ...message, requestId });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  function sendRawBridgeByMessage(extensionId, message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Extension xử lý quá lâu hoặc chưa phản hồi.'));
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(extensionId, message, response => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const lastError = chrome.runtime.lastError;
          if (lastError) return reject(new Error(lastError.message || 'Extension không phản hồi.'));
          try { resolve(normalizeBridgeResponse(response)); } catch (error) { reject(error); }
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      }
    });
  }

  function sendRawBridge(action, payload = {}) {
    return new Promise(async (resolve, reject) => {
      const extensionId = S.getExtensionId();
      if (!extensionId) return reject(new Error('Chưa nhập Extension ID.'));
      if (!bridgeAvailable()) return reject(new Error('Không tìm thấy chrome.runtime. Hãy mở bằng Chrome và cài extension bridge.'));

      const message = {
        action,
        type: action,
        cmd: action,
        source: 'github-web',
        payload,
        ...payload
      };
      const timeoutMs = getBridgeTimeoutMs(action);

      try {
        if (chrome.runtime.connect) {
          return resolve(await sendRawBridgeByPort(extensionId, message, timeoutMs));
        }
        return resolve(await sendRawBridgeByMessage(extensionId, message, timeoutMs));
      } catch (portError) {
        if (!chrome.runtime.sendMessage) return reject(portError);
        try {
          return resolve(await sendRawBridgeByMessage(extensionId, message, timeoutMs));
        } catch (messageError) {
          reject(messageError || portError);
        }
      }
    });
  }

  async function sendBridge(actions, payload = {}) {
    let lastError = null;
    for (const action of actions) {
      try {
        return await sendRawBridge(action, payload);
      } catch (error) {
        lastError = error;
        if (!/Receiving end does not exist|message port closed|port closed|port đã đóng|response was received|không phản hồi|rỗng|unknown|not found|không hỗ trợ/i.test(String(error.message || error))) break;
      }
    }
    throw lastError || new Error('Không gửi được lệnh sang extension.');
  }

  function bridgeResponseData(response) {
    return response?.payload || response?.data || response?.result || response || {};
  }

  function extractLinksFromResponse(response) {
    const data = bridgeResponseData(response);
    const raw = data?.links || data?.postLinks || data?.urls || data?.items || data;
    if (Array.isArray(raw)) return raw.map(item => typeof item === 'string' ? item : (item.url || item.link || item.href)).filter(Boolean);
    if (typeof raw === 'string') return S.parseLines(raw).filter(line => /^https?:\/\//i.test(line));
    return [];
  }

  function extractArticleFromResponse(response) {
    const data = bridgeResponseData(response);
    return S.text(
      data?.article ||
      data?.content ||
      data?.text ||
      data?.title ||
      data?.postText ||
      data?.message
    );
  }

  window.fbBridgeApi = {
    sendBridge,
    sendRawBridge,
    bridgeResponseData,
    extractLinksFromResponse,
    extractArticleFromResponse
  };
}());
