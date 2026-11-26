import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseCensusEmailReturn } from '@/context/CensusContext';
import type { UseCensusEmailParams } from '@/features/census/email/hooks/useCensusEmail';
import { DataFactory } from '@/tests/factories/DataFactory';

const mockUseCensusEmail = vi.fn<(params: UseCensusEmailParams) => UseCensusEmailReturn>();

vi.mock('@/features/census/email/hooks/useCensusEmail', () => ({
  useCensusEmail: (params: UseCensusEmailParams) => mockUseCensusEmail(params),
}));

import { useDeferredCensusEmail } from '@/app-shell/runtime/useDeferredCensusEmail';

const buildLiveCensusEmail = (
  overrides: Partial<UseCensusEmailReturn> = {}
): UseCensusEmailReturn => ({
  showEmailConfig: false,
  setShowEmailConfig: vi.fn(),
  recipients: ['team@hospital.cl'],
  setRecipients: vi.fn(),
  recipientLists: [],
  activeRecipientListId: 'default',
  setActiveRecipientListId: vi.fn(),
  createRecipientList: vi.fn().mockResolvedValue(undefined),
  renameActiveRecipientList: vi.fn().mockResolvedValue(undefined),
  deleteRecipientList: vi.fn().mockResolvedValue(undefined),
  recipientsSource: 'default',
  isRecipientsSyncing: false,
  recipientsSyncError: null,
  message: 'Mensaje censo',
  onMessageChange: vi.fn(),
  onResetMessage: vi.fn(),
  status: 'idle',
  error: null,
  emailBlockedReason: null,
  resetStatus: vi.fn(),
  sendEmail: vi.fn().mockResolvedValue(undefined),
  testModeEnabled: false,
  setTestModeEnabled: vi.fn(),
  testRecipient: '',
  setTestRecipient: vi.fn(),
  isAdminUser: true,
  ...overrides,
});

const baseParams = (overrides: Partial<UseCensusEmailParams> = {}): UseCensusEmailParams => ({
  record: DataFactory.createMockDailyRecord('2026-04-20'),
  currentDateString: '2026-04-20',
  nurseSignature: 'Enf. Turno',
  selectedYear: 2026,
  selectedMonth: 3,
  selectedDay: 20,
  user: { uid: 'u1', email: 'admin@hospital.cl', role: 'admin' },
  role: 'admin',
  enabled: true,
  ...overrides,
});

describe('useDeferredCensusEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not load the email runtime while disabled outside the census module', async () => {
    const { result } = renderHook(() => useDeferredCensusEmail(baseParams({ enabled: false })));

    expect(result.current.censusEmailBridge).toBeNull();
    expect(result.current.censusEmail.status).toBe('idle');
    expect(result.current.censusEmail.isAdminUser).toBe(true);
    expect(mockUseCensusEmail).not.toHaveBeenCalled();
  });

  it('loads the bridge asynchronously when enabled and replays early open/send actions', async () => {
    const live = buildLiveCensusEmail();
    mockUseCensusEmail.mockReturnValue(live);

    const Harness = ({ onReady }: { onReady: (api: UseCensusEmailReturn) => void }) => {
      const { censusEmail, censusEmailBridge } = useDeferredCensusEmail(baseParams());
      React.useEffect(() => {
        onReady(censusEmail);
      }, [censusEmail, onReady]);
      return <>{censusEmailBridge}</>;
    };

    let latestApi!: UseCensusEmailReturn;
    render(
      <Harness
        onReady={api => {
          latestApi = api;
        }}
      />
    );

    let sendPromise!: Promise<void>;
    act(() => {
      latestApi.setShowEmailConfig(true);
      sendPromise = latestApi.sendEmail();
    });

    await waitFor(() => expect(live.setShowEmailConfig).toHaveBeenCalledWith(true));
    await waitFor(() => expect(live.sendEmail).toHaveBeenCalledTimes(1));
    await expect(sendPromise).resolves.toBeUndefined();
    expect(latestApi).toBe(live);
  });
});
