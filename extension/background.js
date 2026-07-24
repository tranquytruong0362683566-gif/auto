import {
  ALLOWED_ACTIONS,
  AppError,
  WEB_ORIGIN,
  WEB_PATH_PREFIX,
  fail,
  ok
} from './core.js';
import {
  beginMedia,
  commitMedia,
  deleteMedia,
  getMediaChunkBase64,
  putMediaChunk,
  readJob
} from './storage.js';
import {
  getFacebookAccount,
  isTrustedEngineSender,
  reportFacebookProgress
} from './facebook.js';
import {
  QUEUE_ALARM,
  clearJob,
  clearResults,
  pauseJob,
  processQueue,
  publicJob,
  recoverQueue,
  resumeJob,
  setQueueNotifier,
  startJob
} from './queue.js';

let notifyTimer = null;

async function getState() {
  const [account, job] = await Promise.all([
    getFacebookAccount().catch(() => ({ uid: '' })),
    readJob()
  ]);
  return {
    account,
    job: publicJob(job),
    engine: {
      mode: 'automatic-request',
      automatic: true
    },
    extension: {
      version: chrome.runtime.getManifest().version
    }
  };
}

async function notifyPages() {
  const tabs = await chrome.tabs.query({
    url: `${WEB_ORIGIN}${WEB_PATH_PREFIX}*`
  }).catch(() => []);
  await Promise.allSettled(tabs.map((tab) => (
    Number.isInteger(tab.id)
      ? chrome.tabs.sendMessage(tab.id, { type: 'GROUP_PUBLISHER_STATE_CHANGED' })
      : Promise.resolve()
  )));
}

function scheduleNotify() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    void notifyPages();
  }, 80);
}

setQueueNotifier(scheduleNotify);

async function executeAction(action, payload) {
  switch (action) {
    case 'GET_STATE':
      return ok(await getState(), 'Đã đọc trạng thái.');
    case 'MEDIA_BEGIN': {
      const media = await beginMedia(payload);
      return ok(
        { mediaId: media.id, totalChunks: media.totalChunks },
        'Đã tạo phiên chuyển media.',
        'MEDIA_STARTED'
      );
    }
    case 'MEDIA_CHUNK':
      return ok(await putMediaChunk(payload), 'Đã nhận một phần media.', 'MEDIA_CHUNK_ACCEPTED');
    case 'MEDIA_COMMIT': {
      const media = await commitMedia(payload?.mediaId);
      return ok(
        {
          mediaId: media.id,
          name: media.name,
          type: media.type,
          size: media.size,
          kind: media.kind
        },
        'Media đã sẵn sàng.',
        'MEDIA_READY'
      );
    }
    case 'MEDIA_DELETE':
      await deleteMedia(payload?.mediaId);
      return ok(null, 'Đã xóa media.', 'MEDIA_DELETED');
    case 'START_JOB':
      return ok(await startJob(payload), 'Đã bắt đầu hàng đợi.', 'JOB_STARTED');
    case 'PAUSE_JOB':
      return ok(await pauseJob(), 'Đã yêu cầu dừng hàng đợi.', 'JOB_PAUSED');
    case 'RESUME_JOB':
      return ok(await resumeJob(), 'Đã tiếp tục hàng đợi.', 'JOB_RESUMED');
    case 'CLEAR_JOB':
      return ok(await clearJob(), 'Đã xóa hàng đợi.', 'JOB_CLEARED');
    case 'CLEAR_RESULTS':
      return ok(await clearResults(), 'Đã xóa kết quả.', 'RESULTS_CLEARED');
    default:
      throw new AppError('UNKNOWN_ACTION', `Lệnh không được hỗ trợ: ${action}`);
  }
}

function senderAllowed(message, sender) {
  if (message?.type === 'POPUP_COMMAND') {
    return sender?.id === chrome.runtime.id && !sender?.tab;
  }
  if (message?.type !== 'WEB_COMMAND') return false;
  if (sender?.id !== chrome.runtime.id) return false;
  try {
    const url = new URL(sender.url || sender.tab?.url || '');
    return url.origin === WEB_ORIGIN
      && (url.pathname === '/auto' || url.pathname.startsWith(WEB_PATH_PREFIX));
  } catch {
    return false;
  }
}

async function executeEngineMessage(message, sender) {
  if (!await isTrustedEngineSender(sender)) {
    throw new AppError('UNTRUSTED_ENGINE_TAB', 'Tab gửi dữ liệu không phải máy request Facebook.');
  }
  if (message.type === 'GROUP_PUBLISHER_ENGINE_MEDIA_CHUNK') {
    return ok(
      await getMediaChunkBase64(message.mediaId, message.index),
      'Đã đọc phần media.',
      'ENGINE_MEDIA_CHUNK'
    );
  }
  if (message.type === 'GROUP_PUBLISHER_ENGINE_PROGRESS') {
    reportFacebookProgress(message, sender);
    return ok(null, 'Đã cập nhật tiến trình.', 'ENGINE_PROGRESS');
  }
  throw new AppError('UNKNOWN_ENGINE_MESSAGE', 'Thông điệp máy request không hợp lệ.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message?.type === 'GROUP_PUBLISHER_ENGINE_MEDIA_CHUNK'
    || message?.type === 'GROUP_PUBLISHER_ENGINE_PROGRESS'
  ) {
    executeEngineMessage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse(fail(error)));
    return true;
  }

  if (!senderAllowed(message, sender)) {
    sendResponse(fail(new AppError('UNTRUSTED_SENDER', 'Nguồn gửi lệnh không được phép.')));
    return false;
  }
  const action = String(message?.action || '');
  if (!ALLOWED_ACTIONS.has(action)) {
    sendResponse(fail(new AppError('UNKNOWN_ACTION', 'Lệnh không nằm trong danh sách cho phép.')));
    return false;
  }
  executeAction(action, message?.payload && typeof message.payload === 'object' ? message.payload : {})
    .then(sendResponse)
    .catch((error) => {
      console.error(`[GroupPublisher] ${action} failed:`, error);
      sendResponse(fail(error));
    });
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === QUEUE_ALARM) void processQueue();
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap();
});

chrome.runtime.onInstalled.addListener(() => {
  void bootstrap();
});

let bootstrapPromise = null;
function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = Promise.all([
    chrome.storage.local.remove(['gp.calibration.v1', 'gp.calibration.capture.v1']),
    recoverQueue()
  ]).catch((error) => {
    console.error('[GroupPublisher] Khởi tạo extension thất bại:', error);
  }).finally(() => {
    bootstrapPromise = null;
    scheduleNotify();
  });
  return bootstrapPromise;
}

void bootstrap();
