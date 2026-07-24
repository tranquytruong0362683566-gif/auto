export const WEB_ORIGIN = 'https://tranquytruong0362683566-gif.github.io';
export const WEB_PATH_PREFIX = '/auto/';

export const STATE_KEYS = Object.freeze({
  job: 'gp.job.v2',
  engine: 'gp.facebook.engine.v1'
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
  'CLEAR_RESULTS'
]);

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

export function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
  let binary = '';
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  }
  return btoa(binary);
}

export function safeJsonParse(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '')
    .trim()
    .replace(/^for\s*\(\s*;;\s*\);\s*/, '')
    .replace(/^\)\]\}'\s*/, '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    const parsed = [];
    for (const row of rows) {
      try {
        parsed.push(JSON.parse(
          row
            .replace(/^for\s*\(\s*;;\s*\);\s*/, '')
            .replace(/^\)\]\}'\s*/, '')
        ));
      } catch {
        // Facebook GraphQL streaming responses may contain non-JSON status rows.
      }
    }
    return parsed.length ? parsed : null;
  }
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
        const severity = String(error?.severity || error?.level || '').toUpperCase();
        if (severity === 'WARNING' || severity === 'INFO') continue;
        const message = error?.message || error?.description || error?.summary || error?.code;
        if (message) messages.push(String(message));
      }
    }
    if (item.error && typeof item.error === 'object') {
      const message = item.error.message
        || item.error.error_user_msg
        || item.error.error_user_title
        || item.error.code;
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
