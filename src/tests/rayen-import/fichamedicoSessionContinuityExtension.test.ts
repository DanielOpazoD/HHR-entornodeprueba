// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHarness, type PostedMessage } from './fichamedicoSessionContinuityTestHarness';

describe('Ficha Medico session continuity', () => {
  it('recovers health after a hung session request without reloading the page', async () => {
    vi.useFakeTimers();
    try {
      let requests = 0;
      let releaseFirst: () => void = () => undefined;
      const first = new Promise<void>(resolve => {
        releaseFirst = resolve;
      });
      const harness = await createHarness(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list',
        'Médico',
        new Map(),
        {},
        true,
        undefined,
        () => (++requests === 1 ? first : Promise.resolve())
      );
      const blocked = harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'blocked' });
      await vi.advanceTimersByTimeAsync(3000);
      expect(await blocked).toMatchObject({ ready: false });
      expect(
        await harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'recovered' })
      ).toMatchObject({ ready: true });
      releaseFirst();
      await vi.advanceTimersByTimeAsync(0);
      expect(
        await harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'still-current' })
      ).toMatchObject({ ready: true });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enriches active isolation from the episode detail endpoint', async () => {
    const requested: string[] = [];
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list',
      'Médico',
      new Map(),
      {},
      true,
      url => {
        requested.push(url);
        const parsed = new URL(url);
        if (parsed.pathname === '/encounter/list/filter') {
          return parsed.searchParams.get('filterType') === '3'
            ? [{ id: 142070, patientName: 'Jennifer Lopez', isIsolated: true }]
            : [];
        }
        if (parsed.pathname.includes('/patientHeaderData/')) {
          return { preferredIdentifierCode: '17.764.680-6', firstGivenName: 'Jennifer' };
        }
        if (parsed.pathname.includes('/diagnosisEntry/')) return [];
        if (parsed.pathname.endsWith('/142070/isolationEncounter/0/getAll')) {
          return [
            {
              encounterId: 142070,
              isoTypeName: 'Gotas',
              microName: 'Virus Influenza B',
              endIsolationDatetime: null,
              deletedDatetime: null,
            },
          ];
        }
        throw new Error(`Unexpected clinical request: ${url}`);
      }
    );

    const response = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'isolation' });

    expect(response?.snapshot?.encounters?.[0]).toMatchObject({
      encounterId: '142070',
      isIsolated: true,
      isolationType: 'Gotas',
      isolationMicroorganism: 'Virus Influenza B',
    });
    expect(requested).toContain(
      'https://fichamedicoback.rayensalud.cl/api/encounter/142070/isolationEncounter/0/getAll'
    );
  });

  it('exposes the verified practitioner role id in the safe health identity', async () => {
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141119',
      'Médico',
      new Map(),
      { healthCarePractitionerRoleId: 1 }
    );
    const response = await harness.send({
      type: 'RAYEN_FM_SESSION_STATUS_REQUEST',
      reqId: 'health-identity',
    });

    expect(response?.ready).toBe(true);
    expect(response?.identity).toMatchObject({
      role: 'Médico',
      practitionerId: '7936',
      practitionerRoleId: '1',
    });
  });

  it.each([
    'https://fichamedico.rayensalud.cl/dashboard/encounter-list',
    'https://fichamedico.rayensalud.cl/dashboard/care-plan-execute',
    'https://fichamedico.rayensalud.cl/dashboard/reports',
  ])('rebuilds a verified clinical context from the live Eloisa session on %s', async href => {
    const harness = await createHarness(href);
    const response = await harness.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'context' });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      apiOrigin: 'https://fichamedicoback.rayensalud.cl',
      facId: '1342',
      practitionerId: '7936',
      practitionerRoleId: '2',
      identityVerified: true,
    });
    const listUrl = new URL(String(response?.info?.listUrl));
    expect(listUrl.pathname).toBe('/encounter/list/filter');
    expect(listUrl.searchParams.get('facilityId')).toBe('1342');
    expect(listUrl.searchParams.get('healthCarePractitionerId')).toBe('7936');
    expect(listUrl.searchParams.get('healthCarePractitionerRoleId')).toBe('2');
  });

  it('keeps nursing worklists available outside the medical encounter list', async () => {
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      'Enfermera(o)'
    );
    const response = await harness.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'nursing' });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      apiOrigin: 'https://fichamedicoback.rayensalud.cl',
      listUrl: '',
      listSource: 'nursing',
      isNursing: true,
      identityVerified: true,
    });
  });

  it('uses the verified nursing practitioner id for every clinical diagnosis read', async () => {
    const requested: string[] = [];
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      'Enfermera(o)',
      new Map(),
      {},
      true,
      rawUrl => {
        requested.push(rawUrl);
        const url = new URL(rawUrl);
        if (
          [
            '/api/encounter/noveltyNurseList/1342',
            '/api/encounter/uneventfulNurseList/1342',
          ].includes(url.pathname)
        ) {
          return url.pathname.includes('noveltyNurseList')
            ? [{ id: 142070, patientName: 'Jennifer Lopez' }]
            : [];
        }
        if (url.pathname === '/api/encounter/incomeNurseList/1342') return [];
        if (url.pathname.includes('/patientHeaderData/')) {
          return { preferredIdentifierCode: '17.764.680-6', firstGivenName: 'Jennifer' };
        }
        if (url.pathname.includes('/diagnosisEntry/')) return [];
        throw new Error(`Unexpected nursing clinical request: ${rawUrl}`);
      }
    );

    const response = await harness.send({
      type: 'RAYEN_EXT_READ_REQUEST',
      reqId: 'nursing-snapshot',
    });

    expect(response?.snapshot).toMatchObject({
      isComplete: true,
      clinicalCoverage: { total: 1, completed: 1, errors: 0 },
    });
    expect(requested).toContain(
      'https://fichamedicoback.rayensalud.cl/api/encounter/entrySummary/diagnosisEntry/142070/0/2/7936'
    );
  });

  it.each(['', 'Médico'])(
    'treats the nursing route as authoritative when the session role label is %j',
    async role => {
      const harness = await createHarness(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
        role
      );
      const response = await harness.send({
        type: 'RAYEN_FM_FETCHINFO_REQUEST',
        reqId: 'route-nursing',
      });

      expect(response?.error).toBeNull();
      expect(response?.info).toMatchObject({
        listUrl: '',
        listSource: 'nursing',
        isNursing: true,
      });
    }
  );

  it('keeps the observed nursing context across full route reloads in the same tab session', async () => {
    const storedNursingContexts = new Map<string, string>();
    const nursingRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      '',
      storedNursingContexts
    );
    await nursingRoute.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'nursing-route' });

    const reportsRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/reports',
      '',
      storedNursingContexts
    );
    const response = await reportsRoute.send({
      type: 'RAYEN_FM_FETCHINFO_REQUEST',
      reqId: 'reports-route',
    });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      listUrl: '',
      listSource: 'nursing',
      isNursing: true,
    });
  });

  it('clears the observed nursing context on the authoritative medical list', async () => {
    const storedNursingContexts = new Map<string, string>();
    const nursingRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      '',
      storedNursingContexts
    );
    await nursingRoute.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'nursing-first' });

    const medicalRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list',
      '',
      storedNursingContexts
    );
    const response = await medicalRoute.send({
      type: 'RAYEN_FM_FETCHINFO_REQUEST',
      reqId: 'medical-list',
    });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      listSource: 'medical',
      isNursing: false,
    });
  });

  it('does not keep a medical session in nursing mode after leaving the nursing route', async () => {
    const storedNursingContexts = new Map<string, string>();
    const nursingRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      'Médico',
      storedNursingContexts
    );
    await nursingRoute.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'medical-nursing-route' });

    const reportsRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/reports',
      'Médico',
      storedNursingContexts
    );
    const response = await reportsRoute.send({
      type: 'RAYEN_FM_FETCHINFO_REQUEST',
      reqId: 'medical-reports',
    });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      listSource: 'medical',
      isNursing: false,
    });
  });

  it('recognizes the alternate nursing role label outside the nursing list', async () => {
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/reports',
      '',
      new Map(),
      { healthCarePractitionerRoleName: 'Enfermera(o)' }
    );
    const response = await harness.send({
      type: 'RAYEN_FM_FETCHINFO_REQUEST',
      reqId: 'alternate-role-label',
    });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      listUrl: '',
      listSource: 'nursing',
      isNursing: true,
    });
  });

  it('clears a persisted nursing context when a fresh document finds an expired session', async () => {
    const storedNursingContexts = new Map<string, string>();
    const nursingRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      '',
      storedNursingContexts
    );
    await nursingRoute.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'prime-nursing' });

    const reportsAfterLogout = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/reports',
      '',
      storedNursingContexts,
      {},
      false
    );
    reportsAfterLogout.activateSession();
    const response = await reportsAfterLogout.send({
      type: 'RAYEN_FM_FETCHINFO_REQUEST',
      reqId: 'new-session',
    });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      listSource: 'medical',
      isNursing: false,
    });
  });

  it('keeps the binding only while Eloisa reports an active session', async () => {
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/care-plan-execute'
    );

    await expect(
      harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'active' })
    ).resolves.toMatchObject({ ready: true, message: expect.stringContaining('vigente') });

    harness.expireSession();

    await expect(
      harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'expired' })
    ).resolves.toMatchObject({
      ready: false,
      message: expect.stringContaining('venció'),
    });
    await expect(
      harness.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'after-expiry' })
    ).resolves.toMatchObject({ info: null, error: expect.stringContaining('no está disponible') });
  });
});

describe('Ficha Medico session expiry', () => {
  it('rechaza una sesión con token ya vencida', async () => {
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list',
      'Médico',
      new Map(),
      { expirationDate: '2000-01-01T08:00:00-06:00' }
    );
    const response = await harness.send({
      type: 'RAYEN_FM_SESSION_STATUS_REQUEST',
      reqId: 'expired-token',
    });
    expect(response).toMatchObject({ ready: false, reason: 'session_expired' });
    const info = await harness.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'expired-read' });
    expect(info).not.toHaveProperty('token');
  });
  it('publica la vigencia real en el estado de salud', async () => {
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list',
      'Médico',
      new Map(),
      { expirationDate: '2099-01-01T08:28:10.3065687-06:00' }
    );
    const response = (await harness.send({
      type: 'RAYEN_FM_SESSION_STATUS_REQUEST',
      reqId: 'health-expiry',
    })) as PostedMessage & { expiresAt?: number | null; remainingSeconds?: number | null };
    expect(response?.ready).toBe(true);
    expect(response?.expiresAt).toBe(Date.parse('2099-01-01T08:28:10.3065687-06:00'));
    expect(response?.remainingSeconds).toBeGreaterThan(24 * 3600);
  });
  it('sin expiración informada, la vigencia viaja como null', async () => {
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list'
    );
    const response = (await harness.send({
      type: 'RAYEN_FM_SESSION_STATUS_REQUEST',
      reqId: 'health-no-expiry',
    })) as PostedMessage & { expiresAt?: number | null; remainingSeconds?: number | null };
    expect(response?.ready).toBe(true);
    expect(response?.expiresAt).toBeNull();
    expect(response?.remainingSeconds).toBeNull();
  });
});
