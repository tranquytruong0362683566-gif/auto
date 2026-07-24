import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';

const extensionDirectory = new URL('../extension/', import.meta.url);
const webDirectory = new URL('../web/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', extensionDirectory), 'utf8'));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '1.2.1');
assert.equal(manifest.background.type, 'module');
assert.equal(manifest.background.service_worker, 'background.js');
assert.ok(manifest.permissions.includes('storage'));
assert.ok(manifest.permissions.includes('alarms'));
assert.ok(manifest.permissions.includes('tabs'));
assert.ok(!manifest.permissions.includes('debugger'));
assert.ok(!manifest.permissions.includes('declarativeNetRequestWithHostAccess'));
assert.ok(!manifest.permissions.includes('cookies'));
assert.ok(!manifest.permissions.includes('unlimitedStorage'));
assert.ok(!manifest.host_permissions.includes('https://*.facebook.com/*'));
assert.ok(manifest.host_permissions.includes('https://www.facebook.com/*'));
assert.ok(manifest.host_permissions.includes('https://upload.facebook.com/*'));
assert.ok(manifest.host_permissions.includes('https://rupload.facebook.com/*'));
assert.ok(manifest.host_permissions.includes('https://tranquytruong0362683566-gif.github.io/auto/*'));

const webScript = manifest.content_scripts.find((entry) => (
  entry.matches.includes('https://tranquytruong0362683566-gif.github.io/auto/*')
));
assert.deepEqual(webScript.matches, [
  'https://tranquytruong0362683566-gif.github.io/auto/*'
]);
assert.deepEqual(webScript.js, ['bridge.js']);

const mainEngine = manifest.content_scripts.find((entry) => entry.world === 'MAIN');
assert.ok(mainEngine.matches.includes('https://www.facebook.com/*'));
assert.deepEqual(mainEngine.js, ['engine-main.js']);
const relayEngine = manifest.content_scripts.find((entry) => (
  entry.js.includes('engine-relay.js')
));
assert.ok(relayEngine.matches.includes('https://www.facebook.com/*'));

for (const file of [
  'background.js',
  'bridge.js',
  'core.js',
  'engine-main.js',
  'engine-relay.js',
  'facebook.js',
  'manifest.json',
  'popup.css',
  'popup.html',
  'popup.js',
  'queue.js',
  'storage.js'
]) {
  await access(new URL(file, extensionDirectory));
}

for (const file of ['index.html', 'styles.css', 'bridge-client.js', 'app.js', 'favicon.svg']) {
  await access(new URL(file, webDirectory));
}

const extensionFiles = await readdir(extensionDirectory);
assert.ok(!extensionFiles.includes('calibration.js'));
assert.ok(!extensionFiles.includes('replay.js'));

const webIndex = await readFile(new URL('index.html', webDirectory), 'utf8');
assert.match(webIndex, /id="postContent"/);
assert.match(webIndex, /id="mediaInput"/);
assert.match(webIndex, /id="groupIds"/);
assert.match(webIndex, /id="pauseBtn"/);
assert.match(webIndex, /id="resumeBtn"/);
assert.doesNotMatch(webIndex, /recordImageBtn|recordVideoBtn|calibrationSession/);
assert.doesNotMatch(webIndex, /name="mediaMode"/);
assert.match(webIndex, /Không bắt buộc · mặc định chỉ văn bản/);
assert.match(webIndex, /Truong-Group-Publisher-Extension-v1\.2\.1\.zip/);

const bridge = await readFile(new URL('bridge.js', extensionDirectory), 'utf8');
assert.doesNotMatch(bridge, /CALIBRATION_START|CALIBRATION_STOP/);
const webApp = await readFile(new URL('app.js', webDirectory), 'utf8');
assert.doesNotMatch(webApp, /Hãy chọn một \$\{mode/);
assert.match(webApp, /if \(selectedFile\)/);
const queue = await readFile(new URL('queue.js', extensionDirectory), 'utf8');
assert.match(queue, /mediaId: metadata\?\.id \|\| ''/);
const engineMain = await readFile(new URL('engine-main.js', extensionDirectory), 'utf8');
assert.match(engineMain, /attachments: attachment \? \[attachment\] : \[\]/);
assert.match(engineMain, /'x-entity-name': headerFilename/);

const runtimeSource = [
  webIndex,
  webApp,
  ...(await Promise.all(
    extensionFiles
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFile(new URL(file, extensionDirectory), 'utf8'))
  ))
].join('\n');
assert.doesNotMatch(runtimeSource, /chưa hiệu chuẩn request|calibration/i);

const scripts = [
  ...extensionFiles.filter((file) => file.endsWith('.js')),
  ...(await readdir(webDirectory)).filter((file) => file.endsWith('.js'))
];
assert.ok(scripts.length >= 11);
console.log(`Project validation passed: ${scripts.length} JavaScript files.`);
