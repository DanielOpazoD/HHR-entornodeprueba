/** Rayen's native authentication and read-only DAU API; credentials never leave this boundary. */
(function (root) {
  'use strict';
  const messages = {
    LOGIN: 'Inicia sesión en Urgencias para descargar el DAU.',
    ACCESS: 'Rayen no confirmó el acceso. Revisa usuario, contraseña y dominio.',
    READ: 'No se pudo consultar Rayen Urgencias. Reintenta.',
    SESSION: 'La sesión clínica cambió. Vuelve a solicitar el DAU.',
    EXPIRED: 'El acceso de Urgencias venció. Vuelve a solicitar el DAU.',
    IDENTITY: 'No se pudo verificar el paciente y la atención del DAU.',
    FACILITY: 'La atención corresponde a otro establecimiento de Urgencias.',
    MFA_SETUP: 'Rayen requiere configurar la verificación de tu cuenta. Completa esa configuración en Rayen y reintenta.',
    OTP: 'Rayen no confirmó el código de verificación. Reintenta.',
  };
  const fail = code => { throw Object.assign(new Error(messages[code] || messages.READ), { dauCode: code }); };
  const positiveId = value => /^[1-9]\d*$/.test(String(value));
  const sameId = (left, right) => positiveId(left) && String(left) === String(right);
  const readPdf = async response => {
    if (!/^application\/pdf(?:;|$)/i.test(response.headers.get('content-type') || '')) fail('READ');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 5 || bytes.length > 15000000 ||
        String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') fail('READ');
    return bytes;
  };
  const requestOptions = ({ body, token, pdf, signal }) => ({
    method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store',
    redirect: 'error', referrerPolicy: 'no-referrer', signal,
    headers: { Accept: pdf ? 'application/pdf' : 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `SDX-TICKET ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const create = ({ fetchImpl }) => {
    const read = async (path, { body, token, pdf = false, assertCurrent = async () => {} } = {}) => {
      const url = new URL(path, 'https://api.saludenred.cl');
      if (url.origin !== 'https://api.saludenred.cl' || !url.pathname.startsWith('/api/')) fail('READ');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        await assertCurrent();
        const response = await fetchImpl(url.href, requestOptions({ body, token, pdf, signal: controller.signal }));
        await assertCurrent();
        if ([401, 403].includes(response.status)) fail(token ? 'LOGIN' : 'ACCESS');
        if (!response.ok) fail(body ? 'ACCESS' : 'READ');
        const result = pdf ? await readPdf(response) : await response.json();
        await assertCurrent();
        return result;
      } catch (error) {
        if (error?.dauCode) throw error;
        fail('READ');
      } finally { clearTimeout(timer); }
    };
    return { read };
  };
  root.HhrUrgencyApi = { create, fail, messages, positiveId, sameId };
})(typeof self !== 'undefined' ? self : globalThis);
