import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import {
  getStorageAutoRecoveryKey,
  getStoragePersistentFallbackCountKey,
} from '@/services/storage/storageFallbackUiPolicy';

const { mockReload } = vi.hoisted(() => ({
  mockReload: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({
  isDatabaseInFallbackMode: vi.fn(),
  registerDatabaseRecreatedHandler: vi.fn(),
}));

vi.mock('@/shared/runtime/browserWindowRuntimeCore', async () => {
  const { createMockBrowserWindowRuntime } = await import('@/tests/utils/browserWindowRuntimeMock');

  return {
    defaultBrowserWindowRuntime: createMockBrowserWindowRuntime({
      reload: mockReload,
    }),
  };
});

import { isDatabaseInFallbackMode } from '@/services/storage/indexeddb/indexedDbCore';
import { DatabaseStatusBanner } from '@/components/ui/DatabaseStatusBanner';

describe('DatabaseStatusBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('does not render when fallback mode is disabled', () => {
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(false);
    render(<DatabaseStatusBanner />);
    expect(screen.queryByText('Guardado local limitado')).not.toBeInTheDocument();
  });

  it('triggers runtime reload when clicking recover button', () => {
    window.sessionStorage.setItem(getStorageAutoRecoveryKey(), 'true');
    window.sessionStorage.setItem(getStoragePersistentFallbackCountKey(), '1');
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(true);
    render(<DatabaseStatusBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Volver a intentar/i }));
    expect(mockReload).toHaveBeenCalled();
  });

  it('stays hidden before the automatic recovery attempt has completed', () => {
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(true);
    render(<DatabaseStatusBanner />);
    expect(screen.queryByText('Guardado local limitado')).not.toBeInTheDocument();
  });

  it('stays hidden on the first persistent fallback right after auto-recovery', () => {
    window.sessionStorage.setItem(getStorageAutoRecoveryKey(), 'true');
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(true);
    render(<DatabaseStatusBanner />);
    expect(screen.queryByText('Guardado local limitado')).not.toBeInTheDocument();
  });
});
