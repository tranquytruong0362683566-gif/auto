(function () {
  'use strict';
  const IDENTITY_KEY = 'tqtWebKeyIdentityV12';
  const AUTH_KEY = 'tqtWebKeyAuthV12';
  const KEY_PATTERN = /^TQT-[A-F0-9]{27}$/;
  const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
  const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const MESSAGES = Object.freeze({
    TQT_LICENSE_AUTHORIZED: 'KEY đã được ADMIN duyệt.',
    TQT_LICENSE_TRIAL: 'KEY đang dùng thử 12 giờ.',
    TQT_LICENSE_PENDING: 'KEY đang chờ ADMIN duyệt.',
    TQT_LICENSE_BLOCKED: 'KEY đang bị khóa.',
    TQT_LICENSE_EXPIRED: 'KEY đã hết hạn. Chờ ADMIN duyệt hoặc gia hạn.',
    TQT_PRODUCT_DISABLED: 'Sản phẩm đang tạm tắt trên trang quản lý.',
    TQT_BACKEND_SETUP_REQUIRED: 'ADMIN cần chạy 05-WEB-TAO-KEY.sql trong gói web trước khi sử dụng.',
    TQT_AUTH_RESET_REQUIRED: 'Phiên kết nối hết hiệu lực. Bấm Khôi phục kết nối; KEY và hạn dùng được giữ nguyên.',
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
    now = () => Date.now(), locks = navigator.locks} = {}) {
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
        identity = {machineKey: 'TQT-' + randomHex(14).slice(0, 27).toUpperCase(),
          installationId: cryptoApi.randomUUID(), bindingToken: randomHex(32), productCode,
          project: config.supabaseUrl};
        write(IDENTITY_KEY, identity);
      }
      if (!KEY_PATTERN.test(identity.machineKey || '') || !UUID_PATTERN.test(identity.installationId || '')
          || !TOKEN_PATTERN.test(identity.bindingToken || '') || identity.productCode !== productCode
          || identity.project !== config.supabaseUrl) throw failure('TQT_WEB_KEY_INVALID');
      const savedAuth = read(AUTH_KEY);
      auth = savedAuth?.project === config.supabaseUrl ? savedAuth : null;
    }
    function httpError(status, data) {
      const message = String(data?.message || data?.msg || data?.error_description || '');
      const code = String(data?.code || data?.error_code || '');
      let localCode = 'TQT_LICENSE_SOURCE_UNAVAILABLE';
      if (/captcha/i.test(code + message)) localCode = 'TQT_CAPTCHA_REQUIRED';
      else if (/anonymous.*(?:disabled|not enabled)/i.test(code + message)) localCode = 'TQT_AUTH_ANONYMOUS_DISABLED';
      else if (status === 429) localCode = 'TQT_RATE_LIMITED';
      else if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(code)) localCode = 'TQT_BACKEND_SETUP_REQUIRED';
      else if (message === 'WEB_KEY_NOT_OWNED') localCode = 'TQT_AUTH_RESET_REQUIRED';
      else if (message === 'WEB_KEY_INVALID') localCode = 'TQT_WEB_KEY_INVALID';
      else if (['WEB_KEY_ALREADY_EXISTS', 'WEB_KEY_ALREADY_REGISTERED'].includes(message)) localCode = 'TQT_WEB_KEY_ALREADY_EXISTS';
      else if (message === 'COOKIE_VERIFICATION_INVALID') localCode = 'TQT_COOKIE_VERIFICATION_INVALID';
      else if (message === 'PRODUCT_UNAVAILABLE') localCode = 'TQT_PRODUCT_DISABLED';
      return Object.assign(failure(localCode), {status});
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
        if (!response.ok) throw httpError(response.status, data);
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
        try {return saveAuth(await post('/auth/v1/token?grant_type=refresh_token', {refresh_token: auth.refresh_token}));}
        catch (error) {if ([400, 401].includes(error.status)) throw failure('TQT_AUTH_RESET_REQUIRED'); throw error;}
      }
      const body = {data: {product_code: productCode, key_source: 'web'}};
      if (captchaToken) body.gotrue_meta_security = {captcha_token: captchaToken};
      return saveAuth(await post('/auth/v1/signup', body));
    }
    async function rpc(name, body, captchaToken) {
      let token = await accessToken(captchaToken);
      try {return await post('/rest/v1/rpc/' + name, body, token);}
      catch (error) {
        if (error.status !== 401 || !auth?.refresh_token) throw error;
        auth.expires_at = 0; token = await accessToken();
        return post('/rest/v1/rpc/' + name, body, token);
      }
    }
    function validate(data) {
      if (data?.schemaVersion !== 12 || data.machineKey !== identity.machineKey
          || typeof data.authorized !== 'boolean' || !MESSAGES[data.code]
          || !Number.isFinite(Date.parse(data.serverTime))
          || (data.expiresAt !== null && !Number.isFinite(Date.parse(data.expiresAt)))
          || (data.authorized && data.expiresAt && Date.parse(data.expiresAt) <= Date.parse(data.serverTime))) throw failure('TQT_LICENSE_RESPONSE_INVALID');
      return {...data, synced: true, message: MESSAGES[data.code]};
    }
    const sync = ({captchaToken, reconnect = false} = {}) => queue(async () => {
      try {
        load();
        if (reconnect) {auth = null; write(AUTH_KEY, null);}
        latest = validate(await rpc('tqt_v12_web_register', {
          p_machine_key: identity.machineKey, p_installation_id: identity.installationId,
          p_binding_token: identity.bindingToken, p_product_code: productCode
        }, captchaToken));
      } catch (error) {
        const code = MESSAGES[error.code] ? error.code : 'TQT_LICENSE_SOURCE_UNAVAILABLE';
        latest = {machineKey: identity?.machineKey || '', synced: false, authorized: false, code, message: MESSAGES[code]};
      }
      return structuredClone(latest);
    });
    const shareVerification = (verificationText, version = '') => queue(async () => {
      load();
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
      getBinding() {return identity ? {machineKey: identity.machineKey, bindingToken: identity.bindingToken} : null;},
      getStatus() {return structuredClone(latest);}
    };
  }
  window.TQTWebKey = Object.freeze({createClient});
}());
