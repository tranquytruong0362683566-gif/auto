(function () {
  'use strict';
  const transport = window.tqtWebTransport;
  let bridgeConnected = false;
  let bridgeStatusMessage = 'Đang tìm tiện ích...';
  function getBridgeTimeoutMs(action) {
    const name = String(action || '');
    if (/SCAN_GROUP|SCAN_LINK|SCAN_FACEBOOK_POSTS/i.test(name)) return 15 * 60 * 1000;
    if (/SHOPEE|CUSTOM_LINK|AFFILIATE/i.test(name)) return 3 * 60 * 1000;
    if (/COMMENT/i.test(name)) return 4 * 60 * 1000;
    if (/READ/i.test(name)) return 3 * 60 * 1000;
    return 60 * 1000;
  }

  function normalizeBridgeResponse(response) {
    if (!response || typeof response !== 'object') throw new Error('Tiến trình nền trả về rỗng.');

    const success = response.ok !== false && response.success !== false && !response.error;
    if (!success) {
      const error = new Error(response.error || response.message || 'Tiến trình nền báo lỗi.');
      error.code = response.code || 'EXTENSION_ERROR';
      throw error;
    }

    return {
      ...response,
      ok: true,
      success: true,
      code: response.code || 'OK',
      message: response.message || '',
      data: response.data ?? response.payload ?? response.result ?? response
    };
  }

  async function sendRawBridge(action, payload = {}) {
    const cleanAction = String(action || '').trim();
    if (!cleanAction) throw new Error('Thiếu lệnh gửi tới tiện ích.');
    return normalizeBridgeResponse(await transport.request(cleanAction, payload, {timeoutMs: getBridgeTimeoutMs(cleanAction)}));
  }
  async function sendBridge(actions, payload = {}) {
    let lastError = null;
    for (const action of actions) {
      try {
        return await sendRawBridge(action, payload);
      } catch (error) {
        lastError = error;
        if (!/Receiving end does not exist|message port closed|port closed|không phản hồi|rỗng|unknown|not found|không hỗ trợ|BRIDGE_DISCONNECTED/i.test(String(error.message || error))) break;
      }
    }
    throw lastError || new Error('Không gửi được lệnh tới tiến trình nền.');
  }

  function bridgeResponseData(response) {
    return response?.payload || response?.data || response?.result || response || {};
  }

  function extractLinksFromResponse(response) {
    const S = window.fbBridgeShared;
    const data = bridgeResponseData(response);
    const raw = data?.links || data?.postLinks || data?.urls || data?.items || data?.posts || data;
    if (Array.isArray(raw)) return raw.map(item => typeof item === 'string' ? item : (item.url || item.link || item.href)).filter(Boolean);
    if (typeof raw === 'string') return S.parseLines(raw).filter(line => /^https?:\/\//i.test(line));
    return [];
  }

  function extractArticleFromResponse(response) {
    const S = window.fbBridgeShared;
    const data = bridgeResponseData(response);
    return S.text(data?.article || data?.content || data?.text || data?.title || data?.postText || data?.message);
  }

  window.fbBridgeApi = {
    sendBridge, sendRawBridge, bridgeResponseData, extractLinksFromResponse, extractArticleFromResponse,
    bridgeAvailable: () => bridgeConnected,
    getBridgeStatus: () => ({connected: bridgeConnected, message: bridgeStatusMessage})
  };
  transport.subscribe(status => {
    bridgeConnected = status.connected;
    bridgeStatusMessage = status.message;
    window.dispatchEvent(new CustomEvent('autovip:bridge-status', {detail: {connected: bridgeConnected, message: bridgeStatusMessage}}));
  });
}());
