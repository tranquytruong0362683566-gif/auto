import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AppError,
  base64ToBytes,
  bytesToBase64,
  extractPostReference,
  findFacebookErrors,
  normalizeGroupIds,
  safeJsonParse
} from '../extension/core.js';

test('chuẩn hóa UID nhóm, loại trùng và từ chối dữ liệu sai', () => {
  assert.deepEqual(
    normalizeGroupIds([
      '1234567890',
      'https://www.facebook.com/groups/9988776655/',
      '1234567890'
    ]),
    ['1234567890', '9988776655']
  );
  assert.throws(
    () => normalizeGroupIds(['not-a-group']),
    (error) => error instanceof AppError && error.code === 'INVALID_GROUP_ID'
  );
});

test('đọc phản hồi Facebook có tiền tố bảo vệ', () => {
  assert.deepEqual(
    safeJsonParse('for (;;);{"payload":{"photoID":"888000111"}}'),
    { payload: { photoID: '888000111' } }
  );
  assert.deepEqual(
    safeJsonParse(')]}\'{"data":{"story_create":{"story":{"id":"123_456"}}}}'),
    { data: { story_create: { story: { id: '123_456' } } } }
  );
});

test('đọc nhiều dòng GraphQL và bỏ qua cảnh báo Relay', () => {
  const parsed = safeJsonParse([
    '{"data":{"story_create":{"story":{"id":"1234567890_9988776655"}}}}',
    '{"errors":[{"severity":"WARNING","message":"Relay provider không dùng"}]}'
  ].join('\n'));
  assert.equal(parsed.length, 2);
  assert.deepEqual(findFacebookErrors(parsed), []);
});

test('giữ lại lỗi Facebook nghiêm trọng', () => {
  const parsed = {
    data: null,
    errors: [
      { severity: 'CRITICAL', message: 'Không có quyền đăng vào nhóm này.' },
      { severity: 'WARNING', message: 'Cảnh báo không chặn request.' }
    ]
  };
  assert.deepEqual(findFacebookErrors(parsed), ['Không có quyền đăng vào nhóm này.']);
});

test('chuyển đổi base64 theo hai chiều không làm hỏng byte', () => {
  const source = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
  const encoded = bytesToBase64(source);
  assert.deepEqual(base64ToBytes(encoded), source);
});

test('rút URL và ID bài đăng từ phản hồi GraphQL', () => {
  const reference = extractPostReference({
    data: {
      story_create: {
        story: {
          id: '1234567890_9988776655',
          url: 'https://www.facebook.com/groups/1234567890/posts/9988776655/'
        }
      }
    }
  }, '1234567890');
  assert.equal(
    reference.postUrl,
    'https://www.facebook.com/groups/1234567890/posts/9988776655/'
  );
  assert.equal(reference.postId, '9988776655');
});
