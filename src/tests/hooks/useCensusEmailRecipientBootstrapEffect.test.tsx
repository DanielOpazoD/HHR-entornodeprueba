import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useCensusEmailRecipientBootstrapEffect } from '@/hooks/useCensusEmailRecipientBootstrapEffect';
import { withRecipientListUseCases } from '@/hooks/controllers/censusEmailRecipientUseCaseLoader';

vi.mock('@/hooks/controllers/censusEmailRecipientUseCaseLoader', () => ({
  withRecipientListUseCases: vi.fn(),
}));

describe('useCensusEmailRecipientBootstrapEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and applies the bootstrap runtime state', async () => {
    const applyRecipientRuntimeState = vi.fn();
    vi.mocked(withRecipientListUseCases).mockResolvedValue({
      status: 'success',
      data: {
        recipients: ['global@test.com'],
        recipientLists: [
          {
            id: 'census-default',
            name: 'Global',
            description: null,
            recipients: ['global@test.com'],
          },
        ],
        activeRecipientListId: 'census-default',
        recipientsSource: 'firebase',
        recipientsSyncError: null,
        lastRemoteRecipients: ['global@test.com'],
      },
    });

    renderHook(() =>
      useCensusEmailRecipientBootstrapEffect({
        canManageGlobalRecipientLists: true,
        browserRuntime: {
          getLegacyRecipients: () => null,
          clearLegacyRecipients: vi.fn(),
          writeClipboard: vi.fn(),
        },
        bootstrapEnabled: true,
        enabled: true,
        user: { uid: 'admin-1', email: 'admin@test.com' },
        applyRecipientRuntimeState,
      })
    );

    await waitFor(() => {
      expect(applyRecipientRuntimeState).toHaveBeenCalledWith(
        expect.objectContaining({
          recipients: ['global@test.com'],
          activeRecipientListId: 'census-default',
          recipientsSource: 'firebase',
        })
      );
    });
  });

  it('loads firebase recipients for the send flow even when the config modal is closed', async () => {
    const executeLoadCensusRecipientRuntimeState = vi.fn().mockResolvedValue({
      status: 'success',
      data: {
        recipients: ['global@test.com'],
        recipientLists: [],
        activeRecipientListId: 'census-default',
        recipientsSource: 'firebase',
        recipientsSyncError: null,
        lastRemoteRecipients: ['global@test.com'],
      },
    });
    vi.mocked(withRecipientListUseCases).mockImplementation(run =>
      run({ executeLoadCensusRecipientRuntimeState } as never)
    );

    renderHook(() =>
      useCensusEmailRecipientBootstrapEffect({
        canManageGlobalRecipientLists: true,
        browserRuntime: {
          getLegacyRecipients: () => null,
          clearLegacyRecipients: vi.fn(),
          writeClipboard: vi.fn(),
        },
        bootstrapEnabled: true,
        enabled: false,
        user: { uid: 'admin-1', email: 'admin@test.com' },
        applyRecipientRuntimeState: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(executeLoadCensusRecipientRuntimeState).toHaveBeenCalledWith(
        expect.objectContaining({
          canManageGlobalRecipientLists: true,
          enabled: true,
        })
      );
    });
  });

  it('ignores a late bootstrap response after unmount', async () => {
    let resolveLoad:
      | ((value: { status: string; data: { recipients: string[] } }) => void)
      | undefined;

    vi.mocked(withRecipientListUseCases).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveLoad = resolve as typeof resolveLoad;
        })
    );

    const applyRecipientRuntimeState = vi.fn();
    const { unmount } = renderHook(() =>
      useCensusEmailRecipientBootstrapEffect({
        canManageGlobalRecipientLists: true,
        browserRuntime: {
          getLegacyRecipients: () => null,
          clearLegacyRecipients: vi.fn(),
          writeClipboard: vi.fn(),
        },
        bootstrapEnabled: true,
        enabled: true,
        user: { uid: 'admin-1', email: 'admin@test.com' },
        applyRecipientRuntimeState,
      })
    );

    unmount();
    resolveLoad?.({
      status: 'success',
      data: {
        recipients: ['global@test.com'],
      },
    });
    await Promise.resolve();

    expect(applyRecipientRuntimeState).not.toHaveBeenCalled();
  });

  it('does not import recipient use cases when census runtime bootstrap is disabled', async () => {
    const applyRecipientRuntimeState = vi.fn();

    renderHook(() =>
      useCensusEmailRecipientBootstrapEffect({
        canManageGlobalRecipientLists: true,
        browserRuntime: {
          getLegacyRecipients: () => null,
          clearLegacyRecipients: vi.fn(),
          writeClipboard: vi.fn(),
        },
        bootstrapEnabled: false,
        enabled: false,
        user: { uid: 'admin-1', email: 'admin@test.com' },
        applyRecipientRuntimeState,
      })
    );

    await Promise.resolve();

    expect(withRecipientListUseCases).not.toHaveBeenCalled();
    expect(applyRecipientRuntimeState).not.toHaveBeenCalled();
  });
});
