(function () {
  'use strict';

  const S = window.fbBridgeShared;
  const API = window.fbBridgeApi;
  const B = S.B;


  const AUTOMATION_ERROR = Object.freeze({
    PLATFORM: 'PLATFORM_RESTRICTION',
    AUTH: 'FACEBOOK_SESSION',
    CONFIG: 'CONFIGURATION',
    TRANSIENT: 'TRANSIENT_TECHNICAL',
    ITEM: 'LINK_SPECIFIC',
    UNKNOWN: 'UNKNOWN'
  });

  function automationErrorText(error) {
    return String(error?.message || error || 'Lỗi không xác định.').trim();
  }

  function classifyAutomationError(error) {
    const message = automationErrorText(error);
    const value = message.toLowerCase();

    if (/(spam|temporarily blocked|action blocked|comment blocked|restricted|restriction|checkpoint|captcha|confirm (your )?identity|suspicious activity|account disabled|account locked|bị chặn|tạm thời bị chặn|hạn chế tài khoản|hạn chế bình luận|xác minh danh tính|hoạt động đáng ngờ|vi phạm)/i.test(value)) {
      return { kind: AUTOMATION_ERROR.PLATFORM, message, fatal: true, retryable: false };
    }

    if (/(facebook.*(not logged|login required)|chưa đăng nhập facebook|phiên đăng nhập|session expired|invalid session|cookie.*(invalid|expired|không hợp lệ|hết hạn)|không phát hiện c_user|missing c_user)/i.test(value)) {
      return { kind: AUTOMATION_ERROR.AUTH, message, fatal: true, retryable: false };
    }

    if (/(api key|quota|model|endpoint|unauthorized|forbidden|http 401|http 403|http 429|chưa nạp được hàm gọi api|chưa nhập extension id|không tìm thấy chrome\.runtime)/i.test(value)) {
      return { kind: AUTOMATION_ERROR.CONFIG, message, fatal: true, retryable: false };
    }

    if (/(receiving end does not exist|message port closed|port đã đóng|extension.*(không phản hồi|trả về rỗng|xử lý quá lâu)|network|failed to fetch|fetch failed|timeout|timed out|quá thời gian|econn|connection reset|http 5\d\d)/i.test(value)) {
      return { kind: AUTOMATION_ERROR.TRANSIENT, message, fatal: false, retryable: true };
    }

    if (/(không tìm thấy đúng ô viết bình luận|không chèn được nội dung|chưa tìm thấy nút comment|không có trường description|chưa trả về nội dung bài viết|uid\/link không hợp lệ|bình luận rỗng)/i.test(value)) {
      return { kind: AUTOMATION_ERROR.ITEM, message, fatal: false, retryable: false };
    }

    return { kind: AUTOMATION_ERROR.UNKNOWN, message, fatal: true, retryable: false };
  }

  async function runWithTechnicalRetry(task, label, maxAttempts = 2) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        const info = classifyAutomationError(error);
        if (!info.retryable || attempt >= maxAttempts || !S.isClosedLoopRunning()) throw error;
        S.setBridgeStatus(`${label} lỗi kỹ thuật: ${info.message}\nTự thử lại lần ${attempt + 1}/${maxAttempts} sau 5 giây...`, 'warn');
        await S.delay(5000);
      }
    }
    throw lastError || new Error(`${label} thất bại.`);
  }

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
        waitAfterSendMinMs: 7000,
        waitAfterSendMaxMs: 10000,
        closeAfterComment: !!B.closeAfterComment?.checked,
        closeAfter: !!B.closeAfterComment?.checked,
        activateTab: true,
        active: true
      }
    );

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
    await commentToFacebook(S.getPostLinks()[0] || '', comment);
    if (S.getPostLinks()[0]) S.saveCommentedLink(S.getPostLinks()[0]);
  }

  async function autoWorkflow({ manageLoopState = true } = {}) {
    let links = S.getPostLinks();
    if (!links.length) {
      S.setBridgeStatus('Chưa có link bài viết. Hãy quét nhóm hoặc dán link trước.', 'warn');
      return;
    }

    if (manageLoopState) {
      S.setClosedLoopRunning(true);
      B.stopClosedLoopBtn?.classList.remove('hidden');
    }

    const queue = [...links];
    try {
      for (let index = 0; index < queue.length; index += 1) {
        const link = queue[index];
        if (!S.isClosedLoopRunning()) break;

        try {
          S.setBridgeStatus(`Đang xử lý link ${index + 1}/${queue.length}...`, 'warn');
          S.setPostLinks([link, ...S.getPostLinks().filter(item => S.normalizeUrl(item) !== S.normalizeUrl(link))]);
          await runWithTechnicalRetry(() => readFirstFacebookPost(), 'Đọc bài viết');

          const controller = window.chatGPTApiController || {};
          if (!controller.generateComment) throw new Error('Chưa nạp được hàm gọi API ChatGPT.');
          const comment = await runWithTechnicalRetry(() => controller.generateComment(), 'Tạo bình luận');

          if (isNextCommentResult(comment) || controller.isNextResult?.(comment)) {
            S.setBridgeStatus(`AI xác định link ${index + 1}/${queue.length} là bài người bán/cho thuê, đã bỏ qua và chuyển bài tiếp theo.`, 'warn');
            await closeActiveReadTabIfAny();
            S.saveCommentedLink(link);
            S.setPostLinks(S.getPostLinks().filter(item => S.normalizeUrl(item) !== S.normalizeUrl(link)));
            continue;
          }

          if (B.autoCommentAfterGenerate?.checked !== false && comment) {
            await commentToFacebook(link, comment);
            S.saveCommentedLink(link);
            S.setPostLinks(S.getPostLinks().filter(item => S.normalizeUrl(item) !== S.normalizeUrl(link)));
          }
        } catch (error) {
          const info = classifyAutomationError(error);
          await closeActiveReadTabIfAny();

          if (info.kind === AUTOMATION_ERROR.ITEM) {
            S.setBridgeStatus(`Lỗi riêng ở link ${index + 1}/${queue.length} [${info.kind}], đã giữ lại link để kiểm tra và chuyển link kế tiếp:\n${info.message}`, 'error');
          } else {
            S.setClosedLoopRunning(false);
            S.setBridgeStatus(`Đã dừng tự động [${info.kind}] và giữ nguyên link chưa xử lý:\n${info.message}`, 'error');
            throw new Error(`[${info.kind}] ${info.message}`);
          }
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

    S.setClosedLoopRunning(true);
    B.stopClosedLoopBtn?.classList.remove('hidden');
    let cycleIndex = 1;

    let stopError = null;
    try {
      while (S.isClosedLoopRunning()) {
        S.setBridgeStatus(`Đang chạy vòng ${cycleIndex}...`, 'warn');
        await runWithTechnicalRetry(() => scanGroupLinks({ autoStart: false }), 'Quét link nhóm');
        if (!S.isClosedLoopRunning()) break;

        const queuedLinks = S.getPostLinks();
        if (!queuedLinks.length) {
          S.setPostLinks([]);
          if (!S.isClosedLoopRunning()) break;
          await waitBeforeNextGroupScan(cycleIndex);
          cycleIndex += 1;
          continue;
        }

        await autoWorkflow({ manageLoopState: false });

        if (!S.isClosedLoopRunning()) break;
        await waitBeforeNextGroupScan(cycleIndex);
        cycleIndex += 1;
      }
    } catch (error) {
      stopError = classifyAutomationError(error);
    } finally {
      S.setClosedLoopRunning(false);
      B.stopClosedLoopBtn?.classList.add('hidden');
      if (stopError) {
        S.setBridgeStatus(`Vòng lặp đã dừng [${stopError.kind}]. Link chưa xử lý vẫn được giữ lại:\n${stopError.message}`, 'error');
      } else {
        S.setBridgeStatus('Vòng lặp đã dừng.', 'warn');
      }
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
    }
  }

  let facebookStatusTimer = null;
  let extensionIdRefreshTimer = null;
  let cookieDraftSyncTimer = null;

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
      return data;
    } catch (error) {
      S.setCookieLoginStatus(`Chưa đồng bộ được ô Login Cookie New: ${error.message || error}`, 'warn');
      return null;
    }
  }

  async function loginFacebookCookieFromWeb() {
    if (!S.getExtensionId()) {
      S.setCookieLoginStatus('Hãy nhập Extension ID trước khi đăng nhập Cookie.', 'warn');
      return;
    }

    const cookieList = String(B.facebookCookieListInput?.value || '');
    const selected = S.getSelectedCookieLine(B.facebookCookieListInput);
    if (!selected.line) {
      S.setCookieLoginStatus('Chưa có Cookie hợp lệ trong danh sách.', 'error');
      B.facebookCookieListInput?.focus();
      return;
    }

    const button = B.facebookLoginCookieBtn;
    const oldText = button?.textContent || 'Login Cookie';
    if (button) {
      button.disabled = true;
      button.textContent = 'Đang đăng nhập...';
    }
    if (B.facebookLogoutBtn) B.facebookLogoutBtn.disabled = true;
    S.setCookieLoginStatus(`Đang đăng nhập bằng dòng ${selected.index + 1}...`);

    try {
      const response = await API.sendBridge([
        'LOGIN_FACEBOOK_COOKIE',
        'FACEBOOK_LOGIN_COOKIE',
        'FB_LOGIN_COOKIE'
      ], {
        cookieList,
        selectedCookie: selected.line,
        selectedLineIndex: selected.index
      });
      const data = API.bridgeResponseData(response);
      const uid = S.text(data?.uid);
      S.setCookieLoginStatus(`Đăng nhập Cookie thành công${uid ? ` — UID ${uid}` : ''}.`, 'ok');
      S.setBridgeStatus(`Đã đăng nhập Facebook bằng Cookie dòng ${selected.index + 1}${uid ? `, UID ${uid}` : ''}.`, 'ok');
      await refreshFacebookLoginStatus({ silent: true });
    } catch (error) {
      S.setCookieLoginStatus(`Đăng nhập Cookie thất bại: ${error.message || error}`, 'error');
      S.setBridgeStatus(`Đăng nhập Cookie thất bại: ${error.message || error}`, 'error');
      await refreshFacebookLoginStatus({ silent: true });
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }

  async function refreshFacebookLoginStatus({ silent = false } = {}) {
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
      return data;
    } catch (error) {
      S.renderFacebookAccount({ state: 'error', message: 'Không đọc được UID' });
      if (!silent) S.setBridgeStatus(`Không lấy được UID Facebook: ${error.message || error}`, 'error');
      return null;
    }
  }

  async function logoutFacebookFromWeb() {
    if (!S.getExtensionId()) {
      S.renderFacebookAccount({ state: 'offline', message: 'Chưa kết nối Extension' });
      S.setBridgeStatus('Hãy nhập Extension ID trước khi đăng xuất Facebook.', 'warn');
      return;
    }

    const button = B.facebookLogoutBtn;
    const oldText = button?.textContent || 'Đăng xuất';
    if (button) {
      button.disabled = true;
      button.textContent = 'Đang đăng xuất...';
    }

    try {
      const response = await API.sendBridge(['LOGOUT_FACEBOOK', 'FACEBOOK_LOGOUT', 'FB_LOGOUT']);
      const data = API.bridgeResponseData(response);
      S.renderFacebookAccount({ state: 'offline', message: 'Chưa đăng nhập' });
      S.setBridgeStatus(`Đã đăng xuất Facebook và xóa ${Number(data?.removed || 0)} Cookie.`, 'ok');
    } catch (error) {
      S.renderFacebookAccount({ state: 'error', message: 'Đăng xuất thất bại' });
      S.setBridgeStatus(`Đăng xuất Facebook thất bại: ${error.message || error}`, 'error');
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
    S.wirePostLinksInput();
    S.getScanSourceMode();
    S.getGroupLimit();
    S.getLoopPauseSeconds();
    S.getLinkPauseSeconds();
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
      cookieDraftSyncTimer = setTimeout(() => syncCookieDraftToExtension({ silent: true }), 500);
    });
    B.extensionId?.addEventListener('input', () => {
      clearTimeout(extensionIdRefreshTimer);
      extensionIdRefreshTimer = setTimeout(async () => {
        await refreshFacebookLoginStatus({ silent: false });
        await loadCookieDraftFromExtension();
      }, 450);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshFacebookLoginStatus({ silent: true });
        loadCookieDraftFromExtension();
      }
    });

    B.scanGroupLinksBtn?.addEventListener('click', () => runBridgeTask(() => runClosedGroupLoop()).catch(error => S.setBridgeStatus(error.message || String(error), 'error')));
    B.autoWorkflowBtn?.addEventListener('click', () => runBridgeTask(() => autoWorkflow()).catch(error => S.setBridgeStatus(error.message || String(error), 'error')));
    B.commentCurrentTabBtn?.addEventListener('click', () => runBridgeTask(() => commentCurrentTab()).catch(error => S.setBridgeStatus(error.message || String(error), 'error')));
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
    loadCookieDraftFromExtension
  };
}());
