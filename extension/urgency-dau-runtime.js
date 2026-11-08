/** Official DAU reads use Rayen Urgencias' own authenticated HTTP client. */
(function (root) {
  'use strict';
  const messages = {
    LOGIN: 'Abre Rayen Urgencias e inicia sesión para descargar el DAU oficial.',
    SESSION: 'La sesión de Urgencias cambió. Reintenta la descarga.',
    IDENTITY: 'Urgencias no permite verificar el DAU de esta atención y paciente.',
    FACILITY: 'Abre Urgencias en el establecimiento de la atención para descargar su DAU.',
    CONTRACT: 'Rayen Urgencias no entregó un enlace de DAU válido.',
    PDF: 'Rayen Urgencias no entregó un PDF válido. Reintenta.',
    READ: 'No se pudo descargar el DAU oficial desde Rayen Urgencias. Reintenta.',
  };
  const readPdfInPage = root.HhrUrgencyDauPage.readPdfInPage;
  const pdfBytesFor = result => {
    if (!result?.ok) throw new Error(messages[result?.code] || messages.READ);
    if (typeof result.base64 !== 'string' || result.base64.length > 20000000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(result.base64)) throw new Error(messages.PDF);
    const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0));
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error(messages.PDF);
    return bytes;
  };
  const create = ({ chrome, downloadPdfBuffer }) => {
    const download = async ({ patientRun, attentionId, assertAuthorization }) => {
      if (!/^[0-9]+[0-9K]$/.test(patientRun || '') || !/^\d+$/.test(attentionId || ''))
        throw new Error(messages.IDENTITY);
      const tabs = await chrome.tabs.query({ url: 'https://urgencia.saludenred.cl/Emergency/*' });
      const tab = tabs.filter(t => t.id && /^https:\/\/urgencia\.saludenred\.cl\/Emergency\//.test(t.url || ''))
        .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      if (!tab) throw new Error(messages.LOGIN);
      await assertAuthorization();
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id },
        world: 'MAIN', func: readPdfInPage, args: [{ patientRun, attentionId }] });
      await assertAuthorization();
      const bytes = pdfBytesFor(results?.[0]?.result);
      await assertAuthorization();
      const downloaded = await downloadPdfBuffer({ buffer: bytes.buffer, filename: `DAU_${attentionId}.pdf`, saveAs: true });
      if (downloaded?.ok !== true || !Number.isInteger(downloaded.downloadId)) throw new Error(messages.READ);
      return { ok: true, opened: true };
    };
    return { download };
  };
  root.HhrUrgencyDau = { create, readPdfInPage };
})(typeof self !== 'undefined' ? self : globalThis);
