import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mockReload = vi.fn();

vi.mock('@/services/storage/indexedDBService', () => ({
  isDatabaseInFallbackMode: vi.fn(),
}));

vi.mock('@/shared/runtime/browserWindowRuntime', () => ({
  defaultBrowserWindowRuntime: {
    reload: () => mockReload(),
  },
}));

import { isDatabaseInFallbackMode } from '@/services/storage/indexedDBService';
import { DatabaseStatusBanner } from '@/components/ui/DatabaseStatusBanner';

describe('DatabaseStatusBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when fallback mode is disabled', () => {
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(false);
    render(<DatabaseStatusBanner />);
    expect(screen.queryByText('MODO DE EMERGENCIA:')).not.toBeInTheDocument();
  });

  it('triggers runtime reload when clicking recover button', () => {
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(true);
    render(<DatabaseStatusBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Intentar Recuperar/i }));
    expect(mockReload).toHaveBeenCalled();
  });
});
