(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog = $('tqtPairDialog');
  if (!dialog || !window.tqtWebLicense) return;
  let generation = 0, busy = false, deadline = null;
  function message(text, state = '') {
    $('tqtPairMessage').textContent = text; $('tqtPairMessage').dataset.state = state;
  }
  function paintKey() { $('tqtPairCurrentKey').textContent = window.tqtWebLicense.getStatus()?.machineKey || 'Đang tạo KEY…'; }
  function clearCode() {
    $('tqtPairCode').value = ''; $('tqtPairOutput').hidden = true; deadline = null;
  }
  function open() {
    if (dialog.open) return;
    generation++; clearCode(); paintKey(); message(''); $('tqtPairJoinCode').value = ''; dialog.showModal();
  }
  async function task(action) {
    if (busy) return;
    const ownGeneration = generation;
    busy = true; $('createTqtPairBtn').disabled = true; $('joinTqtPairBtn').disabled = true;
    message('Đang kết nối ADMIN…');
    try { await action(ownGeneration); }
    catch (error) { if (generation === ownGeneration && dialog.open) message(error.message || 'Chưa ghép được KEY. Thử lại.', 'error'); }
    finally { busy = false; $('createTqtPairBtn').disabled = false; $('joinTqtPairBtn').disabled = false; paintKey(); }
  }
  $('openTqtPairGateBtn').addEventListener('click', open);
  $('openTqtPairSidebarBtn').addEventListener('click', open);
  $('closeTqtPairBtn').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; clearCode(); $('tqtPairJoinCode').value = ''; message(''); });
  $('createTqtPairBtn').addEventListener('click', () => task(async ownGeneration => {
    clearCode(); const data = await window.tqtWebLicense.createPairCode();
    if (generation !== ownGeneration || !dialog.open) return;
    $('tqtPairCode').value = data.pairCode; $('tqtPairOutput').hidden = false;
    deadline = {tick: performance.now(), duration: Date.parse(data.expiresAt) - Date.parse(data.serverTime)};
    $('tqtPairExpiry').textContent = 'Có hiệu lực 10 phút · chỉ ghép được một lần.';
    message('Copy mã này sang trình duyệt cần dùng chung KEY. Tạo mã mới sẽ vô hiệu mã trước.', 'ok');
  }));
  $('copyTqtPairBtn').addEventListener('click', async () => {
    if (!$('tqtPairCode').value) return;
    try { await navigator.clipboard.writeText($('tqtPairCode').value); message('Đã copy mã ghép.', 'ok'); }
    catch { $('tqtPairCode').focus(); $('tqtPairCode').select(); message('Chọn mã rồi nhấn Ctrl+C để sao chép.'); }
  });
  $('tqtPairJoinForm').addEventListener('submit', event => {
    event.preventDefault();
    task(async ownGeneration => {
      const state = await window.tqtWebLicense.joinPairCode($('tqtPairJoinCode').value);
      if (generation !== ownGeneration || !dialog.open) return;
      clearCode(); $('tqtPairJoinCode').value = ''; paintKey();
      message('Đã dùng chung ' + state.machineKey + '. Nguồn xác minh của trình duyệt này được tách riêng trên ADMIN.', 'ok');
    });
  });
  window.setInterval(() => {
    if (!dialog.open || !deadline) return;
    const seconds = Math.ceil((deadline.duration - (performance.now() - deadline.tick)) / 1000);
    if (seconds <= 0) { clearCode(); message('Mã đã hết hạn. Tạo mã mới để ghép trình duyệt.', 'error'); return; }
    $('tqtPairExpiry').textContent = 'Còn ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + ' · dùng một lần';
  }, 1000);
}());
