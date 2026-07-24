export const WEB_ORIGIN = 'https://tranquytruong0362683566-gif.github.io';
export const WEB_PATH_PREFIX = '/auto/';
export const STATE_KEYS = Object.freeze({
  job: 'gp.job.v1',
  calibration: 'gp.calibration.v1',
  capture: 'gp.calibration.capture.v1'
});

export const ALLOWED_ACTIONS = new Set([
  'GET_STATE',
  'MEDIA_BEGIN',
  'MEDIA_CHUNK',
  'MEDIA_COMMIT',
  'MEDIA_DELETE',
  'START_JOB',
  'PAUSE_JOB',
  'RESUME_JOB',
  'CLEAR_JOB',
  'CLEAR_RESULTS',
  'CALIBRATION_START',
  'CALIBRATION_STOP'
]);

const SESSION_FIELD_PLACEHOLDERS = Object.freeze({
  fb_dtsg: '{{FB_DTSG}}',
  jazoest: '{{JAZOEST}}',
  lsd: '{{LSD}}',
  __user: '{{USER_ID}}',
  av: '{{USER_ID}}',
  __hsi: '{{HSI}}',
  __rev: '{{REV}}',
  __spin_r: '{{SPIN_R}}',
  __spin_b: '{{SPIN_B}}',
  __spin_t: '{{SPIN_T}}'
});

const SESSION_HEADER_PLACEHOLDERS = Object.freeze({
  'x-fb-lsd': '{{LSD}}'
});

const FORBIDDEN_REPLAY_HEADERS = new Set([
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'referer',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'user-agent'
]);

const RELEVANT_URL = /(graphql|upload|rupload|video|photo|media|composer|story|posts?|ajax)/i;
const UPLOAD_URL = /(upload|rupload|video|photo|media)/i;
const UPLOAD_NAME = /(upload|video|photo|media|attachment|composer.*asset)/i;
const FINAL_NAME = /(composer|storycreate|create.*post|publish.*post|group.*post|feed.*create)/i;

export class AppError extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.name = 'AppError';
    this.code = code || 'UNKNOWN_ERROR';
    this.data = data;
  }
}

export function ok(data = null, message = '', code = 'OK') {
  return { success: true, code, message, data };
}

export function fail(error, fallbackCode = 'UNKNOWN_ERROR') {
  const source = error instanceof Error ? error : new Error(String(error || 'Lỗi không xác định.'));
  return {
    success: false,
    code: source.code || fallbackCode,
    message: source.message || 'Lỗi không xác định.',
    data: source.data ?? null
  };
}

export function normalizeGroupId(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/facebook\.com\/groups\/(\d{5,30})/i);
  const candidate = match ? match[1] : text;
  if (!/^\d{5,30}$/.test(candidate)) {
    throw new AppError('INVALID_GROUP_ID', `UID nhóm không hợp lệ: ${text || '(trống)'}`);
  }
  return candidate;
}

export function normalizeGroupIds(values) {
  if (!Array.isArray(values)) {
    throw new AppError('INVALID_GROUP_LIST', 'Danh sách UID nhóm phải là một mảng.');
  }
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const groupId = normalizeGroupId(value);
    if (!seen.has(groupId)) {
      seen.add(groupId);
      result.push(groupId);
    }
  }
  if (!result.length) throw new AppError('EMPTY_GROUP_LIST', 'Danh sách UID nhóm đang trống.');
  return result;
}

export function makeId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `${prefix}_${random.replaceAll('-', '')}`;
}

export function sanitizeFilename(name, fallback = 'media.bin') {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .trim()
    .slice(0, 180);
  return clean || fallback;
}

export function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function safeJsonParse(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim().replace(/^for\s*\(\s*;;\s*\);\s*/, '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    if (rows.length > 1) {
      const parsed = [];
      for (const row of rows) {
        try {
          parsed.push(JSON.parse(row.replace(/^for\s*\(\s*;;\s*\);\s*/, '')));
        } catch {
          // A streaming response may contain non-JSON status rows.
        }
      }
      if (parsed.length) return parsed;
    }
    return null;
  }
}

export function deepGet(value, path) {
  if (!path) return value;
  const parts = String(path).split('.').filter(Boolean);
  let cursor = value;
  for (const part of parts) {
    if (cursor == null) return undefined;
    const key = /^\d+$/.test(part) ? Number(part) : part;
    cursor = cursor[key];
  }
  return cursor;
}

function walk(value, visitor, path = '') {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, path ? `${path}.${index}` : String(index)));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => walk(item, visitor, path ? `${path}.${key}` : key));
    return;
  }
  visitor(value, path);
}

export function extractResponseScalars(body) {
  const parsed = safeJsonParse(body);
  if (parsed == null) return [];
  const output = [];
  walk(parsed, (value, path) => {
    const text = String(value);
    if (
      (typeof value === 'string' && text.length >= 6 && text.length <= 500)
      || (typeof value === 'number' && Number.isFinite(value) && text.length >= 5)
    ) {
      output.push({ value: text, path });
    }
  });
  return output.sort((left, right) => right.value.length - left.value.length).slice(0, 500);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceLiteralEverywhere(text, value, replacement) {
  const source = String(text ?? '');
  const literal = String(value ?? '');
  if (!literal || !source.includes(literal)) return source;
  return source.replace(new RegExp(escapeRegex(literal), 'g'), replacement);
}

export function templateText(value, context = {}, dependencies = []) {
  let output = String(value ?? '');
  const replacements = [
    [context.marker, '{{MESSAGE}}'],
    [context.groupId, '{{GROUP_ID}}'],
    [context.userId, '{{USER_ID}}'],
    [context.fileName, '{{FILE_NAME}}'],
    [context.fileType, '{{FILE_TYPE}}'],
    [context.fileSize, '{{FILE_SIZE}}']
  ];
  for (const [literal, placeholder] of replacements) {
    if (literal != null && String(literal).length >= 1) {
      output = replaceLiteralEverywhere(output, literal, placeholder);
    }
  }
  for (const dependency of dependencies) {
    output = replaceLiteralEverywhere(
      output,
      dependency.value,
      `{{STEP_${dependency.stepIndex}:${dependency.path}}}`
    );
  }
  return output;
}

function resolvePlaceholder(key, path, context) {
  if (key.startsWith('STEP_')) {
    const index = Number(key.slice(5));
    return deepGet(context.steps?.[index], path || '');
  }
  const lookup = {
    GROUP_ID: context.groupId,
    MESSAGE: context.message,
    USER_ID: context.userId,
    FILE_NAME: context.fileName,
    FILE_TYPE: context.fileType,
    FILE_SIZE: context.fileSize,
    FB_DTSG: context.fbDtsg,
    JAZOEST: context.jazoest,
    LSD: context.lsd,
    HSI: context.hsi,
    REV: context.rev,
    SPIN_R: context.spinR,
    SPIN_B: context.spinB,
    SPIN_T: context.spinT
  };
  return lookup[key];
}

export function renderTemplate(value, context = {}) {
  const source = String(value ?? '');
  return source.replace(/\{\{([A-Z0-9_]+)(?::([^}]+))?\}\}/g, (match, key, path) => {
    const found = resolvePlaceholder(key, path, context);
    return found == null ? '' : String(found);
  });
}

function insideJsonString(source, offset) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < offset; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
  }
  return quoted;
}

export function renderJsonTemplate(value, context = {}) {
  const source = String(value ?? '');
  return source.replace(/\{\{([A-Z0-9_]+)(?::([^}]+))?\}\}/g, (match, key, path, offset) => {
    const found = resolvePlaceholder(key, path, context);
    const text = found == null ? '' : String(found);
    if (insideJsonString(source, offset)) return JSON.stringify(text).slice(1, -1);
    return JSON.stringify(text);
  });
}

export function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const output = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = String(rawName || '').trim().toLowerCase();
    if (!name || FORBIDDEN_REPLAY_HEADERS.has(name) || name.startsWith('sec-ch-')) continue;
    const value = String(rawValue ?? '');
    if (!value || value.length > 5000) continue;
    if (name === 'x-entity-name' || name === 'x-file-name') output[name] = '{{FILE_NAME}}';
    else if (name === 'x-entity-type' || name === 'x-file-type') output[name] = '{{FILE_TYPE}}';
    else if (name === 'x-entity-length' || name === 'x-file-size') output[name] = '{{FILE_SIZE}}';
    else output[name] = SESSION_HEADER_PLACEHOLDERS[name] || value;
  }
  return output;
}

export function friendlyNameFromRequest(request) {
  const body = String(request?.postData || request?.bodyText || '');
  const params = new URLSearchParams(body);
  return params.get('fb_api_req_friendly_name')
    || params.get('fb_api_caller_class')
    || String(request?.headers?.['x-fb-friendly-name'] || request?.headers?.['X-FB-Friendly-Name'] || '');
}

function detectBoundary(contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return (match?.[1] || match?.[2] || '').trim();
}

function parseDisposition(value) {
  const name = String(value || '').match(/(?:^|;)\s*name="([^"]*)"/i)?.[1] || '';
  const filename = String(value || '').match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1] || '';
  return { name, filename };
}

export function parseMultipartTemplate(postData, contentType, context, dependencies) {
  const boundary = detectBoundary(contentType);
  if (!boundary || typeof postData !== 'string') return null;
  const delimiter = `--${boundary}`;
  const rawParts = postData.split(delimiter);
  const parts = [];

  for (const raw of rawParts) {
    const normalized = raw.replace(/^\r?\n/, '').replace(/\r?\n--\r?\n?$/, '').replace(/\r?\n$/, '');
    if (!normalized || normalized === '--') continue;
    const divider = normalized.search(/\r?\n\r?\n/);
    if (divider < 0) continue;
    const headerText = normalized.slice(0, divider);
    const data = normalized.slice(divider).replace(/^\r?\n\r?\n/, '');
    const headers = {};
    for (const line of headerText.split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const disposition = parseDisposition(headers['content-disposition']);
    const looksLikeMedia = Boolean(disposition.filename)
      || /^image\/|^video\/|octet-stream/i.test(headers['content-type'] || '')
      || (context.fileName && data.includes(context.fileName));
    if (looksLikeMedia) {
      parts.push({
        kind: 'media',
        name: disposition.name || 'file',
        filename: '{{FILE_NAME}}',
        type: '{{FILE_TYPE}}'
      });
    } else {
      parts.push({
        kind: 'field',
        name: disposition.name || '',
        value: SESSION_FIELD_PLACEHOLDERS[disposition.name]
          || templateText(data, context, dependencies)
      });
    }
  }
  return parts.some((part) => part.kind === 'media') ? parts : null;
}

export function captureBodySpec(request, context, dependencies = []) {
  const headers = request?.headers || {};
  const contentType = String(
    headers['content-type']
    || headers['Content-Type']
    || request?.mimeType
    || ''
  ).toLowerCase();
  const postData = typeof request?.postData === 'string' ? request.postData : '';
  const url = String(request?.url || '');

  if (request?.bodySpec?.kind === 'multipart') {
    return {
      kind: 'multipart',
      parts: request.bodySpec.parts.map((part) => part.kind === 'field'
        ? { ...part, value: templateText(part.value, context, dependencies) }
        : { ...part })
    };
  }

  if (contentType.includes('multipart/form-data')) {
    const parts = parseMultipartTemplate(postData, contentType, context, dependencies);
    if (parts) return { kind: 'multipart', parts };
    return { kind: 'multipart', parts: [{ kind: 'media', name: 'file', filename: '{{FILE_NAME}}', type: '{{FILE_TYPE}}' }] };
  }

  if (
    request?.postDataOmitted
    || /^image\/|^video\/|application\/octet-stream/i.test(contentType)
    || (UPLOAD_URL.test(url) && request?.hasPostData && !postData)
  ) {
    return { kind: 'raw-media' };
  }

  if (contentType.includes('application/x-www-form-urlencoded') || /\/api\/graphql|\/graphql/i.test(url)) {
    const params = new URLSearchParams(postData);
    const entries = [];
    for (const [key, rawValue] of params.entries()) {
      const placeholder = SESSION_FIELD_PLACEHOLDERS[key];
      entries.push([
        key,
        placeholder || templateText(rawValue, context, dependencies)
      ]);
    }
    return { kind: 'urlencoded', entries };
  }

  return {
    kind: 'text',
    value: templateText(postData, context, dependencies),
    contentType: contentType || 'text/plain;charset=UTF-8'
  };
}

function requestContains(request, needle) {
  const target = String(needle || '');
  if (!target) return false;
  return [
    request?.url,
    request?.postData,
    request?.bodyText
  ].some((value) => String(value || '').includes(target));
}

function isSuccessfulCapture(request) {
  const status = Number(request?.response?.status || 0);
  return !request?.failed && (!status || (status >= 200 && status < 400));
}

function isUploadCandidate(request, mode) {
  const url = String(request?.url || '');
  const friendly = friendlyNameFromRequest(request);
  const contentType = String(
    request?.headers?.['content-type']
    || request?.headers?.['Content-Type']
    || ''
  );
  if (UPLOAD_URL.test(url) || UPLOAD_NAME.test(friendly)) return true;
  if (mode === 'image' && /image\//i.test(contentType)) return true;
  if (mode === 'video' && /video\/|octet-stream/i.test(contentType)) return true;
  return false;
}

function requestFingerprint(request) {
  const url = String(request?.url || '').replace(/[?&](?:__req|jazoest|lsd|fb_dtsg)=[^&]*/gi, '');
  const contentType = String(request?.headers?.['content-type'] || request?.headers?.['Content-Type'] || '');
  return `${request?.method || 'POST'}|${url}|${contentType}|${friendlyNameFromRequest(request)}`;
}

function deduplicateMediaRequests(requests) {
  const seenRaw = new Set();
  return requests.filter((request) => {
    const contentType = String(request?.headers?.['content-type'] || request?.headers?.['Content-Type'] || '');
    const raw = request?.postDataOmitted
      || /^image\/|^video\/|application\/octet-stream/i.test(contentType);
    if (!raw) return true;
    const key = requestFingerprint(request);
    if (seenRaw.has(key)) return false;
    seenRaw.add(key);
    return true;
  });
}

function collectDependencies(steps) {
  const dependencies = [];
  steps.forEach((request, stepIndex) => {
    for (const scalar of extractResponseScalars(request?.response?.body)) {
      dependencies.push({ ...scalar, stepIndex });
    }
  });
  return dependencies;
}

function templateRequest(request, context, priorRequests, stepIndex) {
  const dependencies = collectDependencies(priorRequests);
  const headers = normalizeHeaders(request.headers);
  for (const [name, value] of Object.entries(headers)) {
    headers[name] = templateText(value, context, dependencies);
  }
  const body = captureBodySpec(request, context, dependencies);
  const friendlyName = friendlyNameFromRequest(request);

  return {
    index: stepIndex,
    label: friendlyName || (isUploadCandidate(request, context.mode) ? 'Tải media' : 'Gửi bài viết'),
    method: String(request.method || 'POST').toUpperCase(),
    url: templateText(request.url, context, dependencies),
    headers,
    body,
    timeoutMs: body.kind === 'raw-media' && context.mode === 'video' ? 20 * 60 * 1000 : 120000,
    expectJson: /graphql|ajax|upload|video|photo/i.test(String(request.url || ''))
  };
}

export function buildCalibrationProfile(capture) {
  const mode = capture?.mode === 'video' ? 'video' : 'image';
  const marker = String(capture?.marker || '');
  const requestValues = Object.values(capture?.requests || {});
  const sampleEntityRequest = requestValues.find((request) => {
    const headers = request?.headers || {};
    return headers['x-entity-name'] || headers['X-Entity-Name'] || headers['x-entity-type'] || headers['X-Entity-Type'];
  });
  const sampleHeaders = sampleEntityRequest?.headers || {};
  const context = {
    mode,
    marker,
    groupId: String(capture?.groupId || ''),
    userId: String(capture?.userId || ''),
    fileName: String(
      capture?.sampleMedia?.name
      || sampleHeaders['x-entity-name']
      || sampleHeaders['X-Entity-Name']
      || ''
    ),
    fileType: String(
      capture?.sampleMedia?.type
      || sampleHeaders['x-entity-type']
      || sampleHeaders['X-Entity-Type']
      || ''
    ),
    fileSize: String(
      capture?.sampleMedia?.size
      || sampleHeaders['x-entity-length']
      || sampleHeaders['X-Entity-Length']
      || ''
    )
  };
  const requests = Object.values(capture?.requests || {})
    .filter((request) => ['POST', 'PUT', 'PATCH'].includes(String(request?.method || '').toUpperCase()))
    .filter((request) => /^https:\/\/(?:[^/]+\.)?facebook\.com\//i.test(String(request?.url || '')))
    .filter((request) => RELEVANT_URL.test(String(request?.url || '')) || RELEVANT_URL.test(friendlyNameFromRequest(request)))
    .filter(isSuccessfulCapture)
    .sort((left, right) => Number(left.startedAt || 0) - Number(right.startedAt || 0));

  const finals = requests.filter((request) => requestContains(request, marker));
  const finalRequest = finals
    .filter((request) => FINAL_NAME.test(friendlyNameFromRequest(request)) || /graphql|composer|story/i.test(request.url || ''))
    .at(-1)
    || finals.at(-1);

  if (!finalRequest) {
    return {
      mode,
      ready: false,
      createdAt: Date.now(),
      stepCount: 0,
      message: 'Không tìm thấy request tạo bài có đoạn đánh dấu. Hãy giữ tab ghi mẫu, đăng đúng đoạn đánh dấu rồi bấm hoàn tất.'
    };
  }

  const finalTime = Number(finalRequest.startedAt || Number.MAX_SAFE_INTEGER);
  const uploadRequests = requests.filter((request) => {
    const time = Number(request.startedAt || 0);
    return time <= finalTime && request !== finalRequest && isUploadCandidate(request, mode);
  });

  if (!uploadRequests.length) {
    return {
      mode,
      ready: false,
      createdAt: Date.now(),
      stepCount: 0,
      message: `Đã thấy request tạo bài nhưng chưa thấy request tải ${mode === 'image' ? 'ảnh' : 'video'}. Hãy ghi lại với đúng loại media.`
    };
  }

  // Keep upload-related GraphQL setup calls when their friendly name says that
  // they create or attach media. Telemetry and unrelated background calls are
  // deliberately excluded.
  const selected = deduplicateMediaRequests([...uploadRequests, finalRequest])
    .sort((left, right) => Number(left.startedAt || 0) - Number(right.startedAt || 0));
  const steps = selected.map((request, index) => templateRequest(request, context, selected.slice(0, index), index));
  const hasMediaBody = steps.some((step) => ['raw-media', 'multipart'].includes(step.body.kind));
  const hasMessage = JSON.stringify(steps.at(-1) || {}).includes('{{MESSAGE}}');

  if (!hasMediaBody || !hasMessage) {
    return {
      mode,
      ready: false,
      createdAt: Date.now(),
      stepCount: steps.length,
      message: 'Mẫu đã ghi chưa xác định được phần media hoặc nội dung bài viết. Hãy ghi lại bằng một tệp nhỏ và chỉ dùng đoạn đánh dấu được cung cấp.',
      diagnostics: {
        capturedRequests: requests.length,
        selectedRequests: selected.length,
        hasMediaBody,
        hasMessage
      }
    };
  }

  return {
    version: 1,
    mode,
    ready: true,
    createdAt: Date.now(),
    stepCount: steps.length,
    sourceGroupId: context.groupId,
    steps,
    diagnostics: {
      capturedRequests: requests.length,
      selectedRequests: selected.length
    }
  };
}

export function findFacebookErrors(value) {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  const messages = [];
  const visit = (item, depth = 0) => {
    if (item == null || depth > 12) return;
    if (Array.isArray(item)) {
      item.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (typeof item !== 'object') return;

    if (Array.isArray(item.errors)) {
      for (const error of item.errors) {
        const message = error?.message || error?.description || error?.summary || error?.code;
        if (message) messages.push(String(message));
      }
    }
    if (item.error && typeof item.error === 'object') {
      const message = item.error.message || item.error.error_user_msg || item.error.error_user_title || item.error.code;
      if (message) messages.push(String(message));
    }
    if (item.errorSummary || item.errorDescription) {
      messages.push(String(item.errorDescription || item.errorSummary));
    }
    Object.values(item).forEach((entry) => visit(entry, depth + 1));
  };
  visit(parsed);
  return [...new Set(messages)].filter(Boolean);
}

export function extractPostReference(value, groupId) {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  let postUrl = '';
  let postId = '';
  walk(parsed, (entry, path) => {
    const text = String(entry || '');
    if (!postUrl && /(?:permalink|story|posts?)_?url|url$/i.test(path) && /^https?:\/\//i.test(text)) {
      postUrl = text.replaceAll('\\/', '/');
    }
    if (!postId && /(?:post|story|feedback).*id$/i.test(path) && /^\d{5,40}(?:_\d{5,40})?$/.test(text)) {
      postId = text.includes('_') ? text.split('_').at(-1) : text;
    }
  });
  if (!postUrl && postId) {
    postUrl = `https://www.facebook.com/groups/${groupId}/permalink/${postId}/`;
  }
  return { postUrl, postId };
}
