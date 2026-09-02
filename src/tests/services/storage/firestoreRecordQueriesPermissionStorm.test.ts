import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDoc: vi.fn(),
    getDocs: vi.fn(),
  };
});

vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>();
  return {
    ...actual,
    getRecordDocRef: vi.fn(() => ({ id: 'storm-test-doc-ref' })),
  };
});

vi.mock('@/services/auth/sessionPermissionStormDetector', () => ({
  reportBasicReadPermissionDenied: vi.fn(),
}));

import { getDoc } from 'firebase/firestore';
import { getRecordFromFirestoreDetailed } from '@/services/storage/firestore/firestoreRecordQueries';
import { reportBasicReadPermissionDenied } from '@/services/auth/sessionPermissionStormDetector';

/**
 * El embudo de lecturas del censo alimenta el detector de tormenta de
 * permisos SOLO con denegaciones por permisos: cualquier otro error (red,
 * documento inexistente) no debe contar como pista de sesión rota.
 */
describe('firestoreRecordQueries → detector de tormenta de permisos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('una lectura del censo denegada por permisos se reporta con su operación', async () => {
    vi.mocked(getDoc).mockRejectedValueOnce({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });

    await getRecordFromFirestoreDetailed('2026-09-01');

    expect(reportBasicReadPermissionDenied).toHaveBeenCalledWith('records:getRecord');
  });

  it('un token inválido (unauthenticated) también cuenta como pérdida de autorización', async () => {
    vi.mocked(getDoc).mockRejectedValueOnce({ code: 'unauthenticated', message: 'invalid token' });

    await getRecordFromFirestoreDetailed('2026-09-01');

    expect(reportBasicReadPermissionDenied).toHaveBeenCalledWith('records:getRecord');
  });

  it('un error que no es de permisos no alimenta el detector', async () => {
    vi.mocked(getDoc).mockRejectedValueOnce({ code: 'unavailable', message: 'network down' });

    await getRecordFromFirestoreDetailed('2026-09-01');

    expect(reportBasicReadPermissionDenied).not.toHaveBeenCalled();
  });
});
