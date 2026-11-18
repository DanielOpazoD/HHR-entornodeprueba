// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipientRuntimeMutationSpec } from '@/features/census/email/controllers/censusEmailRecipientMutationActionController';
import type { RecipientRuntimeState } from '@/features/census/email/controllers/censusEmailRecipientRuntimeController';
import { executeRecipientRuntimeMutationSpec } from '@/features/census/email/controllers/censusEmailRecipientMutationRunner';
import { withRecipientListUseCases } from '@/features/census/email/controllers/censusEmailRecipientUseCaseLoader';

vi.mock('@/features/census/email/controllers/censusEmailRecipientUseCaseLoader', () => ({
  withRecipientListUseCases: vi.fn(),
}));

describe('censusEmailRecipientMutationRunner', () => {
  const runtimeState: RecipientRuntimeState = {
    recipientLists: [],
    recipients: ['uno@example.com'],
    recipientsSource: 'firebase',
    activeRecipientListId: 'global',
    recipientsSyncError: null,
    lastRemoteRecipients: ['uno@example.com'],
  };

  const createStateHandlers = () => ({
    applyRuntimeState: vi.fn(),
    setRecipientsSyncing: vi.fn(),
    setRecipientsSyncError: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies the resolved runtime state for successful mutations', async () => {
    const state = createStateHandlers();
    const spec: RecipientRuntimeMutationSpec<{ id: string }> = {
      execute: vi.fn().mockResolvedValue({
        status: 'success',
        data: { id: 'global' },
      }),
      resolveRuntimeState: vi.fn().mockReturnValue(runtimeState),
      fallbackMessage: 'fallback',
    };

    vi.mocked(withRecipientListUseCases).mockImplementation(run => run({} as never));

    await executeRecipientRuntimeMutationSpec(spec, {
      ...state,
      resolveRuntimeState: spec.resolveRuntimeState,
    });

    expect(state.setRecipientsSyncing).toHaveBeenNthCalledWith(1, true);
    expect(state.setRecipientsSyncError).toHaveBeenNthCalledWith(1, null);
    expect(spec.resolveRuntimeState).toHaveBeenCalledWith({ id: 'global' });
    expect(state.applyRuntimeState).toHaveBeenCalledWith(runtimeState);
    expect(state.setRecipientsSyncing).toHaveBeenLastCalledWith(false);
  });

  it('surfaces a safe error when the mutation fails', async () => {
    const state = createStateHandlers();
    const spec: RecipientRuntimeMutationSpec<{ id: string }> = {
      execute: vi.fn().mockResolvedValue({
        status: 'error',
        issues: [{ userSafeMessage: 'No autorizado' }],
      }),
      resolveRuntimeState: vi.fn(),
      fallbackMessage: 'fallback',
    };

    vi.mocked(withRecipientListUseCases).mockImplementation(run => run({} as never));

    await executeRecipientRuntimeMutationSpec(spec, {
      ...state,
      resolveRuntimeState: spec.resolveRuntimeState,
    });

    expect(state.applyRuntimeState).not.toHaveBeenCalled();
    expect(state.setRecipientsSyncError).toHaveBeenLastCalledWith('No autorizado');
    expect(state.setRecipientsSyncing).toHaveBeenLastCalledWith(false);
  });
});
