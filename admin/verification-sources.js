// User-Agent only supplies a display label; it is never used to grant a KEY.
export function browserName(userAgent = '') {
  if (/coc_coc_browser|coccoc|coc\s*coc/i.test(userAgent)) return 'Cốc Cốc';
  if (/Edg(?:e|A|iOS)?\//i.test(userAgent)) return 'Microsoft Edge';
  if (/OPR\/|Opera\//i.test(userAgent)) return 'Opera';
  if (/Firefox\/|FxiOS\//i.test(userAgent)) return 'Firefox';
  if (/Chrome\/|CriOS\//i.test(userAgent)) return 'Google Chrome';
  if (/Safari\//i.test(userAgent)) return 'Safari';
  return userAgent ? 'Trình duyệt khác' : 'Chưa nhận User-Agent';
}
export function sourceLabel(source = {}) {
  if (source.legacy) return 'Dữ liệu trước nâng cấp · chưa xác định nguồn';
  const id = String(source.installation_id || source.source_id || '');
  return 'Hồ sơ ' + (id ? id.slice(0, 8) + '…' + id.slice(-4) : 'chưa xác định');
}
