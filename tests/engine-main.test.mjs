import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const engineSource = fs.readFileSync(
  new URL('../extension/engine-main.js', import.meta.url),
  'utf8'
);

function createEngine(modules = {}, options = {}) {
  const listeners = [];
  const messages = [];
  const responseWaiters = new Map();
  const origin = 'https://www.facebook.com';
  const fakeWindow = {
    devicePixelRatio: 1,
    require(name) {
      if (Object.hasOwn(modules, name)) return modules[name];
      throw new Error(`Unknown module: ${name}`);
    },
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message, targetOrigin) {
      assert.equal(targetOrigin, origin);
      messages.push(message);
      if (message?.type === 'GROUP_PUBLISHER_ENGINE_RESPONSE') {
        const resolve = responseWaiters.get(message.requestId);
        if (resolve) {
          responseWaiters.delete(message.requestId);
          resolve(message);
        }
      }
    }
  };
  const context = vm.createContext({
    AbortController,
    Blob,
    FormData,
    URL,
    URLSearchParams,
    console,
    crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
    document: { scripts: [] },
    fetch: options.fetchImpl || (async () => {
      throw new Error('PING must not perform a network request');
    }),
    location: { origin },
    performance: { getEntriesByType: () => [] },
    setTimeout,
    clearTimeout,
    window: fakeWindow
  });
  vm.runInContext(engineSource, context, { filename: 'engine-main.js' });
  assert.equal(listeners.length, 1);
  function emit(action, payload, requestId) {
    listeners[0]({
      source: fakeWindow,
      origin,
      data: {
        source: 'GROUP_PUBLISHER_ENGINE_RELAY',
        type: 'GROUP_PUBLISHER_ENGINE_REQUEST',
        requestId,
        action,
        payload
      }
    });
  }
  return {
    dispatch(action, requestId = 'test_request', payload = {}) {
      emit(action, payload, requestId);
      return messages.at(-1);
    },
    dispatchAndWait(action, payload = {}, requestId = 'test_async_request') {
      return new Promise((resolve) => {
        responseWaiters.set(requestId, resolve);
        emit(action, payload, requestId);
      });
    }
  };
}

test('máy request báo sẵn sàng khi phiên Facebook có đủ UID và token', () => {
  const engine = createEngine({
    CurrentUserInitialData: { USER_ID: '123456789012345' },
    DTSGInitialData: { token: 'dtsg-token' },
    LSD: { token: 'lsd-token' },
    SiteData: { client_revision: '101' }
  });
  const reply = engine.dispatch('PING');
  assert.equal(reply.type, 'GROUP_PUBLISHER_ENGINE_RESPONSE');
  assert.equal(reply.response.success, true);
  assert.equal(reply.response.code, 'ENGINE_READY');
  assert.equal(reply.response.data.account.uid, '123456789012345');
});

test('máy request không báo sẵn sàng khi Facebook thiếu token phiên', () => {
  const engine = createEngine({
    CurrentUserInitialData: { USER_ID: '123456789012345' },
    DTSGInitialData: { token: '' },
    LSD: { token: '' },
    SiteData: {}
  });
  const reply = engine.dispatch('PING');
  assert.equal(reply.response.success, false);
  assert.equal(reply.response.code, 'FACEBOOK_SESSION_TOKEN_MISSING');
  assert.equal(reply.response.data.ready, false);
});

test('đăng văn bản thuần không tải media và gửi attachments rỗng', async () => {
  const requests = [];
  const engine = createEngine({
    CurrentUserInitialData: { USER_ID: '123456789012345' },
    DTSGInitialData: { token: 'dtsg-token' },
    LSD: { token: 'lsd-token' },
    SiteData: { client_revision: '101' },
    ComposerStoryCreateMutation_facebookRelayOperation: {
      params: { id: '25879074401770690' }
    }
  }, {
    async fetchImpl(url, request) {
      requests.push({ url: String(url), request });
      return {
        ok: true,
        status: 200,
        async text() {
          return 'for (;;);{"data":{"story_create":{"story":{"id":"123456789012345_998877665544"}}}}';
        }
      };
    }
  });

  const reply = await engine.dispatchAndWait('POST', {
    groupId: '123456789012345',
    message: 'Bài viết chỉ có văn bản',
    mediaId: '',
    media: null
  });

  assert.equal(reply.response.success, true);
  assert.equal(reply.response.code, 'POST_ACCEPTED');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://www.facebook.com/api/graphql/');
  const body = new URLSearchParams(requests[0].request.body);
  const variables = JSON.parse(body.get('variables'));
  assert.deepEqual(variables.input.attachments, []);
  assert.equal(variables.input.message.text, 'Bài viết chỉ có văn bản');
});

for (const mediaCase of [
  {
    kind: 'image',
    type: 'image/jpeg',
    name: 'anh.jpg',
    uploadPath: '/ajax/react_composer/attachments/photo/upload',
    uploadResponse: 'for (;;);{"payload":{"photoID":"778899001122"}}',
    expectedAttachment: { photo: { id: '778899001122' } }
  },
  {
    kind: 'video',
    type: 'video/mp4',
    name: 'video.mp4',
    uploadPath: '/ajax/react_composer/attachments/video/upload',
    uploadResponse: 'for (;;);{"payload":{"videoID":"998877665544"}}',
    expectedAttachment: { video: { id: '998877665544' } }
  }
]) {
  test(`đăng văn bản kèm ${mediaCase.kind === 'image' ? 'ảnh' : 'video'} tự nhận loại tệp`, async () => {
    const requests = [];
    const engine = createEngine({
      CurrentUserInitialData: { USER_ID: '123456789012345' },
      DTSGInitialData: { token: 'dtsg-token' },
      LSD: { token: 'lsd-token' },
      SiteData: { client_revision: '101' },
      ComposerStoryCreateMutation_facebookRelayOperation: {
        params: { id: '25879074401770690' }
      }
    }, {
      async fetchImpl(url, request) {
        const requestUrl = String(url);
        requests.push({ url: requestUrl, request });
        const isUpload = requestUrl.includes(mediaCase.uploadPath);
        return {
          ok: true,
          status: 200,
          async text() {
            return isUpload
              ? mediaCase.uploadResponse
              : 'for (;;);{"data":{"story_create":{"story":{"id":"123456789012345_112233445566"}}}}';
          }
        };
      }
    });
    const file = new Blob(['media-test'], { type: mediaCase.type });
    const reply = await engine.dispatchAndWait('POST', {
      groupId: '123456789012345',
      message: 'Bài viết có tệp đính kèm',
      mediaId: 'media_test',
      media: {
        kind: mediaCase.kind,
        name: mediaCase.name,
        type: mediaCase.type,
        size: file.size,
        totalChunks: 1
      },
      file
    }, `test_${mediaCase.kind}`);

    assert.equal(reply.response.success, true);
    assert.equal(requests.length, 2);
    assert.ok(requests[0].url.includes(mediaCase.uploadPath));
    const body = new URLSearchParams(requests[1].request.body);
    const variables = JSON.parse(body.get('variables'));
    assert.deepEqual(variables.input.attachments, [mediaCase.expectedAttachment]);
  });
}
