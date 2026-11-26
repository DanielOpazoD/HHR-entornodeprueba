import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallableMock = vi.fn();
let mockE2ERuntimeEnabled = true;

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallableMock(...args),
}));

vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: vi.fn().mockResolvedValue({ name: 'functions' }),
  },
}));

vi.mock('@/shared/runtime/e2eRuntime', () => ({
  isE2ERuntimeEnabled: () => mockE2ERuntimeEnabled,
}));

import {
  fetchAnalyticsSpecialtyReclassifications,
  saveAnalyticsSpecialtyReclassification,
} from '@/features/analytics/services/analyticsSpecialtyReclassificationService';

describe('analyticsSpecialtyReclassificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockE2ERuntimeEnabled = true;
    window.localStorage.clear();
    window.localStorage.setItem('hhr_e2e_capture_analytics_reclassifications', 'true');
    window.localStorage.setItem('hhr_e2e_analytics_reclassifications', '[]');
    window.localStorage.setItem('hhr_e2e_analytics_reclassification_calls', '[]');
  });

  it('captures save and clear operations in E2E mode without calling Firebase Functions', async () => {
    await saveAnalyticsSpecialtyReclassification({
      hospitalId: 'hanga_roa',
      date: '2026-03-05',
      movementKind: 'discharge',
      movementId: 'd-1',
      reportingSpecialty: 'Cirugía',
    });

    await expect(
      fetchAnalyticsSpecialtyReclassifications('2026-03-01', '2026-03-31', 'hanga_roa')
    ).resolves.toEqual([
      expect.objectContaining({
        date: '2026-03-05',
        movementKind: 'discharge',
        movementId: 'd-1',
        specialty: 'Cirugía',
      }),
    ]);

    await saveAnalyticsSpecialtyReclassification({
      hospitalId: 'hanga_roa',
      date: '2026-03-05',
      movementKind: 'discharge',
      movementId: 'd-1',
      reportingSpecialty: null,
    });

    await expect(
      fetchAnalyticsSpecialtyReclassifications('2026-03-01', '2026-03-31', 'hanga_roa')
    ).resolves.toEqual([]);
    expect(
      JSON.parse(window.localStorage.getItem('hhr_e2e_analytics_reclassification_calls') || '[]')
    ).toEqual([
      expect.objectContaining({
        hospitalId: 'hanga_roa',
        date: '2026-03-05',
        movementKind: 'discharge',
        movementId: 'd-1',
        reportingSpecialty: 'Cirugía',
      }),
      expect.objectContaining({
        hospitalId: 'hanga_roa',
        date: '2026-03-05',
        movementKind: 'discharge',
        movementId: 'd-1',
        reportingSpecialty: null,
      }),
    ]);
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });

  it('requires a server read from Firestore outside E2E capture mode and propagates read failures', async () => {
    mockE2ERuntimeEnabled = false;
    const getDocsMock = vi.fn().mockResolvedValueOnce([
      {
        date: '2026-03-05',
        movementKind: 'discharge',
        movementId: 'd-1',
        reportingSpecialty: 'Cirugía',
        active: true,
        updatedAt: '2026-03-06T12:00:00.000Z',
        updatedByEmail: 'admin@hhr.cl',
      },
    ]);

    const rows = await fetchAnalyticsSpecialtyReclassifications(
      '2026-03-01',
      '2026-03-31',
      'hanga_roa',
      { getDocs: getDocsMock }
    );

    expect(getDocsMock).toHaveBeenCalledWith(
      'hospitals/hanga_roa/analyticsSpecialtyReclassifications',
      expect.objectContaining({
        source: 'server',
      })
    );
    expect(rows).toEqual([
      {
        date: '2026-03-05',
        movementKind: 'discharge',
        movementId: 'd-1',
        specialty: 'Cirugía',
        updatedAt: '2026-03-06T12:00:00.000Z',
        updatedBy: 'admin@hhr.cl',
      },
    ]);

    getDocsMock.mockRejectedValueOnce(new Error('server unavailable'));
    await expect(
      fetchAnalyticsSpecialtyReclassifications('2026-03-01', '2026-03-31', 'hanga_roa', {
        getDocs: getDocsMock,
      })
    ).rejects.toThrow('server unavailable');
  });
});
