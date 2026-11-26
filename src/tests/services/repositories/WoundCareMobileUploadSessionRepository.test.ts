// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WoundCareAuditActor } from '@/types/domain/woundCare';

const getDocsMock = vi.fn();
const getDocMock = vi.fn();
const setDocMock = vi.fn();
const runTransactionMock = vi.fn();
const docMock = vi.fn((_db: unknown, path: string, id: string) => ({ path, id }));
const getDbMock = vi.fn(() => ({ fakeDb: true }));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...(args as [unknown, string, string])),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
}));

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: {
    getDoc: (...args: unknown[]) => getDocMock(...args),
    getDocs: (...args: unknown[]) => getDocsMock(...args),
    setDoc: (...args: unknown[]) => setDocMock(...args),
  },
}));

vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: {
    getDb: () => getDbMock(),
  },
}));

import { WoundCareMobileUploadSessionRepository } from '@/features/wound-care/services/WoundCareMobileUploadSessionRepository';

const actorA: WoundCareAuditActor = {
  uid: 'nurse-a',
  email: 'a@hospital.cl',
  displayName: 'Enfermera A',
  role: 'nurse_hospital',
};

const actorB: WoundCareAuditActor = {
  uid: 'nurse-b',
  email: 'b@hospital.cl',
  displayName: 'Enfermera B',
  role: 'nurse_hospital',
};

describe('WoundCareMobileUploadSessionRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDbMock.mockReturnValue({ fakeDb: true });
  });

  it('writes revocation fields atomically when the session is still active', async () => {
    const update = vi.fn();
    runTransactionMock.mockImplementationOnce(async (_db, callback) =>
      callback({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ sessionId: 'wcu_1' }),
        }),
        update,
      })
    );

    await WoundCareMobileUploadSessionRepository.revoke(
      'wcu_1',
      { revokedAt: '2026-04-01T15:10:00.000Z', revokedBy: actorB },
      'hanga-roa'
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'wcu_1' }), {
      revokedAt: '2026-04-01T15:10:00.000Z',
      revokedBy: actorB,
    });
  });

  it('preserves the first confirmed revocation author and timestamp without overwriting', async () => {
    const update = vi.fn();
    runTransactionMock.mockImplementationOnce(async (_db, callback) =>
      callback({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({
            sessionId: 'wcu_1',
            revokedAt: '2026-04-01T15:10:00.000Z',
            revokedBy: actorB,
          }),
        }),
        update,
      })
    );

    await WoundCareMobileUploadSessionRepository.revoke(
      'wcu_1',
      { revokedAt: '2026-04-01T15:12:00.000Z', revokedBy: actorA },
      'hanga-roa'
    );

    expect(update).not.toHaveBeenCalled();
  });

  it('queries sessions by episode with source server and fails closed on invalid active documents', async () => {
    getDocsMock.mockResolvedValueOnce([
      {
        sessionId: 'wcu_valid',
        hospitalId: 'hanga-roa',
        episodeKey: '11.111.111-1__2026-04-01__10:00',
        patientRut: '11.111.111-1',
        patientName: 'Paciente Sintético',
        createdBy: actorA,
        createdAt: '2026-04-01T15:00:00.000Z',
        expiresAt: '2026-04-01T15:30:00.000Z',
        scope: 'wound_care_upload_only',
      },
    ]);

    const sessions = await WoundCareMobileUploadSessionRepository.listByEpisode(
      '11.111.111-1__2026-04-01__10:00',
      'hanga-roa'
    );
    expect(sessions).toHaveLength(1);
    expect(getDocsMock).toHaveBeenCalledWith(
      expect.stringContaining('woundCareMobileUploadSessions'),
      expect.objectContaining({
        source: 'server',
        where: [
          {
            field: 'episodeKey',
            operator: '==',
            value: '11.111.111-1__2026-04-01__10:00',
          },
        ],
      })
    );

    getDocsMock.mockResolvedValueOnce([{ sessionId: 'corrupt-active' }]);
    await expect(
      WoundCareMobileUploadSessionRepository.listByEpisode(
        '11.111.111-1__2026-04-01__10:00',
        'hanga-roa'
      )
    ).rejects.toThrow(/sesiones móviles activas/i);
  });
});
