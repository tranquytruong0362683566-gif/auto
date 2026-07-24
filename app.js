(function () {
  'use strict';

  if (window.__groupPublisherAppInitialized) return;
  window.__groupPublisherAppInitialized = true;

  const Bridge = window.GroupPublisherBridge;
  const $ = (id) => document.getElementById(id);
  const ui = {
    extensionStatus: $('extensionStatus'),
    facebookAccount: $('facebookAccount'),
    postContent: $('postContent'),
    contentCounter: $('contentCounter'),
    imageModeCard: $('imageModeCard'),
    videoModeCard: $('videoModeCard'),
    mediaInput: $('mediaInput'),
    mediaDropZone: $('mediaDropZone'),
    mediaEmpty: $('mediaEmpty'),
    mediaPreview: $('mediaPreview'),
    previewStage: $('previewStage'),
    mediaHint: $('mediaHint'),
    mediaName: $('mediaName'),
    mediaSize: $('mediaSize'),
    removeMediaBtn: $('removeMediaBtn'),
    groupIds: $('groupIds'),
    groupCount: $('groupCount'),
    cleanGroupBtn: $('cleanGroupBtn'),
    groupValidation: $('groupValidation'),
    delaySeconds: $('delaySeconds'),
    startBtn: $('startBtn'),
    pauseBtn: $('pauseBtn'),
    resumeBtn: $('resumeBtn'),
    clearQueueBtn: $('clearQueueBtn'),
    calibrationGroupId: $('calibrationGroupId'),
    imageCalibrationStatus: $('imageCalibrationStatus'),
    imageCalibrationMeta: $('imageCalibrationMeta'),
    videoCalibrationStatus: $('videoCalibrationStatus'),
    videoCalibrationMeta: $('videoCalibrationMeta'),
    recordImageBtn: $('recordImageBtn'),
    recordVideoBtn: $('recordVideoBtn'),
    calibrationSession: $('calibrationSession'),
    calibrationSessionTitle: $('calibrationSessionTitle'),
    calibrationMarker: $('calibrationMarker'),
    copyMarkerBtn: $('copyMarkerBtn'),
    finishCalibrationBtn: $('finishCalibrationBtn'),
    processedStat: $('processedStat'),
    successStat: $('successStat'),
    failedStat: $('failedStat'),
    jobState: $('jobState'),
    progressHeadline: $('progressHeadline'),
    currentGroup: $('currentGroup'),
    nextRunText: $('nextRunText'),
    progressRing: $('progressRing'),
    progressPercent: $('progressPercent'),
    progressBar: $('progressBar'),
    activityLog: $('activityLog'),
    resultsBody: $('resultsBody'),
    exportCsvBtn: $('exportCsvBtn'),
    exportJsonBtn: $('exportJsonBtn'),
    clearResultsBtn: $('clearResultsBtn'),
    toastHost: $('toastHost'),
    draftState: $('draftState')
  };

  const STORE = Object.freeze({
    content: 'group_publisher_content_v1',
    groups: 'group_publisher_groups_v1',
    delay: 'group_publisher_delay_v1',
    mode: 'group_publisher_mode_v1',
    calibrationGroup: 'group_publisher_calibration_group_v1'
  });

  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
  const CHUNK_BYTES = 256 * 1024;
  const POLL_MS = 1500;
  const logKeys = new Set();

  let selectedFile = null;
  let previewUrl = '';
  let lastSnapshot = null;
  let polling = false;
  let pollTimer = null;
  let countdownTimer = null;
  let uploading = false;

  function saveLocal(key, value) {
    try {
      localStorage.setItem(key, String(value ?? ''));
      ui.draftState.textContent = 'Đã lưu';
      window.clearTimeout(saveLocal.timer);
      saveLocal.timer = window.setTimeout(() => {
        ui.draftState.textContent = 'Tự động lưu';
      }, 1200);
    } catch {
      ui.draftState.textContent = 'Không lưu được';
    }
  }

  function loadLocal(key, fallback = '') {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${(value / 1024 ** 3).toFixed(2)} GB`;
  }

  function mediaMode() {
    return document.querySelector('input[name="mediaMode"]:checked')?.value === 'video'
      ? 'video'
      : 'image';
  }

  function normalizeGroupIds(raw) {
    const valid = [];
    const invalid = [];
    const duplicate = [];
    const seen = new Set();

    for (const source of String(raw || '').split(/[\n,;]+/)) {
      const value = source.trim();
      if (!value) continue;

      let candidate = value;
      const urlMatch = value.match(/facebook\.com\/groups\/(\d{5,30})/i);
      if (urlMatch) candidate = urlMatch[1];

      if (!/^\d{5,30}$/.test(candidate)) {
        invalid.push(value);
        continue;
      }
      if (seen.has(candidate)) {
        duplicate.push(candidate);
        continue;
      }
      seen.add(candidate);
      valid.push(candidate);
    }
    return { valid, invalid, duplicate };
  }

  function renderGroupValidation() {
    const groups = normalizeGroupIds(ui.groupIds.value);
    ui.groupCount.textContent = String(groups.valid.length);
    ui.groupValidation.className = 'field-note';

    if (groups.invalid.length) {
      ui.groupValidation.classList.add('error');
      ui.groupValidation.textContent = `${groups.invalid.length} dòng không phải UID nhóm dạng số.`;
    } else if (groups.duplicate.length) {
      ui.groupValidation.classList.add('error');
      ui.groupValidation.textContent = `${groups.duplicate.length} UID đang bị trùng; nhấn “Lọc trùng”.`;
    } else if (groups.valid.length) {
      ui.groupValidation.classList.add('ok');
      ui.groupValidation.textContent = `Đã nhận ${groups.valid.length} UID hợp lệ.`;
    } else {
      ui.groupValidation.textContent = 'Chỉ nhận UID nhóm dạng số, mỗi UID một dòng.';
    }
    return groups;
  }

  function setMediaMode(mode, { preserveFile = false } = {}) {
    const nextMode = mode === 'video' ? 'video' : 'image';
    const radio = document.querySelector(`input[name="mediaMode"][value="${nextMode}"]`);
    if (radio) radio.checked = true;
    ui.imageModeCard.classList.toggle('active', nextMode === 'image');
    ui.videoModeCard.classList.toggle('active', nextMode === 'video');
    ui.mediaInput.accept = nextMode === 'image'
      ? 'image/jpeg,image/png,image/webp,image/gif'
      : 'video/mp4,video/webm,video/quicktime';
    ui.mediaHint.textContent = nextMode === 'image'
      ? 'JPG, PNG, WEBP hoặc GIF — tối đa 20 MB'
      : 'MP4, WEBM hoặc MOV — tối đa 200 MB';
    saveLocal(STORE.mode, nextMode);

    if (!preserveFile && selectedFile) {
      const compatible = nextMode === 'image'
        ? selectedFile.type.startsWith('image/')
        : selectedFile.type.startsWith('video/');
      if (!compatible) clearSelectedFile();
    }
  }

  function clearSelectedFile() {
    selectedFile = null;
    ui.mediaInput.value = '';
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    ui.previewStage.replaceChildren();
    ui.mediaPreview.classList.add('hidden');
    ui.mediaEmpty.classList.remove('hidden');
  }

  function setSelectedFile(file) {
    const mode = mediaMode();
    if (!(file instanceof File)) return;

    const validType = mode === 'image' ? file.type.startsWith('image/') : file.type.startsWith('video/');
    const maxBytes = mode === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (!validType) {
      toast(`Tệp đã chọn không phải ${mode === 'image' ? 'ảnh' : 'video'}.`, 'error');
      return;
    }
    if (file.size <= 0 || file.size > maxBytes) {
      toast(`Kích thước ${mode === 'image' ? 'ảnh' : 'video'} không hợp lệ hoặc vượt giới hạn.`, 'error');
      return;
    }

    clearSelectedFile();
    selectedFile = file;
    previewUrl = URL.createObjectURL(file);

    const preview = document.createElement(mode === 'image' ? 'img' : 'video');
    preview.src = previewUrl;
    preview.alt = mode === 'image' ? 'Xem trước ảnh bài đăng' : '';
    if (mode === 'video') {
      preview.controls = true;
      preview.preload = 'metadata';
    }
    ui.previewStage.replaceChildren(preview);
    ui.mediaName.textContent = file.name;
    ui.mediaSize.textContent = `${formatBytes(file.size)} · ${file.type || 'Không rõ định dạng'}`;
    ui.mediaEmpty.classList.add('hidden');
    ui.mediaPreview.classList.remove('hidden');
  }

  function toast(message, type = '') {
    const node = document.createElement('div');
    node.className = `toast${type ? ` ${type}` : ''}`;
    node.textContent = String(message || '');
    ui.toastHost.append(node);
    window.setTimeout(() => node.remove(), 4200);
  }

  function addLog(message, type = '', key = '') {
    if (key && logKeys.has(key)) return;
    if (key) logKeys.add(key);
    const row = document.createElement('p');
    if (type) row.classList.add(type);
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const text = document.createElement('span');
    text.textContent = String(message || '');
    row.append(time, text);
    ui.activityLog.prepend(row);
    while (ui.activityLog.children.length > 80) {
      ui.activityLog.lastElementChild?.remove();
    }
  }

  function setConnectionStatus({ connected, message }) {
    ui.extensionStatus.className = `status-pill ${connected ? 'connected' : 'error'}`;
    ui.extensionStatus.lastChild.textContent = connected ? ' Extension đã kết nối' : ' Chưa có extension';
    ui.extensionStatus.title = message || '';
    if (!connected) ui.facebookAccount.textContent = 'Chưa xác định UID';
  }

  async function callExtension(action, payload = {}, options = {}) {
    if (!Bridge?.isConnected()) {
      Bridge?.discover();
      const error = new Error('Chưa phát hiện extension. Hãy cài extension rồi tải lại trang.');
      error.code = 'EXTENSION_NOT_CONNECTED';
      throw error;
    }
    return Bridge.send(action, payload, options);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const stride = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += stride) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
    }
    return btoa(binary);
  }

  async function uploadMedia(file) {
    uploading = true;
    renderButtons(lastSnapshot?.job);
    addLog(`Đang chuyển ${file.name} sang extension...`, 'warn');

    let mediaId = '';
    try {
      const begin = await callExtension('MEDIA_BEGIN', {
        name: file.name,
        type: file.type,
        size: file.size,
        kind: mediaMode(),
        chunkSize: CHUNK_BYTES
      });
      mediaId = begin.data.mediaId;
      const totalChunks = Math.ceil(file.size / CHUNK_BYTES);

      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * CHUNK_BYTES;
        const end = Math.min(file.size, start + CHUNK_BYTES);
        const buffer = await file.slice(start, end).arrayBuffer();
        await callExtension('MEDIA_CHUNK', {
          mediaId,
          index,
          data: bytesToBase64(new Uint8Array(buffer))
        }, { timeoutMs: 120000 });

        const percent = Math.round(((index + 1) / totalChunks) * 100);
        ui.progressHeadline.textContent = `Đang chuyển media ${percent}%`;
        ui.progressBar.style.width = `${percent}%`;
      }

      await callExtension('MEDIA_COMMIT', { mediaId }, { timeoutMs: 120000 });
      addLog('Extension đã nhận đủ media.', 'ok');
      return mediaId;
    } catch (error) {
      if (mediaId) {
        callExtension('MEDIA_DELETE', { mediaId }).catch(() => {});
      }
      throw error;
    } finally {
      uploading = false;
      renderButtons(lastSnapshot?.job);
    }
  }

  function calibrationForMode(calibration, mode) {
    return calibration?.profiles?.[mode] || null;
  }

  async function startJob() {
    if (uploading) return;
    const content = ui.postContent.value.trim();
    const groups = renderGroupValidation();
    const mode = mediaMode();
    const delaySeconds = Math.max(0, Math.min(86400, Math.round(Number(ui.delaySeconds.value) || 0)));

    if (!content) {
      toast('Hãy nhập văn bản bài viết.', 'error');
      ui.postContent.focus();
      return;
    }
    if (!selectedFile) {
      toast(`Hãy chọn một ${mode === 'image' ? 'ảnh' : 'video'}.`, 'error');
      return;
    }
    if (!groups.valid.length || groups.invalid.length) {
      toast('Danh sách UID nhóm chưa hợp lệ.', 'error');
      ui.groupIds.focus();
      return;
    }
    const profile = calibrationForMode(lastSnapshot?.calibration, mode);
    if (!profile?.ready) {
      toast(`Chưa hiệu chuẩn request ${mode === 'image' ? 'ảnh' : 'video'}.`, 'error');
      document.querySelector('.calibration-panel')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    try {
      const mediaId = await uploadMedia(selectedFile);
      await callExtension('START_JOB', {
        content,
        groups: groups.valid,
        delaySeconds,
        mediaId,
        media: {
          kind: mode,
          name: selectedFile.name,
          type: selectedFile.type,
          size: selectedFile.size
        }
      }, { timeoutMs: 120000 });
      addLog(`Đã tạo hàng đợi ${groups.valid.length} nhóm.`, 'ok');
      toast('Đã bắt đầu đăng lần lượt từng nhóm.', 'ok');
      await refreshState();
    } catch (error) {
      addLog(error.message || String(error), 'error');
      toast(error.message || String(error), 'error');
    }
  }

  async function pauseJob() {
    try {
      await callExtension('PAUSE_JOB');
      addLog('Đã yêu cầu dừng tiến trình.', 'warn');
      await refreshState();
    } catch (error) {
      toast(error.message || String(error), 'error');
    }
  }

  async function resumeJob() {
    try {
      await callExtension('RESUME_JOB');
      addLog('Đã tiếp tục tiến trình.', 'ok');
      await refreshState();
    } catch (error) {
      toast(error.message || String(error), 'error');
    }
  }

  async function clearQueue() {
    if (!confirm('Xóa hàng đợi hiện tại? Kết quả đã hoàn thành vẫn được giữ lại.')) return;
    try {
      await callExtension('CLEAR_JOB');
      addLog('Đã xóa hàng đợi.', 'warn');
      await refreshState();
    } catch (error) {
      toast(error.message || String(error), 'error');
    }
  }

  async function startCalibration(mode) {
    const group = normalizeGroupIds(ui.calibrationGroupId.value);
    if (group.valid.length !== 1 || group.invalid.length) {
      toast('Hãy nhập đúng một UID nhóm để đăng bài mẫu.', 'error');
      ui.calibrationGroupId.focus();
      return;
    }

    try {
      const response = await callExtension('CALIBRATION_START', {
        mode,
        groupId: group.valid[0]
      }, { timeoutMs: 120000 });
      const active = response.data.active;
      renderActiveCalibration(active);
      addLog(`Đã bắt đầu ghi mẫu ${mode === 'image' ? 'ảnh' : 'video'}.`, 'warn');
      toast('Tab Facebook đã mở. Hãy đăng bài mẫu đúng theo hướng dẫn.', 'ok');
    } catch (error) {
      addLog(error.message || String(error), 'error');
      toast(error.message || String(error), 'error');
    }
  }

  async function finishCalibration() {
    const active = lastSnapshot?.calibration?.active;
    if (!active) return;
    ui.finishCalibrationBtn.disabled = true;
    ui.finishCalibrationBtn.textContent = 'Đang phân tích request...';
    try {
      const response = await callExtension('CALIBRATION_STOP', {}, { timeoutMs: 180000 });
      const profile = response.data.profile;
      if (profile?.ready) {
        addLog(`Hiệu chuẩn ${profile.mode === 'image' ? 'ảnh' : 'video'} thành công với ${profile.stepCount} bước request.`, 'ok');
        toast('Hiệu chuẩn request thành công.', 'ok');
      } else {
        addLog(response.message || 'Mẫu request chưa đủ dữ liệu.', 'error');
        toast(response.message || 'Mẫu request chưa đủ dữ liệu.', 'error');
      }
      await refreshState();
    } catch (error) {
      addLog(error.message || String(error), 'error');
      toast(error.message || String(error), 'error');
    } finally {
      ui.finishCalibrationBtn.disabled = false;
      ui.finishCalibrationBtn.textContent = 'Đã đăng xong — hoàn tất ghi';
    }
  }

  function renderCalibrationProfile(mode, profile) {
    const status = mode === 'image' ? ui.imageCalibrationStatus : ui.videoCalibrationStatus;
    const meta = mode === 'image' ? ui.imageCalibrationMeta : ui.videoCalibrationMeta;
    const button = mode === 'image' ? ui.recordImageBtn : ui.recordVideoBtn;

    status.className = '';
    if (profile?.ready) {
      status.textContent = 'Đã sẵn sàng';
      status.classList.add('ready');
      meta.textContent = `${profile.stepCount || 0} bước · ${new Date(profile.createdAt).toLocaleString('vi-VN')}`;
      button.textContent = 'Ghi lại';
    } else if (profile) {
      status.textContent = 'Cần ghi lại';
      status.classList.add('error');
      meta.textContent = profile.message || 'Mẫu chưa đủ dữ liệu để phát lại';
      button.textContent = 'Ghi lại';
    } else {
      status.textContent = 'Chưa hiệu chuẩn';
      meta.textContent = `Cần một bài ${mode === 'image' ? 'ảnh' : 'video'} + văn bản mẫu`;
      button.textContent = mode === 'image' ? 'Ghi mẫu ảnh' : 'Ghi mẫu video';
    }
  }

  function renderActiveCalibration(active) {
    const hasActive = Boolean(active);
    ui.calibrationSession.classList.toggle('hidden', !hasActive);
    ui.recordImageBtn.disabled = hasActive;
    ui.recordVideoBtn.disabled = hasActive;
    if (!hasActive) return;
    ui.calibrationSessionTitle.textContent = `Đang ghi mẫu ${active.mode === 'image' ? 'ẢNH' : 'VIDEO'}`;
    ui.calibrationMarker.textContent = active.marker || '—';
  }

  function renderCalibration(calibration) {
    renderCalibrationProfile('image', calibrationForMode(calibration, 'image'));
    renderCalibrationProfile('video', calibrationForMode(calibration, 'video'));
    renderActiveCalibration(calibration?.active || null);
  }

  function humanJobState(status) {
    return ({
      idle: 'Sẵn sàng',
      queued: 'Đang xếp hàng',
      running: 'Đang đăng',
      waiting: 'Đang chờ',
      paused: 'Đã dừng',
      completed: 'Đã hoàn thành',
      stopped: 'Đã dừng',
      error: 'Có lỗi'
    })[status] || 'Sẵn sàng';
  }

  function renderButtons(job) {
    const status = job?.status || 'idle';
    const active = ['queued', 'running', 'waiting'].includes(status);
    const paused = ['paused', 'stopped'].includes(status) && job?.groups?.length > (job?.currentIndex || 0);
    ui.startBtn.classList.toggle('hidden', active || paused);
    ui.pauseBtn.classList.toggle('hidden', !active);
    ui.resumeBtn.classList.toggle('hidden', !paused);
    ui.startBtn.disabled = uploading;
    ui.pauseBtn.disabled = uploading;
    ui.resumeBtn.disabled = uploading;
    ui.clearQueueBtn.disabled = uploading || !job;
  }

  function renderJob(job) {
    const current = Number(job?.currentIndex) || 0;
    const total = Array.isArray(job?.groups) ? job.groups.length : 0;
    const results = Array.isArray(job?.results) ? job.results : [];
    const completed = Math.min(total, Math.max(current, results.length));
    const percent = total ? Math.round((completed / total) * 100) : 0;
    const success = results.filter((item) => item.status === 'success').length;
    const failed = results.filter((item) => item.status === 'failed').length;

    ui.processedStat.textContent = String(results.length);
    ui.successStat.textContent = String(success);
    ui.failedStat.textContent = String(failed);
    ui.jobState.textContent = humanJobState(job?.status);
    ui.jobState.className = `job-state ${job?.status || 'idle'}`;
    ui.progressRing.style.setProperty('--progress', String(percent));
    ui.progressPercent.textContent = `${percent}%`;
    ui.progressBar.style.width = `${percent}%`;
    ui.progressHeadline.textContent = total
      ? `Đã xử lý ${completed}/${total} nhóm`
      : 'Chưa có hàng đợi';
    ui.currentGroup.textContent = job?.activeGroupId || job?.groups?.[current] || '—';

    renderButtons(job);
    renderResults(results);
    renderCountdown(job);

    const activity = Array.isArray(job?.activity) ? job.activity : [];
    for (const item of activity) {
      const key = `${item.at || ''}-${item.code || ''}-${item.groupId || ''}-${item.message || ''}`;
      addLog(item.message, item.level || '', key);
    }
  }

  function renderCountdown(job) {
    window.clearInterval(countdownTimer);

    const update = () => {
      if (!job) {
        ui.nextRunText.textContent = 'Nhập dữ liệu và nhấn Đăng bài để bắt đầu.';
        return;
      }
      if (job.status === 'waiting' && job.nextRunAt) {
        const remain = Math.max(0, Math.ceil((job.nextRunAt - Date.now()) / 1000));
        ui.nextRunText.textContent = `Còn ${remain} giây trước nhóm tiếp theo.`;
      } else if (job.status === 'running') {
        ui.nextRunText.textContent = 'Extension đang gửi request Facebook.';
      } else if (job.status === 'paused' || job.status === 'stopped') {
        ui.nextRunText.textContent = 'Tiến trình đã dừng và có thể tiếp tục từ vị trí hiện tại.';
      } else if (job.status === 'completed') {
        ui.nextRunText.textContent = 'Đã xử lý hết danh sách UID nhóm.';
      } else {
        ui.nextRunText.textContent = job.message || 'Hệ thống đang chờ.';
      }
    };
    update();
    if (job?.status === 'waiting') countdownTimer = window.setInterval(update, 1000);
  }

  function renderResults(results) {
    ui.resultsBody.replaceChildren();
    if (!results.length) {
      const row = document.createElement('tr');
      row.className = 'empty-row';
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'Chưa có kết quả đăng bài.';
      row.append(cell);
      ui.resultsBody.append(row);
      return;
    }

    results.slice().reverse().forEach((result, reverseIndex) => {
      const index = results.length - reverseIndex;
      const row = document.createElement('tr');
      const number = document.createElement('td');
      const group = document.createElement('td');
      const statusCell = document.createElement('td');
      const message = document.createElement('td');
      const time = document.createElement('td');
      const status = document.createElement('span');

      number.textContent = String(index);
      group.textContent = result.groupId || '—';
      status.className = `result-status ${result.status || 'failed'}`;
      status.textContent = result.status === 'success'
        ? 'Thành công'
        : result.status === 'skipped'
          ? 'Đã bỏ qua'
          : 'Thất bại';
      statusCell.append(status);
      message.className = 'result-message';
      message.textContent = result.message || result.code || '—';
      time.textContent = result.at ? new Date(result.at).toLocaleString('vi-VN') : '—';
      row.append(number, group, statusCell, message, time);
      ui.resultsBody.append(row);
    });
  }

  async function refreshState() {
    if (polling || !Bridge?.isConnected()) return;
    polling = true;
    try {
      const response = await callExtension('GET_STATE', {}, { timeoutMs: 15000 });
      lastSnapshot = response.data || {};
      const account = lastSnapshot.account;
      ui.facebookAccount.textContent = account?.uid
        ? `UID: ${account.uid}`
        : 'Chưa đăng nhập Facebook';
      renderCalibration(lastSnapshot.calibration || {});
      renderJob(lastSnapshot.job || null);
    } catch (error) {
      if (!/not connected|receiving end|message port|không phản hồi/i.test(error.message || '')) {
        console.warn('[GroupPublisher][Web] State refresh failed:', error);
      }
    } finally {
      polling = false;
    }
  }

  function schedulePolling() {
    window.clearTimeout(pollTimer);
    const tick = async () => {
      if (!document.hidden) {
        if (Bridge?.isConnected()) await refreshState();
        else Bridge?.discover();
      }
      pollTimer = window.setTimeout(tick, POLL_MS);
    };
    pollTimer = window.setTimeout(tick, 300);
  }

  function escapeCsv(value) {
    const text = String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }

  function downloadText(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportResults(format) {
    const job = lastSnapshot?.job;
    const results = Array.isArray(job?.results) ? job.results : [];
    if (!results.length) {
      toast('Chưa có kết quả để xuất.', 'error');
      return;
    }
    const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, '');
    if (format === 'json') {
      downloadText(
        `ket-qua-dang-nhom-${stamp}.json`,
        JSON.stringify({ exportedAt: new Date().toISOString(), job }, null, 2),
        'application/json;charset=utf-8'
      );
      return;
    }
    const rows = [
      ['STT', 'UID nhóm', 'Trạng thái', 'Mã', 'Kết quả', 'Thời gian', 'URL bài đăng'],
      ...results.map((item, index) => [
        index + 1,
        item.groupId,
        item.status,
        item.code,
        item.message,
        item.at ? new Date(item.at).toISOString() : '',
        item.postUrl || ''
      ])
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`;
    downloadText(`ket-qua-dang-nhom-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
  }

  async function clearResults() {
    if (!confirm('Xóa toàn bộ kết quả đã lưu trong hàng đợi hiện tại?')) return;
    try {
      await callExtension('CLEAR_RESULTS');
      await refreshState();
      toast('Đã xóa kết quả.', 'ok');
    } catch (error) {
      toast(error.message || String(error), 'error');
    }
  }

  function wireInputs() {
    ui.postContent.value = loadLocal(STORE.content);
    ui.groupIds.value = loadLocal(STORE.groups);
    ui.delaySeconds.value = loadLocal(STORE.delay, '60');
    ui.calibrationGroupId.value = loadLocal(STORE.calibrationGroup);
    setMediaMode(loadLocal(STORE.mode, 'image'), { preserveFile: true });

    const updateContentCounter = () => {
      ui.contentCounter.textContent = `${ui.postContent.value.length.toLocaleString('vi-VN')} ký tự`;
      saveLocal(STORE.content, ui.postContent.value);
    };
    updateContentCounter();
    renderGroupValidation();

    ui.postContent.addEventListener('input', updateContentCounter);
    ui.groupIds.addEventListener('input', () => {
      saveLocal(STORE.groups, ui.groupIds.value);
      renderGroupValidation();
    });
    ui.delaySeconds.addEventListener('change', () => {
      const value = Math.max(0, Math.min(86400, Math.round(Number(ui.delaySeconds.value) || 0)));
      ui.delaySeconds.value = String(value);
      saveLocal(STORE.delay, value);
    });
    ui.calibrationGroupId.addEventListener('input', () => saveLocal(STORE.calibrationGroup, ui.calibrationGroupId.value));

    document.querySelectorAll('input[name="mediaMode"]').forEach((radio) => {
      radio.addEventListener('change', () => setMediaMode(radio.value));
    });

    ui.mediaInput.addEventListener('change', () => setSelectedFile(ui.mediaInput.files?.[0]));
    ui.removeMediaBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearSelectedFile();
    });
    ['dragenter', 'dragover'].forEach((name) => {
      ui.mediaDropZone.addEventListener(name, (event) => {
        event.preventDefault();
        ui.mediaDropZone.classList.add('dragging');
      });
    });
    ['dragleave', 'drop'].forEach((name) => {
      ui.mediaDropZone.addEventListener(name, (event) => {
        event.preventDefault();
        ui.mediaDropZone.classList.remove('dragging');
      });
    });
    ui.mediaDropZone.addEventListener('drop', (event) => setSelectedFile(event.dataTransfer?.files?.[0]));

    ui.cleanGroupBtn.addEventListener('click', () => {
      const groups = normalizeGroupIds(ui.groupIds.value);
      ui.groupIds.value = groups.valid.join('\n');
      saveLocal(STORE.groups, ui.groupIds.value);
      renderGroupValidation();
      toast(`Đã giữ ${groups.valid.length} UID không trùng.`, 'ok');
    });
  }

  function wireActions() {
    ui.startBtn.addEventListener('click', startJob);
    ui.pauseBtn.addEventListener('click', pauseJob);
    ui.resumeBtn.addEventListener('click', resumeJob);
    ui.clearQueueBtn.addEventListener('click', clearQueue);
    ui.recordImageBtn.addEventListener('click', () => startCalibration('image'));
    ui.recordVideoBtn.addEventListener('click', () => startCalibration('video'));
    ui.finishCalibrationBtn.addEventListener('click', finishCalibration);
    ui.copyMarkerBtn.addEventListener('click', async () => {
      const marker = ui.calibrationMarker.textContent;
      try {
        await navigator.clipboard.writeText(marker);
        toast('Đã sao chép đoạn đánh dấu.', 'ok');
      } catch {
        const range = document.createRange();
        range.selectNodeContents(ui.calibrationMarker);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        toast('Hãy nhấn Ctrl+C để sao chép.', '');
      }
    });
    ui.exportCsvBtn.addEventListener('click', () => exportResults('csv'));
    ui.exportJsonBtn.addEventListener('click', () => exportResults('json'));
    ui.clearResultsBtn.addEventListener('click', clearResults);
  }

  function initGrid() {
    const canvas = $('gridCanvas');
    const context = canvas?.getContext('2d');
    if (!context) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let dpr = 1;
    let pointerX = -9999;
    let pointerY = -9999;
    let frame = 0;

    function resize() {
      width = innerWidth;
      height = innerHeight;
      dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      draw();
    }

    function bend(x, y) {
      const dx = x - pointerX;
      const dy = y - pointerY;
      const distance = Math.hypot(dx, dy);
      if (distance > 190 || distance < 1) return { x, y };
      const strength = (1 - distance / 190) ** 2 * 18;
      return { x: x + (dx / distance) * strength, y: y + (dy / distance) * strength };
    }

    function line(horizontal, fixed, length) {
      context.beginPath();
      for (let value = -40; value <= length + 40; value += 10) {
        const point = bend(horizontal ? value : fixed, horizontal ? fixed : value);
        if (value === -40) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.stroke();
    }

    function draw() {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.scale(dpr, dpr);
      context.strokeStyle = 'rgba(91, 225, 156, 0.075)';
      context.lineWidth = 1;
      for (let y = -40; y <= height + 40; y += 40) line(true, y, width);
      for (let x = -40; x <= width + 40; x += 40) line(false, x, height);
    }

    function requestDraw(event) {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (reduced.matches || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    }

    resize();
    addEventListener('resize', resize, { passive: true });
    document.addEventListener('pointermove', requestDraw, { passive: true });
    document.addEventListener('pointerleave', () => {
      pointerX = -9999;
      pointerY = -9999;
      draw();
    }, { passive: true });
  }

  function init() {
    wireInputs();
    wireActions();
    initGrid();
    renderJob(null);
    renderCalibration({});
    Bridge?.onStatus((status) => {
      setConnectionStatus(status);
      if (status.connected) refreshState();
    });
    schedulePolling();
    window.addEventListener('focus', refreshState);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshState();
    });
    window.addEventListener('pagehide', () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      window.clearTimeout(pollTimer);
      window.clearInterval(countdownTimer);
    }, { once: true });
  }

  init();
}());
