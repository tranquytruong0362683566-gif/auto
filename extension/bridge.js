(function () {
  'use strict';

  if (window.__groupPublisherExtensionBridge) return;
  window.__groupPublisherExtensionBridge = true;

  const WEB_SOURCE = 'GROUP_PUBLISHER_WEB';
  const EXTENSION_SOURCE = 'GROUP_PUBLISHER_EXTENSION';
  const REQUEST_TYPE = 'GROUP_PUBLISHER_REQUEST';
  const RESPONSE_TYPE = 'GROUP_PUBLISHER_RESPONSE';
  const STATUS_TYPE = 'GROUP_PUBLISHER_STATUS';
  const DISCOVER_TYPE = 'GROUP_PUBLISHER_DISCOVER';
  const EXPECTED_ORIGIN = 'https://tranquytruong0362683566-gif.github.io';
  const ALLOWED_ACTIONS = new Set([
    'GET_STATE',
    'MEDIA_BEGIN',
    'MEDIA_CHUNK',
    'MEDIA_COMMIT',
    'MEDIA_DELETE',
    'START_JOB',
    'PAUSE_JOB',
    'RESUME_JOB',
    'CLEAR_JOB',
    'CLEAR_RESULTS',
    'CALIBRATION_START',
    'CALIBRATION_STOP'
  ]);

  function onAllowedPage() {
    return location.origin === EXPECTED_ORIGIN
      && (location.pathname === '/auto' || location.pathname.startsWith('/auto/'));
  }

  function post(type, payload = {}) {
    window.postMessage({
      source: EXTENSION_SOURCE,
      type,
      ...payload
    }, EXPECTED_ORIGIN);
  }

  function postStatus(connected = true, message = '') {
    post(STATUS_TYPE, {
      connected,
      message: message || (connected ? 'Extension đã kết nối.' : 'Extension đã ngắt kết nối.')
    });
  }

  async function sendToBackground(data) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'WEB_COMMAND',
        requestId: String(data.requestId || ''),
        action: data.action,
        payload: data.payload
      });
      return response || {
        success: false,
        code: 'EMPTY_BACKGROUND_RESPONSE',
        message: 'Service worker không trả dữ liệu.',
        data: null
      };
    } catch (error) {
      postStatus(false, error?.message || 'Không kết nối được service worker.');
      return {
        success: false,
        code: 'BACKGROUND_UNAVAILABLE',
        message: error?.message || 'Không kết nối được service worker.',
        data: null
      };
    }
  }

  window.addEventListener('message', (event) => {
    if (!onAllowedPage() || event.source !== window || event.origin !== EXPECTED_ORIGIN) return;
    const data = event.data;
    if (!data || data.source !== WEB_SOURCE) return;

    if (data.type === DISCOVER_TYPE) {
      postStatus(true);
      return;
    }
    if (data.type !== REQUEST_TYPE) return;

    const requestId = String(data.requestId || '');
    const action = String(data.action || '');
    if (!requestId || !ALLOWED_ACTIONS.has(action) || !data.payload || typeof data.payload !== 'object') {
      post(RESPONSE_TYPE, {
        requestId,
        response: {
          success: false,
          code: 'INVALID_WEB_MESSAGE',
          message: 'Thông điệp từ website không hợp lệ.',
          data: null
        }
      });
      return;
    }

    void sendToBackground(data).then((response) => {
      post(RESPONSE_TYPE, { requestId, response });
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'GROUP_PUBLISHER_STATE_CHANGED') postStatus(true, 'Trạng thái vừa được cập nhật.');
  });

  postStatus(true);
}());
