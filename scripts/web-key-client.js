(function () {
  'use strict';
  const KEY_PATTERN = /^TQT-[A-F0-9]{27}$/;
  const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
  const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const MESSAGES = Object.freeze({
    TQT_LICENSE_AUTHORIZED: 'KEY của web khớp extension và đã được ADMIN duyệt.',
    TQT_LICENSE_TRIAL: 'KEY khớp extension; đang dùng thử 12 giờ.',
    TQT_LICENSE_PENDING: 'KEY khớp extension. Đã gửi xác minh và đang chờ ADMIN duyệt.',
    TQT_LICENSE_BLOCKED: 'KEY đã bị ADMIN khóa.',
    TQT_LICENSE_EXPIRED: 'KEY đã hết hạn. Chờ ADMIN duyệt hoặc gia hạn.',
    TQT_LICENSE_REMOVED: 'KEY đã bị xóa. Liên hệ ADMIN; không tự tạo KEY mới.',
    TQT_PRODUCT_DISABLED: 'Sản phẩm đang tạm tắt trên trang quản lý.',
    TQT_DEVICE_EXTENSION_REQUIRED: 'Cài hoặc cập nhật extension 4.0.9 rồi kết nối lại với web.',
    TQT_KEY_MISMATCH: 'KEY của web không khớp KEY trong extension. Kết nối lại để đọc đúng KEY.',
    TQT_KEY_ALREADY_LINKED: 'KEY cũ đã thuộc một bản cài khác. Liên hệ ADMIN để kiểm tra.',
    TQT_KEY_MIGRATION_REQUIRED: 'Extension còn nhiều KEY cũ khác nhau. Liên hệ ADMIN; không tự đổi KEY.',
    TQT_KEY_PROOF_INVALID: 'Bằng chứng liên kết KEY chưa hợp lệ. Giữ dữ liệu extension và liên hệ ADMIN.',
    TQT_KEY_STORAGE_INVALID: 'Dữ liệu KEY của extension không hợp lệ. Giữ dữ liệu và liên hệ ADMIN.',
    TQT_BACKEND_SETUP_REQUIRED: 'ADMIN cần chạy 13-EXTENSION-TAO-KEY.sql đi kèm bản 4.0.9.',
    TQT_CAPTCHA_REQUIRED: 'Máy chủ yêu cầu xác minh kết nối.',
    TQT_AUTH_ANONYMOUS_DISABLED: 'ADMIN cần bật Anonymous Sign-Ins trong Supabase.',
    TQT_LICENSE_RESPONSE_INVALID: 'Phản hồi xác minh KEY không hợp lệ.',
    TQT_RATE_LIMITED: 'Máy chủ đang giới hạn yêu cầu. Chờ một lúc rồi thử lại.',
    TQT_ADMIN_SEND_DISABLED: 'Đã tạm tắt gửi xác minh sang ADMIN.',
    TQT_LICENSE_SOURCE_UNAVAILABLE: 'Chưa xác minh được KEY với ADMIN. Kiểm tra mạng và kết nối extension.'
  });
  const DENIED_CODES = new Set(['TQT_LICENSE_PENDING', 'TQT_LICENSE_BLOCKED', 'TQT_LICENSE_EXPIRED',
    'TQT_LICENSE_REMOVED', 'TQT_PRODUCT_DISABLED']);
  function createClient({config = window.TQT_CONFIG || {}, fetchImpl = window.fetch.bind(window),
    bridge = window.tqtWebTransport, origin = window.location.origin} = {}) {
    let latest = null, binding = null, serial = Promise.resolve();
    const product = config.webKeyProductCode || 'facebook-auto-comment';
    const failure = code => Object.assign(new Error(MESSAGES[code] || MESSAGES.TQT_LICENSE_SOURCE_UNAVAILABLE), {code});
    function validate(data, expected) {
      const time = Date.parse(data?.serverTime), deadline = data?.expiresAt === null ? Infinity : Date.parse(data?.expiresAt);
      const grant = data?.code === 'TQT_LICENSE_AUTHORIZED' || data?.code === 'TQT_LICENSE_TRIAL';
      const expectedStates = {TQT_LICENSE_AUTHORIZED: ['active'], TQT_LICENSE_TRIAL: ['trial'],
        TQT_LICENSE_PENDING: ['pending'], TQT_LICENSE_BLOCKED: ['blocked', 'archived'],
        TQT_LICENSE_EXPIRED: ['expired'], TQT_LICENSE_REMOVED: ['deleted'], TQT_PRODUCT_DISABLED: ['disabled']};
      if (data?.schemaVersion !== 17 || data.keySource !== 'extension-v17' || data.bindingVerified !== true
        || !KEY_PATTERN.test(data.machineKey || '') || !UUID_PATTERN.test(data.installationId || '')
        || data.productCode !== product || typeof data.authorized !== 'boolean'
        || (!grant && !DENIED_CODES.has(data.code)) || data.authorized !== grant || !Number.isFinite(time)
        || (!Number.isFinite(deadline) && data.expiresAt !== null) || (grant && deadline <= time)
        || data.trial !== (data.code === 'TQT_LICENSE_TRIAL') || (data.trial && !Number.isFinite(deadline))
        || !expectedStates[data.code]?.includes(data.keyStatus)
        || (grant && data.licenseStatus !== 'active')) throw failure('TQT_LICENSE_RESPONSE_INVALID');
      if (expected && (data.machineKey !== expected.machineKey || data.installationId !== expected.installationId)) throw failure('TQT_KEY_MISMATCH');
      const clean = {...data}; delete clean.webTicket; delete clean.ticketExpiresAt;
      return {...clean, synced: true, message: MESSAGES[data.code]};
    }
    async function serverStatus(ticket) {
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.supabaseUrl || '') || !config.supabaseAnonKey) throw failure('TQT_BACKEND_SETUP_REQUIRED');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetchImpl(config.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/tqt_v17_web_status', {
          method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: {apikey: config.supabaseAnonKey, 'Content-Type': 'application/json'},
          body: JSON.stringify({p_machine_key: ticket.machineKey, p_installation_id: ticket.installationId,
            p_ticket: ticket.webTicket, p_origin: origin, p_product_code: product})});
        let data; try {data = await response.json();} catch {throw failure('TQT_LICENSE_RESPONSE_INVALID');}
        if (!response.ok) {
          if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(data?.code)) throw failure('TQT_BACKEND_SETUP_REQUIRED');
          if (data?.message === 'WEB_TICKET_INVALID') throw failure('TQT_KEY_PROOF_INVALID');
          if (response.status === 429) throw failure('TQT_RATE_LIMITED');
          throw failure('TQT_LICENSE_SOURCE_UNAVAILABLE');
        }
        return validate(data, ticket);
      } finally {clearTimeout(timer);}
    }
    async function check({captchaToken} = {}) {
      try {
        if (!bridge?.request || !bridge.ready) throw failure('TQT_DEVICE_EXTENSION_REQUIRED');
        if (!bridge.getStatus()?.connected) {
          try {await bridge.ready(5000);} catch {throw failure('TQT_DEVICE_EXTENSION_REQUIRED');}
        }
        const session = bridge.getStatus().session;
        const response = await bridge.request('GET_TQT_EXTENSION_KEY', {captchaToken}, {timeoutMs: 60000});
        if (!response?.ok) throw failure(MESSAGES[response?.code] ? response.code : 'TQT_DEVICE_EXTENSION_REQUIRED');
        const ticket = response.data;
        validate(ticket);
        if (!TOKEN_PATTERN.test(ticket.webTicket || '') || !Number.isFinite(Date.parse(ticket.ticketExpiresAt))
          || Date.parse(ticket.ticketExpiresAt) <= Date.parse(ticket.serverTime)) throw failure('TQT_LICENSE_RESPONSE_INVALID');
        binding = {machineKey: ticket.machineKey, installationId: ticket.installationId};
        const verified = await serverStatus(ticket);
        const match = await bridge.request('TQT_MATCH_EXTENSION_KEY', binding, {timeoutMs: 20000});
        if (!match?.ok) throw failure(MESSAGES[match?.code] ? match.code : 'TQT_KEY_MISMATCH');
        const extensionStatus = validate(match.data, binding);
        if (!bridge.getStatus()?.connected || bridge.getStatus().session !== session) throw failure('TQT_DEVICE_EXTENSION_REQUIRED');
        // Both sides must permit use. An ADMIN change between checks fails closed.
        latest = verified.authorized && !extensionStatus.authorized ? extensionStatus : verified;
      } catch (error) {
        const code = MESSAGES[error.code] ? error.code : 'TQT_LICENSE_SOURCE_UNAVAILABLE';
        latest = {machineKey: binding?.machineKey || latest?.machineKey || '', installationId: binding?.installationId || '',
          synced: false, authorized: false, trial: false, code, message: MESSAGES[code]};
      }
      return structuredClone(latest);
    }
    const sync = options => {const work = serial.then(() => check(options), () => check(options)); serial = work.catch(() => {}); return work;};
    return {sync, getBinding: () => binding ? {...binding} : null, getStatus: () => latest ? structuredClone(latest) : null};
  }
  window.TQTWebKey = Object.freeze({createClient});
}());
