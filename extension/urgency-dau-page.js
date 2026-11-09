(function (root) {
  'use strict';
  // Self-contained: chrome.scripting serializes this function into the native page.
  const readPdfInPage = async ({ patientRun, attentionId }) => {
    const fail = code => { throw { dauCode: code }; };
    const cleanRun = value => String(value || '').replace(/[^0-9k]/gi, '').toUpperCase();
    const positiveId = value => /^[1-9]\d*$/.test(String(value));
    const sameId = (left, right) => positiveId(left) && String(left) === String(right);
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
      const withinDeadline = async work => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) fail('READ');
        let timer;
        try {
          return await Promise.race([work(), new Promise((_, reject) => {
            timer = setTimeout(() => reject({ dauCode: 'READ' }), remaining);
          })]);
        } finally { clearTimeout(timer); }
      };
      const verifyLoaded = (admission, expected) => {
        const patient = admission.Patient, care = admission.PatientCare;
        if (!patient || !care) fail('IDENTITY');
        if (admission.IsDeleted || patient.IsDeleted || care.IsDeleted || care.IsEmergency !== true ||
            cleanRun(patient.Rut) !== patientRun || !sameId(care.Id, attentionId) ||
            !sameId(patient.Id, expected.patientId) || !sameId(admission.Id, expected.admissionId) ||
            !sameId(care.IdPatient, expected.patientId) || !sameId(care.IdEmergencyAdmission, expected.admissionId))
          fail('IDENTITY');
        if (!sameId(care.IdHealthCareCenter, initialOwner.split(':')[0])) fail('FACILITY');
      };
      const verifiedAdmission = async rows => {
        if (!Array.isArray(rows)) fail('IDENTITY');
        const matches = rows.filter(row => {
          const patient = row?.Patient, care = row?.PatientCare;
          if (!patient || !care) return false;
          return !row.IsDeleted && !care.IsDeleted && !patient.IsDeleted &&
            positiveId(row.Id) && positiveId(patient.Id) && sameId(care.Id, attentionId) &&
            cleanRun(patient.Rut) === patientRun;
        });
        if (matches.length !== 1) fail('IDENTITY');
        if (!sameId(matches[0].IdFacility, initialOwner.split(':')[0])) fail('FACILITY');
        const expected = { patientId: matches[0].Patient.Id, admissionId: matches[0].Id };
        const admission = injector.get('EmergencyAdmissionService').newResource(matches[0]);
        assertOwner();
        // Historical summaries have default care fields; the official report modal hydrates them first.
        await withinDeadline(() => injector.get('PatientCareService').loadFull(admission, true));
        assertOwner();
        verifyLoaded(admission, expected);
        return admission;
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
        // Rayen's DAU filter passes PatientCare.IdPatient as uspId, not the active staff ID.
        if (report.searchParams.getAll('uspId').length !== 1 ||
            !sameId(report.searchParams.get('uspId'), admission.Patient.Id)) fail('CONTRACT');
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
      const admission = await verifiedAdmission(response.data);
      const pdf = await read(officialReport(admission), { responseType: 'arraybuffer' });
      const base64 = encodePdf(pdf);
      assertOwner();
      return { ok: true, base64 };
    } catch (error) {
      return { ok: false, code: error?.dauCode || ([401, 403].includes(error?.status) ? 'LOGIN' : 'READ') };
    }
  };
  root.HhrUrgencyDauPage = { readPdfInPage };
})(typeof self !== 'undefined' ? self : globalThis);
