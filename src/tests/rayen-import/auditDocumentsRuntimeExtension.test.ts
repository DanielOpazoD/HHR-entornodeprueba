// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { strFromU8 } from 'fflate';

import {
  BOTH,
  PATIENT_A,
  PATIENT_B,
  discharged,
  makeRuntime,
  row,
} from './support/auditDocumentsRuntimeHarness';

describe('audit download of official Eloísa reports', () => {
  it('puts both reports of every hospitalization in one ZIP, named by patient, RUT and type', async () => {
    const { runtime, archive, zipChunks, sendTabMessage } = makeRuntime();

    const result = await runtime.handleRequest({
      requestId: 'req-1',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result).toMatchObject({ ok: true, documentCount: 4, failedCount: 0 });
    // Delivered only to the document that asked, never to a page the tab navigated to.
    expect(sendTabMessage.mock.calls.at(-1)?.[2]).toEqual({
      frameId: 0,
      documentId: 'synthetic-document',
    });
    expect(zipChunks()).toEqual([
      expect.objectContaining({
        requestId: 'req-1',
        index: 0,
        total: 1,
        filename: 'Auditoria_Eloisa_2026-11-02_1610.zip',
      }),
    ]);
    // The page only hears counts, never names or RUTs.
    expect(sendTabMessage).toHaveBeenCalledWith(42, {
      type: 'RAYEN_AUDIT_DOCUMENTS_PROGRESS',
      requestId: 'req-1',
      phase: 'downloading',
      done: 4,
      total: 4,
    });
    const files = archive();
    expect(Object.keys(files).sort()).toEqual([
      '00 Resumen.csv',
      'Paciente Prueba Uno - 11111111-1 - Cuidados farmacologicos - ingreso 2026-07-13.pdf',
      'Paciente Prueba Uno - 11111111-1 - Cuidados farmacologicos - ingreso 2026-10-29.pdf',
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-07-13.pdf',
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-10-29.pdf',
    ]);
    // The ongoing hospitalization only appears in the pharmacological index; its history runs to now.
    const ongoingHistory = strFromU8(
      files['Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-10-29.pdf']
    );
    expect(ongoingHistory).toContain('/api/reportServer/GetHospitalizedEncounterHistory');
    expect(new URLSearchParams(ongoingHistory.split('?')[1]).get('end_date')).toBe(
      '2026-11-02T21:10:00.000Z'
    );
    const pharmacological = strFromU8(
      files['Paciente Prueba Uno - 11111111-1 - Cuidados farmacologicos - ingreso 2026-07-13.pdf']
    );
    expect(pharmacological).toContain('GetPharmacologicalCareController?enc_id=501&fac_id=7');
    expect(result.summary).toEqual([
      expect.objectContaining({
        run: '111111111',
        hospitalizations: 2,
        downloaded: 4,
        unverified: 0,
      }),
    ]);
  });

  it('reads hospital days in Rapa Nui time, globally or per RUT', async () => {
    const lateNight = row({
      encounterId: 601,
      patientIdentifier: '123456785',
      patientName: 'Paciente Prueba Dos',
      // 01:30 on the mainland is 23:30 of June 30 in Rapa Nui.
      startPeriod: '2026-06-20T08:00:00.00-04:00',
      endPeriod: '2026-07-01T01:30:00.0-04:00',
    });
    const { runtime, archive } = makeRuntime({
      history: { '111111111': [discharged], '123456785': [lateNight] },
      pharmacological: { '111111111': [discharged], '123456785': [lateNight] },
    });

    const result = await runtime.handleRequest({
      requestId: 'req-2',
      patients: [
        { run: PATIENT_A, dateFrom: '2026-07-01', dateTo: '2026-07-31' },
        { run: PATIENT_B, dateFrom: '2026-07-01', dateTo: '2026-07-31' },
      ],
      documentTypes: ['history'],
    });

    expect(result).toMatchObject({ ok: true, documentCount: 1 });
    expect(Object.keys(archive())).toEqual([
      '00 Resumen.csv',
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-07-13.pdf',
    ]);
    const summary = strFromU8(archive()['00 Resumen.csv']);
    expect(summary).toContain('12345678-5;;;;;Sin hospitalizaciones en el periodo;');
  });

  it('reports a RUT whose list Eloísa did not deliver as a failure, not as no hospitalizations', async () => {
    const { runtime, archive } = makeRuntime({
      history: { '111111111': [discharged], '123456785': 500 },
    });

    const result = await runtime.handleRequest({
      requestId: 'req-3',
      patients: [{ run: PATIENT_A }, { run: PATIENT_B }],
      documentTypes: ['history'],
    });

    expect(result.ok).toBe(true);
    expect(result.summary?.[1]).toMatchObject({
      run: '123456785',
      error: expect.stringContaining('HTTP 500'),
    });
    const summary = strFromU8(archive()['00 Resumen.csv']);
    expect(summary).toContain('12345678-5;;;;;No se pudo consultar Eloísa');
    expect(summary).not.toContain('12345678-5;;;;;Sin hospitalizaciones');
  });

  it('marks a single report Eloísa did not deliver and still saves the rest', async () => {
    const { runtime, archive } = makeRuntime({
      pdfStatus: url =>
        url.pathname.endsWith('GetPharmacologicalCareController') &&
        url.searchParams.get('enc_id') === '502'
          ? { error: 'HTTP 504' }
          : null,
    });

    const result = await runtime.handleRequest({
      requestId: 'req-4',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result).toMatchObject({ ok: true, documentCount: 3, failedCount: 1 });
    expect(strFromU8(archive()['00 Resumen.csv'])).toContain('No descargado: HTTP 504');
  });

  it('saves nothing when Eloísa rejects the session', async () => {
    const { runtime, zipChunks } = makeRuntime({
      pdfStatus: () => ({ fatal: true, error: 'Eloísa no autorizó el informe.' }),
    });

    const result = await runtime.handleRequest({
      requestId: 'req-5',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result.ok).not.toBe(true);
    expect(result.error).toContain('Eloísa no autorizó');
    expect(zipChunks()).toEqual([]);
  });

  it('refuses more than the document limit before downloading any report', async () => {
    const many = Array.from({ length: 51 }, (_unused, index) =>
      row({
        encounterId: 1000 + index,
        patientIdentifier: '111111111',
        patientName: 'Paciente Prueba Uno',
        startPeriod: `2020-01-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.00-03:00`,
        endPeriod: '2020-02-01T10:00:00.00-03:00',
      })
    );
    const { runtime, fetchOfficialPdf, zipChunks } = makeRuntime({
      history: { '111111111': many },
      pharmacological: { '111111111': [] },
    });

    const result = await runtime.handleRequest({
      requestId: 'req-6',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result.error).toContain('102 documentos');
    expect(fetchOfficialPdf).not.toHaveBeenCalled();
    expect(zipChunks()).toEqual([]);
  });

  it('downloads only this person: another RUT, a newborn under this RUN and deleted rows stay out', async () => {
    const other = row({ ...discharged, encounterId: 701, patientIdentifier: '123456785' });
    const newborn = row({
      ...discharged,
      encounterId: 702,
      patientIdentifierTypeId: 4,
      patientName: 'RN Paciente Prueba Uno',
    });
    const deleted = row({ ...discharged, encounterId: 703, deleted: true });
    // An echo of the searched RUN never outweighs the RUT of another person.
    const echoed = {
      ...row({ ...discharged, encounterId: 704, patientIdentifier: '123456785' }),
      preferredIdentifierCode: '111111111',
    };
    // Two identifiers that disagree: the row belongs to someone else.
    const conflicting = {
      ...row({ ...discharged, encounterId: 705, patientIdentifier: '123456785' }),
      patient: { identifier: '111111111' },
    };
    const { runtime, archive } = makeRuntime({
      history: { '111111111': [discharged, other, newborn, deleted, echoed, conflicting] },
      pharmacological: { '111111111': [] },
    });

    const result = await runtime.handleRequest({
      requestId: 'req-15',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });

    expect(result).toMatchObject({ ok: true, documentCount: 1 });
    expect(Object.keys(archive())).toEqual([
      '00 Resumen.csv',
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-07-13.pdf',
    ]);
  });

  it('reports a hospitalization it cannot verify instead of claiming there are none', async () => {
    // Only the echo of the searched RUN: nothing proves who this stay belongs to.
    const noIdentifier = {
      ...row({ ...discharged, encounterId: 801, patientIdentifier: undefined }),
      preferredIdentifierCode: '111111111',
    };
    const unreadableEnd = row({
      ...discharged,
      encounterId: 802,
      endPeriod: '2026-07-17T12:00:00',
    });
    const { runtime, archive } = makeRuntime({
      history: { '111111111': [noIdentifier, unreadableEnd], '123456785': [] },
      pharmacological: { '111111111': [], '123456785': [] },
    });
    const other = row({ ...discharged, encounterId: 803, patientIdentifier: '123456785' });
    const second = makeRuntime({
      history: { '111111111': [noIdentifier, unreadableEnd], '123456785': [other] },
      pharmacological: { '111111111': [], '123456785': [] },
    });

    const empty = await runtime.handleRequest({
      requestId: 'req-16',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });
    const partial = await second.runtime.handleRequest({
      requestId: 'req-17',
      patients: [{ run: PATIENT_A }, { run: PATIENT_B }],
      documentTypes: ['history'],
    });

    expect(empty.summary?.[0]).toMatchObject({ hospitalizations: 0, unverified: 2 });
    expect(partial.summary?.[0]).toMatchObject({ hospitalizations: 0, unverified: 2 });
    const summary = strFromU8(second.archive()['00 Resumen.csv']);
    expect(summary).toContain(
      '11111111-1;;;;;2 hospitalización(es) que Eloísa entregó sin fecha o RUT verificable'
    );
    expect(summary).not.toContain('11111111-1;;;;;Sin hospitalizaciones');
    expect(() => archive()).toThrow('No ZIP was delivered');
  });

  it('includes stays that touch either end of the range and reads today in Rapa Nui', async () => {
    const endsOnFrom = row({
      ...discharged,
      encounterId: 901,
      endPeriod: '2026-07-01T10:00:00.0-04:00',
    });
    const startsOnTo = row({
      ...discharged,
      encounterId: 902,
      startPeriod: '2026-07-31T10:00:00.00-04:00',
      endPeriod: '2026-08-05T10:00:00.0-04:00',
    });
    const ranged = makeRuntime({
      history: { '111111111': [endsOnFrom, startsOnTo] },
      pharmacological: { '111111111': [] },
    });
    // 03:00 UTC on Nov 3 is still Nov 2 in Rapa Nui, so a stay in course does not reach Nov 3 yet.
    const lateEvening = makeRuntime({ now: Date.parse('2026-11-03T03:00:00Z') });

    const inRange = await ranged.runtime.handleRequest({
      requestId: 'req-18',
      patients: [{ run: PATIENT_A, dateFrom: '2026-07-01', dateTo: '2026-07-31' }],
      documentTypes: ['history'],
    });
    const fromTomorrow = await lateEvening.runtime.handleRequest({
      requestId: 'req-19',
      patients: [{ run: PATIENT_A, dateFrom: '2026-11-03' }],
      documentTypes: ['history'],
    });

    expect(inRange).toMatchObject({ ok: true, documentCount: 2 });
    expect(fromTomorrow.error).toBe(
      'No hay hospitalizaciones en las fechas pedidas. No se descargó nada.'
    );
  });

  it('keeps a name from running as a formula when the summary opens in a spreadsheet', async () => {
    const formula = { ...discharged, patientName: '=HYPERLINK("http://example.test")' };
    const { runtime, archive } = makeRuntime({
      history: { '111111111': [formula] },
      pharmacological: { '111111111': [] },
    });

    await runtime.handleRequest({
      requestId: 'req-14',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });

    const summary = strFromU8(archive()['00 Resumen.csv']);
    expect(summary).toContain(`;"'=HYPERLINK(""http://example.test"")";`);
  });
});
