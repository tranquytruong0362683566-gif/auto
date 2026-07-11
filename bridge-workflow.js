(function () {
  'use strict';

  const S = window.fbBridgeShared;
  const API = window.fbBridgeApi;
  const B = S.B;

  function scanModeLabel(mode) {
    return ({
      group_latest: 'Bài viết mới',
      group_top: 'Bài viết Top',
      groups_feed: 'Bản Tin Nhóm',
      home_feed: 'Bài Viết Trang Chủ'
    })[mode] || 'Bài viết mới';
  }

  function scanModeNeedsGroups(mode) {
    return mode === 'group_latest' || mode === 'group_top';
  }

  function isNextCommentResult(value) {
    return /^\(?\s*next\s*\)?[.!]?$/i.test(String(value || '').trim());
  }

  async function updateExtensionJob(link, state, patch = {}) {
    try {
      return await API.sendBridge(['UPDATE_AUTOMATION_JOB'], { url: link, link, state, patch });
    } catch {
      return null;
    }
  }

  async function setExtensionLoopState(running) {
    return API.sendBridge([running ? 'START_AUTOMATION' : 'STOP_AUTOMATION'], {});
  }

  async function getExtensionState() {
    const response = await API.sendBridge(['GET_AUTOMATION_STATE'], {});
    return API.bridgeResponseData(response)?.state || response?.state || null;
  }

  async function scanGroupLinks() {
    const scanMode = S.getScanSourceMode();
    const needsGroups = scanModeNeedsGroups(scanMode);
    const rawGroups = S.text(B.fbGroupIdInput?.value);
    if (needsGroups && !rawGroups) {
      S.setBridgeStatus('Chưa nhập UID hoặc link nhóm Facebook.', 'warn');
      B.fbGroupIdInput?.focus();
      return [];
    }

    const modeLabel = scanModeLabel(scanMode);
    S.setBridgeStatus(`Đang quét ${modeLabel} bằng permalink trực tiếp trong DOM, không click nút Bình luận...`, 'warn');
    const response = await API.sendBridge(
      ['SCAN_GROUP_PERMALINKS', 'SCAN_GROUP_LINKS', 'scanGroupLinks', 'SCAN_GROUP', 'scan_links', 'SCAN_LINKS'],
      {
        groupIds: rawGroups,
        groups: rawGroups,
        raw: rawGroups,
        limit: S.getGroupLimit(),
        limitPerGroup: S.getGroupLimit(),
        scanMode,
        sourceMode: scanMode,
        pageReadyTimeoutMs: S.getPageReadyTimeoutMs(),
        maxRounds: 35,
        loadDelay: 1600,
        skipPinned: true,
        closeAfter: false,
        openInBackground: true,
        active: false
      }
    );

    const allLinks = S.uniqueLinks(API.extractLinksFromResponse(response));
    const links = S.filterNewLinks(allLinks);
    S.setPostLinks(links);

    if (links.length) {
      S.setBridgeStatus(`Đã lấy ${links.length} link mới từ ${modeLabel}. Không phát sinh click dò hoặc modal do quét.`, 'ok');
    } else if (allLinks.length) {
      S.setBridgeStatus(`Quét được ${allLinks.length} link nhưng tất cả đã xử lý. Vòng lặp sẽ nghỉ rồi quét tiếp, không dừng.`, 'warn');
    } else {
      const reports = API.bridgeResponseData(response)?.reports || response?.reports || [];
      const error = reports.find(item => item.error)?.error || API.bridgeResponseData(response)?.error || response?.error || '';
      S.setBridgeStatus(`Chưa lấy được permalink mới từ ${modeLabel}.${error ? `\n${error}` : ''}`, 'warn');
    }
    return links;
  }

  async function readFirstFacebookPost() {
    const link = S.getPostLinks()[0];
    if (!link) {
      S.setBridgeStatus('Chưa có link bài viết Facebook để đọc.', 'warn');
      B.fbPostLinkInput?.focus();
      return '';
    }

    S.setBridgeStatus('Đang đọc nội dung trực tiếp từ DOM Facebook; Rakko chỉ dùng dự phòng...', 'warn');
    const response = await API.sendBridge(
      ['READ_FB_POST_TITLE', 'READ_FB_POST', 'READ_FACEBOOK_POST', 'readFbPost', 'readFacebookPost', 'READ_POST'],
      {
        url: link,
        link,
        pageReadyTimeoutMs: S.getPageReadyTimeoutMs(),
        maxChars: 20000,
        keepOpen: true,
        closeAfter: false
      }
    );

    const data = API.bridgeResponseData(response);
    S.setActiveReadTab(Number(data.tabId || response.tabId || 0) || null, link);
    const article = API.extractArticleFromResponse(response);
    if (!article) throw new Error('Extension chưa trả về nội dung bài viết.');

    if (B.articleInput) {
      B.articleInput.value = article;
      B.articleInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    S.setBridgeStatus(`Đã đọc nội dung bài viết từ ${data.source || response.source || 'Facebook DOM'}.`, 'ok');
    return article;
  }

  async function commentToFacebook(link, comment) {
    if (!comment) throw new Error('Chưa có nội dung bình luận.');
    if (isNextCommentResult(comment)) return { ok: true, skipped: true, reason: 'next' };

    S.setBridgeStatus('Đang nhập đúng một lần, gửi và xác minh bình luận trong DOM Facebook...', 'warn');
    const response = await API.sendBridge(
      ['COMMENT_IN_FB_TAB', 'COMMENT_FB_POST', 'COMMENT_FACEBOOK_POST', 'commentFbPost', 'commentFacebookPost', 'COMMENT_POST'],
      {
        url: link,
        link,
        comment,
        text: comment,
        commentText: comment,
        pageReadyTimeoutMs: S.getPageReadyTimeoutMs(),
        editorTimeoutMs: S.getEditorTimeoutMs(),
        verifyTimeoutMs: S.getVerifyTimeoutMs(),
        maxRetries: S.getMaxRetries(),
        closeAfterComment: Boolean(B.closeAfterComment?.checked),
        closeAfter: Boolean(B.closeAfterComment?.checked),
        submit: true
      }
    );

    const data = API.bridgeResponseData(response);
    if (data.verified !== true && response.verified !== true && !data.alreadyProcessed && !response.alreadyProcessed) {
      const error = new Error(data.error || response.error || 'Facebook chưa xác minh bình luận đã xuất hiện.');
      error.code = data.errorCode || response.errorCode || 'POST_NOT_VERIFIED';
      throw error;
    }
    S.clearActiveReadTab();
    S.setBridgeStatus(data.alreadyProcessed || response.alreadyProcessed
      ? 'Bình luận này đã được xác minh trước đó, không gửi trùng.'
      : 'Đã gửi và xác minh bình luận xuất hiện trên Facebook.', 'ok');
    return response;
  }

  async function waitAfterLink(done, total) {
    const seconds = S.getLinkPauseSeconds();
    if (seconds <= 0) return;
    const endAt = Date.now() + seconds * 1000;
    while (S.isClosedLoopRunning() && Date.now() < endAt) {
      const remain = Math.ceil((endAt - Date.now()) / 1000);
      S.setBridgeStatus(`Đã xử lý ${done}/${total}. Nghỉ ${remain} giây trước link tiếp theo...`, 'warn');
      await S.delay(Math.min(1000, Math.max(50, endAt - Date.now())));
    }
  }

  async function autoWorkflow({ manageLoopState = true } = {}) {
    const queue = [...S.getPostLinks()];
    if (!queue.length) {
      S.setBridgeStatus('Chưa có link bài viết. Hãy quét nhóm hoặc dán link trước.', 'warn');
      return { completed: [], skipped: [], failed: [] };
    }

    if (manageLoopState) {
      S.setClosedLoopRunning(true);
      B.stopClosedLoopBtn?.classList.remove('hidden');
      await setExtensionLoopState(true);
    }

    const completed = [];
    const skipped = [];
    const failed = [];

    try {
      for (let index = 0; index < queue.length; index += 1) {
        if (!S.isClosedLoopRunning()) break;
        const link = queue[index];
        const remaining = queue.slice(index + 1);
        S.setPostLinks([link, ...remaining, ...failed.map(item => item.link)]);

        try {
          S.setBridgeStatus(`Đang xử lý link ${index + 1}/${queue.length}...`, 'warn');
          await updateExtensionJob(link, 'READING');
          await readFirstFacebookPost();

          const controller = window.chatGPTApiController || {};
          if (!controller.generateComment) throw new Error('Chưa nạp được hàm gọi API ChatGPT.');
          const comment = await controller.generateComment({ throwOnError: true });
          if (!comment) throw new Error('AI không trả về bình luận hợp lệ.');

          if (isNextCommentResult(comment) || controller.isNextResult?.(comment)) {
            await updateExtensionJob(link, 'SKIPPED_NEXT', { completedAt: Date.now() });
            S.saveSkippedLink(link);
            skipped.push(link);
            S.setPostLinks([...remaining, ...failed.map(item => item.link)]);
            S.setBridgeStatus(`Link ${index + 1}/${queue.length}: AI trả về (next), đã ghi riêng trạng thái bỏ qua.`, 'warn');
          } else if (B.autoCommentAfterGenerate?.checked !== false) {
            await updateExtensionJob(link, 'READY_TO_COMMENT');
            await commentToFacebook(link, comment);
            S.saveCommentedLink(link);
            completed.push(link);
            S.setPostLinks([...remaining, ...failed.map(item => item.link)]);
          } else {
            failed.push({ link, error: 'Đã tạo nội dung nhưng chế độ tự gửi đang tắt.' });
            S.setPostLinks([...remaining, ...failed.map(item => item.link)]);
            S.setBridgeStatus('Đã tạo bình luận nhưng chưa gửi vì chế độ tự gửi đang tắt.', 'warn');
          }
        } catch (error) {
          const errorCode = error.code || error.response?.errorCode || 'WEB_WORKFLOW_ERROR';
          await updateExtensionJob(link, 'RETRY', {
            lastErrorCode: errorCode,
            lastError: error.message || String(error),
            nextRetryAt: Date.now() + 60000
          });
          failed.push({ link, error: error.message || String(error), errorCode });
          S.setPostLinks([...remaining, ...failed.map(item => item.link)]);
          S.setBridgeStatus(`Link ${index + 1}/${queue.length} chưa hoàn tất và được giữ lại để thử lại.\n${error.message || error}`, 'error');
        }

        if (index < queue.length - 1 && S.isClosedLoopRunning()) await waitAfterLink(index + 1, queue.length);
      }
    } finally {
      if (failed.length) S.setPostLinks(failed.map(item => item.link));
      if (manageLoopState) {
        S.setClosedLoopRunning(false);
        B.stopClosedLoopBtn?.classList.add('hidden');
        await setExtensionLoopState(false).catch(() => {});
      }
    }

    if (!failed.length && !S.getPostLinks().length) {
      S.setBridgeStatus(`Đã xử lý xong: ${completed.length} bình luận được xác minh, ${skipped.length} bài next.`, 'ok');
    }
    return { completed, skipped, failed };
  }

  async function waitBeforeNextGroupScan(cycleIndex) {
    const seconds = S.getLoopPauseSeconds();
    const response = await API.sendBridge(['SCHEDULE_RESCAN'], { seconds });
    const nextScanAt = Number(API.bridgeResponseData(response)?.nextScanAt || response.nextScanAt || Date.now());
    if (seconds <= 0) {
      S.setBridgeStatus(`Vòng ${cycleIndex} đã xong. Quét tiếp ngay...`, 'warn');
      await S.delay(500);
      return;
    }

    while (S.isClosedLoopRunning() && Date.now() < nextScanAt) {
      const remainSeconds = Math.ceil((nextScanAt - Date.now()) / 1000);
      S.setBridgeStatus(`Vòng ${cycleIndex} đã xong. Alarm đã lưu lịch; còn ${remainSeconds} giây sẽ quét tiếp...`, 'warn');
      await S.delay(Math.min(1000, Math.max(50, nextScanAt - Date.now())));
    }
  }

  async function runClosedGroupLoop() {
    if (S.isClosedLoopRunning()) return;
    S.setClosedLoopRunning(true);
    B.stopClosedLoopBtn?.classList.remove('hidden');
    await setExtensionLoopState(true);
    let cycleIndex = 1;

    try {
      while (S.isClosedLoopRunning()) {
        S.setBridgeStatus(`Đang chạy vòng ${cycleIndex}...`, 'warn');
        const links = await scanGroupLinks();
        if (!S.isClosedLoopRunning()) break;
        if (links.length) await autoWorkflow({ manageLoopState: false });
        if (!S.isClosedLoopRunning()) break;
        await waitBeforeNextGroupScan(cycleIndex);
        cycleIndex += 1;
      }
    } finally {
      S.setClosedLoopRunning(false);
      B.stopClosedLoopBtn?.classList.add('hidden');
      await setExtensionLoopState(false).catch(() => {});
      S.setBridgeStatus('Vòng lặp đã dừng.', 'warn');
    }
  }

  async function stopLoop() {
    S.setClosedLoopRunning(false);
    B.stopClosedLoopBtn?.classList.add('hidden');
    await setExtensionLoopState(false).catch(() => {});
    S.setBridgeStatus('Đã yêu cầu dừng. Tác vụ Facebook hiện tại sẽ kết thúc an toàn rồi dừng vòng.', 'warn');
  }

  async function runBridgeTask(task) {
    if (S.isBridgeBusy()) {
      S.setBridgeStatus('Đang có tác vụ chạy. Hãy dừng hoặc chờ tác vụ hiện tại hoàn tất.', 'warn');
      return;
    }
    S.setBridgeBusy(true);
    [B.scanGroupLinksBtn, B.autoWorkflowBtn].forEach(button => { if (button) button.disabled = true; });
    try {
      return await task();
    } finally {
      S.setBridgeBusy(false);
      [B.scanGroupLinksBtn, B.autoWorkflowBtn].forEach(button => { if (button) button.disabled = false; });
    }
  }

  async function syncBridgeStatus() {
    if (!S.getExtensionId() || !S.getBridgeToken()) return;
    try {
      const ping = await API.sendBridge(['PING_BRIDGE'], {});
      const state = await getExtensionState();
      S.setBridgeStatus(`Đã kết nối extension v${ping.version || '2.x'}. Queue: ${Object.keys(state?.jobs || {}).length} job; circuit: ${state?.circuit?.openUntil > Date.now() ? 'đang tạm dừng' : 'bình thường'}.`, 'ok');
    } catch (error) {
      S.setBridgeStatus(error.message || String(error), 'error');
    }
  }

  function wireBridge() {
    S.addInputSave(B.extensionId, S.STORE.extensionId);
    S.addInputSave(B.bridgeToken, S.STORE.bridgeToken);
    S.addInputSave(B.fbGroupIdInput, S.STORE.groupIds);
    S.addInputSave(B.groupLimitInput, S.STORE.groupLimit);
    S.addInputSave(B.scanSourceModeSelect, S.STORE.scanSourceMode);
    S.addInputSave(B.loopPauseSecondsInput, S.STORE.loopPauseSeconds);
    S.addInputSave(B.linkPauseSecondsInput, S.STORE.linkPauseSeconds);
    S.addInputSave(B.fbPageReadyTimeoutMs, S.STORE.pageReadyTimeoutMs);
    S.addInputSave(B.fbEditorTimeoutMs, S.STORE.editorTimeoutMs);
    S.addInputSave(B.fbVerifyTimeoutMs, S.STORE.verifyTimeoutMs);
    S.addInputSave(B.fbMaxRetries, S.STORE.maxRetries);
    S.wirePostLinksInput();
    S.getScanSourceMode();
    S.getGroupLimit();
    S.getLoopPauseSeconds();
    S.getLinkPauseSeconds();
    S.getPageReadyTimeoutMs();
    S.getEditorTimeoutMs();
    S.getVerifyTimeoutMs();
    S.getMaxRetries();
    S.renderCommentedLinks();

    B.scanGroupLinksBtn?.addEventListener('click', () => runBridgeTask(runClosedGroupLoop).catch(error => S.setBridgeStatus(error.message || String(error), 'error')));
    B.autoWorkflowBtn?.addEventListener('click', () => runBridgeTask(() => autoWorkflow()).catch(error => S.setBridgeStatus(error.message || String(error), 'error')));
    B.stopClosedLoopBtn?.addEventListener('click', () => stopLoop());
    B.clearCommentedLinksBtn?.addEventListener('click', async () => {
      if (!confirm('Xoá toàn bộ lịch sử link đã xử lý?')) return;
      S.clearProcessedLinks();
      try { await API.sendBridge(['CLEAR_AUTOMATION_HISTORY'], {}); } catch {}
      S.setBridgeStatus('Đã xoá lịch sử link đã xử lý ở web và extension.', 'ok');
    });

    syncBridgeStatus();
    if (S.getLoopWanted() && S.getExtensionId() && S.getBridgeToken()) {
      setTimeout(() => runBridgeTask(runClosedGroupLoop).catch(error => S.setBridgeStatus(error.message || String(error), 'error')), 500);
    }
  }

  window.addEventListener('DOMContentLoaded', wireBridge);
  window.fbBridgeController = {
    scanGroupLinks,
    runClosedGroupLoop,
    readFirstFacebookPost,
    autoWorkflow,
    stopLoop,
    syncBridgeStatus
  };
}());
