// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../extension/urgency-dau-page.js';
import '../../../extension/urgency-dau-runtime.js';

type PdfResult = { ok: boolean; base64?: string; code?: string };
type Selection = { patientRun: string; attentionId: string };
type ScriptInput = { target: { tabId: number }; world: string; func: unknown; args: Selection[] };
const runtime = (
  globalThis as typeof globalThis & {
    HhrUrgencyDau: {
      readPdfInPage: (selection: Selection) => Promise<PdfResult>;
      create: (deps: {
        chrome: { tabs: { query: unknown }; scripting: { executeScript: unknown } };
        downloadPdfBuffer: unknown;
      }) => {
        download: (
          selection: Selection & { assertAuthorization: () => Promise<void> }
        ) => Promise<unknown>;
      };
    };
  }
).HhrUrgencyDau;
const selection = { patientRun: '111111111', attentionId: '8' };
const pdfBytes = new TextEncoder().encode('%PDF-1.7 synthetic fixture');
const reportUrl =
  'https://api.saludenred.cl/api/reportes/DAU_C.pdf?timeDifference=300&nodId=9&iurgId=7&atenId=8&uspId=6';
const makeAdmission = () => ({
  Id: 7,
  IdFacility: 9,
  Patient: { Id: 42, Rut: '11.111.111-1' },
  PatientCare: {
    Id: 8,
    IdPatient: 42,
    IdEmergencyAdmission: 7,
    IdHealthCareCenter: 9,
    IsEmergency: true,
  },
});
const nativeHarness = () => {
  const admission = makeAdmission();
  const rows = [admission];
  const owner = { staff: 6 };
  const report = { url: reportUrl };
  const pdf = { data: pdfBytes.buffer, contentType: 'application/pdf' };
  const http = {
    get: vi.fn(async (url: string) =>
      url.includes('/reportes/')
        ? { status: 200, data: pdf.data, headers: () => pdf.contentType }
        : { status: 200, data: rows }
    ),
  };
  const byIdent = vi.fn(() => 'https://api.saludenred.cl/api/emergencyAdmissions?Rut=111111111');
  const reportFilter = vi.fn(() => report.url);
  const loadFull = vi.fn(
    async (_admission: ReturnType<typeof makeAdmission>, _historical: boolean): Promise<void> => {}
  );
  const services: Record<string, unknown> = {
    loginService: {
      getCurrentFacility: () => ({ Id: 9 }),
      getCurrentStaffMember: () => ({ Id: owner.staff }),
    },
    $http: http,
    API: { ADMISSIONS: { BY_IDENT: byIdent } },
    EmergencyAdmissionService: { newResource: (row: unknown) => row },
    PatientCareService: { loadFull },
    $filter: vi.fn(() => reportFilter),
  };
  vi.stubGlobal('location', {
    origin: 'https://urgencia.saludenred.cl',
    pathname: '/Emergency/',
    href: 'https://urgencia.saludenred.cl/Emergency/',
  });
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('window', {
    angular: { element: () => ({ injector: () => ({ get: (key: string) => services[key] }) }) },
  });
  return { admission, rows, owner, http, byIdent, report, pdf, reportFilter, loadFull };
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('official DAU through the native authenticated Rayen client', () => {
  it('completa la atención histórica antes de verificar relaciones y generar el DAU', async () => {
    const h = nativeHarness();
    const completeCare = { ...h.admission.PatientCare };
    h.admission.PatientCare.IdPatient = 0;
    h.admission.PatientCare.IdEmergencyAdmission = 0;
    h.admission.PatientCare.IdHealthCareCenter = 0;
    h.admission.PatientCare.IsEmergency = false;
    h.loadFull.mockImplementation(async admission => {
      admission.PatientCare = completeCare;
    });
    expect(await runtime.readPdfInPage(selection)).toEqual({
      ok: true,
      base64: btoa(new TextDecoder().decode(pdfBytes)),
    });
    expect(h.loadFull).toHaveBeenCalledWith(h.admission, true);
    expect(h.reportFilter).toHaveBeenCalledWith(completeCare);
  });
  it.each(['care', 'patient', 'admission', 'relationship'] as const)(
    'rejects a %s substitution during hydration',
    async kind => {
      const h = nativeHarness();
      h.loadFull.mockImplementation(async admission => {
        if (kind === 'care') admission.PatientCare.Id = 99;
        if (kind === 'patient') {
          admission.Patient.Id = 99;
          admission.PatientCare.IdPatient = 99;
        }
        if (kind === 'admission') {
          admission.Id = 99;
          admission.PatientCare.IdEmergencyAdmission = 99;
        }
        if (kind === 'relationship') admission.PatientCare.IdPatient = 99;
      });
      expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'IDENTITY' });
      expect(h.reportFilter).not.toHaveBeenCalled();
      expect(h.http.get).toHaveBeenCalledTimes(1);
    }
  );
  it('does not hydrate a matching care under the wrong patient or facility', async () => {
    const h = nativeHarness();
    h.admission.Patient.Rut = '222222222';
    expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'IDENTITY' });
    expect(h.loadFull).not.toHaveBeenCalled();
    h.admission.Patient.Rut = '111111111';
    h.admission.IdFacility = 99;
    expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'FACILITY' });
    expect(h.loadFull).not.toHaveBeenCalled();
  });
  it('cancels when the native owner changes during hydration', async () => {
    const h = nativeHarness();
    h.loadFull.mockImplementation(async () => {
      h.owner.staff = 99;
    });
    expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'SESSION' });
    expect(h.reportFilter).not.toHaveBeenCalled();
  });
  it('times out hydration and never requests a late PDF', async () => {
    vi.useFakeTimers();
    const h = nativeHarness();
    let finish: () => void = () => undefined;
    h.loadFull.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    const result = runtime.readPdfInPage(selection);
    await vi.advanceTimersByTimeAsync(60001);
    expect(await result).toEqual({ ok: false, code: 'READ' });
    finish();
    await Promise.resolve();
    expect(h.reportFilter).not.toHaveBeenCalled();
    expect(h.http.get).toHaveBeenCalledTimes(1);
  });
  it('verifies patient and exact care ID before reading the official PDF', async () => {
    const h = nativeHarness();
    const result = await runtime.readPdfInPage(selection);
    expect(result).toEqual({ ok: true, base64: btoa(new TextDecoder().decode(pdfBytes)) });
    expect(h.byIdent).toHaveBeenCalledWith('Rut', selection.patientRun, 0, null);
    expect(h.reportFilter).toHaveBeenCalledWith(h.admission.PatientCare);
    expect(h.http.get.mock.calls.map(([url]) => url)).toEqual([
      'https://api.saludenred.cl/api/emergencyAdmissions?Rut=111111111',
      reportUrl,
    ]);
  });
  it.each(['patient', 'care', 'relationship', 'duplicate'] as const)(
    'rejects %s mismatch before reading a PDF',
    async kind => {
      const h = nativeHarness();
      if (kind === 'patient') h.admission.Patient.Rut = '222222222';
      if (kind === 'care') h.admission.PatientCare.Id = 99;
      if (kind === 'relationship') h.admission.PatientCare.IdPatient = 99;
      if (kind === 'duplicate') h.rows.push(makeAdmission());
      expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'IDENTITY' });
      expect(h.http.get).toHaveBeenCalledTimes(1);
      expect(h.reportFilter).not.toHaveBeenCalled();
    }
  );
  it.each(['other-origin', 'other-care', 'other-admission', 'other-center'] as const)(
    'rejects a report URL for %s',
    async kind => {
      const h = nativeHarness();
      h.report.url =
        kind === 'other-origin'
          ? reportUrl.replace('api.saludenred.cl', 'example.invalid')
          : kind === 'other-care'
            ? reportUrl.replace('atenId=8', 'atenId=99')
            : kind === 'other-admission'
              ? reportUrl.replace('iurgId=7', 'iurgId=99')
              : reportUrl.replace('nodId=9', 'nodId=99');
      expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'CONTRACT' });
      expect(h.http.get).toHaveBeenCalledTimes(1);
    }
  );
  it('rejects HTML returned as PDF and returns no native error or credential', async () => {
    const h = nativeHarness();
    h.pdf.data = new TextEncoder().encode('<html>not a PDF</html>').buffer;
    expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'PDF' });
    h.http.get.mockRejectedValue(new Error('Authorization: PRIVATE-FIXTURE'));
    expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'READ' });
  });
  it('cancels when the native session owner changes during the read', async () => {
    const h = nativeHarness();
    h.http.get.mockImplementationOnce(async () => {
      h.owner.staff = 99;
      return { status: 200, data: h.rows };
    });
    expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'SESSION' });
    expect(h.http.get).toHaveBeenCalledTimes(1);
  });
  it('rejects a care from a different facility before constructing the DAU URL', async () => {
    const h = nativeHarness();
    h.admission.PatientCare.IdHealthCareCenter = 99;
    expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'FACILITY' });
    expect(h.reportFilter).not.toHaveBeenCalled();
    expect(h.http.get).toHaveBeenCalledTimes(1);
  });
  it.each(['missing-patient', 'missing-admission'] as const)(
    'rejects %s relationship identifiers',
    async kind => {
      const h = nativeHarness();
      if (kind === 'missing-patient') {
        Reflect.deleteProperty(h.admission.PatientCare, 'IdPatient');
        Reflect.deleteProperty(h.admission.Patient, 'Id');
      } else {
        Reflect.deleteProperty(h.admission.PatientCare, 'IdEmergencyAdmission');
        Reflect.deleteProperty(h.admission, 'Id');
      }
      expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'IDENTITY' });
      expect(h.http.get).toHaveBeenCalledTimes(1);
    }
  );
  it.each(['different', 'duplicate'] as const)(
    'rejects %s report staff identifiers',
    async kind => {
      const h = nativeHarness();
      h.report.url =
        kind === 'different' ? reportUrl.replace('uspId=6', 'uspId=99') : `${reportUrl}&uspId=99`;
      expect(await runtime.readPdfInPage(selection)).toEqual({ ok: false, code: 'CONTRACT' });
      expect(h.http.get).toHaveBeenCalledTimes(1);
    }
  );
});

describe('DAU delivery and source isolation', () => {
  const harness = () => {
    const executeScript = vi.fn(async (_input: ScriptInput) => [
      { result: { ok: true, base64: btoa('%PDF-1.7 fixture') } },
    ]);
    const query = vi.fn(async () => [
      { id: 4, url: 'https://urgencia.saludenred.cl/Emergency/#/admission', lastAccessed: 4 },
    ]);
    const downloadPdfBuffer = vi.fn(async () => ({ ok: true, downloadId: 10 }));
    const assertAuthorization = vi.fn(async () => undefined);
    const api = runtime.create({
      chrome: { tabs: { query }, scripting: { executeScript } },
      downloadPdfBuffer,
    });
    return { api, query, executeScript, downloadPdfBuffer, assertAuthorization };
  };
  it('uses only the HTTPS Urgencias page and delivers the official bytes after authorization checks', async () => {
    const h = harness();
    expect(
      await h.api.download({ ...selection, assertAuthorization: h.assertAuthorization })
    ).toEqual({ ok: true, opened: true });
    expect(h.query).toHaveBeenCalledWith({ url: 'https://urgencia.saludenred.cl/Emergency/*' });
    expect(h.executeScript.mock.calls[0][0]).toMatchObject({
      target: { tabId: 4 },
      world: 'MAIN',
      args: [selection],
    });
    expect(h.downloadPdfBuffer).toHaveBeenCalledWith({
      buffer: expect.any(ArrayBuffer),
      filename: 'DAU_8.pdf',
      saveAs: true,
    });
    expect(h.assertAuthorization).toHaveBeenCalledTimes(3);
  });
  it('does not inject into a blob/PDF tab or download without an active native page', async () => {
    const h = harness();
    h.query.mockResolvedValue([
      { id: 4, url: 'blob:https://urgencia.saludenred.cl/private', lastAccessed: 4 },
    ]);
    await expect(
      h.api.download({ ...selection, assertAuthorization: h.assertAuthorization })
    ).rejects.toThrow('Abre Rayen Urgencias');
    expect(h.executeScript).not.toHaveBeenCalled();
    expect(h.downloadPdfBuffer).not.toHaveBeenCalled();
  });
  it('cancels delivery if the HHR clinical session changes while the PDF is read', async () => {
    const h = harness();
    h.assertAuthorization
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('changed session'));
    await expect(
      h.api.download({ ...selection, assertAuthorization: h.assertAuthorization })
    ).rejects.toThrow('changed session');
    expect(h.downloadPdfBuffer).not.toHaveBeenCalled();
  });
});
