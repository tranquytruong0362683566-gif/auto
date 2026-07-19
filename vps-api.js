(function () {
  'use strict';

  class FacebookVpsApiClient {
    constructor({ baseUrl, token, timeoutMs = 30000 } = {}) {
      this.baseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
      this.token = String(token || '').trim();
      this.timeoutMs = Number(timeoutMs) || 30000;
    }

    configure({ baseUrl, token } = {}) {
      if (baseUrl != null) this.baseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
      if (token != null) this.token = String(token || '').trim();
      return this;
    }

    async request(path, options = {}) {
      if (!this.baseUrl) {
        const error = new Error('Chưa nhập URL API VPS.');
        error.code = 'VPS_API_URL_MISSING';
        throw error;
      }

      const controller = new AbortController();
      const timeoutMs = Number(options.timeoutMs || this.timeoutMs);
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        let parsedBaseUrl;
        try {
          parsedBaseUrl = new URL(this.baseUrl);
        } catch {
          const invalidUrlError = new Error('URL API VPS không hợp lệ.');
          invalidUrlError.code = 'VPS_API_URL_INVALID';
          throw invalidUrlError;
        }

        if (
          window.FB_VPS_WEB_CONFIG?.requireHttpsApiOnHttpsPage !== false
          && location.protocol === 'https:'
          && parsedBaseUrl.protocol !== 'https:'
        ) {
          const mixedContentError = new Error('Web GitHub đang dùng HTTPS nên API VPS cũng phải dùng HTTPS.');
          mixedContentError.code = 'VPS_HTTPS_REQUIRED';
          throw mixedContentError;
        }

        const isNgrokFree = /(^|\.)ngrok-free\.app$/i.test(parsedBaseUrl.hostname);
        const useNgrokHeader = isNgrokFree && window.FB_VPS_WEB_CONFIG?.ngrokSkipBrowserWarning !== false;
        const headers = {
          Accept: 'application/json',
          ...(useNgrokHeader ? { 'ngrok-skip-browser-warning': '1' } : {}),
          ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
          ...(options.auth === false ? {} : { Authorization: `Bearer ${this.token}` }),
          ...(options.headers || {})
        };

        const response = await fetch(`${this.baseUrl}${path}`, {
          ...options,
          headers,
          signal: controller.signal
        });

        const json = await response.json().catch(() => ({
          success: false,
          code: 'INVALID_JSON',
          message: `VPS trả dữ liệu không phải JSON (HTTP ${response.status}).`,
          data: {}
        }));

        if (!response.ok || json.success === false) {
          const error = new Error(json.message || `HTTP ${response.status}`);
          error.code = json.code || `HTTP_${response.status}`;
          error.data = json.data || {};
          error.status = response.status;
          throw error;
        }
        return json;
      } catch (error) {
        if (error?.name === 'AbortError') {
          const timeoutError = new Error(`Quá thời gian chờ VPS (${timeoutMs} ms).`);
          timeoutError.code = 'VPS_REQUEST_TIMEOUT';
          throw timeoutError;
        }
        if (error instanceof TypeError && /fetch/i.test(String(error.message || ''))) {
          const networkError = new Error('Không kết nối được API VPS. Hãy kiểm tra URL HTTPS, tunnel, CORS, Docker và VPS đang online.');
          networkError.code = 'VPS_NETWORK_ERROR';
          networkError.cause = error;
          throw networkError;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    health() {
      return this.request('/health', { method: 'GET', auth: false, timeoutMs: 15000 });
    }

    listAccounts() {
      return this.request('/api/accounts', { method: 'GET' });
    }

    getAccount(accountId) {
      return this.request(`/api/accounts/${encodeURIComponent(accountId)}`, { method: 'GET' });
    }

    importCookie(cookieLine) {
      return this.request('/api/accounts/import', {
        method: 'POST',
        body: JSON.stringify({ cookieLine })
      });
    }

    deleteAccount(accountId) {
      return this.request(`/api/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    }

    validateAccount(accountId, requestId = `validate_${Date.now()}`) {
      return this.request(`/api/accounts/${encodeURIComponent(accountId)}/validate`, {
        method: 'POST',
        headers: { 'X-Request-Id': requestId },
        body: JSON.stringify({ requestId })
      });
    }

    createCommentJob({ requestId, accountId, postUrl, content }) {
      return this.request('/api/facebook/comments', {
        method: 'POST',
        body: JSON.stringify({
          requestId: requestId || `comment_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          payload: { accountId, postUrl, content }
        })
      });
    }

    getJob(jobId) {
      return this.request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });
    }

    cancelJob(jobId) {
      return this.request(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({})
      });
    }

    async waitForJob(jobId, {
      intervalMs = 1500,
      timeoutMs = 240000,
      onUpdate = null,
      shouldStop = null
    } = {}) {
      const startedAt = Date.now();
      let lastStateKey = '';

      while (Date.now() - startedAt < timeoutMs) {
        if (typeof shouldStop === 'function' && shouldStop()) {
          await this.cancelJob(jobId).catch(() => {});
          const error = new Error('Tác vụ đã bị người dùng dừng.');
          error.code = 'JOB_CANCELLED_BY_USER';
          throw error;
        }

        const response = await this.getJob(jobId);
        const job = response.data || {};
        const stateKey = JSON.stringify([job.state, job.progress, job.error?.code, job.result?.code]);
        if (stateKey !== lastStateKey) {
          lastStateKey = stateKey;
          onUpdate?.(job);
        }

        if (job.state === 'completed') return job.result || { success: true, code: 'JOB_COMPLETED', data: {} };
        if (job.state === 'failed') {
          const error = new Error(job.error?.message || 'VPS chạy bình luận thất bại.');
          error.code = job.error?.code || 'JOB_FAILED';
          error.data = job;
          error.requiresAccountRotation = Boolean(job.error?.requiresAccountRotation);
          throw error;
        }

        await new Promise(resolve => setTimeout(resolve, Math.max(300, Number(intervalMs) || 1500)));
      }

      const error = new Error('Quá thời gian chờ VPS hoàn thành bình luận.');
      error.code = 'VPS_JOB_TIMEOUT';
      error.data = { jobId };
      throw error;
    }
  }

  window.FacebookVpsApiClient = FacebookVpsApiClient;
}());
