'use strict';

const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const HTTP_RULE_ID = 9010;
const ACTIVE_SCAN_KEY = 'active_group_scan';
const ALLOWED_REQUEST_HOSTS = new Set([
  'www.facebook.com',
  'business.facebook.com',
  'graph.facebook.com',
  'rupload.facebook.com',
  'upload.facebook.com',
  'upload-business.facebook.com'
]);
const RESTRICTED_HEADERS = new Set(['cookie', 'origin', 'referer', 'user-agent']);

let httpQueue = Promise.resolve();

class ExtensionError extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.name = 'ExtensionError';
    this.code = code;
    this.data = data;
  }
}

function success(data = null, message = 'OK') {
  return { success: true, code: 'OK', message, data };
}

function failure(error) {
  const normalized = error instanceof ExtensionError
    ? error
    : new ExtensionError('UNEXPECTED_ERROR', error?.message || String(error));
  return {
    success: false,
    code: normalized.code,
    message: normalized.message,
    data: normalized.data || null
  };
}

function isAllowedWebUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'chrome-extension:' && parsed.hostname === chrome.runtime.id)
      || parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === 'tranquytruong0362683566-gif.github.io';
  } catch (_) {
    return false;
  }
}

function ensureAllowedFacebookUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    throw new ExtensionError('INVALID_URL', 'URL request không hợp lệ');
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_REQUEST_HOSTS.has(parsed.hostname)) {
    throw new ExtensionError('HOST_NOT_ALLOWED', `Extension không cho phép request tới ${parsed.hostname}`);
  }
  return parsed;
}

async function getMachineId() {
  const stored = await chrome.storage.local.get(['machine_id']);
  if (stored.machine_id) return stored.machine_id;
  const machineId = `TQT-${crypto.randomUUID().replaceAll('-', '').slice(0, 24).toUpperCase()}`;
  await chrome.storage.local.set({ machine_id: machineId });
  return machineId;
}

async function getFacebookSession() {
  const [cookies, storage, machineId] = await Promise.all([
    chrome.cookies.getAll({ domain: 'facebook.com' }),
    chrome.storage.local.get(['use_token_mode', 'custom_token', 'custom_jazoest']),
    getMachineId()
  ]);
  return {
    cookies,
    machineId,
    useTokenMode: Boolean(storage.use_token_mode),
    customToken: storage.custom_token || null,
    customJazoest: storage.custom_jazoest || null
  };
}

function base64ToUint8Array(content) {
  const binary = atob(content || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function reconstructBody(body) {
  if (!body) return null;
  if (typeof body === 'string') return body;
  if (body.kind === 'text') return String(body.content || '');
  if (body.kind === 'binary-base64') return base64ToUint8Array(body.content);
  if (body.kind === 'multipart' && Array.isArray(body.parts)) {
    const formData = new FormData();
    for (const part of body.parts) {
      if (part.filename && part.content) {
        const bytes = base64ToUint8Array(part.content);
        const blob = new Blob([bytes], { type: part.contentType || 'application/octet-stream' });
        formData.append(part.name, blob, part.filename);
      } else {
        formData.append(part.name, String(part.value ?? ''));
      }
    }
    return formData;
  }
  throw new ExtensionError('INVALID_BODY', 'Kiểu body request không được hỗ trợ');
}

function escapeUrlFilter(value) {
  return String(value).replace(/[|*^]/g, (char) => `\\${char}`);
}

async function installHeaderRule(url, headers) {
  const requestHeaders = [];
  const fetchHeaders = {};
  for (const [name, rawValue] of Object.entries(headers || {})) {
    if (rawValue === undefined || rawValue === null) continue;
    const lower = name.toLowerCase();
    const value = String(rawValue);
    if (lower === 'host' || lower === 'authority' || lower === 'content-length') continue;
    if (RESTRICTED_HEADERS.has(lower)) {
      requestHeaders.push({ header: lower, operation: 'set', value });
    } else {
      fetchHeaders[name] = value;
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [HTTP_RULE_ID] });
  if (requestHeaders.length) {
    const parsed = new URL(url);
    const filter = `|${escapeUrlFilter(parsed.origin + parsed.pathname)}`;
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: HTTP_RULE_ID,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders },
        condition: {
          urlFilter: filter,
          resourceTypes: ['xmlhttprequest']
        }
      }]
    });
  }
  return { fetchHeaders, hasRule: requestHeaders.length > 0 };
}

async function performHttpRequest(payload) {
  const parsedUrl = ensureAllowedFacebookUrl(payload?.url);
  const timeoutMs = Math.max(5_000, Math.min(300_000, Number(payload.timeoutMs) || 180_000));
  const method = String(payload.method || 'GET').toUpperCase();
  const body = reconstructBody(payload.body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let hasRule = false;

  try {
    const prepared = await installHeaderRule(parsedUrl.href, payload.headers || {});
    hasRule = prepared.hasRule;
    const response = await fetch(parsedUrl.href, {
      method,
      headers: prepared.fetchHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    });
    const text = await response.text();
    const headers = {};
    response.headers.forEach((value, name) => { headers[name] = value; });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers,
      text
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new ExtensionError('HTTP_TIMEOUT', `Request hết thời gian sau ${Math.ceil(timeoutMs / 1000)} giây`);
    throw new ExtensionError('HTTP_FAILED', error.message || String(error));
  } finally {
    clearTimeout(timer);
    if (hasRule) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [HTTP_RULE_ID] });
      } catch (_) {
        // Rule sẽ được xóa ở request kế tiếp.
      }
    }
  }
}

function enqueueHttpRequest(payload) {
  const task = httpQueue.then(() => performHttpRequest(payload));
  httpQueue = task.catch(() => undefined);
  return task;
}

function waitForTabComplete(tabId, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      error ? reject(error) : resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) finish(new ExtensionError('SCAN_TAB_CLOSED', 'Tab quét nhóm đã bị đóng'));
    };
    const timer = setTimeout(() => finish(new ExtensionError('SCAN_LOAD_TIMEOUT', 'Facebook tải nhóm quá thời gian')), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') finish();
    }).catch(() => finish(new ExtensionError('SCAN_TAB_MISSING', 'Không tìm thấy tab quét nhóm')));
  });
}

async function sendTabMessageWithRetry(tabId, message, attempts = 10) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  throw new ExtensionError('SCANNER_NOT_READY', lastError?.message || 'Content script quét nhóm chưa sẵn sàng');
}

async function startGroupScan(payload, requestId) {
  const groupId = String(payload?.groupId || '').match(/\d{5,}/)?.[0];
  if (!groupId) throw new ExtensionError('INVALID_GROUP_ID', 'Group ID không hợp lệ');

  const existing = (await chrome.storage.session.get([ACTIVE_SCAN_KEY]))[ACTIVE_SCAN_KEY];
  if (existing?.tabId) {
    try { await chrome.tabs.get(existing.tabId); } catch (_) { await chrome.storage.session.remove([ACTIVE_SCAN_KEY]); }
    if ((await chrome.storage.session.get([ACTIVE_SCAN_KEY]))[ACTIVE_SCAN_KEY]?.tabId) {
      throw new ExtensionError('SCAN_ALREADY_RUNNING', 'Đang có một tiến trình quét nhóm khác');
    }
  }

  const query = payload.newest ? '?sorting_setting=CHRONOLOGICAL' : '';
  const tab = await chrome.tabs.create({
    url: `https://www.facebook.com/groups/${groupId}${query}`,
    active: false
  });
  if (!tab.id) throw new ExtensionError('SCAN_TAB_CREATE_FAILED', 'Không tạo được tab quét nhóm');

  await chrome.storage.session.set({
    [ACTIVE_SCAN_KEY]: { tabId: tab.id, groupId, requestId, stopRequested: false, startedAt: Date.now() }
  });

  try {
    await waitForTabComplete(tab.id, 75_000);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    const result = await sendTabMessageWithRetry(tab.id, {
      type: 'FB_SCAN_GROUP_POSTS',
      requestId,
      payload: {
        groupId,
        targetCount: payload.targetCount,
        maxScrolls: payload.maxScrolls,
        delayMs: payload.delayMs,
        staleRounds: payload.staleRounds,
        excludePinned: payload.excludePinned
      }
    });

    if (!result?.success) {
      throw new ExtensionError(result?.code || 'SCAN_FAILED', result?.message || 'Quét nhóm thất bại', result?.data || null);
    }
    return result.data;
  } catch (error) {
    const current = (await chrome.storage.session.get([ACTIVE_SCAN_KEY]))[ACTIVE_SCAN_KEY];
    if (current?.stopRequested) throw new ExtensionError('SCAN_STOPPED', 'Tiến trình quét đã dừng');
    throw error;
  } finally {
    await chrome.storage.session.remove([ACTIVE_SCAN_KEY]);
    if (payload.closeTab !== false) {
      try { await chrome.tabs.remove(tab.id); } catch (_) { /* Tab đã đóng. */ }
    }
  }
}

async function stopGroupScan() {
  const active = (await chrome.storage.session.get([ACTIVE_SCAN_KEY]))[ACTIVE_SCAN_KEY];
  if (!active?.tabId) return { stopped: false };
  await chrome.storage.session.set({ [ACTIVE_SCAN_KEY]: { ...active, stopRequested: true } });
  try {
    await chrome.tabs.sendMessage(active.tabId, { type: 'FB_STOP_GROUP_SCAN', requestId: active.requestId });
  } catch (_) {
    // Content script có thể chưa sẵn sàng hoặc tab đã đóng.
  }
  try { await chrome.tabs.remove(active.tabId); } catch (_) { /* Tab đã đóng. */ }
  return { stopped: true, groupId: active.groupId };
}

async function handleWebAction(action, payload, requestId) {
  switch (action) {
    case 'PING':
      return { version: EXTENSION_VERSION, extensionId: chrome.runtime.id };
    case 'GET_FB_SESSION':
      return getFacebookSession();
    case 'HTTP_REQUEST':
      return enqueueHttpRequest(payload);
    case 'START_GROUP_SCAN':
      return startGroupScan(payload, requestId);
    case 'STOP_GROUP_SCAN':
      return stopGroupScan();
    default:
      throw new ExtensionError('UNKNOWN_ACTION', `Action không được hỗ trợ: ${action}`);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [HTTP_RULE_ID] });
  } catch (_) {
    // Không có rule cũ.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GROUP_SCAN_PROGRESS') {
    chrome.runtime.sendMessage({
      type: 'WEB_EVENT',
      event: 'GROUP_SCAN_PROGRESS',
      data: message.data
    }).catch(() => undefined);
    return false;
  }

  if (message?.type !== 'WEB_REQUEST') return false;
  if (!isAllowedWebUrl(sender.url)) {
    sendResponse(failure(new ExtensionError('UNTRUSTED_ORIGIN', 'Nguồn web không được phép kết nối Extension')));
    return false;
  }

  (async () => {
    try {
      const data = await handleWebAction(message.action, message.payload || {}, message.requestId);
      sendResponse(success(data));
    } catch (error) {
      console.error('[TQT Extension]', error);
      sendResponse(failure(error));
    }
  })();
  return true;
});
