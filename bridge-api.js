(function () {
  'use strict';

  const S = window.fbBridgeShared;

  function bridgeAvailable() {
    return Boolean(window.chrome && chrome.runtime && (chrome.runtime.connect || chrome.runtime.sendMessage));
  }

  function getBridgeTimeoutMs(action) {
    const name = String(action || '');
    if (/SCAN_GROUP|SCAN_LINK/i.test(name)) return 15 * 60 * 1000;
    if (/SHOPEE|CUSTOM_LINK|AFFILIATE/i.test(name)) return 3 * 60 * 1000;
    if (/COMMENT/i.test(name)) return 5 * 60 * 1000;
    if (/READ/i.test(name)) return 3 * 60 * 1000;
    return 60 * 1000;
  }

  function makeError(response, fallback) {
    const error = new Error(response?.error || response?.message || fallback || 'Extension báo lỗi.');
    error.code = response?.errorCode || '';
    error.response = response;
    return error;
  }

  function normalizeBridgeResponse(response) {
    if (!response) throw new Error('Extension trả về rỗng.');
    if (response.ok === false || response.error) throw makeError(response);
    return response;
  }

  function createRequestId() {
    return `${Date.now().toString(36)}-${crypto.randomUUID?.() || Math.random().toString(16).slice(2)}`;
  }

  function sendRawBridgeByPort(extensionId, message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let port = null;
      let done = false;
      const requestId = message.requestId;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { port?.disconnect(); } catch {}
        reject(new Error('Extension xử lý quá lâu hoặc chưa phản hồi.'));
      }, timeoutMs);

      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { port?.disconnect(); } catch {}
      };

      try {
        port = chrome.runtime.connect(extensionId, { name: 'fb-auto-commenter-bridge-v2' });
        port.onMessage.addListener(response => {
          if (!response || response.requestId !== requestId) return;
          cleanup();
          try { resolve(normalizeBridgeResponse(response)); }
          catch (error) { reject(error); }
        });
        port.onDisconnect.addListener(() => {
          if (done) return;
          const lastError = chrome.runtime.lastError;
          cleanup();
          reject(new Error(lastError?.message || 'Extension port đã đóng trước khi có phản hồi.'));
        });
        port.postMessage(message);
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
          try { resolve(normalizeBridgeResponse(response)); }
          catch (error) { reject(error); }
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

  async function sendRawBridge(action, payload = {}) {
    const extensionId = S.getExtensionId();
    const bridgeToken = S.getBridgeToken();
    if (!extensionId) throw new Error('Chưa nhập Extension ID.');
    if (!bridgeToken) throw new Error('Chưa nhập Bridge token.');
    if (!bridgeAvailable()) throw new Error('Không tìm thấy chrome.runtime. Hãy mở web bằng Chrome và cài extension bridge.');

    const requestId = createRequestId();
    const message = {
      action,
      type: action,
      cmd: action,
      source: 'github-web-v2',
      requestId,
      bridgeToken,
      payload: { ...payload, bridgeToken },
      ...payload
    };
    const timeoutMs = getBridgeTimeoutMs(action);

    try {
      if (chrome.runtime.connect) return await sendRawBridgeByPort(extensionId, message, timeoutMs);
      return await sendRawBridgeByMessage(extensionId, message, timeoutMs);
    } catch (portError) {
      if (!chrome.runtime.sendMessage) throw portError;
      // Dùng lại đúng requestId. Extension cache theo requestId nên fallback không chạy trùng tác vụ.
      try { return await sendRawBridgeByMessage(extensionId, message, timeoutMs); }
      catch (messageError) { throw messageError || portError; }
    }
  }

  async function sendBridge(actions, payload = {}) {
    let lastError = null;
    for (const action of actions) {
      try {
        return await sendRawBridge(action, payload);
      } catch (error) {
        lastError = error;
        const retryAlias = /Receiving end does not exist|message port closed|port closed|port đã đóng|không phản hồi|rỗng|unknown|not found|không hỗ trợ|UNSUPPORTED_ACTION/i.test(String(error.message || error));
        if (!retryAlias) break;
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
    return S.text(data?.article || data?.content || data?.text || data?.title || data?.postText || data?.message);
  }

  window.fbBridgeApi = {
    sendBridge,
    sendRawBridge,
    bridgeResponseData,
    extractLinksFromResponse,
    extractArticleFromResponse
  };
}());
