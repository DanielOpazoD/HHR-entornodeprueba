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
  // Self-contained: chrome.scripting serializes this function into the native page.
  const readPdfInPage = async ({ patientRun, attentionId }) => {
    const fail = code => { throw { dauCode: code }; };
    const cleanRun = value => String(value || '').replace(/[^0-9k]/gi, '').toUpperCase();
    const sameId = (left, right) => /^[1-9]\d*$/.test(String(left)) && String(left) === String(right);
    try {
      if (location.origin !== 'https://urgencia.saludenred.cl' ||
          !location.pathname.startsWith('/Emergency/')) fail('LOGIN');
      const injector = window.angular?.element(document.body).injector();
      if (!injector) fail('LOGIN');
      const login = injector.get('loginService');
      const owner = () => `${login.getCurrentFacility()?.Id}:${login.getCurrentStaffMember()?.Id}`;
      const initialOwner = owner();
      if (!/^[1-9]\d*:[1-9]\d*$/.test(initialOwner)) fail('LOGIN');
      const assertOwner = () => { if (owner() !== initialOwner) fail('SESSION'); };
      const deadline = Date.now() + 60000;
      const http = injector.get('$http');
      const read = async (url, options = {}) => {
        assertOwner();
        const target = new URL(url, location.href);
        if (target.origin !== 'https://api.saludenred.cl' || !target.pathname.startsWith('/api/'))
          fail('CONTRACT');
        const remaining = deadline - Date.now();
        if (remaining <= 0) fail('READ');
        const response = await http.get(target.href, { ...options, timeout: remaining });
        assertOwner();
        if (response.status !== 200) fail('READ');
        return response;
      };
      const searchUrl = injector.get('API').ADMISSIONS.BY_IDENT('Rut', patientRun, 0, null);
      const verifiedAdmission = rows => {
        if (!Array.isArray(rows)) fail('IDENTITY');
        const matches = rows.filter(row => {
          const patient = row?.Patient, care = row?.PatientCare;
          if (!patient || !care) return false;
          return !row.IsDeleted && !care.IsDeleted && !patient.IsDeleted && care.IsEmergency === true &&
            String(care.Id) === attentionId && cleanRun(patient.Rut) === patientRun &&
            sameId(care.IdPatient, patient.Id) && sameId(care.IdEmergencyAdmission, row.Id);
        });
        if (matches.length !== 1) fail('IDENTITY');
        if (String(matches[0].PatientCare.IdHealthCareCenter) !== initialOwner.split(':')[0]) fail('FACILITY');
        return injector.get('EmergencyAdmissionService').newResource(matches[0]);
      };
      const officialReport = admission => {
        const reportUrl = injector.get('$filter')('DAUReport')(admission.PatientCare);
        const report = new URL(reportUrl, location.href);
        const expected = { nodId: admission.PatientCare.IdHealthCareCenter,
          iurgId: admission.Id, atenId: admission.PatientCare.Id };
        if (report.origin !== 'https://api.saludenred.cl' || report.pathname !== '/api/reportes/DAU_C.pdf')
          fail('CONTRACT');
        for (const [key, value] of Object.entries(expected))
          if (!/^\d+$/.test(String(value)) || report.searchParams.getAll(key).length !== 1 ||
              report.searchParams.get(key) !== String(value)) fail('CONTRACT');
        if (report.searchParams.getAll('uspId').length !== 1 ||
            !sameId(report.searchParams.get('uspId'), initialOwner.split(':')[1])) fail('CONTRACT');
        return report.href;
      };
      const encodePdf = pdf => {
        const bytes = new Uint8Array(pdf.data);
        if (bytes.length < 5 || bytes.length > 15000000 ||
            String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-' ||
            !/^application\/pdf(?:;|$)/i.test(pdf.headers('content-type') || '')) fail('PDF');
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      };
      const response = await read(searchUrl);
      const admission = verifiedAdmission(response.data);
      const pdf = await read(officialReport(admission), { responseType: 'arraybuffer' });
      const base64 = encodePdf(pdf);
      assertOwner();
      return { ok: true, base64 };
    } catch (error) {
      return { ok: false, code: error?.dauCode || 'READ' };
    }
  };
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
      const downloaded = await downloadPdfBuffer({ buffer: bytes.buffer, filename: `DAU_${attentionId}.pdf` });
      if (downloaded?.ok !== true || !Number.isInteger(downloaded.downloadId)) throw new Error(messages.READ);
      return { ok: true, opened: true };
    };
    return { download };
  };
  root.HhrUrgencyDau = { create, readPdfInPage };
})(typeof self !== 'undefined' ? self : globalThis);
