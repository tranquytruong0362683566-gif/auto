import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const extensionDirectory = new URL('../extension/', import.meta.url);
const webDirectory = new URL('../web/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', extensionDirectory), 'utf8'));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, 'module');
assert.equal(manifest.background.service_worker, 'background.js');
assert.ok(manifest.permissions.includes('debugger'));
assert.ok(manifest.permissions.includes('storage'));
assert.ok(manifest.permissions.includes('alarms'));
assert.ok(manifest.permissions.includes('declarativeNetRequestWithHostAccess'));
assert.ok(!manifest.permissions.includes('cookies'));
assert.ok(!manifest.permissions.includes('unlimitedStorage'));
assert.ok(!manifest.host_permissions.includes('https://*.facebook.com/*'));
assert.ok(manifest.host_permissions.includes('https://www.facebook.com/*'));
assert.ok(manifest.host_permissions.includes('https://rupload.facebook.com/*'));
assert.ok(manifest.host_permissions.includes('https://tranquytruong0362683566-gif.github.io/auto/*'));
assert.deepEqual(manifest.content_scripts[0].matches, [
  'https://tranquytruong0362683566-gif.github.io/auto/*'
]);

for (const file of [
  'background.js',
  'bridge.js',
  'calibration.js',
  'core.js',
  'manifest.json',
  'popup.css',
  'popup.html',
  'popup.js',
  'queue.js',
  'replay.js',
  'storage.js'
]) {
  await access(new URL(file, extensionDirectory));
}

for (const file of ['index.html', 'styles.css', 'bridge-client.js', 'app.js', 'favicon.svg']) {
  await access(new URL(file, webDirectory));
}

const webIndex = await readFile(new URL('index.html', webDirectory), 'utf8');
assert.match(webIndex, /id="postContent"/);
assert.match(webIndex, /id="mediaInput"/);
assert.match(webIndex, /id="groupIds"/);
assert.match(webIndex, /id="pauseBtn"/);
assert.match(webIndex, /id="resumeBtn"/);
assert.match(webIndex, /id="recordImageBtn"/);
assert.match(webIndex, /id="recordVideoBtn"/);

const scripts = [
  ...(await readdir(extensionDirectory)).filter((file) => file.endsWith('.js')),
  ...(await readdir(webDirectory)).filter((file) => file.endsWith('.js'))
];
assert.ok(scripts.length >= 9);
console.log(`Project validation passed: ${scripts.length} JavaScript files.`);
