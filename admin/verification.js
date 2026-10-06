export const verificationText = (uid, cookieString = '', userAgent = '') =>
  uid ? `${uid}|${cookieString ?? ''}|${userAgent ?? ''}` : '';

// Preserve the original cookie and User-Agent. Older senders used UID|User-Agent.
export function storedVerificationText(source = {}) {
  const raw = source.verification_text ?? source.verificationText ?? source.identityText;
  const cookieString = source.cookieString ?? source.cookie_string ?? '';
  const userAgent = source.userAgent ?? source.user_agent ?? '';

  if (typeof raw !== 'string' || !raw) {
    return verificationText(source.uid ?? source.facebookUid ?? source.account_uid ?? source.facebook_uid,
      cookieString, userAgent);
  }

  const separator = raw.indexOf('|');
  if (separator < 0) return verificationText(raw, cookieString, userAgent);

  const uid = raw.slice(0, separator);
  const remainder = raw.slice(separator + 1);
  if (!uid) return '';
  if (remainder.includes('|')) return raw;
  return verificationText(uid, cookieString, remainder);
}
