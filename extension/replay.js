import {
  AppError,
  extractPostReference,
  findFacebookErrors,
  renderJsonTemplate,
  renderTemplate,
  safeJsonParse
} from './core.js';
import { getMediaBlob } from './storage.js';

const RULE_ID_MIN = 2100000000;
const RULE_ID_MAX = 2100000999;
const ACCOUNT_CACHE_MS = 30000;
const ALLOWED_FACEBOOK_HOSTS = new Set([
  'www.facebook.com',
  'web.facebook.com',
  'upload.facebook.com',
  'rupload.facebook.com'
]);
let ruleSequence = 0;
let accountCache = { uid: '', expiresAt: 0 };

function decodeHtml(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&#039;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return decodeHtml(match[1].replaceAll('\\/', '/').replaceAll('\\"', '"'));
  }
  return '';
}

function computeJazoest(token) {
  if (!token) return '';
  return `2${[...String(token)].map((character) => character.charCodeAt(0)).join('')}`;
}

function createLinkedController(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), Math.max(1000, Number(timeoutMs) || 120000));
  const forward = () => controller.abort(externalSignal?.reason || 'external');
  if (externalSignal?.aborted) forward();
  else externalSignal?.addEventListener('abort', forward, { once: true });
  return {
    controller,
    cleanup() {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', forward);
    }
  };
}

async function fetchText(url, options, timeoutMs, externalSignal) {
  const linked = createLinkedController(externalSignal, timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: linked.controller.signal,
      credentials: 'include',
      cache: 'no-store'
    });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (linked.controller.signal.aborted) {
      if (externalSignal?.aborted) {
        throw new AppError('JOB_PAUSED', 'Tiến trình đã được dừng bởi người dùng.');
      }
      throw new AppError('REQUEST_TIMEOUT', 'Request Facebook quá thời gian chờ.');
    }
    throw new AppError('NETWORK_ERROR', `Lỗi mạng khi gửi request Facebook: ${error?.message || String(error)}`);
  } finally {
    linked.cleanup();
  }
}

function userIdFromHtml(text) {
  return firstMatch(text, [
    /"CurrentUserInitialData"[^]*?"USER_ID"\s*:\s*"(\d{5,30})"/i,
    /"USER_ID"\s*:\s*"(\d{5,30})"/i,
    /"ACCOUNT_ID"\s*:\s*"(\d{5,30})"/i,
    /"actorID"\s*:\s*"(\d{5,30})"/i,
    /"userID"\s*:\s*"(\d{5,30})"/i,
    /name="__user"\s+value="(\d{5,30})"/i,
    /"__user"\s*:\s*"(\d{5,30})"/i
  ]);
}

async function fetchFacebookHome(signal) {
  return fetchText(
    'https://www.facebook.com/',
    {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    },
    45000,
    signal
  );
}

export async function getFacebookAccount(options = {}) {
  const force = Boolean(options?.force);
  if (!force && accountCache.expiresAt > Date.now()) return { uid: accountCache.uid };
  const { response, text } = await fetchFacebookHome(options?.signal);
  if (!response.ok) return { uid: '' };
  const uid = userIdFromHtml(text);
  accountCache = { uid, expiresAt: Date.now() + ACCOUNT_CACHE_MS };
  return { uid };
}

export async function refreshSessionContext(signal) {
  const { response, text } = await fetchFacebookHome(signal);
  if (!response.ok) {
    throw new AppError('SESSION_REFRESH_HTTP_ERROR', `Không làm mới được phiên Facebook (HTTP ${response.status}).`);
  }
  const userId = userIdFromHtml(text);
  if (!userId) {
    accountCache = { uid: '', expiresAt: Date.now() + 5000 };
    throw new AppError('FACEBOOK_NOT_LOGGED_IN', 'Chrome chưa đăng nhập Facebook hoặc phiên đăng nhập đã hết hạn.');
  }
  accountCache = { uid: userId, expiresAt: Date.now() + ACCOUNT_CACHE_MS };

  const fbDtsg = firstMatch(text, [
    /"DTSGInitialData"[^]*?"token"\s*:\s*"([^"]+)"/i,
    /name="fb_dtsg"\s+value="([^"]+)"/i,
    /"fb_dtsg"\s*:\s*"([^"]+)"/i
  ]);
  const lsd = firstMatch(text, [
    /"LSD"[^]*?"token"\s*:\s*"([^"]+)"/i,
    /name="lsd"\s+value="([^"]+)"/i,
    /"lsd"\s*:\s*"([^"]+)"/i
  ]);
  if (!fbDtsg || !lsd) {
    throw new AppError(
      'SESSION_TOKEN_MISSING',
      'Không đọc được token phiên Facebook. Hãy mở facebook.com, kiểm tra đăng nhập rồi thử lại.'
    );
  }

  const context = {
    userId,
    fbDtsg,
    jazoest: firstMatch(text, [/name="jazoest"\s+value="([^"]+)"/i]) || computeJazoest(fbDtsg),
    lsd,
    hsi: firstMatch(text, [/"hsi"\s*:\s*"([^"]+)"/i, /"__hsi"\s*:\s*"([^"]+)"/i]),
    rev: firstMatch(text, [/"__spin_r"\s*:\s*(\d+)/i, /"rev"\s*:\s*(\d+)/i]),
    spinR: firstMatch(text, [/"__spin_r"\s*:\s*(\d+)/i]),
    spinB: firstMatch(text, [/"__spin_b"\s*:\s*"([^"]+)"/i]),
    spinT: firstMatch(text, [/"__spin_t"\s*:\s*(\d+)/i])
  };
  context.rev ||= context.spinR;
  return context;
}

function nextRuleId() {
  ruleSequence = (ruleSequence + 1) % 1000;
  return RULE_ID_MIN + ruleSequence;
}

async function installHeaderRule(groupId) {
  const id = nextRuleId();
  const rule = {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Origin', operation: 'set', value: 'https://www.facebook.com' },
        { header: 'Referer', operation: 'set', value: `https://www.facebook.com/groups/${groupId}/` }
      ]
    },
    condition: {
      requestDomains: ['facebook.com'],
      resourceTypes: ['xmlhttprequest']
    }
  };
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [rule]
    });
    return id;
  } catch (error) {
    console.warn('[GroupPublisher] Không đặt được header Origin/Referer:', error);
    return 0;
  }
}

async function removeHeaderRule(ruleId) {
  if (!ruleId) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
  } catch {
    // Session rules are best-effort cleanup and disappear when Chrome closes.
  }
}

export async function cleanupReplayRules() {
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const ids = rules
      .map((rule) => rule.id)
      .filter((id) => id >= RULE_ID_MIN && id <= RULE_ID_MAX);
    if (ids.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
  } catch (error) {
    console.warn('[GroupPublisher] Không dọn được rule request cũ:', error);
  }
}

function renderedHeaders(step, context) {
  const output = {};
  for (const [name, value] of Object.entries(step?.headers || {})) {
    const normalized = String(name || '').toLowerCase();
    if (!normalized || normalized === 'content-length' || normalized === 'cookie') continue;
    output[normalized] = renderTemplate(value, context);
  }
  return output;
}

function buildRequestBody(step, context, media) {
  const spec = step?.body || { kind: 'text', value: '' };
  const headers = renderedHeaders(step, context);

  if (spec.kind === 'raw-media') {
    headers['content-type'] = context.fileType || headers['content-type'] || 'application/octet-stream';
    return { body: media.blob, headers };
  }

  if (spec.kind === 'multipart') {
    delete headers['content-type'];
    const form = new FormData();
    for (const part of spec.parts || []) {
      if (part.kind === 'media') {
        form.append(
          renderTemplate(part.name || 'file', context),
          media.blob,
          renderTemplate(part.filename || '{{FILE_NAME}}', context)
        );
      } else {
        const rawValue = String(part.value || '');
        const renderedValue = /^\s*[\[{]/.test(rawValue)
          ? renderJsonTemplate(rawValue, context)
          : renderTemplate(rawValue, context);
        form.append(
          renderTemplate(part.name || '', context),
          renderedValue
        );
      }
    }
    return { body: form, headers };
  }

  if (spec.kind === 'urlencoded') {
    const params = new URLSearchParams();
    for (const entry of spec.entries || []) {
      const rawValue = String(entry[1] || '');
      const renderedValue = /^\s*[\[{]/.test(rawValue)
        ? renderJsonTemplate(rawValue, context)
        : renderTemplate(rawValue, context);
      params.append(renderTemplate(entry[0], context), renderedValue);
    }
    headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    return { body: params.toString(), headers };
  }

  headers['content-type'] = spec.contentType || headers['content-type'] || 'text/plain;charset=UTF-8';
  const rawValue = String(spec.value || '');
  const value = /json/i.test(spec.contentType || '') && /^\s*[\[{]/.test(rawValue)
    ? renderJsonTemplate(rawValue, context)
    : renderTemplate(rawValue, context);
  return { body: value, headers };
}

function validateStepResponse(step, response, text) {
  if (!response.ok) {
    const short = String(text || '').replace(/\s+/g, ' ').slice(0, 300);
    throw new AppError(
      'FACEBOOK_HTTP_ERROR',
      `Facebook trả HTTP ${response.status}${short ? `: ${short}` : ''}`,
      { status: response.status }
    );
  }
  const parsed = safeJsonParse(text);
  const errors = findFacebookErrors(parsed);
  if (errors.length) {
    throw new AppError('FACEBOOK_RESPONSE_ERROR', errors.join(' · ').slice(0, 1000), { errors });
  }
  if (step.expectJson && text && parsed == null && /error|exception|checkpoint|login/i.test(text)) {
    throw new AppError('FACEBOOK_UNEXPECTED_RESPONSE', 'Facebook trả phản hồi không hợp lệ hoặc yêu cầu xác minh tài khoản.');
  }
  return parsed ?? text;
}

export async function replayPost({ profile, groupId, message, mediaId, signal, onStep }) {
  if (!profile?.ready || !Array.isArray(profile.steps) || !profile.steps.length) {
    throw new AppError('PROFILE_NOT_READY', 'Mẫu request chưa sẵn sàng. Hãy hiệu chuẩn lại.');
  }
  const media = await getMediaBlob(mediaId);
  if (media.metadata.kind !== profile.mode) {
    throw new AppError('PROFILE_MEDIA_MISMATCH', 'Loại media không khớp với mẫu request đã hiệu chuẩn.');
  }

  const session = await refreshSessionContext(signal);
  const context = {
    ...session,
    groupId: String(groupId),
    message: String(message),
    fileName: media.metadata.name,
    fileType: media.metadata.type,
    fileSize: String(media.metadata.size),
    steps: []
  };

  for (let index = 0; index < profile.steps.length; index += 1) {
    if (signal?.aborted) throw new AppError('JOB_PAUSED', 'Tiến trình đã được dừng bởi người dùng.');
    const step = profile.steps[index];
    onStep?.({ index, total: profile.steps.length, label: step.label || `Request ${index + 1}` });
    const url = renderTemplate(step.url, context);
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new AppError('INVALID_PROFILE_URL', 'Mẫu request chứa địa chỉ không hợp lệ.');
    }
    if (parsedUrl.protocol !== 'https:' || !ALLOWED_FACEBOOK_HOSTS.has(parsedUrl.hostname)) {
      throw new AppError(
        'PROFILE_HOST_NOT_ALLOWED',
        `Mẫu request dùng miền chưa được cấp quyền: ${parsedUrl.hostname || '(trống)'}.`
      );
    }
    const request = buildRequestBody(step, context, media);
    const ruleId = await installHeaderRule(groupId);
    try {
      const { response, text } = await fetchText(
        url,
        {
          method: step.method || 'POST',
          headers: request.headers,
          body: request.body,
          referrer: `https://www.facebook.com/groups/${groupId}/`,
          referrerPolicy: 'unsafe-url'
        },
        Number(step.timeoutMs) || (profile.mode === 'video' ? 20 * 60 * 1000 : 120000),
        signal
      );
      context.steps[index] = validateStepResponse(step, response, text);
    } finally {
      await removeHeaderRule(ruleId);
    }
  }

  const reference = extractPostReference(context.steps.at(-1), groupId);
  return {
    ...reference,
    stepCount: profile.steps.length,
    message: reference.postUrl
      ? 'Facebook đã nhận bài đăng.'
      : 'Facebook đã nhận toàn bộ request; bài chờ duyệt vẫn được tính thành công.'
  };
}
