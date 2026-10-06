(function () {
  'use strict';
  if (!globalThis.TQT_DASHBOARD_POLICY?.isDashboardUrl(location.href)) return;
  const ORIGIN = location.origin;
  const CHANNEL = 'TQT_DASHBOARD_BRIDGE_V1';
  const pending = new Map();
  const waiters = new Set();
  const subscribers = new Set();
  let session = '';
  let status = {connected: false, message: 'Đang tìm tiện ích...'};
  let stopped = false;

  function post(type, details = {}) {
    if (!stopped && location.origin === ORIGIN) window.postMessage({channel: CHANNEL, source: 'web', type, session, ...details}, ORIGIN);
  }
  function setStatus(next) {
    status = {...status, ...next};
    for (const subscriber of subscribers) subscriber({...status});
    window.dispatchEvent(new CustomEvent('tqt:bridge-status', {detail: {...status}}));
    if (status.connected) for (const waiter of [...waiters]) waiter.resolve();
  }
  function abortError() { return new DOMException('Yêu cầu đã được hủy.', 'AbortError'); }
  function disconnect(message) {
    for (const requestId of pending.keys()) post('CANCEL', {requestId});
    session = '';
    setStatus({connected: false, message});
    for (const request of [...pending.values()]) request.reject(new Error(message));
  }
  function ready(timeoutMs = 10000, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (status.connected && session) return Promise.resolve();
    post('HELLO');
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); waiters.delete(waiter); signal?.removeEventListener('abort', cancel); };
      const waiter = {resolve: () => {cleanup(); resolve();}, reject: error => {cleanup(); reject(error);}};
      const cancel = () => waiter.reject(abortError());
      const timer = setTimeout(() => waiter.reject(new Error('Chưa kết nối tiện ích. Cài tiện ích rồi tải lại trang.')), timeoutMs);
      waiters.add(waiter); signal?.addEventListener('abort', cancel, {once: true});
    });
  }
  async function request(action, payload = {}, {timeoutMs = 60000, signal} = {}) {
    await ready(10000, signal);
    if (signal?.aborted) throw abortError();
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cleanup = () => {clearTimeout(timer); pending.delete(requestId); signal?.removeEventListener('abort', cancel);};
      const cancel = () => {post('CANCEL', {requestId}); entry.reject(abortError());};
      const entry = {resolve: response => {cleanup(); resolve(response);}, reject: error => {cleanup(); reject(error);}};
      const timer = setTimeout(() => {
        post('CANCEL', {requestId}); entry.reject(new Error('Tiện ích phản hồi quá lâu.'));
      }, timeoutMs);
      pending.set(requestId, entry); signal?.addEventListener('abort', cancel, {once: true});
      try { post('REQUEST', {requestId, action, payload}); } catch (error) {entry.reject(error);}
    });
  }
  async function bridgeFetch(url, options = {}) {
    const headers = Object.fromEntries(new Headers(options.headers || {}).entries());
    const response = await request('DASHBOARD_FETCH_API', {
      url: String(url), method: options.method || 'POST', headers, body: options.body || ''
    }, {timeoutMs: 10 * 60 * 1000, signal: options.signal});
    if (response?.ok !== true || !response.data) throw new Error(response?.message || 'Không gọi được API qua tiện ích.');
    const data = response.data;
    return new Response([204,205,304].includes(data.status) ? null : data.body, {
      status: data.status, statusText: data.statusText, headers: data.headers
    });
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.source !== 'extension') return;
    if (data.type === 'OFFER' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.session || '') && /^[a-p]{32}$/.test(data.extensionId || '')) {
      if (session && session !== data.session) return;
      session = data.session;
      setStatus({connected: true, message: 'Đã kết nối tiện ích.', extensionId: data.extensionId, version: data.version, session});
    } else if (data.session === session && data.type === 'STATUS' && data.connected === false) {
      disconnect(data.message || 'Tiện ích đã ngắt kết nối.');
    } else if (data.session === session && data.type === 'RESPONSE') {
      pending.get(data.requestId)?.resolve(data.response);
    }
  });
  window.tqtWebTransport = {
    ready, request, fetch: bridgeFetch,
    getStatus: () => ({...status}),
    subscribe(callback) {subscribers.add(callback); callback({...status}); return () => subscribers.delete(callback);},
    reconnect() {disconnect('Đang kết nối lại tiện ích...'); post('HELLO');}
  };
  const discovery = setInterval(() => {if (!status.connected) post('HELLO');}, 1500);
  window.addEventListener('pagehide', () => {
    stopped = true; clearInterval(discovery);
    disconnect('Trang điều khiển đã đóng.');
    for (const waiter of [...waiters]) waiter.reject(new Error('Trang điều khiển đã đóng.'));
  }, {once: true});
  const statusElement = document.getElementById('webExtensionStatus');
  const connectionBar = statusElement?.parentElement;
  window.tqtWebTransport.subscribe(next => {
    if (statusElement) statusElement.textContent = next.connected ? `Tiện ích ${next.version || ''}: đã kết nối` : next.message;
    if (connectionBar) connectionBar.dataset.connected = String(next.connected);
  });
  document.getElementById('reconnectExtensionBtn')?.addEventListener('click', () => window.tqtWebTransport.reconnect());
  post('HELLO');
}());
