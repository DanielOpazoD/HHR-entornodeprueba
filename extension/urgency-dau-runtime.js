/** Official DAU reads use an existing native tab or the extension's isolated login. */
(function (root) {
  'use strict';
  const messages = root.HhrUrgencyDauSource.messages;
  const readPdfInPage = root.HhrUrgencyDauPage.readPdfInPage;
  const create = ({ chrome, downloadPdfBuffer, native }) => {
    const source = root.HhrUrgencyDauSource.create({ chrome, native });
    const download = async ({ patientRun, attentionId, assertAuthorization, sender }) => {
      if (!/^[0-9]+[0-9K]$/.test(patientRun || '') || !/^\d+$/.test(attentionId || ''))
        throw new Error(messages.IDENTITY);
      const result = await source.read({ patientRun, attentionId, assertAuthorization, sender });
      if (result.auth) return result;
      const bytes = result.bytes;
      await result.assertCurrent();
      const downloaded = await downloadPdfBuffer({ buffer: bytes.buffer, filename: `DAU_${attentionId}.pdf`, saveAs: true });
      if (downloaded?.ok !== true || !Number.isInteger(downloaded.downloadId)) throw new Error(messages.READ);
      return { ok: true, opened: true };
    };
    return { download };
  };
  root.HhrUrgencyDau = { create, readPdfInPage };
})(typeof self !== 'undefined' ? self : globalThis);
