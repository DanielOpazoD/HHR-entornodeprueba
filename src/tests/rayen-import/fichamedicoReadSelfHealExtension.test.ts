// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  createFichamedicoReadHarness as createHarness,
  LIST_PATH,
} from './fichamedicoReadRuntimeTestHarness';

/**
 * Lectura del censo desde la pestaña de Ficha Médico ante un fallo de red
 * (visto en vivo el 02-09: pestaña abierta toda la noche, salud «lista» por
 * la sesión same-origin, y cada lectura cross-origin muriendo con «Failed to
 * fetch» hasta recargar la pestaña). El MAIN world debe: (1) reintentar UNA
 * vez re-anclado al origen por defecto, (2) si vuelve a fallar, dejar de
 * declararse listo hasta que una lectura funcione, y (3) decir qué endpoint
 * falló.
 */

const STALE_LIST_URL =
  'https://fichamedicoback.rayensalud.cl/encounter/list/filter?facilityId=1342&healthCarePractitionerId=7936&healthCarePractitionerRoleId=2&stale=1';

const networkFailure = () => new TypeError('Failed to fetch');

const clinicalResolver =
  (listBehavior: (url: URL) => unknown) =>
  (url: string): unknown => {
    const parsed = new URL(url);
    if (parsed.pathname === LIST_PATH) return listBehavior(parsed);
    if (parsed.pathname.includes('/patientHeaderData/')) {
      return { preferredIdentifierCode: '17.764.680-6', firstGivenName: 'Jennifer' };
    }
    if (parsed.pathname.includes('/diagnosisEntry/')) return [];
    if (parsed.pathname.includes('/physician')) return [];
    return [];
  };

describe('Ficha Médico · lectura ante fallo de red', () => {
  it('restores a lost MAIN listener without wrapping fetch again', async () => {
    const harness = await createHarness(() => []);
    expect(harness.messageListenerCount()).toBe(2);

    harness.disconnectBridge();
    expect(harness.messageListenerCount()).toBe(0);
    harness.reinject();

    expect(harness.messageListenerCount()).toBe(2);
    expect(harness.fetchWasNotWrappedAgain()).toBe(true);
    await expect(
      harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'reactivated-ficha' })
    ).resolves.toMatchObject({
      reqId: 'reactivated-ficha',
    });
  });

  it('reactivates the existing reader through the small MAIN ping after its listener disappears', async () => {
    const harness = await createHarness(() => []);
    harness.disconnectReader();
    expect(harness.messageListenerCount()).toBe(1);

    await expect(
      harness.send({ type: 'RAYEN_FM_BRIDGE_PING', reqId: 'reader-ping' })
    ).resolves.toMatchObject({ mainReady: true });
    expect(harness.messageListenerCount()).toBe(2);
    expect(harness.fetchWasNotWrappedAgain()).toBe(true);
    await expect(
      harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'reader-health' })
    ).resolves.toMatchObject({ reqId: 'reader-health' });
  });

  it('reintenta una vez re-anclado al origen por defecto cuando la lista capturada falla en red', async () => {
    const requested: string[] = [];
    const harness = await createHarness(
      clinicalResolver(url => {
        requested.push(url.toString());
        if (url.searchParams.get('stale') === '1') throw networkFailure();
        return url.searchParams.get('filterType') === '3'
          ? [{ id: 142070, patientName: 'Jennifer Lopez' }]
          : [];
      })
    );
    await harness.captureListTraffic(STALE_LIST_URL);

    const response = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'heal' });

    expect(response?.error).toBeUndefined();
    expect(response?.snapshot?.encounters?.[0]).toMatchObject({ encounterId: '142070' });
    expect(response?.snapshot).toMatchObject({
      isComplete: true,
      clinicalCoverage: { total: 1, completed: 1, errors: 0 },
      capturePhasesMs: {
        fichaContext: expect.any(Number),
        fichaListsAndCatalog: expect.any(Number),
        fichaPatientReads: expect.any(Number),
        fichaDiagnosisCoding: expect.any(Number),
      },
    });
    expect(requested.some(url => url.includes('stale=1'))).toBe(true);
    expect(requested.some(url => !url.includes('stale=1') && url.includes('filterType=3'))).toBe(
      true
    );

    const health = await harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'h1' });
    expect(health?.ready).toBe(true);
  });

  it('no guarda fallos clínicos en caché y permite recuperarlos en la siguiente captura', async () => {
    let diagnosisCalls = 0;
    const harness = await createHarness((rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.pathname === LIST_PATH) {
        return url.searchParams.get('filterType') === '3'
          ? [{ id: 142070, patientName: 'Jennifer Lopez' }]
          : [];
      }
      if (url.pathname.includes('/patientHeaderData/')) {
        return { preferredIdentifierCode: '17.764.680-6', firstGivenName: 'Jennifer' };
      }
      if (url.pathname.includes('/diagnosisEntry/')) {
        diagnosisCalls += 1;
        if (diagnosisCalls === 1) throw new Error('diagnosis unavailable');
        return [];
      }
      return [];
    });

    const partial = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'retry-1' });
    const recovered = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'retry-2' });

    expect(partial?.snapshot?.isComplete).toBe(false);
    expect(recovered?.snapshot?.isComplete).toBe(true);
    expect(diagnosisCalls).toBe(2);
  });

  it('declara cobertura parcial cuando falla una lectura clínica por paciente', async () => {
    const harness = await createHarness((rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.pathname === LIST_PATH) {
        return url.searchParams.get('filterType') === '3'
          ? [{ id: 142070, patientName: 'Jennifer Lopez' }]
          : [];
      }
      if (url.pathname.includes('/patientHeaderData/')) {
        return { preferredIdentifierCode: '17.764.680-6', firstGivenName: 'Jennifer' };
      }
      if (url.pathname.includes('/diagnosisEntry/')) throw new Error('diagnosis unavailable');
      return [];
    });

    const response = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'partial' });

    expect(response?.error).toBeUndefined();
    expect(response?.snapshot).toMatchObject({
      isComplete: false,
      clinicalCoverage: {
        total: 1,
        completed: 0,
        errors: 1,
        headerErrors: 0,
        diagnosisErrors: 1,
        isolationErrors: 0,
      },
    });
    expect(response?.snapshot?.encounters).toHaveLength(1);
  });

  it('si el reintento también falla, nombra el endpoint y deja de declararse listo hasta que una lectura funcione', async () => {
    let failing = true;
    const harness = await createHarness(
      clinicalResolver(url => {
        if (failing) throw networkFailure();
        return url.searchParams.get('filterType') === '3'
          ? [{ id: 142070, patientName: 'Jennifer Lopez' }]
          : [];
      })
    );

    const failed = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'fail' });
    expect(failed?.error).toContain('Failed to fetch');
    expect(failed?.error).toContain('al consultar https://fichamedicoback.rayensalud.cl');

    const blocked = await harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'h2' });
    expect(blocked?.ready).toBe(false);
    expect(blocked?.message).toContain('Recarga la pestaña');

    failing = false;
    const recovered = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'ok' });
    expect(recovered?.error).toBeUndefined();
    const healthy = await harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'h3' });
    expect(healthy?.ready).toBe(true);
  });

  it('un error HTTP no es un fallo de red: no reintenta ni bloquea la salud', async () => {
    // Una lectura pide la lista activa (filterType=3) y los egresos (filterType=2);
    // se cuenta solo la activa, que es la que decide el reintento.
    let activeListCalls = 0;
    const harness = await createHarness(
      clinicalResolver(url => {
        if (url.searchParams.get('filterType') === '3') activeListCalls += 1;
        // Respuesta HTTP 500 real (ok:false), no un fetch rechazado.
        return { __httpStatus: 500 };
      })
    );

    const failed = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'http' });
    expect(failed?.error).toContain(
      '500 en https://fichamedicoback.rayensalud.cl/encounter/list/filter'
    );
    expect(activeListCalls).toBe(1);

    const health = await harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'h4' });
    expect(health?.ready).toBe(true);
  });
});
