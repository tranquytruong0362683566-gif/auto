'use strict';

(() => {
  const WEB_SOURCE = 'TQT_FB_AUTOMATION_WEB';
  const BRIDGE_SOURCE = 'TQT_FB_AUTOMATION_EXTENSION';

  function isAllowedPage() {
    const host = window.location.hostname;
    return host === 'localhost'
      || host === '127.0.0.1'
      || host === 'tranquytruong0362683566-gif.github.io';
  }

  if (!isAllowedPage()) return;

  function postResponse(requestId, response) {
    window.postMessage({
      source: BRIDGE_SOURCE,
      type: 'RESPONSE',
      requestId,
      success: Boolean(response?.success),
      code: response?.code || (response?.success ? 'OK' : 'EMPTY_RESPONSE'),
      message: response?.message || (response?.success ? 'OK' : 'Extension không trả dữ liệu'),
      data: response?.data ?? null
    }, window.location.origin);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || message.source !== WEB_SOURCE || message.type !== 'REQUEST') return;
    if (!message.requestId || !message.action) return;

    chrome.runtime.sendMessage({
      type: 'WEB_REQUEST',
      requestId: message.requestId,
      action: message.action,
      payload: message.payload || {}
    }, (response) => {
      if (chrome.runtime.lastError) {
        postResponse(message.requestId, {
          success: false,
          code: 'RUNTIME_ERROR',
          message: chrome.runtime.lastError.message
        });
        return;
      }
      postResponse(message.requestId, response);
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'WEB_EVENT' || !message.event) return false;
    window.postMessage({
      source: BRIDGE_SOURCE,
      type: 'EVENT',
      event: message.event,
      data: message.data ?? null
    }, window.location.origin);
    return false;
  });

  window.postMessage({
    source: BRIDGE_SOURCE,
    type: 'EVENT',
    event: 'EXTENSION_BRIDGE_READY',
    data: { version: chrome.runtime.getManifest().version }
  }, window.location.origin);
})();
