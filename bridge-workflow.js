(function () {
  'use strict';

  const S = window.fbBridgeShared;
  const API = window.fbBridgeApi;
  const B = S.B;

  async function waitAfterLink(linkIndex, totalLinks) {
    const seconds = S.getLinkPauseSeconds();
    if (seconds <= 0 || !S.isClosedLoopRunning()) return;

    const endAt = Date.now() + seconds * 1000;
    while (S.isClosedLoopRunning() && Date.now() < endAt) {
      const remainMs = Math.max(0, endAt - Date.now());
      const remainSeconds = Math.ceil(remainMs / 1000);
      S.setBridgeStatus(`Đã chạy xong link ${linkIndex}/${totalLinks}. Đang nghỉ ${remainSeconds} giây rồi chạy link tiếp theo...`, 'warn');
      await S.delay(Math.min(1000, Math.max(200, remainMs)));
    }
  }

  function isNextCommentResult(value) {
    return /^\(?\s*next\s*\)?$/i.test(String(value || '').trim());
  }

  function getErrorCode(error) {
    const direct = String(error?.code || error?.errorCode || error?.name || '').trim();
    if (direct && direct !== 'Error') return direct;

    const message = String(error?.message || error || '').toLowerCase();
    if (/spam|có vẻ là spam|co ve la spam|looks like spam|appears to be spam|you can(?:not|'?t) use this feature right now|we limit how often you can post\s*,?\s*comment|help protect the community from spam/i.test(message)) return 'SPAM_WARNING';
    if (/c_user|cookie không|cookie invalid|cookie|login|đăng nhập|session|auth|checkpoint|captcha|xác minh|security|temporarily blocked|tạm thời bị chặn|tam thoi bi chan|action blocked|hành động này bị chặn|hanh dong nay bi chan|going too fast|quá nhanh|qua nhanh|try again later|thử lại sau|thu lai sau|can't comment|cannot comment|không thể bình luận|khong the binh luan|hạn chế bình luận|han che binh luan|comment.*restricted/i.test(message)) return 'IGNORED_FACEBOOK_STATE';
    if (/ô viết bình luận|comment box|không tìm thấy.*bình luận|khong tim thay.*binh luan/i.test(message)) return 'COMMENT_BOX_NOT_FOUND';
    if (/nút.*gửi|send button|comment\/gửi|submit/i.test(message)) return 'SEND_BUTTON_NOT_FOUND';
    if (/tab|scripting|cannot access|chrome/i.test(message)) return 'FB_TAB_ERROR';
    if (/rakko|description|nội dung bài viết|read/i.test(message)) return 'READ_POST_ERROR';
    if (/api|chatgpt|timeout|quá lâu/i.test(message)) return 'AI_OR_TIMEOUT_ERROR';
    return 'WORKFLOW_ERROR';
  }

  const ACCOUNT_SWITCH_STOP_CODES = new Set([
    'SPAM_WARNING'
  ]);


  const REMOVED_FACEBOOK_CODES = new Set([
    ['FB', 'LOGIN', 'REQUIRED'].join('_'),
    ['LOGIN', 'PAGE', 'DETECTED'].join('_'),
    ['COOKIE', 'INVALID'].join('_'),
    ['COOKIE', 'MISSING', 'C', 'USER'].join('_'),
    ['COOKIE', 'PARSE', 'FAILED'].join('_'),
    ['NO', 'COOKIE', 'SELECTED'].join('_'),
    ['ACTION', 'BLOCKED'].join('_'),
    ['TEMPORARY', 'BLOCKED'].join('_'),
    ['COMMENT', 'RESTRICTED'].join('_')
  ]);

  // Các trường hợp thao tác/giao diện này không phải lỗi tài khoản.
  // Chúng được bỏ qua, không mở bảng lỗi, không dừng vòng và không đăng xuất.
  const IGNORED_NON_FATAL_CODES = new Set([
    'IGNORED_FACEBOOK_STATE',
    'COOKIE_LOGIN_SKIPPED',
    'COMMENT_EMPTY',
    'COMMENT_BOX_NOT_FOUND',
    'SEND_BUTTON_NOT_FOUND',
    'COMMENT_INSERT_FAILED',
    'COMMENT_POSTER_ERROR',
    'COMMENT_TAB_ERROR',
    'COMMENT_SEND_REJECTED',
    'FB_TAB_ERROR',
    'FB_LINK_MISSING',
    'FB_LINK_INVALID',
    'FB_GROUP_ID_MISSING',
    'TAB_ID_MISSING',
    'MESSENGER_BOX_DETECTED',
    'TAB_CLOSE_ERROR'
  ]);

  const NON_ACCOUNT_STOP_CODES = new Set([
    'AI_OR_TIMEOUT_ERROR',
    'AI_API_ERROR',
    'AI_TIMEOUT',
    'READ_POST_ERROR',
    'RAKKO_API_ERROR',
    'EMPTY_BRIDGE_RESPONSE',
    'BRIDGE_ERROR',
    'WORKFLOW_ERROR'
  ]);

  function isIgnoredNonFatalWorkflowError(error) {
    const code = getErrorCode(error).toUpperCase();
    return IGNORED_NON_FATAL_CODES.has(code) || REMOVED_FACEBOOK_CODES.has(code);
  }

  function isFacebookWorkflowError(error) {
    const code = getErrorCode(error).toUpperCase();
    return ACCOUNT_SWITCH_STOP_CODES.has(code);
  }

  function removeLinkFromCurrentQueue(link) {
    if (!link) return;
    S.setPostLinks(S.getPostLinks().filter(item => S.normalizeUrl(item) !== S.normalizeUrl(link)));
  }

  function ignoreNonFatalWorkflowIssue(error, link = '') {
    const code = getErrorCode(error).toUpperCase();
    if (!IGNORED_NON_FATAL_CODES.has(code) && !REMOVED_FACEBOOK_CODES.has(code)) return false;
    removeLinkFromCurrentQueue(link);
    S.clearBridgeErrorPanel?.();
    S.setBridgeStatus(
      link
        ? 'Đã bỏ qua thao tác không thực hiện được ở link hiện tại và tiếp tục link kế tiếp.'
        : 'Đã bỏ qua thao tác không thực hiện được và tiếp tục vòng chạy.',
      'warn'
    );
    return true;
  }

  function stopActionLabel(error) {
    return isFacebookWorkflowError(error)
      ? 'DỪNG ĐỂ ĐỔI TÀI KHOẢN FACEBOOK KHÁC'
      : 'DỪNG ĐỂ KIỂM TRA LỖI, CHƯA CẦN ĐỔI TÀI KHOẢN';
  }

  async function pauseWorkflowOnError(error, link = '', context = '') {
    const code = getErrorCode(error);
    const message = String(error?.message || error || 'Không rõ lỗi');

    S.setClosedLoopRunning(false);
    B.stopClosedLoopBtn?.classList.add('hidden');

    if (link) {
      S.setPostLinks([
        link,
        ...S.getPostLinks().filter(item => S.normalizeUrl(item) !== S.normalizeUrl(link))
      ]);
    }

    const shouldSwitch = isFacebookWorkflowError(error);
    const action = stopActionLabel(error);
    let logoutResult = null;

    if (shouldSwitch) {
      const extensionResult = error?.response && typeof error.response === 'object' ? error.response : {};
      if (extensionResult.autoLoggedOut === true) {
        logoutResult = {
          ok: true,
          removed: Number(extensionResult.logoutRemoved || 0),
          alreadyDoneByExtension: true
        };
        S.renderFacebookAccount({ state: 'offline', message: 'Chưa đăng nhập' });
        S.setBridgeStatus(
          `Đã phát hiện lỗi Facebook (${code}). Extension đã tự động kích hoạt Đăng xuất UID.`,
          'warn'
        );
      } else {
        S.setBridgeStatus(
          `Đã phát hiện lỗi Facebook (${code}). Đang tự động kích hoạt nút Đăng xuất cạnh UID...`,
          'warn'
        );
        logoutResult = await logoutFacebookFromWeb({ silent: true, reasonCode: code });
      }
    }

    const accountHint = shouldSwitch
      ? (logoutResult?.ok
          ? `Đã tự động đăng xuất UID Facebook và xóa ${Number(logoutResult.removed || 0)} Cookie. Link lỗi vẫn ở đầu danh sách; hãy login Cookie khác rồi bấm “Chạy link hiện có”.`
          : `Đã thử tự động đăng xuất Facebook nhưng thất bại: ${logoutResult?.error || 'Không rõ lỗi đăng xuất'}. Link lỗi vẫn ở đầu danh sách.`)
      : 'Link hiện tại vẫn được giữ ở đầu danh sách để bạn chạy lại sau khi xử lý lỗi.';

    S.renderBridgeStopError?.({
      code,
      message,
      link,
      context: context || 'workflow',
      shouldSwitch
    });

    S.setBridgeStatus(
      `${action}\nĐã tự dừng để tránh mất queue${context ? ` (${context})` : ''}.\nMã lỗi: ${code}.\nChi tiết: ${message}\n${accountHint}`,
      'error'
    );

    return {
      paused: true,
      code,
      message,
      link,
      shouldSwitch,
      autoLoggedOut: Boolean(logoutResult?.ok),
      logoutError: logoutResult?.ok ? '' : String(logoutResult?.error || '')
    };
  }

  async function closeActiveReadTabIfAny() {
    const tabId = S.getActiveReadTabId();
    if (!tabId) return;
    try {
      await API.sendBridge(['CLOSE_FB_TAB', 'closeFbTab', 'CLOSE_TAB'], { tabId });
    } catch {}
    S.clearActiveReadTab();
  }

  function scanModeNeedsGroup(mode) {
    return mode === 'group_latest' || mode === 'group_top';
  }

  function scanModeLabel(mode) {
    const labels = {
      group_latest: 'Bài viết mới',
      group_top: 'Bài viết Top',
      groups_feed: 'Bản Tin Nhóm',
      home_feed: 'Bài Viết Trang Chủ'
    };
    return labels[mode] || labels.group_latest;
  }

  async function scanGroupLinks({ autoStart = false } = {}) {
    const groups = S.parseLines(B.fbGroupIdInput?.value);
    const groupLimit = S.getGroupLimit();
    const scanMode = S.getScanSourceMode();
    const needGroups = scanModeNeedsGroup(scanMode);

    if (needGroups && !groups.length) {
      S.setBridgeStatus('Hãy nhập UID nhóm hoặc link nhóm trước.', 'warn');
      B.fbGroupIdInput?.focus();
      return [];
    }

    const modeLabel = scanModeLabel(scanMode);
    const targetText = needGroups ? `mỗi nhóm lấy tối đa ${groupLimit} link` : `lấy tối đa ${groupLimit} link`;
    S.setBridgeStatus(`Đang mở tab mới quét ${modeLabel}, ${targetText}...`, 'warn');
    const response = await API.sendBridge(
      ['SCAN_GROUP_PERMALINKS', 'SCAN_GROUP_LINKS', 'scanGroupLinks', 'SCAN_GROUP', 'scan_links', 'SCAN_LINKS'],
      {
        groups,
        groupIds: groups,
        scanMode,
        sourceMode: scanMode,
        feedMode: scanMode,
        limit: groupLimit,
        limitPerGroup: groupLimit,
        perGroupLimit: groupLimit,
        onlyPermalink: scanMode !== 'home_feed',
        newestFirst: scanMode === 'group_latest',
        openInBackground: false,
        active: true,
        activateTab: true,
        closeAfter: true
      }
    );

    const links = S.filterNewLinks(API.extractLinksFromResponse(response));
    S.setPostLinks(links);
    const queuedLinks = S.getPostLinks();

    if (queuedLinks.length) {
      S.setBridgeStatus(`Đã lấy ${queuedLinks.length} link mới từ ${modeLabel}, đã lọc trùng link đã comment.`, 'ok');
      if (autoStart) await autoWorkflow();
    } else {
      S.setBridgeStatus(`Không có link mới từ ${modeLabel} sau khi lọc trùng.`, 'warn');
    }

    return queuedLinks;
  }

  async function readFirstFacebookPost() {
    const link = S.getPostLinks()[0];
    if (!link) {
      S.setBridgeStatus('Chưa có link bài viết Facebook để đọc.', 'warn');
      B.fbPostLinkInput?.focus();
      return '';
    }

    S.setBridgeStatus('Đang gọi Rakko API lấy description bài viết...', 'warn');
    const response = await API.sendBridge(
      ['READ_FB_POST_TITLE', 'SCAN_FACEBOOK_POST', 'READ_FB_POST', 'READ_FACEBOOK_POST', 'readFbPost', 'readFacebookPost', 'READ_POST'],
      {
        url: link,
        link,
        delayMs: Number(B.fbDelayMs?.value || 5000),
        maxChars: Number(B.fbMaxChars?.value || 20000),
        openInBackground: true,
        active: false,
        activateAfterAI: false,
        keepOpen: true,
        closeAfter: false,
        closeAfterRead: false,
        useFbPostLogic: true
      }
    );

    const data = API.bridgeResponseData(response);
    if (response?.skipped || response?.nonFatal || data?.skipped || data?.nonFatal) return '';
    S.setActiveReadTab(Number(data.tabId || response.tabId || 0) || null, link);

    const article = API.extractArticleFromResponse(response);
    if (!article) throw new Error('Extension chưa trả về nội dung bài viết.');

    if (B.articleInput) {
      B.articleInput.value = article;
      B.articleInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    S.setBridgeStatus('Đã lấy description từ Rakko API và điền vào ô nội dung gốc.', 'ok');
    return article;
  }

  async function commentToFacebook(link, comment) {
    if (!comment) throw new Error('Chưa có nội dung bình luận.');
    if (isNextCommentResult(comment)) {
      S.setBridgeStatus('AI trả về (next), không gửi bình luận cho bài này.', 'warn');
      return { ok: true, skipped: true, reason: 'next' };
    }
    S.setBridgeStatus('Đang gửi bình luận sang tab Facebook...', 'warn');

    const targetLink = link || S.getPostLinks()[0] || '';
    const activeTabId = S.getActiveReadTabId();
    const activeLink = S.getActiveReadLink();
    const tabId = activeTabId && S.normalizeUrl(activeLink) === S.normalizeUrl(targetLink) ? activeTabId : null;
    const response = await API.sendBridge(
      ['COMMENT_IN_FB_TAB', 'COMMENT_FB_POST', 'COMMENT_FACEBOOK_POST', 'commentFbPost', 'commentFacebookPost', 'COMMENT_POST', 'COMMENT_CURRENT_TAB'],
      {
        tabId,
        url: targetLink,
        link: targetLink,
        comment,
        text: comment,
        commentText: comment,
        waitAfterSendMinMs: 5000,
        waitAfterSendMaxMs: 5000,
        closeAfterComment: !!B.closeAfterComment?.checked,
        closeAfter: !!B.closeAfterComment?.checked,
        activateTab: true,
        active: true
      }
    );

    const data = API.bridgeResponseData(response);
    if (response?.skipped || response?.nonFatal || data?.skipped || data?.nonFatal) {
      if (tabId && (B.closeAfterComment?.checked !== false)) S.clearActiveReadTab();
      return { ...response, ...data, ok: true, skipped: true, nonFatal: true };
    }
    if (tabId && (B.closeAfterComment?.checked !== false)) S.clearActiveReadTab();
    S.setBridgeStatus('Đã gửi bình luận xong.', 'ok');
    return response;
  }

  async function commentCurrentTab() {
    const comment = S.text(B.output?.textContent);
    if (!comment || /Bình luận sẽ xuất hiện/i.test(comment)) {
      S.setBridgeStatus('Chưa có bình luận để gửi.', 'warn');
      return;
    }
    if (isNextCommentResult(comment)) {
      S.setBridgeStatus('Kết quả là (next), không gửi bình luận.', 'warn');
      return;
    }

    const link = S.getPostLinks()[0] || '';
    try {
      const result = await commentToFacebook(link, comment);
      if (result?.skipped || result?.nonFatal) {
        ignoreNonFatalWorkflowIssue({ code: result.code || 'COMMENT_SEND_REJECTED' }, link);
        return result;
      }
      if (link) S.saveCommentedLink(link);
      return result;
    } catch (error) {
      if (isIgnoredNonFatalWorkflowError(error)) {
        ignoreNonFatalWorkflowIssue(error, link);
        return { ok: true, skipped: true, nonFatal: true, code: getErrorCode(error) };
      }
      throw error;
    }
  }

  async function autoWorkflow({ manageLoopState = true } = {}) {
    const links = S.getPostLinks();
    if (!links.length) {
      S.setBridgeStatus('Chưa có link bài viết. Hãy quét nhóm hoặc dán link trước.', 'warn');
      return { ok: true, processed: 0 };
    }

    if (manageLoopState) {
      S.clearBridgeErrorPanel?.();
      S.setClosedLoopRunning(true);
      B.stopClosedLoopBtn?.classList.remove('hidden');
    }

    const queue = [...links];
    let processed = 0;

    try {
      for (let index = 0; index < queue.length; index += 1) {
        const link = queue[index];
        if (!S.isClosedLoopRunning()) break;

        try {
          S.setBridgeStatus(`Đang xử lý link ${index + 1}/${queue.length}...`, 'warn');
          S.setPostLinks([link, ...S.getPostLinks().filter(item => S.normalizeUrl(item) !== S.normalizeUrl(link))]);
          const article = await readFirstFacebookPost();
          if (!article) {
            await closeActiveReadTabIfAny();
            removeLinkFromCurrentQueue(link);
            processed += 1;
            continue;
          }

          const controller = window.chatGPTApiController || {};
          if (!controller.generateComment) throw new Error('Chưa nạp được hàm gọi API ChatGPT.');
          const comment = await controller.generateComment();

          if (isNextCommentResult(comment) || controller.isNextResult?.(comment)) {
            S.setBridgeStatus(`AI xác định link ${index + 1}/${queue.length} là bài người bán/cho thuê, đã bỏ qua và chuyển bài tiếp theo.`, 'warn');
            await closeActiveReadTabIfAny();
            S.saveCommentedLink(link);
            S.setPostLinks(S.getPostLinks().filter(item => S.normalizeUrl(item) !== S.normalizeUrl(link)));
            processed += 1;
            continue;
          }

          if (B.autoCommentAfterGenerate?.checked !== false && comment) {
            const commentResult = await commentToFacebook(link, comment);
            if (commentResult?.skipped || commentResult?.nonFatal) {
              await closeActiveReadTabIfAny();
              ignoreNonFatalWorkflowIssue(
                { code: commentResult.code || 'COMMENT_SEND_REJECTED' },
                link
              );
              processed += 1;
              continue;
            }
            S.saveCommentedLink(link);
            S.setPostLinks(S.getPostLinks().filter(item => S.normalizeUrl(item) !== S.normalizeUrl(link)));
            processed += 1;
          }
        } catch (error) {
          await closeActiveReadTabIfAny();
          if (isIgnoredNonFatalWorkflowError(error)) {
            ignoreNonFatalWorkflowIssue(error, link);
            processed += 1;
            continue;
          }
          return await pauseWorkflowOnError(error, link, `link ${index + 1}/${queue.length}`);
        }

        if (index < queue.length - 1) await waitAfterLink(index + 1, queue.length);
      }
    } finally {
      if (manageLoopState) {
        S.setClosedLoopRunning(false);
        B.stopClosedLoopBtn?.classList.add('hidden');
      }
    }

    if (!S.getPostLinks().length) {
      S.setBridgeStatus('Đã xử lý hết link trong ô Link bài viết Facebook.', 'ok');
    }

    return { ok: true, processed };
  }

  async function waitBeforeNextGroupScan(cycleIndex) {
    const seconds = S.getLoopPauseSeconds();
    const totalMs = seconds * 1000;
    if (totalMs <= 0) {
      S.setBridgeStatus(`Vòng ${cycleIndex} đã xong. Nghỉ 0 giây, quét tiếp ngay...`, 'warn');
      await S.delay(500);
      return;
    }

    const endAt = Date.now() + totalMs;
    while (S.isClosedLoopRunning() && Date.now() < endAt) {
      const remainMs = Math.max(0, endAt - Date.now());
      const remainSeconds = Math.ceil(remainMs / 1000);
      S.setBridgeStatus(`Vòng ${cycleIndex} đã xong. Đang nghỉ ${remainSeconds} giây rồi quét tiếp...`, 'warn');
      await S.delay(Math.min(1000, remainMs));
    }
  }

  async function runClosedGroupLoop() {
    if (S.isClosedLoopRunning()) return;

    S.clearBridgeErrorPanel?.();
    S.setClosedLoopRunning(true);
    B.stopClosedLoopBtn?.classList.remove('hidden');
    let cycleIndex = 1;
    let pausedByError = false;

    try {
      while (S.isClosedLoopRunning()) {
        try {
          S.setBridgeStatus(`Đang chạy vòng ${cycleIndex}...`, 'warn');
          await scanGroupLinks({ autoStart: false });
        } catch (error) {
          if (isIgnoredNonFatalWorkflowError(error)) {
            ignoreNonFatalWorkflowIssue(error);
            S.setPostLinks([]);
            if (!S.isClosedLoopRunning()) break;
            await waitBeforeNextGroupScan(cycleIndex);
            cycleIndex += 1;
            continue;
          }
          pausedByError = true;
          await pauseWorkflowOnError(error, S.getPostLinks()[0] || '', `quét vòng ${cycleIndex}`);
          break;
        }

        if (!S.isClosedLoopRunning()) break;

        const queuedLinks = S.getPostLinks();
        if (!queuedLinks.length) {
          S.setPostLinks([]);
          if (!S.isClosedLoopRunning()) break;
          await waitBeforeNextGroupScan(cycleIndex);
          cycleIndex += 1;
          continue;
        }

        const workflowResult = await autoWorkflow({ manageLoopState: false });
        if (workflowResult?.paused) {
          pausedByError = true;
          break;
        }

        if (!S.isClosedLoopRunning()) break;
        await waitBeforeNextGroupScan(cycleIndex);
        cycleIndex += 1;
      }
    } finally {
      S.setClosedLoopRunning(false);
      B.stopClosedLoopBtn?.classList.add('hidden');
      if (!pausedByError) S.setBridgeStatus('Vòng lặp đã dừng.', 'warn');
    }
  }

  async function runBridgeTask(task) {
    if (S.isBridgeBusy()) {
      S.setBridgeStatus('Đang có tác vụ chạy, vui lòng đợi tác vụ hiện tại hoàn tất.', 'warn');
      return;
    }
    S.setBridgeBusy(true);
    [B.scanGroupLinksBtn, B.autoWorkflowBtn, B.commentCurrentTabBtn].forEach(btn => { if (btn) btn.disabled = true; });
    try {
      return await task();
    } finally {
      S.setBridgeBusy(false);
      [B.scanGroupLinksBtn, B.autoWorkflowBtn, B.commentCurrentTabBtn].forEach(btn => { if (btn) btn.disabled = false; });
      maybeClickAutoRunAfterLogin();
      scheduleAutoLoginAndStart();
    }
  }

  let facebookStatusTimer = null;
  let extensionIdRefreshTimer = null;
  let cookieDraftSyncTimer = null;
  let autoLoginStartPromise = null;
  let autoRunTimer = null;
  let autoRunCountdownTimer = null;
  let autoRunDeadline = 0;
  let autoRunConsumed = false;
  let facebookLoggedIn = false;
  let lastAutoLoginAttemptAt = 0;
  const AUTO_LOGIN_RETRY_MS = 15000;

  function getFirstCookieLine() {
    const lines = String(B.facebookCookieListInput?.value || '').split(/\r?\n/);
    const index = lines.findIndex(item => String(item || '').trim());
    return {
      line: index >= 0 ? String(lines[index] || '').trim() : '',
      index
    };
  }

  function hasFacebookLogin(data) {
    return Boolean(data?.loggedIn && S.text(data?.uid));
  }

  function clearAutoRunSchedule() {
    if (autoRunTimer) clearTimeout(autoRunTimer);
    if (autoRunCountdownTimer) clearInterval(autoRunCountdownTimer);
    autoRunTimer = null;
    autoRunCountdownTimer = null;
    autoRunDeadline = 0;
  }

  function updateAutoRunCountdownStatus() {
    if (!autoRunDeadline || autoRunConsumed || !facebookLoggedIn) return;
    const remainSeconds = Math.max(0, Math.ceil((autoRunDeadline - Date.now()) / 1000));
    S.setBridgeStatus(
      `Đã đăng nhập Facebook. Web sẽ tự động bấm “Chạy tự động” sau ${remainSeconds} giây...`,
      'ok'
    );
  }

  function markAutoRunConsumed() {
    autoRunConsumed = true;
    clearAutoRunSchedule();
  }

  function resetAutoRunForNextLogin() {
    clearAutoRunSchedule();
    autoRunConsumed = false;
  }

  function executeScheduledAutoRun() {
    if (autoRunConsumed || !facebookLoggedIn) {
      clearAutoRunSchedule();
      return false;
    }

    if (S.isClosedLoopRunning()) {
      markAutoRunConsumed();
      return false;
    }

    if (S.isBridgeBusy()) {
      autoRunDeadline = Date.now() + 1000;
      autoRunTimer = setTimeout(executeScheduledAutoRun, 1000);
      updateAutoRunCountdownStatus();
      return false;
    }

    if (!B.scanGroupLinksBtn) {
      markAutoRunConsumed();
      S.setBridgeStatus('Đã đăng nhập Facebook nhưng không tìm thấy nút Chạy tự động.', 'error');
      return false;
    }

    markAutoRunConsumed();
    S.setBridgeStatus('Đã hết thời gian chờ. Đang tự động bấm “Chạy tự động”...', 'ok');
    B.scanGroupLinksBtn.click();
    return true;
  }

  function scheduleAutoRunAfterLogin({ force = false } = {}) {
    facebookLoggedIn = true;
    if (autoRunConsumed || S.isClosedLoopRunning()) return false;

    const delaySeconds = S.getAutoRunDelaySeconds();
    if (delaySeconds <= 0) {
      clearAutoRunSchedule();
      return false;
    }

    if (autoRunTimer && !force) return true;

    clearAutoRunSchedule();
    autoRunDeadline = Date.now() + delaySeconds * 1000;
    updateAutoRunCountdownStatus();
    autoRunCountdownTimer = setInterval(updateAutoRunCountdownStatus, 1000);
    autoRunTimer = setTimeout(executeScheduledAutoRun, delaySeconds * 1000);
    return true;
  }

  function maybeClickAutoRunAfterLogin() {
    return scheduleAutoRunAfterLogin();
  }

  function scheduleAutoLoginAndStart(options = {}) {
    Promise.resolve()
      .then(() => autoLoginAndStartWhenOffline(options))
      .catch(error => {
        S.setCookieLoginStatus(`Tự động đăng nhập Cookie thất bại: ${error.message || error}`, 'error');
      });
  }

  async function autoLoginAndStartWhenOffline({ force = false } = {}) {
    if (!S.getExtensionId()) return { ok: false, skipped: true, reason: 'missing_extension_id' };
    if (S.isBridgeBusy() || S.isClosedLoopRunning()) return { ok: false, skipped: true, reason: 'workflow_busy' };
    if (autoLoginStartPromise) return autoLoginStartPromise;

    const selected = getFirstCookieLine();
    if (!selected.line) {
      S.setCookieLoginStatus('Facebook chưa đăng nhập nhưng danh sách Cookie đang trống.', 'warn');
      return { ok: false, skipped: true, reason: 'empty_cookie_list' };
    }

    const now = Date.now();
    if (!force && now - lastAutoLoginAttemptAt < AUTO_LOGIN_RETRY_MS) {
      return { ok: false, skipped: true, reason: 'retry_cooldown' };
    }
    lastAutoLoginAttemptAt = now;

    autoLoginStartPromise = (async () => {
      const currentStatus = await refreshFacebookLoginStatus({ silent: true, triggerAutoLogin: false });
      if (hasFacebookLogin(currentStatus)) return { ok: true, skipped: true, reason: 'already_logged_in' };

      S.setBridgeStatus(
        `Phát hiện Facebook chưa đăng nhập. Đang tự động dùng Cookie dòng ${selected.index + 1} để đăng nhập...`,
        'warn'
      );

      const loginResult = await loginFacebookCookieFromWeb({
        automatic: true,
        selectedCookie: selected.line,
        selectedLineIndex: selected.index
      });

      if (!loginResult?.loggedIn) {
        S.setBridgeStatus(
          loginResult?.message || 'Tự động đăng nhập Cookie chưa thành công; chưa chạy tự động.',
          'warn'
        );
        return loginResult || { ok: false, loggedIn: false };
      }

      await S.delay(1000);
      const verifiedStatus = await refreshFacebookLoginStatus({ silent: true, triggerAutoLogin: false });
      if (!hasFacebookLogin(verifiedStatus)) {
        S.setBridgeStatus('Cookie đã được gửi nhưng Extension chưa xác nhận UID Facebook; chưa chạy tự động.', 'warn');
        return { ok: false, loggedIn: false, reason: 'login_not_verified' };
      }

      const autoStartQueued = scheduleAutoRunAfterLogin({ force: true });
      return {
        ...loginResult,
        ok: true,
        loggedIn: true,
        autoStartQueued,
        autoStarted: false
      };
    })();

    try {
      return await autoLoginStartPromise;
    } finally {
      autoLoginStartPromise = null;
    }
  }

  async function syncCookieDraftToExtension({ silent = true } = {}) {
    if (!B.facebookCookieListInput || !S.getExtensionId()) return null;
    const cookieList = String(B.facebookCookieListInput.value || '');
    let updatedAt = Number(S.load(S.STORE.facebookCookieListUpdatedAt, 0)) || 0;
    if (!updatedAt) {
      updatedAt = Date.now();
      S.save(S.STORE.facebookCookieListUpdatedAt, updatedAt);
    }
    try {
      const response = await API.sendBridge([
        'SET_LOGIN_COOKIE_DRAFT',
        'SET_FACEBOOK_COOKIE_DRAFT'
      ], { cookieList, updatedAt });
      if (!silent) S.setCookieLoginStatus('Đã đồng bộ danh sách Cookie với Extension.', 'ok');
      return API.bridgeResponseData(response);
    } catch (error) {
      if (!silent) S.setCookieLoginStatus(`Không đồng bộ được Cookie: ${error.message || error}`, 'error');
      return null;
    }
  }

  async function loadCookieDraftFromExtension() {
    if (!B.facebookCookieListInput || !S.getExtensionId()) return null;
    try {
      const response = await API.sendBridge([
        'GET_LOGIN_COOKIE_DRAFT',
        'GET_FACEBOOK_COOKIE_DRAFT'
      ]);
      const data = API.bridgeResponseData(response);
      const extensionCookieList = String(data?.cookieList || '');
      const extensionUpdatedAt = Number(data?.updatedAt || 0) || 0;
      const webCookieList = String(B.facebookCookieListInput.value || '');
      const webUpdatedAt = Number(S.load(S.STORE.facebookCookieListUpdatedAt, 0)) || 0;

      if (extensionUpdatedAt > webUpdatedAt || (!webCookieList.trim() && extensionCookieList.trim())) {
        B.facebookCookieListInput.value = extensionCookieList;
        S.save(S.STORE.facebookCookieList, extensionCookieList);
        S.save(S.STORE.facebookCookieListUpdatedAt, extensionUpdatedAt || Date.now());
        S.setCookieLoginStatus('Đã đồng bộ danh sách Cookie mới nhất từ Extension.', 'ok');
      } else if (webCookieList !== extensionCookieList || webUpdatedAt > extensionUpdatedAt) {
        await syncCookieDraftToExtension({ silent: true });
      }
      scheduleAutoLoginAndStart();
      return data;
    } catch (error) {
      S.setCookieLoginStatus(`Chưa đồng bộ được ô Login Cookie New: ${error.message || error}`, 'warn');
      return null;
    }
  }

  async function loginFacebookCookieFromWeb(options = {}) {
    const automatic = Boolean(options?.automatic);
    if (!S.getExtensionId()) {
      const message = 'Hãy nhập Extension ID trước khi đăng nhập Cookie.';
      S.setCookieLoginStatus(message, 'warn');
      return { ok: false, loggedIn: false, message };
    }

    const cookieList = String(B.facebookCookieListInput?.value || '');
    const automaticSelected = getFirstCookieLine();
    const selected = automatic
      ? {
          line: String(options?.selectedCookie || automaticSelected.line || '').trim(),
          index: Number.isInteger(Number(options?.selectedLineIndex))
            ? Number(options.selectedLineIndex)
            : automaticSelected.index
        }
      : S.getSelectedCookieLine(B.facebookCookieListInput);

    if (!selected.line) {
      const message = 'Danh sách Cookie trống, đã bỏ qua thao tác đăng nhập.';
      S.setCookieLoginStatus(message, 'warn');
      return { ok: true, skipped: true, loggedIn: false, message };
    }

    const button = B.facebookLoginCookieBtn;
    const oldText = button?.textContent || 'Login Cookie';
    if (button) {
      button.disabled = true;
      button.textContent = automatic ? 'Đang tự đăng nhập...' : 'Đang đăng nhập...';
    }
    if (B.facebookLogoutBtn) B.facebookLogoutBtn.disabled = true;
    S.setCookieLoginStatus(automatic
      ? `Tự động đăng nhập bằng dòng ${selected.index + 1}...`
      : `Đang đăng nhập bằng dòng ${selected.index + 1}...`);

    try {
      const response = await API.sendBridge([
        'LOGIN_FACEBOOK_COOKIE',
        'FACEBOOK_LOGIN_COOKIE',
        'FB_LOGIN_COOKIE'
      ], {
        cookieList,
        selectedCookie: selected.line,
        selectedLineIndex: selected.index,
        automatic
      });
      const data = API.bridgeResponseData(response);
      if (response?.skipped || data?.skipped || data?.loggedIn === false) {
        const message = S.text(data?.message || response?.message) || 'Đã bỏ qua dòng Cookie không thể sử dụng.';
        S.setCookieLoginStatus(message, 'warn');
        S.setBridgeStatus(
          automatic
            ? 'Tự động đăng nhập Cookie chưa thành công; chưa bấm Chạy tự động.'
            : 'Đã bỏ qua thao tác đăng nhập Cookie, không tạo lỗi và không dừng vòng chạy.',
          'warn'
        );
        await refreshFacebookLoginStatus({ silent: true, triggerAutoLogin: false });
        return { ...response, ...data, ok: true, skipped: true, loggedIn: false, message };
      }
      const uid = S.text(data?.uid);
      S.setCookieLoginStatus(`Đăng nhập Cookie thành công${uid ? ` — UID ${uid}` : ''}.`, 'ok');
      S.setBridgeStatus(`Đã đăng nhập Facebook bằng Cookie dòng ${selected.index + 1}${uid ? `, UID ${uid}` : ''}.`, 'ok');
      await refreshFacebookLoginStatus({ silent: true, triggerAutoLogin: false });
      return { ...response, ...data, ok: true, loggedIn: true, uid };
    } catch (error) {
      const message = `Đăng nhập Cookie thất bại: ${error.message || error}`;
      S.setCookieLoginStatus(message, 'error');
      S.setBridgeStatus(message, 'error');
      await refreshFacebookLoginStatus({ silent: true, triggerAutoLogin: false });
      return { ok: false, loggedIn: false, message, error: String(error.message || error) };
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }

  async function refreshFacebookLoginStatus({ silent = false, triggerAutoLogin = true } = {}) {
    if (!S.getExtensionId()) {
      S.renderFacebookAccount({ state: 'offline', message: 'Chưa kết nối Extension' });
      return null;
    }

    if (!silent) S.renderFacebookAccount({ state: 'loading', message: 'Đang kiểm tra...' });

    try {
      const response = await API.sendBridge([
        'GET_FB_LOGIN_STATUS',
        'GET_FACEBOOK_LOGIN_STATUS',
        'FB_LOGIN_STATUS'
      ]);
      const data = API.bridgeResponseData(response);
      const uid = S.text(data?.uid);
      const loggedIn = Boolean(data?.loggedIn && uid);
      S.renderFacebookAccount({
        loggedIn,
        uid,
        state: loggedIn ? 'online' : 'offline',
        message: loggedIn ? '' : 'Chưa đăng nhập'
      });

      const wasLoggedIn = facebookLoggedIn;
      facebookLoggedIn = loggedIn;

      if (loggedIn) {
        scheduleAutoRunAfterLogin();
      } else {
        clearAutoRunSchedule();
        if (wasLoggedIn) resetAutoRunForNextLogin();
        if (triggerAutoLogin) scheduleAutoLoginAndStart();
      }
      return data;
    } catch (error) {
      S.renderFacebookAccount({ state: 'error', message: 'Không đọc được UID' });
      if (!silent) S.setBridgeStatus(`Không lấy được UID Facebook: ${error.message || error}`, 'error');
      return null;
    }
  }

  async function logoutFacebookFromWeb(options = {}) {
    const silent = Boolean(options?.silent);

    if (!S.getExtensionId()) {
      const errorMessage = 'Chưa nhập Extension ID.';
      S.renderFacebookAccount({ state: 'offline', message: 'Chưa kết nối Extension' });
      if (!silent) S.setBridgeStatus('Hãy nhập Extension ID trước khi đăng xuất Facebook.', 'warn');
      return { ok: false, removed: 0, error: errorMessage };
    }

    const button = B.facebookLogoutBtn;
    const oldText = button?.textContent || 'Đăng xuất';
    if (button) {
      button.disabled = true;
      button.textContent = 'Đang đăng xuất...';
    }

    try {
      const response = await API.sendBridge(['LOGOUT_FACEBOOK', 'FACEBOOK_LOGOUT', 'FB_LOGOUT'], {
        reasonCode: String(options?.reasonCode || ''),
        automatic: silent
      });
      const data = API.bridgeResponseData(response);
      const removed = Number(data?.removed || 0);
      S.renderFacebookAccount({ state: 'offline', message: 'Chưa đăng nhập' });
      if (!silent) S.setBridgeStatus(`Đã đăng xuất Facebook và xóa ${removed} Cookie.`, 'ok');
      return { ok: true, removed, data };
    } catch (error) {
      const errorMessage = String(error?.message || error || 'Không rõ lỗi đăng xuất');
      S.renderFacebookAccount({ state: 'error', message: 'Đăng xuất thất bại' });
      if (!silent) S.setBridgeStatus(`Đăng xuất Facebook thất bại: ${errorMessage}`, 'error');
      return { ok: false, removed: 0, error: errorMessage };
    } finally {
      if (button) button.textContent = oldText;
      await refreshFacebookLoginStatus({ silent: true });
    }
  }

  function startFacebookStatusSync() {
    if (facebookStatusTimer) clearInterval(facebookStatusTimer);
    facebookStatusTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshFacebookLoginStatus({ silent: true });
        loadCookieDraftFromExtension();
      }
    }, 15000);
  }

  function wireBridge() {
    S.addInputSave(B.extensionId, S.STORE.extensionId);
    S.addInputSave(B.facebookCookieListInput, S.STORE.facebookCookieList);
    S.addInputSave(B.fbGroupIdInput, S.STORE.groupIds);
    S.addInputSave(B.groupLimitInput, S.STORE.groupLimit);
    S.addInputSave(B.scanSourceModeSelect, S.STORE.scanSourceMode);
    S.addInputSave(B.loopPauseSecondsInput, S.STORE.loopPauseSeconds);
    if (B.loopPauseSecondsInput && !B.loopPauseSecondsInput.value) {
      const oldMinutes = S.load(S.STORE.oldLoopPauseMinutes, null);
      if (oldMinutes !== null && oldMinutes !== '') B.loopPauseSecondsInput.value = String(Math.round(S.clampNumber(oldMinutes, 5, 0, 1440)) * 60);
    }
    S.addInputSave(B.linkPauseSecondsInput, S.STORE.linkPauseSeconds);
    S.addInputSave(B.autoRunDelaySecondsInput, S.STORE.autoRunDelaySeconds);
    S.wirePostLinksInput();
    S.getScanSourceMode();
    S.getGroupLimit();
    S.getLoopPauseSeconds();
    S.getLinkPauseSeconds();
    S.getAutoRunDelaySeconds();
    S.renderCommentedLinks();
    refreshFacebookLoginStatus();
    loadCookieDraftFromExtension();
    startFacebookStatusSync();

    B.facebookLogoutBtn?.addEventListener('click', logoutFacebookFromWeb);
    B.facebookLoginCookieBtn?.addEventListener('click', loginFacebookCookieFromWeb);
    B.facebookCookieListInput?.addEventListener('input', () => {
      S.save(S.STORE.facebookCookieList, B.facebookCookieListInput.value);
      S.save(S.STORE.facebookCookieListUpdatedAt, Date.now());
      clearTimeout(cookieDraftSyncTimer);
      cookieDraftSyncTimer = setTimeout(async () => {
        await syncCookieDraftToExtension({ silent: true });
        scheduleAutoLoginAndStart({ force: true });
      }, 500);
    });
    B.extensionId?.addEventListener('input', () => {
      clearTimeout(extensionIdRefreshTimer);
      extensionIdRefreshTimer = setTimeout(async () => {
        await refreshFacebookLoginStatus({ silent: false });
        await loadCookieDraftFromExtension();
      }, 450);
    });
    B.autoRunDelaySecondsInput?.addEventListener('input', () => {
      S.getAutoRunDelaySeconds();
      if (facebookLoggedIn && !autoRunConsumed) scheduleAutoRunAfterLogin({ force: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshFacebookLoginStatus({ silent: true });
        loadCookieDraftFromExtension();
      }
    });

    B.scanGroupLinksBtn?.addEventListener('click', () => {
      markAutoRunConsumed();
      runBridgeTask(() => runClosedGroupLoop()).catch(error => S.setBridgeStatus(error.message || String(error), 'error'));
    });
    B.autoWorkflowBtn?.addEventListener('click', () => {
      markAutoRunConsumed();
      runBridgeTask(() => autoWorkflow()).catch(error => S.setBridgeStatus(error.message || String(error), 'error'));
    });
    B.commentCurrentTabBtn?.addEventListener('click', () => {
      markAutoRunConsumed();
      runBridgeTask(() => commentCurrentTab()).catch(error => S.setBridgeStatus(error.message || String(error), 'error'));
    });
    B.stopClosedLoopBtn?.addEventListener('click', () => {
      S.setClosedLoopRunning(false);
      B.stopClosedLoopBtn.classList.add('hidden');
      S.setBridgeStatus('Đã dừng vòng lặp.', 'warn');
    });
    B.clearCommentedLinksBtn?.addEventListener('click', () => {
      if (!confirm('Xoá toàn bộ log link đã comment?')) return;
      S.save(S.STORE.commented, []);
      S.renderCommentedLinks();
      S.setBridgeStatus('Đã xoá log link đã comment.', 'ok');
    });
  }

  window.addEventListener('DOMContentLoaded', wireBridge);
  window.fbBridgeController = {
    scanGroupLinks,
    runClosedGroupLoop,
    readFirstFacebookPost,
    autoWorkflow,
    commentCurrentTab,
    refreshFacebookLoginStatus,
    logoutFacebookFromWeb,
    loginFacebookCookieFromWeb,
    syncCookieDraftToExtension,
    loadCookieDraftFromExtension,
    autoLoginAndStartWhenOffline
  };
}());
