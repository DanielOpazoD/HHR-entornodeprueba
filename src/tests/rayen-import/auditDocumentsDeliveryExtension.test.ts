// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  BOTH,
  PATIENT_A,
  globals,
  makeRuntime,
  type AuditRuntime,
} from './support/auditDocumentsRuntimeHarness';

describe('audit download requests, cancellation and delivery', () => {
  it.each([
    ['more than 20 RUTs', { patients: Array.from({ length: 21 }, () => ({ run: PATIENT_A })) }],
    ['a wrong verifier digit', { patients: [{ run: '11111111-2' }] }],
    ['a repeated RUT', { patients: [{ run: PATIENT_A }, { run: '11.111.111-1' }] }],
    [
      'an inverted range',
      { patients: [{ run: PATIENT_A, dateFrom: '2026-08-01', dateTo: '2026-07-01' }] },
    ],
    ['no document type', { patients: [{ run: PATIENT_A }], documentTypes: [] }],
  ])('rejects %s without asking Eloísa', async (_case, request) => {
    const { runtime, fetchWithTimeout } = makeRuntime();

    const result = await runtime.handleRequest({
      requestId: 'req-7',
      documentTypes: BOTH,
      ...request,
    });

    expect(result.error).toEqual(expect.any(String));
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('stops without saving when HHR cancels or the session changes mid-download', async () => {
    let runtime: AuditRuntime | null = null;
    const setup = makeRuntime({
      pdfStatus: () => {
        runtime?.cancelAll();
        return null;
      },
    });
    runtime = setup.runtime;

    const result = await runtime.handleRequest({
      requestId: 'req-8',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result).toMatchObject({ cancelled: true });
    expect(setup.fetchOfficialPdf).toHaveBeenCalledTimes(1);
    expect(setup.zipChunks()).toEqual([]);
  });

  it('never reads a passport as a RUT when called directly', async () => {
    const { runtime, fetchWithTimeout } = makeRuntime();

    const result = await runtime.handleRequest({
      requestId: 'req-20',
      patients: [{ run: 'P11111111-1' }],
      documentTypes: BOTH,
    });

    expect(result.error).toBe('Uno de los RUT no es válido.');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('does not save the ZIP when a cancel arrives while its parts travel', async () => {
    let runtime: AuditRuntime | null = null;
    const setup = makeRuntime({
      pdfBytes: 2_500_000,
      tabReply: chunk => {
        if (chunk.requestId === 'req-21' && chunk.index === 0) runtime?.cancelAll();
        return { ok: true };
      },
    });
    runtime = setup.runtime;

    const result = await runtime.handleRequest({
      requestId: 'req-21',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });
    const busy = await runtime.handleRequest({
      requestId: 'req-22',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result).toMatchObject({ cancelled: true });
    const sent = setup.sendTabMessage.mock.calls
      .map(call => call[1] as Record<string, unknown>)
      .filter(
        message =>
          message.type === 'RAYEN_AUDIT_DOCUMENTS_FILE_CHUNK' && message.requestId === 'req-21'
      );
    expect(sent.map(message => message.discard ?? message.index)).toEqual([0, true]);
    expect(busy.ok).toBe(true);
  });

  it('is stopped by an HHR session change in the worker', () => {
    const background = readFileSync(path.resolve('extension/background.js'), 'utf8');
    const route = background.slice(background.indexOf('[RUNTIME_MESSAGES.HHR_SESSION_CHANGED]'));
    expect(
      route.slice(0, route.indexOf('}, ')).includes('auditDocumentsRuntime.cancelAll();')
    ).toBe(true);
  });

  it('accepts a bulk export only from an HHR tab', async () => {
    const { runtime, fetchWithTimeout } = makeRuntime();

    const result = await runtime.handleRequest({
      requestId: 'req-13',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
      sender: { tab: { id: 7, url: 'https://fichamedico.rayensalud.cl/dashboard' }, frameId: 0 },
    });

    expect(result.error).toBe('La descarga para auditoría solo se puede pedir desde HHR.');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('hands a large ZIP to the HHR tab in parts that rebuild the same archive', async () => {
    const { runtime, archive, zipChunks } = makeRuntime({ pdfBytes: 2_500_000 });

    const result = await runtime.handleRequest({
      requestId: 'req-11',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result.ok).toBe(true);
    expect(zipChunks().map(chunk => [chunk.index, chunk.total])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(Object.keys(archive())).toHaveLength(5);
  });

  it('does not report a ZIP as saved when the HHR tab does not confirm it', async () => {
    const { runtime } = makeRuntime({ tabReply: () => undefined });

    const result = await runtime.handleRequest({
      requestId: 'req-12',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result.ok).not.toBe(true);
    expect(result.error).toContain('No se pudo guardar el ZIP en HHR');
  });

  it('sends progress with the type the HHR bridge listens for', () => {
    expect(globals.HhrAuditDocumentsRuntime.PROGRESS_MESSAGE_TYPE).toBe(
      globals.HhrRayenMessageContract.types.AUDIT_DOCUMENTS_PROGRESS
    );
  });

  it('runs one audit download at a time', async () => {
    const { runtime } = makeRuntime();

    const [first, second] = await Promise.all([
      runtime.handleRequest({
        requestId: 'req-9',
        patients: [{ run: PATIENT_A }],
        documentTypes: BOTH,
      }),
      runtime.handleRequest({
        requestId: 'req-10',
        patients: [{ run: PATIENT_A }],
        documentTypes: BOTH,
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.error).toContain('en curso');
  });
});

describe('stored ZIP writer', () => {
  it('computes the standard CRC-32', () => {
    expect(globals.HhrZipStoreWriter.crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes an archive a standard reader opens with the same bytes', () => {
    const data = new Uint8Array([37, 80, 68, 70, 0, 255, 10]);
    const zip = globals.HhrZipStoreWriter.build(
      [
        { name: 'a.pdf', data },
        { name: 'b c.csv', data: new TextEncoder().encode('x;y') },
      ],
      { year: 2026, month: 11, day: 2, hour: 16, minute: 10, second: 0 }
    );

    const files = unzipSync(zip);
    expect(files['a.pdf']).toEqual(data);
    expect(strFromU8(files['b c.csv'])).toBe('x;y');
  });

  it('refuses names the Windows extractor would garble', () => {
    expect(() =>
      globals.HhrZipStoreWriter.build(
        [{ name: 'Historial hospitalización.pdf', data: new Uint8Array(1) }],
        {
          year: 2026,
          month: 1,
          day: 1,
          hour: 0,
          minute: 0,
          second: 0,
        }
      )
    ).toThrow();
  });
});
