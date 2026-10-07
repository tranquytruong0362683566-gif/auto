import { storedVerificationText } from './verification.js?v=admin-simple-12h-1';
import { STATUS_LABELS, keyStatus, remainingText, durationHours } from './key-state.js?v=admin-simple-12h-1';
import { browserName, sourceLabel } from './verification-sources.js?v=admin-sources-15-1';

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const PAGE_SIZE = 25;
  const UPGRADE_MESSAGE = 'Cần hoàn tất SQL WEB/ADMIN hiện có rồi chạy 13-EXTENSION-TAO-KEY.sql của bản 4.0.9.';
  const ERRORS = {
    ADMIN_REQUIRED: 'Tài khoản này chưa có quyền ADMIN.',
    REVISION_CONFLICT: 'KEY vừa được thay đổi ở phiên khác. Làm mới danh sách rồi thử lại.',
    LICENSE_NOT_FOUND: 'KEY đã được xóa hoặc không còn tồn tại. Hãy làm mới danh sách.',
    RESTORE_ARCHIVED_KEY_FIRST: 'Khôi phục KEY đã lưu trữ trước khi duyệt hoặc gia hạn.',
    KEY_NOT_ARCHIVED: 'KEY này không ở trong danh sách lưu trữ.',
    INVALID_KEY_ACTION: 'Thao tác hoặc thời hạn chưa hợp lệ.',
    INVALID_LICENSE: 'Mã KEY hoặc extension chưa hợp lệ.',
    INVALID_QUERY: 'Bộ lọc chưa hợp lệ.',
    'Invalid login credentials': 'Email hoặc mật khẩu chưa đúng.'
  };
  let session = null, refreshPromise = null, sessionGeneration = 0, loadGeneration = 0;
  let offset = 0, total = 0, items = [], products = [], selected = new Map();
  let rowNodes = new Map(), clock = null, modalJob = null, busyCount = 0;
  let searchTimer, toastTimer, captchaWidget, captchaToken = '';
  let sourceJob = null, sourceOffset = 0, sourceTotal = 0, sourceGeneration = 0;
  const config = () => window.TQT_CONFIG || {};
  const serverNow = () => clock ? clock.time + performance.now() - clock.tick : Date.now();

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text ?? '';
    if (className) node.className = className;
    return node;
  }
  function readable(error) {
    const message = error?.message || String(error);
    if (/PGRST202|Could not find the function|ADMIN_12H_UPGRADE_REQUIRED/.test(message)) return UPGRADE_MESSAGE;
    if (/duplicate key|23505/.test(message)) return 'KEY này đã có trong hệ thống. Hãy tìm trong danh sách.';
    if (message === 'Failed to fetch' || error?.name === 'AbortError') return 'Chưa kết nối được máy chủ. Kiểm tra mạng và bấm Làm mới.';
    return ERRORS[message] || message;
  }
  function fail(error) {
    if (error?.code === 'SESSION_CHANGED') return;
    const target = session ? $('error-banner') : $('login-error');
    target.textContent = readable(error); target.hidden = false;
  }
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
  }
  async function busy(button, task) {
    button.disabled = true; busyCount++;
    try { await task(); } catch (error) { fail(error); }
    finally { button.disabled = false; busyCount--; }
  }
  function button(label, task, className = 'secondary small') {
    const node = el('button', label, className); node.type = 'button';
    node.onclick = () => busy(node, task); return node;
  }
  const changedSession = () => Object.assign(new Error('Phiên đăng nhập đã thay đổi.'), { code: 'SESSION_CHANGED' });

  // Keep the original public-key validation and authenticated RPC access.
  async function request(path, body, token) {
    const c = config();
    if (!c.supabaseUrl || !c.supabaseAnonKey || /YOUR_|PASTE_/i.test(c.supabaseUrl + c.supabaseAnonKey)) {
      throw Error('Chưa cấu hình Supabase trong config.js.');
    }
    let validKey = /^sb_publishable_[a-z0-9_-]+$/i.test(c.supabaseAnonKey);
    if (!validKey) {
      try { validKey = JSON.parse(atob(c.supabaseAnonKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch {}
    }
    if (!validKey) throw Error('Chỉ dùng publishable hoặc anon key cho trang web.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(c.supabaseUrl + path, {
        method: 'POST', cache: 'no-store', credentials: 'omit', signal: controller.signal,
        headers: { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(body)
      });
      const raw = await response.text(); let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { throw Error('Máy chủ trả về dữ liệu không hợp lệ.'); }
      if (!response.ok) throw Object.assign(Error(data.message || data.msg || data.error_description || 'HTTP ' + response.status), { status: response.status });
      return data;
    } finally { clearTimeout(timer); }
  }
  function newSession(data) {
    if (!data.access_token || !data.refresh_token) throw Error('Không nhận được phiên đăng nhập.');
    return { ...data, expires_at: data.expires_at || Date.now() / 1000 + (data.expires_in || 3600) };
  }
  async function guard() {
    if (!session) throw Error('Cần đăng nhập ADMIN.');
    if (session.expires_at * 1000 > Date.now() + 60000) return;
    if (!refreshPromise) {
      const saved = session, generation = sessionGeneration;
      const task = request('/auth/v1/token?grant_type=refresh_token', { refresh_token: saved.refresh_token })
        .then(data => { if (generation !== sessionGeneration) throw changedSession(); session = newSession(data); })
        .catch(error => { if (generation === sessionGeneration && [400, 401].includes(error.status)) logoutLocal(); throw error; })
        .finally(() => { if (refreshPromise === task) refreshPromise = null; });
      refreshPromise = task;
    }
    await refreshPromise;
  }
  async function rpc(name, params = {}) {
    const generation = sessionGeneration;
    await guard();
    if (generation !== sessionGeneration) throw changedSession();
    let result;
    try { result = await request('/rest/v1/rpc/' + name, params, session.access_token); }
    catch (error) {
      if (error.status !== 401 || generation !== sessionGeneration) throw error;
      session.expires_at = 0; await guard();
      if (generation !== sessionGeneration) throw changedSession();
      result = await request('/rest/v1/rpc/' + name, params, session.access_token);
    }
    if (generation !== sessionGeneration) throw changedSession();
    return result;
  }
  function filters() {
    return { p_search: $('search').value.trim(), p_filter: $('filter').value, p_product_code: $('product').value };
  }
  function date(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '—';
    return new Date(value).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  async function copy(value, field) {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const target = field || el('textarea');
      if (!field) { target.value = value; target.style.position = 'fixed'; target.style.opacity = '0'; document.body.append(target); }
      try { target.focus(); target.select(); if (!document.execCommand('copy')) throw Error('Hãy chọn nội dung và nhấn Ctrl+C để sao chép.'); }
      finally { if (!field) target.remove(); }
    }
    toast('Đã sao chép.');
  }
  function populateProducts() {
    for (const id of ['product', 'create-product']) {
      const input = $(id), previous = input.value; input.replaceChildren();
      if (id === 'product') { const option = el('option', 'Tất cả extension'); option.value = ''; input.append(option); }
      for (const product of products) {
        if (id === 'create-product' && !product.enabled) continue;
        const option = el('option', product.name + (product.enabled ? '' : ' · tạm ngừng')); option.value = product.code; input.append(option);
      }
      if ([...input.options].some(option => option.value === previous)) input.value = previous;
    }
    $('product').hidden = products.length <= 1;
    $('new-key').disabled = !products.some(product => product.enabled);
  }
  function drawSummary(stats) {
    $('summary').replaceChildren();
    for (const [field, label] of [['total', 'KEY'], ['trial', 'dùng thử'], ['pending', 'chờ duyệt / hết hạn'], ['active', 'đã duyệt'], ['blocked', 'đã khóa']]) {
      const node = el('span'); node.append(el('strong', Number(stats[field] || 0).toLocaleString('vi-VN')), el('span', label)); $('summary').append(node);
    }
  }
  function drawSelection() {
    const count = selected.size;
    $('selection-count').textContent = count ? 'Đã chọn ' + count + ' KEY' : '';
    $('bulk-actions').hidden = !count;
    $('select-all').checked = !!items.length && items.every(item => selected.has(item.id));
    $('select-all').indeterminate = count > 0 && !$('select-all').checked;
    $('select-all').disabled = !items.length;
    for (const [id, nodes] of rowNodes) { nodes.checkbox.checked = selected.has(id); nodes.row.classList.toggle('selected', selected.has(id)); }
    const archived = $('filter').value === 'archived';
    for (const node of document.querySelectorAll('[data-bulk]')) {
      node.hidden = node.dataset.bulk === 'restore' ? !archived : archived && node.dataset.bulk !== 'delete';
    }
  }
  function paintStatus(item, nodes) {
    const state = keyStatus(item, serverNow());
    nodes.badge.textContent = STATUS_LABELS[state]; nodes.badge.className = 'badge ' + state;
    nodes.remaining.textContent = remainingText(item, serverNow()); nodes.remaining.className = 'remaining ' + state;
    nodes.grant.textContent = state === 'active' ? 'Gia hạn' : 'Duyệt KEY';
    nodes.grant.hidden = state === 'archived'; nodes.block.hidden = ['blocked', 'archived'].includes(state);
    nodes.restore.hidden = state !== 'archived';
    const justExpired = nodes.state && nodes.state !== 'expired' && state === 'expired'; nodes.state = state;
    return justExpired;
  }
  function keyRow(item) {
    const row = el('article', undefined, 'key-row'); row.dataset.keyId = item.id;
    const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', 'Chọn ' + item.machine_key);
    checkbox.onchange = () => { checkbox.checked ? selected.set(item.id, item) : selected.delete(item.id); drawSelection(); };
    const code = el('code', item.machine_key, 'key-code'), badge = el('span', undefined, 'badge');
    const head = el('div', undefined, 'key-head'); head.append(checkbox, code, button('Sao chép', () => copy(item.machine_key), 'quiet copy-key'), badge);
    const verification = el('div', undefined, 'verification'), verificationHead = el('div', undefined, 'verification-heading');
    const sourceCount = Number(item.verification_source_count) || (storedVerificationText(item) ? 1 : 0), browserCount = Number(item.browser_count) || sourceCount;
    verificationHead.append(el('strong', 'Xác minh KEY gửi đến ADMIN'),
      button('Xem từng nguồn (' + sourceCount + ')', () => openSources(item), 'secondary small'));
    verification.append(verificationHead, el('p', browserCount + ' hồ sơ trình duyệt · ' + sourceCount + ' bản xác minh', 'source-summary'),
      el('p', 'Mở từng nguồn để xem KEY, thông tin bản cài và bằng chứng xác minh.', 'source-hint'));
    const footer = el('footer', undefined, 'key-footer'), expiry = el('div', undefined, 'expiry'), remaining = el('span', undefined, 'remaining');
    expiry.append(el('span', item.expires_at ? 'Hạn: ' + date(item.expires_at) : 'Hạn: Không thời hạn'), remaining);
    const actions = el('div', undefined, 'row-actions');
    const grant = button('Duyệt KEY', () => openGrant([item], keyStatus(item, serverNow()) === 'active' ? 'renew' : 'approve'), 'primary small');
    const block = button('Khóa', () => openConfirm('block', [item]));
    const restore = button('Khôi phục', () => openConfirm('restore', [item]));
    actions.append(grant, block, restore, button('Xóa', () => openConfirm('delete', [item]), 'danger small'));
    footer.append(expiry, actions); row.append(head, verification, footer);
    const nodes = { row, checkbox, badge, remaining, grant, block, restore, state: '' }; rowNodes.set(item.id, nodes); paintStatus(item, nodes);
    return row;
  }
  function drawList() {
    rowNodes = new Map(); $('key-list').replaceChildren(...items.map(keyRow)); drawSelection();
    $('empty').hidden = !!items.length;
    $('page-info').textContent = total ? `${offset + 1}–${offset + items.length} / ${total.toLocaleString('vi-VN')} KEY` : '0 KEY';
    $('page-number').textContent = (total ? Math.floor(offset / PAGE_SIZE) + 1 : 0) + ' / ' + Math.ceil(total / PAGE_SIZE);
    $('previous').disabled = offset === 0; $('next').disabled = offset + PAGE_SIZE >= total;
  }
  async function loadKeys() {
    if (!session) return;
    const requestId = ++loadGeneration; $('loading').hidden = false;
    try {
      const data = await rpc('tqt_v15_admin_list', { ...filters(), p_limit: PAGE_SIZE, p_offset: offset });
      if (requestId !== loadGeneration) return;
      if (Number(data.schemaVersion) < 11 || data.approvalMode !== 'key' || data.trialHours !== 12) throw Error('ADMIN_12H_UPGRADE_REQUIRED');
      if (data.sourceSchemaVersion !== 15) throw Error('ADMIN_12H_UPGRADE_REQUIRED');
      if (!Number.isFinite(Date.parse(data.serverTime))) throw Error('Không nhận được thời gian máy chủ.');
      total = Number(data.total) || 0;
      if (offset > 0 && offset >= total) { offset = total ? Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE : 0; return await loadKeys(); }
      clock = { time: Date.parse(data.serverTime), tick: performance.now() };
      items = data.items || []; products = data.products || [];
      selected = new Map(items.filter(item => selected.has(item.id) && String(selected.get(item.id).revision) === String(item.revision)).map(item => [item.id, item]));
      populateProducts(); drawSummary(data.stats || {}); drawList(); $('error-banner').hidden = true;
      $('last-updated').textContent = 'Cập nhật: ' + date(data.serverTime) + ' · Tự làm mới mỗi 30 giây';
    } catch (error) { if (requestId === loadGeneration) fail(error); throw error; }
    finally { if (requestId === loadGeneration) $('loading').hidden = true; }
  }
  function resetFilters() { $('search').value = ''; $('filter').value = 'all'; $('product').value = ''; offset = 0; selected.clear(); }
  function anyDialog() { return !!document.querySelector('dialog[open]'); }
  function sourceCard(source) {
    const card = el('article', undefined, 'source-card'), heading = el('div', undefined, 'source-card-heading');
    const title = el('div'); title.append(el('h3', source.legacy ? 'Nguồn cũ' : browserName(source.user_agent)), el('p', sourceLabel(source), 'muted'));
    const field = el('textarea'); field.readOnly = true; field.spellcheck = false; field.rows = 3;
    // Render/copy the exact string stored by the original cookie verification RPC.
    field.value = source.old_device ? storedVerificationText(source)
      : typeof source.verification_text === 'string' ? source.verification_text : '';
    field.placeholder = 'Chưa nhận xác minh. Mở extension của trình duyệt này → Bảng Điều Khiển.';
    field.id = 'source-text-' + source.source_id;
    const copySource = button('Sao chép xác minh', () => copy(field.value, field), 'secondary small'); copySource.disabled = !field.value;
    heading.append(title, copySource);
    const metadata = el('div', undefined, 'source-metadata');
    metadata.append(el('span', 'UID: ' + (source.account_uid || 'Chưa gửi')),
      el('span', 'Extension: ' + (source.extension_version || 'Chưa gửi')),
      el('span', 'Cập nhật: ' + date(source.updated_at)));
    const label = el('label', source.verification_text?.startsWith('{') && source.verification_text.includes('KEY-V17')
      ? 'KEY · ID bản cài · UID · User-Agent · bằng chứng đã xác minh' : 'UID | cookie | User-Agent'); label.htmlFor = field.id;
    card.append(heading, metadata, label, field);
    if (source.legacy) card.append(el('p', 'Bản cũ chỉ lưu lần gửi cuối cùng. Mở từng extension → Bảng Điều Khiển để xác định nguồn riêng.', 'source-hint'));
    if (source.installation_id) card.title = 'ID hồ sơ: ' + source.installation_id;
    return card;
  }
  async function loadSources() {
    if (!sourceJob || !session || !$('sources-dialog').open) return;
    const job = sourceJob, requestId = ++sourceGeneration;
    $('sources-loading').hidden = false; $('sources-error').textContent = ''; busyCount++;
    $('sources-refresh').disabled = true; $('sources-previous').disabled = true; $('sources-next').disabled = true;
    try {
      const data = await rpc('tqt_v15_admin_verifications', {p_license_id: job.id, p_limit: PAGE_SIZE, p_offset: sourceOffset});
      if (requestId !== sourceGeneration || sourceJob !== job || !$('sources-dialog').open) return;
      if (data.sourceSchemaVersion !== 15 || data.licenseId !== job.id || data.machineKey !== job.machine_key
        || !Array.isArray(data.items) || !Number.isInteger(data.total) || data.total < 0) throw Error('Không nhận được danh sách nguồn xác minh hợp lệ.');
      sourceTotal = data.total;
      if (sourceOffset && sourceOffset >= sourceTotal) {sourceOffset = sourceTotal ? Math.floor((sourceTotal - 1) / PAGE_SIZE) * PAGE_SIZE : 0; return await loadSources();}
      $('sources-list').replaceChildren(...data.items.map(sourceCard));
      $('sources-empty').hidden = !!data.items.length;
      $('sources-count').textContent = sourceTotal + ' nguồn / hồ sơ · Cập nhật ' + date(data.serverTime);
      $('sources-page').textContent = sourceTotal ? (sourceOffset + 1) + '–' + (sourceOffset + data.items.length) + ' / ' + sourceTotal : '0 nguồn';
    } catch (error) {
      if (requestId === sourceGeneration && sourceJob === job && error.code !== 'SESSION_CHANGED') {
        $('sources-error').textContent = readable(error);
        if (error.message === 'LICENSE_NOT_FOUND') {
          sourceTotal = 0; $('sources-list').replaceChildren(); $('sources-count').textContent = 'KEY đã bị xóa.';
        }
      }
    } finally {
      busyCount--;
      if (requestId === sourceGeneration) {
        $('sources-loading').hidden = true; $('sources-refresh').disabled = false;
        $('sources-previous').disabled = !sourceOffset; $('sources-next').disabled = sourceOffset + PAGE_SIZE >= sourceTotal;
      }
    }
  }
  function openSources(item) {
    if (anyDialog()) return;
    sourceJob = item; sourceOffset = 0; sourceTotal = 0;
    $('sources-key').textContent = item.machine_key; $('sources-list').replaceChildren();
    $('sources-count').textContent = ''; $('sources-error').textContent = ''; $('sources-empty').hidden = true;
    $('sources-dialog').showModal(); return loadSources();
  }
  $('sources-refresh').onclick = loadSources;
  $('sources-previous').onclick = () => {sourceOffset = Math.max(0, sourceOffset - PAGE_SIZE); loadSources();};
  $('sources-next').onclick = () => {sourceOffset += PAGE_SIZE; loadSources();};
  $('sources-close').onclick = () => $('sources-dialog').close();
  $('sources-dialog').addEventListener('close', () => {
    sourceGeneration++; sourceJob = null; sourceOffset = 0; sourceTotal = 0;
    $('sources-list').replaceChildren(); $('sources-key').textContent = ''; $('sources-count').textContent = '';
    $('sources-error').textContent = ''; $('sources-loading').hidden = true;
  });
  function openGrant(records, action) {
    if (!records.length || anyDialog()) return;
    modalJob = { records: [...records], action };
    $('grant-title').textContent = (action === 'renew' ? 'Duyệt / gia hạn' : 'Duyệt KEY') + ' · ' + records.length + ' KEY';
    $('grant-description').textContent = action === 'renew' ? 'Cộng thêm vào hạn còn hiệu lực. KEY hết hạn hoặc đang chờ duyệt sẽ tính từ bây giờ và được kích hoạt.' : 'Kích hoạt KEY với thời hạn bạn chọn, tính từ bây giờ.';
    $('grant-duration').value = records.length === 1 && keyStatus(records[0], serverNow()) === 'active' && !records[0].expires_at ? 'unlimited' : '720';
    $('duration-value').value = '30'; $('duration-unit').value = '24'; updateCustomDuration();
    $('grant-error').textContent = ''; $('grant-dialog').showModal();
  }
  function openConfirm(action, records) {
    if (!records.length || anyDialog()) return;
    modalJob = { action, records: [...records] };
    const messages = {
      delete: ['Xóa KEY', 'Xóa vĩnh viễn KEY đã chọn và dữ liệu xác minh liên quan. Đăng ký lại cùng KEY sẽ không được cấp thêm dùng thử; phải chờ ADMIN duyệt.'],
      block: ['Khóa KEY', 'Thu hồi quyền sử dụng của KEY đã chọn ở lần kiểm tra quyền tiếp theo.'],
      restore: ['Khôi phục KEY', 'Đưa KEY về danh sách chờ duyệt. Thao tác này không cấp lại 12 giờ dùng thử.']
    };
    $('confirm-title').textContent = messages[action][0] + ' · ' + records.length + ' KEY';
    $('confirm-description').textContent = messages[action][1]; $('confirm-error').textContent = '';
    $('confirm-submit').textContent = messages[action][0]; $('confirm-submit').className = action === 'delete' ? 'danger' : 'primary';
    $('confirm-dialog').showModal();
  }
  async function modalTask(dialogId, submitId, errorId, task) {
    const dialog = $(dialogId), controls = [...dialog.querySelectorAll('button, input, select')];
    controls.forEach(node => { node.disabled = true; }); dialog.dataset.busy = 'true'; busyCount++;
    try { await task(); }
    catch (error) { if (error.code !== 'SESSION_CHANGED') $(errorId).textContent = readable(error); }
    finally { controls.forEach(node => { node.disabled = false; }); if (dialogId === 'grant-dialog') updateCustomDuration(); delete dialog.dataset.busy; busyCount--; }
  }
  async function applyJob(job, hours, dialog) {
    await rpc('tqt_v11_admin_apply', { p_items: job.records.map(item => ({ id: item.id, revision: item.revision })), p_action: job.action, p_hours: hours });
    dialog.close(); selected.clear();
    const messages = { approve: 'Đã duyệt KEY.', renew: 'Đã duyệt / gia hạn KEY.', block: 'Đã khóa KEY.', delete: 'Đã xóa KEY.', restore: 'Đã khôi phục KEY về chờ duyệt.' };
    toast(messages[job.action]); await loadKeys().catch(fail);
  }
  function updateCustomDuration() {
    const custom = $('grant-duration').value === 'custom';
    $('custom-duration').hidden = !custom;
    $('duration-value').disabled = !custom; $('duration-unit').disabled = !custom;
    $('duration-value').required = custom;
    $('duration-value').max = $('duration-unit').value === '24' ? '3650' : '87600';
  }
  $('grant-duration').onchange = updateCustomDuration;
  $('duration-unit').onchange = updateCustomDuration;
  $('grant-form').onsubmit = event => {
    event.preventDefault(); if (!modalJob || $('grant-dialog').dataset.busy) return;
    const job = modalJob;
    modalTask('grant-dialog', 'grant-submit', 'grant-error', () => applyJob(job, durationHours($('grant-duration').value, $('duration-value').value, $('duration-unit').value), $('grant-dialog')));
  };
  $('confirm-form').onsubmit = event => {
    event.preventDefault(); if (!modalJob || $('confirm-dialog').dataset.busy) return;
    const job = modalJob;
    modalTask('confirm-dialog', 'confirm-submit', 'confirm-error', () => applyJob(job, 720, $('confirm-dialog')));
  };
  for (const prefix of ['grant', 'confirm', 'create']) {
    const dialog = $(prefix + '-dialog');
    $(prefix + '-cancel').onclick = () => dialog.close();
    dialog.addEventListener('cancel', event => { if (dialog.dataset.busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { modalJob = null; });
  }
  function generateKey() {
    return 'TQT-' + [...crypto.getRandomValues(new Uint8Array(14))].map(value => value.toString(16).padStart(2, '0')).join('').slice(0, 27).toUpperCase();
  }
  $('new-key').onclick = () => {
    if (anyDialog()) return;
    $('create-key').value = generateKey(); $('create-error').textContent = ''; $('create-dialog').showModal();
  };
  $('generate-key').onclick = () => { $('create-key').value = generateKey(); };
  $('create-form').onsubmit = event => {
    event.preventDefault(); if ($('create-dialog').dataset.busy) return;
    modalTask('create-dialog', 'create-submit', 'create-error', async () => {
      await rpc('tqt_v3_admin_save', { p_license_id: null, p_machine_key: $('create-key').value.trim().toUpperCase(), p_product_code: $('create-product').value,
        p_status: 'pending', p_expires_at: null, p_note: '', p_customer_name: '', p_customer_contact: '', p_plan_name: 'Tiêu chuẩn', p_tags: [], p_expected_revision: null });
      $('create-dialog').close(); resetFilters(); toast('Đã thêm KEY.'); await loadKeys().catch(fail);
    });
  };
  $('select-all').onchange = () => { selected = $('select-all').checked ? new Map(items.map(item => [item.id, item])) : new Map(); drawSelection(); };
  $('clear-selection').onclick = () => { selected.clear(); drawSelection(); };
  for (const node of document.querySelectorAll('[data-bulk]')) node.onclick = () => {
    const records = [...selected.values()];
    node.dataset.bulk === 'approve' ? openGrant(records, 'renew') : openConfirm(node.dataset.bulk, records);
  };
  function changeFilters() { offset = 0; selected.clear(); loadKeys().catch(fail); }
  $('search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(changeFilters, 300); };
  $('filter').onchange = changeFilters; $('product').onchange = changeFilters;
  $('clear-filters').onclick = () => { resetFilters(); loadKeys().catch(fail); };
  $('refresh').onclick = () => busy($('refresh'), loadKeys);
  $('previous').onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); selected.clear(); loadKeys().catch(fail); };
  $('next').onclick = () => { offset += PAGE_SIZE; selected.clear(); loadKeys().catch(fail); };
  function csvQuote(value) {
    let text = String(value ?? ''); if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  $('export').onclick = () => busy($('export'), async () => {
    const params = filters(), rows = [['KEY', 'Trạng thái', 'Hết hạn', 'Xác minh KEY']];
    for (let start = 0; ; start += 100) {
      const data = await rpc('tqt_v11_admin_list', { ...params, p_limit: 100, p_offset: start });
      for (const item of data.items) rows.push([item.machine_key, STATUS_LABELS[keyStatus(item, Date.parse(data.serverTime))], item.expires_at || '', storedVerificationText(item)]);
      if (!data.items.length || start + data.items.length >= data.total) break;
    }
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(csvQuote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = el('a'); link.href = url; link.download = 'tqt-keys-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); toast('Đã xuất ' + (rows.length - 1) + ' KEY.');
  });
  function logoutLocal() {
    sessionGeneration++; loadGeneration++; session = null; refreshPromise = null; modalJob = null; clock = null;
    sourceGeneration++; sourceJob = null; $('sources-list').replaceChildren(); $('sources-key').textContent = ''; $('sources-count').textContent = '';
    items = []; products = []; total = 0; offset = 0; selected.clear(); rowNodes.clear(); clearTimeout(searchTimer);
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    $('key-list').replaceChildren(); $('summary').replaceChildren(); $('selection-count').textContent = ''; $('admin-email').textContent = '';
    $('bulk-actions').hidden = true; $('loading').hidden = true; $('panel').hidden = true; $('login-screen').hidden = false;
    $('password').value = ''; $('create-key').value = ''; $('error-banner').hidden = true; $('last-updated').textContent = '';
  }
  $('login').onsubmit = async event => {
    event.preventDefault(); $('login-submit').disabled = true; $('login-error').textContent = '';
    const generation = ++sessionGeneration;
    try {
      const body = { email: $('email').value.trim(), password: $('password').value };
      if (captchaToken) body.gotrue_meta_security = { captcha_token: captchaToken };
      const data = await request('/auth/v1/token?grant_type=password', body);
      if (generation !== sessionGeneration) throw changedSession();
      session = newSession(data); $('password').value = ''; resetFilters(); await loadKeys();
      if (generation !== sessionGeneration) throw changedSession();
      $('admin-email').textContent = data.user?.email || body.email; $('admin-email').title = body.email;
      $('login-screen').hidden = true; $('panel').hidden = false;
    } catch (error) { if (generation === sessionGeneration) { logoutLocal(); $('login-error').textContent = readable(error); } }
    finally { $('login-submit').disabled = false; captchaToken = ''; if (captchaWidget !== undefined) window.turnstile?.reset(captchaWidget); }
  };
  $('logout').onclick = () => {
    const token = session?.access_token; logoutLocal(); toast('Đã đăng xuất.');
    if (token) request('/auth/v1/logout', {}, token).catch(() => {});
  };
  setInterval(() => {
    if (!session || document.hidden || $('panel').hidden) return;
    let justExpired = false;
    for (const item of items) { const nodes = rowNodes.get(item.id); if (nodes) justExpired = paintStatus(item, nodes) || justExpired; }
    if (justExpired && !anyDialog() && !busyCount) loadKeys().catch(fail);
  }, 1000);
  setInterval(() => { if (session && !document.hidden && !anyDialog() && !busyCount) loadKeys().catch(fail); }, 30000);
  document.addEventListener('visibilitychange', () => { if (session && !document.hidden && !anyDialog() && !busyCount) loadKeys().catch(fail); });
  if (config().turnstileSiteKey) {
    const script = el('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => { captchaWidget = window.turnstile.render('#admin-captcha', { sitekey: config().turnstileSiteKey, callback: token => { captchaToken = token; }, 'expired-callback': () => { captchaToken = ''; } }); };
    script.onerror = () => { $('login-error').textContent = 'Không tải được xác minh đăng nhập. Kiểm tra kết nối.'; }; document.head.append(script);
  }
})();
