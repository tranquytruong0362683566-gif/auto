(function () {
  'use strict';

  if (window.__groupPublisherEngineRelay) return;
  window.__groupPublisherEngineRelay = true;

  const RELAY_SOURCE = 'GROUP_PUBLISHER_ENGINE_RELAY';
  const MAIN_SOURCE = 'GROUP_PUBLISHER_ENGINE_MAIN';
  const MAIN_TIMEOUT_MS = 25 * 60 * 1000;
  const pending = new Map();
  const aborted = new Set();

  function response(success, code, message, data = null) {
    return { success, code, message, data };
  }

  function decodeBase64(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function report(requestId, index, total, label) {
    void chrome.runtime.sendMessage({
      type: 'GROUP_PUBLISHER_ENGINE_PROGRESS',
      requestId,
      step: { index, total, label }
    }).catch(() => {});
  }

  function callMain(requestId, action, payload, timeoutMs = MAIN_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Script request Facebook không phản hồi.'));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      window.postMessage({
        source: RELAY_SOURCE,
        type: 'GROUP_PUBLISHER_ENGINE_REQUEST',
        requestId,
        action,
        payload
      }, location.origin);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== MAIN_SOURCE) return;

    if (message.type === 'GROUP_PUBLISHER_ENGINE_PROGRESS') {
      const step = message.step || {};
      report(message.requestId, step.index, step.total, step.label);
      return;
    }
    if (message.type !== 'GROUP_PUBLISHER_ENGINE_RESPONSE') return;

    const waiter = pending.get(String(message.requestId || ''));
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(String(message.requestId || ''));
    waiter.resolve(message.response);
  });

  async function loadMedia(requestId, payload) {
    const media = payload?.media || {};
    const totalChunks = Number(media.totalChunks || 0);
    if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
      throw new Error('Thông tin số phần media không hợp lệ.');
    }

    const parts = [];
    for (let index = 0; index < totalChunks; index += 1) {
      if (aborted.has(requestId)) throw new Error('JOB_PAUSED');
      const chunk = await chrome.runtime.sendMessage({
        type: 'GROUP_PUBLISHER_ENGINE_MEDIA_CHUNK',
        mediaId: payload.mediaId,
        index
      });
      if (!chunk?.success || !chunk.data?.data) {
        throw new Error(chunk?.message || `Không đọc được phần media ${index + 1}.`);
      }
      parts.push(decodeBase64(chunk.data.data));
      if (index === 0 || index === totalChunks - 1 || index % 8 === 0) {
        report(
          requestId,
          1,
          4,
          `Chuẩn bị media ${Math.round(((index + 1) / totalChunks) * 100)}%`
        );
      }
    }
    return new Blob(parts, { type: media.type || 'application/octet-stream' });
  }

  async function executePost(message) {
    const requestId = String(message.requestId || '');
    try {
      report(requestId, 1, 4, 'Đang chuyển media vào máy request');
      const file = await loadMedia(requestId, message.payload);
      if (aborted.has(requestId)) throw new Error('JOB_PAUSED');
      const result = await callMain(requestId, 'POST', {
        ...message.payload,
        file
      });
      return result || response(false, 'EMPTY_ENGINE_RESPONSE', 'Máy request Facebook không trả kết quả.');
    } catch (error) {
      if (aborted.has(requestId) || error?.message === 'JOB_PAUSED') {
        return response(false, 'JOB_PAUSED', 'Tiến trình đã được dừng bởi người dùng.');
      }
      return response(
        false,
        'ENGINE_RELAY_ERROR',
        error?.message || String(error)
      );
    } finally {
      aborted.delete(requestId);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return false;
    if (message?.type === 'GROUP_PUBLISHER_ENGINE_PING') {
      const requestId = `ping_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      void callMain(requestId, 'PING', {}, 8000)
        .then(sendResponse)
        .catch((error) => sendResponse(response(
          false,
          'ENGINE_MAIN_NOT_READY',
          error?.message || 'Script request Facebook chưa sẵn sàng.'
        )));
      return true;
    }
    if (message?.type === 'GROUP_PUBLISHER_ENGINE_ABORT') {
      const requestId = String(message.requestId || '');
      aborted.add(requestId);
      window.postMessage({
        source: RELAY_SOURCE,
        type: 'GROUP_PUBLISHER_ENGINE_REQUEST',
        requestId,
        action: 'ABORT',
        payload: {}
      }, location.origin);
      sendResponse(response(true, 'ENGINE_ABORTED', 'Đã yêu cầu dừng request Facebook.'));
      return false;
    }
    if (message?.type !== 'GROUP_PUBLISHER_ENGINE_POST') return false;
    void executePost(message).then(sendResponse);
    return true;
  });
}());
