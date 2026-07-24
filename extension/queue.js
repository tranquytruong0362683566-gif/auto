import {
  AppError,
  makeId,
  normalizeGroupIds
} from './core.js';
import {
  deleteMedia,
  getMediaMetadata,
  purgeExpiredMedia,
  readCalibration,
  readJob,
  writeJob
} from './storage.js';
import { replayPost } from './replay.js';

export const QUEUE_ALARM = 'gp.queue.next.v1';
const ACTIVE_STATUSES = new Set(['queued', 'running', 'waiting']);
const MAX_GROUPS = 1000;
const MAX_ACTIVITY = 120;
const LEASE_MS = 25 * 60 * 1000;

let runningPromise = null;
let currentAbortController = null;
let notifier = () => {};

function activity(job, message, level = '', code = '', groupId = '') {
  job.activity ||= [];
  job.activity.push({
    at: Date.now(),
    message: String(message || ''),
    level,
    code,
    groupId: String(groupId || '')
  });
  if (job.activity.length > MAX_ACTIVITY) {
    job.activity.splice(0, job.activity.length - MAX_ACTIVITY);
  }
}

function cleanPublicJob(job) {
  if (!job) return null;
  const { lease, ...publicJob } = job;
  return publicJob;
}

async function schedule(when = Date.now() + 100) {
  await chrome.alarms.create(QUEUE_ALARM, { when: Math.max(Date.now() + 50, Number(when) || Date.now() + 50) });
}

async function clearSchedule() {
  await chrome.alarms.clear(QUEUE_ALARM);
}

function releaseLease(job) {
  job.lease = null;
  job.activeGroupId = '';
  job.updatedAt = Date.now();
}

async function finishJob(job) {
  job.status = 'completed';
  job.currentIndex = job.groups.length;
  job.nextRunAt = null;
  job.message = 'Đã xử lý hết danh sách UID nhóm.';
  releaseLease(job);
  activity(job, `Hoàn tất: ${job.results.filter((item) => item.status === 'success').length} thành công, ${job.results.filter((item) => item.status === 'failed').length} thất bại.`, 'ok', 'JOB_COMPLETED');
  await writeJob(job);
  await clearSchedule();
  notifier();
  await deleteMedia(job.mediaId).catch(() => {});
}

async function persistFailure(job, groupId, error) {
  const result = {
    groupId,
    status: 'failed',
    code: error?.code || 'POST_FAILED',
    message: error?.message || String(error || 'Đăng bài thất bại.'),
    at: Date.now(),
    postUrl: ''
  };
  job.results.push(result);
  job.currentIndex += 1;
  activity(job, `Nhóm ${groupId}: ${result.message}`, 'error', result.code, groupId);
}

async function processLoop() {
  while (true) {
    let job = await readJob();
    if (!job || !ACTIVE_STATUSES.has(job.status)) return;

    if (job.status === 'waiting' && Number(job.nextRunAt || 0) > Date.now()) {
      await schedule(job.nextRunAt);
      return;
    }
    if (job.currentIndex >= job.groups.length) {
      await finishJob(job);
      return;
    }

    const now = Date.now();
    if (job.lease?.expiresAt > now) return;
    const leaseToken = makeId('lease');
    const jobId = job.id;
    const groupId = job.groups[job.currentIndex];
    job.lease = { token: leaseToken, expiresAt: now + LEASE_MS };
    job.status = 'running';
    job.activeGroupId = groupId;
    job.nextRunAt = null;
    job.message = `Đang gửi request cho nhóm ${groupId}.`;
    job.updatedAt = now;
    activity(job, `Bắt đầu đăng vào nhóm ${groupId}.`, 'warn', 'GROUP_STARTED', groupId);
    await writeJob(job);
    notifier();

    currentAbortController = new AbortController();
    let outcome = null;
    let failure = null;
    try {
      const calibration = await readCalibration();
      const profile = calibration?.profiles?.[job.media?.kind];
      if (!profile?.ready) {
        throw new AppError('PROFILE_NOT_READY', `Mẫu request ${job.media?.kind === 'video' ? 'video' : 'ảnh'} không còn sẵn sàng.`);
      }
      outcome = await replayPost({
        profile,
        groupId,
        message: job.content,
        mediaId: job.mediaId,
        signal: currentAbortController.signal,
        onStep(step) {
          void readJob().then(async (latest) => {
            if (!latest || latest.id !== jobId || latest.lease?.token !== leaseToken) return;
            latest.message = `${step.label} (${step.index + 1}/${step.total}) · nhóm ${groupId}`;
            latest.lease.expiresAt = Date.now() + LEASE_MS;
            latest.updatedAt = Date.now();
            await writeJob(latest);
            notifier();
          }).catch(() => {});
        }
      });
    } catch (error) {
      failure = error;
    } finally {
      currentAbortController = null;
    }

    job = await readJob();
    if (!job || job.id == null) return;
    if (job.id !== jobId || job.lease?.token !== leaseToken) return;

    const pauseRequested = job.status === 'paused' || job.status === 'stopped';
    if (failure?.code === 'JOB_PAUSED' || (failure && pauseRequested)) {
      releaseLease(job);
      job.status = job.status === 'stopped' ? 'stopped' : 'paused';
      job.message = 'Tiến trình đã dừng và có thể tiếp tục.';
      activity(job, `Đã dừng trước khi hoàn tất nhóm ${groupId}.`, 'warn', 'JOB_PAUSED', groupId);
      await writeJob(job);
      await clearSchedule();
      notifier();
      return;
    }

    if (failure) {
      await persistFailure(job, groupId, failure);
    } else {
      const result = {
        groupId,
        status: 'success',
        code: 'POST_ACCEPTED',
        message: outcome?.message || 'Facebook đã nhận bài đăng.',
        at: Date.now(),
        postUrl: outcome?.postUrl || '',
        postId: outcome?.postId || ''
      };
      job.results.push(result);
      job.currentIndex += 1;
      activity(job, `Nhóm ${groupId}: ${result.message}`, 'ok', result.code, groupId);
    }

    releaseLease(job);
    if (job.currentIndex >= job.groups.length) {
      await finishJob(job);
      return;
    }
    if (pauseRequested) {
      job.status = job.status === 'stopped' ? 'stopped' : 'paused';
      job.nextRunAt = null;
      job.message = 'Đã hoàn tất nhóm hiện tại và dừng trước nhóm tiếp theo.';
      activity(job, job.message, 'warn', 'JOB_PAUSED_AFTER_GROUP', groupId);
      await writeJob(job);
      await clearSchedule();
      notifier();
      return;
    }

    const delayMs = Math.max(0, Number(job.delaySeconds || 0) * 1000);
    if (delayMs > 0) {
      job.status = 'waiting';
      job.nextRunAt = Date.now() + delayMs;
      job.message = `Đang chờ trước nhóm ${job.groups[job.currentIndex]}.`;
      job.updatedAt = Date.now();
      await writeJob(job);
      await schedule(job.nextRunAt);
      notifier();
      return;
    }

    job.status = 'queued';
    job.message = `Chuẩn bị nhóm ${job.groups[job.currentIndex]}.`;
    job.updatedAt = Date.now();
    await writeJob(job);
    notifier();
  }
}

export function setQueueNotifier(callback) {
  notifier = typeof callback === 'function' ? callback : () => {};
}

export function processQueue() {
  if (runningPromise) return runningPromise;
  runningPromise = processLoop()
    .catch(async (error) => {
      console.error('[GroupPublisher] Queue error:', error);
      const job = await readJob().catch(() => null);
      if (job && ACTIVE_STATUSES.has(job.status)) {
        job.status = 'error';
        job.message = error?.message || 'Hàng đợi gặp lỗi nội bộ.';
        releaseLease(job);
        activity(job, job.message, 'error', error?.code || 'QUEUE_ERROR');
        await writeJob(job).catch(() => {});
        notifier();
      }
    })
    .finally(() => {
      runningPromise = null;
    });
  return runningPromise;
}

export async function startJob(input) {
  const previous = await readJob();
  if (previous && ACTIVE_STATUSES.has(previous.status)) {
    throw new AppError('JOB_ALREADY_RUNNING', 'Đang có một hàng đợi hoạt động. Hãy dừng hoặc xóa trước.');
  }

  const content = String(input?.content || '').trim();
  if (!content) throw new AppError('EMPTY_CONTENT', 'Nội dung bài viết đang trống.');
  if (content.length > 100000) throw new AppError('CONTENT_TOO_LONG', 'Nội dung bài viết quá dài.');
  const groups = normalizeGroupIds(input?.groups);
  if (groups.length > MAX_GROUPS) {
    throw new AppError('TOO_MANY_GROUPS', `Tối đa ${MAX_GROUPS} UID trong một hàng đợi.`);
  }
  const delaySeconds = Math.max(0, Math.min(86400, Math.round(Number(input?.delaySeconds) || 0)));
  const media = {
    kind: input?.media?.kind === 'video' ? 'video' : input?.media?.kind === 'image' ? 'image' : '',
    name: String(input?.media?.name || ''),
    type: String(input?.media?.type || ''),
    size: Number(input?.media?.size || 0)
  };
  if (!media.kind) throw new AppError('INVALID_MEDIA_KIND', 'Loại media không hợp lệ.');

  const metadata = await getMediaMetadata(input?.mediaId);
  if (!metadata?.committed) throw new AppError('MEDIA_NOT_READY', 'Media chưa được chuyển đầy đủ sang extension.');
  if (metadata.kind !== media.kind || metadata.size !== media.size) {
    throw new AppError('MEDIA_METADATA_MISMATCH', 'Thông tin media không khớp.');
  }
  const calibration = await readCalibration();
  if (!calibration?.profiles?.[media.kind]?.ready) {
    throw new AppError('PROFILE_NOT_READY', `Chưa hiệu chuẩn request ${media.kind === 'video' ? 'video' : 'ảnh'}.`);
  }

  if (previous?.mediaId && previous.mediaId !== metadata.id) {
    await deleteMedia(previous.mediaId).catch(() => {});
  }
  const job = {
    version: 1,
    id: makeId('job'),
    status: 'queued',
    content,
    groups,
    delaySeconds,
    mediaId: metadata.id,
    media,
    currentIndex: 0,
    activeGroupId: '',
    nextRunAt: null,
    results: [],
    activity: [],
    lease: null,
    message: 'Hàng đợi đã sẵn sàng.',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  activity(job, `Đã tạo hàng đợi ${groups.length} nhóm.`, 'ok', 'JOB_CREATED');
  await writeJob(job);
  await schedule(Date.now() + 100);
  notifier();
  void processQueue();
  return cleanPublicJob(job);
}

export async function pauseJob() {
  const job = await readJob();
  if (!job || !ACTIVE_STATUSES.has(job.status)) {
    throw new AppError('NO_ACTIVE_JOB', 'Không có hàng đợi đang chạy để dừng.');
  }
  job.status = 'paused';
  job.nextRunAt = null;
  job.message = 'Đang dừng tiến trình...';
  job.updatedAt = Date.now();
  await writeJob(job);
  await clearSchedule();
  currentAbortController?.abort('user');
  notifier();
  return cleanPublicJob(job);
}

export async function resumeJob() {
  const job = await readJob();
  if (!job || !['paused', 'stopped', 'error'].includes(job.status)) {
    throw new AppError('JOB_NOT_PAUSED', 'Không có hàng đợi đã dừng để tiếp tục.');
  }
  if (job.currentIndex >= job.groups.length) {
    throw new AppError('JOB_HAS_NO_REMAINING_GROUPS', 'Hàng đợi không còn nhóm nào chưa xử lý.');
  }
  const metadata = await getMediaMetadata(job.mediaId);
  if (!metadata?.committed) {
    throw new AppError('MEDIA_NOT_READY', 'Media của hàng đợi không còn trong extension.');
  }
  job.status = 'queued';
  job.nextRunAt = null;
  job.lease = null;
  job.activeGroupId = '';
  job.message = `Tiếp tục từ nhóm ${job.groups[job.currentIndex]}.`;
  job.updatedAt = Date.now();
  activity(job, 'Đã tiếp tục hàng đợi.', 'ok', 'JOB_RESUMED');
  await writeJob(job);
  await schedule(Date.now() + 100);
  notifier();
  void processQueue();
  return cleanPublicJob(job);
}

export async function clearJob() {
  const job = await readJob();
  if (!job) return null;
  currentAbortController?.abort('clear');
  await clearSchedule();
  const mediaId = job.mediaId;
  job.status = 'stopped';
  job.groups = job.groups.slice(0, job.currentIndex);
  job.activeGroupId = '';
  job.nextRunAt = null;
  job.lease = null;
  job.message = 'Hàng đợi đã được xóa.';
  job.updatedAt = Date.now();
  activity(job, 'Đã xóa các nhóm còn chờ.', 'warn', 'JOB_CLEARED');
  await writeJob(job);
  await deleteMedia(mediaId).catch(() => {});
  notifier();
  return cleanPublicJob(job);
}

export async function clearResults() {
  const job = await readJob();
  if (!job) return null;
  job.results = [];
  job.updatedAt = Date.now();
  activity(job, 'Đã xóa danh sách kết quả.', 'warn', 'RESULTS_CLEARED');
  await writeJob(job);
  notifier();
  return cleanPublicJob(job);
}

export async function recoverQueue() {
  const job = await readJob();
  await purgeExpiredMedia(7 * 24 * 60 * 60 * 1000, [job?.mediaId]).catch(() => {});
  if (!job) return null;
  if (job.status === 'running') {
    job.status = 'queued';
    job.lease = null;
    job.activeGroupId = '';
    job.message = 'Đã khôi phục hàng đợi sau khi service worker tạm nghỉ.';
    activity(job, job.message, 'warn', 'JOB_RECOVERED');
    await writeJob(job);
  }
  if (job.status === 'waiting') await schedule(job.nextRunAt || Date.now() + 100);
  if (job.status === 'queued') {
    await schedule(Date.now() + 100);
    void processQueue();
  }
  return cleanPublicJob(job);
}

export function publicJob(job) {
  return cleanPublicJob(job);
}
