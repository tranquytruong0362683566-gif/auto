(function () {
  'use strict';
  if (globalThis.TQT_DASHBOARD_POLICY) return;

  const githubOrigin = 'https://tranquytruong0362683566-gif.github.io';
  const customOrigin = 'https://tranquytruong.top';
  const dashboardPaths = Object.freeze({
    [githubOrigin]: Object.freeze(['/auto', '/auto/', '/auto/index.html']),
    [customOrigin]: Object.freeze(['/', '/index.html', '/auto', '/auto/', '/auto/index.html'])
  });

  function allowedUrl(value, paths) {
    try {
      const url = new URL(value);
      return url.username === '' && url.password === '' &&
        Object.hasOwn(paths, url.origin) && paths[url.origin].includes(url.pathname);
    } catch { return false; }
  }

  Object.defineProperty(globalThis, 'TQT_DASHBOARD_POLICY', {value: Object.freeze({
    dashboardUrl: githubOrigin + '/auto/',
    customDashboardUrl: customOrigin + '/',
    matches: Object.freeze([githubOrigin + '/auto', githubOrigin + '/auto/*', customOrigin + '/*']),
    isDashboardUrl: value => allowedUrl(value, dashboardPaths)
  })});
}());
