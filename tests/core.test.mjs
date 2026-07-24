import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AppError,
  buildCalibrationProfile,
  extractPostReference,
  findFacebookErrors,
  normalizeGroupIds,
  renderJsonTemplate,
  renderTemplate,
  safeJsonParse
} from '../extension/core.js';

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: {},
    postData: '',
    hasPostData: true,
    startedAt: Date.now(),
    response: {
      status: 200,
      mimeType: 'application/json',
      body: '{}'
    },
    ...overrides
  };
}

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

test('đọc JSON có tiền tố bảo vệ và phát hiện lỗi GraphQL', () => {
  const parsed = safeJsonParse('for (;;);{"data":null,"errors":[{"message":"Không có quyền"}]}');
  assert.equal(parsed.data, null);
  assert.deepEqual(findFacebookErrors(parsed), ['Không có quyền']);
});

test('render token phiên và dữ liệu phụ thuộc giữa các bước', () => {
  const rendered = renderTemplate(
    'g={{GROUP_ID}}&m={{MESSAGE}}&t={{FB_DTSG}}&photo={{STEP_0:payload.photo_id}}',
    {
      groupId: '1234567890',
      message: 'Xin chào',
      fbDtsg: 'fresh-token',
      steps: [{ payload: { photo_id: '888000111' } }]
    }
  );
  assert.equal(rendered, 'g=1234567890&m=Xin chào&t=fresh-token&photo=888000111');
});

test('chèn văn bản có dấu nháy và xuống dòng mà vẫn giữ JSON hợp lệ', () => {
  const template = '{"message":{"text":"{{MESSAGE}}"},"group_id":"{{GROUP_ID}}"}';
  const rendered = renderJsonTemplate(template, {
    message: 'Dòng "một"\\hai\nDòng hai',
    groupId: '1234567890'
  });
  assert.deepEqual(JSON.parse(rendered), {
    message: { text: 'Dòng "một"\\hai\nDòng hai' },
    group_id: '1234567890'
  });
});

test('tạo profile ảnh từ multipart upload và mutation có marker', () => {
  const marker = 'TRUONG_AUTO_IMAGE_SAMPLE';
  const upload = request({
    url: 'https://www.facebook.com/ajax/photos/upload/',
    startedAt: 100,
    headers: { 'content-type': 'multipart/form-data; boundary=test' },
    bodySpec: {
      kind: 'multipart',
      parts: [
        { kind: 'field', name: 'fb_dtsg', value: '{{FB_DTSG}}' },
        { kind: 'media', name: 'file', filename: '{{FILE_NAME}}', type: '{{FILE_TYPE}}' }
      ]
    },
    response: {
      status: 200,
      mimeType: 'application/json',
      body: '{"payload":{"photo_id":"888000111"}}'
    }
  });
  const final = request({
    url: 'https://www.facebook.com/api/graphql/',
    startedAt: 200,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    postData: new URLSearchParams({
      fb_dtsg: 'old-token',
      fb_api_req_friendly_name: 'ComposerStoryCreateMutation',
      variables: JSON.stringify({
        input: {
          actor_id: '777666555',
          group_id: '1234567890',
          message: { text: marker },
          attachments: [{ photo_id: '888000111' }]
        }
      })
    }).toString(),
    response: {
      status: 200,
      mimeType: 'application/json',
      body: '{"data":{"story_create":{"story":{"id":"1234567890_5566778899"}}}}'
    }
  });

  const profile = buildCalibrationProfile({
    mode: 'image',
    marker,
    groupId: '1234567890',
    userId: '777666555',
    requests: { upload, final }
  });

  assert.equal(profile.ready, true);
  assert.equal(profile.stepCount, 2);
  assert.equal(profile.steps[0].body.kind, 'multipart');
  const finalTemplate = JSON.stringify(profile.steps[1]);
  assert.match(finalTemplate, /\{\{MESSAGE\}\}/);
  assert.match(finalTemplate, /\{\{GROUP_ID\}\}/);
  assert.match(finalTemplate, /\{\{STEP_0:payload\.photo_id\}\}/);
  assert.match(finalTemplate, /\{\{FB_DTSG\}\}/);
});

test('tạo profile video từ request binary và thay metadata tệp', () => {
  const marker = 'TRUONG_AUTO_VIDEO_SAMPLE';
  const upload = request({
    url: 'https://rupload.facebook.com/video-upload/v1/sample.mp4',
    startedAt: 100,
    headers: {
      'content-type': 'application/octet-stream',
      'x-entity-name': 'sample.mp4',
      'x-entity-type': 'video/mp4',
      'x-entity-length': '345678'
    },
    postDataOmitted: true,
    response: {
      status: 200,
      mimeType: 'application/json',
      body: '{"video_id":"9090909090"}'
    }
  });
  const final = request({
    url: 'https://www.facebook.com/api/graphql/',
    startedAt: 200,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    postData: new URLSearchParams({
      fb_api_req_friendly_name: 'ComposerStoryCreateMutation',
      variables: JSON.stringify({
        input: {
          actor_id: '777666555',
          group_id: '1234567890',
          message: { text: marker },
          video_id: '9090909090'
        }
      })
    }).toString(),
    response: {
      status: 200,
      mimeType: 'application/json',
      body: '{"data":{"story_create":{"story":{"url":"https://www.facebook.com/groups/1234567890/posts/9988/"}}}}'
    }
  });

  const profile = buildCalibrationProfile({
    mode: 'video',
    marker,
    groupId: '1234567890',
    userId: '777666555',
    requests: { upload, final }
  });

  assert.equal(profile.ready, true);
  assert.equal(profile.steps[0].body.kind, 'raw-media');
  assert.equal(profile.steps[0].headers['x-entity-name'], '{{FILE_NAME}}');
  assert.equal(profile.steps[0].headers['x-entity-type'], '{{FILE_TYPE}}');
  assert.equal(profile.steps[0].headers['x-entity-length'], '{{FILE_SIZE}}');
  assert.match(profile.steps[0].url, /\{\{FILE_NAME\}\}/);
  assert.match(JSON.stringify(profile.steps[1]), /\{\{STEP_0:video_id\}\}/);
});

test('rút URL bài đăng từ phản hồi cuối', () => {
  const reference = extractPostReference({
    data: {
      story_create: {
        story: {
          url: 'https://www.facebook.com/groups/1234567890/posts/998877/'
        }
      }
    }
  }, '1234567890');
  assert.equal(reference.postUrl, 'https://www.facebook.com/groups/1234567890/posts/998877/');
});
