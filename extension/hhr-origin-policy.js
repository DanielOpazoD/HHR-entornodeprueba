/** Shared HHR origins for page bridges, clinical authorization and relay discovery. */
(function (root) {
  'use strict';
  const publishedOrigins = new Set([
    'https://hhr-hospitalizados.app',
    'https://testinghhr.netlify.app',
    'https://hhr-entorno-prueba.netlify.app',
  ]);
  const sourceOrigins = new Set([
    'https://fichamedico.rayensalud.cl',
    'https://hospitalizado.rayensalud.cl',
  ]);
  // Netlify preview, branch and deploy-permalink hosts retain the exact site suffix.
  const deploymentOrigin = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?--(?:testinghhr|hhr-entorno-prueba)\.netlify\.app$/;
  const localOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1):(?:300\d|301\d|3020)$/;
  const has = origin => typeof origin === 'string' && origin === origin.trim() && (
    publishedOrigins.has(origin) || localOrigin.test(origin) || deploymentOrigin.test(origin)
  );
  const originOf = url => typeof url === 'string'
    ? url.match(/^(https?:\/\/[^/?#]+)(?:[/?#]|$)/)?.[1]
    : undefined;
  const matchesUrl = url => has(originOf(url));
  const matchesRelayUrl = url => matchesUrl(url) || sourceOrigins.has(originOf(url));
  const matchesPattern = (url, pattern) => {
    if (typeof url !== 'string' || typeof pattern !== 'string') return false;
    if (pattern === 'https://*.netlify.app/*' && !matchesUrl(url)) return false;
    const escaped = pattern.replace(/[.+?^\${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$').test(url);
  };
  root.HhrAppOrigins = Object.freeze({ has, matchesUrl, matchesRelayUrl, matchesPattern });
})(typeof self !== 'undefined' ? self : globalThis);
