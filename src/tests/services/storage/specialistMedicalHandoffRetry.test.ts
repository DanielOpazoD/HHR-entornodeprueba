import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockResolveFirebaseUserRole,
  mockGetCurrentUser,
  mockHttpsCallable,
  mockSpecialistCallable,
  specialistHandoffTargets,
  specialistSnapshot,
} from './firestoreRecordWritesTestSupport';
import { getDoc, updateDoc } from 'firebase/firestore';
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { withRetry } from '@/utils/networkUtils';
import { resolvePatchErrorFeedback } from '@/hooks/controllers/dailyRecordSyncNotificationController';
import { classifySyncError } from '@/services/storage/syncErrorCatalog';

describe('specialist callable retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withRetry).mockImplementation(operation => operation());
    vi.mocked(getDoc).mockResolvedValue(specialistSnapshot() as never);
    mockHttpsCallable.mockReturnValue(mockSpecialistCallable);
    mockSpecialistCallable.mockResolvedValue({ data: { success: true } });
  });
  it('accepts the same legacy id from a stored patient without episode metadata', async () => {
    mockGetCurrentUser.mockReturnValue({ uid: 'synthetic', isAnonymous: false });
    mockResolveFirebaseUserRole.mockResolvedValue('doctor_specialist');
    const { buildLegacyClinicalEpisodeId } =
      await import('@/application/patient-flow/clinicalEpisodeIdPolicy');
    const patient = {
      ...specialistHandoffTargets[0],
      clinicalEpisodeId: undefined,
      admissionDate: '2026-03-18',
      admissionTime: '10:00',
    };
    const clinicalEpisodeId = buildLegacyClinicalEpisodeId(patient) || '';
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ beds: { R4: patient } }),
    } as never);
    await updateRecordPartial(
      '2026-03-20',
      { 'beds.R4.medicalHandoffNote': 'Nota heredada' },
      undefined,
      {
        specialistHandoffTargets: [{ ...specialistHandoffTargets[0], clinicalEpisodeId }],
      }
    );
    expect(mockSpecialistCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOccupants: [expect.objectContaining({ clinicalEpisodeId })],
      })
    );
  });
  it('does not resend a specialist note after turnover during a transport retry', async () => {
    mockGetCurrentUser.mockReturnValue({ uid: 'synthetic', isAnonymous: false });
    mockResolveFirebaseUserRole.mockResolvedValue('doctor_specialist');
    const actual =
      await vi.importActual<typeof import('@/utils/networkUtils')>('@/utils/networkUtils');
    vi.mocked(withRetry).mockImplementation((operation, options) =>
      actual.withRetry(operation, { ...options, initialDelay: 0 })
    );
    vi.mocked(getDoc)
      .mockResolvedValueOnce(specialistSnapshot() as never)
      .mockResolvedValue(specialistSnapshot('synthetic-episode-B') as never);
    mockSpecialistCallable.mockRejectedValueOnce({ code: 'functions/unavailable' });
    const error = await updateRecordPartial(
      '2026-03-20',
      { 'beds.R4.medicalHandoffNote': 'Nota de A' },
      undefined,
      { specialistHandoffTargets }
    ).catch(error => error);
    expect(error).toBeInstanceOf(ConcurrencyError);
    expect(error.message).toMatch(/R4.*[Cc]ambió/);
    expect(classifySyncError(error)).toMatchObject({ category: 'conflict', retryable: false });
    expect(mockSpecialistCallable).toHaveBeenCalledTimes(1);
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('surfaces the server episode rejection as a non-retryable user conflict', async () => {
    mockGetCurrentUser.mockReturnValue({ uid: 'synthetic', isAnonymous: false });
    mockResolveFirebaseUserRole.mockResolvedValue('doctor_specialist');
    const actual =
      await vi.importActual<typeof import('@/utils/networkUtils')>('@/utils/networkUtils');
    vi.mocked(withRetry).mockImplementation((operation, options) =>
      actual.withRetry(operation, { ...options, initialDelay: 0 })
    );
    mockSpecialistCallable.mockRejectedValue({
      code: 'functions/failed-precondition',
      message: 'El episodio de R4 cambió',
    });
    const error = await updateRecordPartial(
      '2026-03-20',
      { 'beds.R4.medicalHandoffNote': 'Nota de A' },
      undefined,
      { specialistHandoffTargets }
    ).catch(error => error);
    expect(error).toBeInstanceOf(ConcurrencyError);
    expect(error.message).toMatch(/R4.*borrador/);
    expect(resolvePatchErrorFeedback(error)).toMatchObject({
      title: 'Conflicto de Edición',
      message: error.message,
    });
    expect(classifySyncError(error)).toMatchObject({ category: 'conflict', retryable: false });
    expect(mockSpecialistCallable).toHaveBeenCalledTimes(1);
    expect(updateDoc).not.toHaveBeenCalled();
  });
  it('keeps a note crossing the clinical day as a recoverable conflict instead of FAILED', async () => {
    mockGetCurrentUser.mockReturnValue({ uid: 'synthetic', isAnonymous: false });
    mockResolveFirebaseUserRole.mockResolvedValue('doctor_specialist');
    mockSpecialistCallable.mockRejectedValue(
      Object.assign(new Error('Specialists can only update the current clinical day.'), {
        code: 'functions/permission-denied',
      })
    );
    const error = await updateRecordPartial(
      '2026-03-20',
      { 'beds.R4.medicalHandoffNote': 'Nota pendiente' },
      undefined,
      { specialistHandoffTargets }
    ).catch(error => error);
    expect(error).toBeInstanceOf(ConcurrencyError);
    expect(error.message).toMatch(/día clínico.*conserva/);
    expect(classifySyncError(error)).toMatchObject({ category: 'conflict', retryable: false });
  });
});
