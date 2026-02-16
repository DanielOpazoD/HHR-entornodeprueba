import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mockReload = vi.fn();

vi.mock('@/services/storage/indexedDBService', () => ({
  isDatabaseInFallbackMode: vi.fn(),
  resetLocalDatabase: vi.fn(),
}));

vi.mock('@/shared/runtime/browserWindowRuntime', () => ({
  defaultBrowserWindowRuntime: {
    reload: () => mockReload(),
  },
}));

import { isDatabaseInFallbackMode, resetLocalDatabase } from '@/services/storage/indexedDBService';
import StorageStatusBadge from '@/components/layout/StorageStatusBadge';

describe('StorageStatusBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when fallback mode is disabled', () => {
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(false);
    render(<StorageStatusBadge />);
    expect(screen.queryByText('Resiliencia de Almacenamiento')).not.toBeInTheDocument();
  });

  it('uses runtime reload on retry and reset on hard cleanup', () => {
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(true);
    render(<StorageStatusBadge />);

    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(mockReload).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Limpieza Dura/i }));
    expect(resetLocalDatabase).toHaveBeenCalled();
  });
});
