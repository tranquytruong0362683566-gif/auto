(() => {
  'use strict';

  const PAGE_LIST_DOC_ID = '25995449010122559';
  const PAGE_LIST_FRIENDLY_NAME = 'PagesCometLaunchPointUnifiedQueryPagesListRedesignedUpdatedPagesSectionQuery';
  const credentialCache = { value: null, expiresAt: 0 };
  const pageCredentialCache = new Map();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function cleanFacebookText(text) {
    return String(text || '').replace(/^for \(;;\);/, '').trim();
  }

  function parseFacebookJson(text) {
    const cleaned = cleanFacebookText(text);
    if (!cleaned) throw new Error('Facebook trả về dữ liệu rỗng');

    try {
      return JSON.parse(cleaned);
    } catch (_) {
      const lines = cleaned.split(/\r?\n/).map((line) => line.replace(/^for \(;;\);/, '').trim()).filter(Boolean);
      let lastParsed = null;
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          lastParsed = parsed;
          if (parsed?.data) return parsed;
        } catch (_) {
          // Bỏ qua dòng stream không phải JSON hoàn chỉnh.
        }
      }
      if (lastParsed) return lastParsed;
      throw new Error(`Không phân tích được phản hồi Facebook: ${cleaned.slice(0, 300)}`);
    }
  }

  function decodeHtml(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value || '';
    return textarea.value;
  }

  function chooseCookie(cookies, name) {
    const matches = cookies.filter((cookie) => cookie.name === name);
    if (!matches.length) return null;
    matches.sort((a, b) => {
      const domainScoreA = a.domain === '.facebook.com' ? 2 : a.domain.endsWith('facebook.com') ? 1 : 0;
      const domainScoreB = b.domain === '.facebook.com' ? 2 : b.domain.endsWith('facebook.com') ? 1 : 0;
      return domainScoreB - domainScoreA || String(b.path || '').length - String(a.path || '').length;
    });
    return matches[0];
  }

  function buildCookieMap(cookies) {
    const names = new Set(cookies.map((cookie) => cookie.name));
    const map = {};
    for (const name of names) {
      const cookie = chooseCookie(cookies, name);
      if (cookie) map[name] = cookie.value;
    }
    return map;
  }

  function buildCookieString(cookieMap, overrides = {}) {
    const merged = { ...cookieMap, ...overrides };
    return Object.entries(merged)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([name, value]) => `${name}=${String(value).replace(/[\r\n;]/g, '')}`)
      .join('; ');
  }

  function computeJazoest(token) {
    let total = 0;
    for (const char of String(token || '')) total += char.charCodeAt(0);
    return `2${total}`;
  }

  function extractTokensFromHtml(html) {
    const text = String(html || '');
    const tokenPatterns = [
      /"DTSGInitialData"[\s\S]{0,900}?"token"\s*:\s*"([^"]+)"/i,
      /name=["']fb_dtsg["'][^>]*value=["']([^"']+)["']/i,
      /"fb_dtsg"\s*:\s*"([^"]+)"/i,
      /DTSGInitialData[^\n]{0,800}?token\\?"?\s*[:=]\s*\\?"([^"\\]+)/i
    ];
    const jazoestPatterns = [
      /name=["']jazoest["'][^>]*value=["'](\d+)["']/i,
      /"jazoest"\s*:\s*"?(\d+)"?/i,
      /jazoest=(\d+)/i
    ];
    const lsdPatterns = [
      /"LSD"[\s\S]{0,500}?"token"\s*:\s*"([^"]+)"/i,
      /name=["']lsd["'][^>]*value=["']([^"']+)["']/i
    ];

    let token = null;
    let jazoest = null;
    let lsd = null;
    for (const pattern of tokenPatterns) {
      const match = text.match(pattern);
      if (match?.[1]) { token = decodeHtml(match[1]); break; }
    }
    for (const pattern of jazoestPatterns) {
      const match = text.match(pattern);
      if (match?.[1]) { jazoest = match[1]; break; }
    }
    for (const pattern of lsdPatterns) {
      const match = text.match(pattern);
      if (match?.[1]) { lsd = decodeHtml(match[1]); break; }
    }

    return { token, jazoest: jazoest || (token ? computeJazoest(token) : null), lsd };
  }

  async function fetchHtml(url, cookie) {
    const response = await window.ExtensionClient.httpRequest({
      url,
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'vi-VN,vi;q=0.9,en;q=0.7',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        cookie
      },
      timeoutMs: 60_000
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} khi đọc ${new URL(url).hostname}: ${text.slice(0, 200)}`);
    return text;
  }

  async function getBaseCredential(force = false) {
    if (!force && credentialCache.value && credentialCache.expiresAt > Date.now()) return credentialCache.value;

    const session = await window.ExtensionClient.getFacebookSession();
    const cookies = Array.isArray(session?.cookies) ? session.cookies : [];
    const cookieMap = buildCookieMap(cookies);
    const cUser = cookieMap.c_user || null;
    if (!cUser) throw new Error('Chrome chưa đăng nhập Facebook hoặc Extension không đọc được cookie c_user');

    const cookie = buildCookieString(cookieMap);
    let html = '';
    let extracted = { token: null, jazoest: null, lsd: null };
    const sources = [
      'https://business.facebook.com/content_management',
      'https://www.facebook.com/pages/?category=your_pages&ref=bookmarks',
      'https://www.facebook.com/'
    ];

    for (const url of sources) {
      try {
        html = await fetchHtml(url, cookie);
        extracted = extractTokensFromHtml(html);
        if (extracted.token) break;
      } catch (error) {
        console.warn('[FacebookAPI] Token source failed:', url, error);
      }
    }

    if (!extracted.token) {
      throw new Error('Không tìm thấy fb_dtsg trong phiên Facebook. Hãy mở Facebook, tải lại trang rồi kết nối lại.');
    }

    const value = {
      uid: cUser,
      token: extracted.token,
      jazoest: extracted.jazoest || computeJazoest(extracted.token),
      lsd: extracted.lsd || '',
      cookie,
      cookieMap,
      cookies,
      machineId: session?.machineId || null,
      customToken: session?.customToken || null,
      useTokenMode: Boolean(session?.useTokenMode)
    };

    credentialCache.value = value;
    credentialCache.expiresAt = Date.now() + 120_000;
    return value;
  }

  async function fetchPagesByGraphToken(baseCredential) {
    const token = baseCredential.customToken;
    if (!token || !String(token).startsWith('EAA')) return [];

    const pages = [];
    let nextUrl = `https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,picture.type(normal)&limit=200&access_token=${encodeURIComponent(token)}`;
    let pageCount = 0;

    while (nextUrl && pageCount < 30) {
      pageCount += 1;
      const response = await window.ExtensionClient.httpRequest({ url: nextUrl, method: 'GET', timeoutMs: 60_000 });
      const payload = parseFacebookJson(await response.text());
      if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
      for (const item of payload.data || []) {
        pages.push({
          id: String(item.id),
          name: item.name || String(item.id),
          avatar: item.picture?.data?.url || `https://graph.facebook.com/${item.id}/picture?type=normal`,
          iUser: null,
          accessToken: item.access_token || null,
          source: 'graph-token'
        });
      }
      nextUrl = payload.paging?.next || null;
      if (nextUrl) await sleep(250);
    }
    return pages;
  }

  async function fetchPagesByCookie(baseCredential, onBatch) {
    const pages = [];
    let cursor = null;
    let hasNext = true;
    let batch = 0;
    const lsd = baseCredential.lsd || btoa(baseCredential.token.slice(0, 16)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'defaultLsd';

    while (hasNext && batch < 30) {
      batch += 1;
      const variables = { count: 100, scale: 1 };
      if (cursor) variables.cursor = cursor;

      const body = new URLSearchParams({
        av: baseCredential.uid,
        __aaid: '0',
        __user: baseCredential.uid,
        __a: '1',
        __req: String(Math.floor(Math.random() * 10_000)),
        __hs: '20566.HCSV2:comet_pkg.2.1...0',
        dpr: '1',
        __ccg: 'EXCELLENT',
        __rev: '1037977667',
        __s: `${Math.random().toString(36).slice(2, 8)}:${Math.random().toString(36).slice(2, 8)}:${Math.random().toString(36).slice(2, 8)}`,
        __hsi: `${Date.now()}0`,
        __dyn: '1',
        __csr: '1',
        __comet_req: '15',
        fb_dtsg: baseCredential.token,
        jazoest: baseCredential.jazoest,
        lsd,
        __spin_r: '1037977667',
        __spin_b: 'trunk',
        __spin_t: String(Math.floor(Date.now() / 1000)),
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: PAGE_LIST_FRIENDLY_NAME,
        server_timestamps: 'true',
        variables: JSON.stringify(variables),
        doc_id: PAGE_LIST_DOC_ID
      });

      const response = await window.ExtensionClient.httpRequest({
        url: 'https://www.facebook.com/api/graphql/',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://www.facebook.com',
          referer: 'https://www.facebook.com/pages/?category=your_pages&ref=bookmarks',
          'x-fb-friendly-name': PAGE_LIST_FRIENDLY_NAME,
          'x-fb-lsd': lsd,
          cookie: baseCredential.cookie
        },
        body: { kind: 'text', content: body.toString() },
        timeoutMs: 90_000
      });

      const text = await response.text();
      if (!response.ok) throw new Error(`Facebook Page API HTTP ${response.status}: ${text.slice(0, 350)}`);
      const payload = parseFacebookJson(text);
      if (payload.errors) throw new Error(`GraphQL: ${JSON.stringify(payload.errors).slice(0, 500)}`);

      const connection = payload?.data?.viewer?.actor?.additional_profiles_with_biz_tools;
      const edges = connection?.edges;
      const pageInfo = connection?.page_info;
      if (!Array.isArray(edges)) throw new Error(`Cấu trúc danh sách Page đã thay đổi: ${text.slice(0, 350)}`);

      for (const edge of edges) {
        const node = edge?.node;
        if (!node) continue;
        const id = node.delegate_page_id || node.id;
        if (!id) continue;
        pages.push({
          id: String(id),
          name: node.name || String(id),
          avatar: node.profile_picture?.uri || `https://graph.facebook.com/${id}/picture?type=normal`,
          iUser: node.if_viewer_can_login_as_profile_plus?.id || node.id || null,
          unseenMessageCount: Number(node.unseen_message_count || 0),
          source: 'cookie-graphql'
        });
      }

      if (typeof onBatch === 'function') onBatch({ batch, total: pages.length, received: edges.length });
      hasNext = Boolean(pageInfo?.has_next_page);
      cursor = pageInfo?.end_cursor || null;
      if (!hasNext || !cursor || edges.length === 0) break;
      await sleep(400);
    }

    const unique = new Map();
    for (const page of pages) unique.set(page.id, page);
    return [...unique.values()];
  }

  async function fetchPages({ forceCredential = false, onBatch } = {}) {
    const baseCredential = await getBaseCredential(forceCredential);
    let pages = [];

    if (baseCredential.customToken?.startsWith('EAA')) {
      try {
        pages = await fetchPagesByGraphToken(baseCredential);
      } catch (error) {
        console.warn('[FacebookAPI] Graph token page list failed, fallback to cookie GraphQL:', error);
      }
    }

    if (!pages.length) pages = await fetchPagesByCookie(baseCredential, onBatch);
    pages.sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi', { sensitivity: 'base' }));
    return { pages, credential: baseCredential };
  }

  async function getPageCredential(page, force = false) {
    const pageId = String(page?.id || page);
    if (!force && pageCredentialCache.has(pageId)) {
      const cached = pageCredentialCache.get(pageId);
      if (cached.expiresAt > Date.now()) return cached.value;
    }

    const base = await getBaseCredential(force);
    let iUser = page?.iUser || null;

    if (!iUser) {
      try {
        const html = await fetchHtml(`https://www.facebook.com/${pageId}`, base.cookie);
        iUser = html.match(/"selectedID"\s*:\s*"(\d+)"/)?.[1]
          || html.match(/"profile_switcher_eligible_profiles"[\s\S]{0,1800}?"id"\s*:\s*"(\d+)"/)?.[1]
          || null;
      } catch (error) {
        console.warn('[FacebookAPI] Không lấy được i_user từ HTML:', error);
      }
    }

    iUser ||= pageId;
    const cookie = buildCookieString(base.cookieMap, { i_user: iUser });
    const value = {
      pageId,
      iUser,
      cUser: base.uid,
      token: base.token,
      jazoest: base.jazoest,
      lsd: base.lsd,
      cookie,
      accessToken: page?.accessToken || null
    };
    pageCredentialCache.set(pageId, { value, expiresAt: Date.now() + 120_000 });
    return value;
  }

  function clearCredentialCache() {
    credentialCache.value = null;
    credentialCache.expiresAt = 0;
    pageCredentialCache.clear();
  }

  window.FacebookAPI = Object.freeze({
    sleep,
    cleanFacebookText,
    parseFacebookJson,
    buildCookieString,
    getBaseCredential,
    fetchPages,
    getPageCredential,
    clearCredentialCache
  });
})();
