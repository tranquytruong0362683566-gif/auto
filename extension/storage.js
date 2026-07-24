import {
  AppError,
  STATE_KEYS,
  base64ToBytes,
  bytesToBase64,
  makeId,
  sanitizeFilename
} from './core.js';

const DATABASE_NAME = 'truong-group-publisher-media';
const DATABASE_VERSION = 1;
const MEDIA_STORE = 'media';
const CHUNK_STORE = 'chunks';
let databasePromise = null;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MEDIA_STORE)) {
        database.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = database.createObjectStore(CHUNK_STORE, { keyPath: ['mediaId', 'index'] });
        chunks.createIndex('by_media', 'mediaId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Không mở được bộ nhớ media.'));
  });
  return databasePromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Giao dịch bộ nhớ thất bại.'));
    transaction.onabort = () => reject(transaction.error || new Error('Giao dịch bộ nhớ bị hủy.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Không đọc được bộ nhớ media.'));
  });
}

export async function localGet(key, fallback = null) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
}

export async function localSet(key, value) {
  await chrome.storage.local.set({ [key]: value });
  return value;
}

export async function localRemove(key) {
  await chrome.storage.local.remove(key);
}

export async function readJob() {
  return localGet(STATE_KEYS.job, null);
}

export async function writeJob(job) {
  return localSet(STATE_KEYS.job, job);
}

export async function beginMedia(input) {
  const kind = input?.kind === 'video' ? 'video' : 'image';
  const size = Number(input?.size);
  const maxBytes = kind === 'video' ? 200 * 1024 * 1024 : 20 * 1024 * 1024;
  const chunkSize = Math.min(1024 * 1024, Math.max(64 * 1024, Number(input?.chunkSize) || 256 * 1024));
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes) {
    throw new AppError('INVALID_MEDIA_SIZE', `Kích thước ${kind === 'video' ? 'video' : 'ảnh'} không hợp lệ.`);
  }
  const type = String(input?.type || '');
  if (kind === 'image' && !type.startsWith('image/')) {
    throw new AppError('INVALID_MEDIA_TYPE', 'Tệp không phải định dạng ảnh.');
  }
  if (kind === 'video' && !type.startsWith('video/')) {
    throw new AppError('INVALID_MEDIA_TYPE', 'Tệp không phải định dạng video.');
  }

  const metadata = {
    id: makeId('media'),
    name: sanitizeFilename(input?.name, kind === 'image' ? 'image.jpg' : 'video.mp4'),
    type,
    size,
    kind,
    chunkSize,
    totalChunks: Math.ceil(size / chunkSize),
    receivedChunks: 0,
    receivedBytes: 0,
    committed: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const database = await openDatabase();
  const transaction = database.transaction(MEDIA_STORE, 'readwrite');
  transaction.objectStore(MEDIA_STORE).put(metadata);
  await transactionDone(transaction);
  return metadata;
}

export async function getMediaMetadata(mediaId) {
  const database = await openDatabase();
  const transaction = database.transaction(MEDIA_STORE, 'readonly');
  const done = transactionDone(transaction);
  const result = await requestResult(transaction.objectStore(MEDIA_STORE).get(String(mediaId || '')));
  await done;
  return result || null;
}

export async function putMediaChunk(input) {
  const mediaId = String(input?.mediaId || '');
  const index = Number(input?.index);
  const metadata = await getMediaMetadata(mediaId);
  if (!metadata) throw new AppError('MEDIA_NOT_FOUND', 'Không tìm thấy phiên chuyển media.');
  if (metadata.committed) throw new AppError('MEDIA_ALREADY_COMMITTED', 'Media đã được chốt.');
  if (!Number.isInteger(index) || index < 0 || index >= metadata.totalChunks) {
    throw new AppError('INVALID_CHUNK_INDEX', 'Chỉ số phần media không hợp lệ.');
  }

  let bytes;
  try {
    bytes = base64ToBytes(input?.data);
  } catch {
    throw new AppError('INVALID_CHUNK_DATA', 'Dữ liệu phần media không hợp lệ.');
  }
  const expected = index === metadata.totalChunks - 1
    ? metadata.size - (index * metadata.chunkSize)
    : metadata.chunkSize;
  if (bytes.byteLength !== expected) {
    throw new AppError('INVALID_CHUNK_SIZE', `Phần media ${index + 1} có kích thước không đúng.`);
  }

  const database = await openDatabase();
  const transaction = database.transaction([MEDIA_STORE, CHUNK_STORE], 'readwrite');
  const done = transactionDone(transaction);
  const chunks = transaction.objectStore(CHUNK_STORE);
  const existing = await requestResult(chunks.get([mediaId, index]));
  chunks.put({ mediaId, index, data: bytes.buffer, size: bytes.byteLength });
  if (!existing) {
    metadata.receivedChunks += 1;
    metadata.receivedBytes += bytes.byteLength;
  }
  metadata.updatedAt = Date.now();
  transaction.objectStore(MEDIA_STORE).put(metadata);
  await done;
  return {
    mediaId,
    index,
    receivedChunks: metadata.receivedChunks,
    totalChunks: metadata.totalChunks
  };
}

export async function commitMedia(mediaId) {
  const metadata = await getMediaMetadata(mediaId);
  if (!metadata) throw new AppError('MEDIA_NOT_FOUND', 'Không tìm thấy media.');
  if (metadata.receivedChunks !== metadata.totalChunks || metadata.receivedBytes !== metadata.size) {
    throw new AppError(
      'MEDIA_INCOMPLETE',
      `Media chưa đủ dữ liệu (${metadata.receivedChunks}/${metadata.totalChunks} phần).`
    );
  }
  metadata.committed = true;
  metadata.updatedAt = Date.now();
  const database = await openDatabase();
  const transaction = database.transaction(MEDIA_STORE, 'readwrite');
  transaction.objectStore(MEDIA_STORE).put(metadata);
  await transactionDone(transaction);
  return metadata;
}

export async function getMediaBlob(mediaId) {
  const metadata = await getMediaMetadata(mediaId);
  if (!metadata?.committed) throw new AppError('MEDIA_NOT_READY', 'Media chưa sẵn sàng để đăng.');
  const database = await openDatabase();
  const transaction = database.transaction(CHUNK_STORE, 'readonly');
  const done = transactionDone(transaction);
  const chunks = transaction.objectStore(CHUNK_STORE);
  const parts = [];
  for (let index = 0; index < metadata.totalChunks; index += 1) {
    const chunk = await requestResult(chunks.get([metadata.id, index]));
    if (!chunk?.data) throw new AppError('MEDIA_CORRUPTED', `Thiếu phần media số ${index + 1}.`);
    parts.push(chunk.data);
  }
  await done;
  return {
    metadata,
    blob: new Blob(parts, { type: metadata.type })
  };
}

export async function getMediaChunkBase64(mediaId, index) {
  const metadata = await getMediaMetadata(mediaId);
  if (!metadata?.committed) throw new AppError('MEDIA_NOT_READY', 'Media chưa sẵn sàng để đăng.');
  const chunkIndex = Number(index);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= metadata.totalChunks) {
    throw new AppError('INVALID_CHUNK_INDEX', 'Chỉ số phần media không hợp lệ.');
  }
  const database = await openDatabase();
  const transaction = database.transaction(CHUNK_STORE, 'readonly');
  const done = transactionDone(transaction);
  const chunk = await requestResult(
    transaction.objectStore(CHUNK_STORE).get([metadata.id, chunkIndex])
  );
  await done;
  if (!chunk?.data) throw new AppError('MEDIA_CORRUPTED', `Thiếu phần media số ${chunkIndex + 1}.`);
  return {
    mediaId: metadata.id,
    index: chunkIndex,
    totalChunks: metadata.totalChunks,
    data: bytesToBase64(chunk.data)
  };
}

export async function deleteMedia(mediaId) {
  const id = String(mediaId || '');
  if (!id) return;
  const database = await openDatabase();
  const transaction = database.transaction([MEDIA_STORE, CHUNK_STORE], 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(MEDIA_STORE).delete(id);
  const chunks = transaction.objectStore(CHUNK_STORE).index('by_media');
  const range = IDBKeyRange.only(id);
  await new Promise((resolve, reject) => {
    const cursorRequest = chunks.openKeyCursor(range);
    cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Không xóa được media.'));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      transaction.objectStore(CHUNK_STORE).delete(cursor.primaryKey);
      cursor.continue();
    };
  });
  await done;
}

export async function purgeExpiredMedia(maxAgeMs = 7 * 24 * 60 * 60 * 1000, protectedIds = []) {
  const keep = new Set(protectedIds.filter(Boolean).map(String));
  const database = await openDatabase();
  const transaction = database.transaction(MEDIA_STORE, 'readonly');
  const done = transactionDone(transaction);
  const records = await requestResult(transaction.objectStore(MEDIA_STORE).getAll());
  await done;
  const cutoff = Date.now() - maxAgeMs;
  for (const record of records) {
    if (!keep.has(record.id) && Number(record.updatedAt || record.createdAt || 0) < cutoff) {
      await deleteMedia(record.id);
    }
  }
}
