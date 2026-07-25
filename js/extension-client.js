(() => {
  'use strict';

  const WEB_SOURCE = 'TQT_FB_AUTOMATION_WEB';
  const BRIDGE_SOURCE = 'TQT_FB_AUTOMATION_EXTENSION';
  const pending = new Map();
  const eventTarget = new EventTarget();

  function makeRequestId(prefix = 'req') {
    return `${prefix}_${Date.now()}_${crypto.randomUUID()}`;
  }

  function normalizeError(error) {
    if (!error) return 'Lỗi không xác định';
    if (typeof error === 'string') return error;
    return error.message || String(error);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || message.source !== BRIDGE_SOURCE) return;

    if (message.type === 'RESPONSE' && message.requestId) {
      const task = pending.get(message.requestId);
      if (!task) return;
      pending.delete(message.requestId);
      clearTimeout(task.timer);

      if (message.success) {
        task.resolve(message.data ?? null);
      } else {
        const error = new Error(message.message || 'Extension trả về lỗi');
        error.code = message.code || 'EXTENSION_ERROR';
        error.data = message.data;
        task.reject(error);
      }
      return;
    }

    if (message.type === 'EVENT' && message.event) {
      eventTarget.dispatchEvent(new CustomEvent(message.event, { detail: message.data ?? null }));
    }
  });

  async function request(action, payload = {}, timeoutMs = 30_000) {
    const requestId = makeRequestId(action.toLowerCase());
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        const error = new Error(`Extension không phản hồi trong ${Math.ceil(timeoutMs / 1000)} giây`);
        error.code = 'EXTENSION_TIMEOUT';
        reject(error);
      }, timeoutMs);

      pending.set(requestId, { resolve, reject, timer });
      window.postMessage({
        source: WEB_SOURCE,
        type: 'REQUEST',
        requestId,
        action,
        payload
      }, window.location.origin);
    });
  }

  async function ping() {
    return request('PING', { href: window.location.href }, 5_000);
  }

  async function getFacebookSession() {
    return request('GET_FB_SESSION', {}, 12_000);
  }

  async function httpRequest({ url, method = 'GET', headers = {}, body = null, timeoutMs = 180_000 }) {
    const data = await request('HTTP_REQUEST', {
      url,
      method,
      headers,
      body,
      timeoutMs
    }, timeoutMs + 15_000);

    return {
      ok: Boolean(data?.ok),
      status: Number(data?.status || 0),
      statusText: data?.statusText || '',
      headers: data?.headers || {},
      text: async () => data?.text || '',
      json: async () => {
        const text = data?.text || '';
        try {
          return JSON.parse(text.replace(/^for \(;;\);/, ''));
        } catch (error) {
          const parseError = new Error(`Dữ liệu JSON không hợp lệ: ${normalizeError(error)}`);
          parseError.responseText = text;
          throw parseError;
        }
      }
    };
  }

  async function startGroupScan(payload) {
    return request('START_GROUP_SCAN', payload, Math.max(120_000, (payload.maxScrolls || 35) * (payload.delayMs || 1800) + 90_000));
  }

  async function stopGroupScan() {
    return request('STOP_GROUP_SCAN', {}, 10_000);
  }

  function on(eventName, listener) {
    const wrapped = (event) => listener(event.detail);
    eventTarget.addEventListener(eventName, wrapped);
    return () => eventTarget.removeEventListener(eventName, wrapped);
  }

  window.ExtensionClient = Object.freeze({
    request,
    ping,
    getFacebookSession,
    httpRequest,
    startGroupScan,
    stopGroupScan,
    on,
    normalizeError
  });
})();
