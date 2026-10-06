import { storedVerificationText } from './verification.js?v=key-sender-v10-share';

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const PAGE_SIZE = 12, SIDE_SIZE = 30;
  const STATES = { active: 'Đã duyệt', pending: 'Chờ duyệt', blocked: 'Đã khóa', expired: 'Hết hạn', archived: 'Lưu trữ' };
  const UID_STATES = { observed: 'Đọc tự động từ Facebook', absent: 'Đã đăng xuất / không có UID', missing: 'Chưa nhận UID', stale: 'Chờ cập nhật UID' };
  const ACTIONS = { facebook_uid_changed: 'Cập nhật UID Facebook', facebook_uid_removed: 'Ngừng liên kết UID hiện tại', registered: 'KEY được đăng ký', activity: 'Cập nhật hoạt động', license_saved: 'Cập nhật KEY', license_labels: 'Cập nhật gói / nhãn', installation_status: 'Thay đổi thiết bị (dữ liệu cũ)', key_approve: 'Duyệt KEY', key_block: 'Khóa KEY', key_renew: 'Gia hạn KEY', key_archive: 'Lưu trữ KEY', key_restore: 'Khôi phục KEY', product_saved: 'Cập nhật extension' };
  const ERRORS = { ADMIN_REQUIRED: 'Tài khoản này chưa có quyền quản trị. Hãy kiểm tra 03-CAP-QUYEN-ADMIN.sql.', REVISION_CONFLICT: 'KEY vừa được thay đổi ở phiên khác. Đóng chi tiết, làm mới rồi thử lại.', RENEW_EXPIRED_LICENSE_FIRST: 'KEY đã hết hạn. Hãy chọn Gia hạn trước khi sử dụng.', RESTORE_ARCHIVED_KEY_FIRST: 'Hãy khôi phục KEY đã lưu trữ trước.', KEY_NOT_ARCHIVED: 'Chỉ khôi phục KEY đang được lưu trữ.', INVALID_LICENSE: 'Thông tin KEY chưa hợp lệ. Kiểm tra KEY, tên gói và nhãn.', INVALID_IMPORT: 'Tệp nhập chưa hợp lệ. Kiểm tra định dạng KEY.', INVALID_QUERY: 'Bộ lọc chưa hợp lệ.', LICENSE_NOT_FOUND: 'Không tìm thấy KEY.', LICENSE_IDENTITY_IMMUTABLE: 'Không thể đổi mã KEY hoặc loại extension của bản ghi đã có.', 'Invalid login credentials': 'Email hoặc mật khẩu chưa đúng.' };
  const VIEW_INFO = { keys: ['Quản lý KEY', 'Tất cả KEY, khách hàng và kết nối. Luôn trong tầm kiểm soát.'], overview: ['Tổng quan', 'Theo dõi hoạt động và những KEY cần bạn xử lý hôm nay.'], customers: ['Khách hàng', 'Thông tin liên hệ và quyền truy cập của từng khách hàng.'], activity: ['Nhật ký hoạt động', 'Lịch sử thay đổi giúp bạn theo dõi mọi quyết định cấp quyền.'], settings: ['Cài đặt', 'Quản lý extension, kết nối và vòng đời dữ liệu.'] };
  Object.assign(ACTIONS, { input_shared: 'Đồng bộ nguyên ô', input_cleared: 'Xóa nội dung đã đồng bộ' });
  let session = null, refreshPromise = null, sessionGeneration = 0, requestGeneration = 0;
  let offset = 0, items = [], total = 0, products = [], editing = null, detail = null, detailsGeneration = 0;
  let view = 'keys', display = 'grid', selected = new Map(), stats = {}, customerOffset = 0, activityOffset = 0;
  let captchaToken = '', captchaWidget, confirmResolve = null, importRows = [], toastTimer, searchTimer;
  const config = () => window.TQT_CONFIG || {};
  function el(tag, value, className) { const e = document.createElement(tag); if (value !== undefined) e.textContent = value ?? ''; if (className) e.className = className; return e; }
  function icon(name) { const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); e.classList.add('icon'); e.setAttribute('aria-hidden', 'true'); const u = document.createElementNS(e.namespaceURI, 'use'); u.setAttribute('href', '#i-' + name); e.append(u); return e; }
  document.querySelectorAll('[data-icon]').forEach(e => e.replaceWith(icon(e.dataset.icon)));
  // Brand / illustration wrappers retain their layout classes after replacing placeholders.
  document.querySelectorAll('.brand > .icon').forEach(e => { const span = el('span', undefined, 'brand-mark'); e.replaceWith(span); span.append(e); });
  const lb = $('login-screen').querySelector('.login-form-inner > .icon'); if (lb) { const w = el('span', undefined, 'login-badge'); lb.replaceWith(w); w.append(lb); }
  const mi = $('confirm-dialog').querySelector(':scope > .icon'); if (mi) { const w = el('span', undefined, 'modal-icon'); mi.replaceWith(w); w.append(mi); }
  function button(label, task, className = 'secondary', iconName) { const b = el('button', undefined, className); b.type = 'button'; if (iconName) b.append(icon(iconName)); if (label) b.append(el('span', label)); b.onclick = () => busy(b, task); return b; }
  async function busy(b, task) { b.disabled = true; try { await task(); } catch (e) { fail(e); } finally { b.disabled = false; } }
  function readable(e) { const s = e?.message || String(e); if (/Could not find the function|PGRST202|does not exist/.test(s)) return 'Máy chủ cần bản xác minh ba trường. Chạy 02-NANG-CAP-DATABASE-3-TRUONG.sql, rồi làm mới trang.'; if (s.includes('duplicate key')) return 'KEY này đã có trong hệ thống. Hãy tìm KEY để chỉnh sửa.'; if (s === 'Failed to fetch' || e?.name === 'AbortError') return 'Chưa kết nối được máy chủ. Kiểm tra mạng và thử lại.'; return ERRORS[s] || s; }
  function toast(message, error = false) { $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 8000 : 4000); }
  function fail(e) { const text = readable(e); toast(text, true); if ($('editor').open) { $('drawer-error').textContent = text; $('drawer-error').hidden = false; } }
  function date(value, full = false) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : full ? d.toLocaleString('vi-VN') : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function ago(value) { if (!value) return 'Chưa kết nối'; const s = Math.max(0, (Date.now() - Date.parse(value)) / 1000); return s < 60 ? 'Vừa xong' : s < 3600 ? Math.floor(s / 60) + ' phút trước' : s < 86400 ? Math.floor(s / 3600) + ' giờ trước' : date(value); }
  function localDate(value) { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function initials(value) { return String(value || 'KH').split(/\s+/).filter(Boolean).slice(-2).map(x => x[0]).join('').toUpperCase(); }
  function badge(state) { return el('span', STATES[state] || state, 'badge ' + (STATES[state] ? state : '')); }
  function live(x) { return el('span', x.is_running ? 'Đang chạy' : x.is_paused ? 'Tạm dừng' : x.is_online ? 'Online' : 'Offline', 'live' + (x.is_online ? ' online' : '')); }
  function name(x) { return x.customer_name || x.shared_name || 'Khách hàng mới'; }
  function contact(x) { return x.customer_contact || x.shared_contact || 'Chưa có liên hệ'; }
  function copyButton(value) { const b = button('', async () => { await navigator.clipboard.writeText(value); toast('Đã sao chép KEY.'); }, 'icon-button', 'copy'); b.title = 'Sao chép KEY'; b.setAttribute('aria-label', 'Sao chép KEY'); return b; }
  async function request(path, body, token) {
    const c = config();
    if (!c.supabaseUrl || !c.supabaseAnonKey || /YOUR_|PASTE_/i.test(c.supabaseUrl + c.supabaseAnonKey)) {
      throw Error('Chưa cấu hình Supabase. Cập nhật config.js của web và config.js của extension cùng project.');
    }
    let validKey = /^sb_publishable_[a-z0-9_-]+$/i.test(c.supabaseAnonKey);
    if (!validKey) {
      try { validKey = JSON.parse(atob(c.supabaseAnonKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch {}
    }
    if (!validKey) throw Error('Chỉ dùng publishable hoặc anon key cho trang web.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch(c.supabaseUrl + path, { method: 'POST', cache: 'no-store', credentials: 'omit',
        headers: { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(body), signal: controller.signal });
      const raw = await r.text(); let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { throw Error('Máy chủ trả về nội dung không hợp lệ.'); }
      if (!r.ok) throw Object.assign(Error(data.message || data.msg || data.error_description || 'HTTP ' + r.status), { status: r.status });
      return data;
    } finally { clearTimeout(timer); }
  }
  async function guard() {
    if (!session) throw Error('Cần đăng nhập ADMIN.');
    if (session.expires_at * 1000 > Date.now() + 60000) return;
    if (!refreshPromise) {
      const saved = session; const generation = sessionGeneration;
      refreshPromise = request('/auth/v1/token?grant_type=refresh_token', { refresh_token: saved.refresh_token })
        .then(next => {
          if (generation !== sessionGeneration) throw Error('Phiên đăng nhập đã thay đổi.');
          session = { ...next, expires_at: next.expires_at || Date.now() / 1000 + next.expires_in };
        }).catch(e => {
          if (generation === sessionGeneration && [400, 401].includes(e.status)) logoutLocal();
          throw e;
        }).finally(() => { refreshPromise = null; });
    }
    await refreshPromise;
  }
  async function rpc(name, params = {}) {
    await guard();
    const generation = sessionGeneration;
    let result;
    try { result = await request('/rest/v1/rpc/' + name, params, session.access_token); }
    catch (e) {
      if (e.status !== 401 || generation !== sessionGeneration) throw e;
      session.expires_at = 0;
      await guard();
      if (generation !== sessionGeneration) throw Error('Phiên đăng nhập đã thay đổi.');
      result = await request('/rest/v1/rpc/' + name, params, session.access_token);
    }
    if (generation !== sessionGeneration) throw Error('Phiên đăng nhập đã thay đổi.');
    return result;
  }
  function filters() { return { p_search: $('search').value.trim(), p_filter: $('filter').value, p_product_code: $('product').value, p_sort: $('sort').value }; }
  function populateProducts() {
    for (const id of ['product', 'edit-product']) { const input = $(id), value = input.value; input.replaceChildren(); if (id === 'product') { const op = el('option', 'Tất cả extension'); op.value = ''; input.append(op); } for (const p of products) { const op = el('option', p.name + (p.enabled ? '' : ' · tạm ngừng')); op.value = p.code; input.append(op); } if ([...input.options].some(o => o.value === value)) input.value = value; }
  }
  function drawStats() {
    $('stats').replaceChildren();
    const rows = [['total','Tổng số KEY','key','Trong hệ thống','all',''],['active','Đã duyệt','check','Có quyền sử dụng','active',''],['pending','Chờ duyệt','clock','Cần bạn xử lý','pending','attention'],['online','Đang online','activity','Kết nối trong 9 phút','online','emphasis'],['running','Đang chạy','activity','Đang chạy tác vụ','running',''],['soon','Sắp hết hạn','clock','Trong 7 ngày tới','soon','attention']];
    for (const [k,label,i,note,filter,style] of rows) { const b = button('', () => setFilter(filter), 'stat ' + style); const top = el('div', undefined, 'stat-top'); top.append(el('span',label),icon(i)); b.append(top,el('strong',Number(stats[k] || 0).toLocaleString('vi-VN')),el('small',note)); $('stats').append(b); }
    $('nav-pending').hidden = !stats.pending; $('nav-pending').textContent = String(stats.pending || 0);
  }
  function checkbox(x) { const c = el('input'); c.type = 'checkbox'; c.dataset.select = x.id; c.checked = selected.has(x.id); c.setAttribute('aria-label', 'Chọn KEY của ' + name(x)); c.onchange = () => { c.checked ? selected.set(x.id, x) : selected.delete(x.id); drawSelection(); }; return c; }
  function profileSummary(x) {
    const p = el('section', undefined, 'profile-summary'); const head = el('header'); head.append(el('span','Xác minh KEY'),icon('shield'));
    p.append(head);
    const value = storedVerificationText(x);
    if (value) {
      const text = el('textarea'); text.readOnly=true; text.spellcheck=false; text.rows=4;
      text.value=value; text.setAttribute('aria-label','Xác minh KEY: UID, Cookie và User-Agent');
      p.append(el('small','UID | Cookie | User-Agent'),text,el('small','Cập nhật: '+date(x.verification_updated_at,true)),
        button('Sao chép xác minh',async()=>{
          try {await navigator.clipboard.writeText(value);}
          catch {text.focus();text.select();if(!document.execCommand('copy'))throw Error('Hãy chọn ô và nhấn Ctrl+C để sao chép.');}
          toast('Đã sao chép toàn bộ nội dung xác minh.');
        },'secondary small','copy'));
    } else p.append(el('small','Chưa nhận nội dung xác minh. Mở extension để gửi.'));
    return p;
  }
  function card(x, index = 0, selectable = true) {
    const c = el('article', undefined, 'key-card'); c.dataset.keyId = x.id;
    const top = el('div', undefined, 'card-top'); if (selectable) top.append(checkbox(x));
    const person = el('div', undefined, 'card-person'); person.append(el('strong',name(x)),el('small',contact(x)));
    top.append(el('span',initials(name(x)), 'customer-avatar tone-' + index % 4),person,badge(x.effective_status));
    const key = el('div',undefined,'card-key'); const code = el('code',x.machine_key); code.title = x.machine_key; key.append(code,copyButton(x.machine_key));
    const meta = el('dl',undefined,'card-meta');
    for (const [label,value] of [['Gói sử dụng',x.plan_name || 'Tiêu chuẩn'],['Kết nối',live(x)],['Hạn dùng',x.expires_at ? date(x.expires_at) : 'Không thời hạn'],['Trình duyệt',x.browser_count + ' bản cài đặt']]) { const d = el('div'); const dd = el('dd'); dd.append(value?.nodeType ? value : el('span',value)); d.append(el('dt',label),dd); meta.append(d); }
    c.append(top,key,meta,profileSummary(x));
    if (x.tags?.length) { const tags = el('div',undefined,'tag-line'); for (const t of x.tags) tags.append(el('span',t,'tag')); c.append(tags); }
    const foot = el('footer',undefined,'card-footer'); foot.append(el('span',ago(x.last_seen_at)));
    if (x.effective_status === 'pending') foot.append(button('Duyệt KEY', () => bulkAction('approve',[x]), 'quick-approve'));
    const detailButton = button('Chi tiết', () => openDetails(x.id), 'text-button'); detailButton.append(icon('arrow')); foot.append(detailButton); c.append(foot); return c;
  }
  function drawTable() {
    $('rows').replaceChildren();
    for (const x of items) { const tr = el('tr'); tr.dataset.keyId = x.id; const add = v => { const c = el('td'); c.append(v?.nodeType ? v : el('span',v)); tr.append(c); return c; };
      add(checkbox(x)); const person = el('div'); person.append(el('strong',name(x)),el('code',x.machine_key),el('small',contact(x))); add(person);
      const state = el('div'); state.append(badge(x.effective_status),el('small')); state.lastChild.append(live(x)); add(state); add(x.expires_at ? date(x.expires_at) : 'Không thời hạn');
      add(profileSummary(x));add(ago(x.last_seen_at));
      const actions = el('div'); actions.append(button('Chi tiết',()=>openDetails(x.id),'text-button')); add(actions); $('rows').append(tr);
    }
  }
  function drawSelection() {
    $('selection-hint').textContent = selected.size + ' KEY được chọn'; $('bulk-count').textContent = 'Đã chọn ' + selected.size + ' KEY'; $('bulk-bar').hidden = !selected.size;
    $('select-all').checked = !!items.length && selected.size === items.length; $('select-all').indeterminate = selected.size > 0 && selected.size < items.length;
    document.querySelectorAll('[data-key-id]').forEach(e => e.classList.toggle('selected',selected.has(e.dataset.keyId)));
    document.querySelectorAll('[data-select]').forEach(e => { e.checked = selected.has(e.dataset.select); });
    document.querySelectorAll('[data-bulk]').forEach(e => { e.hidden = e.dataset.bulk === 'restore' ? $('filter').value !== 'archived' : $('filter').value === 'archived'; });
  }
  function drawList() {
    $('cards').replaceChildren(...items.map((x,i)=>card(x,i))); drawTable(); drawSelection();
    $('cards').hidden = display !== 'grid' || !items.length; $('table-wrap').hidden = display !== 'table' || !items.length;
    $('empty').hidden = !!items.length; $('count').textContent = total.toLocaleString('vi-VN');
    $('page-info').textContent = total ? 'Hiển thị ' + (offset + 1) + '–' + Math.min(offset + PAGE_SIZE,total) + ' trong ' + total + ' KEY' : '0 KEY';
    $('page-number').textContent = (total ? Math.floor(offset / PAGE_SIZE) + 1 : 0) + ' / ' + Math.ceil(total / PAGE_SIZE);
    $('previous').disabled = !offset; $('next').disabled = offset + PAGE_SIZE >= total;
    document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter === $('filter').value));
  }
  async function loadKeys() {
    const requestId = ++requestGeneration; $('loading').hidden = false; $('sync-indicator').textContent = 'Đang đồng bộ';
    try { const data = await rpc('tqt_v10_admin_list', { ...filters(), p_limit: PAGE_SIZE, p_offset: offset }); if (requestId !== requestGeneration) return;
      if (Number(data.schemaVersion) < 10 || data.approvalMode !== 'key' || data.verificationOnly !== true) throw Error('Máy chủ cần bản xác minh ba trường. Hãy chạy 02-NANG-CAP-DATABASE-3-TRUONG.sql.');
      items = data.items || []; total = data.total || 0; stats = data.stats || {}; products = data.products || [];
      selected = new Map([...selected].filter(([id,x]) => items.some(n=>n.id === id && n.revision === x.revision)));
      populateProducts(); drawStats(); drawList(); if (view === 'overview') drawOverview();
      $('error-banner').hidden = true; $('sync-indicator').classList.remove('error'); $('sync-indicator').textContent = 'Đã đồng bộ';
      $('last-updated').textContent = 'Cập nhật ' + new Date(data.serverTime).toLocaleTimeString('vi-VN', {hour:'2-digit',minute:'2-digit'});
    } catch(e) { if (requestId === requestGeneration) { $('sync-indicator').textContent = 'Mất kết nối'; $('sync-indicator').classList.add('error'); $('error-banner').textContent = readable(e); $('error-banner').hidden = false; } throw e; }
    finally { if (requestId === requestGeneration) $('loading').hidden = true; }
  }
  function clearFilters() { $('search').value = ''; $('filter').value = 'all'; $('product').value = ''; $('sort').value = 'newest'; offset = 0; selected.clear(); }
  async function setFilter(value) { $('filter').value = value; offset = 0; selected.clear(); if (view !== 'keys') await changeView('keys'); else await loadKeys(); }
  function drawOverview() {
    const active = Number(stats.active||0), count = Number(stats.total||0), pending = Number(stats.pending||0); const a = count ? active/count*100 : 0, b = count ? pending/count*100 : 0;
    const donut=el('div',undefined,'donut'); donut.style.background = `conic-gradient(#64a58a 0 ${a}%,#dfc487 ${a}% ${a+b}%,#e8eeee ${a+b}% 100%)`;
    const center=el('div',undefined,'donut-inner'); center.append(el('span',count),el('small','TỔNG SỐ KEY')); donut.append(center);
    const copy=el('div',undefined,'health-copy'); copy.append(el('strong',(count ? Math.round(a) : 0) + '% đã duyệt'),el('p','Thống kê quyền sử dụng trên toàn bộ KEY chưa lưu trữ.'));
    $('health-chart').replaceChildren(donut,copy); $('health-legend').replaceChildren();
    for (const [text,color] of [['Đã duyệt','#64a58a'],['Chờ duyệt','#dfc487'],['Khác','#e0e8e5']]) { const s=el('span',text),i=el('i'); i.style.background=color;s.prepend(i);$('health-legend').append(s); }
    $('overview-tasks').replaceChildren(); for (const [label,key,f] of [['KEY đang chờ duyệt','pending','pending'],['Hết hạn trong 7 ngày','soon','soon'],['KEY đã hết hạn','expired','expired']]) { const row=button('',()=>setFilter(f),'task-row');row.append(el('span',label),el('strong',stats[key]||0),icon('arrow'));$('overview-tasks').append(row); }
    $('recent-cards').replaceChildren(...items.slice(0,6).map((x,i)=>card(x,i,false))); if(!items.length) $('recent-cards').append(el('p','Chưa có KEY. KEY mới sẽ xuất hiện khi extension đăng ký.','subtle'));
  }
  async function changeView(next) {
    if (!VIEW_INFO[next]) return; view = next; $('sidebar').classList.remove('open'); $('nav-scrim').hidden=true;
    for (const k of Object.keys(VIEW_INFO)) $(k+'-view').hidden = k !== view;
    document.querySelectorAll('[data-view]').forEach(b=>{ b.classList.toggle('active',b.dataset.view === view); if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current'); });
    $('page-title').textContent = VIEW_INFO[view][0]; $('breadcrumb-title').textContent=VIEW_INFO[view][0]; $('page-description').textContent=VIEW_INFO[view][1];
    $('stats').hidden = !['keys','overview'].includes(view); $('heading-actions').hidden = !['keys','overview'].includes(view);
    if(view==='overview') { clearFilters();await loadKeys(); } else if(view==='keys') await loadKeys(); else if(view==='customers') await loadCustomers(); else if(view==='activity') await loadActivity(); else drawSettings();
  }
  async function loadCustomers() {
    const data=await rpc('tqt_v3_admin_customers',{p_search:$('customer-search').value.trim(),p_limit:SIDE_SIZE,p_offset:customerOffset});if(view!=='customers')return;
    $('customer-list').replaceChildren(); for(const [i,c] of data.items.entries()) { const card=el('article',undefined,'customer-card'); card.append(el('span',initials(c.name),'customer-avatar tone-'+i%4),el('h3',c.name),el('p',c.contact||'Chưa có liên hệ'));
      const bottom=el('div',undefined,'customer-bottom'); bottom.append(el('span',c.key_count+' KEY · '+c.active_keys+' đã duyệt'),live(c));card.append(bottom,button('Tìm KEY của khách',async()=>{clearFilters();$('search').value=(c.contact||c.name).slice(0,100);await changeView('keys');},'text-button'));$('customer-list').append(card); }
    if(!data.items.length)$('customer-list').append(el('p','Chưa có hồ sơ phù hợp. Mở chi tiết KEY để lưu thông tin khách hàng.','subtle'));
    $('customer-count').textContent=data.total+' khách hàng';$('customer-prev').disabled=!customerOffset;$('customer-next').disabled=customerOffset+SIDE_SIZE>=data.total;
  }
  function activityNode(x, showKey = true) { const row=el('div',undefined,'activity-item'),dot=el('span',undefined,'activity-dot');dot.append(icon(x.action==='registered'?'key':'activity'));const body=el('div');body.append(el('strong',ACTIONS[x.action]||x.action));
    const v=x.new_value||{}; const details=[]; if(showKey&&x.machine_key)details.push(x.customer_name||x.machine_key);if(v.facebook_uid)details.push('UID '+v.facebook_uid);if(v.status)details.push(STATES[v.status]||v.status);if(v.expires_at)details.push('Hạn: '+date(v.expires_at));if(v.activity)details.push(({running:'Đang chạy',paused:'Tạm dừng',idle:'Nghỉ'})[v.activity]||v.activity);if(v.plan_name)details.push(v.plan_name);
    if(details.length)body.append(el('p',details.join(' · ')));row.append(dot,body,el('time',date(x.created_at,true)));return row; }
  async function loadActivity() { const data=await rpc('tqt_v3_admin_activity',{p_limit:SIDE_SIZE,p_offset:activityOffset});if(view!=='activity')return;$('activity-list').replaceChildren(...data.items.map(x=>activityNode(x)));if(!data.items.length)$('activity-list').append(el('p','Chưa có hoạt động.','subtle'));$('activity-count').textContent=data.total+' sự kiện';$('activity-prev').disabled=!activityOffset;$('activity-next').disabled=activityOffset+SIDE_SIZE>=data.total; }
  function drawSettings() { $('product-settings').replaceChildren();for(const p of products){const form=el('form',undefined,'product-setting');const label=el('label','Tên hiển thị'),input=el('input');input.value=p.name;input.required=true;input.maxLength=100;label.append(input);const switcher=el('label',undefined,'switch-row'),check=el('input');check.type='checkbox';check.checked=p.enabled;switcher.append(check,el('span','Cho phép sử dụng extension'));const save=el('button','Lưu cài đặt','secondary small');save.type='submit';form.append(label,el('code',p.code),switcher,save);form.onsubmit=e=>{e.preventDefault();busy(save,async()=>{if(!check.checked&&!await confirmation('Tạm ngừng extension?','Tất cả KEY của sản phẩm này sẽ không được sử dụng ở lần kiểm tra quyền tiếp theo.'))return;await rpc('tqt_v3_admin_product',{p_code:p.code,p_name:input.value.trim(),p_enabled:check.checked});await loadKeys();drawSettings();toast('Đã lưu cài đặt extension.');});};$('product-settings').append(form);} }
  function switchTab(name) { for (const t of ['information','browsers','history']) $('tab-'+t).hidden = t!==name;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name)); }
  function fillEditor(x) {
    editing=x; $('drawer-error').hidden=true; $('edit').reset();populateProducts();
    $('editor-title').textContent=x?name(x):'Thêm KEY mới';$('key').value=x?.machine_key||'';$('key').readOnly=!!x;$('generate-key').hidden=!!x;
    $('edit-product').disabled=!!x;$('edit-product').value=x?.product_code||products[0]?.code||'';$('edit-status').value=x?.status||'pending';$('expires').value=localDate(x?.expires_at);
    $('customer-name').value=x?.customer_name||'';$('customer-contact').value=x?.customer_contact||'';$('plan').value=x?.plan_name||'Tiêu chuẩn';$('tags').value=x?.tags?.join(', ')||'';$('note').value=x?.note||'';
    $('revision').textContent=x?'Phiên bản dữ liệu #'+x.revision:'';$('key-actions').hidden=!x;
    $('adopt-profile').hidden=!(x?.shared_name||x?.shared_contact);$('shared-profile').hidden=!x;$('shared-profile').replaceChildren();
    $('save').disabled=!!x?.archived_at;for(const b of document.querySelectorAll('[data-single]'))b.hidden=b.dataset.single==='restore'?!x?.archived_at:!!x?.archived_at;
    if(x){const h=el('h3','UID Facebook & hồ sơ');h.prepend(icon('shield'));$('shared-profile').append(profileSummary(x),h);const dl=el('dl');for(const [label,v] of [['Tên khách',x.shared_name],['Liên hệ',x.shared_contact],['Tài khoản',x.account_name],['UID Facebook',x.account_uid],['Trạng thái UID',UID_STATES[x.uid_state]],['UID đã ghi nhận',x.facebook_uids?.join(', ')],['Lần đọc UID',date(x.uid_seen_at,true)],['Hồ sơ cập nhật',date(x.profile_updated_at,true)]])dl.append(el('dt',label),el('dd',v||'Chưa chia sẻ'));$('shared-profile').append(dl,el('p','Nội dung xác minh có định dạng UID|Cookie|User-Agent. Cookie được gửi khi người dùng xác nhận và bấm nút chia sẻ trong extension. Nếu chưa chia sẻ, trường giữa để trống. Nếu KEY có nhiều bản cài đặt, mục này ưu tiên nội dung chia sẻ gần nhất. Việc duyệt KEY vẫn do ADMIN quyết định.'));}
  }
  async function openDetails(id, keepTab = false) {
    const n=++detailsGeneration;
    const [data, identity]=await Promise.all([
      rpc('tqt_v3_admin_details',{p_license_id:id}),
      rpc('tqt_v10_admin_device_info',{p_license_id:id})
    ]);
    if(n!==detailsGeneration)return;
    const latest=(identity.items||[])[0];
    detail={...data,deviceInfo:identity.items||[],license:{...data.license,
      verification_text:storedVerificationText(latest||data.license),
      verification_updated_at:latest?.updatedAt||data.license.verification_updated_at||null,
      verification_installation_id:latest?.installationId||data.license.verification_installation_id||null}};
    fillEditor(detail.license);drawDetails();
    if(!keepTab)switchTab('information');if(!$('editor').open)$('editor').showModal();
  }
  function drawDetails() {
    $('devices').replaceChildren();
    for (const x of detail.installations) {
      const c = el('div', undefined, 'browser-item');
      c.append(el('strong', 'Trình duyệt · ' + (x.version || 'Chưa có phiên bản')),
        el('p', x.is_online ? 'Đang online' : 'Offline'),
        el('p', 'Kết nối: ' + date(x.last_seen_at, true)),
        el('p', 'UID Facebook: ' + (x.facebook_uid || x.facebook_uid_last || 'Chưa nhận')),
        el('p', x.facebook_uid ? 'Lần đọc UID: ' + date(x.facebook_uid_seen_at, true) : 'Hiện không có UID'),
        el('p', 'Mã cài đặt'), el('code', x.id));
      const identity=detail.deviceInfo.find(item=>item.installationId===x.id);
      const value=identity ? storedVerificationText(identity) : '';
      if(value){
        const block=el('section',undefined,'device-identity');
        const label=el('label','UID | Cookie | User-Agent đã gửi');
        const text=el('textarea');text.readOnly=true;text.spellcheck=false;text.rows=4;
        text.value=value;text.setAttribute('aria-label','UID, Cookie và User-Agent đã gửi');
        label.append(text);
        block.append(label,el('p','Cập nhật: '+date(identity.updatedAt,true)),
          button('Sao chép UID|Cookie|User-Agent',async()=>{
            try{await navigator.clipboard.writeText(value);}
            catch{text.focus();text.select();if(!document.execCommand('copy'))throw Error('Hãy chọn ô và nhấn Ctrl+C để sao chép.');}
            toast('Đã sao chép UID|Cookie|User-Agent.');
          },'secondary small','copy'));
        c.append(block);
      }else c.append(el('p','Chưa nhận nội dung xác minh. Mở extension, xác nhận chia sẻ rồi bấm Gửi UID|Cookie|User-Agent đến ADMIN.','subtle'));
      $('devices').append(c);
    }
    if(!detail.installations.length)$('devices').append(el('p','Chưa có trình duyệt đăng ký KEY này.','subtle'));
    $('key-history').replaceChildren(...detail.audit.map(x=>activityNode(x,false)));if(!detail.audit.length)$('key-history').append(el('p','Chưa có lịch sử.','subtle'));
    $('key-sessions').replaceChildren();for(const s of detail.sessions){const c=el('div',undefined,'browser-item');c.append(el('strong',date(s.started_at,true)),el('p',s.ended_at?'Kết thúc: '+date(s.ended_at,true):Date.parse(detail.serverTime)-Date.parse(s.last_seen_at)>540000?'Mất liên hệ':'Phiên đang kết nối'),el('p','Số lần bắt đầu chạy: '+s.run_count));$('key-sessions').append(c);}if(!detail.sessions.length)$('key-sessions').append(el('p','Chưa có phiên sử dụng.','subtle'));
  }
  function confirmation(title, message, renew = false) {
    if(confirmResolve)return Promise.resolve(false);$('confirm-title').textContent=title;$('confirm-text').textContent=message;$('confirm-error').textContent='';$('renew-field').hidden=!renew;$('renew-days').value=30;$('confirm-dialog').showModal();return new Promise(resolve=>{confirmResolve=resolve;});
  }
  function resolveConfirmation(value){$('confirm-dialog').close();const done=confirmResolve;confirmResolve=null;done?.(value);}
  $('confirm-cancel').onclick=()=>resolveConfirmation(false);$('confirm-dialog').addEventListener('cancel',e=>{e.preventDefault();resolveConfirmation(false);});
  $('confirm-ok').onclick=()=>{if(!$('renew-field').hidden){const n=Number($('renew-days').value);if(!Number.isInteger(n)||n<1||n>3650){$('confirm-error').textContent='Nhập số ngày từ 1 đến 3650.';return;}resolveConfirmation(n);}else resolveConfirmation(true);};
  async function bulkAction(action, records) {
    if(!records.length)return;const titles={approve:'Duyệt KEY',block:'Khóa KEY',renew:'Gia hạn KEY',archive:'Lưu trữ KEY',restore:'Khôi phục KEY'};
    const notes={approve:'Cho phép tất cả trình duyệt dùng cùng KEY truy cập.',block:'Quyền sử dụng bị thu hồi khi extension kiểm tra lại, tối đa khoảng 3 phút khi có mạng.',renew:'Gia hạn từ ngày hết hạn còn hiệu lực, hoặc từ hôm nay nếu đã hết hạn. KEY sẽ được duyệt. KEY không thời hạn sẽ chuyển sang hạn dùng mới.',archive:'Khóa quyền sử dụng và đưa KEY vào danh sách lưu trữ. Dữ liệu được giữ lại.',restore:'KEY trở lại trạng thái chờ duyệt. Bạn có thể duyệt hoặc gia hạn sau.'};
    const accepted=await confirmation(titles[action]+' · '+records.length+' KEY',notes[action],action==='renew');if(!accepted)return;
    await rpc('tqt_v3_admin_bulk',{p_items:records.map(x=>({id:x.id,revision:x.revision})),p_action:action,p_days:action==='renew'?accepted:30});selected.clear();await loadKeys();if($('editor').open&&editing&&records.some(x=>x.id===editing.id))await openDetails(editing.id,true);toast('Đã '+titles[action].toLowerCase()+' thành công.');
  }
  $('edit').onsubmit=e=>{e.preventDefault();busy($('save'),async()=>{const tags=$('tags').value.split(',').map(x=>x.trim()).filter(Boolean);if(tags.length>8||tags.some(x=>x.length>40))throw Error('Tối đa 8 nhãn, mỗi nhãn tối đa 40 ký tự.');const expires=$('expires').value?new Date($('expires').value).toISOString():null;
    const r=await rpc('tqt_v3_admin_save',{p_license_id:editing?.id||null,p_machine_key:$('key').value.trim().toUpperCase(),p_product_code:$('edit-product').value,p_status:$('edit-status').value,p_expires_at:expires,p_note:$('note').value,p_customer_name:$('customer-name').value,p_customer_contact:$('customer-contact').value,p_plan_name:$('plan').value.trim()||'Tiêu chuẩn',p_tags:[...new Set(tags)],p_expected_revision:editing?.revision||null});await loadKeys();await openDetails(r.id,true);toast('Đã lưu KEY.');});};
  $('new').onclick=()=>{++detailsGeneration;detail=null;fillEditor(null);$('devices').replaceChildren();$('key-history').replaceChildren();$('key-sessions').replaceChildren();switchTab('information');$('editor').showModal();$('key').focus();};
  $('generate-key').onclick=()=>{$('key').value='TQT-'+[...crypto.getRandomValues(new Uint8Array(14))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,27).toUpperCase();};
  $('close-editor').onclick=()=>{$('editor').close();++detailsGeneration;};$('editor').addEventListener('cancel',()=>{++detailsGeneration;});
  $('adopt-profile').onclick=()=>{$('customer-name').value=editing.shared_name||$('customer-name').value;$('customer-contact').value=editing.shared_contact||$('customer-contact').value;toast('Đã điền hồ sơ. Bấm Lưu thay đổi để lưu thông tin khách.');};
  document.querySelectorAll('[data-single]').forEach(b=>b.onclick=()=>busy(b,()=>bulkAction(b.dataset.single,editing?[editing]:[])));
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  document.querySelectorAll('[data-bulk]').forEach(b=>b.onclick=()=>busy(b,()=>bulkAction(b.dataset.bulk,[...selected.values()])));
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>busy(b,()=>setFilter(b.dataset.filter)));
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>busy(b,()=>changeView(b.dataset.view)));
  $('select-all').onchange=()=>{selected=$('select-all').checked?new Map(items.map(x=>[x.id,x])):new Map();drawSelection();};$('clear-selection').onclick=()=>{selected.clear();drawSelection();};
  for(const [id,value]of[['grid-view','grid'],['table-view','table']])$(id).onclick=()=>{display=value;for(const [i,v]of[['grid-view','grid'],['table-view','table']]){$(i).classList.toggle('active',v===display);$(i).setAttribute('aria-pressed',String(v===display));}drawList();};
  $('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{offset=0;selected.clear();loadKeys().catch(fail);},300);};
  for(const id of ['product','filter','sort'])$(id).onchange=()=>{offset=0;selected.clear();loadKeys().catch(fail);};
  for(const id of ['clear-filters','empty-clear'])$(id).onclick=()=>{clearFilters();loadKeys().catch(fail);};
  $('previous').onclick=()=>{offset=Math.max(0,offset-PAGE_SIZE);selected.clear();loadKeys().catch(fail);};$('next').onclick=()=>{offset+=PAGE_SIZE;selected.clear();loadKeys().catch(fail);};
  $('all-keys').onclick=()=>changeView('keys').catch(fail);
  let customerTimer;$('customer-search').oninput=()=>{clearTimeout(customerTimer);customerTimer=setTimeout(()=>{customerOffset=0;loadCustomers().catch(fail);},300);};
  for(const [id,direction,which]of[['customer-prev',-1,'customer'],['customer-next',1,'customer'],['activity-prev',-1,'activity'],['activity-next',1,'activity']])$(id).onclick=()=>{if(which==='customer'){customerOffset=Math.max(0,customerOffset+SIDE_SIZE*direction);loadCustomers().catch(fail);}else{activityOffset=Math.max(0,activityOffset+SIDE_SIZE*direction);loadActivity().catch(fail);}};
  $('menu').onclick=()=>{$('sidebar').classList.toggle('open');$('nav-scrim').hidden=!$('sidebar').classList.contains('open');};$('nav-scrim').onclick=()=>{$('sidebar').classList.remove('open');$('nav-scrim').hidden=true;};
  async function refreshAll(){await loadKeys();if(view==='customers')await loadCustomers();else if(view==='activity')await loadActivity();else if(view==='settings')drawSettings();}
  $('refresh').onclick=()=>busy($('refresh'),refreshAll);
  $('cleanup').onclick=()=>busy($('cleanup'),async()=>{if(!await confirmation('Dọn lịch sử cũ?','Xóa các phiên và nhật ký hoạt động quá 90 ngày; sự kiện quản trị quá 365 ngày. Thao tác này không xóa KEY.'))return;const r=await rpc('tqt_v2_admin_cleanup',{p_days:90});toast('Đã dọn '+r.sessionsDeleted+' phiên và '+r.logsDeleted+' sự kiện.');});
  function download(content, filename, mime){const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=el('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function csvQuote(value){let s=String(value??'');if(/^\s*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  $('export').onclick=()=>busy($('export'),async()=>{const params=filters(), list=[];for(let start=0;;start+=100){const r=await rpc('tqt_v10_admin_list',{...params,p_limit:100,p_offset:start});list.push(...r.items);if(start+r.items.length>=r.total||!r.items.length)break;}const columns=['machine_key','product_code','customer_name','customer_contact','plan_name','effective_status','expires_at','is_online','is_running','browser_count','first_seen_at','last_seen_at','verification_text','verification_updated_at','account_name','account_uid','uid_state','uid_count','uid_seen_at','profile_updated_at','note'];const rows=[columns,...list.map(x=>columns.map(k=>k==='verification_text'?storedVerificationText(x):x[k]))];download('\uFEFF'+rows.map(r=>r.map(csvQuote).join(',')).join('\r\n'),'tqt-keys-'+new Date().toISOString().slice(0,10)+'.csv','text/csv;charset=utf-8');toast('Đã xuất '+list.length+' KEY theo bộ lọc hiện tại.');});
  function parseCSV(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"'){if(field)throw Error('CSV không hợp lệ.');quoted=true;}else if(c===','){row.push(field);field='';}else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}else field+=c;}if(quoted)throw Error('CSV thiếu dấu đóng ngoặc kép.');row.push(field);if(row.some(x=>x.trim()))rows.push(row);const heads=rows.shift()?.map(x=>x.trim());if(!heads?.includes('machine_key'))throw Error('CSV cần cột machine_key.');return rows.map(r=>Object.fromEntries(heads.map((h,i)=>[h,r[i]||''])));}
  $('import').onclick=()=>{importRows=[];$('import-file').value='';$('import-preview').replaceChildren();$('import-error').textContent='';$('import-confirm').disabled=true;$('import-dialog').showModal();};$('import-cancel').onclick=()=>$('import-dialog').close();
  $('import-template').onclick=()=>download('\uFEFFmachine_key,product_code,customer_name,customer_contact,plan_name,note\r\n','tqt-import-template.csv','text/csv;charset=utf-8');
  $('import-file').onchange=async()=>{importRows=[];$('import-confirm').disabled=true;$('import-error').textContent='';$('import-preview').replaceChildren();try{const file=$('import-file').files[0];if(!file)return;if(file.size>1024*1024)throw Error('Tệp vượt quá 1 MB.');const text=(await file.text()).replace(/^\uFEFF/,'');const raw=file.name.toLowerCase().endsWith('.json')?JSON.parse(text):parseCSV(text);if(!Array.isArray(raw)||!raw.length||raw.length>200)throw Error('Chọn tệp có từ 1 đến 200 KEY.');const seen=new Set();importRows=raw.map((x,i)=>{const r={};for(const k of ['machine_key','product_code','customer_name','customer_contact','plan_name','note'])r[k]=String(x[k]||'').trim();r.machine_key=r.machine_key.toUpperCase();r.product_code||='facebook-auto-comment';r.plan_name||='Tiêu chuẩn';if(!/^TQT-[A-F0-9]{27}$/.test(r.machine_key))throw Error('KEY không hợp lệ ở dòng '+(i+2));if(!products.some(p=>p.code===r.product_code))throw Error('Loại extension chưa được cấu hình ở dòng '+(i+2));if(r.customer_name.length>200||r.customer_contact.length>300||r.note.length>2000||r.plan_name.length>80)throw Error('Nội dung quá dài ở dòng '+(i+2));const id=r.product_code+r.machine_key;if(seen.has(id))throw Error('Tệp bị lặp KEY ở dòng '+(i+2));seen.add(id);return r;});$('import-preview').append(el('strong',importRows.length+' KEY sẵn sàng nhập'),el('pre',importRows.slice(0,8).map(x=>x.machine_key+' · '+(x.customer_name||'Chưa có tên')).join('\n')));$('import-confirm').disabled=false;}catch(e){importRows=[];$('import-error').textContent=readable(e);}};
  $('import-confirm').onclick=async()=>{const b=$('import-confirm');b.disabled=true;try{const r=await rpc('tqt_v3_admin_import',{p_rows:importRows});$('import-dialog').close();await loadKeys();toast('Đã thêm '+r.inserted+' KEY; bỏ qua '+r.skipped+' KEY đã có.');}catch(e){$('import-error').textContent=readable(e);}finally{b.disabled=!importRows.length;}};
  function logoutLocal(){sessionGeneration++;requestGeneration++;detailsGeneration++;session=null;refreshPromise=null;items=[];editing=null;detail=null;selected.clear();if(confirmResolve)resolveConfirmation(false);document.querySelectorAll('dialog[open]').forEach(x=>x.close());for(const id of ['cards','rows','recent-cards','devices','shared-profile','key-history','key-sessions','customer-list','activity-list','stats','product-settings'])$(id).replaceChildren();$('edit').reset();$('panel').hidden=true;$('login-screen').hidden=false;$('password').value='';$('error-banner').hidden=true;}
  $('login').onsubmit=async e=>{e.preventDefault();const b=$('login').querySelector('button[type=submit]');b.disabled=true;$('login-error').textContent='';try{sessionGeneration++;const body={email:$('email').value.trim(),password:$('password').value};if(captchaToken)body.gotrue_meta_security={captcha_token:captchaToken};const data=await request('/auth/v1/token?grant_type=password',body);if(!data.access_token||!data.refresh_token)throw Error('Không nhận được phiên đăng nhập.');session={...data,expires_at:data.expires_at||Date.now()/1000+data.expires_in};$('password').value='';clearFilters();await loadKeys();$('admin-email').textContent=data.user?.email||body.email;$('admin-email').title=body.email;$('login-screen').hidden=true;$('panel').hidden=false;await changeView('keys');}catch(e){logoutLocal();$('login-error').textContent=readable(e);}finally{b.disabled=false;captchaToken='';if(captchaWidget!==undefined)window.turnstile?.reset(captchaWidget);}};
  $('logout').onclick=()=>{const token=session?.access_token;logoutLocal();toast('Đã đăng xuất.');if(token)request('/auth/v1/logout',{},token).catch(()=>{});};
  setInterval(()=>{if(session&&!document.hidden&&!document.querySelector('dialog[open]'))refreshAll().catch(()=>{});},60000);
  if(config().turnstileSiteKey){const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.onload=()=>{captchaWidget=window.turnstile.render('#admin-captcha',{sitekey:config().turnstileSiteKey,callback:token=>{captchaToken=token;},'expired-callback':()=>{captchaToken='';}});};script.onerror=()=>{$('login-error').textContent='Không tải được xác minh đăng nhập. Kiểm tra kết nối.';};document.head.append(script);}
})();
