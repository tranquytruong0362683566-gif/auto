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
  putMediaChunk,
  readCalibration,
  readJob
} from './storage.js';
import {
  recoverCalibrationState,
  setCalibrationNotifier,
  startCalibration,
  stopCalibration
} from './calibration.js';
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
import {
  cleanupReplayRules,
  getFacebookAccount
} from './replay.js';

let notifyTimer = null;

function publicProfile(profile) {
  if (!profile) return null;
  return {
    mode: profile.mode,
    ready: Boolean(profile.ready),
    createdAt: profile.createdAt || null,
    stepCount: Number(profile.stepCount || 0),
    message: profile.message || '',
    diagnostics: profile.diagnostics || null
  };
}

function publicCalibration(calibration) {
  return {
    profiles: {
      image: publicProfile(calibration?.profiles?.image),
      video: publicProfile(calibration?.profiles?.video)
    },
    active: calibration?.active
      ? {
          mode: calibration.active.mode,
          groupId: calibration.active.groupId,
          marker: calibration.active.marker,
          tabId: calibration.active.tabId,
          startedAt: calibration.active.startedAt,
          message: calibration.active.message || ''
        }
      : null
  };
}

async function getState() {
  const [account, calibration, job] = await Promise.all([
    getFacebookAccount().catch(() => ({ uid: '' })),
    readCalibration(),
    readJob()
  ]);
  return {
    account,
    calibration: publicCalibration(calibration),
    job: publicJob(job),
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
setCalibrationNotifier(scheduleNotify);

async function executeAction(action, payload) {
  switch (action) {
    case 'GET_STATE':
      return ok(await getState(), 'Đã đọc trạng thái.');
    case 'MEDIA_BEGIN': {
      const media = await beginMedia(payload);
      return ok({ mediaId: media.id, totalChunks: media.totalChunks }, 'Đã tạo phiên chuyển media.', 'MEDIA_STARTED');
    }
    case 'MEDIA_CHUNK':
      return ok(await putMediaChunk(payload), 'Đã nhận một phần media.', 'MEDIA_CHUNK_ACCEPTED');
    case 'MEDIA_COMMIT': {
      const media = await commitMedia(payload?.mediaId);
      return ok(
        { mediaId: media.id, name: media.name, type: media.type, size: media.size, kind: media.kind },
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
    case 'CALIBRATION_START': {
      const active = await startCalibration(payload);
      return ok({ active }, 'Đã mở tab và bắt đầu ghi request.', 'CALIBRATION_STARTED');
    }
    case 'CALIBRATION_STOP': {
      const profile = await stopCalibration();
      return ok(
        { profile: publicProfile(profile) },
        profile.ready ? 'Hiệu chuẩn request thành công.' : profile.message,
        profile.ready ? 'CALIBRATION_READY' : 'CALIBRATION_INCOMPLETE'
      );
    }
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
    return url.origin === WEB_ORIGIN && (url.pathname === '/auto' || url.pathname.startsWith(WEB_PATH_PREFIX));
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    cleanupReplayRules(),
    recoverCalibrationState(),
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
