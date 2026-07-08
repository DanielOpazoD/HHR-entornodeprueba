import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const { mockReload, mockUseDatabaseFallbackStatus } = vi.hoisted(() => ({
  mockReload: vi.fn(),
  mockUseDatabaseFallbackStatus: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbMaintenanceService', () => ({
  resetLocalDatabase: vi.fn(),
}));

vi.mock('@/hooks/useDatabaseFallbackStatus', () => ({
  useDatabaseFallbackStatus: (...args: unknown[]) => mockUseDatabaseFallbackStatus(...args),
}));

vi.mock('@/shared/runtime/browserWindowRuntimeCore', async () => {
  const { createMockBrowserWindowRuntime } = await import('@/tests/utils/browserWindowRuntimeMock');

  return {
    defaultBrowserWindowRuntime: createMockBrowserWindowRuntime({
      reload: mockReload,
    }),
  };
});

import { resetLocalDatabase } from '@/services/storage/indexeddb/indexedDbMaintenanceService';
import StorageStatusBadge from '@/components/layout/StorageStatusBadge';
import {
  getStorageAutoRecoveryKey,
  getStoragePersistentFallbackCountKey,
} from '@/services/storage/storageFallbackUiPolicy';

describe('StorageStatusBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    window.sessionStorage.clear();
    mockUseDatabaseFallbackStatus.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render when fallback mode is disabled', () => {
    render(<StorageStatusBadge />);
    expect(screen.queryByText('Guardado local limitado')).not.toBeInTheDocument();
  });

  it('uses runtime reload on retry and reset on hard cleanup', () => {
    window.sessionStorage.setItem(getStorageAutoRecoveryKey(), 'true');
    window.sessionStorage.setItem(getStoragePersistentFallbackCountKey(), '1');
    mockUseDatabaseFallbackStatus.mockReturnValue(true);
    render(<StorageStatusBadge />);
    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    fireEvent.click(screen.getByRole('button', { name: /Recargar/i }));
    expect(mockReload).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Más información/i }));
    fireEvent.click(screen.getByRole('button', { name: /Reiniciar guardado local/i }));
    expect(resetLocalDatabase).toHaveBeenCalled();
    expect(
      screen.getByText(/si acabas de borrar datos del sitio, recargar una vez suele resolverlo/i)
    ).toBeInTheDocument();
  });

  it('auto-recovers once before showing the banner', () => {
    mockUseDatabaseFallbackStatus.mockReturnValue(true);

    render(<StorageStatusBadge />);

    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Guardado local limitado')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(getStorageAutoRecoveryKey())).toBe('true');
  });

  it('keeps the first persistent fallback silent after the automatic recovery', () => {
    window.sessionStorage.setItem(getStorageAutoRecoveryKey(), 'true');
    mockUseDatabaseFallbackStatus.mockReturnValue(true);

    render(<StorageStatusBadge />);

    expect(screen.queryByText('Guardado local limitado')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(getStoragePersistentFallbackCountKey())).toBe('1');
  });

  it('shows the banner only after the persistent fallback survives the grace delay', () => {
    window.sessionStorage.setItem(getStorageAutoRecoveryKey(), 'true');
    window.sessionStorage.setItem(getStoragePersistentFallbackCountKey(), '1');
    mockUseDatabaseFallbackStatus.mockReturnValue(true);

    render(<StorageStatusBadge />);

    expect(screen.queryByText('Guardado local limitado')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(11_999);
    });
    expect(screen.queryByText('Guardado local limitado')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Guardado local limitado')).toBeInTheDocument();
  });
});
