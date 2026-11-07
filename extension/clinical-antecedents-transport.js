/** Each authenticated HCC reader closes over its own ephemeral viewer token. */
(function (root) {
  'use strict';
  const API = 'https://saludteintegrachileapi.rayensalud.cl';
  const create = ({ fetchImpl }) => {
    const externalJson = async (path, parameter, value, timeoutMs = 15000, sessionToken) => {
      const url = new URL(path, API);
      url.searchParams.set(parameter, JSON.stringify(value));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.href, {
          headers: {
            Accept: 'application/json, text/plain, */*',
            ...(sessionToken ? { Authorization: `VHCC-TICKET ${sessionToken}` } : {}),
          },
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Visor de antecedentes: HTTP ${response.status}`);
        try { return await response.json(); }
        catch { throw new Error('El visor devolvió una respuesta no JSON.'); }
      } finally {
        clearTimeout(timer);
      }
    };
    return async accessToken => {
      const token = await externalJson('/api/ObtenerToken', 'Parametro', { TokenAcceso: accessToken });
      const sessionToken = token?.ObtenerTokenSesionResult?.TokenSesion;
      if (typeof sessionToken !== 'string' || !sessionToken.trim())
        throw new Error('La sesión del visor de antecedentes venció.');
      return (path, parameter, value, timeoutMs) =>
        externalJson(path, parameter, value, timeoutMs, sessionToken);
    };
  };
  root.HhrClinicalAntecedentsTransport = { create };
})(typeof self !== 'undefined' ? self : globalThis);
