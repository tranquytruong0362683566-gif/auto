(function () {
  'use strict';

  const S = window.fbBridgeShared;
  const API = window.fbBridgeApi;
  const APIFY = window.apifyGroupsApi;
  const VpsApiClient = window.FacebookVpsApiClient;
  const B = S.B;
  const ACCOUNT_ROTATION_CODES = new Set([
    'SPAM_WARNING',
    'FACEBOOK_FEATURE_RESTRICTED',
    'LOGIN_REQUIRED',
    'CHECKPOINT_REQUIRED',
    'COOKIE_LOGIN_UID_NOT_FOUND'
  ]);

  let fatalStopMessage = '';
  let facebookAccountRefreshPromise = null;
  let facebookLogoutPromise = null;
  let facebookCookieRotationPromise = null;
  let autoRestartScheduled = false;
  let vpsAccounts = [];
  let currentVpsJobId = '';
  let vpsStopRequested = false;

  function getVpsClient() {
    if (!VpsApiClient) throw new Error('Chưa nạp được module VPS API.');
    return new VpsApiClient({
      baseUrl: S.getVpsApiUrl(),
      token: S.getVpsApiToken(),
      timeoutMs: 30000
    });
  }

  function setVpsConnectionStatus(message, type = '') {
    if (!B.vpsConnectionStatus) return;
    B.vpsConnectionStatus.textContent = message;
    B.vpsConnectionStatus.className = 'automation-status' + (type ? ` ${type}` : '');
  }

  function getFacebookCookieLines() {
    return String(B.facebookCookiesInput?.value || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  }

  function removeImportedCookieLine(cookieLine) {
    const lines = getFacebookCookieLines();
    const target = String(cookieLine || '').trim();
    const index = lines.findIndex(line => line === target);
    if (index >= 0) lines.splice(index, 1);
    if (B.facebookCookiesInput) B.facebookCookiesInput.value = lines.join('\n');
    S.save(S.STORE.facebookCookies, B.facebookCookiesInput?.value || '');
  }

  function accountStatusLabel(status) {
    const labels = {
      READY: 'Sẵn sàng',
      READY_UNVERIFIED: 'Chưa kiểm tra',
      RUNNING: 'Đang chạy',
      SPAM_WARNING: 'Bị cảnh báo spam',
      FACEBOOK_FEATURE_RESTRICTED: 'Bị giới hạn tính năng',
      LOGIN_REQUIRED: 'Cần đăng nhập lại',
      CHECKPOINT_REQUIRED: 'Cần checkpoint',
      COOKIE_LOGIN_UID_NOT_FOUND: 'Cookie không nhận UID',
      ERROR: 'Có lỗi'
    };
    return labels[String(status || '')] || String(status || 'Không rõ');
  }

  function isUsableAccount(account) {
    if (!account?.accountId || !account?.uid) return false;
    return !ACCOUNT_ROTATION_CODES.has(String(account.status || ''));
  }

  function selectedAccount() {
    const accountId = S.getVpsAccountId();
    return vpsAccounts.find(account => account.accountId === accountId) || null;
  }

  function renderFacebookAccount({ account = null, message = '', error = false } = {}) {
    const valid = Boolean(account?.accountId && account?.uid);
    if (B.facebookUidDisplay) {
      B.facebookUidDisplay.textContent = message || (valid
        ? `UID ${account.uid} · ${accountStatusLabel(account.status)}`
        : 'Chưa chọn tài khoản Facebook trên VPS.');
    }
    B.facebookAccountBar?.classList.toggle('logged-in', valid && isUsableAccount(account));
    B.facebookAccountBar?.classList.toggle('account-error', Boolean(error || (valid && !isUsableAccount(account))));
    if (B.facebookLogoutBtn) B.facebookLogoutBtn.disabled = !valid || Boolean(facebookLogoutPromise);
  }

  function populateVpsAccounts(accounts, preferredAccountId = '') {
    vpsAccounts = Array.isArray(accounts) ? accounts.filter(Boolean) : [];
    if (!B.vpsAccountSelect) return null;

    const previous = String(preferredAccountId || S.getVpsAccountId() || '');
    B.vpsAccountSelect.innerHTML = '';

    if (!vpsAccounts.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Chưa có tài khoản trên VPS';
      B.vpsAccountSelect.appendChild(option);
      S.setVpsAccountId('');
      return null;
    }

    for (const account of vpsAccounts) {
      const option = document.createElement('option');
      option.value = account.accountId;
      option.textContent = `UID ${account.uid} — ${accountStatusLabel(account.status)}`;
      B.vpsAccountSelect.appendChild(option);
    }

    const preferred = vpsAccounts.find(account => account.accountId === previous)
      || vpsAccounts.find(isUsableAccount)
      || vpsAccounts[0];
    B.vpsAccountSelect.value = preferred.accountId;
    S.setVpsAccountId(preferred.accountId);
    return preferred;
  }

  async function refreshFacebookAccount({ silent = false } = {}) {
    if (facebookAccountRefreshPromise) return facebookAccountRefreshPromise;

    facebookAccountRefreshPromise = (async () => {
      try {
        const token = S.getVpsApiToken();
        if (!token) {
          renderFacebookAccount({ message: 'Chưa nhập API Token VPS.', error: true });
          if (!silent) setVpsConnectionStatus('Chưa nhập API Token trong VPS_ACCESS.txt.', 'warn');
          return null;
        }

        if (!silent) setVpsConnectionStatus('Đang tải danh sách tài khoản từ VPS...', 'warn');
        const response = await getVpsClient().listAccounts();
        const accounts = response?.data?.accounts || [];
        const account = populateVpsAccounts(accounts);
        renderFacebookAccount({ account });
        setVpsConnectionStatus(
          account
            ? `Đã kết nối VPS. Có ${accounts.length} tài khoản; đang chọn UID ${account.uid}.`
            : 'Đã kết nối VPS nhưng chưa có tài khoản Facebook.',
          account ? 'ok' : 'warn'
        );
        return account ? { ...account, loggedIn: isUsableAccount(account) } : null;
      } catch (error) {
        renderFacebookAccount({ message: `Không kết nối được VPS: ${error.message || error}`, error: true });
        setVpsConnectionStatus(`Lỗi VPS: ${error.message || error}`, 'error');
        if (!silent) S.setBridgeStatus(error.message || String(error), 'error');
        return null;
      } finally {
        facebookAccountRefreshPromise = null;
      }
    })();

    return facebookAccountRefreshPromise;
  }

  async function testVpsConnection() {
    const oldText = B.vpsTestBtn?.textContent;
    if (B.vpsTestBtn) {
      B.vpsTestBtn.disabled = true;
      B.vpsTestBtn.textContent = 'Đang kiểm tra...';
    }
    try {
      setVpsConnectionStatus('Đang kiểm tra API và Redis trên VPS...', 'warn');
      const client = getVpsClient();
      const health = await client.health();
      if (!S.getVpsApiToken()) throw Object.assign(new Error('VPS hoạt động nhưng chưa nhập API Token.'), { code: 'VPS_TOKEN_MISSING' });
      const accountResponse = await client.listAccounts();
      const account = populateVpsAccounts(accountResponse?.data?.accounts || []);
      renderFacebookAccount({ account });
      const waiting = Number(health?.data?.queue?.waiting || 0);
      const active = Number(health?.data?.queue?.active || 0);
      setVpsConnectionStatus(`VPS hoạt động. Queue đang chờ ${waiting}, đang chạy ${active}.${account ? ` UID đang chọn: ${account.uid}.` : ''}`, 'ok');
      return health;
    } finally {
      if (B.vpsTestBtn) {
        B.vpsTestBtn.disabled = false;
        B.vpsTestBtn.textContent = oldText || '🔌 Kiểm tra VPS';
      }
    }
  }

  function scheduleAutoRunByApi(uid) {
    if (autoRestartScheduled) return;
    autoRestartScheduled = true;

    (async () => {
      try {
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
          if (!S.isBridgeBusy() && !S.isClosedLoopRunning() && !B.scanGroupLinksBtn?.disabled) break;
          await S.delay(500);
        }
        if (S.isBridgeBusy() || S.isClosedLoopRunning() || B.scanGroupLinksBtn?.disabled) {
          throw new Error('Không thể tự chạy lại vì tác vụ cũ chưa kết thúc.');
        }
        const account = await refreshFacebookAccount({ silent: true });
        if (!account?.accountId || !isUsableAccount(account)) throw new Error('UID mới trên VPS chưa sẵn sàng.');
        S.setBridgeStatus(`Đã chuyển sang UID ${uid || account.uid}. Đang tự động bấm 🚀 Chạy tự động bằng API...`, 'ok');
        B.scanGroupLinksBtn?.click();
      } catch (error) {
        S.setBridgeStatus(`Không thể tự chạy lại bằng API: ${error.message || error}`, 'error');
      } finally {
        autoRestartScheduled = false;
      }
    })();
  }

  async function importNextFacebookCookie({ source = 'manual', autoRun = false } = {}) {
    if (facebookCookieRotationPromise) return facebookCookieRotationPromise;

    facebookCookieRotationPromise = (async () => {
      const cookieLine = getFacebookCookieLines()[0] || '';
      if (!cookieLine) throw Object.assign(new Error('Ô Cookie Facebook không còn dòng cookie nào.'), { code: 'FACEBOOK_COOKIE_EMPTY' });

      setVpsConnectionStatus('Đang gửi dòng cookie đầu tiên lên VPS...', 'warn');
      const response = await getVpsClient().importCookie(cookieLine);
      const account = response?.data;
      if (!account?.accountId || !account?.uid) throw new Error('VPS đã nhận cookie nhưng không trả accountId/UID.');

      removeImportedCookieLine(cookieLine);
      S.setVpsAccountId(account.accountId);
      await refreshFacebookAccount({ silent: true });
      const selected = vpsAccounts.find(item => item.accountId === account.accountId) || account;
      renderFacebookAccount({ account: selected });
      setVpsConnectionStatus(`Đã nhập cookie lên VPS và xóa đúng 1 dòng khỏi danh sách. UID mới: ${account.uid}.`, 'ok');
      if (autoRun) scheduleAutoRunByApi(account.uid);
      return { ...selected, source };
    })().catch(error => {
      setVpsConnectionStatus(`Nhập cookie lên VPS thất bại: ${error.message || error}`, 'error');
      throw error;
    }).finally(() => {
      facebookCookieRotationPromise = null;
    });

    return facebookCookieRotationPromise;
  }

  async function rotateFacebookCookieAfterLogout({ source = 'account-error', autoRun = true } = {}) {
    const currentId = S.getVpsAccountId();
    if (getFacebookCookieLines().length) return importNextFacebookCookie({ source, autoRun });

    await refreshFacebookAccount({ silent: true });
    const alternate = vpsAccounts.find(account => account.accountId !== currentId && isUsableAccount(account));
    if (!alternate) {
      throw new Error('Không còn cookie mới và không có UID dự phòng sẵn sàng trên VPS.');
    }
    S.setVpsAccountId(alternate.accountId);
    if (B.vpsAccountSelect) B.vpsAccountSelect.value = alternate.accountId;
    renderFacebookAccount({ account: alternate });
    setVpsConnectionStatus(`Đã chuyển sang UID dự phòng ${alternate.uid}.`, 'ok');
    if (autoRun) scheduleAutoRunByApi(alternate.uid);
    return alternate;
  }

  async function logoutFacebookAccount({ automatic = false, reason = '' } = {}) {
    if (facebookLogoutPromise) return facebookLogoutPromise;

    facebookLogoutPromise = (async () => {
      const oldText = B.facebookLogoutBtn?.textContent || 'Đổi tài khoản';
      if (B.facebookLogoutBtn) {
        B.facebookLogoutBtn.disabled = true;
        B.facebookLogoutBtn.textContent = automatic ? 'Đang tự đổi...' : 'Đang đổi...';
      }
      if (automatic) S.setBridgeStatus(`${reason || 'UID hiện tại không thể tiếp tục.'}\nĐang chuyển sang cookie/UID tiếp theo trên VPS...`, 'error');

      try {
        return await rotateFacebookCookieAfterLogout({
          source: automatic ? 'automatic-account-rotation' : 'manual-account-rotation',
          autoRun: automatic
        });
      } finally {
        if (B.facebookLogoutBtn) B.facebookLogoutBtn.textContent = oldText;
        facebookLogoutPromise = null;
        if (B.facebookLogoutBtn) B.facebookLogoutBtn.disabled = !selectedAccount();
      }
    })();

    return facebookLogoutPromise;
  }

  async function ensureVpsAccount() {
    let account = selectedAccount();
    if (!account) account = await refreshFacebookAccount({ silent: true });
    if (!account && getFacebookCookieLines().length) account = await importNextFacebookCookie({ source: 'comment-account-required', autoRun: false });
    if (!account?.accountId) throw new Error('Chưa có tài khoản Facebook trên VPS. Hãy nhập cookie hoặc chọn UID.');
    if (!isUsableAccount(account)) {
      account = await rotateFacebookCookieAfterLogout({ source: `account-status-${account.status}`, autoRun: false });
    }
    return account;
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

  function scanModeLabel(mode) {
    const labels = {
      group_latest: 'Bài viết mới',
      group_top: 'Bài viết Top'
    };
    return labels[mode] || labels.group_latest;
  }

  async function scanGroupLinksByApify() {
    if (!APIFY?.fetchPostUrls) throw new Error('Chưa nạp được module Apify API.');

    const groups = S.parseLines(B.fbGroupIdInput?.value);
    if (!groups.length) {
      S.setBridgeStatus('Hãy nhập UID hoặc link nhóm Facebook trước.', 'warn');
      B.fbGroupIdInput?.focus();
      const error = new Error('Chưa nhập UID hoặc link nhóm Facebook.');
      error.code = 'APIFY_GROUPS_EMPTY';
      throw error;
    }

    const actorId = S.getApifyActorId();
    const token = S.getApifyToken();
    if (!token) {
      S.setBridgeStatus('Hãy nhập Apify API token trong Cài đặt nâng cao.', 'warn');
      B.apifyApiTokenInput?.focus();
      const error = new Error('Chưa nhập Apify API token trong Cài đặt nâng cao.');
      error.code = 'APIFY_TOKEN_MISSING';
      throw error;
    }

    const groupLimit = S.getGroupLimit();
    const scanMode = S.getScanSourceMode();
    const modeLabel = scanModeLabel(scanMode);
    const expectedMax = Math.min(1024, groupLimit * groups.length);

    S.setBridgeStatus(`Đang gọi Actor ${actorId} lấy URL ${modeLabel}, tối đa ${expectedMax} kết quả...`, 'warn');

    const result = await APIFY.fetchPostUrls({
      actorId,
      token,
      groups,
      limit: groupLimit,
      scanMode
    });

    const links = S.filterNewLinks(result.links);
    const existingLinks = S.getPostLinks();
    S.setPostLinks([...existingLinks, ...links]);
    const queuedLinks = S.getPostLinks();

    if (links.length) {
      S.setBridgeStatus(
        `Apify trả về ${result.itemCount} bản ghi, đã lấy ${links.length} URL /permalink/ mới và điền vào ô Link bài viết Facebook. Tổng hàng đợi hiện có ${queuedLinks.length} link.`,
        'ok'
      );
    } else if (result.itemCount > 0) {
      S.setBridgeStatus(
        `Apify trả về ${result.itemCount} bản ghi nhưng không tìm thấy URL /permalink/ mới hợp lệ hoặc tất cả link đã có trong log.`,
        'warn'
      );
    } else {
      S.setBridgeStatus('Apify chạy xong nhưng không trả về bài viết nào.', 'warn');
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
      return { success: true, skipped: true, reason: 'next' };
    }

    const targetLink = link || S.getPostLinks()[0] || '';
    if (!targetLink) throw new Error('Chưa có link bài viết Facebook.');

    const account = await ensureVpsAccount();
    const client = getVpsClient();
    const requestId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    vpsStopRequested = false;

    S.setBridgeStatus(`Đang gửi job sang VPS bằng UID ${account.uid}...`, 'warn');

    try {
      const created = await client.createCommentJob({
        requestId,
        accountId: account.accountId,
        postUrl: targetLink,
        content: comment
      });
      currentVpsJobId = String(created?.data?.jobId || '');
      if (!currentVpsJobId) throw new Error('VPS không trả jobId.');

      const result = await client.waitForJob(currentVpsJobId, {
        intervalMs: 1500,
        timeoutMs: 240000,
        shouldStop: () => vpsStopRequested,
        onUpdate(job) {
          const progress = job?.progress || {};
          const percent = Number(progress.percent || 0);
          const step = String(progress.step || job?.state || 'WAITING');
          S.setBridgeStatus(`VPS đang chạy UID ${account.uid}: ${step}${percent ? ` · ${percent}%` : ''}`, 'warn');
        }
      });

      if (B.closeAfterComment?.checked !== false) await closeActiveReadTabIfAny();
      S.setBridgeStatus(`VPS đã gửi bình luận thành công bằng UID ${account.uid}.`, 'ok');
      await refreshFacebookAccount({ silent: true });
      return result;
    } catch (error) {
      const requiresRotation = Boolean(error?.requiresAccountRotation || ACCOUNT_ROTATION_CODES.has(String(error?.code || '')));
      if (requiresRotation) {
        const restrictionMessage = error.message || `UID ${account.uid} không thể tiếp tục bình luận.`;
        S.setClosedLoopRunning(false);
        B.stopClosedLoopBtn?.classList.add('hidden');

        let rotationSuffix = '';
        try {
          const replacement = await logoutFacebookAccount({ automatic: true, reason: restrictionMessage });
          rotationSuffix = replacement?.uid ? ` Đã chuyển sang UID ${replacement.uid}.` : '';
        } catch (rotationError) {
          rotationSuffix = ` Không thể đổi tài khoản: ${rotationError.message || rotationError}.`;
        }

        fatalStopMessage = `${restrictionMessage}${rotationSuffix}`;
        S.setBridgeStatus(fatalStopMessage, 'error');
        const stopError = new Error(fatalStopMessage);
        stopError.stopClosedLoop = true;
        stopError.code = error.code || 'FACEBOOK_ACCOUNT_ROTATION_REQUIRED';
        throw stopError;
      }
      throw error;
    } finally {
      currentVpsJobId = '';
      vpsStopRequested = false;
    }
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
      fatalStopMessage = '';
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
          await readFirstFacebookPost();

          const controller = window.chatGPTApiController || {};
          if (!controller.generateComment) throw new Error('Chưa nạp được hàm gọi API ChatGPT.');
          const comment = await controller.generateComment();

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
          if (error?.stopClosedLoop || error?.code === 'FACEBOOK_FEATURE_RESTRICTED') {
            fatalStopMessage = error.message || fatalStopMessage || 'Facebook đang tạm giới hạn tính năng bình luận. Hệ thống đã dừng.';
            S.setClosedLoopRunning(false);
            B.stopClosedLoopBtn?.classList.add('hidden');
            S.setBridgeStatus(fatalStopMessage, 'error');
            break;
          }
          S.setBridgeStatus(`Lỗi ở link hiện tại, đã chuyển link kế tiếp:\n${error.message || error}`, 'error');
          S.setPostLinks(S.getPostLinks().filter(item => S.normalizeUrl(item) !== S.normalizeUrl(link)));
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

    fatalStopMessage = '';
    S.setClosedLoopRunning(true);
    B.stopClosedLoopBtn?.classList.remove('hidden');
    let cycleIndex = 1;

    try {
      while (S.isClosedLoopRunning()) {
        S.setBridgeStatus(`Đang chạy vòng ${cycleIndex}...`, 'warn');
        await scanGroupLinksByApify();
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
    } finally {
      S.setClosedLoopRunning(false);
      B.stopClosedLoopBtn?.classList.add('hidden');
      if (fatalStopMessage) S.setBridgeStatus(fatalStopMessage, 'error');
      else S.setBridgeStatus('Vòng lặp đã dừng.', 'warn');
    }
  }

  async function runBridgeTask(task) {
    if (S.isBridgeBusy()) {
      S.setBridgeStatus('Đang có tác vụ chạy, vui lòng đợi tác vụ hiện tại hoàn tất.', 'warn');
      return;
    }
    S.setBridgeBusy(true);
    [B.apifyScanBtn, B.scanGroupLinksBtn, B.autoWorkflowBtn, B.commentCurrentTabBtn].forEach(btn => { if (btn) btn.disabled = true; });
    try {
      return await task();
    } finally {
      S.setBridgeBusy(false);
      [B.apifyScanBtn, B.scanGroupLinksBtn, B.autoWorkflowBtn, B.commentCurrentTabBtn].forEach(btn => { if (btn) btn.disabled = false; });
    }
  }

  function wireSecretToggle(input, toggle, label) {
    if (!input || !toggle) return;
    toggle.addEventListener('click', () => {
      const wasHidden = input.type === 'password';
      input.type = wasHidden ? 'text' : 'password';
      toggle.textContent = wasHidden ? '🙈' : '👁';
      toggle.setAttribute('aria-label', wasHidden ? `Ẩn ${label}` : `Hiện ${label}`);
      toggle.title = wasHidden ? `Ẩn ${label}` : `Hiện ${label}`;
    });
  }

  function wireBridge() {
    S.addInputSave(B.extensionId, S.STORE.extensionId);
    S.addInputSave(B.facebookCookiesInput, S.STORE.facebookCookies);

    S.addInputSave(B.vpsApiUrlInput, S.STORE.vpsApiUrl);
    S.getVpsApiUrl();
    S.addInputSave(B.vpsApiTokenInput, S.STORE.vpsApiToken);
    wireSecretToggle(B.vpsApiTokenInput, B.vpsApiTokenToggle, 'VPS token');

    S.addInputSave(B.apifyActorIdInput, S.STORE.apifyActorId);
    S.getApifyActorId();
    S.addInputSave(B.apifyApiTokenInput, S.STORE.apifyToken);
    wireSecretToggle(B.apifyApiTokenInput, B.apifyApiTokenToggle, 'Apify token');
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

    B.vpsTestBtn?.addEventListener('click', () => {
      testVpsConnection().catch(error => setVpsConnectionStatus(error.message || String(error), 'error'));
    });
    B.vpsRefreshAccountsBtn?.addEventListener('click', () => {
      refreshFacebookAccount({ silent: false }).catch(() => {});
    });
    B.vpsImportCookieBtn?.addEventListener('click', () => {
      importNextFacebookCookie({ source: 'manual-import-button', autoRun: false }).catch(() => {});
    });
    B.vpsAccountSelect?.addEventListener('change', () => {
      S.setVpsAccountId(B.vpsAccountSelect.value);
      const account = selectedAccount();
      renderFacebookAccount({ account });
      if (account) setVpsConnectionStatus(`Đã chọn UID ${account.uid} để chạy các bình luận tiếp theo.`, 'ok');
    });
    B.vpsApiUrlInput?.addEventListener('change', () => refreshFacebookAccount({ silent: true }));
    B.vpsApiTokenInput?.addEventListener('change', () => refreshFacebookAccount({ silent: true }));
    B.vpsApiTokenInput?.addEventListener('blur', () => refreshFacebookAccount({ silent: true }));

    B.facebookLogoutBtn?.addEventListener('click', () => {
      logoutFacebookAccount({ automatic: false }).catch(error => S.setBridgeStatus(error.message || String(error), 'error'));
    });

    window.addEventListener('focus', () => refreshFacebookAccount({ silent: true }));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshFacebookAccount({ silent: true });
    });
    window.setTimeout(() => refreshFacebookAccount({ silent: true }), 200);
    window.setInterval(() => {
      if (!document.hidden && !S.isBridgeBusy()) refreshFacebookAccount({ silent: true });
    }, 10000);

    B.apifyScanBtn?.addEventListener('click', () => runBridgeTask(() => scanGroupLinksByApify()).catch(error => S.setBridgeStatus(error.message || String(error), 'error')));
    B.scanGroupLinksBtn?.addEventListener('click', () => runBridgeTask(() => runClosedGroupLoop()).catch(error => S.setBridgeStatus(error.message || String(error), 'error')));
    B.autoWorkflowBtn?.addEventListener('click', () => runBridgeTask(() => autoWorkflow()).catch(error => S.setBridgeStatus(error.message || String(error), 'error')));
    B.commentCurrentTabBtn?.addEventListener('click', () => runBridgeTask(() => commentCurrentTab()).catch(error => S.setBridgeStatus(error.message || String(error), 'error')));
    B.stopClosedLoopBtn?.addEventListener('click', () => {
      vpsStopRequested = true;
      S.setClosedLoopRunning(false);
      B.stopClosedLoopBtn.classList.add('hidden');
      if (currentVpsJobId) getVpsClient().cancelJob(currentVpsJobId).catch(() => {});
      S.setBridgeStatus(currentVpsJobId ? 'Đã gửi yêu cầu dừng job VPS.' : 'Đã dừng vòng lặp.', 'warn');
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
    scanGroupLinksByApify,
    runClosedGroupLoop,
    readFirstFacebookPost,
    autoWorkflow,
    commentCurrentTab,
    refreshFacebookAccount,
    logoutFacebookAccount
  };
}());
