'use strict';

    const APP = {
      apiEndpoint: 'https://console.flatkey.ai/v1/chat/completions',
      model: 'gpt-4o-mini',
      storage: {
        leftTemplates: 'truong_ai_commenter_templates_left_v2',
        rightTemplates: 'truong_ai_commenter_templates_right_v2',
        history: 'truong_ai_commenter_history_v2',
        draft: 'truong_ai_commenter_draft_v2',
        shopeeTargetCount: 'truong_ai_commenter_shopee_target_count_v1',
        apiEndpoint: 'truong_chatgpt_api_endpoint_v1',
        apiKey: 'truong_chatgpt_api_key_v1',
        apiModel: 'truong_chatgpt_api_model_v1'
      },
      tokenErrorPatterns: [
        'quota', 'rate limit', 'rate_limit', 'insufficient', 'limit exceeded',
        'token', 'credits', 'billing', 'usage', '429', 'too many requests',
        'hết', 'vượt quá', 'giới hạn', 'credit'
      ]
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    const els = {
      authStatus: $('#authStatus'),
      authUsername: $('#authUsername'),
      authAvatar: $('#authAvatar'),
      tokenBanner: $('#tokenBanner'),
      chatApiEndpointInput: $('#chatApiEndpointInput'),
      chatApiKeyInput: $('#chatApiKeyInput'),
      chatApiModelInput: $('#chatApiModelInput'),
      articleInput: $('#articleInput'),
      productNameInput: $('#productNameInput'),
      productLinkInput: $('#productLinkInput'),
      shopeeTargetCountInput: $('#shopeeTargetCountInput'),
      toneSelect: $('#toneSelect'),
      generateBtn: $('#generateBtn'),
      clearBtn: $('#clearBtn'),
      pasteBtn: $('#pasteBtn'),
      copyBtn: $('#copyBtn'),
      saveHistoryBtn: $('#saveHistoryBtn'),
      output: $('#output'),
      articleCounter: $('#articleCounter'),
      productCounter: $('#productCounter'),
      linkCounter: $('#linkCounter'),
      linkStatus: $('#linkStatus'),
      validLinkStat: $('#validLinkStat'),
      leftTplStat: $('#leftTplStat'),
      rightTplStat: $('#rightTplStat'),
      historyStat: $('#historyStat'),
      templateModal: $('#templateModal'),
      modalTitle: $('#modalTitle'),
      tplNameInput: $('#tplNameInput'),
      tplProductInput: $('#tplProductInput'),
      tplLinksInput: $('#tplLinksInput'),
      btnSaveTpl: $('#btnSaveTpl'),
      btnCancelTpl: $('#btnCancelTpl'),
      toastHost: $('#toastHost')
    };

    const state = {
      activeManager: null,
      editingIndex: -1,
      selectedTemplateKey: null,
      managers: {},
      shopeeGenerating: false
    };

    function safeJsonParse(value, fallback) {
      try { return JSON.parse(value) ?? fallback; }
      catch { return fallback; }
    }

    function loadStorage(key, fallback) {
      return safeJsonParse(localStorage.getItem(key), fallback);
    }

    function saveStorage(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    }

    function toast(message, type = 'success') {
      const item = document.createElement('div');
      item.className = `toast ${type}`;
      item.textContent = message;
      els.toastHost.appendChild(item);
      setTimeout(() => item.remove(), 3300);
    }

    function setOutput(message, className = '') {
      els.output.textContent = message;
      els.output.className = className;
    }

    function normalizeEndpoint(endpoint) {
      return String(endpoint || APP.apiEndpoint).trim().replace(/\/+$/, '');
    }

    function getApiEndpoint() {
      const value = normalizeEndpoint(els.chatApiEndpointInput?.value || loadStorage(APP.storage.apiEndpoint, APP.apiEndpoint));
      if (els.chatApiEndpointInput && els.chatApiEndpointInput.value !== value) els.chatApiEndpointInput.value = value;
      saveStorage(APP.storage.apiEndpoint, value);
      return value;
    }

    function getApiModel() {
      const value = String(els.chatApiModelInput?.value || loadStorage(APP.storage.apiModel, APP.model) || APP.model).trim() || APP.model;
      if (els.chatApiModelInput && els.chatApiModelInput.value !== value) els.chatApiModelInput.value = value;
      saveStorage(APP.storage.apiModel, value);
      return value;
    }

    function getApiKey() {
      const raw = els.chatApiKeyInput ? els.chatApiKeyInput.value : loadStorage(APP.storage.apiKey, '');
      const value = String(raw || '').trim();
      saveStorage(APP.storage.apiKey, value);
      return value;
    }

    function restoreApiSettings() {
      if (els.chatApiEndpointInput) els.chatApiEndpointInput.value = loadStorage(APP.storage.apiEndpoint, APP.apiEndpoint) || APP.apiEndpoint;
      if (els.chatApiModelInput) els.chatApiModelInput.value = loadStorage(APP.storage.apiModel, APP.model) || APP.model;
      if (els.chatApiKeyInput) els.chatApiKeyInput.value = loadStorage(APP.storage.apiKey, '') || '';
    }

    function hasApiKey() {
      return !!getApiKey();
    }

    function getErrorText(error) {
      if (!error) return '';
      if (typeof error === 'string') return error;
      if (error.message) return error.message;
      try { return JSON.stringify(error); } catch { return String(error); }
    }

    function isTokenError(message) {
      const lower = String(message || '').toLowerCase();
      return APP.tokenErrorPatterns.some(pattern => lower.includes(pattern));
    }

    function stripAiWrapper(text) {
      return String(text || '')
        .replace(/^```(?:text|md|markdown)?/i, '')
        .replace(/```$/i, '')
        .replace(/^\s*["“”']|["“”']\s*$/g, '')
        .trim();
    }

    function extractResponseText(response) {
      if (typeof response === 'string') return response;
      const content = response?.choices?.[0]?.message?.content
        || response?.choices?.[0]?.delta?.content
        || response?.choices?.[0]?.text
        || response?.message?.content
        || response?.content
        || response?.text;
      if (Array.isArray(content)) {
        return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
      }
      return content || 'Không có phản hồi từ AI.';
    }

    function parseLinks(raw) {
      const chunks = String(raw || '')
        .split(/[\n,\s]+/)
        .map(item => item.trim())
        .filter(Boolean);

      const unique = [];
      const invalid = [];
      const seen = new Set();

      for (const item of chunks) {
        try {
          const url = new URL(item);
          if (!/^https?:$/.test(url.protocol)) throw new Error('Invalid protocol');
          const clean = url.toString();
          if (!seen.has(clean)) {
            seen.add(clean);
            unique.push(clean);
          }
        } catch {
          invalid.push(item);
        }
      }
      return { valid: unique, invalid };
    }

    function randomFrom(array) {
      return array[Math.floor(Math.random() * array.length)] || '';
    }

    const SHOPEE_MAX_LINKS_PER_BATCH = 5;

    function firstFrom(array) {
      return array[0] || '';
    }

    function sanitizeShopeeTargetCount(value) {
      const n = Math.floor(Number(value));
      return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 5;
    }

    function isShopeeLink(link) {
      return /^https?:\/\//i.test(String(link || ''))
        && /(shopee\.vn|s\.shopee\.vn|shopee?\.ee|shp\.ee)/i.test(String(link || ''));
    }

    function cleanUrlText(url) {
      return String(url || '').trim().replace(/[),.;\]}>\"'“”]+$/g, '');
    }

    function normalizeUrlKey(url) {
      const clean = cleanUrlText(url);
      if (!clean) return '';
      try {
        const parsed = new URL(clean);
        parsed.hash = '';
        parsed.search = '';
        return parsed.toString().replace(/\/+$/, '').toLowerCase();
      } catch {
        return clean.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
      }
    }

    function extractUrlsFromText(text) {
      const matches = String(text || '').match(/https?:\/\/[^\s<>\"'“”]+/gi) || [];
      return uniqueUrlList(matches.map(cleanUrlText));
    }

    function extractShopeeLinksFromText(text) {
      return extractUrlsFromText(text).filter(isShopeeLink);
    }

    function uniqueUrlList(links) {
      const out = [];
      const seen = new Set();
      for (const link of links || []) {
        const clean = String(link || '').trim();
        if (!clean) continue;
        const key = normalizeUrlKey(clean);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
      }
      return out;
    }

    function buildShopeeBatchLinks(sourceLinks, batchSize, startIndex) {
      const batch = [];
      for (let i = 0; i < batchSize; i += 1) {
        batch.push(sourceLinks[(startIndex + i) % sourceLinks.length]);
      }
      return batch;
    }

    function setProductLinks(links) {
      els.productLinkInput.value = uniqueUrlList(links).join('\n');
      els.productLinkInput.dispatchEvent(new Event('input', { bubbles: true }));
      updateCounters();
      saveDraft();
    }

    function exactUrlKey(url) {
      return cleanUrlText(url);
    }

    function uniqueExactUrlList(links) {
      const out = [];
      const seen = new Set();
      for (const link of links || []) {
        const key = exactUrlKey(link);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
      }
      return out;
    }

    function removeProductLinksExact(usedLinks, currentLinks = null) {
      const usedKeys = new Set(uniqueExactUrlList(usedLinks));
      const links = uniqueUrlList(currentLinks || parseLinks(els.productLinkInput.value).valid);
      if (!usedKeys.size) return { remaining: links, removed: [] };

      const removed = [];
      const remaining = [];
      for (const link of links) {
        if (usedKeys.has(exactUrlKey(link))) removed.push(link);
        else remaining.push(link);
      }

      if (removed.length) setProductLinks(remaining);
      return { remaining, removed };
    }

    function removeProductLinksMatchingUrls(usedLinks, currentLinks = null) {
      const usedKeys = new Set(uniqueUrlList(usedLinks).map(normalizeUrlKey).filter(Boolean));
      const links = uniqueUrlList(currentLinks || parseLinks(els.productLinkInput.value).valid);
      if (!usedKeys.size) return { remaining: links, removed: [] };

      const removed = [];
      const remaining = [];
      for (const link of links) {
        if (usedKeys.has(normalizeUrlKey(link))) removed.push(link);
        else remaining.push(link);
      }

      if (removed.length) setProductLinks(remaining);
      return { remaining, removed };
    }

    async function refillShopeeLinksIfNeeded(seedLinks, reason = '') {
      if (state.shopeeGenerating) return [];

      const targetCount = sanitizeShopeeTargetCount(els.shopeeTargetCountInput?.value || 5);
      const sourceLinks = uniqueUrlList(seedLinks).filter(isShopeeLink);
      if (!sourceLinks.length) {
        if (reason) toast('Danh sách sắp hết nhưng không còn link Shopee hợp lệ để tạo thêm.', 'warning');
        return [];
      }

      const API = window.fbBridgeApi;
      if (!API?.sendBridge) {
        toast('Chưa nạp bridge extension nên chưa thể tự tạo link Shopee.', 'warning');
        return [];
      }

      state.shopeeGenerating = true;
      const results = [];
      let cursor = 0;
      let attempt = 0;
      const minBatches = Math.ceil(targetCount / SHOPEE_MAX_LINKS_PER_BATCH);
      const maxAttempts = minBatches + 10;

      try {
        toast(`Danh sách link sắp hết, đang tự tạo ${targetCount} link Shopee mới...`, 'warning');

        while (results.length < targetCount && attempt < maxAttempts) {
          attempt += 1;
          const remaining = targetCount - results.length;
          const batchSize = Math.min(SHOPEE_MAX_LINKS_PER_BATCH, remaining);
          const batchLinks = buildShopeeBatchLinks(sourceLinks, batchSize, cursor);
          cursor += batchSize;

          const response = await API.sendBridge(
            ['GENERATE_SHOPEE_CUSTOM_LINKS', 'GENERATE_SHOPEE_AFFILIATE_LINKS', 'SHOPEE_CUSTOM_LINKS'],
            {
              links: batchLinks,
              targetCount: batchSize,
              runInBackground: true,
              closeTabAfter: true
            }
          );

          const newLinks = uniqueUrlList(API.extractLinksFromResponse(response)).filter(Boolean);
          if (!newLinks.length) throw new Error(`Lượt ${attempt} không lấy được link nào từ Shopee.`);
          results.push(...newLinks);
          setProductLinks(results.slice(0, targetCount));
        }

        const finalLinks = uniqueUrlList(results).slice(0, targetCount);
        if (!finalLinks.length) return [];
        setProductLinks(finalLinks);
        toast(`Đã tự tạo ${finalLinks.length}/${targetCount} link Shopee mới.`);
        return finalLinks;
      } catch (error) {
        toast('Tự tạo link Shopee lỗi: ' + getErrorText(error), 'warning');
        return [];
      } finally {
        state.shopeeGenerating = false;
      }
    }

    function updateCounters() {
      els.articleCounter.textContent = `${els.articleInput.value.length}/6000`;
      els.productCounter.textContent = `${els.productNameInput.value.length}/160`;
      if (els.shopeeTargetCountInput) els.shopeeTargetCountInput.value = String(sanitizeShopeeTargetCount(els.shopeeTargetCountInput.value || 5));

      const { valid, invalid } = parseLinks(els.productLinkInput.value);
      els.linkCounter.textContent = `${valid.length} link`;
      els.validLinkStat.textContent = String(valid.length);

      if (!els.productLinkInput.value.trim()) {
        els.linkStatus.textContent = 'Chưa có link sản phẩm';
        els.linkStatus.className = 'link-preview';
      } else if (invalid.length) {
        els.linkStatus.textContent = `Có ${invalid.length} link chưa hợp lệ, hệ thống sẽ bỏ qua`;
        els.linkStatus.className = 'link-preview warn';
      } else {
        els.linkStatus.textContent = 'Tất cả link đều hợp lệ';
        els.linkStatus.className = 'link-preview ok';
      }
    }

    function updateStats() {
      els.leftTplStat.textContent = String(state.managers.left?.items.length || 0);
      els.rightTplStat.textContent = String(state.managers.right?.items.length || 0);
      els.historyStat.textContent = String(loadStorage(APP.storage.history, []).length);
      updateCounters();
    }

    function updateAuthUI() {
      const endpoint = getApiEndpoint();
      const model = getApiModel();
      const apiKey = getApiKey();

      if (els.authAvatar) els.authAvatar.textContent = apiKey ? '✅' : '🔌';
      if (!els.authStatus) return;

      if (!apiKey) {
        els.authStatus.textContent = '⚠️ Chưa nhập API key ChatGPT';
        els.authStatus.className = 'auth-status';
        els.authUsername?.classList.add('hidden');
        return;
      }

      els.authStatus.textContent = '✅ Đã sẵn sàng gọi API ChatGPT';
      els.authStatus.className = 'auth-status ok';
      if (els.authUsername) {
        els.authUsername.textContent = `${model} • ${endpoint}`;
        els.authUsername.classList.remove('hidden');
      }
    }

    async function callChatCompletion(prompt) {
      const endpoint = getApiEndpoint();
      const model = getApiModel();
      const apiKey = getApiKey();

      if (!apiKey) throw new Error('Chưa nhập API key ChatGPT.');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'user', content: prompt }
            ]
          }),
          signal: controller.signal
        });

        const rawText = await response.text();
        let data = null;
        try { data = rawText ? JSON.parse(rawText) : null; } catch { data = null; }

        if (!response.ok) {
          const message = data?.error?.message
            || data?.message
            || rawText
            || `HTTP ${response.status}`;
          throw new Error(message);
        }

        return data || rawText;
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('API phản hồi quá lâu, đã tự huỷ sau 60 giây.');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    function isNextResult(text) {
      return /^\(?\s*next\s*\)?$/i.test(String(text || '').trim());
    }

    function buildArticleIntentPrompt({ article }) {
      return `Bạn là bộ phân loại bài viết Facebook trước khi tạo bình luận.

Nhiệm vụ: Đọc nội dung bài viết và quyết định có nên tạo bình luận bán hàng hay bỏ qua.

Quy tắc phân loại:
1. Nếu người đăng là người bán, người cho thuê, chủ shop, môi giới, đại lý, đăng thanh lý, đăng báo giá, đăng sẵn hàng, tuyển khách, quảng cáo dịch vụ/sản phẩm, để SĐT/Zalo/IB chốt đơn, hoặc nội dung có ý định bán/cho thuê/cung cấp hàng hóa/dịch vụ thì trả về đúng: (next)
2. Nếu bài viết là người cần mua, cần thuê, tìm mua, tìm phòng, hỏi nơi bán, hỏi tư vấn, xin gợi ý, tán ngẫu, chia sẻ vấn đề, hỏi kinh nghiệm, hoặc nội dung không phải bài người bán thì trả về đúng: comment
3. Chỉ trả về một trong hai kết quả: (next) hoặc comment
4. Không giải thích, không thêm ký tự khác.

Nội dung bài viết:
"""
${article}
"""`;
    }

    async function classifyArticleIntent(article) {
      const prompt = buildArticleIntentPrompt({ article });
      const response = await callChatCompletion(prompt);
      const result = stripAiWrapper(extractResponseText(response)).toLowerCase();
      return isNextResult(result) ? 'next' : 'comment';
    }

    function buildPrompt({ article, productName, selectedLink, selectedTone }) {
      const linkInstruction = selectedLink
        ? `- Link sản phẩm được phép dùng: ${selectedLink}`
        : '- Không có link sản phẩm, không được tự bịa link';

      return `Bạn là chuyên gia Social Content và Affiliate Marketing có kinh nghiệm viết bình luận Facebook tự nhiên.

Nhiệm vụ: Viết duy nhất 1 bình luận tiếng Việt dựa trên bài viết gốc và sản phẩm được cung cấp.

Dữ liệu:
- Nội dung bài viết gốc: "${article}"
- Tên sản phẩm: "${productName || 'Sản phẩm'}"
${linkInstruction}
- Phong cách yêu cầu: ${selectedTone}

Quy tắc bắt buộc:
1. Chỉ viết khi bài viết không phải của người bán/cho thuê/cung cấp dịch vụ. Nếu phát hiện bài người bán thì trả về đúng: (next)
2. Đọc bài viết trước, chọn 1 chi tiết/cảm xúc chính để mở đầu bằng 1 câu đồng cảm thật tự nhiên.
3. Nếu sản phẩm liên quan trực tiếp đến bài viết, lồng ghép như một gợi ý hữu ích.
4. Nếu sản phẩm không liên quan trực tiếp, chuyển ý nhẹ bằng cụm như "À tiện thể", "Sẵn tiện", "Nhân đây".
5. Không phóng đại công dụng, không cam kết chắc chắn, không giả vờ đã mua nếu dữ liệu không nói vậy.
6. Không spam, không hashtag, không viết hoa toàn bộ, không dùng quá 1 emoji.
7. Tổng 2-4 câu. Mỗi câu nên dưới 20 từ. Ngôn ngữ giống người thật bình luận.
8. Nếu có link, để URL trần ở cuối hoặc gần cuối, không dùng markdown, không đặt trong ngoặc kép.
9. Câu cuối không có dấu chấm.

Chỉ trả về nội dung bình luận hoặc đúng (next), không thêm tiêu đề, không giải thích.`;
    }

    async function generateComment() {
      const article = els.articleInput.value.trim();
      const productName = els.productNameInput.value.trim();
      const selectedTone = els.toneSelect.value;
      const { invalid } = parseLinks(els.productLinkInput.value);
      let selectedLink = '';
      let refillPromise = Promise.resolve([]);

      if (!article) {
        toast('Vui lòng dán nội dung bài viết gốc.', 'warning');
        els.articleInput.focus();
        return;
      }
      if (invalid.length) {
        toast(`Đã bỏ qua ${invalid.length} link chưa hợp lệ.`, 'warning');
      }

      if (!hasApiKey()) {
        toast('Vui lòng nhập API key ChatGPT trước khi tạo bình luận.', 'warning');
        els.chatApiKeyInput?.focus();
        updateAuthUI();
        return;
      }

      els.generateBtn.disabled = true;
      els.generateBtn.textContent = '⏳ Đang xử lý...';
      els.tokenBanner.classList.remove('show');
      setOutput('Đang gửi bài viết cho AI phân loại trước...', 'loading');

      try {
        const articleIntent = await classifyArticleIntent(article);
        if (articleIntent === 'next') {
          setOutput('(next)');
          toast('AI xác định đây là bài người bán/cho thuê, đã bỏ qua tạo comment.', 'warning');
          return '(next)';
        }

        setOutput('Bài phù hợp để trả lời. Đang tạo bình luận...', 'loading');
        const latestLinks = parseLinks(els.productLinkInput.value).valid;
        selectedLink = firstFrom(latestLinks);
        refillPromise = selectedLink && latestLinks.length <= 1
          ? refillShopeeLinksIfNeeded([selectedLink], 'low_links')
          : Promise.resolve([]);

        const prompt = buildPrompt({ article, productName, selectedLink, selectedTone });
        const response = await callChatCompletion(prompt);
        const result = stripAiWrapper(extractResponseText(response));
        await refillPromise;

        if (isNextResult(result)) {
          setOutput('(next)');
          toast('AI trả về (next), đã bỏ qua bình luận bài này.', 'warning');
          return '(next)';
        }

        const resultShopeeLinks = extractShopeeLinksFromText(result);
        let afterAiRemove = selectedLink && result
          ? removeProductLinksExact([selectedLink])
          : { remaining: parseLinks(els.productLinkInput.value).valid, removed: [] };

        if (!afterAiRemove.removed.length && resultShopeeLinks.length) {
          afterAiRemove = removeProductLinksExact(resultShopeeLinks);
        }
        if (!afterAiRemove.removed.length && resultShopeeLinks.length) {
          afterAiRemove = removeProductLinksMatchingUrls(resultShopeeLinks);
        }
        if (afterAiRemove.removed.length) {
          toast(`Đã xoá ${afterAiRemove.removed.length} link Shopee đã dùng trong kết quả API.`);
        }

        const currentLinksAfterAi = parseLinks(els.productLinkInput.value).valid;
        if (selectedLink && currentLinksAfterAi.length <= 1) {
          const seedLinks = currentLinksAfterAi.length ? currentLinksAfterAi : [selectedLink];
          await refillShopeeLinksIfNeeded(seedLinks, 'ai_result_low_links');
        }

        setOutput(result || 'Không có phản hồi từ AI.', result ? '' : 'error');

        if (result) {
          const copied = await copyText(els.output.textContent, { silent: true });
          if (els.copyBtn) {
            const oldCopyText = els.copyBtn.textContent;
            if (copied) {
              els.copyBtn.textContent = '✔️ Đã tự copy';
              toast('Đã tạo xong và tự động copy kết quả');
              setTimeout(() => { els.copyBtn.textContent = oldCopyText; }, 2500);
            } else {
              els.copyBtn.textContent = 'Copy thủ công';
              toast('Trình duyệt chặn tự động copy. Có thể bôi đen kết quả để copy thủ công.', 'warning');
              setTimeout(() => { els.copyBtn.textContent = oldCopyText; }, 3000);
            }
          } else if (copied) {
            toast('Đã tạo xong và tự động copy kết quả');
          } else {
            toast('Đã tạo xong. Có thể bôi đen kết quả để copy thủ công.', 'warning');
          }
        }
        return result;
      } catch (error) {
        try { await refillPromise; } catch {}
        const errText = getErrorText(error);
        if (isTokenError(errText)) {
          setOutput('⚠️ API ChatGPT hiện tại có thể đã hết quota hoặc bị giới hạn. Hãy kiểm tra API key, model hoặc thử lại sau.', 'error');
          els.tokenBanner.classList.add('show');
        } else if (/sign|auth|unauthorized|401/i.test(errText)) {
          setOutput('🔑 API key không hợp lệ hoặc không có quyền gọi model này.', 'error');
          updateAuthUI();
        } else {
          setOutput('❌ Lỗi: ' + errText, 'error');
        }
      } finally {
        els.generateBtn.disabled = false;
        els.generateBtn.textContent = '✨ Tạo bình luận';
      }
    }

    async function copyText(text, options = {}) {
      const value = String(text || '').trim();
      if (!value) return false;

      try {
        await navigator.clipboard.writeText(value);
        if (!options.silent) toast('Đã sao chép vào clipboard');
        return true;
      } catch {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
        if (!options.silent) toast(ok ? 'Đã sao chép vào clipboard' : 'Trình duyệt chặn sao chép tự động.', ok ? 'success' : 'warning');
        return ok;
      }
    }

    function clearForm() {
      els.articleInput.value = '';
      els.productNameInput.value = '';
      els.productLinkInput.value = '';
      if (els.shopeeTargetCountInput) els.shopeeTargetCountInput.value = '5';
      els.toneSelect.selectedIndex = 0;
      setOutput('Bình luận sẽ xuất hiện tại đây...', 'placeholder');
      els.tokenBanner.classList.remove('show');
      $$('.tpl-item').forEach(item => item.classList.remove('active'));
      state.selectedTemplateKey = null;
      saveDraft();
      updateCounters();
      toast('Đã làm mới form');
    }

    async function pasteArticle() {
      try {
        const text = await navigator.clipboard.readText();
        els.articleInput.value = text;
        saveDraft();
        updateCounters();
        toast('Đã dán nội dung');
      } catch {
        toast('Trình duyệt chặn clipboard. Hãy dán thủ công bằng Ctrl+V.', 'warning');
      }
    }

    function saveHistory() {
      const comment = els.output.textContent.trim();
      if (!comment || els.output.classList.contains('placeholder') || els.output.classList.contains('loading')) {
        toast('Chưa có bình luận hợp lệ để lưu.', 'warning');
        return;
      }

      const history = loadStorage(APP.storage.history, []);
      history.unshift({
        comment,
        product: els.productNameInput.value.trim(),
        createdAt: new Date().toISOString()
      });
      saveStorage(APP.storage.history, history.slice(0, 50));
      updateStats();
      toast('Đã lưu bình luận vào lịch sử');
    }

    function saveDraft() {
      const shopeeTargetCount = sanitizeShopeeTargetCount(els.shopeeTargetCountInput?.value || 5);
      saveStorage(APP.storage.shopeeTargetCount, shopeeTargetCount);
      saveStorage(APP.storage.draft, {
        article: els.articleInput.value,
        productName: els.productNameInput.value,
        productLinks: els.productLinkInput.value,
        shopeeTargetCount,
        tone: els.toneSelect.value
      });
    }

    function restoreDraft() {
      const draft = loadStorage(APP.storage.draft, null);
      if (!draft) return;
      els.articleInput.value = draft.article || '';
      els.productNameInput.value = draft.productName || '';
      els.productLinkInput.value = draft.productLinks || '';
      if (els.shopeeTargetCountInput) els.shopeeTargetCountInput.value = String(sanitizeShopeeTargetCount(draft.shopeeTargetCount || loadStorage(APP.storage.shopeeTargetCount, 5)));
      if (draft.tone) els.toneSelect.value = draft.tone;
    }

    function openModal(modal) {
      if (!modal) return;
      modal.classList.add('show');
      document.body.style.overflow = 'hidden';
    }

    function closeModal(modal) {
      if (!modal) return;
      modal.classList.remove('show');
      if (!$$('.modal-overlay.show').length) document.body.style.overflow = '';
    }

    function createTemplateManager({ key, listEl, storageKey, label }) {
      const manager = {
        key,
        label,
        listEl,
        storageKey,
        items: loadStorage(storageKey, []),

        save() {
          saveStorage(storageKey, this.items);
          updateStats();
        },

        render() {
          listEl.replaceChildren();

          if (!this.items.length) {
            const empty = document.createElement('div');
            empty.className = 'tpl-empty';
            empty.textContent = 'Chưa có mẫu nào. Nhấn “+ Thêm” để tạo mẫu sản phẩm.';
            listEl.appendChild(empty);
            updateStats();
            return;
          }

          this.items.forEach((tpl, index) => {
            const item = document.createElement('article');
            item.className = 'tpl-item';
            if (state.selectedTemplateKey === `${key}:${index}`) item.classList.add('active');
            item.dataset.index = String(index);
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', `Áp dụng mẫu ${tpl.name}`);

            const icon = document.createElement('div');
            icon.className = 'tpl-icon';
            icon.textContent = '📦';

            const info = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'tpl-name';
            name.textContent = tpl.name || 'Chưa đặt tên';
            const meta = document.createElement('div');
            meta.className = 'tpl-meta';
            const linkCount = parseLinks(tpl.links || '').valid.length;
            meta.textContent = `${tpl.product || 'Chưa có sản phẩm'} • ${linkCount} link`;
            info.append(name, meta);

            const actions = document.createElement('div');
            actions.className = 'tpl-actions';
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'btn btn-soft btn-icon';
            edit.textContent = '✏️';
            edit.title = 'Sửa mẫu';
            edit.dataset.action = 'edit';

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'btn btn-danger btn-icon';
            del.textContent = '🗑️';
            del.title = 'Xoá mẫu';
            del.dataset.action = 'delete';

            actions.append(edit, del);
            item.append(icon, info, actions);
            listEl.appendChild(item);
          });
          updateStats();
        },

        apply(index) {
          const tpl = this.items[index];
          if (!tpl) return;
          els.productNameInput.value = tpl.product || '';
          els.productLinkInput.value = tpl.links || '';
          state.selectedTemplateKey = `${key}:${index}`;
          Object.values(state.managers).forEach(mgr => mgr.render());
          updateCounters();
          saveDraft();
          els.productNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          toast(`Đã áp dụng mẫu: ${tpl.name}`);
        },

        openAdd() {
          state.activeManager = this;
          state.editingIndex = -1;
          els.modalTitle.textContent = `Thêm mẫu mới — ${label}`;
          els.tplNameInput.value = '';
          els.tplProductInput.value = '';
          els.tplLinksInput.value = '';
          openModal(els.templateModal);
          requestAnimationFrame(() => els.tplNameInput.focus());
        },

        openEdit(index) {
          const tpl = this.items[index];
          if (!tpl) return;
          state.activeManager = this;
          state.editingIndex = index;
          els.modalTitle.textContent = `Sửa mẫu — ${label}`;
          els.tplNameInput.value = tpl.name || '';
          els.tplProductInput.value = tpl.product || '';
          els.tplLinksInput.value = tpl.links || '';
          openModal(els.templateModal);
          requestAnimationFrame(() => els.tplNameInput.focus());
        },

        delete(index) {
          const tpl = this.items[index];
          if (!tpl) return;
          if (!confirm(`Xoá mẫu "${tpl.name}"?`)) return;
          this.items.splice(index, 1);
          if (state.selectedTemplateKey === `${key}:${index}`) state.selectedTemplateKey = null;
          this.save();
          this.render();
          toast('Đã xoá mẫu');
        }
      };

      listEl.addEventListener('click', (event) => {
        const item = event.target.closest('.tpl-item');
        if (!item) return;
        const index = Number(item.dataset.index);
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'edit') return manager.openEdit(index);
        if (action === 'delete') return manager.delete(index);
        manager.apply(index);
      });

      listEl.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const item = event.target.closest('.tpl-item');
        if (!item) return;
        event.preventDefault();
        manager.apply(Number(item.dataset.index));
      });

      manager.render();
      return manager;
    }

    function saveTemplateFromModal() {
      const manager = state.activeManager;
      if (!manager) return;

      const name = els.tplNameInput.value.trim();
      const product = els.tplProductInput.value.trim();
      const links = els.tplLinksInput.value.trim();

      if (!name) {
        toast('Vui lòng nhập tên mẫu.', 'warning');
        els.tplNameInput.focus();
        return;
      }
      if (!product) {
        toast('Vui lòng nhập tên sản phẩm.', 'warning');
        els.tplProductInput.focus();
        return;
      }

      const parsed = parseLinks(links);
      if (links && !parsed.valid.length) {
        toast('Danh sách link chưa có URL hợp lệ.', 'warning');
        els.tplLinksInput.focus();
        return;
      }

      const payload = {
        name,
        product,
        links: parsed.valid.join('\n') || links,
        updatedAt: new Date().toISOString()
      };

      if (state.editingIndex >= 0) manager.items[state.editingIndex] = payload;
      else manager.items.push(payload);

      manager.save();
      manager.render();
      closeModal(els.templateModal);
      toast('Đã lưu mẫu sản phẩm');
    }

    function wireEvents() {
      [els.chatApiEndpointInput, els.chatApiKeyInput, els.chatApiModelInput].filter(Boolean).forEach(input => {
        input.addEventListener('input', () => {
          getApiEndpoint();
          getApiModel();
          getApiKey();
          updateAuthUI();
        });
        input.addEventListener('change', updateAuthUI);
      });

      els.generateBtn.addEventListener('click', generateComment);
      els.clearBtn?.addEventListener('click', clearForm);
      els.pasteBtn.addEventListener('click', pasteArticle);
      els.copyBtn?.addEventListener('click', () => copyText(els.output.textContent));
      els.saveHistoryBtn?.addEventListener('click', saveHistory);
      els.btnSaveTpl.addEventListener('click', saveTemplateFromModal);
      els.btnCancelTpl.addEventListener('click', () => closeModal(els.templateModal));
      $('#btnAddTplLeft').addEventListener('click', () => state.managers.left.openAdd());
      $('#btnAddTpl').addEventListener('click', () => state.managers.right.openAdd());

      [els.articleInput, els.productNameInput, els.productLinkInput, els.shopeeTargetCountInput, els.toneSelect].filter(Boolean).forEach(input => {
        input.addEventListener('input', () => {
          updateCounters();
          saveDraft();
        });
        input.addEventListener('change', saveDraft);
      });

      [els.templateModal].filter(Boolean).forEach(modal => {
        modal.addEventListener('click', event => {
          if (event.target === modal) closeModal(modal);
        });
      });

      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          [els.templateModal].filter(Boolean).forEach(closeModal);
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          generateComment();
        }
      });
    }

    async function init() {
      state.managers.left = createTemplateManager({
        key: 'left',
        listEl: $('#tplListLeft'),
        storageKey: APP.storage.leftTemplates,
        label: 'Kho mẫu trái'
      });
      state.managers.right = createTemplateManager({
        key: 'right',
        listEl: $('#tplList'),
        storageKey: APP.storage.rightTemplates,
        label: 'Kho mẫu phải'
      });

      restoreApiSettings();
      restoreDraft();
      wireEvents();
      updateStats();
      updateAuthUI();
    }


    window.chatGPTApiController = {
      generateComment,
      callChatCompletion,
      classifyArticleIntent,
      isNextResult,
      updateAuthUI,
      copyText,
      refillShopeeLinksIfNeeded
    };

    window.addEventListener('DOMContentLoaded', init);
