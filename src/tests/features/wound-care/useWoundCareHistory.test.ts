import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWoundCareHistory } from '@/features/wound-care/hooks/useWoundCareHistory';
import type {
  WoundCareConsentPort,
  WoundCarePhotoPort,
} from '@/features/wound-care/use-cases/woundCarePort';

const { mockWoundCareHistoryLogger } = vi.hoisted(() => ({
  mockWoundCareHistoryLogger: vi.fn(),
}));

vi.mock('@/services/utils/loggerScope', async () => {
  const { createLoggerScopeMock } = await import('@/tests/utils/loggerScopeMock');
  return createLoggerScopeMock({ error: mockWoundCareHistoryLogger });
});

describe('useWoundCareHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs fetch failures through the structured logger and stops loading', async () => {
    const historyError = new Error('history failed');
    const photoPort = {
      listByPatientRut: vi.fn().mockRejectedValue(historyError),
    } as unknown as WoundCarePhotoPort;
    const consentPort = {
      listByPatientRut: vi.fn().mockResolvedValue([]),
    } as unknown as WoundCareConsentPort;

    const { result } = renderHook(() =>
      useWoundCareHistory({
        patientRut: '11111111-1',
        currentEpisodeKey: 'episode-1',
        photoPort,
        consentPort,
      })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockWoundCareHistoryLogger).toHaveBeenCalledWith(
      'Error loading wound care history',
      historyError
    );
    expect(result.current.episodes).toEqual([
      expect.objectContaining({
        episodeKey: 'episode-1',
        isCurrent: true,
        photos: [],
      }),
    ]);
  });
});
