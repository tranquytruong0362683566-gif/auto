(function () {
  'use strict';

  const CONFIG = window.AutoVipCampaignConfig;
  if (!CONFIG) throw new Error('Chưa nạp campaign-config.js.');

  const APP = Object.freeze({
    apiEndpoint: 'https://console.flatkey.ai/v1/chat/completions',
    model: 'gpt-4.1-mini',
    maxImageBytes: 8 * 1024 * 1024,
    manualImageKey: '__autovip_active_manual_image__',
    imageDbName: 'truong_autovip_campaign_images_v1',
    imageStoreName: 'images',
    storage: Object.freeze({
      templates: 'truong_ai_commenter_campaign_templates_v3',
      migrationDone: 'truong_ai_commenter_campaign_templates_migrated_v3',
      leftTemplates: 'truong_ai_commenter_templates_left_v2',
      rightTemplates: 'truong_ai_commenter_templates_right_v2',
      history: 'truong_ai_commenter_history_v2',
      draft: 'truong_ai_commenter_campaign_draft_v3',
      oldDraft: 'truong_ai_commenter_draft_v2',
      promptProfiles: 'truong_ai_commenter_campaign_prompt_profiles_v1',
      shopeeTargetCount: 'truong_ai_commenter_shopee_target_count_v1',
      apiEndpoint: 'truong_chatgpt_api_endpoint_v1',
      apiKey: 'truong_chatgpt_api_key_v1',
      apiModel: 'truong_chatgpt_api_model_v1'
    }),
    tokenErrorPatterns: Object.freeze([
      'quota', 'rate limit', 'rate_limit', 'insufficient', 'limit exceeded',
      'token', 'credits', 'billing', 'usage', '429', 'too many requests',
      'hết', 'vượt quá', 'giới hạn', 'credit'
    ])
  });

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  const els = {
    authStatus: $('#authStatus'),
    authUsername: $('#authUsername'),
    authAvatar: $('#authAvatar'),
    tokenBanner: $('#tokenBanner'),
    chatApiEndpointInput: $('#chatApiEndpointInput'),
    chatApiKeyInput: $('#chatApiKeyInput'),
    chatApiKeyToggle: $('#chatApiKeyToggle'),
    chatApiModelInput: $('#chatApiModelInput'),
    articleInput: $('#articleInput'),
    articleIntentHint: $('#articleIntentHint'),
    campaignTypeSelect: $('#campaignTypeSelect'),
    campaignSubjectLabel: $('#campaignSubjectLabel'),
    campaignSubjectHint: $('#campaignSubjectHint'),
    productNameInput: $('#productNameInput'),
    campaignDetailsLabel: $('#campaignDetailsLabel'),
    campaignDetailsInput: $('#campaignDetailsInput'),
    campaignDetailsCounter: $('#campaignDetailsCounter'),
    campaignContactLabel: $('#campaignContactLabel'),
    campaignContactInput: $('#campaignContactInput'),
    campaignLinkLabel: $('#campaignLinkLabel'),
    productLinkInput: $('#productLinkInput'),
    shopeeTargetCountWrap: $('#shopeeTargetCountWrap'),
    shopeeTargetCountInput: $('#shopeeTargetCountInput'),
    toneSelect: $('#toneSelect'),
    classificationPromptInput: $('#classificationPromptInput'),
    replyPromptInput: $('#replyPromptInput'),
    resetCampaignPromptsBtn: $('#resetCampaignPromptsBtn'),
    campaignImageInput: $('#campaignImageInput'),
    campaignImagePreview: $('#campaignImagePreview'),
    campaignImageRequiredInput: $('#campaignImageRequiredInput'),
    campaignImageStatus: $('#campaignImageStatus'),
    removeCampaignImageBtn: $('#removeCampaignImageBtn'),
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
    historyStat: $('#historyStat'),
    templateCountStat: $('#templateCountStat'),
    templateCategoryTitle: $('#templateCategoryTitle'),
    templateCategoryTabs: $('#templateCategoryTabs'),
    campaignTemplateList: $('#campaignTemplateList'),
    btnAddTemplate: $('#btnAddTemplate'),
    templateModal: $('#templateModal'),
    modalTitle: $('#modalTitle'),
    tplCategorySelect: $('#tplCategorySelect'),
    tplNameInput: $('#tplNameInput'),
    tplSubjectLabel: $('#tplSubjectLabel'),
    tplProductInput: $('#tplProductInput'),
    tplDetailsLabel: $('#tplDetailsLabel'),
    tplDetailsInput: $('#tplDetailsInput'),
    tplContactLabel: $('#tplContactLabel'),
    tplContactInput: $('#tplContactInput'),
    tplLinksLabel: $('#tplLinksLabel'),
    tplLinksInput: $('#tplLinksInput'),
    tplImageInput: $('#tplImageInput'),
    tplImagePreview: $('#tplImagePreview'),
    tplImageRequiredInput: $('#tplImageRequiredInput'),
    removeTplImageBtn: $('#removeTplImageBtn'),
    tplClassifierPromptInput: $('#tplClassifierPromptInput'),
    tplReplyPromptInput: $('#tplReplyPromptInput'),
    resetTplPromptsBtn: $('#resetTplPromptsBtn'),
    btnSaveTpl: $('#btnSaveTpl'),
    btnCancelTpl: $('#btnCancelTpl'),
    toastHost: $('#toastHost')
  };

  const state = {
    templates: [],
    activeCategoryFilter: 'all',
    editingTemplateId: null,
    selectedTemplateId: null,
    activeImageKey: null,
    modalImageFile: null,
    modalImageRemoved: false,
    shopeeGenerating: false,
    imageDbPromise: null,
    previewUrls: new WeakMap(),
    templatePreviewUrls: new Set(),
    previewRequestId: 0
  };

  function safeJsonParse(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function loadStorage(key, fallback) {
    return safeJsonParse(localStorage.getItem(key), fallback);
  }

  function saveStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'tpl-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function toast(message, type) {
    if (!els.toastHost) return;
    const item = document.createElement('div');
    item.className = 'toast ' + (type || 'success');
    item.textContent = String(message || '');
    els.toastHost.appendChild(item);
    setTimeout(() => item.remove(), 3600);
  }

  function setOutput(message, className) {
    if (!els.output) return;
    els.output.textContent = String(message || '');
    els.output.className = className || '';
  }

  function getCategory(categoryId) {
    return CONFIG.getCategory(categoryId);
  }

  function getCampaignCategoryId() {
    const raw = text(els.campaignTypeSelect && els.campaignTypeSelect.value);
    return CONFIG.categories[raw] ? raw : 'sales';
  }

  function normalizeEndpoint(endpoint) {
    return String(endpoint || APP.apiEndpoint).trim().replace(/\/+$/, '');
  }

  function getApiEndpoint() {
    const value = normalizeEndpoint((els.chatApiEndpointInput && els.chatApiEndpointInput.value) || loadStorage(APP.storage.apiEndpoint, APP.apiEndpoint));
    if (els.chatApiEndpointInput && els.chatApiEndpointInput.value !== value) els.chatApiEndpointInput.value = value;
    saveStorage(APP.storage.apiEndpoint, value);
    return value;
  }

  function getApiModel() {
    const allowedModels = new Set(['gpt-4.1-mini', 'gpt-5.4-mini', 'gpt-5-mini']);
    const storedValue = text(loadStorage(APP.storage.apiModel, APP.model)) || APP.model;
    const selectedValue = text((els.chatApiModelInput && els.chatApiModelInput.value) || storedValue) || APP.model;
    const value = allowedModels.has(selectedValue) ? selectedValue : APP.model;
    if (els.chatApiModelInput && els.chatApiModelInput.value !== value) els.chatApiModelInput.value = value;
    saveStorage(APP.storage.apiModel, value);
    return value;
  }

  function getApiKey() {
    const raw = els.chatApiKeyInput ? els.chatApiKeyInput.value : loadStorage(APP.storage.apiKey, '');
    const value = text(raw);
    saveStorage(APP.storage.apiKey, value);
    return value;
  }

  function restoreApiSettings() {
    if (els.chatApiEndpointInput) els.chatApiEndpointInput.value = loadStorage(APP.storage.apiEndpoint, APP.apiEndpoint) || APP.apiEndpoint;
    if (els.chatApiModelInput) {
      const storedModel = text(loadStorage(APP.storage.apiModel, APP.model)) || APP.model;
      els.chatApiModelInput.value = ['gpt-4.1-mini', 'gpt-5.4-mini', 'gpt-5-mini'].includes(storedModel) ? storedModel : APP.model;
    }
    if (els.chatApiKeyInput) els.chatApiKeyInput.value = loadStorage(APP.storage.apiKey, '') || '';
  }

  function hasApiKey() {
    return Boolean(getApiKey());
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

  function stripAiWrapper(value) {
    return String(value || '')
      .replace(/^\x60{3}(?:text|md|markdown)?/i, '')
      .replace(/\x60{3}$/i, '')
      .replace(/^\s*["“”']|["“”']\s*$/g, '')
      .trim();
  }

  function extractResponseText(response) {
    if (typeof response === 'string') return response;
    const content = response && response.choices && response.choices[0] && (
      (response.choices[0].message && response.choices[0].message.content)
      || (response.choices[0].delta && response.choices[0].delta.content)
      || response.choices[0].text
    ) || (response && response.message && response.message.content)
      || (response && response.content)
      || (response && response.text);
    if (Array.isArray(content)) {
      return content.map(part => typeof part === 'string' ? part : (part && part.text) || '').join('');
    }
    return content || 'Không có phản hồi từ AI.';
  }

  function parseLinks(raw) {
    const chunks = String(raw || '').split(/[\n,\s]+/).map(item => item.trim()).filter(Boolean);
    const valid = [];
    const invalid = [];
    const seen = new Set();
    for (const item of chunks) {
      try {
        const url = new URL(item);
        if (!/^https?:$/.test(url.protocol)) throw new Error('Invalid protocol');
        const clean = url.toString();
        if (!seen.has(clean)) {
          seen.add(clean);
          valid.push(clean);
        }
      } catch {
        invalid.push(item);
      }
    }
    return { valid, invalid };
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

  function uniqueUrlList(links) {
    const result = [];
    const seen = new Set();
    for (const link of links || []) {
      const clean = text(link);
      const key = normalizeUrlKey(clean);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(clean);
    }
    return result;
  }

  function extractUrlsFromText(value) {
    const matches = String(value || '').match(/https?:\/\/[^\s<>\"'“”]+/gi) || [];
    return uniqueUrlList(matches.map(cleanUrlText));
  }

  function isShopeeLink(link) {
    return /^https?:\/\//i.test(String(link || ''))
      && /(shopee\.vn|s\.shopee\.vn|shopee?\.ee|shp\.ee)/i.test(String(link || ''));
  }

  function extractShopeeLinksFromText(value) {
    return extractUrlsFromText(value).filter(isShopeeLink);
  }

  function firstFrom(array) {
    return (array && array[0]) || '';
  }

  function sanitizeShopeeTargetCount(value) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? Math.min(number, 100) : 5;
  }

  function setProductLinks(links) {
    if (!els.productLinkInput) return;
    els.productLinkInput.value = uniqueUrlList(links).join('\n');
    els.productLinkInput.dispatchEvent(new Event('input', { bubbles: true }));
    updateCounters();
    saveDraft();
  }

  function removeProductLinksExact(usedLinks) {
    const used = new Set((usedLinks || []).map(cleanUrlText).filter(Boolean));
    const links = uniqueUrlList(parseLinks(els.productLinkInput && els.productLinkInput.value).valid);
    const removed = [];
    const remaining = [];
    for (const link of links) {
      if (used.has(cleanUrlText(link))) removed.push(link);
      else remaining.push(link);
    }
    if (removed.length) setProductLinks(remaining);
    return { remaining, removed };
  }

  function removeProductLinksMatchingUrls(usedLinks) {
    const used = new Set(uniqueUrlList(usedLinks).map(normalizeUrlKey).filter(Boolean));
    const links = uniqueUrlList(parseLinks(els.productLinkInput && els.productLinkInput.value).valid);
    const removed = [];
    const remaining = [];
    for (const link of links) {
      if (used.has(normalizeUrlKey(link))) removed.push(link);
      else remaining.push(link);
    }
    if (removed.length) setProductLinks(remaining);
    return { remaining, removed };
  }

  function buildShopeeBatchLinks(sourceLinks, batchSize, startIndex) {
    const batch = [];
    for (let index = 0; index < batchSize; index += 1) {
      batch.push(sourceLinks[(startIndex + index) % sourceLinks.length]);
    }
    return batch;
  }

  async function refillShopeeLinksIfNeeded(seedLinks, reason) {
    if (getCampaignCategoryId() !== 'sales' || state.shopeeGenerating) return [];
    const targetCount = sanitizeShopeeTargetCount((els.shopeeTargetCountInput && els.shopeeTargetCountInput.value) || 5);
    const sourceLinks = uniqueUrlList(seedLinks).filter(isShopeeLink);
    if (!sourceLinks.length) {
      if (reason) toast('Danh sách sắp hết nhưng không còn link Shopee hợp lệ để tạo thêm.', 'warning');
      return [];
    }
    const bridgeApi = window.fbBridgeApi;
    if (!bridgeApi || !bridgeApi.sendBridge) {
      toast('Chưa nạp bridge Extension nên chưa thể tự tạo link Shopee.', 'warning');
      return [];
    }

    state.shopeeGenerating = true;
    const results = [];
    let cursor = 0;
    let attempt = 0;
    const maxAttempts = Math.ceil(targetCount / 5) + 10;
    try {
      toast('Danh sách link sắp hết, đang tự tạo ' + targetCount + ' link Shopee mới...', 'warning');
      while (results.length < targetCount && attempt < maxAttempts) {
        attempt += 1;
        const batchSize = Math.min(5, targetCount - results.length);
        const response = await bridgeApi.sendBridge(
          ['GENERATE_SHOPEE_CUSTOM_LINKS', 'GENERATE_SHOPEE_AFFILIATE_LINKS', 'SHOPEE_CUSTOM_LINKS'],
          {
            links: buildShopeeBatchLinks(sourceLinks, batchSize, cursor),
            targetCount: batchSize,
            runInBackground: true,
            closeTabAfter: true
          }
        );
        cursor += batchSize;
        const generated = uniqueUrlList(bridgeApi.extractLinksFromResponse(response));
        if (!generated.length) throw new Error('Lượt ' + attempt + ' không lấy được link nào từ Shopee.');
        results.push.apply(results, generated);
        setProductLinks(results.slice(0, targetCount));
      }
      const finalLinks = uniqueUrlList(results).slice(0, targetCount);
      if (finalLinks.length) {
        setProductLinks(finalLinks);
        toast('Đã tự tạo ' + finalLinks.length + '/' + targetCount + ' link Shopee mới.');
      }
      return finalLinks;
    } catch (error) {
      toast('Tự tạo link Shopee lỗi: ' + getErrorText(error), 'warning');
      return [];
    } finally {
      state.shopeeGenerating = false;
    }
  }

  function openImageDb() {
    if (state.imageDbPromise) return state.imageDbPromise;
    state.imageDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(APP.imageDbName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(APP.imageStoreName)) {
          database.createObjectStore(APP.imageStoreName, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Không mở được kho ảnh IndexedDB.'));
    });
    return state.imageDbPromise;
  }

  async function runImageStore(mode, callback) {
    const database = await openImageDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(APP.imageStoreName, mode);
      const store = transaction.objectStore(APP.imageStoreName);
      let request;
      try {
        request = callback(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(request && request.result);
      transaction.onerror = () => reject(transaction.error || (request && request.error) || new Error('Lỗi truy cập kho ảnh.'));
      transaction.onabort = () => reject(transaction.error || new Error('Tác vụ kho ảnh đã bị hủy.'));
    });
  }

  async function getImageRecord(imageKey) {
    if (!imageKey) return null;
    const database = await openImageDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(APP.imageStoreName, 'readonly');
      const request = transaction.objectStore(APP.imageStoreName).get(imageKey);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Không đọc được ảnh.'));
    });
  }

  async function putImageRecord(imageKey, file) {
    validateImageFile(file);
    const record = {
      id: imageKey,
      blob: file,
      name: file.name || 'autovip-comment-image',
      type: file.type || 'image/jpeg',
      size: Number(file.size || 0),
      updatedAt: new Date().toISOString()
    };
    await runImageStore('readwrite', store => store.put(record));
    return record;
  }

  async function deleteImageRecord(imageKey) {
    if (!imageKey) return;
    await runImageStore('readwrite', store => store.delete(imageKey));
  }

  function validateImageFile(file) {
    if (!file) throw new Error('Chưa chọn ảnh.');
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(String(file.type || '').toLowerCase())) {
      throw new Error('Ảnh phải là JPG, PNG hoặc WebP.');
    }
    if (!file.size || file.size > APP.maxImageBytes) {
      throw new Error('Ảnh phải nhỏ hơn hoặc bằng 8 MB.');
    }
    return true;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Không chuyển được ảnh sang dữ liệu gửi.'));
      reader.readAsDataURL(blob);
    });
  }

  function clearPreviewUrl(container) {
    const previous = state.previewUrls.get(container);
    if (previous) URL.revokeObjectURL(previous);
    state.previewUrls.delete(container);
  }

  function renderImageRecord(container, record, placeholder) {
    if (!container) return;
    clearPreviewUrl(container);
    container.replaceChildren();
    if (!record || !record.blob) {
      const empty = document.createElement('span');
      empty.textContent = placeholder || 'Chưa có ảnh';
      container.appendChild(empty);
      return;
    }
    const url = URL.createObjectURL(record.blob);
    state.previewUrls.set(container, url);
    const image = document.createElement('img');
    image.src = url;
    image.alt = record.name || 'Ảnh bình luận';
    const caption = document.createElement('span');
    caption.className = 'image-preview-name';
    caption.textContent = (record.name || 'Ảnh bình luận') + ' • ' + formatBytes(record.size);
    container.append(image, caption);
  }

  function renderImageFile(container, file, placeholder) {
    if (!file) return renderImageRecord(container, null, placeholder);
    renderImageRecord(container, {
      blob: file,
      name: file.name,
      size: file.size,
      type: file.type
    }, placeholder);
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function renderActiveImagePreview() {
    const requestId = ++state.previewRequestId;
    if (!state.activeImageKey) {
      renderImageRecord(els.campaignImagePreview, null, 'Chưa chọn ảnh bình luận');
      if (els.removeCampaignImageBtn) els.removeCampaignImageBtn.classList.add('hidden');
      if (els.campaignImageStatus) els.campaignImageStatus.textContent = 'Bình luận hiện tại sẽ không gửi kèm ảnh.';
      return;
    }
    try {
      const record = await getImageRecord(state.activeImageKey);
      if (requestId !== state.previewRequestId) return;
      if (!record) {
        state.activeImageKey = null;
        renderImageRecord(els.campaignImagePreview, null, 'Không tìm thấy dữ liệu ảnh');
        if (els.removeCampaignImageBtn) els.removeCampaignImageBtn.classList.add('hidden');
        if (els.campaignImageStatus) els.campaignImageStatus.textContent = 'Ảnh đã chọn không còn trong bộ nhớ trình duyệt.';
        saveDraft();
        return;
      }
      renderImageRecord(els.campaignImagePreview, record, 'Chưa chọn ảnh bình luận');
      if (els.removeCampaignImageBtn) els.removeCampaignImageBtn.classList.remove('hidden');
      if (els.campaignImageStatus) {
        els.campaignImageStatus.textContent = state.activeImageKey === APP.manualImageKey
          ? 'Đang dùng ảnh chọn trực tiếp cho chiến dịch hiện tại.'
          : 'Đang dùng ảnh đã lưu trong mẫu được chọn.';
      }
    } catch (error) {
      if (requestId !== state.previewRequestId) return;
      renderImageRecord(els.campaignImagePreview, null, 'Không đọc được ảnh');
      if (els.campaignImageStatus) els.campaignImageStatus.textContent = getErrorText(error);
    }
  }

  async function getActiveCommentImage() {
    if (!state.activeImageKey) return null;
    const record = await getImageRecord(state.activeImageKey);
    if (!record || !record.blob) return null;
    const dataUrl = await blobToDataUrl(record.blob);
    return {
      dataUrl,
      name: record.name || 'autovip-comment-image',
      type: record.type || record.blob.type || 'image/jpeg',
      size: Number(record.size || record.blob.size || 0),
      required: Boolean(els.campaignImageRequiredInput && els.campaignImageRequiredInput.checked),
      sourceKey: state.activeImageKey
    };
  }

  function setDefaultCampaignPrompts(categoryId) {
    const category = getCategory(categoryId);
    if (els.classificationPromptInput) els.classificationPromptInput.value = category.classifierPrompt;
    if (els.replyPromptInput) els.replyPromptInput.value = category.replyPrompt;
  }

  function getCampaignPromptProfile(categoryId) {
    const category = getCategory(categoryId);
    const profiles = loadStorage(APP.storage.promptProfiles, {});
    const profile = profiles && typeof profiles === 'object' ? profiles[category.id] : null;
    return {
      classifierPrompt: text(profile && profile.classifierPrompt) || category.classifierPrompt,
      replyPrompt: text(profile && profile.replyPrompt) || category.replyPrompt
    };
  }

  function loadCampaignPromptProfile(categoryId) {
    const profile = getCampaignPromptProfile(categoryId);
    if (els.classificationPromptInput) els.classificationPromptInput.value = profile.classifierPrompt;
    if (els.replyPromptInput) els.replyPromptInput.value = profile.replyPrompt;
  }

  function saveCurrentPromptProfile() {
    const categoryId = getCampaignCategoryId();
    const category = getCategory(categoryId);
    const profiles = loadStorage(APP.storage.promptProfiles, {});
    const nextProfiles = profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
    nextProfiles[categoryId] = {
      classifierPrompt: text(els.classificationPromptInput && els.classificationPromptInput.value) || category.classifierPrompt,
      replyPrompt: text(els.replyPromptInput && els.replyPromptInput.value) || category.replyPrompt,
      updatedAt: new Date().toISOString()
    };
    saveStorage(APP.storage.promptProfiles, nextProfiles);
  }

  function setDefaultModalPrompts(categoryId) {
    const category = getCategory(categoryId);
    if (els.tplClassifierPromptInput) els.tplClassifierPromptInput.value = category.classifierPrompt;
    if (els.tplReplyPromptInput) els.tplReplyPromptInput.value = category.replyPrompt;
  }

  function updateCampaignCategoryUi(categoryId, options) {
    const settings = options || {};
    const category = getCategory(categoryId);
    if (els.campaignTypeSelect) els.campaignTypeSelect.value = category.id;
    if (els.campaignSubjectLabel) els.campaignSubjectLabel.textContent = category.subjectLabel;
    if (els.productNameInput) els.productNameInput.placeholder = category.subjectPlaceholder;
    if (els.campaignSubjectHint) els.campaignSubjectHint.textContent = 'Nội dung chính của mẫu ' + category.shortLabel.toLowerCase() + '.';
    if (els.campaignDetailsLabel) els.campaignDetailsLabel.textContent = category.detailsLabel;
    if (els.campaignDetailsInput) els.campaignDetailsInput.placeholder = category.detailsPlaceholder;
    if (els.campaignContactLabel) els.campaignContactLabel.textContent = category.contactLabel;
    if (els.campaignContactInput) els.campaignContactInput.placeholder = category.contactPlaceholder;
    if (els.campaignLinkLabel) els.campaignLinkLabel.textContent = category.linkLabel;
    if (els.productLinkInput) els.productLinkInput.placeholder = category.linkPlaceholder;
    if (els.shopeeTargetCountWrap) els.shopeeTargetCountWrap.classList.toggle('hidden', category.id !== 'sales');
    if (els.articleIntentHint) {
      const hints = {
        sales: 'Bài đang bán hàng sẽ trả về (next); bài có nhu cầu mua phù hợp mới được tạo bình luận.',
        recruitment: 'Bài đang tuyển người sẽ trả về (next); bài của người đang tìm việc phù hợp mới được tạo bình luận.',
        rental: 'Bài đang cho thuê phòng sẽ trả về (next); bài của người đang tìm phòng phù hợp mới được tạo bình luận.',
        real_estate: 'Bài đang rao bán bất động sản sẽ trả về (next); bài của người đang tìm mua phù hợp mới được tạo bình luận.'
      };
      els.articleIntentHint.textContent = hints[category.id];
    }
    if (settings.loadPrompts) loadCampaignPromptProfile(category.id);
    updateCounters();
  }

  function updateModalCategoryUi(categoryId, resetPrompts) {
    const category = getCategory(categoryId);
    if (els.tplCategorySelect) els.tplCategorySelect.value = category.id;
    if (els.tplSubjectLabel) els.tplSubjectLabel.textContent = category.subjectLabel;
    if (els.tplProductInput) els.tplProductInput.placeholder = category.subjectPlaceholder;
    if (els.tplDetailsLabel) els.tplDetailsLabel.textContent = category.detailsLabel;
    if (els.tplDetailsInput) els.tplDetailsInput.placeholder = category.detailsPlaceholder;
    if (els.tplContactLabel) els.tplContactLabel.textContent = category.contactLabel;
    if (els.tplContactInput) els.tplContactInput.placeholder = category.contactPlaceholder;
    if (els.tplLinksLabel) els.tplLinksLabel.textContent = category.linkLabel;
    if (els.tplLinksInput) els.tplLinksInput.placeholder = category.linkPlaceholder;
    if (resetPrompts) setDefaultModalPrompts(category.id);
  }

  function updateCounters() {
    if (els.articleCounter && els.articleInput) els.articleCounter.textContent = els.articleInput.value.length + '/6000';
    if (els.productCounter && els.productNameInput) els.productCounter.textContent = els.productNameInput.value.length + '/160';
    if (els.campaignDetailsCounter && els.campaignDetailsInput) {
      els.campaignDetailsCounter.textContent = els.campaignDetailsInput.value.length + '/3000';
    }
    if (els.shopeeTargetCountInput) {
      els.shopeeTargetCountInput.value = String(sanitizeShopeeTargetCount(els.shopeeTargetCountInput.value || 5));
    }
    const parsed = parseLinks(els.productLinkInput && els.productLinkInput.value);
    if (els.linkCounter) els.linkCounter.textContent = parsed.valid.length + ' link';
    if (els.validLinkStat) els.validLinkStat.textContent = String(parsed.valid.length);
    if (els.linkStatus) {
      if (!text(els.productLinkInput && els.productLinkInput.value)) {
        els.linkStatus.textContent = 'Chưa có link';
        els.linkStatus.className = 'link-preview';
      } else if (parsed.invalid.length) {
        els.linkStatus.textContent = 'Có ' + parsed.invalid.length + ' link chưa hợp lệ, hệ thống sẽ bỏ qua';
        els.linkStatus.className = 'link-preview warn';
      } else {
        els.linkStatus.textContent = 'Tất cả link đều hợp lệ';
        els.linkStatus.className = 'link-preview ok';
      }
    }
  }

  function updateStats() {
    if (els.historyStat) els.historyStat.textContent = String(loadStorage(APP.storage.history, []).length);
    if (els.templateCountStat) {
      const filtered = state.activeCategoryFilter === 'all'
        ? state.templates
        : state.templates.filter(template => template.category === state.activeCategoryFilter);
      els.templateCountStat.textContent = String(filtered.length);
    }
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
      if (els.authUsername) els.authUsername.classList.add('hidden');
      return;
    }
    els.authStatus.textContent = '✅ Đã sẵn sàng gọi API ChatGPT';
    els.authStatus.className = 'auth-status ok';
    if (els.authUsername) {
      els.authUsername.textContent = model + ' • ' + endpoint;
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
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });
      const rawText = await response.text();
      let data = null;
      try { data = rawText ? JSON.parse(rawText) : null; } catch { data = null; }
      if (!response.ok) {
        const message = data && data.error && data.error.message
          || data && data.message
          || rawText
          || 'HTTP ' + response.status;
        throw new Error(message);
      }
      return data || rawText;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('API phản hồi quá lâu, đã tự hủy sau 60 giây.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function isNextResult(value) {
    return /^\(?\s*next\s*\)?$/i.test(String(value || '').trim());
  }

  function isCommentResult(value) {
    return /^\s*comment\s*$/i.test(String(value || '').trim());
  }

  function getCampaignContext(articleOverride, subjectOverride) {
    const category = getCategory(getCampaignCategoryId());
    const links = parseLinks(els.productLinkInput && els.productLinkInput.value).valid;
    return {
      categoryId: category.id,
      category: category.label,
      article: text(articleOverride != null ? articleOverride : (els.articleInput && els.articleInput.value)),
      subject: text(subjectOverride != null ? subjectOverride : (els.productNameInput && els.productNameInput.value)),
      details: text(els.campaignDetailsInput && els.campaignDetailsInput.value),
      contact: text(els.campaignContactInput && els.campaignContactInput.value),
      link: firstFrom(links),
      tone: text(els.toneSelect && els.toneSelect.value)
    };
  }

  function replaceToken(source, token, value) {
    return String(source || '').split(token).join(String(value || ''));
  }

  function buildPrompt(sourcePrompt, context, mode) {
    const source = text(sourcePrompt);
    const category = getCategory(context.categoryId);
    const fallback = mode === 'classifier' ? category.classifierPrompt : category.replyPrompt;
    const original = source || fallback;
    const allValues = [
      [CONFIG.TOKENS.ARTICLE, context.article],
      [CONFIG.TOKENS.CATEGORY, context.category],
      [CONFIG.TOKENS.SUBJECT, context.subject],
      [CONFIG.TOKENS.DETAILS, context.details],
      [CONFIG.TOKENS.CONTACT, context.contact],
      [CONFIG.TOKENS.LINK, context.link],
      [CONFIG.TOKENS.TONE, context.tone]
    ];
    const values = mode === 'classifier' ? allValues.slice(0, 4) : allValues;
    let rendered = original;
    const missing = [];
    for (const pair of values) {
      if (original.includes(pair[0])) rendered = replaceToken(rendered, pair[0], pair[1]);
      else missing.push(pair);
    }
    if (missing.length) {
      rendered += '\n\nDữ liệu bổ sung bắt buộc sử dụng:';
      for (const pair of missing) {
        rendered += '\n- ' + pair[0].replace(/[{}]/g, '') + ': ' + (pair[1] || 'Không có');
      }
    }
    if (mode === 'classifier') {
      rendered += '\n\nQUY TẮC ĐẦU RA BẮT BUỘC: Chỉ trả về đúng comment hoặc (next). Không giải thích, không thêm ký tự khác.';
    } else {
      rendered += '\n\nQUY TẮC ĐẦU RA BẮT BUỘC: Chỉ trả về nội dung bình luận hoàn chỉnh hoặc đúng (next). Không thêm tiêu đề, giải thích hay markdown.';
    }
    return rendered;
  }

  async function classifyArticleIntent(article, subject, options) {
    const settings = options || {};
    const context = settings.context || getCampaignContext(article, subject);
    const promptSource = settings.prompt != null
      ? settings.prompt
      : els.classificationPromptInput && els.classificationPromptInput.value;
    const response = await callChatCompletion(buildPrompt(promptSource, context, 'classifier'));
    const result = stripAiWrapper(extractResponseText(response));
    if (isNextResult(result)) return 'next';
    if (isCommentResult(result)) return 'comment';
    const normalized = result.toLowerCase();
    if (normalized.includes('(next)') && !normalized.includes('comment')) return 'next';
    if (normalized.includes('comment') && !normalized.includes('next')) return 'comment';
    return 'next';
  }

  async function generateComment() {
    const context = getCampaignContext();
    const parsedLinks = parseLinks(els.productLinkInput && els.productLinkInput.value);
    let refillPromise = Promise.resolve([]);

    if (!context.article) {
      toast('Vui lòng nhập nội dung bài viết gốc.', 'warning');
      if (els.articleInput) els.articleInput.focus();
      return '';
    }
    if (!context.subject) {
      toast('Vui lòng nhập ' + getCategory(context.categoryId).subjectLabel.toLowerCase() + '.', 'warning');
      if (els.productNameInput) els.productNameInput.focus();
      return '';
    }
    if (parsedLinks.invalid.length) {
      toast('Đã bỏ qua ' + parsedLinks.invalid.length + ' link chưa hợp lệ.', 'warning');
    }
    if (!hasApiKey()) {
      toast('Vui lòng nhập API key ChatGPT trước khi tạo bình luận.', 'warning');
      if (els.chatApiKeyInput) els.chatApiKeyInput.focus();
      updateAuthUI();
      return '';
    }

    els.generateBtn.disabled = true;
    els.generateBtn.textContent = '⏳ Đang phân loại...';
    if (els.tokenBanner) els.tokenBanner.classList.remove('show');
    setOutput('Đang dùng prompt ' + context.category.toLowerCase() + ' để phân loại bài viết...', 'loading');

    try {
      const articleIntent = await classifyArticleIntent(context.article, context.subject, { context });
      if (articleIntent === 'next') {
        setOutput('(next)');
        toast('Prompt phân loại trả về (next), đã chuyển bài tiếp theo.', 'warning');
        return '(next)';
      }

      setOutput('Bài phù hợp với chiến dịch ' + context.category + '. Đang tạo bình luận...', 'loading');
      els.generateBtn.textContent = '⏳ Đang tạo bình luận...';

      if (context.categoryId === 'sales' && context.link && parsedLinks.valid.length <= 1) {
        refillPromise = refillShopeeLinksIfNeeded([context.link], 'low_links');
      }

      const replyPrompt = buildPrompt(
        els.replyPromptInput && els.replyPromptInput.value,
        context,
        'reply'
      );
      const response = await callChatCompletion(replyPrompt);
      const result = stripAiWrapper(extractResponseText(response));
      await refillPromise;

      if (isNextResult(result)) {
        setOutput('(next)');
        toast('Prompt trả lời trả về (next), đã bỏ qua bài này.', 'warning');
        return '(next)';
      }

      if (context.categoryId === 'sales' && context.link && result) {
        const resultShopeeLinks = extractShopeeLinksFromText(result);
        let removal = removeProductLinksExact([context.link]);
        if (!removal.removed.length && resultShopeeLinks.length) {
          removal = removeProductLinksExact(resultShopeeLinks);
        }
        if (!removal.removed.length && resultShopeeLinks.length) {
          removal = removeProductLinksMatchingUrls(resultShopeeLinks);
        }
        if (removal.removed.length) toast('Đã xóa ' + removal.removed.length + ' link Shopee đã dùng.');

        const remainingLinks = parseLinks(els.productLinkInput && els.productLinkInput.value).valid;
        if (remainingLinks.length <= 1) {
          await refillShopeeLinksIfNeeded(remainingLinks.length ? remainingLinks : [context.link], 'ai_result_low_links');
        }
      }

      setOutput(result || 'Không có phản hồi từ AI.', result ? '' : 'error');
      if (result) {
        const copied = await copyText(result, { silent: true });
        toast(copied ? 'Đã tạo xong và tự động sao chép bình luận.' : 'Đã tạo xong bình luận.', copied ? 'success' : 'warning');
      }
      return result;
    } catch (error) {
      try { await refillPromise; } catch {}
      const errorText = getErrorText(error);
      if (isTokenError(errorText)) {
        setOutput('⚠️ API ChatGPT có thể đã hết quota hoặc bị giới hạn. Hãy kiểm tra API key và model.', 'error');
        if (els.tokenBanner) els.tokenBanner.classList.add('show');
      } else if (/sign|auth|unauthorized|401/i.test(errorText)) {
        setOutput('🔑 API key không hợp lệ hoặc không có quyền gọi model này.', 'error');
        updateAuthUI();
      } else {
        setOutput('❌ Lỗi: ' + errorText, 'error');
      }
      return '';
    } finally {
      els.generateBtn.disabled = false;
      els.generateBtn.textContent = '✨ Tạo bình luận';
    }
  }

  async function copyText(value, options) {
    const content = text(value);
    if (!content) return false;
    try {
      await navigator.clipboard.writeText(content);
      if (!options || !options.silent) toast('Đã sao chép vào clipboard');
      return true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = content;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      textarea.remove();
      if (!options || !options.silent) {
        toast(copied ? 'Đã sao chép vào clipboard' : 'Trình duyệt chặn sao chép tự động.', copied ? 'success' : 'warning');
      }
      return copied;
    }
  }

  async function clearForm() {
    const categoryId = getCampaignCategoryId();
    if (els.articleInput) els.articleInput.value = '';
    if (els.productNameInput) els.productNameInput.value = '';
    if (els.campaignDetailsInput) els.campaignDetailsInput.value = '';
    if (els.campaignContactInput) els.campaignContactInput.value = '';
    if (els.productLinkInput) els.productLinkInput.value = '';
    if (els.shopeeTargetCountInput) els.shopeeTargetCountInput.value = '5';
    if (els.toneSelect) els.toneSelect.selectedIndex = 0;
    setDefaultCampaignPrompts(categoryId);
    setOutput('Bình luận sẽ xuất hiện tại đây...', 'placeholder');
    if (els.tokenBanner) els.tokenBanner.classList.remove('show');
    state.selectedTemplateId = null;
    if (state.activeImageKey === APP.manualImageKey) {
      try { await deleteImageRecord(APP.manualImageKey); } catch {}
    }
    state.activeImageKey = null;
    if (els.campaignImageRequiredInput) els.campaignImageRequiredInput.checked = true;
    await renderActiveImagePreview();
    renderTemplates();
    saveDraft();
    updateCounters();
    toast('Đã làm mới form');
  }

  async function pasteArticle() {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (els.articleInput) els.articleInput.value = clipboardText;
      saveDraft();
      updateCounters();
      toast('Đã dán nội dung');
    } catch {
      toast('Trình duyệt chặn clipboard. Hãy dán thủ công bằng Ctrl+V.', 'warning');
    }
  }

  function saveHistory() {
    const comment = text(els.output && els.output.textContent);
    if (!comment || (els.output && (els.output.classList.contains('placeholder') || els.output.classList.contains('loading')))) {
      toast('Chưa có bình luận hợp lệ để lưu.', 'warning');
      return;
    }
    const history = loadStorage(APP.storage.history, []);
    const category = getCategory(getCampaignCategoryId());
    history.unshift({
      comment,
      category: category.id,
      categoryLabel: category.label,
      subject: text(els.productNameInput && els.productNameInput.value),
      createdAt: new Date().toISOString()
    });
    saveStorage(APP.storage.history, history.slice(0, 50));
    updateStats();
    toast('Đã lưu bình luận vào lịch sử');
  }

  function saveDraft() {
    if (!els.campaignTypeSelect) return;
    saveCurrentPromptProfile();
    const shopeeTargetCount = sanitizeShopeeTargetCount((els.shopeeTargetCountInput && els.shopeeTargetCountInput.value) || 5);
    saveStorage(APP.storage.shopeeTargetCount, shopeeTargetCount);
    saveStorage(APP.storage.draft, {
      article: els.articleInput ? els.articleInput.value : '',
      category: getCampaignCategoryId(),
      subject: els.productNameInput ? els.productNameInput.value : '',
      details: els.campaignDetailsInput ? els.campaignDetailsInput.value : '',
      contact: els.campaignContactInput ? els.campaignContactInput.value : '',
      links: els.productLinkInput ? els.productLinkInput.value : '',
      shopeeTargetCount,
      tone: els.toneSelect ? els.toneSelect.value : '',
      classifierPrompt: els.classificationPromptInput ? els.classificationPromptInput.value : '',
      replyPrompt: els.replyPromptInput ? els.replyPromptInput.value : '',
      selectedTemplateId: state.selectedTemplateId,
      activeImageKey: state.activeImageKey,
      imageRequired: Boolean(els.campaignImageRequiredInput && els.campaignImageRequiredInput.checked)
    });
  }

  function restoreDraft() {
    let draft = loadStorage(APP.storage.draft, null);
    if (!draft) {
      const oldDraft = loadStorage(APP.storage.oldDraft, null);
      if (oldDraft) {
        draft = {
          article: oldDraft.article || '',
          category: 'sales',
          subject: oldDraft.productName || '',
          details: '',
          contact: '',
          links: oldDraft.productLinks || '',
          shopeeTargetCount: oldDraft.shopeeTargetCount || loadStorage(APP.storage.shopeeTargetCount, 5),
          tone: oldDraft.tone || '',
          classifierPrompt: getCategory('sales').classifierPrompt,
          replyPrompt: getCategory('sales').replyPrompt,
          selectedTemplateId: null,
          activeImageKey: null,
          imageRequired: true
        };
        saveStorage(APP.storage.draft, draft);
      }
    }

    const categoryId = draft && CONFIG.categories[draft.category] ? draft.category : 'sales';
    if (els.campaignTypeSelect) els.campaignTypeSelect.value = categoryId;
    updateCampaignCategoryUi(categoryId, { loadPrompts: false });
    if (els.articleInput) els.articleInput.value = draft && draft.article || '';
    if (els.productNameInput) els.productNameInput.value = draft && (draft.subject || draft.productName) || '';
    if (els.campaignDetailsInput) els.campaignDetailsInput.value = draft && draft.details || '';
    if (els.campaignContactInput) els.campaignContactInput.value = draft && draft.contact || '';
    if (els.productLinkInput) els.productLinkInput.value = draft && (draft.links || draft.productLinks) || '';
    if (els.shopeeTargetCountInput) {
      els.shopeeTargetCountInput.value = String(sanitizeShopeeTargetCount(
        draft && draft.shopeeTargetCount || loadStorage(APP.storage.shopeeTargetCount, 5)
      ));
    }
    if (els.toneSelect && draft && draft.tone) els.toneSelect.value = draft.tone;
    if (els.classificationPromptInput) {
      els.classificationPromptInput.value = draft && draft.classifierPrompt || getCategory(categoryId).classifierPrompt;
    }
    if (els.replyPromptInput) {
      els.replyPromptInput.value = draft && draft.replyPrompt || getCategory(categoryId).replyPrompt;
    }
    state.selectedTemplateId = draft && state.templates.some(template => template.id === draft.selectedTemplateId)
      ? draft.selectedTemplateId
      : null;
    state.activeImageKey = draft && draft.activeImageKey || null;
    if (els.campaignImageRequiredInput) {
      els.campaignImageRequiredInput.checked = draft ? draft.imageRequired !== false : true;
    }
    saveCurrentPromptProfile();
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
    state.modalImageFile = null;
    state.modalImageRemoved = false;
    if (els.tplImageInput) els.tplImageInput.value = '';
  }

  function normalizeTemplate(rawTemplate) {
    const raw = rawTemplate && typeof rawTemplate === 'object' ? rawTemplate : {};
    const categoryId = CONFIG.categories[raw.category] ? raw.category : 'sales';
    const category = getCategory(categoryId);
    const id = text(raw.id) || createId();
    return {
      id,
      category: categoryId,
      name: text(raw.name) || 'Mẫu chưa đặt tên',
      subject: text(raw.subject || raw.product),
      details: text(raw.details),
      contact: text(raw.contact),
      links: uniqueUrlList(parseLinks(raw.links || '').valid).join('\n'),
      classifierPrompt: text(raw.classifierPrompt || raw.classificationPrompt) || category.classifierPrompt,
      replyPrompt: text(raw.replyPrompt) || category.replyPrompt,
      imageKey: text(raw.imageKey),
      imageName: text(raw.imageName),
      imageType: text(raw.imageType),
      imageSize: Number(raw.imageSize || 0),
      imageRequired: raw.imageRequired !== false,
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString()
    };
  }

  function legacyTemplateFingerprint(template) {
    return [
      text(template && template.name).toLowerCase(),
      text(template && (template.subject || template.product)).toLowerCase(),
      uniqueUrlList(parseLinks(template && template.links || '').valid).join('|').toLowerCase()
    ].join('::');
  }

  function loadAndMigrateTemplates() {
    const stored = loadStorage(APP.storage.templates, []);
    const templates = Array.isArray(stored) ? stored.map(normalizeTemplate) : [];
    const migrationDone = loadStorage(APP.storage.migrationDone, false) === true;
    if (!migrationDone) {
      const legacyLeft = loadStorage(APP.storage.leftTemplates, []);
      const legacyRight = loadStorage(APP.storage.rightTemplates, []);
      const legacyTemplates = []
        .concat(Array.isArray(legacyLeft) ? legacyLeft : [])
        .concat(Array.isArray(legacyRight) ? legacyRight : []);
      const fingerprints = new Set(templates.map(legacyTemplateFingerprint));
      for (const legacy of legacyTemplates) {
        const fingerprint = legacyTemplateFingerprint(legacy);
        if (!fingerprint || fingerprints.has(fingerprint)) continue;
        fingerprints.add(fingerprint);
        templates.push(normalizeTemplate({
          id: createId(),
          category: 'sales',
          name: legacy && legacy.name,
          subject: legacy && legacy.product,
          links: legacy && legacy.links,
          classifierPrompt: getCategory('sales').classifierPrompt,
          replyPrompt: getCategory('sales').replyPrompt,
          createdAt: legacy && legacy.createdAt,
          updatedAt: legacy && legacy.updatedAt
        }));
      }
      saveStorage(APP.storage.migrationDone, true);
    }
    state.templates = templates;
    saveStorage(APP.storage.templates, state.templates);
  }

  function saveTemplates() {
    saveStorage(APP.storage.templates, state.templates);
  }

  function revokeTemplatePreviewUrls() {
    for (const url of state.templatePreviewUrls) URL.revokeObjectURL(url);
    state.templatePreviewUrls.clear();
  }

  async function loadTemplateThumbnail(template, container) {
    if (!template.imageKey || !container) return;
    try {
      const record = await getImageRecord(template.imageKey);
      if (!record || !record.blob || !container.isConnected || container.dataset.templateId !== template.id) return;
      const url = URL.createObjectURL(record.blob);
      state.templatePreviewUrls.add(url);
      const image = document.createElement('img');
      image.src = url;
      image.alt = template.imageName || 'Ảnh mẫu';
      container.replaceChildren(image);
      container.classList.add('has-image');
    } catch {}
  }

  function renderTemplates() {
    if (!els.campaignTemplateList) return;
    revokeTemplatePreviewUrls();
    els.campaignTemplateList.replaceChildren();
    const filtered = state.activeCategoryFilter === 'all'
      ? state.templates
      : state.templates.filter(template => template.category === state.activeCategoryFilter);
    const categoryTitle = state.activeCategoryFilter === 'all'
      ? 'Tất cả mẫu'
      : getCategory(state.activeCategoryFilter).label;
    if (els.templateCategoryTitle) els.templateCategoryTitle.textContent = categoryTitle;

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'tpl-empty';
      empty.textContent = 'Chưa có mẫu trong thể loại này. Nhấn “+ Thêm mẫu” để tạo.';
      els.campaignTemplateList.appendChild(empty);
      updateStats();
      return;
    }

    for (const template of filtered) {
      const category = getCategory(template.category);
      const item = document.createElement('article');
      item.className = 'tpl-item campaign-template-item';
      if (state.selectedTemplateId === template.id) item.classList.add('active');
      item.dataset.templateId = template.id;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', 'Áp dụng mẫu ' + template.name);

      const thumbnail = document.createElement('div');
      thumbnail.className = 'tpl-icon campaign-template-thumb';
      thumbnail.dataset.templateId = template.id;
      thumbnail.textContent = category.icon;
      if (template.imageKey) loadTemplateThumbnail(template, thumbnail);

      const info = document.createElement('div');
      info.className = 'campaign-template-info';
      const categoryBadge = document.createElement('span');
      categoryBadge.className = 'template-category-badge category-' + category.id;
      categoryBadge.textContent = category.icon + ' ' + category.label;
      const name = document.createElement('div');
      name.className = 'tpl-name';
      name.textContent = template.name;
      const meta = document.createElement('div');
      meta.className = 'tpl-meta';
      const linkCount = parseLinks(template.links).valid.length;
      meta.textContent = (template.subject || 'Chưa nhập nội dung chính')
        + ' • ' + linkCount + ' link'
        + (template.imageKey ? ' • Có ảnh' : ' • Không ảnh');
      info.append(categoryBadge, name, meta);

      const actions = document.createElement('div');
      actions.className = 'tpl-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-soft btn-icon';
      edit.textContent = '✏️';
      edit.title = 'Sửa mẫu';
      edit.dataset.action = 'edit';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-danger btn-icon';
      remove.textContent = '🗑️';
      remove.title = 'Xóa mẫu';
      remove.dataset.action = 'delete';
      actions.append(edit, remove);

      item.append(thumbnail, info, actions);
      els.campaignTemplateList.appendChild(item);
    }
    updateStats();
  }

  async function applyTemplate(templateId) {
    const template = state.templates.find(item => item.id === templateId);
    if (!template) return;
    state.selectedTemplateId = template.id;
    if (els.campaignTypeSelect) els.campaignTypeSelect.value = template.category;
    updateCampaignCategoryUi(template.category, { loadPrompts: false });
    if (els.productNameInput) els.productNameInput.value = template.subject || '';
    if (els.campaignDetailsInput) els.campaignDetailsInput.value = template.details || '';
    if (els.campaignContactInput) els.campaignContactInput.value = template.contact || '';
    if (els.productLinkInput) els.productLinkInput.value = template.links || '';
    if (els.classificationPromptInput) els.classificationPromptInput.value = template.classifierPrompt || getCategory(template.category).classifierPrompt;
    if (els.replyPromptInput) els.replyPromptInput.value = template.replyPrompt || getCategory(template.category).replyPrompt;
    state.activeImageKey = template.imageKey || null;
    if (els.campaignImageRequiredInput) els.campaignImageRequiredInput.checked = template.imageRequired !== false;
    await renderActiveImagePreview();
    renderTemplates();
    updateCounters();
    saveDraft();
    if (els.productNameInput) els.productNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Đã áp dụng mẫu: ' + template.name);
  }

  function resetModalFields(categoryId) {
    const category = getCategory(categoryId);
    state.modalImageFile = null;
    state.modalImageRemoved = false;
    if (els.tplCategorySelect) els.tplCategorySelect.value = category.id;
    if (els.tplNameInput) els.tplNameInput.value = '';
    if (els.tplProductInput) els.tplProductInput.value = '';
    if (els.tplDetailsInput) els.tplDetailsInput.value = '';
    if (els.tplContactInput) els.tplContactInput.value = '';
    if (els.tplLinksInput) els.tplLinksInput.value = '';
    if (els.tplImageInput) els.tplImageInput.value = '';
    if (els.tplImageRequiredInput) els.tplImageRequiredInput.checked = true;
    if (els.removeTplImageBtn) els.removeTplImageBtn.classList.add('hidden');
    renderImageRecord(els.tplImagePreview, null, 'Chưa có ảnh');
    updateModalCategoryUi(category.id, true);
  }

  function openAddTemplate() {
    state.editingTemplateId = null;
    const categoryId = state.activeCategoryFilter !== 'all'
      ? state.activeCategoryFilter
      : getCampaignCategoryId();
    resetModalFields(categoryId);
    if (els.modalTitle) els.modalTitle.textContent = 'Thêm mẫu — ' + getCategory(categoryId).label;
    openModal(els.templateModal);
    requestAnimationFrame(() => els.tplNameInput && els.tplNameInput.focus());
  }

  async function openEditTemplate(templateId) {
    const template = state.templates.find(item => item.id === templateId);
    if (!template) return;
    state.editingTemplateId = template.id;
    state.modalImageFile = null;
    state.modalImageRemoved = false;
    updateModalCategoryUi(template.category, false);
    if (els.modalTitle) els.modalTitle.textContent = 'Sửa mẫu — ' + getCategory(template.category).label;
    if (els.tplNameInput) els.tplNameInput.value = template.name;
    if (els.tplProductInput) els.tplProductInput.value = template.subject;
    if (els.tplDetailsInput) els.tplDetailsInput.value = template.details;
    if (els.tplContactInput) els.tplContactInput.value = template.contact;
    if (els.tplLinksInput) els.tplLinksInput.value = template.links;
    if (els.tplClassifierPromptInput) els.tplClassifierPromptInput.value = template.classifierPrompt;
    if (els.tplReplyPromptInput) els.tplReplyPromptInput.value = template.replyPrompt;
    if (els.tplImageRequiredInput) els.tplImageRequiredInput.checked = template.imageRequired !== false;
    if (els.tplImageInput) els.tplImageInput.value = '';
    if (template.imageKey) {
      try {
        const record = await getImageRecord(template.imageKey);
        renderImageRecord(els.tplImagePreview, record, 'Không tìm thấy ảnh');
        if (els.removeTplImageBtn) els.removeTplImageBtn.classList.toggle('hidden', !record);
      } catch {
        renderImageRecord(els.tplImagePreview, null, 'Không đọc được ảnh');
      }
    } else {
      renderImageRecord(els.tplImagePreview, null, 'Chưa có ảnh');
      if (els.removeTplImageBtn) els.removeTplImageBtn.classList.add('hidden');
    }
    openModal(els.templateModal);
    requestAnimationFrame(() => els.tplNameInput && els.tplNameInput.focus());
  }

  async function deleteTemplate(templateId) {
    const template = state.templates.find(item => item.id === templateId);
    if (!template || !confirm('Xóa mẫu “' + template.name + '”?')) return;
    state.templates = state.templates.filter(item => item.id !== templateId);
    saveTemplates();
    if (template.imageKey) {
      try { await deleteImageRecord(template.imageKey); } catch {}
    }
    if (state.selectedTemplateId === templateId) {
      state.selectedTemplateId = null;
      if (state.activeImageKey === template.imageKey) {
        state.activeImageKey = null;
        await renderActiveImagePreview();
      }
      saveDraft();
    }
    renderTemplates();
    toast('Đã xóa mẫu');
  }

  async function saveTemplateFromModal() {
    const categoryId = CONFIG.categories[els.tplCategorySelect && els.tplCategorySelect.value]
      ? els.tplCategorySelect.value
      : 'sales';
    const category = getCategory(categoryId);
    const name = text(els.tplNameInput && els.tplNameInput.value);
    const subject = text(els.tplProductInput && els.tplProductInput.value);
    const details = text(els.tplDetailsInput && els.tplDetailsInput.value);
    const contact = text(els.tplContactInput && els.tplContactInput.value);
    const rawLinks = text(els.tplLinksInput && els.tplLinksInput.value);
    const classifierPrompt = text(els.tplClassifierPromptInput && els.tplClassifierPromptInput.value) || category.classifierPrompt;
    const replyPrompt = text(els.tplReplyPromptInput && els.tplReplyPromptInput.value) || category.replyPrompt;

    if (!name) {
      toast('Vui lòng nhập tên mẫu.', 'warning');
      if (els.tplNameInput) els.tplNameInput.focus();
      return;
    }
    if (!subject) {
      toast('Vui lòng nhập ' + category.subjectLabel.toLowerCase() + '.', 'warning');
      if (els.tplProductInput) els.tplProductInput.focus();
      return;
    }
    const parsedLinks = parseLinks(rawLinks);
    if (rawLinks && !parsedLinks.valid.length) {
      toast('Danh sách link chưa có URL hợp lệ.', 'warning');
      if (els.tplLinksInput) els.tplLinksInput.focus();
      return;
    }

    const existingIndex = state.templates.findIndex(item => item.id === state.editingTemplateId);
    const existing = existingIndex >= 0 ? state.templates[existingIndex] : null;
    const templateId = existing ? existing.id : createId();
    let imageKey = existing && existing.imageKey || '';
    let imageName = existing && existing.imageName || '';
    let imageType = existing && existing.imageType || '';
    let imageSize = existing && existing.imageSize || 0;

    if (els.btnSaveTpl) els.btnSaveTpl.disabled = true;
    try {
      if (state.modalImageFile) {
        const record = await putImageRecord(templateId, state.modalImageFile);
        imageKey = templateId;
        imageName = record.name;
        imageType = record.type;
        imageSize = record.size;
      } else if (state.modalImageRemoved) {
        if (imageKey) await deleteImageRecord(imageKey);
        imageKey = '';
        imageName = '';
        imageType = '';
        imageSize = 0;
      }

      const payload = normalizeTemplate({
        id: templateId,
        category: categoryId,
        name,
        subject,
        details,
        contact,
        links: parsedLinks.valid.join('\n'),
        classifierPrompt,
        replyPrompt,
        imageKey,
        imageName,
        imageType,
        imageSize,
        imageRequired: Boolean(imageKey && els.tplImageRequiredInput && els.tplImageRequiredInput.checked),
        createdAt: existing && existing.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      if (existingIndex >= 0) state.templates[existingIndex] = payload;
      else state.templates.unshift(payload);
      saveTemplates();
      closeModal(els.templateModal);
      renderTemplates();
      if (state.selectedTemplateId === payload.id) await applyTemplate(payload.id);
      toast('Đã lưu mẫu ' + category.label);
    } catch (error) {
      toast('Không lưu được mẫu: ' + getErrorText(error), 'warning');
    } finally {
      if (els.btnSaveTpl) els.btnSaveTpl.disabled = false;
    }
  }

  async function handleCampaignImageSelection() {
    const file = els.campaignImageInput && els.campaignImageInput.files && els.campaignImageInput.files[0];
    if (!file) return;
    try {
      const record = await putImageRecord(APP.manualImageKey, file);
      state.activeImageKey = APP.manualImageKey;
      if (els.campaignImageRequiredInput) els.campaignImageRequiredInput.checked = true;
      renderImageRecord(els.campaignImagePreview, record, 'Chưa chọn ảnh bình luận');
      if (els.removeCampaignImageBtn) els.removeCampaignImageBtn.classList.remove('hidden');
      if (els.campaignImageStatus) els.campaignImageStatus.textContent = 'Đang dùng ảnh chọn trực tiếp cho chiến dịch hiện tại.';
      saveDraft();
      toast('Đã chọn ảnh bình luận');
    } catch (error) {
      toast(getErrorText(error), 'warning');
    } finally {
      if (els.campaignImageInput) els.campaignImageInput.value = '';
    }
  }

  async function removeActiveCampaignImage() {
    if (state.activeImageKey === APP.manualImageKey) {
      try { await deleteImageRecord(APP.manualImageKey); } catch {}
    }
    state.activeImageKey = null;
    await renderActiveImagePreview();
    saveDraft();
    toast('Đã bỏ ảnh khỏi bình luận hiện tại');
  }

  function handleModalImageSelection() {
    const file = els.tplImageInput && els.tplImageInput.files && els.tplImageInput.files[0];
    if (!file) return;
    try {
      validateImageFile(file);
      state.modalImageFile = file;
      state.modalImageRemoved = false;
      renderImageFile(els.tplImagePreview, file, 'Chưa có ảnh');
      if (els.removeTplImageBtn) els.removeTplImageBtn.classList.remove('hidden');
      if (els.tplImageRequiredInput) els.tplImageRequiredInput.checked = true;
    } catch (error) {
      state.modalImageFile = null;
      if (els.tplImageInput) els.tplImageInput.value = '';
      toast(getErrorText(error), 'warning');
    }
  }

  function removeModalImage() {
    state.modalImageFile = null;
    state.modalImageRemoved = true;
    if (els.tplImageInput) els.tplImageInput.value = '';
    if (els.tplImageRequiredInput) els.tplImageRequiredInput.checked = false;
    if (els.removeTplImageBtn) els.removeTplImageBtn.classList.add('hidden');
    renderImageRecord(els.tplImagePreview, null, 'Chưa có ảnh');
  }

  function setCategoryFilter(categoryId) {
    state.activeCategoryFilter = categoryId === 'all' || CONFIG.categories[categoryId] ? categoryId : 'all';
    $$('.category-tab', els.templateCategoryTabs).forEach(button => {
      const active = button.dataset.category === state.activeCategoryFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    renderTemplates();
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

    if (els.chatApiKeyToggle) {
      els.chatApiKeyToggle.addEventListener('click', () => {
        if (!els.chatApiKeyInput) return;
        const hidden = els.chatApiKeyInput.type === 'password';
        els.chatApiKeyInput.type = hidden ? 'text' : 'password';
        els.chatApiKeyToggle.textContent = hidden ? '🙈' : '👁';
        els.chatApiKeyToggle.setAttribute('aria-label', hidden ? 'Ẩn API key' : 'Hiện API key');
        els.chatApiKeyInput.focus();
      });
    }

    if (els.generateBtn) els.generateBtn.addEventListener('click', generateComment);
    if (els.clearBtn) els.clearBtn.addEventListener('click', clearForm);
    if (els.pasteBtn) els.pasteBtn.addEventListener('click', pasteArticle);
    if (els.copyBtn) els.copyBtn.addEventListener('click', () => copyText(els.output && els.output.textContent));
    if (els.saveHistoryBtn) els.saveHistoryBtn.addEventListener('click', saveHistory);
    if (els.btnAddTemplate) els.btnAddTemplate.addEventListener('click', openAddTemplate);
    if (els.btnSaveTpl) els.btnSaveTpl.addEventListener('click', saveTemplateFromModal);
    if (els.btnCancelTpl) els.btnCancelTpl.addEventListener('click', () => closeModal(els.templateModal));

    if (els.campaignTypeSelect) {
      els.campaignTypeSelect.addEventListener('change', async () => {
        state.selectedTemplateId = null;
        state.activeImageKey = null;
        updateCampaignCategoryUi(getCampaignCategoryId(), { loadPrompts: true });
        await renderActiveImagePreview();
        renderTemplates();
        saveDraft();
      });
    }

    if (els.resetCampaignPromptsBtn) {
      els.resetCampaignPromptsBtn.addEventListener('click', () => {
        setDefaultCampaignPrompts(getCampaignCategoryId());
        saveDraft();
        toast('Đã khôi phục prompt mặc định của thể loại.');
      });
    }
    if (els.campaignImageInput) els.campaignImageInput.addEventListener('change', handleCampaignImageSelection);
    if (els.removeCampaignImageBtn) els.removeCampaignImageBtn.addEventListener('click', removeActiveCampaignImage);
    if (els.campaignImageRequiredInput) els.campaignImageRequiredInput.addEventListener('change', saveDraft);

    const draftInputs = [
      els.articleInput,
      els.productNameInput,
      els.campaignDetailsInput,
      els.campaignContactInput,
      els.productLinkInput,
      els.shopeeTargetCountInput,
      els.toneSelect,
      els.classificationPromptInput,
      els.replyPromptInput
    ].filter(Boolean);
    for (const input of draftInputs) {
      input.addEventListener('input', () => {
        updateCounters();
        saveDraft();
      });
      input.addEventListener('change', saveDraft);
    }

    if (els.templateCategoryTabs) {
      els.templateCategoryTabs.addEventListener('click', event => {
        const button = event.target.closest('[data-category]');
        if (button) setCategoryFilter(button.dataset.category);
      });
    }

    if (els.campaignTemplateList) {
      els.campaignTemplateList.addEventListener('click', event => {
        const item = event.target.closest('.tpl-item');
        if (!item) return;
        const templateId = item.dataset.templateId;
        const action = event.target.closest('[data-action]') && event.target.closest('[data-action]').dataset.action;
        if (action === 'edit') {
          event.stopPropagation();
          openEditTemplate(templateId);
          return;
        }
        if (action === 'delete') {
          event.stopPropagation();
          deleteTemplate(templateId);
          return;
        }
        applyTemplate(templateId);
      });
      els.campaignTemplateList.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const item = event.target.closest('.tpl-item');
        if (!item || event.target.closest('[data-action]')) return;
        event.preventDefault();
        applyTemplate(item.dataset.templateId);
      });
    }

    if (els.tplCategorySelect) {
      els.tplCategorySelect.addEventListener('change', () => {
        updateModalCategoryUi(els.tplCategorySelect.value, true);
        if (els.modalTitle) els.modalTitle.textContent = (state.editingTemplateId ? 'Sửa mẫu — ' : 'Thêm mẫu — ') + getCategory(els.tplCategorySelect.value).label;
      });
    }
    if (els.resetTplPromptsBtn) {
      els.resetTplPromptsBtn.addEventListener('click', () => {
        setDefaultModalPrompts(els.tplCategorySelect && els.tplCategorySelect.value || 'sales');
      });
    }
    if (els.tplImageInput) els.tplImageInput.addEventListener('change', handleModalImageSelection);
    if (els.removeTplImageBtn) els.removeTplImageBtn.addEventListener('click', removeModalImage);

    if (els.templateModal) {
      els.templateModal.addEventListener('click', event => {
        if (event.target === els.templateModal) closeModal(els.templateModal);
      });
    }

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeModal(els.templateModal);
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        generateComment();
      }
    });

    window.addEventListener('beforeunload', () => {
      revokeTemplatePreviewUrls();
      [els.campaignImagePreview, els.tplImagePreview].filter(Boolean).forEach(clearPreviewUrl);
    });
  }

  async function init() {
    loadAndMigrateTemplates();
    restoreApiSettings();
    restoreDraft();
    wireEvents();
    updateCampaignCategoryUi(getCampaignCategoryId(), { loadPrompts: false });
    renderTemplates();
    await renderActiveImagePreview();
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
    refillShopeeLinksIfNeeded,
    getActiveCommentImage,
    getActiveCampaign: () => ({
      context: getCampaignContext(),
      selectedTemplateId: state.selectedTemplateId,
      activeImageKey: state.activeImageKey,
      imageRequired: Boolean(els.campaignImageRequiredInput && els.campaignImageRequiredInput.checked)
    })
  };

  window.addEventListener('DOMContentLoaded', () => {
    init().catch(error => {
      console.error('Không khởi tạo được kho chiến dịch:', error);
      toast('Không khởi tạo được kho chiến dịch: ' + getErrorText(error), 'warning');
    });
  });
})();
