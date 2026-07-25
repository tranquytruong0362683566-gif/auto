(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = 'tqt_fb_automation_settings_v1';
  const LINKS_KEY = 'tqt_fb_group_links_v1';

  const state = {
    connected: false,
    session: null,
    pages: [],
    selectedPageIds: new Set(),
    pageStatuses: new Map(),
    reelsRunning: false,
    reelsAbortController: null,
    reelsSuccess: 0,
    scanRunning: false,
    scanStopRequested: false,
    links: [],
    pageLoadPromise: null,
    lastScanProgressLogAt: 0
  };

  function formatTime(date = new Date()) {
    return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
  }

  function log(level, message) {
    const consoleBox = $('#logConsole');
    if (!consoleBox) return;
    const normalized = ['info', 'success', 'warning', 'error'].includes(level) ? level : 'info';
    const line = document.createElement('div');
    line.className = `log-line ${normalized}`;
    line.innerHTML = `<time>${formatTime()}</time><span class="level">${normalized.toUpperCase()}</span><span></span>`;
    line.lastElementChild.textContent = String(message);
    consoleBox.appendChild(line);
    while (consoleBox.children.length > 1000) consoleBox.firstElementChild.remove();
    consoleBox.scrollTop = consoleBox.scrollHeight;
  }

  function toast(message, type = 'info') {
    const container = $('#toastContainer');
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    container.appendChild(item);
    window.setTimeout(() => item.remove(), 4200);
  }

  function setRunningMetric(title, detail = '') {
    $('#metricRunning').textContent = title;
    $('#metricRunningDetail').textContent = detail || 'Chưa có tác vụ';
  }

  function setProgress(prefix, percent, text, countText) {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    $(`#${prefix}ProgressBar`).style.width = `${safePercent}%`;
    $(`#${prefix}ProgressText`).textContent = text;
    const suffix = prefix === 'reels' ? 'ProgressPercent' : 'ProgressCount';
    $(`#${prefix}${suffix}`).textContent = countText ?? `${Math.round(safePercent)}%`;
  }

  function saveSettings() {
    const settings = {
      reelsCaption: $('#reelsCaption').value,
      useFilename: $('#useFilename').checked,
      enableSchedule: $('#enableSchedule').checked,
      postsPerPage: $('#postsPerPage').value,
      reelsDelayMin: $('#reelsDelayMin').value,
      reelsDelayMax: $('#reelsDelayMax').value,
      groupInputs: $('#groupInputs').value,
      scanTargetCount: $('#scanTargetCount').value,
      scanMaxScrolls: $('#scanMaxScrolls').value,
      scanDelayMs: $('#scanDelayMs').value,
      scanStaleRounds: $('#scanStaleRounds').value,
      scanExcludePinned: $('#scanExcludePinned').checked,
      scanCloseTab: $('#scanCloseTab').checked,
      scanNewest: $('#scanNewest').checked
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function loadSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const valueFields = ['reelsCaption', 'postsPerPage', 'reelsDelayMin', 'reelsDelayMax', 'groupInputs', 'scanTargetCount', 'scanMaxScrolls', 'scanDelayMs', 'scanStaleRounds'];
      for (const id of valueFields) if (settings[id] !== undefined && $(`#${id}`)) $(`#${id}`).value = settings[id];
      const checkFields = ['useFilename', 'enableSchedule', 'scanExcludePinned', 'scanCloseTab', 'scanNewest'];
      for (const id of checkFields) if (typeof settings[id] === 'boolean' && $(`#${id}`)) $(`#${id}`).checked = settings[id];
      $('#scheduleField').classList.toggle('hidden', !$('#enableSchedule').checked);
    } catch (error) {
      log('warning', `Không đọc được cấu hình đã lưu: ${error.message}`);
    }

    try {
      const links = JSON.parse(localStorage.getItem(LINKS_KEY) || '[]');
      if (Array.isArray(links)) state.links = links.slice(0, 5000);
    } catch (_) {
      state.links = [];
    }
    renderLinks();
  }

  function setupNavigation() {
    $$('.nav-item').forEach((button) => {
      button.addEventListener('click', () => {
        $$('.nav-item').forEach((item) => item.classList.remove('active'));
        $$('.panel-page').forEach((panel) => panel.classList.remove('active'));
        button.classList.add('active');
        $(`#${button.dataset.panel}`).classList.add('active');
      });
    });
  }

  async function connectExtension(force = false) {
    const dot = $('#extensionDot');
    $('#extensionStatus').textContent = 'Đang kết nối Extension...';
    dot.className = 'status-dot';
    try {
      const pong = await window.ExtensionClient.ping();
      state.connected = true;
      $('#extensionStatus').textContent = `Extension đã kết nối · v${pong.version || '?'}`;
      dot.className = 'status-dot online';
      state.session = await window.ExtensionClient.getFacebookSession();
      const cookies = state.session?.cookies || [];
      const cUser = cookies.find((cookie) => cookie.name === 'c_user')?.value || null;
      $('#sidebarUid').textContent = cUser ? `UID: ${cUser}` : 'Chưa đăng nhập Facebook';
      $('#sidebarCookieCount').textContent = `${cookies.length} cookie`;
      $('#facebookStatus').textContent = cUser ? `Facebook UID: ${cUser}` : 'Facebook: chưa đăng nhập';
      if (force) window.FacebookAPI.clearCredentialCache();
      log('success', `Đã kết nối Extension. ${cUser ? `UID Facebook: ${cUser}` : 'Chưa có c_user.'}`);
      return true;
    } catch (error) {
      state.connected = false;
      state.session = null;
      dot.className = 'status-dot offline';
      $('#extensionStatus').textContent = 'Không tìm thấy Extension';
      $('#facebookStatus').textContent = 'Cài Extension và tải lại trang';
      $('#sidebarUid').textContent = 'Chưa kết nối';
      $('#sidebarCookieCount').textContent = '0 cookie';
      log('error', `Kết nối Extension thất bại: ${error.message}`);
      if (force) toast('Không kết nối được Extension. Hãy kiểm tra extension đã bật và đúng URL GitHub Pages.', 'error');
      return false;
    }
  }

  function mergePages(pages) {
    const map = new Map(state.pages.map((page) => [String(page.id), page]));
    for (const page of pages) {
      const id = String(page.id);
      map.set(id, { ...(map.get(id) || {}), ...page, id });
    }
    state.pages = [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi', { sensitivity: 'base' }));
    $('#metricPages').textContent = String(state.pages.length);
  }

  function renderPages() {
    const body = $('#pagesTableBody');
    const query = $('#pageSearch').value.trim().toLowerCase();
    const pages = state.pages.filter((page) => !query || `${page.name} ${page.id}`.toLowerCase().includes(query));
    body.innerHTML = '';

    if (!pages.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-cell">Không có Page phù hợp</td></tr>';
      updateSelectedPagesCount();
      return;
    }

    for (const page of pages) {
      const row = document.createElement('tr');
      row.dataset.pageId = page.id;
      const status = state.pageStatuses.get(page.id) || { text: 'Sẵn sàng', type: '' };
      row.innerHTML = `
        <td class="check-cell"><input class="page-checkbox" type="checkbox" value="${page.id}"></td>
        <td>
          <div class="page-cell">
            <img class="page-avatar" alt="" src="${page.avatar || `https://graph.facebook.com/${page.id}/picture?type=normal`}">
            <span class="page-name"><strong></strong><small>${page.source === 'manual' ? 'ID thủ công' : 'Facebook Page'}</small></span>
          </div>
        </td>
        <td>${page.id}</td>
        <td><span class="row-status ${status.type}"></span></td>`;
      row.querySelector('.page-name strong').textContent = page.name || `Page ${page.id}`;
      row.querySelector('.row-status').textContent = status.text;
      const checkbox = row.querySelector('.page-checkbox');
      checkbox.checked = state.selectedPageIds.has(page.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selectedPageIds.add(page.id);
        else state.selectedPageIds.delete(page.id);
        updateSelectedPagesCount();
      });
      row.querySelector('.page-avatar').addEventListener('error', (event) => {
        event.currentTarget.src = './extension/icons/icon48.png';
      }, { once: true });
      body.appendChild(row);
    }
    updateSelectedPagesCount();
  }

  function updateSelectedPagesCount() {
    $('#selectedPagesCount').textContent = `${state.selectedPageIds.size} đã chọn`;
    const visibleCheckboxes = $$('.page-checkbox');
    $('#pageMasterCheckbox').checked = visibleCheckboxes.length > 0 && visibleCheckboxes.every((box) => box.checked);
  }

  function updatePageStatus(pageId, text, type = '') {
    state.pageStatuses.set(String(pageId), { text, type });
    const row = $(`tr[data-page-id="${CSS.escape(String(pageId))}"]`);
    const target = row?.querySelector('.row-status');
    if (target) {
      target.textContent = text;
      target.className = `row-status ${type}`;
    }
  }

  async function loadPages() {
    if (state.pageLoadPromise) return state.pageLoadPromise;
    state.pageLoadPromise = (async () => {
      if (!state.connected && !(await connectExtension(true))) return;
      const buttons = [$('#btnLoadPages'), $('#btnLoadPagesTop')];
      buttons.forEach((button) => { button.disabled = true; button.textContent = 'Đang tải Page...'; });
      log('info', 'Đang lấy cookie, fb_dtsg và danh sách Page...');
      setRunningMetric('Đang tải', 'Danh sách Facebook Page');
      try {
        const result = await window.FacebookAPI.fetchPages({
          forceCredential: true,
          onBatch: ({ batch, total, received }) => log('info', `Page batch ${batch}: nhận ${received}, tổng ${total}`)
        });
        mergePages(result.pages);
        renderPages();
        const uid = result.credential.uid;
        $('#facebookStatus').textContent = `Facebook UID: ${uid}`;
        $('#sidebarUid').textContent = `UID: ${uid}`;
        log('success', `Đã tải ${result.pages.length} Page.`);
        toast(`Đã tải ${result.pages.length} Page`, 'success');
      } catch (error) {
        log('error', `Tải danh sách Page thất bại: ${error.message}`);
        toast(error.message, 'error');
      } finally {
        setRunningMetric('Rảnh', 'Chưa có tác vụ');
        buttons.forEach((button) => { button.disabled = false; button.textContent = button.id === 'btnLoadPagesTop' ? 'Tải danh sách Page' : 'Tải lại Page'; });
        state.pageLoadPromise = null;
      }
    })();
    return state.pageLoadPromise;
  }

  function addManualPages() {
    const ids = $('#manualPageIds').value.match(/\d{5,}/g) || [];
    if (!ids.length) {
      toast('Không tìm thấy Page ID hợp lệ', 'error');
      return;
    }
    mergePages([...new Set(ids)].map((id) => ({ id, name: `Page ${id}`, avatar: '', iUser: null, source: 'manual' })));
    $('#manualPageIds').value = '';
    renderPages();
    log('success', `Đã thêm ${ids.length} Page ID thủ công.`);
  }

  function getSelectedPages() {
    return state.pages.filter((page) => state.selectedPageIds.has(String(page.id)));
  }

  async function startReels() {
    if (state.reelsRunning) return;
    if (!state.connected && !(await connectExtension(true))) return;

    const pages = getSelectedPages();
    const files = [...$('#reelsFiles').files];
    if (!pages.length) return toast('Hãy chọn ít nhất một Page', 'error');
    if (!files.length) return toast('Hãy chọn ít nhất một video', 'error');

    const postsPerPage = Math.max(1, Math.min(100, Number($('#postsPerPage').value) || 1));
    let delayMin = Math.max(0, Number($('#reelsDelayMin').value) || 0);
    let delayMax = Math.max(0, Number($('#reelsDelayMax').value) || 0);
    if (delayMax < delayMin) [delayMin, delayMax] = [delayMax, delayMin];
    const scheduleEnabled = $('#enableSchedule').checked;
    const scheduleDate = $('#scheduleDateTime').value ? new Date($('#scheduleDateTime').value) : null;
    if (scheduleEnabled && (!scheduleDate || Number.isNaN(scheduleDate.getTime()))) return toast('Hãy nhập thời gian đăng theo lịch', 'error');

    saveSettings();
    state.reelsRunning = true;
    state.reelsAbortController = new AbortController();
    $('#btnStartReels').disabled = true;
    $('#btnStopReels').disabled = false;
    setRunningMetric('Đang chạy', 'Đăng Reels Page');

    const jobs = [];
    let fileIndex = 0;
    for (const page of pages) {
      for (let index = 0; index < postsPerPage; index += 1) {
        jobs.push({ page, file: files[fileIndex % files.length], indexOnPage: index });
        fileIndex += 1;
      }
    }

    let completed = 0;
    let success = 0;
    let failed = 0;
    const total = jobs.length;
    log('info', `Bắt đầu ${total} tác vụ Reel trên ${pages.length} Page.`);

    try {
      for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
        const { page, file } = jobs[jobIndex];
        if (state.reelsAbortController.signal.aborted) throw new DOMException('Đã dừng bởi người dùng', 'AbortError');
        const caption = window.ReelsService.buildCaption($('#reelsCaption').value, file, $('#useFilename').checked);
        const scheduledPublishTime = scheduleEnabled
          ? Math.floor((scheduleDate.getTime() + jobIndex * Math.max(delayMax, 60) * 1000) / 1000)
          : null;

        updatePageStatus(page.id, `Đang tải ${file.name}`, 'running');
        log('info', `[${jobIndex + 1}/${total}] Page ${page.name} · ${file.name}`);
        try {
          const result = await window.ReelsService.uploadAndPublish({
            page,
            file,
            caption,
            scheduledPublishTime,
            signal: state.reelsAbortController.signal,
            onProgress: ({ loaded, total: fileTotal, message }) => {
              const filePercent = fileTotal ? loaded / fileTotal : 0;
              const overall = ((completed + Math.min(filePercent, 0.98)) / total) * 100;
              setProgress('reels', overall, `${page.name}: ${message}`, `${Math.floor(overall)}%`);
              updatePageStatus(page.id, message, 'running');
            }
          });
          success += 1;
          state.reelsSuccess += 1;
          $('#metricReelsSuccess').textContent = String(state.reelsSuccess);
          updatePageStatus(page.id, `Thành công · ${result.postId}`, 'success');
          log('success', `Page ${page.name}: đăng Reel thành công. Post ID: ${result.postId}`);
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          failed += 1;
          updatePageStatus(page.id, `Lỗi: ${error.message}`, 'error');
          log('error', `Page ${page.name}: ${error.message}`);
        }

        completed += 1;
        const percent = (completed / total) * 100;
        setProgress('reels', percent, `Đã xử lý ${completed}/${total}`, `${Math.round(percent)}%`);

        if (completed < total && !state.reelsAbortController.signal.aborted) {
          const delaySeconds = delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));
          if (delaySeconds > 0) {
            log('info', `Chờ ${delaySeconds} giây trước tác vụ tiếp theo.`);
            for (let remaining = delaySeconds; remaining > 0; remaining -= 1) {
              if (state.reelsAbortController.signal.aborted) throw new DOMException('Đã dừng bởi người dùng', 'AbortError');
              setProgress('reels', percent, `Chờ ${remaining} giây...`, `${Math.round(percent)}%`);
              await window.FacebookAPI.sleep(1000);
            }
          }
        }
      }
      log('success', `Hoàn tất Reels: ${success} thành công, ${failed} lỗi.`);
      toast(`Hoàn tất: ${success} thành công, ${failed} lỗi`, failed ? 'info' : 'success');
    } catch (error) {
      if (error.name === 'AbortError') {
        log('warning', 'Tiến trình đăng Reels đã dừng.');
        toast('Đã dừng tiến trình Reels');
      } else {
        log('error', `Tiến trình Reels dừng do lỗi: ${error.message}`);
        toast(error.message, 'error');
      }
    } finally {
      state.reelsRunning = false;
      state.reelsAbortController = null;
      $('#btnStartReels').disabled = false;
      $('#btnStopReels').disabled = true;
      setRunningMetric('Rảnh', 'Chưa có tác vụ');
    }
  }

  function stopReels() {
    state.reelsAbortController?.abort();
    $('#btnStopReels').disabled = true;
  }

  function parseGroupId(value) {
    const text = String(value || '').trim();
    if (/^\d{5,}$/.test(text)) return text;
    return text.match(/facebook\.com\/groups\/(\d+)/i)?.[1] || text.match(/groups\/(\d+)/i)?.[1] || null;
  }

  function addScanResults(posts) {
    const map = new Map(state.links.map((item) => [`${item.groupId}:${item.postId}`, item]));
    for (const post of posts || []) {
      if (!post?.groupId || !post?.postId || !post?.url) continue;
      map.set(`${post.groupId}:${post.postId}`, {
        groupId: String(post.groupId),
        postId: String(post.postId),
        url: String(post.url),
        scannedAt: post.scannedAt || new Date().toISOString()
      });
    }
    state.links = [...map.values()].slice(-5000);
    localStorage.setItem(LINKS_KEY, JSON.stringify(state.links));
    renderLinks();
  }

  function renderLinks() {
    const body = $('#linksTableBody');
    if (!body) return;
    body.innerHTML = '';
    if (!state.links.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-cell">Chưa có kết quả</td></tr>';
    } else {
      state.links.forEach((item, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${index + 1}</td><td>${item.groupId}</td><td>${item.postId}</td><td class="link-cell"><a target="_blank" rel="noreferrer"></a></td>`;
        const anchor = row.querySelector('a');
        anchor.href = item.url;
        anchor.textContent = item.url;
        body.appendChild(row);
      });
    }
    $('#metricLinks').textContent = String(state.links.length);
    $('#scanProgressCount').textContent = `${state.links.length} link`;
  }

  async function startScan() {
    if (state.scanRunning) return;
    if (!state.connected && !(await connectExtension(true))) return;

    const groups = [...new Set($('#groupInputs').value.split(/\r?\n/).map(parseGroupId).filter(Boolean))];
    if (!groups.length) return toast('Không tìm thấy Group ID hợp lệ', 'error');

    const options = {
      targetCount: Math.max(1, Math.min(1000, Number($('#scanTargetCount').value) || 20)),
      maxScrolls: Math.max(1, Math.min(200, Number($('#scanMaxScrolls').value) || 35)),
      delayMs: Math.max(500, Math.min(10_000, Number($('#scanDelayMs').value) || 1800)),
      staleRounds: Math.max(2, Math.min(20, Number($('#scanStaleRounds').value) || 5)),
      excludePinned: $('#scanExcludePinned').checked,
      closeTab: $('#scanCloseTab').checked,
      newest: $('#scanNewest').checked
    };

    saveSettings();
    state.scanRunning = true;
    state.scanStopRequested = false;
    $('#btnStartScan').disabled = true;
    $('#btnStopScan').disabled = false;
    setRunningMetric('Đang chạy', 'Quét link bài viết nhóm');
    log('info', `Bắt đầu quét ${groups.length} nhóm, tối đa ${options.targetCount} link mỗi nhóm.`);

    let processed = 0;
    let totalNew = 0;
    try {
      for (const groupId of groups) {
        if (state.scanStopRequested) break;
        const groupPercent = (processed / groups.length) * 100;
        setProgress('scan', groupPercent, `Đang mở nhóm ${groupId}`, `${state.links.length} link`);
        log('info', `Mở nhóm ${groupId} để quét bài viết.`);

        try {
          const result = await window.ExtensionClient.startGroupScan({ groupId, ...options });
          const before = state.links.length;
          addScanResults(result.posts || []);
          const added = state.links.length - before;
          totalNew += Math.max(0, added);
          log('success', `Nhóm ${groupId}: thu ${result.posts?.length || 0} link, thêm mới ${Math.max(0, added)}.`);
        } catch (error) {
          if (state.scanStopRequested || error.code === 'SCAN_STOPPED') {
            log('warning', `Đã dừng quét nhóm ${groupId}.`);
            break;
          }
          log('error', `Nhóm ${groupId}: ${error.message}`);
        }
        processed += 1;
        setProgress('scan', (processed / groups.length) * 100, `Đã quét ${processed}/${groups.length} nhóm`, `${state.links.length} link`);
      }

      if (!state.scanStopRequested) {
        log('success', `Hoàn tất quét nhóm. Thêm mới ${totalNew} link.`);
        toast(`Đã thêm ${totalNew} link mới`, 'success');
      }
    } finally {
      state.scanRunning = false;
      state.scanStopRequested = false;
      $('#btnStartScan').disabled = false;
      $('#btnStopScan').disabled = true;
      setRunningMetric('Rảnh', 'Chưa có tác vụ');
    }
  }

  async function stopScan() {
    if (!state.scanRunning) return;
    state.scanStopRequested = true;
    $('#btnStopScan').disabled = true;
    setProgress('scan', 0, 'Đang dừng tiến trình...', `${state.links.length} link`);
    try {
      await window.ExtensionClient.stopGroupScan();
    } catch (error) {
      log('warning', `Gửi lệnh dừng quét thất bại: ${error.message}`);
    }
  }

  function copyLinks() {
    const text = state.links.map((item) => item.url).join('\n');
    if (!text) return toast('Chưa có link để sao chép', 'error');
    navigator.clipboard.writeText(text).then(() => toast(`Đã sao chép ${state.links.length} link`, 'success')).catch((error) => toast(error.message, 'error'));
  }

  function exportLinks() {
    if (!state.links.length) return toast('Chưa có dữ liệu để xuất', 'error');
    const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [['STT', 'GROUP_ID', 'POST_ID', 'URL', 'SCANNED_AT']];
    state.links.forEach((item, index) => rows.push([index + 1, item.groupId, item.postId, item.url, item.scannedAt || '']));
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `facebook_group_links_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function bindEvents() {
    $('#btnReconnect').addEventListener('click', () => connectExtension(true));
    $('#btnLoadPages').addEventListener('click', loadPages);
    $('#btnLoadPagesTop').addEventListener('click', loadPages);
    $('#btnAddManualPages').addEventListener('click', addManualPages);
    $('#pageSearch').addEventListener('input', renderPages);
    $('#pageMasterCheckbox').addEventListener('change', (event) => {
      $$('.page-checkbox').forEach((checkbox) => {
        checkbox.checked = event.target.checked;
        if (checkbox.checked) state.selectedPageIds.add(checkbox.value);
        else state.selectedPageIds.delete(checkbox.value);
      });
      updateSelectedPagesCount();
    });
    $('#btnSelectAllPages').addEventListener('click', () => {
      const shouldSelect = state.selectedPageIds.size !== state.pages.length;
      state.selectedPageIds.clear();
      if (shouldSelect) state.pages.forEach((page) => state.selectedPageIds.add(page.id));
      renderPages();
    });
    $('#reelsFiles').addEventListener('change', (event) => {
      const files = [...event.target.files];
      $('#reelsFileLabel').textContent = files.length ? `${files.length} video · ${files.map((file) => file.name).join(', ')}` : 'Chưa chọn video';
    });
    $('#enableSchedule').addEventListener('change', () => {
      $('#scheduleField').classList.toggle('hidden', !$('#enableSchedule').checked);
      saveSettings();
    });
    $('#btnStartReels').addEventListener('click', startReels);
    $('#btnStopReels').addEventListener('click', stopReels);
    $('#btnStartScan').addEventListener('click', startScan);
    $('#btnStopScan').addEventListener('click', stopScan);
    $('#btnCopyLinks').addEventListener('click', copyLinks);
    $('#btnExportLinks').addEventListener('click', exportLinks);
    $('#btnClearLinks').addEventListener('click', () => {
      state.links = [];
      localStorage.removeItem(LINKS_KEY);
      renderLinks();
      setProgress('scan', 0, 'Sẵn sàng', '0 link');
    });
    $('#btnClearLogs').addEventListener('click', () => { $('#logConsole').innerHTML = ''; });
    $$('input, textarea').forEach((element) => element.addEventListener('change', saveSettings));

    window.ExtensionClient.on('GROUP_SCAN_PROGRESS', (data) => {
      if (!state.scanRunning || !data) return;
      const percent = data.targetCount ? Math.min(99, (data.found / data.targetCount) * 100) : 0;
      setProgress('scan', percent, `Nhóm ${data.groupId}: ${data.message || `đã tìm ${data.found} link`}`, `${state.links.length + (data.found || 0)} link`);
      if (Date.now() - state.lastScanProgressLogAt > 5000) {
        state.lastScanProgressLogAt = Date.now();
        log('info', `Nhóm ${data.groupId}: vòng ${data.scrollRound || 0}, tìm ${data.found || 0}/${data.targetCount || 0} link.`);
      }
    });
  }

  async function init() {
    setupNavigation();
    loadSettings();
    bindEvents();
    setProgress('reels', 0, 'Sẵn sàng', '0%');
    setProgress('scan', 0, 'Sẵn sàng', `${state.links.length} link`);
    $('#metricReelsSuccess').textContent = '0';
    await connectExtension(false);
  }

  window.AppLog = log;
  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
