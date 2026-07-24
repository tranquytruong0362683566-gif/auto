import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const engineSource = fs.readFileSync(
  new URL('../extension/engine-main.js', import.meta.url),
  'utf8'
);

function createEngine(modules = {}) {
  const listeners = [];
  const messages = [];
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
    fetch: async () => {
      throw new Error('PING must not perform a network request');
    },
    location: { origin },
    performance: { getEntriesByType: () => [] },
    setTimeout,
    clearTimeout,
    window: fakeWindow
  });
  vm.runInContext(engineSource, context, { filename: 'engine-main.js' });
  assert.equal(listeners.length, 1);
  return {
    dispatch(action, requestId = 'test_request') {
      listeners[0]({
        source: fakeWindow,
        origin,
        data: {
          source: 'GROUP_PUBLISHER_ENGINE_RELAY',
          type: 'GROUP_PUBLISHER_ENGINE_REQUEST',
          requestId,
          action,
          payload: {}
        }
      });
      return messages.at(-1);
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
