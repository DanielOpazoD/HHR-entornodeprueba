import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCensusEmail } from '@/features/census/email/hooks/useCensusEmail';
import { useConfirmDialog } from '@/context/UIContext';
import { useCensusEmailRecipientLists } from '@/features/census/email/hooks/useCensusEmailRecipientLists';
import { useCensusEmailDeliveryActions } from '@/features/census/email/hooks/useCensusEmailDeliveryActions';
import { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
}));

vi.mock('@/features/census/email/hooks/useCensusEmailRecipientLists', () => ({
  useCensusEmailRecipientLists: vi.fn(),
}));

vi.mock('@/features/census/email/hooks/useCensusEmailDeliveryActions', () => ({
  useCensusEmailDeliveryActions: vi.fn(),
}));

describe('useCensusEmail', () => {
  const mockConfirm = vi.fn();
  const mockAlert = vi.fn();
  const sendEmail = vi.fn();

  const defaultParams = {
    record: {
      date: '2025-01-08',
      beds: {},
      discharges: [],
      transfers: [],
      lastUpdated: '',
      nurses: [],
      activeExtraBeds: [],
      cma: [],
    } satisfies DailyRecord,
    currentDateString: '2025-01-08',
    nurseSignature: 'Nurse Name',
    selectedYear: 2025,
    selectedMonth: 0,
    selectedDay: 8,
    user: { email: 'admin@test.com', role: 'admin' },
    role: 'admin',
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(useConfirmDialog).mockReturnValue({
      confirm: mockConfirm,
      alert: mockAlert,
    } as unknown as ReturnType<typeof useConfirmDialog>);

    vi.mocked(useCensusEmailRecipientLists).mockReturnValue({
      recipients: ['test@test.com'],
      setRecipients: vi.fn(),
      recipientLists: [],
      activeRecipientListId: 'census-default',
      setActiveRecipientListId: vi.fn(),
      createRecipientList: vi.fn(),
      renameActiveRecipientList: vi.fn(),
      deleteRecipientList: vi.fn(),
      recipientsSource: 'firebase',
      isRecipientsSyncing: false,
      recipientsSyncError: null,
    });

    vi.mocked(useCensusEmailDeliveryActions).mockReturnValue({
      sendEmail,
    });
  });

  it('initializes facade state and recipients', async () => {
    const { result } = renderHook(() => useCensusEmail(defaultParams));

    expect(result.current.status).toBe('idle');
    expect(result.current.showEmailConfig).toBe(false);
    expect(result.current.isAdminUser).toBe(true);
    expect(result.current.recipients).toEqual(['test@test.com']);
    expect(useCensusEmailRecipientLists).toHaveBeenCalledWith(
      expect.objectContaining({
        canManageGlobalRecipientLists: true,
        bootstrapEnabled: true,
        enabled: false,
        user: defaultParams.user,
      })
    );
  });

  it('enables global recipient list bootstrap when the email config is opened', async () => {
    const { result } = renderHook(() => useCensusEmail(defaultParams));

    expect(useCensusEmailRecipientLists).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bootstrapEnabled: true,
        enabled: false,
      })
    );

    act(() => {
      result.current.setShowEmailConfig(true);
    });

    await waitFor(() => {
      expect(useCensusEmailRecipientLists).toHaveBeenLastCalledWith(
        expect.objectContaining({
          bootstrapEnabled: true,
          enabled: true,
        })
      );
    });
  });

  it('keeps email config and recipient bootstrap disabled when the hook is disabled', async () => {
    const { result } = renderHook(() => useCensusEmail({ ...defaultParams, enabled: false }));

    act(() => {
      result.current.setShowEmailConfig(true);
    });

    await waitFor(() => {
      expect(result.current.showEmailConfig).toBe(false);
    });

    expect(useCensusEmailRecipientLists).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bootstrapEnabled: false,
        enabled: false,
      })
    );
  });

  it('updates message when nurseSignature changes until manual edit occurs', async () => {
    const { result, rerender } = renderHook(props => useCensusEmail(props), {
      initialProps: defaultParams,
    });

    expect(result.current.message).toContain('Nurse Name');

    act(() => {
      rerender({ ...defaultParams, nurseSignature: 'New Nurse' });
    });

    await waitFor(() => {
      expect(result.current.message).toContain('New Nurse');
    });

    act(() => {
      result.current.onMessageChange('Manual edit');
    });

    act(() => {
      rerender({ ...defaultParams, nurseSignature: 'Third Nurse' });
    });

    await waitFor(() => {
      expect(result.current.message).toBe('Manual edit');
    });
  });

  it('resets send state when currentDateString changes', async () => {
    const { result, rerender } = renderHook(props => useCensusEmail(props), {
      initialProps: defaultParams,
    });

    act(() => {
      rerender({ ...defaultParams, currentDateString: '2025-01-09' });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
      expect(result.current.error).toBeNull();
    });
  });

  it('delegates email send actions to the delivery hook boundary', async () => {
    const { result } = renderHook(() => useCensusEmail(defaultParams));

    await act(async () => {
      await result.current.sendEmail();
    });

    expect(sendEmail).toHaveBeenCalled();
  });

  it('uses shared capability gating for global lists and admin test mode', async () => {
    renderHook(() =>
      useCensusEmail({
        ...defaultParams,
        role: 'nurse_hospital',
        user: { email: 'nurse@test.com', role: 'nurse_hospital' },
      })
    );

    expect(useCensusEmailRecipientLists).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canManageGlobalRecipientLists: true,
        bootstrapEnabled: true,
        enabled: false,
        user: { email: 'nurse@test.com', role: 'nurse_hospital' },
      })
    );

    const { result } = renderHook(() =>
      useCensusEmail({
        ...defaultParams,
        role: 'doctor_specialist',
        user: { email: 'specialist@test.com', role: 'doctor_specialist' },
      })
    );

    await waitFor(() => {
      expect(result.current.isAdminUser).toBe(false);
    });

    expect(useCensusEmailRecipientLists).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canManageGlobalRecipientLists: false,
        bootstrapEnabled: true,
        enabled: false,
        user: { email: 'specialist@test.com', role: 'doctor_specialist' },
      })
    );
  });

  it('keeps test mode disabled for users without admin maintenance access', () => {
    const { result } = renderHook(() =>
      useCensusEmail({
        ...defaultParams,
        role: 'doctor_specialist',
        user: { email: 'specialist@test.com', role: 'doctor_specialist' },
      })
    );

    act(() => {
      result.current.setTestModeEnabled(true);
      result.current.setTestRecipient('test@example.com');
    });

    expect(result.current.isAdminUser).toBe(false);
    expect(result.current.testModeEnabled).toBe(false);
    expect(result.current.testRecipient).toBe('');
  });
});
