/** Official DAU reads use an existing native tab or the extension's isolated login. */
(function (root) {
  'use strict';
  const messages = root.HhrUrgencyDauSource.messages;
  const readPdfInPage = root.HhrUrgencyDauPage.readPdfInPage;
  const create = ({ chrome, downloadPdfBuffer, native }) => {
    const source = root.HhrUrgencyDauSource.create({ chrome, native });
    const hasUsableNativeTab = async () => {
      const tab = await source.nativeTab();
      if (!tab) return false;
      try {
        const results = await chrome.scripting.executeScript({ target: { tabId: tab.id },
          world: 'MAIN', func: root.HhrUrgencySessionPage.isUsable });
        return results?.[0]?.result === true;
      } catch { return false; }
    };
    const prepareLogin = async sender => {
      if (!native || await native.sessionFor(sender) || await hasUsableNativeTab()) return null;
      return await native.begin(sender);
    };
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
    return { download, prepareLogin };
  };
  root.HhrUrgencyDau = { create, readPdfInPage };
})(typeof self !== 'undefined' ? self : globalThis);
