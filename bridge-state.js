(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);

  const B = {
    extensionId: $('#bridgeExtensionId'),
    bridgeToken: $('#bridgeToken'),
    fbGroupIdInput: $('#fbGroupIdInput'),
    groupLimitInput: $('#groupLimitInput'),
    scanSourceModeSelect: $('#scanSourceModeSelect'),
    loopPauseSecondsInput: $('#loopPauseSecondsInput'),
    linkPauseSecondsInput: $('#linkPauseSecondsInput'),
    fbPostLinkInput: $('#fbPostLinkInput'),
    scanGroupLinksBtn: $('#scanGroupLinksBtn'),
    stopClosedLoopBtn: $('#stopClosedLoopBtn'),
    autoWorkflowBtn: $('#autoWorkflowBtn'),
    bridgeStatus: $('#bridgeStatus'),
    articleInput: $('#articleInput'),
    output: $('#output'),
    fbPageReadyTimeoutMs: $('#fbPageReadyTimeoutMs'),
    fbEditorTimeoutMs: $('#fbEditorTimeoutMs'),
    fbVerifyTimeoutMs: $('#fbVerifyTimeoutMs'),
    fbMaxRetries: $('#fbMaxRetries'),
    autoCommentAfterGenerate: $('#autoCommentAfterGenerate'),
    closeAfterComment: $('#closeAfterComment'),
    clearCommentedLinksBtn: $('#clearCommentedLinksBtn'),
    commentedLinksBox: $('#commentedLinksBox'),
    commentedCountStat: $('#commentedCountStat')
  };

  const STORE = {
    extensionId: 'truong_fb_bridge_extension_id_v2',
    bridgeToken: 'truong_fb_bridge_token_v2',
    groupIds: 'truong_fb_bridge_group_ids_v2',
    groupLimit: 'truong_fb_bridge_group_limit_v2',
    scanSourceMode: 'truong_fb_bridge_scan_source_mode_v2',
    loopPauseSeconds: 'truong_fb_bridge_loop_pause_seconds_v2',
    oldLoopPauseMinutes: 'truong_fb_bridge_loop_pause_minutes_v1',
    linkPauseSeconds: 'truong_fb_bridge_link_pause_seconds_v2',
    postLinks: 'truong_fb_bridge_post_links_v2',
    processed: 'truong_fb_bridge_processed_links_v2',
    legacyCommented: 'truong_fb_bridge_commented_links_v1',
    loopWanted: 'truong_fb_bridge_loop_wanted_v2',
    pageReadyTimeoutMs: 'truong_fb_page_ready_timeout_v2',
    editorTimeoutMs: 'truong_fb_editor_timeout_v2',
    verifyTimeoutMs: 'truong_fb_verify_timeout_v2',
    maxRetries: 'truong_fb_max_retries_v2'
  };

  const bridgeState = {
    closedLoopRunning: false,
    activeReadTabId: null,
    activeReadLink: '',
    bridgeBusy: false
  };

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function text(value) {
    return String(value || '').trim();
  }

  function clampNumber(value, fallback, min, max) {
    if (String(value ?? '').trim() === '') return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function getScanSourceMode() {
    const allowed = new Set(['group_latest', 'group_top', 'groups_feed', 'home_feed']);
    const value = allowed.has(String(B.scanSourceModeSelect?.value || ''))
      ? String(B.scanSourceModeSelect.value)
      : String(load(STORE.scanSourceMode, 'group_latest'));
    const normalized = allowed.has(value) ? value : 'group_latest';
    if (B.scanSourceModeSelect) B.scanSourceModeSelect.value = normalized;
    save(STORE.scanSourceMode, normalized);
    return normalized;
  }

  function getNumberInput(element, storageKey, fallback, min, max, integer = true) {
    const value = clampNumber(element?.value, fallback, min, max);
    const normalized = integer ? Math.round(value) : value;
    if (element) element.value = String(normalized);
    save(storageKey, normalized);
    return normalized;
  }

  function getGroupLimit() {
    return getNumberInput(B.groupLimitInput, STORE.groupLimit, 5, 1, 50);
  }

  function getLoopPauseSeconds() {
    let fallback = 240;
    const saved = load(STORE.loopPauseSeconds, null);
    if (saved !== null) fallback = clampNumber(saved, 240, 0, 86400);
    else {
      const oldMinutes = load(STORE.oldLoopPauseMinutes, null);
      if (oldMinutes !== null) fallback = Math.round(clampNumber(oldMinutes, 5, 0, 1440)) * 60;
    }
    return getNumberInput(B.loopPauseSecondsInput, STORE.loopPauseSeconds, fallback, 0, 86400);
  }

  function getLinkPauseSeconds() {
    return getNumberInput(B.linkPauseSecondsInput, STORE.linkPauseSeconds, 60, 0, 86400);
  }

  function getPageReadyTimeoutMs() {
    return getNumberInput(B.fbPageReadyTimeoutMs, STORE.pageReadyTimeoutMs, 10000, 3000, 120000);
  }

  function getEditorTimeoutMs() {
    return getNumberInput(B.fbEditorTimeoutMs, STORE.editorTimeoutMs, 5000, 1000, 60000);
  }

  function getVerifyTimeoutMs() {
    return getNumberInput(B.fbVerifyTimeoutMs, STORE.verifyTimeoutMs, 7000, 1500, 60000);
  }

  function getMaxRetries() {
    return getNumberInput(B.fbMaxRetries, STORE.maxRetries, 2, 0, 4);
  }

  function setBridgeStatus(message, type = '') {
    if (!B.bridgeStatus) return;
    B.bridgeStatus.textContent = String(message || '');
    B.bridgeStatus.className = 'automation-status' + (type ? ` ${type}` : '');
  }

  function addInputSave(element, key, fallback = null) {
    if (!element) return;
    const stored = load(key, null);
    if (stored !== null && stored !== undefined) element.value = String(stored);
    else if (fallback !== null && String(element.value || '') === '') element.value = String(fallback);
    const persist = () => save(key, element.value);
    element.addEventListener('input', persist);
    element.addEventListener('change', persist);
  }

  function parseLines(raw) {
    return String(raw || '')
      .split(/[\n,]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function cleanToken(value) {
    let token = String(value || '');
    try { token = decodeURIComponent(token); } catch {}
    return token.replace(/[/?#&"'<>\s\\].*$/g, '').replace(/^[:=]+|[:=]+$/g, '').trim();
  }

  function looksLikePostId(value) {
    const token = cleanToken(value);
    return /^\d{5,}$/.test(token)
      || /^pfbid[A-Za-z0-9_-]{8,}$/i.test(token)
      || (/^[A-Za-z0-9_-]{12,}$/.test(token) && /\d/.test(token));
  }

  function hashText(value) {
    let hash = 2166136261;
    const source = String(value || '');
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizeUrl(raw) {
    try {
      const url = new URL(String(raw || '').trim());
      url.hash = '';
      url.hostname = url.hostname.toLowerCase().replace(/^(m|mbasic|web)\.facebook\.com$/i, 'www.facebook.com');
      url.pathname = url.pathname.replace(/\/+$/, '');
      ['fbclid', 'mibextid', '__cft__', '__tn__', 'ref', 'refid', 'paipv'].forEach(key => url.searchParams.delete(key));
      return url.toString();
    } catch {
      return String(raw || '').trim();
    }
  }

  function postIdentity(raw) {
    const normalized = normalizeUrl(raw);
    try {
      const url = new URL(normalized);
      const path = decodeURIComponent(url.pathname || '').replace(/\/+$/, '');
      const groupMatch = path.match(/\/groups\/([^/]+)\/(posts|permalink)\/([^/?#]+)/i);
      if (groupMatch && looksLikePostId(groupMatch[3])) {
        const groupId = cleanToken(groupMatch[1]);
        const postId = cleanToken(groupMatch[3]);
        return {
          postKey: `g:${groupId}:${postId}`.toLowerCase(),
          canonicalUrl: `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/posts/${encodeURIComponent(postId)}/`
        };
      }
      const pageMatch = path.match(/^\/([^/]+)\/posts\/([^/?#]+)/i);
      if (pageMatch && looksLikePostId(pageMatch[2])) {
        const ownerId = cleanToken(pageMatch[1]);
        const postId = cleanToken(pageMatch[2]);
        return {
          postKey: `p:${ownerId}:${postId}`.toLowerCase(),
          canonicalUrl: `https://www.facebook.com/${encodeURIComponent(ownerId)}/posts/${encodeURIComponent(postId)}/`
        };
      }
      const postId = cleanToken(
        url.searchParams.get('story_fbid')
        || url.searchParams.get('fbid')
        || url.searchParams.get('post_id')
        || url.searchParams.get('top_level_post_id')
        || url.searchParams.get('multi_permalinks')
      );
      if (looksLikePostId(postId)) {
        const groupId = cleanToken(url.searchParams.get('group_id') || '');
        const ownerId = cleanToken(url.searchParams.get('id') || url.searchParams.get('owner_id') || groupId || 'unknown');
        return {
          postKey: (groupId ? `g:${groupId}:${postId}` : `p:${ownerId}:${postId}`).toLowerCase(),
          canonicalUrl: normalized
        };
      }
      return { postKey: `url:${hashText(normalized)}`, canonicalUrl: normalized };
    } catch {
      return { postKey: `raw:${hashText(normalized)}`, canonicalUrl: normalized };
    }
  }

  function uniqueLinks(lines) {
    const output = [];
    const seen = new Set();
    for (const line of lines) {
      const identity = postIdentity(line);
      if (!identity.canonicalUrl || seen.has(identity.postKey)) continue;
      seen.add(identity.postKey);
      output.push(identity.canonicalUrl);
    }
    return output;
  }

  function getProcessedRecords() {
    let records = load(STORE.processed, []);
    if (!Array.isArray(records)) records = [];
    if (!records.length) {
      const legacy = load(STORE.legacyCommented, []);
      if (Array.isArray(legacy) && legacy.length) {
        records = uniqueLinks(legacy).map(url => ({
          ...postIdentity(url),
          url,
          status: 'COMPLETED',
          processedAt: Date.now()
        }));
        save(STORE.processed, records);
      }
    }
    const map = new Map();
    for (const record of records) {
      const identity = postIdentity(record?.url || record?.canonicalUrl || '');
      if (!identity.canonicalUrl) continue;
      map.set(identity.postKey, {
        ...record,
        postKey: identity.postKey,
        url: identity.canonicalUrl,
        status: record?.status || 'COMPLETED'
      });
    }
    return [...map.values()].sort((a, b) => Number(b.processedAt || 0) - Number(a.processedAt || 0));
  }

  function renderCommentedLinks() {
    const records = getProcessedRecords();
    if (B.commentedLinksBox) {
      B.commentedLinksBox.value = records.map(record => `${record.status === 'SKIPPED_NEXT' ? '⏭️' : '✅'} ${record.url}`).join('\n');
    }
    if (B.commentedCountStat) B.commentedCountStat.textContent = String(records.length);
  }

  function processedKeySet() {
    return new Set(getProcessedRecords().map(record => record.postKey));
  }

  function filterNewLinks(links) {
    const processed = processedKeySet();
    return uniqueLinks(links).filter(link => !processed.has(postIdentity(link).postKey));
  }

  function syncPostLinksInput() {
    if (!B.fbPostLinkInput) return;
    const value = filterNewLinks(parseLines(B.fbPostLinkInput.value)).join('\n');
    if (B.fbPostLinkInput.value !== value) B.fbPostLinkInput.value = value;
    save(STORE.postLinks, value);
  }

  function setPostLinks(links) {
    if (!B.fbPostLinkInput) return;
    B.fbPostLinkInput.value = filterNewLinks(links).join('\n');
    save(STORE.postLinks, B.fbPostLinkInput.value);
    B.fbPostLinkInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function getPostLinks() {
    return filterNewLinks(parseLines(B.fbPostLinkInput?.value || ''));
  }

  function markProcessed(link, status) {
    const identity = postIdentity(link);
    if (!identity.canonicalUrl) return;
    const records = getProcessedRecords().filter(record => record.postKey !== identity.postKey);
    records.unshift({
      postKey: identity.postKey,
      url: identity.canonicalUrl,
      status,
      processedAt: Date.now()
    });
    save(STORE.processed, records.slice(0, 10000));
    renderCommentedLinks();
    syncPostLinksInput();
  }

  function saveCommentedLink(link) {
    markProcessed(link, 'COMPLETED');
  }

  function saveSkippedLink(link) {
    markProcessed(link, 'SKIPPED_NEXT');
  }

  function clearProcessedLinks() {
    save(STORE.processed, []);
    save(STORE.legacyCommented, []);
    renderCommentedLinks();
  }

  function wirePostLinksInput() {
    if (!B.fbPostLinkInput) return;
    const stored = load(STORE.postLinks, null);
    if (stored !== null) B.fbPostLinkInput.value = String(stored || '');
    syncPostLinksInput();
    B.fbPostLinkInput.addEventListener('input', syncPostLinksInput);
  }

  function getExtensionId() {
    const id = text(B.extensionId?.value);
    if (id) save(STORE.extensionId, id);
    return id;
  }

  function getBridgeToken() {
    const token = text(B.bridgeToken?.value);
    if (token) save(STORE.bridgeToken, token);
    return token;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function setClosedLoopRunning(value) {
    bridgeState.closedLoopRunning = Boolean(value);
    save(STORE.loopWanted, Boolean(value));
  }

  function isClosedLoopRunning() {
    return Boolean(bridgeState.closedLoopRunning);
  }

  function getLoopWanted() {
    return Boolean(load(STORE.loopWanted, false));
  }

  function setBridgeBusy(value) {
    bridgeState.bridgeBusy = Boolean(value);
  }

  function isBridgeBusy() {
    return Boolean(bridgeState.bridgeBusy);
  }

  function setActiveReadTab(tabId, link) {
    bridgeState.activeReadTabId = Number(tabId || 0) || null;
    bridgeState.activeReadLink = bridgeState.activeReadTabId ? String(link || '') : '';
  }

  function clearActiveReadTab() {
    bridgeState.activeReadTabId = null;
    bridgeState.activeReadLink = '';
  }

  function getActiveReadTabId() {
    return bridgeState.activeReadTabId;
  }

  function getActiveReadLink() {
    return bridgeState.activeReadLink;
  }

  window.fbBridgeShared = {
    $, B, STORE, save, load, text, clampNumber,
    getScanSourceMode, getGroupLimit, getLoopPauseSeconds, getLinkPauseSeconds,
    getPageReadyTimeoutMs, getEditorTimeoutMs, getVerifyTimeoutMs, getMaxRetries,
    setBridgeStatus, addInputSave, parseLines, normalizeUrl, postIdentity, uniqueLinks,
    getProcessedRecords, renderCommentedLinks, filterNewLinks, syncPostLinksInput,
    setPostLinks, getPostLinks, saveCommentedLink, saveSkippedLink, clearProcessedLinks,
    wirePostLinksInput, getExtensionId, getBridgeToken, delay,
    setClosedLoopRunning, isClosedLoopRunning, getLoopWanted,
    setBridgeBusy, isBridgeBusy,
    setActiveReadTab, clearActiveReadTab, getActiveReadTabId, getActiveReadLink
  };
}());
