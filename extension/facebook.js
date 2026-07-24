import {
  AppError,
  STATE_KEYS,
  makeId
} from './core.js';
import { getMediaMetadata } from './storage.js';

const ENGINE_PAGE_TIMEOUT_MS = 60000;
const ENGINE_REQUEST_TIMEOUT_MS = 25 * 60 * 1000;
const FACEBOOK_URL = 'https://www.facebook.com/';
const FACEBOOK_HOSTS = new Set(['www.facebook.com', 'web.facebook.com']);

let enginePromise = null;
const progressHandlers = new Map();

async function readEngineRecord() {
  const result = await chrome.storage.session.get(STATE_KEYS.engine);
  return result[STATE_KEYS.engine] || null;
}

async function writeEngineRecord(value) {
  if (value) {
    await chrome.storage.session.set({ [STATE_KEYS.engine]: value });
  } else {
    await chrome.storage.session.remove(STATE_KEYS.engine);
  }
}

function facebookTabUrl(tab) {
  try {
    const url = new URL(tab?.url || tab?.pendingUrl || '');
    return url.protocol === 'https:' && FACEBOOK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function waitForTabComplete(tabId, timeoutMs = ENGINE_PAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(
      new AppError('ENGINE_PAGE_TIMEOUT', 'Tab Facebook nền tải quá thời gian.')
    ), timeoutMs);

    const onUpdated = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId || changeInfo.status !== 'complete') return;
      finish(null, tab);
    };

    async function inspect() {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') finish(null, tab);
      } catch (error) {
        finish(new AppError('ENGINE_TAB_CLOSED', error?.message || 'Tab Facebook nền đã đóng.'));
      }
    }

    function finish(error, tab) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (error) reject(error);
      else resolve(tab);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    void inspect();
  });
}

async function pingTab(tabId, attempts = 30) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'GROUP_PUBLISHER_ENGINE_PING'
      });
      if (response?.success) return response.data || {};
      lastError = new Error(response?.message || 'Máy request Facebook chưa sẵn sàng.');
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new AppError(
    'ENGINE_NOT_READY',
    `Không khởi động được máy request Facebook: ${lastError?.message || 'content script không phản hồi.'}`
  );
}

async function validStoredEngine() {
  const record = await readEngineRecord();
  if (!Number.isInteger(record?.tabId)) return null;
  try {
    const tab = await chrome.tabs.get(record.tabId);
    if (!facebookTabUrl(tab)) {
      await writeEngineRecord(null);
      return null;
    }
    const ping = await pingTab(record.tabId, 2);
    return { record, tab, ping };
  } catch {
    await writeEngineRecord(null);
    return null;
  }
}

async function createEngine(groupId) {
  const tab = await chrome.tabs.create({
    url: `https://www.facebook.com/groups/${groupId}/`,
    active: false
  });
  if (!Number.isInteger(tab.id)) {
    throw new AppError('ENGINE_TAB_CREATE_FAILED', 'Chrome không tạo được tab Facebook nền.');
  }

  const record = {
    tabId: tab.id,
    createdByExtension: true,
    createdAt: Date.now()
  };
  await writeEngineRecord(record);

  try {
    const loaded = await waitForTabComplete(tab.id);
    if (!facebookTabUrl(loaded)) {
      throw new AppError(
        'FACEBOOK_LOGIN_REQUIRED',
        'Facebook đã chuyển tab nền khỏi facebook.com. Hãy đăng nhập lại rồi thử lại.'
      );
    }
    const ping = await pingTab(tab.id);
    if (!ping?.ready || !ping?.account?.uid) {
      throw new AppError(
        'FACEBOOK_NOT_LOGGED_IN',
        'Chrome chưa đăng nhập Facebook. Hãy đăng nhập trong đúng hồ sơ Chrome rồi thử lại.'
      );
    }
    return { record, tab: loaded, ping };
  } catch (error) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    await writeEngineRecord(null);
    throw error;
  }
}

export function ensureFacebookEngine(groupId) {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const existing = await validStoredEngine();
    if (existing?.ping?.ready && existing.ping.account?.uid) return existing;
    return createEngine(groupId);
  })().finally(() => {
    enginePromise = null;
  });
  return enginePromise;
}

export async function closeFacebookEngine() {
  const record = await readEngineRecord();
  await writeEngineRecord(null);
  if (record?.createdByExtension && Number.isInteger(record.tabId)) {
    await chrome.tabs.remove(record.tabId).catch(() => {});
  }
}

function userIdFromHtml(text) {
  const patterns = [
    /"CurrentUserInitialData"[^]*?"USER_ID"\s*:\s*"(\d{5,30})"/i,
    /"USER_ID"\s*:\s*"(\d{5,30})"/i,
    /"ACCOUNT_ID"\s*:\s*"(\d{5,30})"/i,
    /"actorID"\s*:\s*"(\d{5,30})"/i,
    /name="__user"\s+value="(\d{5,30})"/i
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

export async function getFacebookAccount() {
  const existing = await validStoredEngine();
  if (existing?.ping?.account?.uid) return existing.ping.account;
  const facebookTabs = await chrome.tabs.query({
    url: [
      'https://www.facebook.com/*',
      'https://web.facebook.com/*'
    ]
  }).catch(() => []);
  for (const tab of facebookTabs) {
    if (!Number.isInteger(tab.id)) continue;
    try {
      const ping = await pingTab(tab.id, 1);
      if (ping?.account?.uid) return ping.account;
    } catch {
      // An old Facebook tab may not have the newly installed content script yet.
    }
  }
  try {
    const response = await fetch(FACEBOOK_URL, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!response.ok) return { uid: '' };
    return { uid: userIdFromHtml(await response.text()) };
  } catch {
    return { uid: '' };
  }
}

function requestTimeout(promise, timeoutMs, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new AppError('ENGINE_REQUEST_TIMEOUT', 'Request đăng Facebook quá thời gian chờ.'));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function reportFacebookProgress(message, sender) {
  const requestId = String(message?.requestId || '');
  const handler = progressHandlers.get(requestId);
  if (!handler || !Number.isInteger(sender?.tab?.id)) return false;
  handler({
    index: Number(message?.step?.index || 0),
    total: Number(message?.step?.total || 4),
    label: String(message?.step?.label || 'Đang gửi request Facebook')
  });
  return true;
}

export async function isTrustedEngineSender(sender) {
  if (sender?.id !== chrome.runtime.id || !Number.isInteger(sender?.tab?.id)) return false;
  if (!facebookTabUrl(sender.tab)) return false;
  const record = await readEngineRecord();
  return Number(record?.tabId) === sender.tab.id;
}

export async function postToFacebook({
  groupId,
  message,
  mediaId,
  signal,
  onStep
}) {
  const metadata = await getMediaMetadata(mediaId);
  if (!metadata?.committed) {
    throw new AppError('MEDIA_NOT_READY', 'Media chưa sẵn sàng để đăng.');
  }

  onStep?.({ index: 0, total: 4, label: 'Khởi động máy request Facebook' });
  const engine = await ensureFacebookEngine(groupId);
  const requestId = makeId('facebook');
  progressHandlers.set(requestId, onStep || (() => {}));

  const abortEngine = () => {
    void chrome.tabs.sendMessage(engine.record.tabId, {
      type: 'GROUP_PUBLISHER_ENGINE_ABORT',
      requestId
    }).catch(() => {});
  };
  if (signal?.aborted) {
    progressHandlers.delete(requestId);
    throw new AppError('JOB_PAUSED', 'Tiến trình đã được dừng bởi người dùng.');
  }
  signal?.addEventListener('abort', abortEngine, { once: true });

  try {
    const response = await requestTimeout(
      chrome.tabs.sendMessage(engine.record.tabId, {
        type: 'GROUP_PUBLISHER_ENGINE_POST',
        requestId,
        payload: {
          groupId: String(groupId),
          message: String(message),
          mediaId: metadata.id,
          media: {
            kind: metadata.kind,
            name: metadata.name,
            type: metadata.type,
            size: metadata.size,
            totalChunks: metadata.totalChunks
          }
        }
      }),
      ENGINE_REQUEST_TIMEOUT_MS,
      abortEngine
    );

    if (signal?.aborted || response?.code === 'JOB_PAUSED') {
      throw new AppError('JOB_PAUSED', 'Tiến trình đã được dừng bởi người dùng.');
    }
    if (!response?.success) {
      throw new AppError(
        response?.code || 'FACEBOOK_POST_FAILED',
        response?.message || 'Facebook không nhận bài đăng.',
        response?.data || null
      );
    }
    return response.data || {
      postUrl: '',
      postId: '',
      message: 'Facebook đã nhận request đăng bài.'
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new AppError('JOB_PAUSED', 'Tiến trình đã được dừng bởi người dùng.');
    }
    if (error instanceof AppError) throw error;
    throw new AppError(
      'ENGINE_COMMUNICATION_ERROR',
      `Mất kết nối với tab Facebook nền: ${error?.message || String(error)}`
    );
  } finally {
    signal?.removeEventListener('abort', abortEngine);
    progressHandlers.delete(requestId);
  }
}
