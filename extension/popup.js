(function () {
  'use strict';

  const WEB_URL = 'https://tranquytruong0362683566-gif.github.io/auto/';
  const ui = {
    version: document.getElementById('version'),
    account: document.getElementById('account'),
    imageProfile: document.getElementById('imageProfile'),
    videoProfile: document.getElementById('videoProfile'),
    jobStatus: document.getElementById('jobStatus'),
    message: document.getElementById('message'),
    openWeb: document.getElementById('openWeb'),
    pauseJob: document.getElementById('pauseJob'),
    resumeJob: document.getElementById('resumeJob')
  };

  const labels = {
    idle: 'Sẵn sàng',
    queued: 'Đang xếp hàng',
    running: 'Đang đăng',
    waiting: 'Đang chờ',
    paused: 'Đã dừng',
    stopped: 'Đã dừng',
    completed: 'Hoàn thành',
    error: 'Có lỗi'
  };

  async function command(action, payload = {}) {
    const response = await chrome.runtime.sendMessage({
      type: 'POPUP_COMMAND',
      action,
      payload
    });
    if (!response?.success) throw new Error(response?.message || 'Extension không phản hồi.');
    return response.data;
  }

  function profile(node, value) {
    node.textContent = value?.ready ? 'Đã sẵn sàng' : 'Chưa có';
    node.className = value?.ready ? 'ready' : 'error';
  }

  async function refresh() {
    try {
      const state = await command('GET_STATE');
      ui.version.textContent = `Phiên bản ${state.extension?.version || '1.0.0'}`;
      ui.account.textContent = state.account?.uid ? `UID ${state.account.uid}` : 'Chưa đăng nhập';
      ui.account.className = state.account?.uid ? 'ready' : 'error';
      profile(ui.imageProfile, state.calibration?.profiles?.image);
      profile(ui.videoProfile, state.calibration?.profiles?.video);
      const status = state.job?.status || 'idle';
      ui.jobStatus.textContent = labels[status] || status;
      ui.jobStatus.className = status === 'completed' ? 'ready' : status === 'error' ? 'error' : '';
      ui.message.textContent = state.job?.message || 'Mở bảng điều khiển để tạo bài đăng.';
      ui.pauseJob.hidden = !['queued', 'running', 'waiting'].includes(status);
      ui.resumeJob.hidden = !['paused', 'stopped', 'error'].includes(status)
        || Number(state.job?.currentIndex || 0) >= Number(state.job?.groups?.length || 0);
    } catch (error) {
      ui.message.textContent = error?.message || String(error);
      ui.message.className = 'message error';
    }
  }

  ui.openWeb.addEventListener('click', () => chrome.tabs.create({ url: WEB_URL }));
  ui.pauseJob.addEventListener('click', async () => {
    try {
      await command('PAUSE_JOB');
      await refresh();
    } catch (error) {
      ui.message.textContent = error.message;
    }
  });
  ui.resumeJob.addEventListener('click', async () => {
    try {
      await command('RESUME_JOB');
      await refresh();
    } catch (error) {
      ui.message.textContent = error.message;
    }
  });

  void refresh();
}());
