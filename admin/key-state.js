// Use the server clock and stored deadline. Opening ADMIN never creates a new trial.
export const STATUS_LABELS = Object.freeze({
  trial: 'Dùng thử 12 giờ', active: 'Đã duyệt', pending: 'Chờ duyệt',
  expired: 'Hết hạn · Chờ duyệt', blocked: 'Đã khóa', archived: 'Đã lưu trữ'
});

export function keyStatus(key, now) {
  if (key.archived_at || key.key_status === 'archived') return 'archived';
  if (key.status === 'blocked' || key.key_status === 'blocked') return 'blocked';
  const deadline = key.expires_at ? Date.parse(key.expires_at) : NaN;
  if (Number.isFinite(deadline) && deadline <= now) return 'expired';
  if (key.status !== 'active') return 'pending';
  return key.key_status === 'trial' ? 'trial' : 'active';
}

export function remainingText(key, now) {
  const state = keyStatus(key, now);
  if (state === 'archived') return 'Khôi phục để quản lý KEY';
  if (state === 'blocked') return 'Quyền sử dụng đã bị khóa';
  if (state === 'expired') return 'Chờ ADMIN duyệt hoặc gia hạn';
  if (state === 'pending') return 'Chờ ADMIN duyệt KEY';
  if (!key.expires_at) return 'Không thời hạn';
  const seconds = Math.max(0, Math.ceil((Date.parse(key.expires_at) - now) / 1000));
  if (!Number.isFinite(seconds)) return 'Chưa có thời hạn hợp lệ';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const value = days ? `${days} ngày ${hours} giờ` : hours ? `${hours} giờ ${minutes} phút`
    : minutes ? `${minutes} phút` : `${seconds} giây`;
  return (state === 'trial' ? 'Dùng thử còn ' : 'Còn ') + value;
}

export function durationHours(value, customValue, unit) {
  if (value === 'unlimited') return null;
  const hours = value === 'custom' ? Number(customValue) * Number(unit) : Number(value);
  if ((value === 'custom' && (!Number.isInteger(Number(customValue)) || Number(customValue) < 1
      || !['1', '24'].includes(String(unit)))) || !Number.isInteger(hours) || hours < 1 || hours > 87600) {
    throw new Error('Nhập thời gian từ 1 đến 87.600 giờ, tối đa 3.650 ngày.');
  }
  return hours;
}
