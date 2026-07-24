import {
  AppError,
  STATE_KEYS,
  buildCalibrationProfile,
  captureBodySpec,
  makeId,
  normalizeGroupId
} from './core.js';
import {
  localGet,
  localRemove,
  localSet,
  readCalibration,
  writeCalibration
} from './storage.js';
import { getFacebookAccount } from './replay.js';

const DEBUGGER_VERSION = '1.3';
const MAX_TEXT_BODY = 2 * 1024 * 1024;
const MAX_RESPONSE_BODY = 2 * 1024 * 1024;
const MAX_REQUESTS = 300;
const captures = new Map();
let eventChain = Promise.resolve();
let persistTimer = null;
let notifier = () => {};

function debuggee(tabId) {
  return { tabId: Number(tabId) };
}

function isFacebookUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && (url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com'));
  } catch {
    return false;
  }
}

function isRelevantMethod(method) {
  return ['POST', 'PUT', 'PATCH'].includes(String(method || '').toUpperCase());
}

function sanitizeCapturedHeaders(headers) {
  const output = {};
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName || '').toLowerCase();
    if (
      !name
      || name === 'cookie'
      || name === 'authorization'
      || name === 'proxy-authorization'
      || name.startsWith('sec-ch-')
    ) continue;
    const value = String(rawValue ?? '');
    if (value.length <= 10000) output[name] = value;
  }
  return output;
}

function contentTypeOf(request) {
  return String(
    request?.headers?.['content-type']
    || request?.headers?.['Content-Type']
    || ''
  ).toLowerCase();
}

function shouldReadPostData(request) {
  const type = contentTypeOf(request);
  return !/^video\/|application\/octet-stream/i.test(type);
}

function decodeResponseBody(body, base64Encoded) {
  if (!base64Encoded) return String(body || '');
  try {
    return atob(String(body || ''));
  } catch {
    return '';
  }
}

function activeContext(capture) {
  return {
    mode: capture.mode,
    marker: capture.marker,
    groupId: capture.groupId,
    userId: capture.userId,
    fileName: '',
    fileType: '',
    fileSize: ''
  };
}

function compactPostData(request, capture) {
  const postData = typeof request?.postData === 'string' ? request.postData : '';
  if (!postData) return { postData: '', postDataOmitted: Boolean(request?.hasPostData) };
  const contentType = contentTypeOf(request);
  if (contentType.includes('multipart/form-data')) {
    const bodySpec = captureBodySpec(
      {
        url: request.url,
        headers: request.headers,
        postData,
        hasPostData: request.hasPostData
      },
      activeContext(capture),
      []
    );
    if (bodySpec.kind === 'multipart' && bodySpec.parts.some((part) => part.kind === 'media')) {
      return { postData: '', postDataOmitted: false, bodySpec };
    }
  }
  if (postData.length <= MAX_TEXT_BODY) return { postData, postDataOmitted: false };
  return { postData: '', postDataOmitted: true };
}

function trimCapture(capture) {
  const entries = Object.entries(capture.requests || {});
  if (entries.length <= MAX_REQUESTS) return;
  entries
    .sort((left, right) => Number(left[1]?.startedAt || 0) - Number(right[1]?.startedAt || 0))
    .slice(0, entries.length - MAX_REQUESTS)
    .forEach(([requestId]) => delete capture.requests[requestId]);
}

function schedulePersist(capture) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void localSet(STATE_KEYS.capture, capture).catch((error) => {
      console.warn('[GroupPublisher] Không lưu được dữ liệu ghi mẫu:', error);
    });
  }, 200);
}

async function loadCapture(sessionId) {
  if (captures.has(sessionId)) return captures.get(sessionId);
  const saved = await localGet(STATE_KEYS.capture, null);
  if (saved?.sessionId === sessionId) {
    captures.set(sessionId, saved);
    return saved;
  }
  return null;
}

async function activeCaptureForTab(tabId) {
  const calibration = await readCalibration();
  const active = calibration?.active;
  if (!active || Number(active.tabId) !== Number(tabId)) return null;
  return loadCapture(active.sessionId);
}

async function updateRequest(tabId, requestId, updater) {
  const capture = await activeCaptureForTab(tabId);
  if (!capture) return;
  const entry = capture.requests[requestId];
  if (!entry) return;
  await updater(entry, capture);
  capture.updatedAt = Date.now();
  schedulePersist(capture);
}

async function handleDebuggerEvent(source, method, params) {
  const tabId = source?.tabId;
  if (!Number.isInteger(tabId)) return;

  if (method === 'Network.requestWillBeSent') {
    const request = params?.request;
    if (!isRelevantMethod(request?.method) || !isFacebookUrl(request?.url)) return;
    const capture = await activeCaptureForTab(tabId);
    if (!capture) return;

    const normalizedRequest = {
      url: request.url,
      method: String(request.method || 'POST').toUpperCase(),
      headers: sanitizeCapturedHeaders(request.headers),
      hasPostData: Boolean(request.hasPostData),
      postData: typeof request.postData === 'string' ? request.postData : ''
    };
    const compact = compactPostData(normalizedRequest, capture);
    capture.requests[params.requestId] = {
      id: params.requestId,
      url: normalizedRequest.url,
      method: normalizedRequest.method,
      headers: normalizedRequest.headers,
      hasPostData: normalizedRequest.hasPostData,
      postData: compact.postData,
      postDataOmitted: compact.postDataOmitted,
      bodySpec: compact.bodySpec,
      resourceType: params.type || '',
      startedAt: Date.now(),
      timestamp: params.timestamp || 0,
      response: null,
      failed: null
    };
    trimCapture(capture);
    schedulePersist(capture);

    if (
      normalizedRequest.hasPostData
      && !normalizedRequest.postData
      && shouldReadPostData(normalizedRequest)
    ) {
      try {
        const result = await chrome.debugger.sendCommand(
          debuggee(tabId),
          'Network.getRequestPostData',
          { requestId: params.requestId }
        );
        if (typeof result?.postData === 'string') {
          const next = compactPostData({ ...normalizedRequest, postData: result.postData }, capture);
          Object.assign(capture.requests[params.requestId], next);
          schedulePersist(capture);
        }
      } catch {
        // Some streamed uploads intentionally do not expose request bytes.
      }
    }
    return;
  }

  if (method === 'Network.requestWillBeSentExtraInfo') {
    await updateRequest(tabId, params.requestId, async (entry) => {
      entry.headers = {
        ...entry.headers,
        ...sanitizeCapturedHeaders(params.headers)
      };
    });
    return;
  }

  if (method === 'Network.responseReceived') {
    await updateRequest(tabId, params.requestId, async (entry) => {
      entry.response = {
        status: Number(params.response?.status || 0),
        statusText: String(params.response?.statusText || ''),
        mimeType: String(params.response?.mimeType || ''),
        headers: sanitizeCapturedHeaders(params.response?.headers),
        url: String(params.response?.url || entry.url),
        body: ''
      };
    });
    return;
  }

  if (method === 'Network.loadingFailed') {
    await updateRequest(tabId, params.requestId, async (entry) => {
      entry.failed = {
        errorText: String(params.errorText || 'Request thất bại.'),
        canceled: Boolean(params.canceled),
        blockedReason: String(params.blockedReason || '')
      };
      entry.finishedAt = Date.now();
    });
    return;
  }

  if (method === 'Network.loadingFinished') {
    await updateRequest(tabId, params.requestId, async (entry) => {
      entry.finishedAt = Date.now();
      entry.encodedDataLength = Number(params.encodedDataLength || 0);
      const mimeType = String(entry.response?.mimeType || '');
      const mayBeText = /json|text|javascript|graphql|html/i.test(mimeType)
        || /graphql|ajax|upload|video|photo/i.test(entry.url);
      if (!mayBeText || entry.encodedDataLength > MAX_RESPONSE_BODY) return;
      try {
        const response = await chrome.debugger.sendCommand(
          debuggee(tabId),
          'Network.getResponseBody',
          { requestId: params.requestId }
        );
        const text = decodeResponseBody(response?.body, response?.base64Encoded);
        if (text.length <= MAX_RESPONSE_BODY && entry.response) entry.response.body = text;
      } catch {
        // Cached/streamed responses may no longer have a readable body.
      }
    });
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  eventChain = eventChain
    .then(() => handleDebuggerEvent(source, method, params))
    .catch((error) => console.warn('[GroupPublisher] Lỗi ghi request:', error));
});

chrome.debugger.onDetach.addListener((source) => {
  const tabId = source?.tabId;
  if (!Number.isInteger(tabId)) return;
  void readCalibration().then(async (calibration) => {
    if (Number(calibration?.active?.tabId) !== tabId) return;
    calibration.active.detached = true;
    calibration.active.message = 'Phiên ghi đã mất kết nối. Hãy bấm hoàn tất để phân tích dữ liệu đã có.';
    await writeCalibration(calibration);
    notifier();
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void readCalibration().then(async (calibration) => {
    if (Number(calibration?.active?.tabId) !== Number(tabId)) return;
    calibration.active.tabClosed = true;
    calibration.active.message = 'Tab ghi mẫu đã đóng. Bấm hoàn tất để dùng dữ liệu đã ghi hoặc ghi lại.';
    await writeCalibration(calibration);
    notifier();
  });
});

export function setCalibrationNotifier(callback) {
  notifier = typeof callback === 'function' ? callback : () => {};
}

export async function startCalibration(input) {
  const mode = input?.mode === 'video' ? 'video' : input?.mode === 'image' ? 'image' : '';
  if (!mode) throw new AppError('INVALID_CALIBRATION_MODE', 'Loại ghi mẫu không hợp lệ.');
  const groupId = normalizeGroupId(input?.groupId);
  const calibration = await readCalibration();
  if (calibration?.active) {
    throw new AppError('CALIBRATION_ALREADY_ACTIVE', 'Một phiên ghi mẫu đang hoạt động. Hãy hoàn tất phiên đó trước.');
  }

  const account = await getFacebookAccount({ force: true });
  if (!account?.uid) {
    throw new AppError('FACEBOOK_NOT_LOGGED_IN', 'Chưa tìm thấy phiên đăng nhập Facebook trong Chrome.');
  }

  const sessionId = makeId('calibration');
  const marker = `TRUONG_AUTO_${mode.toUpperCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  if (!Number.isInteger(tab?.id)) {
    throw new AppError('CALIBRATION_TAB_FAILED', 'Không tạo được tab ghi mẫu.');
  }

  try {
    await chrome.debugger.attach(debuggee(tab.id), DEBUGGER_VERSION);
    await chrome.debugger.sendCommand(debuggee(tab.id), 'Network.enable', {
      maxTotalBufferSize: 100 * 1024 * 1024,
      maxResourceBufferSize: 8 * 1024 * 1024,
      maxPostDataSize: 8 * 1024 * 1024
    });
    await chrome.debugger.sendCommand(debuggee(tab.id), 'Page.enable');
  } catch (error) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    throw new AppError(
      'DEBUGGER_ATTACH_FAILED',
      `Không bật được chế độ ghi request: ${error?.message || String(error)}`
    );
  }

  const capture = {
    version: 1,
    sessionId,
    mode,
    groupId,
    userId: account.uid,
    marker,
    tabId: tab.id,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    requests: {}
  };
  captures.set(sessionId, capture);
  await localSet(STATE_KEYS.capture, capture);

  calibration.active = {
    sessionId,
    mode,
    groupId,
    marker,
    tabId: tab.id,
    startedAt: capture.startedAt,
    message: 'Đang ghi request trên tab Facebook.'
  };
  calibration.profiles ||= {};
  await writeCalibration(calibration);

  await chrome.debugger.sendCommand(debuggee(tab.id), 'Page.navigate', {
    url: `https://www.facebook.com/groups/${groupId}/`
  });
  notifier();
  return calibration.active;
}

export async function stopCalibration() {
  const calibration = await readCalibration();
  const active = calibration?.active;
  if (!active) throw new AppError('NO_ACTIVE_CALIBRATION', 'Không có phiên ghi mẫu đang hoạt động.');

  await eventChain.catch(() => {});
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const capture = await loadCapture(active.sessionId);
  if (!capture) {
    calibration.active = null;
    await writeCalibration(calibration);
    throw new AppError('CALIBRATION_CAPTURE_MISSING', 'Không còn dữ liệu request của phiên ghi mẫu. Hãy ghi lại.');
  }

  try {
    await chrome.debugger.sendCommand(debuggee(active.tabId), 'Network.disable');
  } catch {
    // The tab may already have been closed or detached.
  }
  try {
    await chrome.debugger.detach(debuggee(active.tabId));
  } catch {
    // No active debugger is also a valid end state.
  }

  const profile = buildCalibrationProfile(capture);
  calibration.profiles ||= {};
  calibration.profiles[active.mode] = profile;
  calibration.active = null;
  await writeCalibration(calibration);
  await localRemove(STATE_KEYS.capture);
  captures.delete(active.sessionId);
  if (!active.tabClosed) await chrome.tabs.remove(active.tabId).catch(() => {});
  notifier();
  return profile;
}

export async function recoverCalibrationState() {
  const calibration = await readCalibration();
  if (!calibration?.active) return calibration;
  const capture = await localGet(STATE_KEYS.capture, null);
  if (capture?.sessionId === calibration.active.sessionId) {
    captures.set(capture.sessionId, capture);
  } else {
    calibration.active.message = 'Không khôi phục được dữ liệu ghi mẫu. Hãy hoàn tất rồi ghi lại.';
    await writeCalibration(calibration);
  }
  return calibration;
}
