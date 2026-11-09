/** Chooses a native API session or an already-open Urgencias tab with the same delivery fences. */
(function (root) {
  'use strict';
  const messages = {
    LOGIN: 'Inicia sesión en Urgencias aquí para descargar el DAU oficial.',
    SESSION: 'La sesión clínica cambió. Reintenta la descarga.',
    IDENTITY: 'Urgencias no permite verificar el DAU de esta atención y paciente.',
    FACILITY: 'La atención corresponde a otro establecimiento de Urgencias.',
    CONTRACT: 'Rayen Urgencias no entregó un enlace de DAU válido.',
    PDF: 'Rayen Urgencias no entregó un PDF válido. Reintenta.',
    READ: 'No se pudo descargar el DAU oficial desde Rayen Urgencias. Reintenta.',
  };
  const fail = code => { throw Object.assign(new Error(messages[code] || messages.READ), { dauCode: code }); };
  const pdfBytesFor = result => {
    if (!result?.ok) fail(result?.code || 'READ');
    if (typeof result.base64 !== 'string' || result.base64.length > 20000000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(result.base64)) fail('PDF');
    const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0));
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') fail('PDF');
    return bytes;
  };
  const create = ({ chrome, native }) => {
    const nativeTab = async () => (await chrome.tabs.query({ url: 'https://urgencia.saludenred.cl/Emergency/*' }))
      .filter(t => t.id && /^https:\/\/urgencia\.saludenred\.cl\/Emergency\//.test(t.url || ''))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    const readTab = async ({ patientRun, attentionId, assertAuthorization }) => {
      const tab = await nativeTab();
      if (!tab) fail('LOGIN');
      await assertAuthorization();
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id },
        world: 'MAIN', func: root.HhrUrgencyDauPage.readPdfInPage, args: [{ patientRun, attentionId }] });
      await assertAuthorization();
      return pdfBytesFor(results?.[0]?.result);
    };
    const read = async ({ patientRun, attentionId, assertAuthorization, sender }) => {
      const session = await native?.sessionFor(sender);
      const assertCurrent = async () => {
        try { await assertAuthorization(); } catch { fail('SESSION'); }
        if (session) await session.assertCurrent();
      };
      await assertCurrent();
      try {
        const bytes = session
          ? await native.readDau({ patientRun, attentionId, session, assertCurrent })
          : await readTab({ patientRun, attentionId, assertAuthorization: assertCurrent });
        return { bytes, assertCurrent };
      } catch (error) {
        const code = error?.dauCode;
        if (!native || !['LOGIN', 'FACILITY', 'IDENTITY'].includes(code)) throw new Error(messages[code] || messages.READ);
        await assertAuthorization();
        if (session) await native.remove(session.id);
        const result = await native.begin(sender);
        return { ...result, error: messages[code],
          auth: { ...result.auth, ...(code === 'LOGIN' ? {} : { reason: 'profile' }) } };
      }
    };
    return { read, nativeTab };
  };
  root.HhrUrgencyDauSource = { create, messages };
})(typeof self !== 'undefined' ? self : globalThis);
