/** Fresh, patient-free Syslab reachability. A cached tab is not evidence of network access. */
(function (root) {
  'use strict';
  const SEARCH_URL = 'http://10.4.69.90/syslab/parbusqueRut.php';

  const verify = async readBytes => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(SEARCH_URL, {
        credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      if (!response.ok || response.url !== SEARCH_URL) throw new Error('unavailable');
      const html = new TextDecoder().decode(await readBytes(response));
      const page = new DOMParser().parseFromString(html, 'text/html');
      const loginRequired = Boolean(page.querySelector('input[type="password"], input[name="password"]'));
      if (!loginRequired && !page.querySelector('input[name="rut"]')) throw new Error('unrecognized');
      return { networkVerified: true, loginRequired, url: response.url };
    } catch (_error) {
      return { networkVerified: false, error: 'No se pudo comprobar el acceso local a Syslab.' };
    } finally {
      clearTimeout(timer);
    }
  };

  const status = async (message, cachedStatus, readBytes) => ({
    ok: true,
    ...cachedStatus,
    ...(message.verifyNetwork === true ? await verify(readBytes) : {}),
  });
  root.HhrSyslabNetworkProbe = Object.freeze({ status });
})(typeof self !== 'undefined' ? self : globalThis);
