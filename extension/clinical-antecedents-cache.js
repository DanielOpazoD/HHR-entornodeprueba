/** Ephemeral HCC reads: coalesce synchronously and expire 30s after settlement. */
(function (root) {
  'use strict';
  const remember = (cache, key, value, fallback) => {
    const entry = { value, result: undefined, expiresAt: Infinity, fallback };
    cache.set(key, entry);
    void Promise.resolve(value).then(result => {
      entry.result = result;
      entry.fallback = undefined;
      entry.expiresAt = Date.now() + 30000;
      setTimeout(() => { if (cache.get(key) === entry) cache.delete(key); }, 30000);
    }, () => {
      if (cache.get(key) !== entry) return;
      if (fallback?.expiresAt > Date.now()) cache.set(key, fallback);
      else cache.delete(key);
    });
  };
  const readHistory = (cache, key, retryPartial) => {
    const entry = cache.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return;
    if (!retryPartial && entry.fallback?.expiresAt > Date.now()) return entry.fallback.value;
    if (entry.expiresAt === Infinity || !retryPartial || !entry.result?.warnings?.length)
      return entry.value;
  };
  root.HhrClinicalAntecedentsCache = { remember, readHistory };
})(typeof self !== 'undefined' ? self : globalThis);
