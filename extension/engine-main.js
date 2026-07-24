(function () {
  'use strict';

  if (window.__groupPublisherEngineMain) return;
  window.__groupPublisherEngineMain = true;

  const RELAY_SOURCE = 'GROUP_PUBLISHER_ENGINE_RELAY';
  const MAIN_SOURCE = 'GROUP_PUBLISHER_ENGINE_MAIN';
  const COMPOSER_NAME = 'ComposerStoryCreateMutation';
  const GRAPHQL_URL = `${location.origin}/api/graphql/`;
  const FALLBACK_DOC_IDS = Object.freeze({
    ComposerStoryCreateMutation: [
      '25879074401770690',
      '34112687938376332',
      '26440597318868884'
    ],
    MediaUploadFBDefaultServerConfigurationRetrieverQuery: [
      '24229633186643574'
    ],
    useCometVideoUploaderConfigQuery: [
      '9734072893355148'
    ]
  });
  const activeRequests = new Map();
  const documentIdCache = new Map();
  let requestCounter = 0;

  function result(success, code, message, data = null) {
    return { success, code, message, data };
  }

  function reply(requestId, response) {
    window.postMessage({
      source: MAIN_SOURCE,
      type: 'GROUP_PUBLISHER_ENGINE_RESPONSE',
      requestId,
      response
    }, location.origin);
  }

  function progress(requestId, index, total, label) {
    window.postMessage({
      source: MAIN_SOURCE,
      type: 'GROUP_PUBLISHER_ENGINE_PROGRESS',
      requestId,
      step: { index, total, label }
    }, location.origin);
  }

  function fbRequire(name) {
    try {
      return typeof window.require === 'function' ? window.require(name) : undefined;
    } catch {
      return undefined;
    }
  }

  function decodeEscaped(value) {
    return String(value || '')
      .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
      .replaceAll('\\/', '/')
      .replaceAll('\\"', '"')
      .replaceAll('\\\\', '\\')
      .replaceAll('&amp;', '&')
      .replaceAll('&#039;', "'")
      .replaceAll('&quot;', '"');
  }

  function firstMatch(text, patterns) {
    for (const pattern of patterns) {
      const match = String(text || '').match(pattern);
      if (match?.[1]) return decodeEscaped(match[1]);
    }
    return '';
  }

  function inlinePageData() {
    const parts = [];
    for (const script of document.scripts) {
      if (!script.src && script.textContent) parts.push(script.textContent);
    }
    return parts.join('\n');
  }

  function computeJazoest(token) {
    let sum = 0;
    for (const character of String(token || '')) sum += character.charCodeAt(0);
    return `2${sum}`;
  }

  function currentSession() {
    const user = fbRequire('CurrentUserInitialData') || {};
    const dtsg = fbRequire('DTSGInitialData') || {};
    const lsdModule = fbRequire('LSD') || {};
    const site = fbRequire('SiteData') || {};
    const page = inlinePageData();

    const userId = String(
      user.USER_ID
      || user.ACCOUNT_ID
      || firstMatch(page, [
        /"CurrentUserInitialData"[^]*?"USER_ID"\s*:\s*"(\d{5,30})"/i,
        /"USER_ID"\s*:\s*"(\d{5,30})"/i,
        /"ACCOUNT_ID"\s*:\s*"(\d{5,30})"/i,
        /"actorID"\s*:\s*"(\d{5,30})"/i
      ])
      || ''
    );
    const fbDtsg = String(
      dtsg.token
      || firstMatch(page, [
        /"DTSGInitialData"[^]*?"token"\s*:\s*"([^"]+)"/i,
        /name="fb_dtsg"\s+value="([^"]+)"/i,
        /"fb_dtsg"\s*:\s*"([^"]+)"/i
      ])
      || ''
    );
    const lsd = String(
      lsdModule.token
      || firstMatch(page, [
        /"LSD"[^]*?"token"\s*:\s*"([^"]+)"/i,
        /name="lsd"\s+value="([^"]+)"/i,
        /"lsd"\s*:\s*"([^"]+)"/i
      ])
      || ''
    );
    const rev = String(
      site.client_revision
      || firstMatch(page, [
        /"client_revision"\s*:\s*(\d+)/i,
        /"__spin_r"\s*:\s*(\d+)/i,
        /"rev"\s*:\s*(\d+)/i
      ])
      || ''
    );
    const hsi = String(
      site.hsi
      || firstMatch(page, [/"hsi"\s*:\s*"(\d+)"/i, /"__hsi"\s*:\s*"(\d+)"/i])
      || ''
    );
    const hasteSession = String(
      site.haste_session
      || firstMatch(page, [/"haste_session"\s*:\s*"([^"]+)"/i, /"__hs"\s*:\s*"([^"]+)"/i])
      || ''
    );
    const spinT = String(
      site.__spin_t
      || firstMatch(page, [/"_?_?spin_t"\s*:\s*(\d+)/i])
      || Math.floor(Date.now() / 1000)
    );
    const spinS = String(
      site.__spin_s
      || firstMatch(page, [/"_?_?spin_s"\s*:\s*"([^"]+)"/i])
      || ''
    );

    return {
      userId,
      fbDtsg,
      lsd,
      jazoest: computeJazoest(fbDtsg),
      rev,
      hsi,
      hasteSession,
      spinT,
      spinS,
      spinB: String(site.__spin_b || 'trunk')
    };
  }

  function requireSession() {
    const session = currentSession();
    if (!session.userId) {
      throw Object.assign(new Error(
        'Chrome chưa đăng nhập Facebook trong tab nền. Hãy đăng nhập rồi chạy lại.'
      ), { code: 'FACEBOOK_NOT_LOGGED_IN' });
    }
    if (!session.fbDtsg || !session.lsd) {
      throw Object.assign(new Error(
        'Không đọc được token phiên Facebook hiện tại. Hãy tải lại facebook.com rồi thử lại.'
      ), { code: 'FACEBOOK_SESSION_TOKEN_MISSING' });
    }
    return session;
  }

  function extractModuleDocId(value) {
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value);
      return /^\d{10,}$/.test(text) ? text : '';
    }
    if (!value || typeof value !== 'object') return '';
    const candidates = [
      value.id,
      value.doc_id,
      value.queryID,
      value.params?.id,
      value.default?.id,
      value.default?.params?.id
    ];
    return candidates.map(String).find((item) => /^\d{10,}$/.test(item)) || '';
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function docIdFromText(text, operationName) {
    const source = String(text || '');
    if (!source.includes(operationName)) return '';
    const name = escapeRegex(operationName);
    const patterns = [
      new RegExp(`"${name}_facebookRelayOperation"[\\s\\S]{0,1600}?(?:exports|return)\\s*=*\\s*"?(\\d{10,})"?`),
      new RegExp(`"${name}_facebookRelayOperation"[\\s\\S]{0,1600}?"(\\d{10,})"`),
      new RegExp(`(?:name|queryName)\\s*:\\s*"${name}"[\\s\\S]{0,2200}?(?:id|queryID)\\s*:\\s*"(\\d{10,})"`),
      new RegExp(`(?:id|queryID)\\s*:\\s*"(\\d{10,})"[\\s\\S]{0,2200}?(?:name|queryName)\\s*:\\s*"${name}"`),
      new RegExp(`"queryID"\\s*:\\s*"(\\d{10,})"[\\s\\S]{0,1200}?"queryName"\\s*:\\s*"${name}"`)
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1]) return match[1];
    }
    return '';
  }

  async function docIdFromLoadedResources(operationName) {
    const urls = new Set();
    for (const script of document.scripts) {
      if (script.src) urls.add(script.src);
    }
    for (const entry of performance.getEntriesByType?.('resource') || []) {
      const url = String(entry?.name || '');
      if (/\.js(?:\?|$)|\/rsrc\.php/i.test(url)) urls.add(url);
    }

    const candidates = [...urls]
      .filter((url) => /^https:\/\/(?:static\.[^/]*fbcdn\.net|[^/]*facebook\.com)\//i.test(url))
      .slice(0, 64);
    for (let offset = 0; offset < candidates.length; offset += 8) {
      const batch = candidates.slice(offset, offset + 8);
      const bodies = await Promise.all(batch.map(async (url) => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'omit',
            cache: 'force-cache'
          });
          if (!response.ok) return '';
          return response.text();
        } catch {
          return '';
        }
      }));
      for (const body of bodies) {
        const found = docIdFromText(body, operationName);
        if (found) return found;
      }
    }
    return '';
  }

  async function resolveDocId(operationName) {
    const cached = documentIdCache.get(operationName);
    if (cached) return { id: cached, source: 'cache' };

    const moduleNames = [
      `${operationName}_facebookRelayOperation`,
      `${operationName}.graphql`,
      operationName
    ];
    for (const moduleName of moduleNames) {
      const id = extractModuleDocId(fbRequire(moduleName));
      if (id) {
        documentIdCache.set(operationName, id);
        return { id, source: `module:${moduleName}` };
      }
    }

    const inline = docIdFromText(inlinePageData(), operationName);
    if (inline) {
      documentIdCache.set(operationName, inline);
      return { id: inline, source: 'page-data' };
    }

    const resource = await docIdFromLoadedResources(operationName);
    if (resource) {
      documentIdCache.set(operationName, resource);
      return { id: resource, source: 'loaded-resource' };
    }
    return null;
  }

  function safeJson(value) {
    const text = String(value || '')
      .trim()
      .replace(/^for\s*\(\s*;;\s*\);\s*/, '')
      .replace(/^\)\]\}'\s*/, '');
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      const rows = [];
      for (const line of text.split(/\r?\n/)) {
        try {
          rows.push(JSON.parse(
            line
              .trim()
              .replace(/^for\s*\(\s*;;\s*\);\s*/, '')
              .replace(/^\)\]\}'\s*/, '')
          ));
        } catch {
          // Streaming GraphQL responses can contain non-JSON lines.
        }
      }
      return rows.length ? rows : null;
    }
  }

  function walk(value, visitor, depth = 0) {
    if (value == null || depth > 16) return;
    visitor(value);
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, visitor, depth + 1));
    } else if (typeof value === 'object') {
      Object.values(value).forEach((item) => walk(item, visitor, depth + 1));
    }
  }

  function criticalErrors(value) {
    const output = [];
    walk(value, (item) => {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item.errors)) {
        for (const error of item.errors) {
          const severity = String(error?.severity || error?.level || '').toUpperCase();
          if (severity === 'WARNING' || severity === 'INFO') continue;
          const message = error?.message
            || error?.description
            || error?.summary
            || error?.code;
          if (message) output.push(String(message));
        }
      }
      if (item.error && typeof item.error === 'object') {
        const message = item.error.message
          || item.error.error_user_msg
          || item.error.error_user_title
          || item.error.code;
        if (message) output.push(String(message));
      }
      if (item.errorSummary || item.errorDescription) {
        output.push(String(item.errorDescription || item.errorSummary));
      }
    });
    return [...new Set(output)];
  }

  function deepFind(value, keys) {
    const wanted = new Set(keys);
    let found;
    walk(value, (item) => {
      if (found !== undefined || !item || typeof item !== 'object' || Array.isArray(item)) return;
      for (const [key, child] of Object.entries(item)) {
        if (wanted.has(key) && child != null) {
          found = child;
          break;
        }
      }
    });
    return found;
  }

  function postReference(value, groupId) {
    let postUrl = '';
    let postId = '';
    const visit = (item, path = '', depth = 0) => {
      if (item == null || depth > 16) return;
      if (Array.isArray(item)) {
        item.forEach((child, index) => visit(child, `${path}.${index}`, depth + 1));
        return;
      }
      if (typeof item === 'object') {
        Object.entries(item).forEach(([key, child]) => visit(child, `${path}.${key}`, depth + 1));
        return;
      }
      const text = String(item);
      if (!postUrl && /(?:permalink|story|posts?)_?url|url$/i.test(path) && /^https?:\/\//i.test(text)) {
        postUrl = text.replaceAll('\\/', '/');
      }
      if (!postId && /(?:post|story|feedback).*id$/i.test(path) && /^\d{5,40}(?:_\d{5,40})?$/.test(text)) {
        postId = text.includes('_') ? text.split('_').at(-1) : text;
      }
    };
    visit(value);
    if (!postUrl && postId) {
      postUrl = `https://www.facebook.com/groups/${groupId}/permalink/${postId}/`;
    }
    return { postUrl, postId };
  }

  function appendSessionParams(params, session) {
    requestCounter += 1;
    params.set('av', session.userId);
    params.set('__aaid', '0');
    params.set('__user', session.userId);
    params.set('__a', '1');
    params.set('__req', requestCounter.toString(36));
    if (session.hasteSession) params.set('__hs', session.hasteSession);
    params.set('dpr', String(Math.max(1, Math.round(window.devicePixelRatio || 1))));
    params.set('__ccg', 'EXCELLENT');
    if (session.rev) {
      params.set('__rev', session.rev);
      params.set('__spin_r', session.rev);
    }
    if (session.hsi) params.set('__hsi', session.hsi);
    if (session.spinS) params.set('__s', session.spinS);
    params.set('__comet_req', '15');
    params.set('fb_dtsg', session.fbDtsg);
    params.set('jazoest', session.jazoest);
    params.set('lsd', session.lsd);
    params.set('__spin_b', session.spinB || 'trunk');
    if (session.spinT) params.set('__spin_t', session.spinT);
    params.set('__crn', 'comet.fbweb.CometGroupDiscussionRoute');
    return params;
  }

  function graphqlBody(session, friendlyName, docId, variables) {
    const params = appendSessionParams(new URLSearchParams(), session);
    params.set('fb_api_caller_class', 'RelayModern');
    params.set('fb_api_req_friendly_name', friendlyName);
    params.set('variables', JSON.stringify(variables));
    params.set('doc_id', docId);
    params.set('server_timestamps', 'true');
    return params;
  }

  async function checkedFetch(url, options, signal, code) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        credentials: 'include',
        signal,
        cache: 'no-store'
      });
    } catch (error) {
      if (signal?.aborted) {
        throw Object.assign(new Error('Tiến trình đã được dừng bởi người dùng.'), { code: 'JOB_PAUSED' });
      }
      throw Object.assign(new Error(`Lỗi mạng Facebook: ${error?.message || String(error)}`), {
        code: 'FACEBOOK_NETWORK_ERROR'
      });
    }
    const text = await response.text();
    if (!response.ok) {
      const detail = text.replace(/\s+/g, ' ').slice(0, 280);
      throw Object.assign(new Error(
        `Facebook trả HTTP ${response.status}${detail ? `: ${detail}` : ''}`
      ), { code: code || 'FACEBOOK_HTTP_ERROR', data: { status: response.status } });
    }
    if (/checkpoint|login_form|id="loginbutton"/i.test(text) && /<html|<!doctype/i.test(text)) {
      throw Object.assign(new Error(
        'Facebook yêu cầu đăng nhập hoặc xác minh tài khoản trong tab nền.'
      ), { code: 'FACEBOOK_CHECKPOINT' });
    }
    return { response, text, parsed: safeJson(text) };
  }

  async function uploadSimple(session, groupId, file, metadata, signal) {
    const isVideo = metadata.kind === 'video';
    const endpoint = isVideo
      ? 'https://upload.facebook.com/ajax/react_composer/attachments/video/upload'
      : 'https://upload.facebook.com/ajax/react_composer/attachments/photo/upload';
    const query = appendSessionParams(new URLSearchParams(), session);
    const form = new FormData();
    form.set('lsd', session.lsd);
    form.set('source', '8');
    form.set('profile_id', session.userId);
    form.set('waterfallxapp', 'comet');
    form.set('upload_id', `jsc_c_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`);
    form.set('farr', file, metadata.name);
    const { parsed, text } = await checkedFetch(
      `${endpoint}?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          accept: '*/*',
          'x-fb-lsd': session.lsd,
          'x-asbd-id': '359341'
        },
        body: form,
        referrer: `https://www.facebook.com/groups/${groupId}/`
      },
      signal,
      'FACEBOOK_UPLOAD_HTTP_ERROR'
    );
    const errors = criticalErrors(parsed);
    if (errors.length) {
      throw Object.assign(new Error(errors.join(' · ').slice(0, 1000)), {
        code: 'FACEBOOK_UPLOAD_REJECTED'
      });
    }
    const mediaId = deepFind(
      parsed,
      isVideo
        ? ['videoID', 'video_id', 'videoId']
        : ['photoID', 'photo_id', 'photoId']
    );
    if (!mediaId) {
      throw Object.assign(new Error(
        `Facebook không trả ID ${isVideo ? 'video' : 'ảnh'}: ${text.replace(/\s+/g, ' ').slice(0, 260)}`
      ), { code: 'FACEBOOK_UPLOAD_ID_MISSING' });
    }
    return { mediaId: String(mediaId), mode: isVideo ? 'video-form' : 'photo-form' };
  }

  async function graphqlOperation(session, operationName, variables, signal, extraFallbacks = []) {
    const resolved = await resolveDocId(operationName);
    const ids = [
      resolved?.id,
      ...(FALLBACK_DOC_IDS[operationName] || []),
      ...extraFallbacks
    ].filter((id, index, all) => id && all.indexOf(id) === index);
    const failures = [];

    for (const docId of ids) {
      const { parsed } = await checkedFetch(
        GRAPHQL_URL,
        {
          method: 'POST',
          headers: {
            accept: '*/*',
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-asbd-id': '359341',
            'x-fb-friendly-name': operationName,
            'x-fb-lsd': session.lsd
          },
          body: graphqlBody(session, operationName, docId, variables).toString()
        },
        signal,
        'FACEBOOK_GRAPHQL_HTTP_ERROR'
      );
      const errors = criticalErrors(parsed);
      if (!errors.length) {
        return {
          parsed,
          docId,
          docIdSource: resolved?.id === docId ? resolved.source : 'fallback'
        };
      }
      failures.push(`${docId}: ${errors.join(' · ')}`);
    }
    throw Object.assign(new Error(
      failures.join(' | ').slice(0, 1800) || `Không tìm được doc_id cho ${operationName}.`
    ), { code: 'FACEBOOK_GRAPHQL_REJECTED' });
  }

  function parseMaybeJson(value) {
    if (value && typeof value === 'object') return value;
    try {
      return JSON.parse(String(value || ''));
    } catch {
      return {};
    }
  }

  async function uploadVideoRupload(session, groupId, file, metadata, signal) {
    const mediaConfigResponse = await graphqlOperation(
      session,
      'MediaUploadFBDefaultServerConfigurationRetrieverQuery',
      { source_type: 'newsfeed_composer' },
      signal
    );
    const uploaderConfigResponse = await graphqlOperation(
      session,
      'useCometVideoUploaderConfigQuery',
      {
        actorID: session.userId,
        entryPoint: 'group',
        targetID: groupId
      },
      signal
    );
    const mediaConfig = parseMaybeJson(deepFind(
      mediaConfigResponse.parsed,
      ['media_upload_config']
    ));
    const uploaderConfig = parseMaybeJson(deepFind(
      uploaderConfigResponse.parsed,
      ['comet_composer_video_uploader_config', 'video_uploader_config']
    ));
    const startUri = mediaConfig?.network_start?.uri
      || `${location.origin}/ajax/video/upload/requests/start/`;
    const receiveUri = mediaConfig?.network_receive?.uri
      || `${location.origin}/ajax/video/upload/requests/receive/`;
    const waterfallId = crypto.randomUUID().replaceAll('-', '');
    const extension = String(metadata.name || '').split('.').pop()?.toLowerCase() || 'mp4';
    const startBody = new URLSearchParams({
      waterfall_id: waterfallId,
      target_id: session.userId,
      source: 'newsfeed_composer',
      composer_entry_point_ref: 'group',
      supports_chunking: 'true',
      supports_file_api: 'true',
      file_size: String(metadata.size),
      file_extension: extension,
      partition_start_offset: '0',
      partition_end_offset: String(metadata.size),
      composer_dialog_version: 'V2',
      video_publisher_action_source: '',
      lsd: session.lsd
    });
    const startUrl = new URL(startUri, location.origin);
    appendSessionParams(startUrl.searchParams, session);
    const start = await checkedFetch(
      startUrl.toString(),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-fb-lsd': session.lsd,
          'x-fb-video-waterfall-id': waterfallId
        },
        body: startBody.toString()
      },
      signal,
      'FACEBOOK_VIDEO_START_FAILED'
    );
    const payload = deepFind(start.parsed, ['payload']) || {};
    const videoId = String(payload.video_id || payload.videoID || '');
    if (!videoId) {
      throw Object.assign(new Error('Facebook không tạo phiên tải video.'), {
        code: 'FACEBOOK_VIDEO_SESSION_MISSING'
      });
    }
    if (!payload.skip_upload) {
      const startOffset = String(payload.start_offset ?? 0);
      const endOffset = String(payload.end_offset ?? metadata.size);
      const serviceName = uploaderConfig.resumable_service_name || 'rupload';
      const serviceDomain = uploaderConfig.resumable_service_domain || 'facebook.com';
      const uploadUuid = crypto.randomUUID().replaceAll('-', '');
      const uploadUrl = new URL(
        `https://${serviceName}.${serviceDomain}/fb_video/${uploadUuid}-${startOffset}-${endOffset}`
      );
      uploadUrl.searchParams.set('lsd', session.lsd);
      uploadUrl.searchParams.set('__aaid', '0');
      const uploaded = await checkedFetch(
        uploadUrl.toString(),
        {
          method: 'POST',
          headers: {
            'composer-session-id': waterfallId,
            'product-media-id': videoId,
            'end-offset': endOffset,
            offset: startOffset,
            'start-offset': startOffset,
            id: 'undefined',
            'x-entity-length': String(metadata.size),
            'x-entity-name': metadata.name,
            'x-entity-type': metadata.type || 'video/mp4',
            'x-total-asset-size': String(metadata.size)
          },
          body: file
        },
        signal,
        'FACEBOOK_VIDEO_BINARY_UPLOAD_FAILED'
      );
      const uploadHandle = deepFind(uploaded.parsed, ['h', 'upload_handle']);
      if (!uploadHandle) {
        throw Object.assign(new Error('Facebook không trả handle sau khi tải video.'), {
          code: 'FACEBOOK_VIDEO_HANDLE_MISSING'
        });
      }

      const receiveBody = new URLSearchParams({
        waterfall_id: waterfallId,
        target_id: session.userId,
        video_id: videoId,
        source: 'newsfeed_composer',
        composer_entry_point_ref: 'group',
        supports_chunking: 'true',
        supports_upload_service: 'true',
        partition_start_offset: startOffset,
        partition_end_offset: endOffset,
        start_offset: startOffset,
        end_offset: endOffset,
        upload_speed: String(Math.max(1, Math.round(metadata.size / 2))),
        fbuploader_video_file_chunk: String(uploadHandle),
        composer_dialog_version: 'V2',
        lsd: session.lsd
      });
      const receiveUrl = new URL(receiveUri, location.origin);
      appendSessionParams(receiveUrl.searchParams, session);
      await checkedFetch(
        receiveUrl.toString(),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-fb-lsd': session.lsd,
            'x-fb-video-waterfall-id': waterfallId
          },
          body: receiveBody.toString()
        },
        signal,
        'FACEBOOK_VIDEO_FINALIZE_FAILED'
      );
    }
    return { mediaId: videoId, mode: 'video-rupload' };
  }

  async function uploadMedia(session, groupId, file, metadata, signal) {
    if (metadata.kind === 'image') {
      return uploadSimple(session, groupId, file, metadata, signal);
    }
    try {
      return await uploadSimple(session, groupId, file, metadata, signal);
    } catch (simpleError) {
      try {
        return await uploadVideoRupload(session, groupId, file, metadata, signal);
      } catch (ruploadError) {
        throw Object.assign(new Error(
          `Upload video thường lỗi: ${simpleError.message} · Rupload lỗi: ${ruploadError.message}`
        ), {
          code: ruploadError.code || simpleError.code || 'FACEBOOK_VIDEO_UPLOAD_FAILED'
        });
      }
    }
  }

  function relayProviders() {
    return {
      '__relay_internal__pv__CometUFIShareActionMigrationrelayprovider': true,
      '__relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider': true,
      '__relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider': true,
      '__relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider': false,
      '__relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider': false,
      '__relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider': false,
      '__relay_internal__pv__IsWorkUserrelayprovider': false,
      '__relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider': false,
      '__relay_internal__pv__CometUFISingleLineUFIrelayprovider': false,
      '__relay_internal__pv__StoriesArmadilloReplyEnabledrelayprovider': true,
      '__relay_internal__pv__IsMergQAPollsrelayprovider': false,
      '__relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider': 206,
      '__relay_internal__pv__groups_comet_use_glvrelayprovider': false
    };
  }

  function composerVariables(style, session, groupId, message, attachment, composerSessionId) {
    const commonInput = {
      message: { ranges: [], text: message },
      attachments: [attachment],
      actor_id: session.userId,
      client_mutation_id: '1'
    };
    if (style === 'minimal') {
      return {
        input: {
          composer_type: 'GROUP',
          composer_context: { group_id: groupId },
          ...commonInput
        },
        ...relayProviders()
      };
    }
    return {
      input: {
        composer_entry_point: 'inline_composer',
        composer_source_surface: 'group',
        composer_type: 'group',
        idempotence_token: `${composerSessionId}_FEED`,
        source: 'WWW',
        logging: { composer_session_id: composerSessionId },
        ...commonInput,
        with_tags_ids: null,
        inline_activities: [],
        text_format_preset_id: '0',
        group_flair: { flair_id: null },
        navigation_data: {
          attribution_id_v2: `CometGroupDiscussionRoot.react,comet.group,via_cold_start,${Date.now()},0,${groupId},`
        },
        tracking: [null],
        event_share_metadata: { surface: 'newsfeed' },
        audience: { to_id: groupId }
      },
      feedLocation: 'GROUP',
      feedbackSource: 0,
      focusCommentID: null,
      gridMediaWidth: null,
      groupID: groupId,
      scale: Math.max(1, Math.round(window.devicePixelRatio || 1)),
      privacySelectorRenderLocation: 'COMET_STREAM',
      checkPhotosToReelsUpsellEligibility: false,
      referringStoryRenderLocation: null,
      renderLocation: 'group',
      useDefaultActor: false,
      inviteShortLinkKey: null,
      isFeed: false,
      isFundraiser: false,
      isFunFactPost: false,
      isGroup: true,
      isEvent: false,
      isTimeline: false,
      isSocialLearning: false,
      isPageNewsFeed: false,
      isProfileReviews: false,
      isWorkSharedDraft: false,
      hashtag: null,
      canUserManageOffers: false,
      ...relayProviders()
    };
  }

  function containsStoryCreate(value) {
    return deepFind(value, [
      'story_create',
      'composerStoryCreate',
      'createComposerStory'
    ]);
  }

  async function createPost(session, groupId, message, mediaKind, mediaId, signal) {
    const attachment = mediaKind === 'video'
      ? { video: { id: mediaId } }
      : { photo: { id: mediaId } };
    const resolved = await resolveDocId(COMPOSER_NAME);
    const docIds = [
      resolved?.id,
      ...FALLBACK_DOC_IDS.ComposerStoryCreateMutation
    ].filter((id, index, all) => id && all.indexOf(id) === index);
    const failures = [];
    const composerSessionId = crypto.randomUUID();

    for (const docId of docIds) {
      for (const style of ['minimal', 'rich']) {
        const variables = composerVariables(
          style,
          session,
          groupId,
          message,
          attachment,
          composerSessionId
        );
        const { parsed } = await checkedFetch(
          GRAPHQL_URL,
          {
            method: 'POST',
            headers: {
              accept: '*/*',
              'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
              'x-asbd-id': '359341',
              'x-fb-friendly-name': COMPOSER_NAME,
              'x-fb-lsd': session.lsd
            },
            body: graphqlBody(session, COMPOSER_NAME, docId, variables).toString()
          },
          signal,
          'FACEBOOK_COMPOSER_HTTP_ERROR'
        );
        const storyCreate = containsStoryCreate(parsed);
        if (storyCreate) {
          return {
            response: parsed,
            docId,
            docIdSource: resolved?.id === docId ? resolved.source : 'fallback',
            variableStyle: style
          };
        }
        const errors = criticalErrors(parsed);
        failures.push(
          `${docId}/${style}: ${errors.join(' · ') || 'phản hồi không có story_create'}`
        );
      }
    }
    throw Object.assign(new Error(
      failures.join(' | ').slice(0, 2200)
      || 'Facebook không trả dữ liệu xác nhận tạo bài.'
    ), { code: 'FACEBOOK_COMPOSER_REJECTED' });
  }

  async function executePost(requestId, payload, signal) {
    const groupId = String(payload?.groupId || '');
    const message = String(payload?.message || '').trim();
    const metadata = payload?.media || {};
    const file = payload?.file;
    if (!/^\d{5,30}$/.test(groupId)) {
      throw Object.assign(new Error('UID nhóm không hợp lệ.'), { code: 'INVALID_GROUP_ID' });
    }
    if (!message) {
      throw Object.assign(new Error('Nội dung bài viết đang trống.'), { code: 'EMPTY_CONTENT' });
    }
    if (!(file instanceof Blob) || Number(file.size) !== Number(metadata.size)) {
      throw Object.assign(new Error('Media chuyển sang tab Facebook bị thiếu hoặc sai kích thước.'), {
        code: 'ENGINE_MEDIA_INVALID'
      });
    }
    if (!['image', 'video'].includes(metadata.kind)) {
      throw Object.assign(new Error('Loại media không hợp lệ.'), { code: 'INVALID_MEDIA_KIND' });
    }

    progress(requestId, 2, 4, `Đang tải ${metadata.kind === 'video' ? 'video' : 'ảnh'} lên Facebook`);
    const session = requireSession();
    const uploaded = await uploadMedia(session, groupId, file, metadata, signal);
    progress(requestId, 3, 4, 'Đang gửi request tạo bài viết');
    const created = await createPost(
      session,
      groupId,
      message,
      metadata.kind,
      uploaded.mediaId,
      signal
    );
    const reference = postReference(created.response, groupId);
    progress(requestId, 4, 4, 'Facebook đã nhận bài đăng');
    return {
      ...reference,
      message: reference.postUrl
        ? 'Facebook đã nhận bài đăng.'
        : 'Facebook đã nhận request tạo bài; bài chờ duyệt vẫn được tính thành công.',
      diagnostics: {
        uploadMode: uploaded.mode,
        docIdSource: created.docIdSource,
        variableStyle: created.variableStyle
      }
    };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (
      !message
      || message.source !== RELAY_SOURCE
      || message.type !== 'GROUP_PUBLISHER_ENGINE_REQUEST'
    ) return;

    const requestId = String(message.requestId || '');
    if (!requestId) return;
    if (message.action === 'ABORT') {
      activeRequests.get(requestId)?.abort();
      return;
    }
    if (message.action === 'PING') {
      const session = currentSession();
      const ready = Boolean(session.userId && session.fbDtsg && session.lsd);
      reply(requestId, result(
        ready,
        ready
          ? 'ENGINE_READY'
          : session.userId
            ? 'FACEBOOK_SESSION_TOKEN_MISSING'
            : 'FACEBOOK_NOT_LOGGED_IN',
        ready
          ? 'Máy request Facebook đã sẵn sàng.'
          : session.userId
            ? 'Facebook chưa tải xong token phiên.'
            : 'Chrome chưa đăng nhập Facebook.',
        {
          account: { uid: session.userId },
          ready
        }
      ));
      return;
    }
    if (message.action !== 'POST') {
      reply(requestId, result(false, 'ENGINE_UNKNOWN_ACTION', 'Lệnh máy request không hợp lệ.'));
      return;
    }

    const controller = new AbortController();
    activeRequests.set(requestId, controller);
    void executePost(requestId, message.payload, controller.signal)
      .then((data) => reply(
        requestId,
        result(true, 'POST_ACCEPTED', data.message, data)
      ))
      .catch((error) => reply(
        requestId,
        result(
          false,
          error?.code || (controller.signal.aborted ? 'JOB_PAUSED' : 'FACEBOOK_POST_FAILED'),
          controller.signal.aborted
            ? 'Tiến trình đã được dừng bởi người dùng.'
            : error?.message || String(error),
          error?.data || null
        )
      ))
      .finally(() => {
        activeRequests.delete(requestId);
      });
  });
}());
