'use strict';

(() => {
  if (globalThis.__TQT_FB_GROUP_SCANNER_INSTALLED__) return;
  globalThis.__TQT_FB_GROUP_SCANNER_INSTALLED__ = true;

  let activeTask = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function normalizePostUrl(rawHref, expectedGroupId) {
    if (!rawHref) return null;
    let url;
    try {
      url = new URL(rawHref, window.location.origin);
    } catch (_) {
      return null;
    }
    if (!url.hostname.endsWith('facebook.com')) return null;

    const pathMatch = url.pathname.match(/\/groups\/(\d+)\/(posts|permalink)\/([A-Za-z0-9._-]+)/i);
    if (pathMatch) {
      const groupId = pathMatch[1];
      const type = pathMatch[2].toLowerCase();
      const postId = pathMatch[3];
      if (expectedGroupId && groupId !== String(expectedGroupId)) return null;
      const canonicalPath = type === 'permalink'
        ? `/groups/${groupId}/permalink/${postId}/`
        : `/groups/${groupId}/posts/${postId}/`;
      return { groupId, postId, url: `https://www.facebook.com${canonicalPath}` };
    }

    const groupPath = url.pathname.match(/\/groups\/(\d+)/i);
    const storyId = url.searchParams.get('story_fbid') || url.searchParams.get('fbid');
    if (groupPath && storyId) {
      const groupId = groupPath[1];
      if (expectedGroupId && groupId !== String(expectedGroupId)) return null;
      return {
        groupId,
        postId: storyId,
        url: `https://www.facebook.com/groups/${groupId}/permalink/${storyId}/`
      };
    }
    return null;
  }

  function isPinnedArticle(article) {
    const text = String(article?.innerText || '').slice(0, 1200).toLowerCase();
    return /đã ghim|bài viết đã ghim|pinned post|featured post/.test(text);
  }

  function collectPosts(groupId, excludePinned) {
    const result = [];
    const seen = new Set();
    let articles = [...document.querySelectorAll('div[role="feed"] div[role="article"], div[role="main"] div[role="article"]')];
    if (!articles.length) articles = [...document.querySelectorAll('div[role="article"]')];

    for (const article of articles) {
      if (!isVisible(article)) continue;
      if (excludePinned && isPinnedArticle(article)) continue;
      const anchors = [...article.querySelectorAll('a[href]')];
      for (const anchor of anchors) {
        const post = normalizePostUrl(anchor.href, groupId);
        if (!post) continue;
        const key = `${post.groupId}:${post.postId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(post);
      }
    }

    if (!result.length) {
      for (const anchor of document.querySelectorAll(`a[href*="/groups/${CSS.escape(String(groupId))}/"]`)) {
        const post = normalizePostUrl(anchor.href, groupId);
        if (!post) continue;
        const key = `${post.groupId}:${post.postId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(post);
      }
    }
    return result;
  }

  function waitForMutation(timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve();
      };
      const observer = new MutationObserver(() => finish());
      observer.observe(document.documentElement, { childList: true, subtree: true });
      const timer = setTimeout(finish, timeoutMs);
    });
  }

  async function waitForFeed(timeoutMs = 25_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (document.querySelector('div[role="feed"], div[role="main"]')) return true;
      if (/login|checkpoint/i.test(location.href)) return false;
      await sleep(500);
    }
    return false;
  }

  function emitProgress(data) {
    chrome.runtime.sendMessage({ type: 'GROUP_SCAN_PROGRESS', data }).catch(() => undefined);
  }

  async function scanGroup(requestId, payload) {
    if (activeTask) {
      return { success: false, code: 'SCAN_ALREADY_RUNNING', message: 'Content script đang quét một nhóm khác' };
    }

    const groupId = String(payload.groupId || '').match(/\d{5,}/)?.[0];
    if (!groupId) return { success: false, code: 'INVALID_GROUP_ID', message: 'Group ID không hợp lệ' };

    const task = {
      requestId,
      stopped: false,
      groupId,
      posts: new Map()
    };
    activeTask = task;

    const targetCount = Math.max(1, Math.min(1000, Number(payload.targetCount) || 20));
    const maxScrolls = Math.max(1, Math.min(200, Number(payload.maxScrolls) || 35));
    const delayMs = Math.max(500, Math.min(10_000, Number(payload.delayMs) || 1800));
    const staleLimit = Math.max(2, Math.min(20, Number(payload.staleRounds) || 5));
    const excludePinned = payload.excludePinned !== false;

    try {
      const feedReady = await waitForFeed();
      if (!feedReady) {
        const code = /login/i.test(location.href) ? 'FB_LOGIN_REQUIRED' : /checkpoint/i.test(location.href) ? 'FB_CHECKPOINT' : 'FEED_NOT_FOUND';
        return { success: false, code, message: 'Không tải được feed nhóm Facebook' };
      }

      let staleRounds = 0;
      for (let round = 0; round <= maxScrolls; round += 1) {
        if (task.stopped) return { success: false, code: 'SCAN_STOPPED', message: 'Tiến trình quét đã dừng' };

        const before = task.posts.size;
        for (const post of collectPosts(groupId, excludePinned)) {
          task.posts.set(`${post.groupId}:${post.postId}`, post);
          if (task.posts.size >= targetCount) break;
        }
        const added = task.posts.size - before;
        staleRounds = added > 0 ? 0 : staleRounds + 1;

        emitProgress({
          requestId,
          groupId,
          found: task.posts.size,
          targetCount,
          scrollRound: round,
          maxScrolls,
          staleRounds,
          message: added > 0 ? `Thêm ${added} link mới` : 'Chưa có link mới'
        });

        if (task.posts.size >= targetCount || staleRounds >= staleLimit || round >= maxScrolls) break;

        const articles = [...document.querySelectorAll('div[role="article"]')].filter(isVisible);
        const lastArticle = articles.at(-1);
        if (lastArticle) lastArticle.scrollIntoView({ block: 'end', behavior: 'auto' });
        window.scrollBy({ top: Math.max(window.innerHeight * 1.4, 1100), behavior: 'auto' });
        await waitForMutation(delayMs);
        if (!task.stopped) await sleep(Math.min(600, Math.floor(delayMs / 3)));
      }

      const posts = [...task.posts.values()].slice(0, targetCount).map((post) => ({
        ...post,
        scannedAt: new Date().toISOString()
      }));
      return {
        success: true,
        code: 'OK',
        message: `Đã quét ${posts.length} link`,
        data: { groupId, posts, count: posts.length }
      };
    } catch (error) {
      return {
        success: false,
        code: 'SCAN_RUNTIME_ERROR',
        message: error?.message || String(error)
      };
    } finally {
      activeTask = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'FB_STOP_GROUP_SCAN') {
      if (activeTask && (!message.requestId || activeTask.requestId === message.requestId)) activeTask.stopped = true;
      sendResponse({ success: true, code: 'OK', message: 'Đã nhận lệnh dừng' });
      return false;
    }

    if (message?.type !== 'FB_SCAN_GROUP_POSTS') return false;
    scanGroup(message.requestId, message.payload || {}).then(sendResponse);
    return true;
  });
})();
