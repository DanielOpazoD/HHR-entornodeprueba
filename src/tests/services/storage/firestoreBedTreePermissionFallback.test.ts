import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPartialUpdatePersistWithPermissionFallbacks } from '@/services/storage/firestore/firestoreBedTreePermissionFallback';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
}));

vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  patchDailyRecordWithClinicalAuthorityCallable: mocks.callable,
  shouldRetryDailyRecordAuthorityError: () => false,
}));

const permissionDenied = () => {
  const error = new Error('Missing or insufficient permissions.') as Error & { code: string };
  error.code = 'permission-denied';
  return error;
};

const BED_PATCH = {
  'beds.NEO2.devices': ['LA', 'SNG'],
  'beds.NEO2.deviceDetails': { SNG: { installationDate: '2026-08-31' } },
  dateTimestamp: 123,
};

describe('runPartialUpdatePersistWithPermissionFallbacks', () => {
  beforeEach(() => {
    mocks.callable.mockReset();
  });

  it('reintenta el parche de camas por el callable cuando las reglas niegan el write directo', async () => {
    // Verificado en vivo (31-08): la lectura advisory de la valla falló por una
    // carrera de token, el guardado de SNG salió directo y las reglas lo
    // negaron — quedaba «solo local». El permission-denied ES la prueba de que
    // la valla está activa: el parche viaja por el canal autoritativo.
    const persist = vi.fn().mockRejectedValue(permissionDenied());
    mocks.callable.mockResolvedValue({ ok: true });

    const result = await runPartialUpdatePersistWithPermissionFallbacks({
      persist,
      date: '2026-08-31',
      sanitizedPatch: BED_PATCH,
      expectedLastUpdated: '2026-08-31T10:00:00.000Z',
      tryRefreshCurrentUserRoleClaim: vi.fn().mockResolvedValue(false),
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.callable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-08-31',
        mode: 'enforced',
        origin: 'direct_write_permission_fallback',
        patch: {
          'beds.NEO2.devices': ['LA', 'SNG'],
          'beds.NEO2.deviceDetails': { SNG: { installationDate: '2026-08-31' } },
        },
      })
    );
  });

  it('el refresh de claim sigue teniendo prioridad y su reintento exitoso no toca el callable', async () => {
    const persist = vi
      .fn()
      .mockRejectedValueOnce(permissionDenied())
      .mockResolvedValueOnce({ ok: 'directo' });

    const result = await runPartialUpdatePersistWithPermissionFallbacks({
      persist,
      date: '2026-08-31',
      sanitizedPatch: BED_PATCH,
      tryRefreshCurrentUserRoleClaim: vi.fn().mockResolvedValue(true),
    });

    expect(result).toEqual({ ok: 'directo' });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it('un error que no es de permisos, o un parche sin árbol de camas, se relanza intacto', async () => {
    const otherError = new Error('otra cosa');
    await expect(
      runPartialUpdatePersistWithPermissionFallbacks({
        persist: vi.fn().mockRejectedValue(otherError),
        date: '2026-08-31',
        sanitizedPatch: BED_PATCH,
        tryRefreshCurrentUserRoleClaim: vi.fn().mockResolvedValue(false),
      })
    ).rejects.toBe(otherError);

    await expect(
      runPartialUpdatePersistWithPermissionFallbacks({
        persist: vi.fn().mockRejectedValue(permissionDenied()),
        date: '2026-08-31',
        sanitizedPatch: { handoffNovedadesDayShift: 'Nota' },
        tryRefreshCurrentUserRoleClaim: vi.fn().mockResolvedValue(false),
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.callable).not.toHaveBeenCalled();
  });
});
