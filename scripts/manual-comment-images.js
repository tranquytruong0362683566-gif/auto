(function () {
  'use strict';
  const MAX_IMAGES = 10;
  const MAX_BYTES = 8 * 1024 * 1024;
  const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  const input = document.getElementById('manualCommentImages');
  const preview = document.getElementById('manualImagePreview');
  const status = document.getElementById('manualImageStatus');
  const clearButton = document.getElementById('clearManualImagesBtn');
  let images = [];
  let loading = false;

  function notify(message = '', state = '') {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
    status.hidden = !message;
  }
  function render() {
    if (!preview) return;
    preview.replaceChildren();
    images.forEach((image, index) => {
      const card = document.createElement('figure');
      card.className = 'manual-image-card';
      const photo = document.createElement('img');
      photo.src = image.dataUrl;
      photo.alt = image.name;
      const caption = document.createElement('figcaption');
      const name = document.createElement('span');
      name.textContent = image.name;
      name.title = image.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary-button small-button';
      remove.textContent = 'Xóa ảnh';
      remove.setAttribute('aria-label', 'Xóa ảnh ' + image.name);
      remove.disabled = loading;
      remove.addEventListener('click', () => {
        images.splice(index, 1);
        notify(); render();
      });
      caption.append(name, remove);
      card.append(photo, caption);
      preview.append(card);
    });
    if (clearButton) {clearButton.hidden = images.length === 0; clearButton.disabled = loading;}
  }
  function readImage(file) {
    if (!MIME_TYPES.has(file.type)) throw Error('Chỉ chọn ảnh JPG, PNG, WebP hoặc GIF.');
    if (!file.size || file.size > MAX_BYTES) throw Error('Mỗi ảnh cần có dung lượng tối đa 8 MB.');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(Error('Không đọc được ảnh ' + file.name + '. Chọn lại ảnh.'));
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
        // Match the existing extension's upload limit, including base64 padding.
        if (!match || match[1] !== file.type || Math.ceil(match[2].length * 3 / 4) > MAX_BYTES) {
          reject(Error('Ảnh không hợp lệ hoặc vượt giới hạn 8 MB.')); return;
        }
        resolve({name: file.name, type: file.type, size: file.size, dataUrl});
      };
      reader.readAsDataURL(file);
    });
  }
  async function addFiles(files) {
    if (loading || !files.length) return;
    loading = true;
    if (input) input.disabled = true;
    notify('Đang đọc ảnh...'); render();
    try {
      if (images.length + files.length > MAX_IMAGES) throw Error('Chọn tối đa 10 ảnh. Mỗi bình luận gửi kèm 1 ảnh.');
      // Apply a selection as a batch so a failed file cannot leave a partial selection.
      const selected = await Promise.all(files.map(readImage));
      for (const image of selected) {
        if (!images.some(value => value.dataUrl === image.dataUrl)) images.push(image);
      }
      notify();
    } catch (error) {notify(error.message, 'error');}
    finally {
      loading = false;
      if (input) {input.disabled = false; input.value = '';}
      render();
    }
  }
  function pick(selection = []) {
    if (!selection.length) return null;
    const bytes = new Uint32Array(1);
    window.crypto.getRandomValues(bytes);
    const index = Math.floor((bytes[0] / 4294967296) * selection.length);
    return {...selection[index]};
  }
  function getSnapshot() {
    if (loading) throw Object.assign(Error('Đang đọc ảnh. Chờ ảnh hiển thị rồi bắt đầu chạy.'),
      {code: 'MANUAL_IMAGES_LOADING', failureStage: 'comment', stopClosedLoop: true});
    return images.map(image => ({...image}));
  }
  input?.addEventListener('change', () => addFiles(Array.from(input.files || [])));
  clearButton?.addEventListener('click', () => {if (!loading) {images = []; notify(); render();}});
  window.manualCommentImages = Object.freeze({getSnapshot, pick});
  render();
}());
