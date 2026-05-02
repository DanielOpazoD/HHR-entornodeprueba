import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  executeCreateWoundCareMobileUploadSession,
  executeRevokeWoundCareMobileUploadSession,
  executeValidateWoundCareMobileUploadSession,
} from '@/application/wound-care/woundCareMobileUploadSessionUseCases';
import type { WoundCareAuditActor, WoundCareMobileUploadSession } from '@/types/domain/woundCare';

describe('woundCareMobileUploadSessionUseCases', () => {
  const actor: WoundCareAuditActor = {
    uid: 'nurse-1',
    email: 'nurse@hospital.cl',
    displayName: 'Nurse Test',
    role: 'nurse',
  };

  const session: WoundCareMobileUploadSession = {
    sessionId: 'session-1',
    hospitalId: 'hanga_roa',
    episodeKey: '12345678-9__2026-05-02',
    patientRut: '12345678-9',
    patientName: 'Paciente Test',
    createdBy: actor,
    createdAt: '2026-05-02T10:00:00.000Z',
    expiresAt: '2026-05-02T11:00:00.000Z',
    scope: 'wound_care_upload_only',
  };

  const sessionPort = {
    create: vi.fn(),
    getById: vi.fn(),
    revoke: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T10:00:00.000Z'));
  });

  it('creates a sixty minute session for the same hospitalization episode', async () => {
    sessionPort.create.mockResolvedValueOnce(session);

    const result = await executeCreateWoundCareMobileUploadSession(
      {
        hospitalId: 'hanga_roa',
        episodeContext: {
          episodeKey: '12345678-9__2026-05-02',
          patientRut: '12345678-9',
          patientName: 'Paciente Test',
        },
        actor,
      },
      { sessionPort, generateSessionId: () => 'session-1' }
    );

    expect(result.status).toBe('success');
    expect(sessionPort.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        episodeKey: '12345678-9__2026-05-02',
        expiresAt: '2026-05-02T11:00:00.000Z',
        scope: 'wound_care_upload_only',
      }),
      'hanga_roa'
    );
  });

  it('validates an active session and rejects expired or revoked sessions', async () => {
    sessionPort.getById.mockResolvedValueOnce(session);
    await expect(
      executeValidateWoundCareMobileUploadSession('session-1', { sessionPort })
    ).resolves.toMatchObject({ status: 'success', data: session });

    sessionPort.getById.mockResolvedValueOnce({
      ...session,
      expiresAt: '2026-05-02T09:59:00.000Z',
    });
    await expect(
      executeValidateWoundCareMobileUploadSession('session-1', { sessionPort })
    ).resolves.toMatchObject({ status: 'failed' });

    sessionPort.getById.mockResolvedValueOnce({
      ...session,
      revokedAt: '2026-05-02T10:10:00.000Z',
    });
    await expect(
      executeValidateWoundCareMobileUploadSession('session-1', { sessionPort })
    ).resolves.toMatchObject({ status: 'failed' });
  });

  it('revokes the session with the requesting actor', async () => {
    sessionPort.revoke.mockResolvedValueOnce(undefined);

    const result = await executeRevokeWoundCareMobileUploadSession(
      { sessionId: 'session-1', actor, hospitalId: 'hanga_roa' },
      { sessionPort }
    );

    expect(result.status).toBe('success');
    expect(sessionPort.revoke).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        revokedBy: actor,
        revokedAt: '2026-05-02T10:00:00.000Z',
      }),
      'hanga_roa'
    );
  });
});
