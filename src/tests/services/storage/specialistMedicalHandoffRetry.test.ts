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
    expect(error.message).toMatch(/R4.*Recarga/);
    expect(resolvePatchErrorFeedback(error)).toMatchObject({
      title: 'Conflicto de Edición',
      message: error.message,
    });
    expect(classifySyncError(error)).toMatchObject({ category: 'conflict', retryable: false });
    expect(mockSpecialistCallable).toHaveBeenCalledTimes(1);
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
