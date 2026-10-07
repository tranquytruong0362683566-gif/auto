(function () {
  'use strict';
  const IDENTITY_KEY = 'tqtWebKeyIdentityV12';
  const AUTH_KEY = 'tqtWebKeyAuthV12';
  const KEY_PATTERN = /^TQT-[A-F0-9]{27}$/;
  const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
  const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const DEVICE_METHOD = 'ex-hardware-v1';
  const REGISTER_RPC = 'tqt_v13_web_register_device';
  const SESSION_ERRORS = new Set(['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired']);
  const MESSAGES = Object.freeze({
    TQT_LICENSE_AUTHORIZED: 'KEY đã được ADMIN duyệt.',
    TQT_LICENSE_TRIAL: 'KEY đang dùng thử 12 giờ.',
    TQT_LICENSE_PENDING: 'KEY đang chờ ADMIN duyệt.',
    TQT_LICENSE_BLOCKED: 'KEY đang bị khóa.',
    TQT_LICENSE_EXPIRED: 'KEY đã hết hạn. Chờ ADMIN duyệt hoặc gia hạn.',
    TQT_PRODUCT_DISABLED: 'Sản phẩm đang tạm tắt trên trang quản lý.',
    TQT_BACKEND_SETUP_REQUIRED: 'ADMIN cần chạy 06-KEY-THEO-MAY.sql sau SQL 05 trong gói web trước khi sử dụng.',
    TQT_DEVICE_EXTENSION_REQUIRED: 'Cài/cập nhật tiện ích 4.0.4 trên trình duyệt này để nhận diện máy và lấy KEY đã có.',
    TQT_DEVICE_UNAVAILABLE: 'Chưa đọc được cấu hình máy. Kiểm tra quyền CPU/RAM/ổ đĩa của tiện ích rồi thử lại.',
    TQT_DEVICE_CHANGED: 'Cấu hình máy đã thay đổi. Liên hệ ADMIN để kiểm tra KEY; không tự cấp thêm dùng thử.',
    TQT_AUTH_RESET_REQUIRED: 'Phiên kết nối hết hiệu lực. Bấm Khôi phục kết nối; KEY và hạn dùng được giữ nguyên.',
    TQT_WEB_KEY_LINK_MISMATCH: 'Liên kết KEY không khớp dữ liệu đã đăng ký. Giữ nguyên dữ liệu trang và liên hệ ADMIN kiểm tra KEY.',
    TQT_CAPTCHA_REQUIRED: 'Máy chủ yêu cầu xác minh kết nối.',
    TQT_AUTH_ANONYMOUS_DISABLED: 'ADMIN cần bật Anonymous Sign-Ins trong Supabase.',
    TQT_WEB_KEY_INVALID: 'KEY hoặc phiên liên kết chưa hợp lệ. Tải lại trang và kiểm tra cấu hình.',
    TQT_WEB_KEY_ALREADY_EXISTS: 'KEY này đã có chủ sở hữu. KEY hiện tại được giữ để kiểm tra lại.',
    TQT_COOKIE_VERIFICATION_INVALID: 'Chuỗi xác minh chưa hợp lệ. Mở tiện ích rồi bấm Bảng Điều Khiển để gửi lại.',
    TQT_STORAGE_UNAVAILABLE: 'Trình duyệt đang chặn lưu KEY. Cho phép lưu dữ liệu cho trang này rồi tải lại.',
    TQT_LICENSE_RESPONSE_INVALID: 'Máy chủ trả về trạng thái KEY không hợp lệ.',
    TQT_RATE_LIMITED: 'Máy chủ đang giới hạn yêu cầu. Chờ vài phút rồi thử lại.',
    TQT_LICENSE_SOURCE_UNAVAILABLE: 'Chưa kết nối được ADMIN. Kiểm tra mạng rồi bấm Kiểm tra lại.'
  });

  function createClient({config = window.TQT_CONFIG || {}, storage,
    fetchImpl = window.fetch.bind(window), cryptoApi = window.crypto,
    now = () => Date.now(), locks = navigator.locks, deviceProvider = getDeviceIdentity} = {}) {
    let identity, auth, latest = null, serial = Promise.resolve();
    const productCode = config.webKeyProductCode || 'facebook-auto-comment';
    const failure = code => Object.assign(new Error(MESSAGES[code] || MESSAGES.TQT_LICENSE_SOURCE_UNAVAILABLE), {code});
    function queue(task) {
      const run = () => locks?.request ? locks.request('tqt-web-key-v12', task) : task();
      const work = serial.then(run, run); serial = work.catch(() => {}); return work;
    }
    function read(key) {
      try {const raw = (storage || window.localStorage).getItem(key); return raw ? JSON.parse(raw) : null;}
      catch (error) {
        if (error instanceof SyntaxError) {
          if (key === AUTH_KEY) return null;
          throw failure('TQT_WEB_KEY_INVALID');
        }
        throw failure('TQT_STORAGE_UNAVAILABLE');
      }
    }
    function write(key, value) {
      try {(storage || window.localStorage).setItem(key, JSON.stringify(value));}
      catch {throw failure('TQT_STORAGE_UNAVAILABLE');}
    }
    const randomHex = length => [...cryptoApi.getRandomValues(new Uint8Array(length))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    function load() {
      identity = read(IDENTITY_KEY);
      if (!identity) {
        identity = {machineKey: '',
          installationId: cryptoApi.randomUUID(), bindingToken: randomHex(32), productCode,
          project: config.supabaseUrl};
        write(IDENTITY_KEY, identity);
      }
      if ((identity.machineKey !== '' && !KEY_PATTERN.test(identity.machineKey || '')) || !UUID_PATTERN.test(identity.installationId || '')
          || !TOKEN_PATTERN.test(identity.bindingToken || '') || identity.productCode !== productCode
          || identity.project !== config.supabaseUrl
          || (identity.deviceFingerprint && !TOKEN_PATTERN.test(identity.deviceFingerprint))
          || (identity.deviceMethod && identity.deviceMethod !== DEVICE_METHOD)) throw failure('TQT_WEB_KEY_INVALID');
      const savedAuth = read(AUTH_KEY);
      auth = savedAuth?.project === config.supabaseUrl ? savedAuth : null;
    }
    function httpError(status, data, path) {
      const message = String(data?.message || data?.msg || data?.error_description || '');
      const code = String(data?.error_code || data?.code || '');
      const phase = path.startsWith('/auth/v1/') ? 'auth' : 'rpc';
      const legacyRefreshError = path.startsWith('/auth/v1/token?grant_type=refresh_token')
        && !data?.error_code && (!data?.code || typeof data.code === 'number')
        && [400, 401].includes(status)
        && /(?:Invalid Refresh Token|Refresh Token Not Found|No Valid Session Found|Session (?:Not Found|Expired))/i.test(message);
      let localCode = 'TQT_LICENSE_SOURCE_UNAVAILABLE';
      if (/captcha/i.test(code + message)) localCode = 'TQT_CAPTCHA_REQUIRED';
      else if (/anonymous.*(?:disabled|not enabled)/i.test(code + message)) localCode = 'TQT_AUTH_ANONYMOUS_DISABLED';
      else if (status === 429) localCode = 'TQT_RATE_LIMITED';
      else if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(code)) localCode = 'TQT_BACKEND_SETUP_REQUIRED';
      else if (message === 'WEB_KEY_NOT_OWNED') localCode = 'TQT_WEB_KEY_LINK_MISMATCH';
      else if (SESSION_ERRORS.has(code) || legacyRefreshError) localCode = 'TQT_AUTH_RESET_REQUIRED';
      else if (message === 'WEB_KEY_INVALID') localCode = 'TQT_WEB_KEY_INVALID';
      else if (['WEB_KEY_ALREADY_EXISTS', 'WEB_KEY_ALREADY_REGISTERED'].includes(message)) localCode = 'TQT_WEB_KEY_ALREADY_EXISTS';
      else if (message === 'COOKIE_VERIFICATION_INVALID') localCode = 'TQT_COOKIE_VERIFICATION_INVALID';
      else if (message === 'DEVICE_ID_REQUIRED') localCode = 'TQT_DEVICE_EXTENSION_REQUIRED';
      else if (message === 'DEVICE_ID_INVALID') localCode = 'TQT_DEVICE_UNAVAILABLE';
      else if (message === 'DEVICE_CHANGED') localCode = 'TQT_DEVICE_CHANGED';
      else if (message === 'PRODUCT_UNAVAILABLE') localCode = 'TQT_PRODUCT_DISABLED';
      return Object.assign(failure(localCode), {status, phase, backendCode: code});
    }
    async function post(path, body, token) {
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.supabaseUrl || '') || !config.supabaseAnonKey) throw failure('TQT_WEB_KEY_INVALID');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetchImpl(config.supabaseUrl.replace(/\/$/, '') + path, {
          method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: {apikey: config.supabaseAnonKey, 'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
          body: JSON.stringify(body)
        });
        let data;
        try {data = await response.json();} catch {throw failure('TQT_LICENSE_RESPONSE_INVALID');}
        if (!response.ok) throw httpError(response.status, data, path);
        return data;
      } finally {clearTimeout(timer);}
    }
    function saveAuth(data) {
      if (!data?.access_token || !data.refresh_token || !data.user?.id) throw failure('TQT_LICENSE_RESPONSE_INVALID');
      auth = {project: config.supabaseUrl, access_token: data.access_token, refresh_token: data.refresh_token,
        user_id: data.user.id, expires_at: Number(data.expires_at) || now() / 1000 + Number(data.expires_in || 3600)};
      write(AUTH_KEY, auth); return auth.access_token;
    }
    async function accessToken(captchaToken) {
      if (auth?.access_token && auth.expires_at * 1000 > now() + 60000) return auth.access_token;
      if (auth?.refresh_token) {
        return saveAuth(await post('/auth/v1/token?grant_type=refresh_token', {refresh_token: auth.refresh_token}));
      }
      const body = {data: {product_code: productCode, key_source: 'web'}};
      if (captchaToken) body.gotrue_meta_security = {captcha_token: captchaToken};
      return saveAuth(await post('/auth/v1/signup', body));
    }
    function registrationBody(device) {
      return {p_device_fingerprint: device.fingerprint, p_installation_id: identity.installationId,
        p_binding_token: identity.bindingToken, p_product_code: productCode, p_previous_key: identity.machineKey};
    }
    async function restoreMachineBinding(token) {
      const device = await deviceProvider();
      if (device?.schemaVersion !== 1 || device.method !== DEVICE_METHOD || !TOKEN_PATTERN.test(device.fingerprint || '')) {
        throw failure('TQT_DEVICE_UNAVAILABLE');
      }
      if (!identity.deviceFingerprint || identity.deviceFingerprint !== device.fingerprint) throw failure('TQT_DEVICE_CHANGED');
      // A renewed anonymous session has a different owner ID. Reattach it with
      // the existing installation/proof before any queued verification request.
      // SQL remains responsible for the unchanged KEY, approval and deadline.
      validate(await post('/rest/v1/rpc/' + REGISTER_RPC, registrationBody(device), token), device);
    }
    async function rpc(name, body, captchaToken) {
      let refreshed = false, recovered = false, needsBinding = false;
      while (true) {
        try {
          const previousOwner = auth?.user_id;
          const token = await accessToken(captchaToken);
          if (name !== REGISTER_RPC && auth?.user_id !== previousOwner) needsBinding = true;
          if (name !== REGISTER_RPC && needsBinding) {await restoreMachineBinding(token); needsBinding = false;}
          return await post('/rest/v1/rpc/' + name, body, token);
        } catch (error) {
          if (error.phase === 'rpc' && error.status === 401 && !refreshed && auth?.refresh_token
              && error.code !== 'TQT_WEB_KEY_LINK_MISMATCH') {
            refreshed = true; auth.expires_at = 0; continue;
          }
          if (error.code === 'TQT_AUTH_RESET_REQUIRED' && !recovered) {
            // One session recovery per operation. Never clear or regenerate
            // the KEY, installation ID, binding token or hardware identity.
            recovered = true; auth = null; write(AUTH_KEY, null);
            needsBinding = name !== REGISTER_RPC;
            continue;
          }
          throw error;
        }
      }
    }
    function validate(data, device = null) {
      if (data?.schemaVersion !== 12 || !KEY_PATTERN.test(data.machineKey || '')
          || (!device && data.machineKey !== identity.machineKey)
          || (device && (data.deviceFingerprint !== device.fingerprint || data.deviceMethod !== DEVICE_METHOD))
          || (device && identity.deviceFingerprint && data.machineKey !== identity.machineKey)
          || typeof data.authorized !== 'boolean' || !MESSAGES[data.code]
          || !Number.isFinite(Date.parse(data.serverTime))
          || (data.expiresAt !== null && !Number.isFinite(Date.parse(data.expiresAt)))
          || (data.authorized && data.expiresAt && Date.parse(data.expiresAt) <= Date.parse(data.serverTime))) throw failure('TQT_LICENSE_RESPONSE_INVALID');
      return {...data, synced: true, message: MESSAGES[data.code]};
    }
    const sync = ({captchaToken, reconnect = false} = {}) => queue(async () => {
      try {
        load();
        const device = await deviceProvider();
        if (device?.schemaVersion !== 1 || device.method !== DEVICE_METHOD || !TOKEN_PATTERN.test(device.fingerprint || '')) {
          throw failure('TQT_DEVICE_UNAVAILABLE');
        }
        if (identity.deviceFingerprint && identity.deviceFingerprint !== device.fingerprint) throw failure('TQT_DEVICE_CHANGED');
        if (reconnect) {auth = null; write(AUTH_KEY, null);}
        const data = validate(await rpc(REGISTER_RPC, registrationBody(device), captchaToken), device);
        // Only the server chooses the shared KEY. The browser keeps its own
        // private binding proof; clearing it cannot reset the machine's trial.
        identity = {...identity, machineKey: data.machineKey, deviceFingerprint: device.fingerprint, deviceMethod: DEVICE_METHOD};
        write(IDENTITY_KEY, identity);
        latest = data;
      } catch (error) {
        const code = MESSAGES[error.code] ? error.code : 'TQT_LICENSE_SOURCE_UNAVAILABLE';
        latest = {machineKey: identity?.machineKey || '', synced: false, authorized: false, code, message: MESSAGES[code]};
      }
      return structuredClone(latest);
    });
    const shareVerification = (verificationText, version = '') => queue(async () => {
      load();
      if (!identity.deviceFingerprint || !KEY_PATTERN.test(identity.machineKey)) throw failure('TQT_DEVICE_EXTENSION_REQUIRED');
      const data = await rpc('tqt_v12_web_verification', {p_machine_key: identity.machineKey,
        p_installation_id: identity.installationId, p_verification_text: verificationText, p_version: version});
      if (data?.stored !== true || data.verificationText !== verificationText) throw failure('TQT_LICENSE_RESPONSE_INVALID');
      latest = validate(data);
      // Never expose the echoed cookie in the public license status.
      delete latest.verificationText; delete latest.stored;
      return structuredClone(latest);
    });
    return {
      sync, shareVerification,
      getBinding() {return identity?.deviceFingerprint && KEY_PATTERN.test(identity.machineKey)
        ? {machineKey: identity.machineKey, bindingToken: identity.bindingToken} : null;},
      getStatus() {return structuredClone(latest);}
    };
  }
  async function getDeviceIdentity() {
    const bridge = window.tqtWebTransport;
    if (!bridge) throw Object.assign(new Error(), {code: 'TQT_DEVICE_EXTENSION_REQUIRED'});
    try {await bridge.ready(10000);}
    catch {throw Object.assign(new Error(), {code: 'TQT_DEVICE_EXTENSION_REQUIRED'});}
    const response = await bridge.request('TQT_GET_DEVICE_ID', {}, {timeoutMs: 15000});
    if (response?.ok !== true) throw Object.assign(new Error(), {
      code: response?.code === 'TQT_DEVICE_UNAVAILABLE' ? 'TQT_DEVICE_UNAVAILABLE' : 'TQT_DEVICE_EXTENSION_REQUIRED'
    });
    return response.data;
  }
  window.TQTWebKey = Object.freeze({createClient});
}());
