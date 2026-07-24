(function () {
  'use strict';

  if (window.GroupPublisherBridge) return;

  const WEB_SOURCE = 'GROUP_PUBLISHER_WEB';
  const EXTENSION_SOURCE = 'GROUP_PUBLISHER_EXTENSION';
  const REQUEST_TYPE = 'GROUP_PUBLISHER_REQUEST';
  const RESPONSE_TYPE = 'GROUP_PUBLISHER_RESPONSE';
  const STATUS_TYPE = 'GROUP_PUBLISHER_STATUS';
  const DISCOVER_TYPE = 'GROUP_PUBLISHER_DISCOVER';
  const TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;
  const pending = new Map();
  const listeners = new Set();

  let connected = false;
  let statusMessage = 'Đang dò extension...';

  function requestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function emitStatus() {
    const detail = { connected, message: statusMessage };
    for (const listener of listeners) {
      try {
        listener(detail);
      } catch (error) {
        console.error('[GroupPublisher][Web] Status listener error:', error);
      }
    }
  }

  function setStatus(nextConnected, message) {
    connected = Boolean(nextConnected);
    statusMessage = String(message || (connected ? 'Extension đã kết nối.' : 'Chưa phát hiện extension.'));
    emitStatus();
  }

  function discover() {
    window.postMessage({
      source: WEB_SOURCE,
      type: DISCOVER_TYPE,
      requestId: requestId()
    }, TARGET_ORIGIN);
  }

  function normalizeResponse(raw) {
    if (!raw || typeof raw !== 'object') {
      const error = new Error('Extension trả về dữ liệu rỗng.');
      error.code = 'EMPTY_EXTENSION_RESPONSE';
      throw error;
    }
    if (raw.success === false) {
      const error = new Error(raw.message || 'Extension báo lỗi.');
      error.code = raw.code || 'EXTENSION_ERROR';
      error.data = raw.data;
      throw error;
    }
    return {
      success: true,
      code: raw.code || 'OK',
      message: raw.message || '',
      data: raw.data ?? null
    };
  }

  function send(action, payload = {}, options = {}) {
    const cleanAction = String(action || '').trim();
    if (!cleanAction) return Promise.reject(new Error('Thiếu action gửi sang extension.'));

    const id = requestId();
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 60000);

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(id);
        const error = new Error(`Extension không phản hồi lệnh ${cleanAction}.`);
        error.code = 'EXTENSION_TIMEOUT';
        reject(error);
      }, timeoutMs);

      pending.set(id, { resolve, reject, timer });
      window.postMessage({
        source: WEB_SOURCE,
        type: REQUEST_TYPE,
        requestId: id,
        action: cleanAction,
        payload: payload && typeof payload === 'object' ? payload : {}
      }, TARGET_ORIGIN);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (TARGET_ORIGIN !== '*' && event.origin !== TARGET_ORIGIN) return;
    const data = event.data;
    if (!data || data.source !== EXTENSION_SOURCE) return;

    if (data.type === STATUS_TYPE) {
      setStatus(data.connected, data.message);
      return;
    }

    if (data.type !== RESPONSE_TYPE) return;
    const id = String(data.requestId || '');
    const entry = pending.get(id);
    if (!entry) return;

    pending.delete(id);
    clearTimeout(entry.timer);
    try {
      entry.resolve(normalizeResponse(data.response));
    } catch (error) {
      entry.reject(error);
    }
  });

  window.GroupPublisherBridge = Object.freeze({
    send,
    discover,
    isConnected: () => connected,
    getStatus: () => ({ connected, message: statusMessage }),
    onStatus(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      listener({ connected, message: statusMessage });
      return () => listeners.delete(listener);
    }
  });

  discover();
  window.setTimeout(discover, 250);
  window.setTimeout(discover, 1000);
}());
