/** Temporary, tab-bound prepared PDFs. Printing consumes the exact previewed bytes. */
(() => {
  'use strict';
  const PREFIX = 'hhr-document-preview-';
  const TTL = 10 * 60 * 1000;
  const create = ({ chromeApi, cryptoApi, bufferToBase64, base64ToArrayBuffer, openPdfPrintDialog, now }) => {
    const busy = new Set();
    const owner = sender => {
      try {
        const url = new URL(sender?.url || sender?.tab?.url || '');
        return url.origin === 'https://fichamedico.rayensalud.cl' && Number.isInteger(sender?.tab?.id)
          ? { tabId: sender.tab.id, url: url.href } : null;
      } catch (_error) { return null; }
    };
    const prepare = async ({ buffer, filename, sender }) => {
      const source = owner(sender);
      if (!source) return { error: 'Abre la vista previa desde la pestaña de Ficha Médico.' };
      if (!buffer?.byteLength) return { error: 'El documento está vacío.' };
      if (buffer.byteLength > 5 * 1024 * 1024) return {
        error: 'El documento supera el tamaño disponible para la vista previa.', errorCode: 'PREVIEW_TOO_LARGE',
      };
      try {
        const stored = await chromeApi.storage.session.get(null);
        const obsolete = Object.entries(stored).filter(([key, job]) => key.startsWith(PREFIX) &&
          (!job || now() - Number(job.createdAt || 0) > TTL)).map(([key]) => key);
        if (obsolete.length) await chromeApi.storage.session.remove(obsolete);
        const jobId = cryptoApi.randomUUID();
        const pdfBase64 = bufferToBase64(buffer);
        await chromeApi.storage.session.set({ [PREFIX + jobId]: {
          ...source, filename, base64: pdfBase64, createdAt: now(),
        } });
        return { ok: true, jobId, pdfBase64, filename };
      } catch (_error) {
        return { error: 'No hay espacio temporal disponible para preparar la vista previa.',
          errorCode: 'PREVIEW_STORAGE_UNAVAILABLE' };
      }
    };
    const handle = async ({ jobId, operation }, sender) => {
      const source = owner(sender);
      if (!source || !/^[a-f0-9-]{20,}$/i.test(String(jobId || '')) || !['print', 'release'].includes(operation)) {
        return { error: 'La solicitud de vista previa no es válida.' };
      }
      if (busy.has(jobId)) return { error: 'Este documento ya se está preparando para imprimir.' };
      busy.add(jobId);
      try {
        const key = PREFIX + jobId;
        const stored = await chromeApi.storage.session.get(key);
        const job = stored[key];
        if (operation === 'release' && !job) return { ok: true };
        if (!job || job.tabId !== source.tabId) return { error: 'La vista previa ya no está disponible en esta pestaña.' };
        if (operation === 'release') { await chromeApi.storage.session.remove(key); return { ok: true }; }
        if (job.url !== source.url || now() - Number(job.createdAt || 0) > TTL) {
          await chromeApi.storage.session.remove(key);
          return { error: 'La vista previa venció o cambió el episodio. Vuelve al documento y prepárala de nuevo.' };
        }
        await chromeApi.storage.session.remove(key);
        return openPdfPrintDialog({ buffer: base64ToArrayBuffer(job.base64), filename: job.filename });
      } finally { busy.delete(jobId); }
    };
    return Object.freeze({ prepare, handle });
  };
  globalThis.HhrDocumentPreviewJobs = Object.freeze({ create });
})();
