/** Action health checks own their acknowledgment; cached reports never certify an action. */
(function (root) {
  'use strict';

  const runtimeRequest = (type, message) => ({
    type,
    ...(message.verifySessions === true ? { verifySessions: true } : {}),
  });

  const create = dependencies => {
    const healthReportCache = root.HhrHealthReportCacheRuntime.create(dependencies);
    const handleExtensionHealth = async message => {
      const verifySessions = message?.verifySessions === true;
      const report = await healthReportCache.read({ verifySessions });
      return { ...report, syncPreflight: verifySessions };
    };
    return Object.freeze({ healthReportCache, handleExtensionHealth });
  };

  root.HhrHealthRequestRuntime = Object.freeze({ create, runtimeRequest });
})(typeof self !== 'undefined' ? self : globalThis);
