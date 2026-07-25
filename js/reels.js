(() => {
  'use strict';

  const CHUNK_SIZE = 4 * 1024 * 1024;
  const PUBLISH_DOC_ID = '5807526529347282';
  const PUBLISH_FRIENDLY_NAME = 'ReelComposerReelPublishMutation';

  function assertNotAborted(signal) {
    if (signal?.aborted) throw new DOMException('Tiến trình đã dừng', 'AbortError');
  }

  function parseFacebookError(payload) {
    if (!payload) return 'Facebook trả về lỗi không xác định';
    const error = payload.error || payload.errors?.[0] || payload.payload?.error;
    if (typeof error === 'string') return error;
    return error?.message
      || error?.error_user_msg
      || error?.errorDescription
      || payload.errorSummary
      || payload.errorDescription
      || JSON.stringify(error || payload).slice(0, 600);
  }

  function randomReq() {
    return Math.random().toString(36).slice(2, 5);
  }

  function spinText(text) {
    return String(text || '').replace(/\{([^{}]+)\}/g, (full, content) => {
      const options = content.split('|').map((item) => item.trim()).filter(Boolean);
      return options.length > 1 ? options[Math.floor(Math.random() * options.length)] : full;
    });
  }

  function buildCaption(template, file, useFilename) {
    const filename = String(file?.name || '').replace(/\.[^.]+$/, '');
    let content = spinText(template).replaceAll('{filename}', filename);
    if (useFilename && filename && !String(template).includes('{filename}')) {
      content = `${content.trim()}${content.trim() ? '\n' : ''}${filename}`;
    }
    return content.trim();
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error || new Error('Không đọc được dữ liệu video'));
      reader.readAsDataURL(blob);
    });
  }

  async function requestText(options) {
    const response = await window.ExtensionClient.httpRequest(options);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    }
    return { response, text };
  }

  async function uploadVideoBusiness({ page, file, signal, onProgress }) {
    assertNotAborted(signal);
    const credential = await window.FacebookAPI.getPageCredential(page);
    const pageId = String(page.id);
    const totalSize = file.size;
    const waterfallId = crypto.randomUUID();
    const startUrl = `https://business.facebook.com/ajax/video/upload/requests/start/?av=${encodeURIComponent(pageId)}&__a=1`;

    onProgress?.({ phase: 'start', loaded: 0, total: totalSize, message: 'Đang tạo phiên upload...' });

    const startBody = new URLSearchParams();
    startBody.append('av', pageId);
    startBody.append('file_size', String(totalSize));
    startBody.append('file_extension', String(file.name.split('.').pop() || 'mp4').toLowerCase());
    startBody.append('waterfall_id', waterfallId);
    startBody.append('composer_session_id', waterfallId);
    startBody.append('target_id', pageId);
    startBody.append('source', 'composer_cs_reel_composer');
    startBody.append('composer_entry_point_ref', 'biz_web_home');
    startBody.append('video_publisher_action_source[product]', 'business_suite');
    startBody.append('video_publisher_action_source[feature]', 'cs_reel_composer');
    startBody.append('video_publisher_action_source[entry_point]', 'biz_web_home');
    startBody.append('supports_chunking', 'true');
    startBody.append('supports_file_api', 'true');
    startBody.append('partition_start_offset', '0');
    startBody.append('partition_end_offset', String(totalSize));
    startBody.append('has_file_been_replaced', 'false');
    startBody.append('creator_product', '2');
    startBody.append('__aaid', '0');
    startBody.append('__user', credential.cUser);
    startBody.append('__a', '1');
    startBody.append('__req', randomReq());
    startBody.append('__hs', '20340.HYP:comet_pkg.2.1..0.0');
    startBody.append('dpr', '1');
    startBody.append('__ccg', 'EXCELLENT');
    startBody.append('__rev', '1026863126');
    startBody.append('__hsi', String(Date.now()));
    startBody.append('__comet_req', '15');
    startBody.append('fb_dtsg', credential.token);
    startBody.append('jazoest', credential.jazoest);
    startBody.append('__spin_r', '1026863126');
    startBody.append('__spin_b', 'trunk');
    startBody.append('__spin_t', String(Math.floor(Date.now() / 1000)));

    const { text: startText } = await requestText({
      url: startUrl,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://business.facebook.com',
        referer: 'https://business.facebook.com/',
        cookie: credential.cookie
      },
      body: { kind: 'text', content: startBody.toString() },
      timeoutMs: 90_000
    });

    const startPayload = window.FacebookAPI.parseFacebookJson(startText);
    if (startPayload.error) throw new Error(`Tạo phiên upload thất bại: ${parseFacebookError(startPayload)}`);
    const videoId = startPayload?.payload?.video_id;
    let uploadUrl = startPayload?.payload?.upload_url;
    if (!videoId) throw new Error(`Facebook không trả video_id: ${startText.slice(0, 500)}`);
    if (!uploadUrl) uploadUrl = `https://rupload.facebook.com/fb_video/${crypto.randomUUID()}-0-${totalSize}`;

    const uploadQuery = new URLSearchParams({
      __user: credential.cUser,
      __a: '1',
      __req: 'r',
      dpr: '1.5',
      __ccg: 'GOOD',
      fb_dtsg_ag: credential.token
    });
    const chunkUrl = `${uploadUrl}${uploadUrl.includes('?') ? '&' : '?'}${uploadQuery.toString()}`;

    let offset = 0;
    let chunkHandle = null;
    while (offset < totalSize) {
      assertNotAborted(signal);
      const endOffset = Math.min(offset + CHUNK_SIZE, totalSize);
      const chunk = file.slice(offset, endOffset);
      const content = await blobToBase64(chunk);

      const { text: chunkText } = await requestText({
        url: chunkUrl,
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          offset: String(offset),
          start_offset: String(offset),
          end_offset: String(endOffset),
          'x-entity-length': String(totalSize),
          'x-entity-name': `${pageId}_${videoId}.${String(file.name.split('.').pop() || 'mp4').toLowerCase()}`,
          'x-entity-type': file.type || 'video/mp4',
          product_media_id: String(videoId),
          origin: 'https://business.facebook.com',
          referer: 'https://business.facebook.com/',
          cookie: credential.cookie
        },
        body: { kind: 'binary-base64', content, contentType: file.type || 'video/mp4' },
        timeoutMs: 240_000
      });

      const chunkPayload = window.FacebookAPI.parseFacebookJson(chunkText);
      if (chunkPayload.error) throw new Error(`Upload chunk thất bại: ${parseFacebookError(chunkPayload)}`);
      if (chunkPayload.h) chunkHandle = chunkPayload.h;
      const nextOffset = chunkPayload.end_offset !== undefined ? Number(chunkPayload.end_offset) : endOffset;
      if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
        throw new Error(`Offset upload không hợp lệ: ${JSON.stringify(chunkPayload).slice(0, 500)}`);
      }
      offset = nextOffset;
      onProgress?.({
        phase: 'chunk',
        loaded: Math.min(offset, totalSize),
        total: totalSize,
        message: `Đã tải ${Math.round((Math.min(offset, totalSize) / totalSize) * 100)}%`
      });
    }

    if (!chunkHandle) throw new Error('Upload hoàn tất nhưng Facebook không trả chunk handle');
    assertNotAborted(signal);

    onProgress?.({ phase: 'receive', loaded: totalSize, total: totalSize, message: 'Đang xác nhận video...' });
    const receiveUrl = `https://business.facebook.com/ajax/video/upload/requests/receive/?av=${encodeURIComponent(pageId)}&__a=1`;
    const receiveBody = new URLSearchParams();
    receiveBody.append('av', pageId);
    receiveBody.append('waterfall_id', waterfallId);
    receiveBody.append('target_id', pageId);
    receiveBody.append('video_id', String(videoId));
    receiveBody.append('source', 'composer_cs_reel_composer');
    receiveBody.append('composer_entry_point_ref', 'biz_web_home');
    receiveBody.append('video_publisher_action_source[product]', 'business_suite');
    receiveBody.append('video_publisher_action_source[feature]', 'cs_reel_composer');
    receiveBody.append('video_publisher_action_source[entry_point]', 'biz_web_home');
    receiveBody.append('supports_chunking', 'true');
    receiveBody.append('supports_upload_service', 'true');
    receiveBody.append('partition_start_offset', '0');
    receiveBody.append('partition_end_offset', String(totalSize));
    receiveBody.append('start_offset', '0');
    receiveBody.append('end_offset', String(totalSize));
    receiveBody.append('upload_speed', '2048');
    receiveBody.append('has_file_been_replaced', 'false');
    receiveBody.append('__user', credential.cUser);
    receiveBody.append('__a', '1');
    receiveBody.append('__req', '3r');
    receiveBody.append('dpr', '1.5');
    receiveBody.append('__ccg', 'GOOD');
    receiveBody.append('fb_dtsg', credential.token);
    receiveBody.append('fbuploader_video_file_chunk', chunkHandle);

    const { text: receiveText } = await requestText({
      url: receiveUrl,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://business.facebook.com',
        referer: 'https://business.facebook.com/',
        x_fb_video_waterfall_id: waterfallId,
        cookie: credential.cookie
      },
      body: { kind: 'text', content: receiveBody.toString() },
      timeoutMs: 120_000
    });
    const receivePayload = window.FacebookAPI.parseFacebookJson(receiveText);
    if (receivePayload.error) throw new Error(`Xác nhận video thất bại: ${parseFacebookError(receivePayload)}`);

    return { videoId: String(videoId), credential };
  }

  function findPublishedPostId(payload) {
    const item = payload?.data?.xfamily_content_create?.items?.[0];
    if (item?.story?.post_id) return String(item.story.post_id);
    if (item?.id) return String(item.id);
    const storyCreate = payload?.data?.story_create;
    if (storyCreate?.post_id) return String(storyCreate.post_id);
    if (storyCreate?.story_id) return String(storyCreate.story_id);
    return null;
  }

  async function publishReel({ page, videoId, caption, scheduledPublishTime, signal }) {
    assertNotAborted(signal);
    const credential = await window.FacebookAPI.getPageCredential(page);
    const pageId = String(page.id);
    const actorId = credential.cUser || credential.iUser || pageId;
    const variables = {
      input: {
        client_mutation_id: crypto.randomUUID(),
        actor_id: pageId,
        video_id: String(videoId),
        should_skip_encoding: false,
        should_enforce_video_editor_path: false,
        metadata: { title: caption || '' }
      }
    };

    if (scheduledPublishTime) {
      variables.input.metadata.is_scheduled = true;
      variables.input.metadata.scheduled_publish_time = Number(scheduledPublishTime);
    }

    const body = new URLSearchParams({
      av: pageId,
      __user: actorId,
      __a: '1',
      fb_dtsg: credential.token,
      jazoest: credential.jazoest,
      doc_id: PUBLISH_DOC_ID,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: PUBLISH_FRIENDLY_NAME,
      server_timestamps: 'true',
      variables: JSON.stringify(variables)
    });

    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      assertNotAborted(signal);
      try {
        const { text } = await requestText({
          url: 'https://business.facebook.com/api/graphql/',
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'https://business.facebook.com',
            referer: 'https://business.facebook.com/latest/composer',
            'x-fb-friendly-name': PUBLISH_FRIENDLY_NAME,
            cookie: credential.cookie
          },
          body: { kind: 'text', content: body.toString() },
          timeoutMs: 120_000
        });
        const payload = window.FacebookAPI.parseFacebookJson(text);
        if (payload.error || payload.errors) throw new Error(parseFacebookError(payload));
        const postId = findPublishedPostId(payload);
        if (postId || payload.data) return { postId: postId || 'SUCCESS_NO_ID', payload };
        throw new Error(`Phản hồi publish không xác định: ${text.slice(0, 600)}`);
      } catch (error) {
        lastError = error;
        const transient = /temporary|try again|encoding|412|500|network|failed to fetch/i.test(error.message || '');
        if (!transient || attempt === 3) break;
        await window.FacebookAPI.sleep(4_000 * attempt);
      }
    }
    throw lastError || new Error('Publish Reel thất bại');
  }

  async function uploadAndPublish({ page, file, caption, scheduledPublishTime = null, signal, onProgress }) {
    const upload = await uploadVideoBusiness({ page, file, signal, onProgress });
    assertNotAborted(signal);
    onProgress?.({ phase: 'publish', loaded: file.size, total: file.size, message: 'Đang publish Reel...' });
    const published = await publishReel({
      page,
      videoId: upload.videoId,
      caption,
      scheduledPublishTime,
      signal
    });
    onProgress?.({ phase: 'done', loaded: file.size, total: file.size, message: 'Đăng Reel thành công' });
    return { ...upload, ...published };
  }

  window.ReelsService = Object.freeze({
    CHUNK_SIZE,
    buildCaption,
    uploadVideoBusiness,
    publishReel,
    uploadAndPublish
  });
})();
