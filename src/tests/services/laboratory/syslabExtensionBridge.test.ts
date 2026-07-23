import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchSyslabDetailsThroughExtension,
  openSyslabLoginWindow,
  openSyslabPdfThroughExtension,
  searchSyslabThroughExtension,
} from '@/services/laboratory/syslabExtensionBridge';

const BATCH_ID = '123e4567-e89b-12d3-a456-426614174000';
const OPAQUE_LINK = `hhr-syslab-extension://batch/${BATCH_ID}/exam/43091284`;

const installBridgeResponse = (
  responder: (request: Record<string, unknown>) => Record<string, unknown>
) =>
  vi.spyOn(window, 'postMessage').mockImplementation(message => {
    const request = message as Record<string, unknown>;
    const resultType = String(request.type).replace('_REQUEST', '_RESULT');
    queueMicrotask(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: window.location.origin,
          data: {
            type: resultType,
            reqId: request.reqId,
            response: responder(request),
          },
        })
      );
    });
  });

describe('Syslab extension page bridge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the selected clinical episode and returns opaque report locators', async () => {
    const postMessage = installBridgeResponse(request => {
      if (request.type === 'HHR_RAYEN_SYSLAB_STATUS_REQUEST') return { connected: true };
      expect(request).toMatchObject({
        type: 'HHR_RAYEN_SYSLAB_SEARCH_REQUEST',
        encId: '141814',
        patientRut: '14.470.055-4',
      });
      return {
        ok: true,
        batchId: BATCH_ID,
        patient: { run: '14.470.055-4' },
        exams: [
          {
            id: '43091284',
            date: '21/07/2026',
            time: '13:10',
            patientName: 'Paciente Syslab',
            origin: 'HHR',
            exams: ['Hemograma'],
          },
        ],
      };
    });

    await expect(searchSyslabThroughExtension('14.470.055-4', '141814')).resolves.toEqual({
      bridgeAvailable: true,
      data: {
        success: true,
        data: [
          {
            id: '43091284',
            link: OPAQUE_LINK,
            date: '21/07/2026',
            time: '13:10',
            patientName: 'Paciente Syslab',
            origin: 'HHR',
            exams: ['Hemograma'],
          },
        ],
      },
    });
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('opens the extension-owned login window without exposing credentials to HHR', async () => {
    const postMessage = installBridgeResponse(request => {
      expect(request).toMatchObject({ type: 'HHR_RAYEN_SYSLAB_LOGIN_OPEN_REQUEST' });
      expect(request).not.toHaveProperty('username');
      expect(request).not.toHaveProperty('password');
      return { ok: true, opened: true };
    });

    await expect(openSyslabLoginWindow()).resolves.toEqual({
      bridgeAvailable: true,
      opened: true,
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects results when Eloísa does not confirm the selected RUN', async () => {
    installBridgeResponse(request =>
      request.type === 'HHR_RAYEN_SYSLAB_STATUS_REQUEST'
        ? { connected: true }
        : {
            ok: true,
            batchId: BATCH_ID,
            patient: { run: '11.111.111-1' },
            exams: [{ id: '43091284' }],
          }
    );

    await expect(searchSyslabThroughExtension('14.470.055-4', '141814')).resolves.toEqual({
      bridgeAvailable: true,
      error: 'La extensión no confirmó que los resultados correspondan al RUN seleccionado.',
    });
  });

  it('maps structured details back to the opaque locator from the same batch', async () => {
    installBridgeResponse(request => {
      expect(request).toMatchObject({
        type: 'HHR_RAYEN_SYSLAB_DETAILS_REQUEST',
        links: [OPAQUE_LINK],
      });
      return {
        ok: true,
        analysis: {
          reports: [
            {
              examId: '43091284',
              findings: [{ name: 'Hemoglobina', result: '13.5', unit: 'g/dL' }],
            },
          ],
        },
      };
    });

    await expect(fetchSyslabDetailsThroughExtension([OPAQUE_LINK])).resolves.toEqual({
      success: true,
      data: [
        {
          url: OPAQUE_LINK,
          findings: [{ name: 'Hemoglobina', result: '13.5', unit: 'g/dL' }],
        },
      ],
    });
  });

  it('rejects oversized detail selections instead of returning a partial analysis', async () => {
    const links = Array.from(
      { length: 25 },
      (_, index) => `hhr-syslab-extension://batch/${BATCH_ID}/exam/${43090000 + index}`
    );
    const postMessage = vi.spyOn(window, 'postMessage');

    await expect(fetchSyslabDetailsThroughExtension(links)).rejects.toThrow(
      'Puedes analizar como máximo 24 informes'
    );
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('asks the extension to open the validated report in its secure viewer', async () => {
    installBridgeResponse(request => {
      expect(request).toMatchObject({
        type: 'HHR_RAYEN_SYSLAB_PDF_REQUEST',
        link: OPAQUE_LINK,
      });
      return { ok: true };
    });

    await expect(openSyslabPdfThroughExtension(OPAQUE_LINK)).resolves.toBeUndefined();
  });
});
